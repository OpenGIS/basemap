<script setup>
import '@picocss/pico/css/pico.min.css'
import '~/assets/scss/ogis.scss'
import logoWhite from '~/assets/branding/logo-white.svg'
import { useThemeSwitch } from '~/composables/useThemeSwitch'
import { usePalette } from '~/composables/usePalette'

useHead({ title: 'Basemap palette' })

const { choices, theme, setTheme } = useThemeSwitch()
const {
  paletteData,
  roleColours,
  filters,
  filtered,
  roleOptions,
  layerOptions,
  classOptions,
  changedCount,
  actionStatus,
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
} = usePalette()

function confirmResetAll() {
  if (!changedCount.value) return
  const message = `Reset ${changedCount.value} changed ${
    changedCount.value === 1 ? 'colour' : 'colours'
  } to the source palette?`
  if (window.confirm(message)) resetAll()
}
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-brand" href="https://www.ogis.org/" title="Open GIS">
        <img
          class="brand-mark"
          :src="logoWhite"
          alt=""
          width="40"
          height="40"
        >
        <span class="site-brand__wordmark">Open GIS</span>
      </a>

      <div class="site-heading">
        <h1>Basemap palette</h1>
        <p>Preview, edit and export the basemap icon palette.</p>
      </div>

      <div class="theme-switch" role="group" aria-label="Colour scheme">
        <button
          v-for="choice in choices"
          :key="choice.value"
          type="button"
          :aria-pressed="theme === choice.value ? 'true' : 'false'"
          @click="setTheme(choice.value)"
        >
          {{ choice.label }}
        </button>
      </div>
    </div>
  </header>

  <main id="main" class="shell-main">
    <div class="palette-band">
      <div class="palette-band__inner">
        <section class="palette-summary" aria-labelledby="summary-heading">
          <h2 id="summary-heading" class="visually-hidden">Palette summary</h2>

          <dl class="palette-summary__counts">
            <div>
              <dt>Roles</dt>
              <dd>{{ paletteData.summary.roles }}</dd>
            </div>
            <div>
              <dt>Icons</dt>
              <dd>{{ paletteData.summary.existingIcons }}</dd>
            </div>
            <div>
              <dt>Classes</dt>
              <dd>{{ paletteData.summary.classes }}</dd>
            </div>
            <div>
              <dt>Missing</dt>
              <dd>{{ paletteData.summary.missingIcons }}</dd>
            </div>
            <div>
              <dt>Phantoms</dt>
              <dd>{{ paletteData.summary.phantoms }}</dd>
            </div>
          </dl>

          <div class="palette-summary__actions">
            <p class="palette-summary__status">
              <span v-if="changedCount">
                {{ changedCount }} {{ changedCount === 1 ? 'colour' : 'colours' }} changed
              </span>
              <span v-else>Source palette</span>
            </p>

            <button type="button" @click="copyPalette">Copy palette.json</button>
            <button type="button" class="secondary" @click="downloadPalette">
              Download
            </button>
            <button
              type="button"
              class="secondary"
              :disabled="changedCount === 0"
              @click="confirmResetAll"
            >
              Reset all
            </button>
          </div>

          <p class="palette-summary__feedback" aria-live="polite">
            {{ actionStatus }}
          </p>
        </section>

        <div class="palette-layout">
          <aside class="palette-sidebar" aria-labelledby="roles-heading">
            <div class="palette-sidebar__inner">
              <h2 id="roles-heading">Role colours</h2>
              <p class="palette-sidebar__hint">
                Edit a role colour to recolour every icon in that role. Hex
                fields accept #RGB or #RRGGBB, with or without the hash.
              </p>

              <div class="palette-role-list">
                <PaletteRoleEditor
                  v-for="role in roleOptions"
                  :key="role.id"
                  :role="role"
                  @update="setRoleColour(role.id, $event)"
                  @reset="resetRole(role.id)"
                />
              </div>
            </div>
          </aside>

          <div class="palette-content">
            <PaletteFilters
              :filters="filters"
              :role-options="roleOptions"
              :layer-options="layerOptions"
              :class-options="classOptions"
              :counts="filtered"
              @update:search="updateFilter('search', $event)"
              @update:provenance="updateFilter('provenance', $event)"
              @update:layer="updateFilter('layer', $event)"
              @update:className="updateFilter('className', $event)"
              @update:status="updateFilter('status', $event)"
              @toggle-role="toggleRole"
              @select-all-roles="selectAllRoles"
              @select-no-roles="selectNoRoles"
              @clear="clearFilters"
            />

            <section
              v-if="filters.status !== 'missing'"
              class="palette-existing"
              aria-labelledby="existing-heading"
            >
              <h2 id="existing-heading">Existing icons</h2>
              <p class="palette-section__intro">
                Grouped by role and class. Each tile shows the live role colour
                and the layer that selects it.
              </p>

              <article
                v-for="role in filtered.roles"
                :key="role.id"
                class="palette-role-section"
              >
                <header
                  class="palette-role-heading"
                  :style="{ '--role-colour': roleColours[role.id] }"
                >
                  <span class="palette-role-heading__dot" aria-hidden="true"></span>
                  <h3>{{ role.label }}</h3>
                  <span class="palette-role-heading__meta">
                    {{ role.iconCount }}
                    {{ role.iconCount === 1 ? 'icon' : 'icons' }}
                    &middot;
                    {{ role.classCount }}
                    {{ role.classCount === 1 ? 'class' : 'classes' }}
                  </span>
                </header>

                <PaletteClassGroup
                  v-for="group in role.classes"
                  :key="`${role.id}-${group.name}`"
                  :group="group"
                  :colour="roleColours[role.id]"
                />
              </article>

              <div v-if="!filtered.roles.length" class="palette-empty">
                <p>No existing icons match the current filters.</p>
                <button type="button" class="secondary" @click="clearFilters">
                  Clear filters
                </button>
              </div>
            </section>

            <PaletteMissing
              v-if="filters.status !== 'existing'"
              :groups="filtered.missingGroups"
              :count="filtered.missingCount"
              :total="filtered.missingTotal"
              @clear="clearFilters"
            />

            <PalettePhantoms :phantoms="paletteData.phantoms" />
          </div>
        </div>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <p><a href="https://www.ogis.org/">Open GIS</a></p>
    <p><a href="https://github.com/opengis/basemap">Source</a></p>
    <p>
      Icons derive from
      <a href="https://openmaptiles.org/">OpenMapTiles</a>
      and
      <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.
    </p>
  </footer>
</template>
