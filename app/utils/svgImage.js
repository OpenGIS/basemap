function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load SVG image'))
    image.src = url
  })
}

export async function svgToImageData(svg, width, height) {
  if (typeof svg !== 'string' || !svg) {
    throw new Error('SVG source is required')
  }

  const pixelWidth = Math.max(1, Math.round(Number(width) || 0))
  const pixelHeight = Math.max(1, Math.round(Number(height) || 0))
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas context unavailable')
    context.clearRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    return context.getImageData(0, 0, pixelWidth, pixelHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}
