<script setup lang="ts">
import { gql, request } from 'graphql-request'
import { reactive, ref } from 'vue'
import { type MediaEdge, MediaFormat, type MediaListCollection, MediaRelation, MediaStatus } from './graphql'

const visibility = reactive({
  relation: [MediaRelation.Prequel, MediaRelation.Sequel],
  format: [MediaFormat.Tv, MediaFormat.Movie, MediaFormat.Ova, MediaFormat.Ona, MediaFormat.Special, MediaFormat.TvShort],
  status: [MediaStatus.Finished, MediaStatus.Releasing]
})

const endpoint = 'https://graphql.anilist.co'
const query = gql`
  query ($username: String) {
    MediaListCollection(userName: $username, type: ANIME, status: COMPLETED) {
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
                }
              }
            }
          }
        }
      }
    }
  }
`

const mediaListCollection = ref<MediaListCollection>()
const seenIds = ref<number[]>([])

const variables = {
  username: 'Quanhuo'
}

function isVisible (edge: MediaEdge) {
  return visibility.relation.includes(edge!.relationType!)
    && visibility.format.includes(edge!.node!.format!)
    && visibility.status.includes(edge!.node!.status!)
}

async function getData () : Promise<MediaListCollection> {
  const backup = localStorage.getItem('items')
  if (backup !== null) {
    return JSON.parse(backup)
  }

  const req = await request({
    url: endpoint,
    document: query,
    variables: variables,
  })

  const data = {...(req as any).MediaListCollection}
  localStorage.setItem('items', JSON.stringify(data))
  return data
}

async function loadData () {
  const data = await getData()
  console.log(data)
  mediaListCollection.value = data
  const _seenIds = <number[]>[]
  for (const list of data.lists!) {
    for (const entry of list!.entries!) {
      _seenIds.push(entry!.media!.id)
    }
  }
  seenIds.value = _seenIds
}
</script>

<template>
  <main>
    <button @click="loadData">Load</button>
    <template v-if="mediaListCollection">
      <section v-for="list in mediaListCollection.lists">
        <table>
          <thead>
            <tr>
              <th>{{ list!.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in list!.entries">
              <td>
                <table>
                  <thead>
                    <tr>
                      <th>{{ entry!.media!.title!.userPreferred }} ({{ seenIds.includes(entry!.media!.id) ? 'VIEWED' : 'NOT VIEWED' }})</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="edge in entry!.media!.relations!.edges"
                      :class="{'hidden': !isVisible(edge!) }">
                      <td>{{ seenIds.includes(edge!.node!.id) ? 'VIEWED' : 'NOT VIEWED' }}</td>
                      <td>{{ edge!.relationType }}</td>
                      <td>{{ edge!.node!.title!.userPreferred }}</td>
                      <td>{{ edge!.node!.type }}</td>
                      <td>{{ edge!.node!.status }}</td>
                      <td>{{ edge!.node!.format }}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </main>
</template>
