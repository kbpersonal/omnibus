// __tests__/lib/automation.test.ts
// automation.ts is now a thin layer: searchAndDownload() enqueues a BullMQ
// SEARCH_AND_DOWNLOAD job (the Rust engine performs the actual search via
// queue.ts -> /api/automation/search). The legacy full-Node search
// (executeSearchAndDownload) was deleted as dead code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchAndDownload, processAutomationQueue } from '@/lib/automation';

const mocks = vi.hoisted(() => ({
    queueAdd: vi.fn().mockResolvedValue({})
}));

// searchAndDownload pulls the queue in via a dynamic import; vi.mock covers that too.
vi.mock('@/lib/queue', () => ({
    omnibusQueue: { add: mocks.queueAdd }
}));

describe('Core Logic: Automation (engine handoff)', () => {

    describe('searchAndDownload()', () => {
        it('should enqueue a SEARCH_AND_DOWNLOAD job with the full request payload', async () => {
            await searchAndDownload('req_1', 'Batman', '2024', 'DC', false, true);

            expect(mocks.queueAdd).toHaveBeenCalledWith(
                'SEARCH_AND_DOWNLOAD',
                {
                    type: 'SEARCH_AND_DOWNLOAD',
                    requestId: 'req_1',
                    name: 'Batman',
                    year: '2024',
                    publisher: 'DC',
                    isManga: false,
                    skipIndexers: true
                },
                expect.objectContaining({ jobId: expect.stringMatching(/^SEARCH_req_1_/) })
            );
        });

        it('should space successive searches apart via increasing enqueue delays', async () => {
            await searchAndDownload('req_a', 'Batman', '2024');
            await searchAndDownload('req_b', 'Superman', '2024');

            const delayA = mocks.queueAdd.mock.calls[0][2].delay;
            const delayB = mocks.queueAdd.mock.calls[1][2].delay;

            // Second job must be scheduled at least ~5s after the first
            expect(delayB - delayA).toBeGreaterThanOrEqual(4000);
        });

        it('uses a fresh BullMQ job ID when the same request is searched again', async () => {
            await searchAndDownload('req_retry', 'Batman #1', '2024');
            await searchAndDownload('req_retry', 'Batman #1', '2024');

            const [first, second] = mocks.queueAdd.mock.calls;
            expect(first[2].jobId).toMatch(/^SEARCH_req_retry_/);
            expect(second[2].jobId).toMatch(/^SEARCH_req_retry_/);
            expect(second[2].jobId).not.toBe(first[2].jobId);
        });
    });

    describe('processAutomationQueue()', () => {
        it('should enqueue one job per queued automation item', async () => {
            await processAutomationQueue([
                { id: 'req_1', name: 'Batman', year: '2024', publisher: 'DC', isManga: false, skipIndexers: false },
                { id: 'req_2', name: 'Akira', year: '1988', publisher: 'Kodansha', isManga: true, skipIndexers: false }
            ]);

            expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
            expect(mocks.queueAdd).toHaveBeenCalledWith(
                'SEARCH_AND_DOWNLOAD',
                expect.objectContaining({ requestId: 'req_2', name: 'Akira', isManga: true }),
                expect.objectContaining({ jobId: expect.stringMatching(/^SEARCH_req_2_/) })
            );
        });
    });
});
