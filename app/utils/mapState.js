export const MAP_DEFAULTS = Object.freeze({
  lat: 51.5154,
  lng: -0.1755,
  zoom: 17,
  pitch: 0,
  rotation: 0
})

function finiteNumber(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function parseMapHash(hash) {
  if (typeof hash !== 'string') return null

  let text = hash.trim()
  if (text.startsWith('#')) text = text.slice(1)
  if (!text.startsWith('map=')) return null

  const parts = text.slice(4).split('/')
  if (parts.length !== 5) return null

  const numbers = parts.map(finiteNumber)
  if (numbers.some((number) => number === null)) return null

  const [zoom, lat, lng, pitch, rotation] = numbers
  return { zoom, lat, lng, pitch, rotation }
}

export function formatMapHash(state) {
  if (!state || typeof state !== 'object') return ''

  const numbers = [
    state.zoom,
    state.lat,
    state.lng,
    state.pitch,
    state.rotation
  ].map(finiteNumber)
  if (numbers.some((number) => number === null)) return ''

  const [zoom, lat, lng, pitch, rotation] = numbers

  return (
    `#map=${Math.round(zoom)}/${lat.toFixed(6)}/${lng.toFixed(6)}` +
    `/${Math.round(pitch)}/${Math.round(rotation)}`
  )
}

export function readMapState(search, hash) {
  const fromHash = parseMapHash(hash)
  if (fromHash) return fromHash

  const params =
    search instanceof URLSearchParams
      ? search
      : new URLSearchParams(typeof search === 'string' ? search : '')

  return {
    lat: finiteNumber(params.get('lat')) ?? MAP_DEFAULTS.lat,
    lng: finiteNumber(params.get('lng')) ?? MAP_DEFAULTS.lng,
    zoom: finiteNumber(params.get('zoom')) ?? MAP_DEFAULTS.zoom,
    pitch: finiteNumber(params.get('pitch')) ?? MAP_DEFAULTS.pitch,
    rotation: finiteNumber(params.get('rotation')) ?? MAP_DEFAULTS.rotation
  }
}
