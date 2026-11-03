<script setup>
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import paletteData from '~/assets/data/palette.json'
import iconTemplates from '~/assets/data/icons.json'
import logoBlack from '~/assets/branding/logo-black.svg'
import {
  PALETTE_PLACEHOLDER,
  buildPaletteDocument,
  iconDataUri,
  normaliseHex
} from '~/utils/colour'
import { resolveFeature } from '~/utils/mapFeatures'
import { svgToImageData } from '~/utils/svgImage'
import {
  MAP_DEFAULTS,
  formatMapHash,
  parseMapHash,
  readMapState
} from '~/utils/mapState'

definePageMeta({
  alias: ['/index.html']
})

const { app } = useRuntimeConfig()
const baseURL = app.baseURL

useHead({
  title: 'Basemap — Open GIS'
})

const poiLayerIds = paletteData.layers
  .filter((layer) => !layer.textOnly)
  .map((layer) => layer.id)

const roleColours = reactive(
  Object.fromEntries(
    paletteData.roles.map((role) => [
      role.id,
      normaliseHex(role.color) || role.color
    ])
  )
)

const inspectMode = ref(false)
const selected = ref(null)
const hexInput = ref('')
const colourError = ref('')
const hint = ref('')
const actionStatus = ref('')

let map = null
let hashChangeHandler = null
let imageQueue = Promise.resolve()
let hintTimer = null
let statusTimer = null
let selectionMarker = null

const selectedPreview = computed(() => {
  if (!selected.value) return ''
  const template = iconTemplates[selected.value.iconName]
  return iconDataUri(template, roleColours[selected.value.roleId])
})

const selectedColour = computed(() =>
  selected.value ? roleColours[selected.value.roleId] : '#000000'
)

function clearHintTimer() {
  if (hintTimer) {
    clearTimeout(hintTimer)
    hintTimer = null
  }
}

function setHint(message) {
  hint.value = message
  clearHintTimer()
  hintTimer = setTimeout(() => {
    hint.value = ''
    hintTimer = null
  }, 4000)
}

function setStatus(message) {
  actionStatus.value = message
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  statusTimer = setTimeout(() => {
    actionStatus.value = ''
    statusTimer = null
  }, 4000)
}

function updateMapImage(name, colour) {
  const currentMap = map
  const template = iconTemplates[name]
  const hex = normaliseHex(colour)

  if (!currentMap || !currentMap.hasImage(name) || !template || !hex) {
    return Promise.resolve()
  }

  const image = currentMap.getImage(name)
  const width = image?.data?.width
  const height = image?.data?.height
  if (!width || !height) return Promise.resolve()

  const svg = template.split(PALETTE_PLACEHOLDER).join(hex)

  return svgToImageData(svg, width, height)
    .then((imageData) => {
      if (!map || !map.hasImage(name)) return
      map.updateImage(name, imageData)
    })
    .catch((error) => {
      console.warn(`Could not recolour map icon "${name}"`, error)
    })
}

function queueImageUpdate(name, colour) {
  imageQueue = imageQueue.then(() => updateMapImage(name, colour))
  return imageQueue
}

function applyAllImages() {
  const tasks = paletteData.roles.map((role) => {
    const colour = roleColours[role.id]
    return role.iconNames.reduce(
      (chain, name) => chain.then(() => queueImageUpdate(name, colour)),
      Promise.resolve()
    )
  })

  return Promise.all(tasks).then(() => {
    if (map) map.triggerRepaint()
  })
}

function applyRoleImages(roleId) {
  const role = paletteData.roles.find((candidate) => candidate.id === roleId)
  if (!role) return Promise.resolve()

  const colour = roleColours[roleId]
  return role.iconNames
    .reduce(
      (chain, name) => chain.then(() => queueImageUpdate(name, colour)),
      Promise.resolve()
    )
    .then(() => {
      if (map) map.triggerRepaint()
    })
}

function setRoleColour(roleId, value) {
  if (!Object.prototype.hasOwnProperty.call(roleColours, roleId)) return false

  const hex = normaliseHex(value)
  if (!hex) {
    colourError.value = 'Enter a valid hex colour, such as #5CF05C.'
    return false
  }

  colourError.value = ''
  roleColours[roleId] = hex
  applyRoleImages(roleId)
  return true
}

function onColourInput(event) {
  if (!selected.value) return
  const applied = setRoleColour(selected.value.roleId, event.target.value)
  if (applied) hexInput.value = roleColours[selected.value.roleId]
}

function commitHex() {
  if (!selected.value) return
  const applied = setRoleColour(selected.value.roleId, hexInput.value)
  if (applied) hexInput.value = roleColours[selected.value.roleId]
}

function resetSelectedRole() {
  if (!selected.value) return
  const role = paletteData.roles.find(
    (candidate) => candidate.id === selected.value.roleId
  )
  if (!role) return

  setRoleColour(role.id, role.color)
  hexInput.value = roleColours[role.id]
}

function clearSelectionMarker() {
  if (selectionMarker) {
    selectionMarker.remove()
    selectionMarker = null
  }
}

function openInspector(match, lngLat) {
  selected.value = match
  colourError.value = ''
  hexInput.value = roleColours[match.roleId]
  hint.value = ''
  clearHintTimer()

  clearSelectionMarker()
  if (map && lngLat) {
    const element = document.createElement('div')
    element.className = 'home-selection'
    element.setAttribute('aria-hidden', 'true')
    selectionMarker = new maplibregl.Marker({
      element,
      anchor: 'center'
    })
      .setLngLat(lngLat)
      .addTo(map)
  }
}

function closeInspector() {
  selected.value = null
  colourError.value = ''
  hexInput.value = ''
  clearSelectionMarker()
}

function toggleInspect() {
  inspectMode.value = !inspectMode.value
  if (map) {
    map.getCanvas().style.cursor = inspectMode.value ? 'crosshair' : ''
  }
  if (!inspectMode.value) closeInspector()
}

function handleMapClick(event) {
  if (!inspectMode.value || !map) return

  let features = []
  try {
    features = map.queryRenderedFeatures(event.point, { layers: poiLayerIds })
  } catch (error) {
    features = []
  }

  for (const feature of features) {
    const match = resolveFeature(feature, paletteData)
    if (match) {
      openInspector(match, event.lngLat)
      return
    }
  }

  setHint('No palette POI at that point.')
}

function exportPalette() {
  const text = buildPaletteDocument(paletteData.palette, roleColours)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'palette.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  setStatus('Palette exported.')
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const finite = (value, fallback) => {
    if (value === null || value === '') return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  const initialState = {
    ...MAP_DEFAULTS,
    ...readMapState(window.location.search, window.location.hash)
  }
  const { lat, lng, zoom, pitch, rotation } = initialState
  const width = finite(params.get('width'), NaN)
  const height = finite(params.get('height'), NaN)
  const styleUrl = params.get('style') || `${baseURL}style.json`
  const qualityMode = Boolean(params.get('quality'))

  delete document.body.dataset.mapReady
  delete document.body.dataset.mapError
  delete document.body.dataset.mapQuality

  const mapEl = document.getElementById('map')
  if (Number.isFinite(width) && Number.isFinite(height)) {
    mapEl.style.width = `${Math.min(4000, Math.max(100, Math.round(width)))}px`
    mapEl.style.height = `${Math.min(4000, Math.max(100, Math.round(height)))}px`
  }

  map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: [lng, lat],
    zoom,
    pitch,
    bearing: rotation,
    preserveDrawingBuffer: qualityMode
  })

  map.addControl(new maplibregl.NavigationControl())
  map.on('click', handleMapClick)

  const stateEl = document.getElementById('state')
  const renderState = () => {
    const c = map.getCenter()
    stateEl.textContent =
      `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` +
      ` · z ${map.getZoom().toFixed(1)}` +
      ` · pitch ${Math.round(map.getPitch())}°` +
      ` · bearing ${Math.round(map.getBearing())}°`
  }
  renderState()
  map.on('move', renderState)

  const writeStateToUrl = () => {
    const nextHash = formatMapHash({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      rotation: map.getBearing()
    })
    if (!nextHash || nextHash === window.location.hash) return
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${nextHash}`
    )
  }
  map.on('moveend', writeStateToUrl)

  hashChangeHandler = () => {
    const next = parseMapHash(window.location.hash)
    if (!next || !map) return
    map.jumpTo({
      center: [next.lng, next.lat],
      zoom: next.zoom,
      pitch: next.pitch,
      bearing: next.rotation
    })
  }
  window.addEventListener('hashchange', hashChangeHandler)

  map.once('idle', async () => {
    if (!map) return

    await applyAllImages()
    if (!map) return

    document.body.dataset.mapReady = '1'

    if (qualityMode) {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, 32, 32)
        const { data } = ctx.getImageData(0, 0, 32, 32)
        const n = data.length / 4
        const luminance = new Array(n)
        for (let i = 0; i < n; i++) {
          luminance[i] =
            0.299 * data[i * 4] +
            0.587 * data[i * 4 + 1] +
            0.114 * data[i * 4 + 2]
        }
        const mean = luminance.reduce((a, b) => a + b, 0) / n
        const variance =
          luminance.reduce((a, lum) => a + (lum - mean) * (lum - mean), 0) / n
        const stddev = Math.sqrt(variance) / 255
        document.body.dataset.mapQuality = stddev.toFixed(4)
      }
      img.src = map.getCanvas().toDataURL()
    }
  })
  map.on('error', () => {
    document.body.dataset.mapError = '1'
  })
})

onUnmounted(() => {
  clearHintTimer()
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  if (hashChangeHandler) {
    window.removeEventListener('hashchange', hashChangeHandler)
    hashChangeHandler = null
  }
  clearSelectionMarker()
  if (map) {
    map.remove()
    map = null
  }
  delete document.body.dataset.mapReady
  delete document.body.dataset.mapError
  delete document.body.dataset.mapQuality
})
</script>

<template>
  <div id="map"></div>

  <div class="home-overlay">
    <section class="home-brand" aria-labelledby="home-title">
      <div class="home-brand__header">
        <img
          class="home-brand__logo"
          :src="logoBlack"
          alt=""
          width="28"
          height="28"
        >
        <span class="home-brand__wordmark">Open GIS</span>
      </div>

      <h1 id="home-title" class="home-brand__title">Basemap</h1>
      <p class="home-brand__description">
        A live Open GIS palette. Inspect a POI to recolour its whole role.
      </p>

      <div class="home-brand__actions">
        <button
          type="button"
          class="home-button"
          :aria-pressed="inspectMode ? 'true' : 'false'"
          @click="toggleInspect"
        >
          Inspect POIs
        </button>
        <button
          type="button"
          class="home-button home-button--secondary"
          @click="exportPalette"
        >
          Export palette
        </button>
      </div>

      <p id="state" class="home-state" aria-live="polite"></p>
      <p class="home-hint" role="status">{{ hint }}</p>
      <p class="home-status" role="status">{{ actionStatus }}</p>
    </section>

    <aside v-if="selected" class="home-inspector" aria-label="POI inspector">
      <div class="home-inspector__head">
        <h2 class="home-inspector__title">Selected POI</h2>
        <button
          type="button"
          class="home-inspector__close"
          aria-label="Close inspector"
          @click="closeInspector"
        >
          &times;
        </button>
      </div>

      <div class="home-inspector__summary">
        <img
          v-if="selectedPreview"
          class="home-inspector__icon"
          :src="selectedPreview"
          :alt="`${selected.iconName} icon preview`"
          width="36"
          height="36"
        >
        <div>
          <p class="home-inspector__name">
            {{ selected.name || selected.iconName }}
          </p>
          <p class="home-inspector__meta">
            {{
              selected.subclass === selected.className
                ? selected.subclass
                : `${selected.subclass} · ${selected.className}`
            }}
          </p>
        </div>
      </div>

      <dl class="home-inspector__facts">
        <div>
          <dt>Layer</dt>
          <dd>{{ selected.layerId }}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{{ selected.role.label }}</dd>
        </div>
      </dl>

      <div class="home-inspector__colour">
        <label class="home-inspector__label" for="home-colour">
          Role colour
        </label>
        <div class="home-inspector__controls">
          <input
            id="home-colour"
            class="home-colour-input"
            type="color"
            :value="selectedColour"
            @input="onColourInput"
          >
          <input
            class="home-hex-input"
            type="text"
            :value="hexInput"
            spellcheck="false"
            autocomplete="off"
            aria-label="Role colour hex"
            @input="hexInput = $event.target.value"
            @change="commitHex"
            @keydown.enter.prevent="commitHex"
          >
        </div>

        <p v-if="colourError" class="home-error" role="alert">
          {{ colourError }}
        </p>

        <p class="home-note">
          Editing this role updates {{ selected.role.iconCount }}
          {{ selected.role.iconCount === 1 ? 'icon' : 'icons' }}.
        </p>

        <button
          type="button"
          class="home-button home-button--secondary"
          @click="resetSelectedRole"
        >
          Reset role
        </button>
      </div>
    </aside>
  </div>
</template>

<style lang="scss">
@use '~/assets/scss/tokens';
@use '~/assets/scss/home';
</style>
