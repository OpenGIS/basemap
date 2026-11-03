<script setup>
import iconTemplates from '~/assets/data/icons.json'
import { iconDataUri } from '~/utils/colour'
import PaletteIcon from '~/components/PaletteIcon.vue'

defineProps({
  group: {
    type: Object,
    required: true
  },
  colour: {
    type: String,
    required: true
  }
})
</script>

<template>
  <section class="palette-class">
    <header class="palette-class__head">
      <h4 class="palette-class__name">{{ group.name }}</h4>
      <span class="palette-class__badge" :class="`palette-class__badge--${group.provenance}`">
        {{ group.provenance }}
      </span>
      <span class="palette-class__count">
        {{ group.icons.length }} {{ group.icons.length === 1 ? 'icon' : 'icons' }}
      </span>
    </header>

    <details class="palette-class__meta">
      <summary>Mapping and layers</summary>
      <div class="palette-class__meta-body">
        <p>
          <strong>Mapping keys:</strong>
          {{ group.mappingKeys.length ? group.mappingKeys.join(', ') : 'None' }}
        </p>
        <p>
          <strong>Layers:</strong>
          {{ group.layers.length ? group.layers.join(', ') : 'None' }}
        </p>
      </div>
    </details>

    <ul class="palette-icon-grid">
      <PaletteIcon
        v-for="icon in group.icons"
        :key="icon.name"
        :icon="icon"
        :colour="colour"
        :src="iconDataUri(iconTemplates[icon.name], colour)"
      />
    </ul>
  </section>
</template>
