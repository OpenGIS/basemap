export const PALETTE_STATUSES = ['existing', 'missing', 'all']

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normaliseTerm(value) {
  return String(value || '').trim().toLowerCase()
}

function roleIdsFrom(data) {
  return ((data.palette && data.palette.roles) || data.roles || []).map((role) => role.id)
}

function buildRole(role, classes) {
  const iconNames = new Set()
  for (const group of classes) {
    for (const icon of group.icons) iconNames.add(icon.name)
  }

  return {
    ...role,
    classes,
    iconCount: iconNames.size,
    classCount: classes.length
  }
}

export function collectClassOptions(data) {
  const names = new Set()

  for (const role of data.roles || []) {
    for (const group of role.classes || []) names.add(group.name)
  }

  for (const group of data.missingGroups || []) {
    names.add(group.class)
    for (const item of group.items || []) {
      for (const className of item.classes || []) names.add(className)
    }
  }

  return Array.from(names).sort(compareStrings)
}

export function collectLayerOptions(data) {
  const names = new Set()

  for (const layer of data.layers || []) {
    if (!layer.textOnly) names.add(layer.id)
  }

  return Array.from(names).sort(compareStrings)
}

export function filterPalette(data, filters = {}) {
  const search = normaliseTerm(filters.search)
  const status = PALETTE_STATUSES.includes(filters.status) ? filters.status : 'all'
  const provenance = filters.provenance || 'all'
  const layer = filters.layer || 'all'
  const className = filters.className || 'all'
  const selectedRoles =
    filters.roles === undefined || filters.roles === null
      ? new Set(roleIdsFrom(data))
      : new Set(filters.roles)

  const roles = []

  if (status !== 'missing') {
    for (const role of data.roles || []) {
      if (!selectedRoles.has(role.id)) continue

      const classes = []

      for (const group of role.classes || []) {
        if (provenance !== 'all' && group.provenance !== provenance) continue
        if (className !== 'all' && group.name !== className) continue

        const groupText = [
          role.label,
          role.id,
          group.name,
          ...(group.mappingKeys || []),
          ...(group.layers || [])
        ]
          .join(' ')
          .toLowerCase()

        const icons = (group.icons || []).filter((icon) => {
          if (layer !== 'all' && !(icon.layers || []).includes(layer)) return false
          if (!search) return true

          const iconText = [icon.name, ...(icon.subclasses || []), ...(icon.layers || [])]
            .join(' ')
            .toLowerCase()

          return `${groupText} ${iconText}`.includes(search)
        })

        if (!icons.length) continue
        classes.push({ ...group, icons })
      }

      if (!classes.length) continue
      roles.push(buildRole(role, classes))
    }
  }

  const missingGroups = []

  if (status !== 'existing') {
    for (const group of data.missingGroups || []) {
      const items = (group.items || []).filter((item) => {
        if (className !== 'all' && !(item.classes || []).includes(className)) return false
        if (!search) return true

        const itemText = [group.class, item.name, ...(item.classes || [])]
          .join(' ')
          .toLowerCase()

        return itemText.includes(search)
      })

      if (!items.length) continue
      missingGroups.push({ ...group, items })
    }
  }

  const visibleIconNames = new Set()
  for (const role of roles) {
    for (const group of role.classes) {
      for (const icon of group.icons) visibleIconNames.add(icon.name)
    }
  }

  const existingCount = visibleIconNames.size
  const classCount = roles.reduce((total, role) => total + role.classCount, 0)
  const missingCount = missingGroups.reduce((total, group) => total + group.items.length, 0)

  return {
    status,
    search,
    provenance,
    layer,
    className,
    roles,
    missingGroups,
    missingNames: missingGroups.flatMap((group) => group.items.map((item) => item.name)),
    existingCount,
    existingTotal: data.summary ? data.summary.existingIcons : existingCount,
    classCount,
    missingCount,
    missingTotal: data.summary ? data.summary.missingIcons : missingCount
  }
}
