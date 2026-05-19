import type { Node } from '@xyflow/react'

import type {
  MediaEdge,
  MediaFormat,
  MediaRelation,
  MediaStatus,
} from './graphql'

export interface Visibility {
  relation: MediaRelation[]
  format: MediaFormat[]
  status: MediaStatus[]
}

export type AnimeNodeData = {
  title: string
  cover?: string
  coverColor?: string
  siteUrl?: string
  format?: MediaFormat | null
  status?: MediaStatus | null
  seen: boolean
} & Record<string, unknown>

export type AnimeFlowNode = Node<AnimeNodeData, 'anime'>

export interface FuzzyDate {
  year?: number | null
  month?: number | null
  day?: number | null
}

export interface ExpandedMedia {
  id: number
  title?: { userPreferred?: string | null } | null
  status?: MediaStatus | null
  format?: MediaFormat | null
  siteUrl?: string | null
  startDate?: FuzzyDate | null
  coverImage?: { medium?: string | null; color?: string | null } | null
  relations?: { edges?: (MediaEdge | null)[] | null } | null
}

export interface MediaWithRelations {
  id: number
  title?: { userPreferred?: string | null } | null
  coverImage?: { medium?: string | null; color?: string | null } | null
  siteUrl?: string | null
  format?: MediaFormat | null
  status?: MediaStatus | null
  startDate?: FuzzyDate | null
  relations?: { edges?: (MediaEdge | null)[] | null } | null
}

export interface Franchise {
  baseId: string
  title: string
  cover?: string
  coverColor?: string
  unseenCount: number
  hasUnseen: boolean
}
