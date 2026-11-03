<script setup>
import { computed } from 'vue'

const props = defineProps({
  icon: {
    type: Object,
    required: true
  },
  src: {
    type: String,
    default: ''
  },
  colour: {
    type: String,
    default: ''
  }
})

const hasDistinctSubclass = computed(
  () => props.icon.subclass && props.icon.subclass !== props.icon.name
)

const displayName = computed(() => props.icon.name.replace(/_/g, '_\u200B'))

const title = computed(() => {
  const parts = [props.icon.name]
  if (props.icon.subclass) parts.push(`subclass: ${props.icon.subclass}`)
  if (props.icon.layers && props.icon.layers.length) {
    parts.push(`layers: ${props.icon.layers.join(', ')}`)
  }
  if (props.icon.fallback) parts.push(`${props.icon.fallback} fallback`)
  return parts.join(' · ')
})
</script>

<template>
  <li class="palette-icon" :style="{ '--icon-colour': colour }">
    <img
      class="palette-icon__image"
      :src="src"
      :title="title"
      alt=""
      width="36"
      height="36"
      loading="lazy"
    >

    <span class="palette-icon__body">
      <span class="palette-icon__name" :title="title">{{ displayName }}</span>
      <span v-if="hasDistinctSubclass" class="palette-icon__meta">
        {{ icon.subclass }}
      </span>
      <span v-if="icon.layers && icon.layers.length" class="palette-icon__meta">
        {{ icon.layers.join(', ') }}
      </span>
      <span v-if="icon.fallback" class="palette-icon__fallback">
        {{ icon.fallback }} fallback
      </span>
    </span>
  </li>
</template>
