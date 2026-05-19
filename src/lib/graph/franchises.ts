import type { Edge } from '@xyflow/react'

import { MediaFormat, MediaRelation } from '../../graphql'
import type { AnimeNodeData, Franchise, MediaWithRelations } from '../../types'

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

export interface ComputedFranchises {
  /** Components kept after the hideCompleteFranchises filter. */
  activeComponents: number[][]
  /** Edges restricted to the kept components. May share identity with input. */
  edges: Edge[]
  /** One summary entry per kept component, alphabetized by base title. */
  franchises: Franchise[]
}

/**
 * Group nodes into connected components (= franchises), optionally drop the
 * ones the user has fully watched, and produce the sidebar summary list.
 *
 * Mutates `nodeData` when `hideCompleteFranchises` is true (deletes filtered
 * ids); the caller's reference will reflect the pruned set.
 */
export function computeFranchises(
  nodeData: Map<number, AnimeNodeData>,
  edges: Edge[],
  allBases: MediaWithRelations[],
  hideCompleteFranchises: boolean,
): ComputedFranchises {
  // Since collectGraph only added nodes reachable via visible relations, the
  // edges array is the authoritative adjacency.
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

  let activeComponents = components
  let activeEdges = edges
  if (hideCompleteFranchises) {
    activeComponents = components.filter((comp) =>
      comp.some((id) => nodeData.get(id)?.seen === false),
    )
    const keptIds = new Set<number>()
    for (const comp of activeComponents) for (const id of comp) keptIds.add(id)
    for (const id of [...nodeData.keys()]) {
      if (!keptIds.has(id)) nodeData.delete(id)
    }
    activeEdges = edges.filter(
      (e) => keptIds.has(Number(e.source)) && keptIds.has(Number(e.target)),
    )
  }

  // Direction of PREQUEL/SEQUEL edges tells us which nodes are "later in the
  // story" — those should never be picked as the franchise root.
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
      // Pick the canonical base: TV preferred (by format rank), then a node
      // that has no incoming PREQUEL/SEQUEL arrow, then alphabetical.
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

  return { activeComponents, edges: activeEdges, franchises }
}
