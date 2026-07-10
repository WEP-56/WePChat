/* WepChat - 轻量主题系统 */
'use strict';

(() => {
  const styles = [
    { id: 'graphite', name: '墨白', note: '克制、清晰、内容优先' },
    { id: 'warm-paper', name: '暖纸', note: '温暖纸张与舒展阅读' },
    { id: 'nebula', name: '星云', note: '冷色渐变与圆润层级' },
    { id: 'clear-glass', name: '澄镜', note: '中性色与悬浮玻璃' }
  ];
  const styleIds = new Set(styles.map(x => x.id));

  function normalizeStyle(value) {
    return styleIds.has(value) ? value : 'graphite';
  }

  function isDark(settings) {
    return settings.theme === 'dark' || (
      settings.theme === 'auto' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  function cssColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function syncSystemBars(dark) {
    const bg = cssColor('--status-bar-bg', dark ? '#131316' : '#ffffff');
    const nav = cssColor('--nav-bar-bg', bg);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', bg);

    if (!window.plus || !plus.navigator) return;
    try {
      if (plus.navigator.setStatusBarBackground) plus.navigator.setStatusBarBackground(bg);
      if (plus.navigator.setStatusBarStyle) plus.navigator.setStatusBarStyle(dark ? 'light' : 'dark');
      if (plus.navigator.setNavigationBarBackground) plus.navigator.setNavigationBarBackground(nav);
      else if (plus.navigator.setNavigationBarColor) plus.navigator.setNavigationBarColor(nav);
    } catch (e) {}
  }

  function apply(settings) {
    const root = document.documentElement;
    const dark = isDark(settings);
    const style = normalizeStyle(settings.themeStyle);
    settings.themeStyle = style;
    root.dataset.theme = style;
    root.classList.toggle('dark', dark);
    root.classList.toggle('fs-large', settings.fontSize === 'large');
    root.style.colorScheme = dark ? 'dark' : 'light';
    requestAnimationFrame(() => syncSystemBars(dark));
  }

  window.WepChatThemeSystem = {
    styles,
    normalizeStyle,
    isDark,
    apply,
    syncSystemBars
  };
})();
