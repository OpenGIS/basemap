// Colour-scheme switch.
//
// Mirrors the Open GIS branding model: Auto removes `data-theme` so the
// theme follows the operating system, while Light and Dark force the
// attribute. Nothing is persisted.

const CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export function useThemeSwitch() {
  const theme = ref('auto')

  function setTheme(value) {
    theme.value = value
    const root = document.documentElement

    if (value === 'auto') {
      delete root.dataset.theme
    } else {
      root.dataset.theme = value
    }
  }

  onMounted(() => {
    const current = document.documentElement.dataset.theme
    theme.value = CHOICES.some((choice) => choice.value === current) ? current : 'auto'
  })

  return { choices: CHOICES, theme, setTheme }
}
