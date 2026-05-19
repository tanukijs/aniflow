import dagre, { type NodeConfig } from '@dagrejs/dagre'
import { type Edge, Position } from '@xyflow/react'

import type { MediaListCollection } from '../graphql'
import type {
  AnimeFlowNode,
  ExpandedMedia,
  Franchise,
  Visibility,
} from '../types'
import { NODE_HEIGHT, NODE_WIDTH } from './constants'
import { collectGraph } from './graph/collect'
import { computeFranchises } from './graph/franchises'

export function buildGraph(
  collection: MediaListCollection,
  extraMedia: Map<number, ExpandedMedia>,
  seenIds: Set<number>,
  visibility: Visibility,
  hideCompleteFranchises: boolean,
): { nodes: AnimeFlowNode[]; edges: Edge[]; franchises: Franchise[] } {
  const { nodeData, edges: rawEdges, allBases } = collectGraph(
    collection,
    extraMedia,
    seenIds,
    visibility,
  )
  const { activeComponents, edges, franchises } = computeFranchises(
    nodeData,
    rawEdges,
    allBases,
    hideCompleteFranchises,
  )

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

  return { nodes, edges, franchises }
}
