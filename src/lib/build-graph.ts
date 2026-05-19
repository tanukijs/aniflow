import dagre, { type NodeConfig } from '@dagrejs/dagre'
import { type Edge, Position } from '@xyflow/react'

import {
  type MediaEdge,
  MediaFormat,
  type MediaList,
  type MediaListCollection,
  MediaRelation,
  type MediaStatus,
} from '../graphql'
import type {
  AnimeFlowNode,
  AnimeNodeData,
  ExpandedMedia,
  Franchise,
  FuzzyDate,
  MediaWithRelations,
  Visibility,
} from '../types'
import { dateOrder } from './anilist'
import { NODE_HEIGHT, NODE_WIDTH } from './constants'

// Rank used to pick the canonical "base" anime of a franchise. TV series are
// considered the main entry; movies/OVAs/specials are derivatives.
const FORMAT_BASE_RANK: Partial<Record<MediaFormat, number>> = {
  [MediaFormat.Tv]: 0,
  [MediaFormat.TvShort]: 0,
  [MediaFormat.Movie]: 1,
  [MediaFormat.Ona]: 2,
  [MediaFormat.Ova]: 3,
  [MediaFormat.Special]: 4,
  [MediaFormat.Music]: 5,
}
const rankFormat = (f?: MediaFormat | null) => (f ? (FORMAT_BASE_RANK[f] ?? 99) : 99)

export function buildGraph(
  collection: MediaListCollection,
  extraMedia: Map<number, ExpandedMedia>,
  seenIds: Set<number>,
  visibility: Visibility,
  hideCompleteFranchises: boolean,
): { nodes: AnimeFlowNode[]; edges: Edge[]; franchises: Franchise[] } {
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
        animated:
          edge.relationType === MediaRelation.Prequel || edge.relationType === MediaRelation.Sequel,
      })
    }
  }

  // Group nodes by connected component (= franchise). Since the BFS above
  // only added nodes reachable via the user's visible relations, the visible
  // `edges` set is also the authoritative adjacency.
  const adj = new Map<number, Set<number>>()
  for (const id of nodeData.keys()) adj.set(id, new Set())
  for (const e of edges) {
    const src = Number(e.source)
    const tgt = Number(e.target)
    adj.get(src)?.add(tgt)
    adj.get(tgt)?.add(src)
  }

  const visited = new Set<number>()
  const components: number[][] = []
  for (const id of nodeData.keys()) {
    if (visited.has(id)) continue
    const comp: number[] = []
    const queue = [id]
    visited.add(id)
    while (queue.length) {
      const cur = queue.shift()
      if (cur === undefined) break
      comp.push(cur)
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }
    components.push(comp)
  }
  // Largest franchises first — bigger chains are visually the most useful at
  // the top, standalone animes get pushed to the bottom.
  components.sort((a, b) => b.length - a.length)

  // Drop franchises where every visible node is already seen — the user opted
  // in to declutter "completed" chains given their current filters.
  let activeComponents = components
  if (hideCompleteFranchises) {
    activeComponents = components.filter((comp) =>
      comp.some((id) => nodeData.get(id)?.seen === false),
    )
    const keptIds = new Set<number>()
    for (const comp of activeComponents) for (const id of comp) keptIds.add(id)
    for (const id of [...nodeData.keys()]) {
      if (!keptIds.has(id)) nodeData.delete(id)
    }
    const kept = edges.filter((e) => keptIds.has(Number(e.source)) && keptIds.has(Number(e.target)))
    edges.length = 0
    edges.push(...kept)
  }

  // Inter-franchise gap (in pixels) — empty vertical space between two
  // independent franchises so their rows never touch.
  const componentGap = NODE_HEIGHT + 16
  const nodePositions = new Map<number, { x: number; y: number }>()

  // After dagre.layout() each node is annotated with x/y; before layout only
  // width/height are set, hence both are optional in the read-side type.
  interface DagreNode extends NodeConfig {
    x?: number
    y?: number
  }

  let cursorY = 0
  for (const comp of activeComponents) {
    const cg = new dagre.graphlib.Graph()
    cg.setDefaultEdgeLabel(() => ({}))
    // nodesep = vertical gap between two nodes that share a rank/column inside
    // a franchise (when there are branches like multiple sequels).
    cg.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80 })
    const inComp = new Set(comp)
    for (const id of comp) {
      cg.setNode(String(id), { width: NODE_WIDTH, height: NODE_HEIGHT })
    }
    // Layout reflects only what's drawn — visible edges, restricted to the
    // current component.
    for (const e of edges) {
      const s = Number(e.source)
      const t = Number(e.target)
      if (inComp.has(s) && inComp.has(t)) cg.setEdge(String(s), String(t))
    }
    // dagre.layout's parameter is typed as graphlib.Graph with default
    // generics, which typescript-eslint flags as unsafe regardless of how cg
    // is typed; the runtime contract is the standard dagre handshake.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    dagre.layout(cg)

    // Use dagre's natural layout within the franchise: a linear chain stays
    // on a single row, branches create extra rows. Then shift the whole
    // franchise down so it sits below the previous one without overlap.
    let minY = Infinity
    let maxY = -Infinity
    for (const id of comp) {
      const n = cg.node(String(id)) as DagreNode
      if (n.y === undefined) continue
      if (n.y - NODE_HEIGHT / 2 < minY) minY = n.y - NODE_HEIGHT / 2
      if (n.y + NODE_HEIGHT / 2 > maxY) maxY = n.y + NODE_HEIGHT / 2
    }
    const offsetY = cursorY - minY
    for (const id of comp) {
      const n = cg.node(String(id)) as DagreNode
      if (n.x === undefined || n.y === undefined) continue
      nodePositions.set(id, {
        x: n.x - NODE_WIDTH / 2,
        y: n.y - NODE_HEIGHT / 2 + offsetY,
      })
    }
    cursorY += maxY - minY + componentGap
  }

  const nodes: AnimeFlowNode[] = []
  for (const [id, data] of nodeData) {
    const position = nodePositions.get(id)
    if (!position) continue
    nodes.push({
      id: String(id),
      type: 'anime',
      position,
      data,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
  }

  // smoothstep routes orthogonally and is far less likely to slice through
  // unrelated node boxes than the default bezier curve.
  for (const e of edges) {
    e.type = 'smoothstep'
  }

  // Per-franchise summary for the right-side list: one entry per component,
  // representing the "canonical" base anime (TV preferred, then chronological
  // root, then alphabetical). hasUnseen is true if any member is unseen, so
  // a viewed Ajin with unseen Ajin OVA still shows red.
  const chronoIncoming = new Set<number>()
  for (const m of allBases) {
    if (!nodeData.has(m.id)) continue
    for (const edge of m.relations?.edges ?? []) {
      if (!edge?.node || !edge.relationType) continue
      if (!nodeData.has(edge.node.id)) continue
      if (edge.relationType === MediaRelation.Prequel) chronoIncoming.add(m.id)
      else if (edge.relationType === MediaRelation.Sequel) chronoIncoming.add(edge.node.id)
    }
  }
  const franchises: Franchise[] = activeComponents
    .map((comp) => {
      const baseId = comp.slice().sort((a, b) => {
        const da = nodeData.get(a)
        const db = nodeData.get(b)
        if (!da || !db) return 0
        const fa = rankFormat(da.format)
        const fb = rankFormat(db.format)
        if (fa !== fb) return fa - fb
        const ra = chronoIncoming.has(a) ? 1 : 0
        const rb = chronoIncoming.has(b) ? 1 : 0
        if (ra !== rb) return ra - rb
        return da.title.localeCompare(db.title)
      })[0]
      const base = nodeData.get(baseId)
      if (!base) throw new Error(`nodeData missing entry for ${String(baseId)}`)
      const unseenCount = comp.reduce(
        (n, id) => n + (nodeData.get(id)?.seen === false ? 1 : 0),
        0,
      )
      return {
        baseId: String(baseId),
        title: base.title,
        cover: base.cover,
        coverColor: base.coverColor,
        unseenCount,
        hasUnseen: unseenCount > 0,
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))

  return { nodes, edges, franchises }
}
