# Omnibus Fork Release Context

This context defines the release language for the Omnibus fork, which carries local changes on top of the upstream Omnibus project.

## Release language

**Upstream release**:
The three-component release published by `hankscafe/omnibus`, such as `1.4.4`. The upstream release owns the first three numeric components.
_Avoid_: fork version, patch bump.

**Fork build**:
A build of this fork based on one upstream release, identified as `major.minor.patch.build`, such as `1.4.4.1`. The fourth component counts fork builds on the same upstream release.
_Avoid_: SemVer patch, upstream release.

**Release promotion**:
The process of moving one fork build through CI, GHCR, Renovate, and the Ottawa deployment before it is considered validated.
_Avoid_: publish only, deploy only.

**Old-scheme image**:
An image tagged with the former three-component fork numbering, including the mistaken `v1.4.11` line. Old-scheme images are removed from GHCR after the new four-component build is validated.
_Avoid_: historical image, current build.

## Books and comics stack language

**Acquirer**:
A service that finds or receives content and writes it into a library-owned storage path.
_Avoid_: Reader, server

**Reader**:
A service that presents a library to people and owns their reading or listening state.
_Avoid_: Downloader, acquirer

**Library tree**:
A content directory with one designated acquirer and one designated reader, so two services never
rename or index the same files as owners.
_Avoid_: Shared write directory

**Monitored manga**:
A manga request accepted by Suwayomi, which keeps the series and future chapters updated; the
request is fulfilled even though it has no final-download moment.
_Avoid_: Completed manga download

**Needs Source**:
A manga request parked because no configured source produced one exact, unambiguous title match.
It is an admin action item, not a failed comic download.
_Avoid_: Failed manga, manual DDL
