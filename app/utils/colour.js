export const PALETTE_PLACEHOLDER = '__PALETTE_ROLE__'

const DATA_URI_PREFIX = 'data:image/svg+xml;charset=utf-8,'

export function normaliseHex(value) {
  if (value === undefined || value === null) return null

  let text = String(value).trim()
  if (!text) return null
  if (text.startsWith('#')) text = text.slice(1)
  if (!/^[0-9a-f]{3}$/i.test(text) && !/^[0-9a-f]{6}$/i.test(text)) return null

  if (text.length === 3) {
    text = text
      .split('')
      .map((character) => `${character}${character}`)
      .join('')
  }

  return `#${text.toUpperCase()}`
}

export function iconDataUri(template, colour) {
  if (typeof template !== 'string' || !template) return ''

  const hex = normaliseHex(colour)
  if (!hex) return ''

  const svg = template.split(PALETTE_PLACEHOLDER).join(hex)
  return `${DATA_URI_PREFIX}${encodeURIComponent(svg)}`
}

export function buildPaletteDocument(source, colours = {}) {
  const roles = (source.roles || []).map((role) => {
    const requested = colours[role.id]
    const colour = normaliseHex(requested) || normaliseHex(role.color) || role.color
    return { ...role, color: colour }
  })

  const document = {
    ...source,
    roles,
    preserve: [...(source.preserve || [])],
    overrides: { ...(source.overrides || {}) }
  }

  return `${JSON.stringify(document, null, 2)}\n`
}
