import { gql } from 'graphql-request'

import type { FuzzyDate } from '../types'

export const endpoint = 'https://graphql.anilist.co'

export const query = gql`
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

// Used to fetch relations of anime that appear as a relation node but aren't
// in the user's completed list — without this we only see one hop out from
// what the user has watched.
export const pageQuery = gql`
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

export const dateOrder = (d?: FuzzyDate | null) => {
  if (!d?.year) return Number.POSITIVE_INFINITY
  return d.year * 10000 + (d.month ?? 1) * 100 + (d.day ?? 1)
}
