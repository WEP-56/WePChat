/* WePChat Windows — 轻量主题系统 (port from main app) */
'use strict';

(() => {
  const styles = [
    { id: 'graphite', name: '墨白', note: '克制、清晰、内容优先' },
    { id: 'warm-paper', name: '暖纸', note: '温暖纸张与舒展阅读' },
    { id: 'nebula', name: '星云', note: '冷色渐变与圆润层级' },
  ];
  const styleIds = new Set(styles.map(x => x.id));

  function normalizeStyle(value) {
    return styleIds.has(value) ? value : 'graphite';
  }

  function isDark(settings) {
    return settings.theme === 'dark' ||
      (settings.theme === 'auto' &&
       window.matchMedia &&
       window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function syncSystemBars(dark) {
    // For Tauri/Windows, may use IPC or just update meta/theme-color
    const root = document.documentElement;
    const bg = cssColor('--status-bar-bg', dark ? '#131316' : '#ffffff');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }

  function cssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function apply(settings) {
    const root = document.documentElement;
    const dark = isDark(settings);
    const style = normalizeStyle(settings.themeStyle);
    settings.themeStyle = style;
    root.dataset.theme = style;
    root.classList.toggle('dark', dark);
    requestAnimationFrame(() => syncSystemBars(dark));
  }

  window.WePChatThemeSystem = {
    styles,
    normalizeStyle,
    isDark,
    apply
  };
})();
