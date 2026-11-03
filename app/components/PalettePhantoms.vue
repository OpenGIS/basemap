<script setup>
defineProps({
  phantoms: {
    type: Array,
    required: true
  }
})
</script>

<template>
  <details class="palette-phantoms">
    <summary>
      Filter literals that are not features
      <span class="palette-phantoms__count">{{ phantoms.length }}</span>
    </summary>

    <p class="palette-phantoms__intro">
      These style filter literals never resolve to a standalone feature, so
      they are not rendered icons. They are listed here so the filters stay
      understandable.
    </p>

    <ul class="palette-phantoms__list">
      <li v-for="phantom in phantoms" :key="phantom.name">
        <code>{{ phantom.name }}</code>
        <span>{{ phantom.text }}</span>
      </li>
    </ul>
  </details>
</template>
