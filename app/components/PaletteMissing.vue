<script setup>
defineProps({
  groups: {
    type: Array,
    required: true
  },
  count: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
})

const emit = defineEmits(['clear'])

function alsoIn(item, group) {
  return (item.classes || []).filter((className) => className !== group.class)
}
</script>

<template>
  <section class="palette-missing" aria-labelledby="missing-heading">
    <h2 id="missing-heading">
      Missing from the sprite
      <span class="palette-missing__count">{{ count }} of {{ total }}</span>
    </h2>

    <p class="palette-missing__intro">
      {{ total }} candidate icon names have no sprite entry. They are shown as
      dashed placeholders, not rendered icons, so a class or dot fallback
      applies when a feature selects one.
    </p>

    <div v-if="groups.length" class="palette-missing__groups">
      <section
        v-for="group in groups"
        :key="group.class"
        class="palette-missing__group"
      >
        <h3 class="palette-missing__class">
          {{ group.class }}
          <span>{{ group.items.length }}</span>
        </h3>

        <ul class="palette-missing__list">
          <li
            v-for="item in group.items"
            :key="item.name"
            class="palette-missing__item"
          >
            <span class="palette-missing__tile" aria-hidden="true">?</span>
            <span class="palette-missing__body">
              <span class="palette-missing__name">{{ item.name }}</span>
              <span v-if="alsoIn(item, group).length" class="palette-missing__also">
                also in {{ alsoIn(item, group).join(', ') }}
              </span>
            </span>
          </li>
        </ul>
      </section>
    </div>

    <div v-else class="palette-empty">
      <p>No missing names match the current filters.</p>
      <button type="button" class="secondary" @click="emit('clear')">
        Clear filters
      </button>
    </div>
  </section>
</template>
