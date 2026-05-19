import { Handle, type NodeProps, Position } from '@xyflow/react'
import { useState } from 'react'

import type { AnimeFlowNode } from '../types'

export function CoverImage({
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
          onLoad={() => {
            setLoaded(true)
          }}
          className={
            'h-full w-full object-cover transition duration-500 ' +
            (loaded ? 'scale-100 opacity-100 blur-0' : 'scale-110 opacity-0 blur-md')
          }
        />
      )}
    </div>
  )
}

export function AnimeNode({ data }: NodeProps<AnimeFlowNode>) {
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
