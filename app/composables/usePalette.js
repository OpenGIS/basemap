import { computed, onUnmounted, reactive, ref } from 'vue'
import paletteData from '~/assets/data/palette.json'
import { buildPaletteDocument, normaliseHex } from '~/utils/colour'
import {
  collectClassOptions,
  collectLayerOptions,
  filterPalette
} from '~/utils/filters'

const sourceRoles = paletteData.palette.roles
  .slice()
  .sort((left, right) => left.order - right.order)
const roleOrder = sourceRoles.map((role) => role.id)
const originalColours = Object.fromEntries(
  sourceRoles.map((role) => [role.id, normaliseHex(role.color) || role.color])
)

export function usePalette() {
  const roleColours = reactive(
    Object.fromEntries(sourceRoles.map((role) => [role.id, originalColours[role.id]]))
  )

  const filters = reactive({
    search: '',
    roles: roleOrder.slice(),
    provenance: 'all',
    layer: 'all',
    className: 'all',
    status: 'all'
  })

  const actionStatus = ref('')
  let actionTimer = null

  const filtered = computed(() => filterPalette(paletteData, filters))
  const layerOptions = collectLayerOptions(paletteData)
  const classOptions = collectClassOptions(paletteData)

  const changedRoleIds = computed(() =>
    roleOrder.filter(
      (id) => normaliseHex(roleColours[id]) !== normaliseHex(originalColours[id])
    )
  )
  const changedCount = computed(() => changedRoleIds.value.length)

  const roleOptions = computed(() =>
    sourceRoles.map((role) => {
      const colour = roleColours[role.id]
      const sourceColour = originalColours[role.id]
      return {
        ...role,
        color: colour,
        sourceColour,
        modified: normaliseHex(colour) !== normaliseHex(sourceColour)
      }
    })
  )

  const paletteText = computed(() =>
    buildPaletteDocument(paletteData.palette, roleColours)
  )

  function setRoleColour(id, value) {
    const hex = normaliseHex(value)
    if (!hex || !Object.prototype.hasOwnProperty.call(roleColours, id)) return false
    roleColours[id] = hex
    return true
  }

  function resetRole(id) {
    if (Object.prototype.hasOwnProperty.call(roleColours, id)) {
      roleColours[id] = originalColours[id]
    }
  }

  function resetAll() {
    for (const id of roleOrder) roleColours[id] = originalColours[id]
  }

  function toggleRole(id) {
    const index = filters.roles.indexOf(id)
    if (index === -1) {
      filters.roles = [...filters.roles, id]
    } else {
      filters.roles = filters.roles.filter((roleId) => roleId !== id)
    }
  }

  function selectAllRoles() {
    filters.roles = roleOrder.slice()
  }

  function selectNoRoles() {
    filters.roles = []
  }

  function updateFilter(key, value) {
    if (key === 'roles' || !(key in filters)) return
    filters[key] = value
  }

  function clearFilters() {
    filters.search = ''
    filters.roles = roleOrder.slice()
    filters.provenance = 'all'
    filters.layer = 'all'
    filters.className = 'all'
    filters.status = 'all'
  }

  function announce(message) {
    actionStatus.value = message
    if (actionTimer) clearTimeout(actionTimer)
    actionTimer = setTimeout(() => {
      actionStatus.value = ''
      actionTimer = null
    }, 4000)
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(area)
    if (!copied) throw new Error('Copy command failed')
  }

  async function copyPalette() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(paletteText.value)
          announce('Copied palette.json')
          return
        } catch (error) {
          legacyCopy(paletteText.value)
          announce('Copied palette.json')
          return
        }
      }

      legacyCopy(paletteText.value)
      announce('Copied palette.json')
    } catch (error) {
      announce('Copy failed — use Download instead')
    }
  }

  function downloadPalette() {
    const blob = new Blob([paletteText.value], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'palette.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    announce('Downloaded palette.json')
  }

  onUnmounted(() => {
    if (actionTimer) clearTimeout(actionTimer)
  })

  return {
    paletteData,
    roleColours,
    filters,
    filtered,
    roleOptions,
    layerOptions,
    classOptions,
    changedRoleIds,
    changedCount,
    actionStatus,
    paletteText,
    setRoleColour,
    resetRole,
    resetAll,
    toggleRole,
    selectAllRoles,
    selectNoRoles,
    updateFilter,
    clearFilters,
    copyPalette,
    downloadPalette
  }
}
