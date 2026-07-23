/**
 * Desktop title bar and left-list window controls.
 */

import { $, $all, getAppWindow, state } from './app-core.js';

export async function bindWindowControls({ setListCollapsed, setMaximizedUi }) {
  const win = getAppWindow();
  $('#btn-toggle-list')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setListCollapsed(!state.listCollapsed);
  });

  $('#win-min')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await win?.minimize();
    } catch (err) {
      console.warn(err);
    }
  });

  $('#win-max')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await win?.toggleMaximize();
      setMaximizedUi(Boolean(await win?.isMaximized()));
    } catch (err) {
      console.warn(err);
    }
  });

  $('#win-close')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await win?.close();
    } catch (err) {
      console.warn(err);
    }
  });

  $all('[data-tauri-drag-region]').forEach((el) => {
    el.addEventListener('dblclick', async (event) => {
      if (event.target.closest('button')) return;
      try {
        await win?.toggleMaximize();
        setMaximizedUi(Boolean(await win?.isMaximized()));
      } catch (err) {
        console.warn(err);
      }
    });
  });
}
