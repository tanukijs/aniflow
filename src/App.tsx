import dagre from '@dagrejs/dagre'
import { gql, request } from 'graphql-request'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  type MediaEdge,
  MediaFormat,
  type MediaList,
  type MediaListCollection,
  MediaListStatus,
  MediaRelation,
  MediaStatus,
} from './graphql'

interface Visibility {
  relation: MediaRelation[]
  format: MediaFormat[]
  status: MediaStatus[]
}

interface AnimeNodeData {
  title: string
  cover?: string
  coverColor?: string
  siteUrl?: string
  format?: MediaFormat | null
  status?: MediaStatus | null
  seen: boolean
}

const endpoint = 'https://graphql.anilist.co'

const query = gql`
  query ($username: String, $status: MediaListStatus) {
    MediaListCollection(userName: $username, type: ANIME, status: $status, sort: SCORE_DESC) {
      hasNextChunk
      user {
        id
      }
      lists {
        name
        isCustomList
        isSplitCompletedList
        status
        entries {
          media {
            id
            title {
              userPreferred
            }
            type
            status
            format
            siteUrl
            startDate {
              year
              month
              day
            }
            coverImage {
              medium
              color
            }
            relations {
              edges {
                relationType
                node {
                  id
                  title {
                    userPreferred
                  }
                  type
                  status
                  format
                  siteUrl
                  startDate {
                    year
                    month
                    day
                  }
                  coverImage {
                    medium
                    color
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

interface FuzzyDate { year?: number | null; month?: number | null; day?: number | null }

interface ExpandedMedia {
  id: number
  title?: { userPreferred?: string | null } | null
  status?: MediaStatus | null
  format?: MediaFormat | null
  siteUrl?: string | null
  startDate?: FuzzyDate | null
  coverImage?: { medium?: string | null; color?: string | null } | null
  relations?: { edges?: (MediaEdge | null)[] | null } | null
}

const dateOrder = (d?: FuzzyDate | null) => {
  if (!d?.year) return Number.POSITIVE_INFINITY
  return d.year * 10000 + (d.month ?? 1) * 100 + (d.day ?? 1)
}

// Used to fetch relations of anime that appear as a relation node but aren't
// in the user's completed list — without this we only see one hop out from
// what the user has watched.
const pageQuery = gql`
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) {
        id
        title {
          userPreferred
        }
        status
        format
        siteUrl
        startDate {
          year
          month
          day
        }
        coverImage {
          medium
          color
        }
        relations {
          edges {
            relationType
            node {
              id
              title {
                userPreferred
              }
              type
              status
              format
              siteUrl
              startDate {
                year
                month
                day
              }
              coverImage {
                medium
                color
              }
            }
          }
        }
      }
    }
  }
`

interface ExpansionProgress {
  extras: Map<number, ExpandedMedia>
  done: number
  total: number
}

async function expandUnseenRelations(
  collection: MediaListCollection,
  seenIds: Set<number>,
  visibility: Visibility,
  onProgress: (state: ExpansionProgress) => void,
  maxIterations = 4,
): Promise<Map<number, ExpandedMedia>> {
  const extras = new Map<number, ExpandedMedia>()
  const queued = new Set<number>()
  let frontier: number[] = []

  // Only follow relations the user explicitly enabled, and only fetch targets
  // whose format/status the user wants to see. Shallow relation nodes carry
  // enough metadata (format/status) for us to gate here before fetching.
  // Strict matching: relation, format AND status must all be in the user's
  // selection. Anime with a missing/unknown format or status are rejected so
  // expansion never fetches anything the display would hide anyway.
  const acceptEdge = (edge: MediaEdge | null | undefined) => {
    if (!edge?.node || !edge.relationType) return false
    if (!visibility.relation.includes(edge.relationType)) return false
    const n = edge.node
    if (!n.format || !visibility.format.includes(n.format)) return false
    if (!n.status || !visibility.status.includes(n.status)) return false
    return true
  }

  const queueFromEdge = (edge: MediaEdge | null | undefined) => {
    if (!acceptEdge(edge)) return
    const id = edge!.node!.id
    if (seenIds.has(id) || queued.has(id)) return
    queued.add(id)
    frontier.push(id)
  }

  for (const list of collection.lists ?? []) {
    for (const entry of (list?.entries ?? []) as MediaList[]) {
      for (const edge of entry.media?.relations?.edges ?? []) {
        queueFromEdge(edge)
      }
    }
  }

  const report = () =>
    { onProgress({ extras: new Map(extras), done: extras.size, total: queued.size }); }

  report()

  for (let iter = 0; iter < maxIterations && frontier.length > 0; iter++) {
    const next: number[] = []
    for (let i = 0; i < frontier.length; i += 50) {
      const batch = frontier.slice(i, i + 50)
      let res: { Page: { media: ExpandedMedia[] | null } } | null = null
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
      for (const m of res.Page.media ?? []) {
        extras.set(m.id, m)
        for (const edge of m.relations?.edges ?? []) {
          if (!acceptEdge(edge)) continue
          const id = edge!.node!.id
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

const NODE_WIDTH = 240
const NODE_HEIGHT = 124

const ALL_RELATIONS = Object.values(MediaRelation)
const ALL_FORMATS = Object.values(MediaFormat)
const ALL_STATUSES = Object.values(MediaStatus)
const ALL_LIST_STATUSES = Object.values(MediaListStatus)

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

function AnimeNode({ data }: NodeProps<AnimeNodeData>) {
  return (
    <div
      className={`flex h-[124px] w-[240px] overflow-hidden rounded-md border bg-white shadow-sm transition-shadow hover:shadow-md ${
        data.seen ? 'border-slate-200' : 'border-rose-400 ring-1 ring-rose-100'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <CoverImage
        cover={data.cover}
        color={data.coverColor}
        className="aspect-[2/3] h-full flex-shrink-0"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <a
          href={data.siteUrl ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-3 break-words text-xs font-semibold leading-tight text-slate-800 hover:text-blue-600 hover:underline"
          title={data.title}
        >
          {data.title}
        </a>
        <div className="mt-auto flex flex-wrap gap-1 text-[10px] font-medium">
          {!data.seen && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-white">Pas vu</span>
          )}
          {data.format && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {data.format}
            </span>
          )}
          {data.status && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-600">
              {data.status}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
    </div>
  )
}

function CoverImage({
  cover,
  color,
  className = '',
}: {
  cover?: string
  color?: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${className}`}
      style={color ? { backgroundColor: color } : undefined}
    >
      {cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => { setLoaded(true); }}
          className={
            'h-full w-full object-cover transition duration-500 ' +
            (loaded ? 'scale-100 opacity-100 blur-0' : 'scale-110 opacity-0 blur-md')
          }
        />
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

function ChipGroup<T extends string>({
  values,
  selected,
  onToggle,
}: {
  values: T[]
  selected: T[]
  onToggle: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => {
        const isOn = selected.includes(v)
        return (
          <button
            key={v}
            type="button"
            onClick={() => { onToggle(v); }}
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ' +
              (isOn
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
            }
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

function SegmentedGroup<T extends string>({
  values,
  selected,
  onChange,
}: {
  values: T[]
  selected: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => { onChange(v); }}
          className={
            'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ' +
            (selected === v
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
          }
        >
          {v}
        </button>
      ))}
    </div>
  )
}

const nodeTypes = { anime: AnimeNode }

interface MediaWithRelations {
  id: number
  title?: { userPreferred?: string | null } | null
  coverImage?: { medium?: string | null; color?: string | null } | null
  siteUrl?: string | null
  format?: MediaFormat | null
  status?: MediaStatus | null
  startDate?: FuzzyDate | null
  relations?: { edges?: (MediaEdge | null)[] | null } | null
}

interface Franchise {
  baseId: string
  title: string
  cover?: string
  coverColor?: string
  unseenCount: number
  hasUnseen: boolean
}

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

function buildGraph(
  collection: MediaListCollection,
  extraMedia: Map<number, ExpandedMedia>,
  seenIds: Set<number>,
  visibility: Visibility,
  hideCompleteFranchises: boolean,
): { nodes: Node<AnimeNodeData>[]; edges: Edge[]; franchises: Franchise[] } {
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
      title: m.title?.userPreferred ?? `#${m.id}`,
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
    const id = queue.shift()!
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
      const key = `${a}-${b}:${edge.relationType}`
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
    adj.get(Number(e.source))!.add(Number(e.target))
    adj.get(Number(e.target))!.add(Number(e.source))
  }

  const visited = new Set<number>()
  const components: number[][] = []
  for (const id of nodeData.keys()) {
    if (visited.has(id)) continue
    const comp: number[] = []
    const queue = [id]
    visited.add(id)
    while (queue.length) {
      const cur = queue.shift()!
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
    activeComponents = components.filter((comp) => comp.some((id) => !nodeData.get(id)!.seen))
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
    dagre.layout(cg)

    // Use dagre's natural layout within the franchise: a linear chain stays
    // on a single row, branches create extra rows. Then shift the whole
    // franchise down so it sits below the previous one without overlap.
    let minY = Infinity
    let maxY = -Infinity
    for (const id of comp) {
      const n = cg.node(String(id))
      if (n.y - NODE_HEIGHT / 2 < minY) minY = n.y - NODE_HEIGHT / 2
      if (n.y + NODE_HEIGHT / 2 > maxY) maxY = n.y + NODE_HEIGHT / 2
    }
    const offsetY = cursorY - minY
    for (const id of comp) {
      const n = cg.node(String(id))
      nodePositions.set(id, {
        x: n.x - NODE_WIDTH / 2,
        y: n.y - NODE_HEIGHT / 2 + offsetY,
      })
    }
    cursorY += maxY - minY + componentGap
  }

  const nodes: Node<AnimeNodeData>[] = []
  for (const [id, data] of nodeData) {
    nodes.push({
      id: String(id),
      type: 'anime',
      position: nodePositions.get(id)!,
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
        const da = nodeData.get(a)!
        const db = nodeData.get(b)!
        const fa = rankFormat(da.format)
        const fb = rankFormat(db.format)
        if (fa !== fb) return fa - fb
        const ra = chronoIncoming.has(a) ? 1 : 0
        const rb = chronoIncoming.has(b) ? 1 : 0
        if (ra !== rb) return ra - rb
        return da.title.localeCompare(db.title)
      })[0]
      const base = nodeData.get(baseId)!
      const unseenCount = comp.reduce((n, id) => n + (nodeData.get(id)!.seen ? 0 : 1), 0)
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

const cacheKeyFor = (username: string, status: MediaListStatus) => `items_v2:${username}:${status}`

export default function App() {
  const [username, setUsername] = useState(
    () => new URLSearchParams(window.location.search).get('username') ?? '',
  )
  const [listStatus, setListStatus] = useState<MediaListStatus>(MediaListStatus.Completed)
  const [hideCompleteFranchises, setHideCompleteFranchises] = useState(true)
  const [collection, setCollection] = useState<MediaListCollection | null>(null)
  const [extraMedia, setExtraMedia] = useState<Map<number, ExpandedMedia>>(new Map())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [visibility, setVisibility] = useState<Visibility>({
    relation: [MediaRelation.Prequel, MediaRelation.Sequel],
    format: [
      MediaFormat.Tv,
      MediaFormat.Movie,
      MediaFormat.Ova,
      MediaFormat.Ona,
      MediaFormat.Special,
      MediaFormat.TvShort,
    ],
    status: [MediaStatus.Finished, MediaStatus.Releasing],
  })

  const loadData = useCallback(
    async (force: boolean) => {
      const cacheKey = cacheKeyFor(username, listStatus)
      if (!force) {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached) as {
            collection: MediaListCollection
            extras: [number, ExpandedMedia][]
          }
          setCollection(parsed.collection)
          setExtraMedia(new Map(parsed.extras))
          return
        }
      }

      setLoading(true)
      setProgress({ done: 0, total: 0 })
      setExtraMedia(new Map())
      try {
        const res = await request<{ MediaListCollection: MediaListCollection }>({
          url: endpoint,
          document: query,
          variables: { username, status: listStatus },
        })
        const fresh = res.MediaListCollection
        setCollection(fresh)

        const sids = new Set<number>()
        for (const list of fresh.lists ?? []) {
          for (const entry of (list?.entries ?? []) as MediaList[]) {
            if (entry.media?.id !== undefined) sids.add(entry.media.id)
          }
        }

        const writeCache = (extras: Map<number, ExpandedMedia>) => {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({ collection: fresh, extras: Array.from(extras) }),
          )
        }

        writeCache(new Map())
        await expandUnseenRelations(fresh, sids, visibility, ({ extras, done, total }) => {
          setExtraMedia(extras)
          setProgress({ done, total })
          writeCache(extras)
        })
      } finally {
        setLoading(false)
      }
    },
    [username, listStatus, visibility],
  )

  const seenIds = useMemo(() => {
    const ids = new Set<number>()
    for (const list of collection?.lists ?? []) {
      for (const entry of (list?.entries ?? []) as MediaList[]) {
        if (entry.media?.id !== undefined) ids.add(entry.media.id)
      }
    }
    return ids
  }, [collection])

  const flowRef = useRef<ReactFlowInstance | null>(null)

  const { nodes, edges, franchises } = useMemo(() => {
    if (!collection) return { nodes: [], edges: [], franchises: [] as Franchise[] }
    return buildGraph(collection, extraMedia, seenIds, visibility, hideCompleteFranchises)
  }, [collection, extraMedia, seenIds, visibility, hideCompleteFranchises])

  const focusNode = useCallback((id: string) => {
    const inst = flowRef.current
    if (!inst) return
    inst.fitView({ nodes: [{ id }], maxZoom: 1.5, duration: 500, padding: 0.4 })
  }, [])

  useEffect(() => {
    if (!flowRef.current || nodes.length === 0) return
    // Defer so React Flow has applied the new nodes before fitting.
    const id = requestAnimationFrame(() => {
      flowRef.current?.fitView({ maxZoom: 1.5, padding: 0.2, duration: 300 })
    })
    return () => { cancelAnimationFrame(id); }
  }, [nodes])

  return (
    <main className="flex h-dvh bg-slate-100 text-slate-800">
      <aside className="flex w-full max-w-80 flex-col gap-5 overflow-auto border-r border-slate-200 bg-white p-4">
        <header className="space-y-1">
          <h1 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            AniList graph
          </h1>
          <p className="text-xs text-slate-400">Chronologie des séquelles dans ta liste.</p>
        </header>

        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            disabled={loading}
            onClick={() => loadData(false)}
          >
            Load
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={loading}
            onClick={() => loadData(true)}
            title="Forcer le rechargement (ignore le cache local)"
          >
            Force
          </button>
        </div>

        {loading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>
                {progress.total === 0
                  ? 'Chargement de la collection…'
                  : `Expansion : ${progress.done} / ${progress.total}`}
              </span>
              {progress.total > 0 && (
                <span className="tabular-nums">
                  {Math.round((progress.done / progress.total) * 100)}%
                </span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              {progress.total === 0 ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
              ) : (
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              )}
            </div>
          </div>
        )}

        <Section title="Username">
          <input
            type="text"
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={username}
            onChange={(e) => { setUsername(e.target.value); }}
            placeholder="ex: username"
          />
        </Section>

        <Section title="Liste">
          <SegmentedGroup
            values={ALL_LIST_STATUSES}
            selected={listStatus}
            onChange={setListStatus}
          />
        </Section>

        <Section title="Relation">
          <ChipGroup
            values={ALL_RELATIONS}
            selected={visibility.relation}
            onToggle={(r) => { setVisibility((v) => ({ ...v, relation: toggle(v.relation, r) })); }}
          />
        </Section>

        <Section title="Format">
          <ChipGroup
            values={ALL_FORMATS}
            selected={visibility.format}
            onToggle={(f) => { setVisibility((v) => ({ ...v, format: toggle(v.format, f) })); }}
          />
        </Section>

        <Section title="Status">
          <ChipGroup
            values={ALL_STATUSES}
            selected={visibility.status}
            onToggle={(s) => { setVisibility((v) => ({ ...v, status: toggle(v.status, s) })); }}
          />
        </Section>

        <Section title="Affichage">
          <button
            type="button"
            onClick={() => { setHideCompleteFranchises((v) => !v); }}
            className={
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ' +
              (hideCompleteFranchises
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
            }
          >
            Masquer les franchises complètes
          </button>
        </Section>
      </aside>

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            flowRef.current = instance
          }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color="#cbd5e1" gap={20} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      <aside className="flex w-72 flex-col gap-2 overflow-hidden border-l border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Franchises
          </h2>
          <p className="text-xs text-slate-400">
            {franchises.length} franchise{franchises.length > 1 ? 's' : ''}
          </p>
        </header>
        <ul className="flex-1 overflow-auto">
          {franchises.map((f) => (
            <li key={f.baseId}>
              <button
                type="button"
                onClick={() => { focusNode(f.baseId); }}
                className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-2 text-left text-xs hover:bg-slate-50"
              >
                <CoverImage
                  cover={f.cover}
                  color={f.coverColor}
                  className="aspect-[2/3] h-10 flex-shrink-0 rounded"
                />
                <span
                  className={`min-w-0 flex-1 break-words leading-tight ${
                    f.hasUnseen ? 'font-semibold text-rose-600' : 'text-slate-700'
                  }`}
                >
                  {f.title}
                </span>
                {f.unseenCount > 0 && (
                  <span
                    className="flex-shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
                    title={`${f.unseenCount} non vu${f.unseenCount > 1 ? 's' : ''}`}
                  >
                    {f.unseenCount}
                  </span>
                )}
              </button>
            </li>
          ))}
          {franchises.length === 0 && (
            <li className="px-4 py-3 text-xs text-slate-400">Aucun anime chargé.</li>
          )}
        </ul>
      </aside>
    </main>
  )
}
