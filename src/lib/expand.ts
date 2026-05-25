import { request } from 'graphql-request'

import {
  type MediaEdge,
  type MediaList,
  type MediaListCollection,
  MediaRelation,
} from '../graphql'
import type { ExpandedMedia, Visibility } from '../types'
import { endpoint, pageQuery } from './anilist'

export interface ExpansionProgress {
  extras: Map<number, ExpandedMedia>
  done: number
  total: number
}

export async function expandUnseenRelations(
  collection: MediaListCollection,
  seenIds: Set<number>,
  visibility: Visibility,
  onProgress: (state: ExpansionProgress) => void,
  maxIterations = 4,
): Promise<Map<number, ExpandedMedia>> {
  const extras = new Map<number, ExpandedMedia>()
  const queued = new Set<number>()
  let frontier: number[] = []

  // Recap / compilation entries are flagged via a SUMMARY relation from the
  // original entry. They're noise for gap-spotting, so never fetch them even
  // when another relation (e.g. a sequel mislabeled as PREQUEL) points at them.
  const summaryTargets = new Set<number>()
  const harvestSummaries = (edges?: (MediaEdge | null)[] | null) => {
    for (const e of edges ?? []) {
      if (e?.relationType === MediaRelation.Summary && e.node) summaryTargets.add(e.node.id)
    }
  }

  // Only follow relations the user explicitly enabled, and only fetch targets
  // whose format/status the user wants to see. Shallow relation nodes carry
  // enough metadata (format/status) for us to gate here before fetching.
  // Strict matching: relation, format AND status must all be in the user's
  // selection. Anime with a missing/unknown format or status are rejected so
  // expansion never fetches anything the display would hide anyway.
  const acceptEdge = (
    edge: MediaEdge | null | undefined,
  ): edge is MediaEdge & {
    node: NonNullable<MediaEdge['node']>
    relationType: NonNullable<MediaEdge['relationType']>
  } => {
    if (!edge?.node || !edge.relationType) return false
    if (!visibility.relation.includes(edge.relationType)) return false
    const n = edge.node
    if (!n.format || !visibility.format.includes(n.format)) return false
    if (!n.status || !visibility.status.includes(n.status)) return false
    if (summaryTargets.has(n.id)) return false
    return true
  }

  const queueFromEdge = (edge: MediaEdge | null | undefined) => {
    if (!acceptEdge(edge)) return
    const id = edge.node.id
    if (seenIds.has(id) || queued.has(id)) return
    queued.add(id)
    frontier.push(id)
  }

  for (const list of collection.lists ?? []) {
    for (const entry of (list?.entries ?? []) as MediaList[]) {
      harvestSummaries(entry.media?.relations?.edges)
    }
  }
  for (const list of collection.lists ?? []) {
    for (const entry of (list?.entries ?? []) as MediaList[]) {
      for (const edge of entry.media?.relations?.edges ?? []) {
        queueFromEdge(edge)
      }
    }
  }

  const report = () => {
    onProgress({ extras: new Map(extras), done: extras.size, total: queued.size })
  }

  report()

  for (let iter = 0; iter < maxIterations && frontier.length > 0; iter++) {
    const next: number[] = []
    for (let i = 0; i < frontier.length; i += 50) {
      const batch = frontier.slice(i, i + 50)
      let res: { Page: { media: ExpandedMedia[] | null } } | null
      try {
        res = await request<{ Page: { media: ExpandedMedia[] | null } }>({
          url: endpoint,
          document: pageQuery,
          variables: { ids: batch },
        })
      } catch (err) {
        console.error('expansion batch failed', err)
        for (const id of batch) extras.set(id, { id })
        report()
        continue
      }
      const media = res.Page.media ?? []
      for (const m of media) {
        extras.set(m.id, m)
        harvestSummaries(m.relations?.edges)
      }
      for (const m of media) {
        for (const edge of m.relations?.edges ?? []) {
          if (!acceptEdge(edge)) continue
          const id = edge.node.id
          if (seenIds.has(id) || queued.has(id)) continue
          queued.add(id)
          next.push(id)
        }
      }
      report()
    }
    frontier = next
  }

  return extras
}
