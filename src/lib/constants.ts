import { MediaFormat, MediaListStatus, MediaRelation, MediaStatus } from '../graphql'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 124

export const ALL_RELATIONS = Object.values(MediaRelation)
export const ALL_FORMATS = Object.values(MediaFormat)
export const ALL_STATUSES = Object.values(MediaStatus)
export const ALL_LIST_STATUSES = Object.values(MediaListStatus)

export function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}
