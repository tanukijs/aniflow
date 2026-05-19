import type { Edge } from '@xyflow/react'

import type { MediaListCollection } from '../graphql'
import type {
  AnimeFlowNode,
  ExpandedMedia,
  Franchise,
  Visibility,
} from '../types'
import { collectGraph } from './graph/collect'
import { computeFranchises } from './graph/franchises'
import { layoutNodes } from './graph/layout'

/**
 * Top-level graph orchestrator: walk the user's collection, group it into
 * franchises, lay each franchise out and return everything xyflow needs.
 */
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
  const nodes = layoutNodes(activeComponents, nodeData, edges)
  return { nodes, edges, franchises }
}
