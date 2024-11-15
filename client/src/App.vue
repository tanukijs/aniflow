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
            type
            status
            format
            siteUrl
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

    <section>
      <fieldset>
        <legend>Relation</legend>
        <div class="flex flex-wrap gap-2">
          <div v-for="relation in MediaRelation" class="flex-shrink-0">
            <input type="checkbox" name="relation" :id="'relation_' + relation" v-model="visibility.relation" :value="relation">
            <label :for="'relation_' + relation">{{ relation }}</label>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Format</legend>
        <div class="flex flex-wrap gap-2">
          <div v-for="format in MediaFormat" class="flex-shrink-0">
            <input type="checkbox" name="format" :id="'format_' + format" v-model="visibility.format" :value="format">
            <label :for="'format_' + format">{{ format }}</label>
          </div>
        </div>
      </fieldset>
      
      <fieldset>
        <legend>Status</legend>
        <div class="flex flex-wrap gap-2">
          <div v-for="status in MediaStatus" class="flex-shrink-0">
            <input type="checkbox" name="status" :id="'status_' + status" v-model="visibility.status" :value="status">
            <label :for="'status_' + status">{{ status }}</label>
          </div>
        </div>
      </fieldset>
    </section>

    <template v-if="mediaListCollection">
      <section v-for="list in mediaListCollection.lists" class="p-4">
        <h2>{{ list!.name }}</h2>

        <section class="space-y-4">
          <section v-for="entry in list!.entries">
            <div class="p-2 bg-gray-300">
              <a
                class="font-medium text-blue-500 hover:underline"
                :href="entry?.media?.title?.userPreferred!"
                target="_blank"
              >{{ entry!.media!.title!.userPreferred }} ({{ seenIds.includes(entry!.media!.id) ? 'VIEWED' : 'NOT VIEWED' }})
              </a>
            </div>
            <section>
              <div
                v-for="edge in entry!.media!.relations!.edges"
                class="space-x-2"
                :class="{'hidden': !isVisible(edge!) }">
                <span v-if="!seenIds.includes(edge?.node?.id!)" class="px-2 text-sm font-medium text-white bg-red-500 rounded-full">Pas vu</span>
                <span>{{ edge!.relationType }}</span>
                <a class="font-medium text-blue-500" :href="edge?.node?.siteUrl!" target="_blank">{{ edge!.node!.title!.userPreferred }}</a>
                <span>{{ edge!.node!.type }}</span>
                <span>{{ edge!.node!.status }}</span>
                <span>{{ edge!.node!.format }}</span>
              </div>
            </section>
          </section>
        </section>
      </section>
    </template>
  </main>
</template>
