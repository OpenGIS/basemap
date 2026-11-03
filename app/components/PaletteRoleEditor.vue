<script setup>
import { ref, watch } from 'vue'
import { normaliseHex } from '~/utils/colour'

const props = defineProps({
  role: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update', 'reset'])

const draft = ref(props.role.color)
const invalid = ref(false)

watch(
  () => props.role.color,
  (colour) => {
    if (draft.value !== colour) {
      draft.value = colour
      invalid.value = false
    }
  }
)

function commit() {
  const hex = normaliseHex(draft.value)

  if (!hex) {
    invalid.value = true
    return
  }

  invalid.value = false
  draft.value = hex
  if (hex !== props.role.color) emit('update', hex)
}

function restore() {
  if (invalid.value) {
    draft.value = props.role.color
    invalid.value = false
  } else {
    commit()
  }
}

function onColourInput(event) {
  const hex = normaliseHex(event.target.value)
  if (!hex) return
  draft.value = hex
  invalid.value = false
  emit('update', hex)
}

function onHexInput(event) {
  const text = String(event.target.value || '').trim().replace(/^#/, '')
  if (text.length !== 6) return

  const hex = normaliseHex(text)
  if (!hex) return

  invalid.value = false
  if (hex !== props.role.color) emit('update', hex)
}
</script>

<template>
  <div
    class="palette-role-row"
    :class="{ 'is-modified': role.modified }"
    :style="{ '--role-colour': role.color }"
  >
    <span class="palette-role-row__dot" aria-hidden="true"></span>

    <div class="palette-role-row__body">
      <label class="palette-role-row__label" :for="`role-hex-${role.id}`">
        {{ role.label }}
      </label>

      <div class="palette-role-row__controls">
        <input
          class="palette-role-row__swatch"
          type="color"
          :value="role.color"
          :aria-label="`${role.label} colour`"
          @input="onColourInput"
        >

        <input
          :id="`role-hex-${role.id}`"
          v-model="draft"
          class="palette-role-row__hex"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :aria-label="`${role.label} hex colour`"
          :aria-invalid="invalid ? 'true' : undefined"
          :aria-describedby="invalid ? `role-error-${role.id}` : undefined"
          @input="onHexInput"
          @change="commit"
          @keydown.enter.prevent="commit"
          @blur="restore"
        >
      </div>

      <div v-if="role.modified" class="palette-role-row__footer">
        <p class="palette-role-row__source">Source {{ role.sourceColour }}</p>
        <button
          type="button"
          class="palette-role-row__reset secondary"
          :aria-label="`Reset ${role.label} colour`"
          @click="emit('reset')"
        >
          Reset
        </button>
      </div>

      <p
        v-if="invalid"
        :id="`role-error-${role.id}`"
        class="palette-role-row__error"
        role="alert"
      >
        Enter a hex colour such as #1A2B3C.
      </p>
    </div>
  </div>
</template>
