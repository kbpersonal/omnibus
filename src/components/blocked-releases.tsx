// src/components/blocked-releases.tsx
//
// Admin view of the release blocklist. Self-contained (fetches its own data) so it can be dropped
// into a settings tab without threading state through the settings bag.
//
// The importer adds entries here on its own when it refuses a payload belonging to a different
// series, and the search path then skips those releases forever. Without this view a block is
// invisible — an issue simply stops downloading with no way to see why or to undo a false positive.
"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { useToast } from "@/components/ui/use-toast"
import { Ban, Loader2, RotateCcw } from "lucide-react"

type BlockedRelease = {
    id: string
    releaseTitle: string
    downloadLink: string | null
    seriesName: string | null
    volumeId: string | null
    issueNumber: string | null
    reason: string
    createdAt: string
}

export function BlockedReleases() {
    const { toast } = useToast()
    const [entries, setEntries] = useState<BlockedRelease[] | null>(null)
    const [pendingUnblock, setPendingUnblock] = useState<BlockedRelease | null>(null)
    const [isUnblocking, setIsUnblocking] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/blocklist?t=${Date.now()}`)
            const data = await res.json()
            setEntries(data.entries || [])
        } catch {
            setEntries([])
        }
    }, [])

    useEffect(() => { load() }, [load])

    const unblock = async () => {
        if (!pendingUnblock) return
        setIsUnblocking(true)
        try {
            const res = await fetch(`/api/admin/blocklist?id=${encodeURIComponent(pendingUnblock.id)}`, { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Unblock failed')
            toast({ title: "Release unblocked", description: data.message })
            setPendingUnblock(null)
            await load()
        } catch (e: any) {
            toast({ title: "Could not unblock", description: e.message, variant: "destructive" })
        } finally {
            setIsUnblocking(false)
        }
    }

    return (
        <div className="space-y-4 pt-6 border-t border-border">
            <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <Ban className="w-4 h-4 text-primary" /> Blocked Releases
                </h3>
                <p className="text-[11px] text-muted-foreground mt-1">
                    Releases refused at import because the file inside belonged to a different series. They are skipped by every future search. Unblock one to make it downloadable again.
                </p>
            </div>

            {entries === null && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading blocked releases…
                </div>
            )}

            {entries?.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed rounded-lg border-border bg-muted/30">
                    <p className="text-sm text-muted-foreground">No blocked releases. Nothing has been refused at import.</p>
                </div>
            )}

            {entries && entries.length > 0 && (
                <div className="grid gap-2">
                    {entries.map(entry => (
                        <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/30 p-3 rounded-lg border border-border">
                            <div className="min-w-0">
                                <p className="font-mono text-sm text-foreground break-all">{entry.releaseTitle}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                    {entry.seriesName && (
                                        <Badge variant="outline" className="text-[10px]">
                                            {entry.seriesName}{entry.issueNumber ? ` #${entry.issueNumber}` : ''}
                                        </Badge>
                                    )}
                                    <span className="text-[11px] text-muted-foreground">{entry.reason}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    Blocked {new Date(entry.createdAt).toLocaleString()}
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0 border-border hover:bg-muted text-foreground font-bold"
                                onClick={() => setPendingUnblock(entry)}
                            >
                                <RotateCcw className="w-3.5 h-3.5 mr-2" /> Unblock
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmationDialog
                isOpen={!!pendingUnblock}
                onClose={() => setPendingUnblock(null)}
                onConfirm={unblock}
                isLoading={isUnblocking}
                variant="default"
                title="Unblock this release?"
                description={`"${pendingUnblock?.releaseTitle}" will be eligible for search and download again. If it still contains the wrong comic, the importer will refuse and re-block it.`}
                confirmText="Unblock"
            />
        </div>
    )
}
