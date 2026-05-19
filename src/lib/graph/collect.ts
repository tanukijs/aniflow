import type { Edge } from '@xyflow/react'

import {
  type MediaEdge,
  type MediaFormat,
  type MediaList,
  type MediaListCollection,
  MediaRelation,
  type MediaStatus,
} from '../../graphql'
import type {
  AnimeNodeData,
  ExpandedMedia,
  FuzzyDate,
  MediaWithRelations,
  Visibility,
} from '../../types'
import { dateOrder } from '../anilist'

export interface CollectedGraph {
  nodeData: Map<number, AnimeNodeData>
  edges: Edge[]
  /** Media records we have full data for (collection entries + expanded). */
  allBases: MediaWithRelations[]
}

/**
 * Walk the user's list and any expanded relations, filter by the user's
 * visibility selectors, and produce the node/edge skeleton of the graph.
 *
 * Edges are emitted oriented "older → newer" (using start dates when both
 * are known, falling back to PREQUEL/SEQUEL semantics) so dagre's left-to-right
 * layout matches the timeline.
 */
export function collectGraph(
  collection: MediaListCollection,
  extraMedia: Map<number, ExpandedMedia>,
  seenIds: Set<number>,
  visibility: Visibility,
): CollectedGraph {
  const nodeData = new Map<number, AnimeNodeData>()
  const edges: Edge[] = []
  const edgeKeys = new Set<string>()

  const isVisibleMedia = (m: { format?: MediaFormat | null; status?: MediaStatus | null }) =>
    !!m.format &&
    visibility.format.includes(m.format) &&
    !!m.status &&
    visibility.status.includes(m.status)

  const isVisibleEdge = (e: MediaEdge) =>
    !!e.relationType &&
    visibility.relation.includes(e.relationType) &&
    !!e.node &&
    isVisibleMedia(e.node)

  const addNode = (m: MediaWithRelations) => {
    if (!isVisibleMedia(m)) return
    const existing = nodeData.get(m.id)
    if (existing) {
      // Upgrade shallow entry once we have richer data.
      if (!existing.cover && m.coverImage?.medium) existing.cover = m.coverImage.medium
      if (!existing.coverColor && m.coverImage?.color) existing.coverColor = m.coverImage.color
      return
    }
    nodeData.set(m.id, {
      title: m.title?.userPreferred ?? `#${String(m.id)}`,
      cover: m.coverImage?.medium ?? undefined,
      coverColor: m.coverImage?.color ?? undefined,
      siteUrl: m.siteUrl ?? undefined,
      format: m.format,
      status: m.status,
      seen: seenIds.has(m.id),
    })
  }

  // Build a lookup by id for ALL known media (seen + previously expanded).
  // Expansion may have over-fetched (e.g. cached items from a session where
  // more relations were enabled); we'll only surface what's reachable via the
  // user's currently visible relations.
  const mediaById = new Map<number, MediaWithRelations>()
  for (const list of collection.lists ?? []) {
    for (const entry of (list?.entries ?? []) as MediaList[]) {
      if (entry.media) mediaById.set(entry.media.id, entry.media)
    }
  }
  for (const m of extraMedia.values()) {
    if (!mediaById.has(m.id)) mediaById.set(m.id, m)
  }

  // Seed nodes with the user's collection entries.
  for (const list of collection.lists ?? []) {
    for (const entry of (list?.entries ?? []) as MediaList[]) {
      if (entry.media) addNode(entry.media)
    }
  }

  // BFS outward through visible relations only — anything not reachable from
  // a seen anime via the user's selected relations never gets a node.
  const allBases: MediaWithRelations[] = []
  const visitedForBfs = new Set<number>(nodeData.keys())
  const queue: number[] = [...nodeData.keys()]
  while (queue.length) {
    const id = queue.shift()
    if (id === undefined) break
    const m = mediaById.get(id)
    if (!m) continue
    // Upgrade the (possibly shallow) entry with full data we now have.
    addNode(m)
    allBases.push(m)
    for (const edge of m.relations?.edges ?? []) {
      if (!edge?.node || !edge.relationType) continue
      if (!isVisibleEdge(edge)) continue
      const t = edge.node
      addNode(t)
      if (!nodeData.has(t.id)) continue
      if (visitedForBfs.has(t.id)) continue
      visitedForBfs.add(t.id)
      queue.push(t.id)
    }
  }

  // Release dates power chronological direction. Index by media id from
  // allBases (which carry full data); shallow relation nodes that we never
  // expanded fall back to PREQUEL/SEQUEL semantics below.
  const dateById = new Map<number, number>()
  for (const m of allBases) {
    if (!nodeData.has(m.id)) continue
    dateById.set(m.id, dateOrder(m.startDate))
  }
  for (const m of allBases) {
    for (const edge of m.relations?.edges ?? []) {
      const n = edge?.node
      if (!n || !nodeData.has(n.id) || dateById.has(n.id)) continue
      dateById.set(n.id, dateOrder((n as { startDate?: FuzzyDate | null }).startDate))
    }
  }
  const orderOf = (id: number) => dateById.get(id) ?? Number.POSITIVE_INFINITY

  for (const m of allBases) {
    if (!nodeData.has(m.id)) continue
    for (const edge of m.relations?.edges ?? []) {
      if (!edge?.node || !edge.relationType) continue
      if (!isVisibleEdge(edge)) continue
      const target = edge.node
      if (!nodeData.has(target.id)) addNode(target)
      if (!nodeData.has(target.id)) continue

      // Direction encodes chronology: source = older, target = newer.
      // Prefer release-date ordering (authoritative when both are known);
      // fall back to PREQUEL/SEQUEL semantics when dates are equal/missing.
      const dM = orderOf(m.id)
      const dT = orderOf(target.id)
      let from = m.id
      let to = target.id
      if (dM !== Infinity && dT !== Infinity && dM !== dT) {
        if (dM > dT) {
          from = target.id
          to = m.id
        }
      } else if (edge.relationType === MediaRelation.Prequel) {
        from = target.id
        to = m.id
      }
      const a = Math.min(from, to)
      const b = Math.max(from, to)
      const key = `${String(a)}-${String(b)}:${edge.relationType}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      // We always flip edges so source = older, target = newer. A PREQUEL
      // edge has been flipped, so from the source's POV the target IS the
      // sequel — relabel for visual consistency (no more "PREQUEL" labels).
      const displayRelation =
        edge.relationType === MediaRelation.Prequel ? MediaRelation.Sequel : edge.relationType
      edges.push({
        id: key,
        source: String(from),
        target: String(to),
        label: displayRelation,
        type: 'smoothstep',
        animated:
          edge.relationType === MediaRelation.Prequel || edge.relationType === MediaRelation.Sequel,
      })
    }
  }

  return { nodeData, edges, allBases }
}
