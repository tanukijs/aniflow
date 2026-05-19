import { request } from 'graphql-request'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  MediaFormat,
  type MediaList,
  type MediaListCollection,
  MediaListStatus,
  MediaRelation,
  MediaStatus,
} from './graphql'
import { AnimeNode, CoverImage } from './components/AnimeNode'
import { ChipGroup, Section, SegmentedGroup } from './components/ui'
import { endpoint, query } from './lib/anilist'
import { buildGraph } from './lib/build-graph'
import {
  ALL_FORMATS,
  ALL_LIST_STATUSES,
  ALL_RELATIONS,
  ALL_STATUSES,
  toggle,
} from './lib/constants'
import { expandUnseenRelations } from './lib/expand'
import type { AnimeFlowNode, ExpandedMedia, Franchise, Visibility } from './types'


const nodeTypes = { anime: AnimeNode }

const cacheKeyFor = (username: string, status: MediaListStatus) => `items_v2:${username}:${status}`

export default function App() {
  const [username, setUsername] = useState(
    () => new URLSearchParams(window.location.search).get('username') ?? '',
  )
  const [listStatus, setListStatus] = useState<MediaListStatus>(MediaListStatus.Completed)
  const [hideCompleteFranchises, setHideCompleteFranchises] = useState(true)
  const [collection, setCollection] = useState<MediaListCollection | null>(null)
  const [extraMedia, setExtraMedia] = useState<Map<number, ExpandedMedia>>(
    () => new Map(),
  )
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

  const flowRef = useRef<ReactFlowInstance<AnimeFlowNode> | null>(null)

  const { nodes, edges, franchises } = useMemo<{
    nodes: AnimeFlowNode[]
    edges: Edge[]
    franchises: Franchise[]
  }>(() => {
    if (!collection) return { nodes: [], edges: [], franchises: [] }
    return buildGraph(collection, extraMedia, seenIds, visibility, hideCompleteFranchises)
  }, [collection, extraMedia, seenIds, visibility, hideCompleteFranchises])

  const focusNode = useCallback((id: string) => {
    const inst = flowRef.current
    if (!inst) return
    void inst.fitView({ nodes: [{ id }], maxZoom: 1.5, duration: 500, padding: 0.4 })
  }, [])

  useEffect(() => {
    if (!flowRef.current || nodes.length === 0) return
    // Defer so React Flow has applied the new nodes before fitting.
    const id = requestAnimationFrame(() => {
      void flowRef.current?.fitView({ maxZoom: 1.5, padding: 0.2, duration: 300 })
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
            onClick={() => void loadData(false)}
          >
            Load
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            disabled={loading}
            onClick={() => void loadData(true)}
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
                  : `Expansion : ${String(progress.done)} / ${String(progress.total)}`}
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
                  style={{ width: `${String((progress.done / progress.total) * 100)}%` }}
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
                    title={`${String(f.unseenCount)} non vu${f.unseenCount > 1 ? 's' : ''}`}
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
