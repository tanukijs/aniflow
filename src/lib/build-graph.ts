import dagre, { type NodeConfig } from '@dagrejs/dagre'
import { type Edge, Position } from '@xyflow/react'

import {
  MediaFormat,
  type MediaListCollection,
  MediaRelation,
} from '../graphql'
import type {
  AnimeFlowNode,
  ExpandedMedia,
  Franchise,
  Visibility,
} from '../types'
import { NODE_HEIGHT, NODE_WIDTH } from './constants'
import { collectGraph } from './graph/collect'

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
  const collected = collectGraph(collection, extraMedia, seenIds, visibility)
  const { nodeData, allBases } = collected
  let { edges } = collected

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
    edges = edges.filter((e) => keptIds.has(Number(e.source)) && keptIds.has(Number(e.target)))
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
