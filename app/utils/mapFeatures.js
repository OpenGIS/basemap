function expressionValue(expression, properties) {
  if (typeof expression === 'string') {
    if (expression === '{subclass}') return properties.subclass ?? null
    if (expression === '{class}') return properties.class ?? null
    return expression || null
  }

  if (!Array.isArray(expression) || expression.length === 0) return null

  const [operator, ...operands] = expression

  if (operator === 'coalesce') {
    for (const operand of operands) {
      const value = expressionValue(operand, properties)
      if (value !== null && value !== undefined && value !== '') return value
    }
    return null
  }

  if (operator === 'image') {
    const source = operands[0]
    if (typeof source === 'string') return source
    if (Array.isArray(source) && source[0] === 'get') {
      const value = properties[source[1]]
      return value === undefined || value === null || value === '' ? null : value
    }
  }

  if (operator === 'get') {
    const value = properties[operands[0]]
    return value === undefined || value === null || value === '' ? null : value
  }

  return null
}

export function resolveIconExpression(iconImage, properties = {}) {
  return expressionValue(iconImage, properties)
}

export function resolveFeature(feature, paletteData) {
  const layerId = feature?.layer?.id
  if (!layerId || !paletteData) return null

  const layer = (paletteData.layers || []).find(
    (candidate) => candidate.id === layerId && !candidate.textOnly
  )
  if (!layer || layer.iconImage === null || layer.iconImage === undefined) {
    return null
  }

  const properties = feature.properties || {}
  const iconName = resolveIconExpression(layer.iconImage, properties)
  if (!iconName) return null

  let fallback = null

  for (const role of paletteData.roles || []) {
    for (const group of role.classes || []) {
      for (const icon of group.icons || []) {
        if (icon.name !== iconName) continue

        if (Array.isArray(icon.layers) && icon.layers.includes(layerId)) {
          return buildResult(iconName, icon, group.name, role, layerId, properties)
        }
        if (!fallback) {
          fallback = { icon, className: group.name, role }
        }
      }
    }
  }

  if (!fallback) return null
  return buildResult(
    iconName,
    fallback.icon,
    fallback.className,
    fallback.role,
    layerId,
    properties
  )
}

function buildResult(iconName, icon, className, role, layerId, properties) {
  return {
    iconName,
    icon,
    className,
    roleId: role.id,
    role,
    layerId,
    name:
      properties.name_en ||
      properties.name ||
      properties.subclass ||
      properties.class,
    subclass: properties.subclass || properties.class
  }
}
