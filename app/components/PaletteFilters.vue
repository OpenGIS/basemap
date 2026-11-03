<script setup>
const props = defineProps({
  filters: {
    type: Object,
    required: true
  },
  roleOptions: {
    type: Array,
    required: true
  },
  layerOptions: {
    type: Array,
    required: true
  },
  classOptions: {
    type: Array,
    required: true
  },
  counts: {
    type: Object,
    required: true
  }
})

const emit = defineEmits([
  'update:search',
  'update:provenance',
  'update:layer',
  'update:className',
  'update:status',
  'toggle-role',
  'select-all-roles',
  'select-no-roles',
  'clear'
])

const statuses = [
  { value: 'all', label: 'All' },
  { value: 'existing', label: 'Existing' },
  { value: 'missing', label: 'Missing' }
]

const roleFiltersDisabled = () => props.filters.status === 'missing'
</script>

<template>
  <section class="palette-filters" aria-labelledby="filters-heading">
    <div class="palette-filters__head">
      <h2 id="filters-heading">Browse icons</h2>
      <button type="button" class="secondary palette-filters__clear" @click="emit('clear')">
        Clear filters
      </button>
    </div>

    <div class="palette-filters__grid">
      <div class="palette-filters__field palette-filters__field--search">
        <label for="palette-search">Search</label>
        <input
          id="palette-search"
          type="search"
          :value="filters.search"
          placeholder="Roles, classes, icons, layers"
          @input="emit('update:search', $event.target.value)"
        >
      </div>

      <div class="palette-filters__field">
        <label for="palette-provenance">Provenance</label>
        <select
          id="palette-provenance"
          :value="filters.provenance"
          @change="emit('update:provenance', $event.target.value)"
        >
          <option value="all">All</option>
          <option value="schema">Schema</option>
          <option value="runtime">Runtime</option>
          <option value="dynamic">Dynamic</option>
        </select>
      </div>

      <div class="palette-filters__field">
        <label for="palette-layer">Layer</label>
        <select
          id="palette-layer"
          :value="filters.layer"
          @change="emit('update:layer', $event.target.value)"
        >
          <option value="all">All</option>
          <option v-for="layer in layerOptions" :key="layer" :value="layer">
            {{ layer }}
          </option>
        </select>
      </div>

      <div class="palette-filters__field">
        <label for="palette-class">Class</label>
        <select
          id="palette-class"
          :value="filters.className"
          @change="emit('update:className', $event.target.value)"
        >
          <option value="all">All</option>
          <option v-for="className in classOptions" :key="className" :value="className">
            {{ className }}
          </option>
        </select>
      </div>

      <div class="palette-filters__field palette-filters__field--status">
        <span class="palette-filters__legend">Status</span>
        <div class="palette-status" role="group" aria-label="Icon status">
          <button
            v-for="status in statuses"
            :key="status.value"
            type="button"
            :aria-pressed="filters.status === status.value ? 'true' : 'false'"
            @click="emit('update:status', status.value)"
          >
            {{ status.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="palette-filters__roles">
      <div class="palette-filters__roles-head">
        <span class="palette-filters__legend">Role</span>
        <span class="palette-filters__role-actions">
          <button
            type="button"
            class="palette-filters__link"
            :disabled="roleFiltersDisabled()"
            @click="emit('select-all-roles')"
          >
            All
          </button>
          <button
            type="button"
            class="palette-filters__link"
            :disabled="roleFiltersDisabled()"
            @click="emit('select-no-roles')"
          >
            None
          </button>
        </span>
      </div>

      <p v-if="roleFiltersDisabled()" class="palette-filters__note">
        Role colours apply to existing icons, so the role filter is off while
        missing names are shown.
      </p>

      <ul class="palette-filters__role-list">
        <li v-for="role in roleOptions" :key="role.id">
          <label
            class="palette-role-chip"
            :class="{ 'is-disabled': roleFiltersDisabled() }"
            :style="{ '--chip-colour': role.color }"
          >
            <input
              type="checkbox"
              :checked="filters.roles.includes(role.id)"
              :disabled="roleFiltersDisabled()"
              @change="emit('toggle-role', role.id)"
            >
            <span class="palette-role-chip__box" aria-hidden="true"></span>
            <span class="palette-role-chip__dot" aria-hidden="true"></span>
            <span class="palette-role-chip__label">{{ role.label }}</span>
          </label>
        </li>
      </ul>
    </div>

    <p class="palette-filters__counts" aria-live="polite">
      <template v-if="filters.status !== 'missing'">
        <span class="palette-filters__counts-item">
          Showing {{ counts.existingCount }} of {{ counts.existingTotal }} icons
        </span>
        <span class="palette-filters__counts-sep" aria-hidden="true">
          &middot;
        </span>
        <span class="palette-filters__counts-item">
          {{ counts.classCount }}
          {{ counts.classCount === 1 ? 'class' : 'classes' }} with icons
        </span>
      </template>
      <span
        v-if="filters.status === 'all'"
        class="palette-filters__counts-sep"
        aria-hidden="true"
      >
        &middot;
      </span>
      <span v-if="filters.status !== 'existing'" class="palette-filters__counts-item">
        {{ counts.missingCount }} missing
        {{ counts.missingCount === 1 ? 'name' : 'names' }}
      </span>
    </p>
  </section>
</template>
