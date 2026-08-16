# Fork build numbering and promotion

**Status:** accepted

The fork follows the upstream release in the first three components and adds a fourth build component: upstream `1.4.4` becomes fork builds `1.4.4.1`, `1.4.4.2`, and so on. The third component changes only when a newer upstream release is merged; the fourth component resets to `.1` for the first fork build on that upstream release. This is intentionally a four-component fork build identifier, not strict SemVer, so the repository and Renovate must use an explicit four-component comparison rule rather than silently treating a fork build as a higher upstream patch release.

`package.json` and `package-lock.json` are the version source of truth. A release uses the same identifier in the Git tag (`v1.4.4.1`), GitHub Release, web image, engine image, and Ottawa manifest; the manifest remains digest-pinned. The main workflow must pass the version into the engine image so `/health` can detect web/engine drift.

Promotion is gated in order: local Node and Rust tests/builds; green GitHub Actions; both new GHCR images; Renovate discovery of the four-component tags; manifest update and render validation; Flux reconciliation; pod readiness and zero restarts; web health; engine health/version; web-to-engine authenticated handshake; and a representative live Omnibus workflow on Ottawa. CI or a healthy pod alone is not E2E validation. Interactive search source calls are individually bounded at 10 seconds, deliberately below Ottawa's 15-second gateway deadline; a slow or solver-backed source is degraded to an empty result while faster sources still return.

The four-component scheme is a fresh image namespace. After the new build is validated, delete old-scheme GHCR package versions for both `ghcr.io/kbpersonal/omnibus` and `ghcr.io/kbpersonal/omnibus-engine`. Preserve the new four-component images and active aliases such as `latest`; GHCR deletion requires a token with `delete:packages`.

## Build checklist

1. Confirm the upstream stable base and the next fork build number. For upstream `1.4.4`, use `1.4.4.1` for the first build; do not invent `1.4.11`.
2. Update both package manifests together and verify the values:

   ```bash
   npm ci --legacy-peer-deps
   npx prisma generate
   npm pkg get version
   rg '"version"' package.json package-lock.json | head
   ```

   A complete local run needs a Prisma-supported OpenSSL runtime and Redis. If Prisma reports a
   missing `libssl` or the build reports Redis connection failures, repair the workstation
   prerequisites and rerun the gates; do not call a partially passing local run release validation.
   GitHub Actions remains the clean-environment backstop.

3. Run the local gates:

   ```bash
   npm test
   npm run build
   cd omnibus-engine
   cargo clippy --all-targets -- -D warnings
   cargo test
   cd ..
   ```

4. Commit the version and code changes, push `main`, and push `v<version>`. The Docker workflow publishes the web and engine images and creates the GitHub Release from `package.json`.
5. Verify both workflow jobs and both GHCR `v<version>` tags before touching the cluster.
6. Update the Ottawa web and engine image tags and immutable digests. Run `tools/check.sh talos-ottawa` in the manifests checkout, then wait for Flux to reconcile.
7. Validate Ottawa end to end. This is the complete live gate, not a single HTTP probe:

   ```bash
   tools/kc.sh ot -n flux-system get kustomizations
   tools/kc.sh ot -n media get deployment omnibus -o wide
   tools/kc.sh ot -n media get pods -l app=omnibus -o wide
   tools/kc.sh ot -n media get endpointslice -l kubernetes.io/service-name=omnibus
   tools/ktriage.sh ot media <pod>
   curl -skS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://omnibus.killinit.cc/
   curl -skS -o /dev/null -w '%{http_code}\n' https://omnibus.killinit.cc/login
   curl -skS https://omnibus.killinit.cc/api/setup/check
   ```

   Require the `media-apps` Kustomization to be Ready, the `media/omnibus` Deployment to be 1/1
   ready and available, both Omnibus containers ready, zero restarts, no unhealthy events, and
   clean current logs. The public root must redirect to login, login must return 200, and setup
   must report `requiresSetup:false`. Then log in as an admin, force the Admin Health panel, and
   require Engine Version and Engine Handshake to be healthy. Finally perform a real authenticated
   Omnibus request/search through the UI, confirm it reaches the configured downloader, imports
   into the library, appears in the downstream reader, and leaves the expected job logs. The
   repository has no Playwright/Cypress runner, so this functional workflow is an explicit manual
   promotion gate; a pod probe or CI result alone is not E2E.
8. Only after all promotion gates pass, remove old-scheme GHCR package versions. Never delete the new four-component tags or `latest`.
