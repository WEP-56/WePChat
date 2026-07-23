/**
 * Appearance settings renderer and event binder for the Windows shell.
 */

import { $, $all, defaultSettings, state } from './app-core.js';

export function renderThemeUI() {
  const settings = state.settings || defaultSettings();
  const style = settings.themeStyle || 'graphite';
  $all('.theme-choice').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.theme === style);
  });

  const themeSegs = $('#theme-mode-seg');
  themeSegs?.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.mode === (settings.theme || 'light'));
  });

  window.WePChatThemeSystem?.apply(settings);
}

export function bindAppearanceEvents({ persistSettings }) {
  $all('.theme-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.theme;
      if (!style) return;
      if (state.settings) state.settings.themeStyle = style;
      persistSettings().then(renderThemeUI);
    });
  });

  const themeSegs = $('#theme-mode-seg');
  themeSegs?.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    const mode = btn?.dataset.mode;
    if (!mode) return;
    if (state.settings) state.settings.theme = mode;
    persistSettings().then(renderThemeUI);
  });

}
