(() => {
  'use strict';

  const KEY = 'certichain-theme';
  const root = document.documentElement;
  const media = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function readSavedTheme() {
    try {
      const saved = window.localStorage.getItem(KEY);
      return saved === 'dark' || saved === 'light' ? saved : null;
    } catch (_) {
      return null;
    }
  }

  function getTheme() {
    return readSavedTheme() || (media && media.matches ? 'dark' : 'light');
  }

  function applyTheme(theme) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = selected;
    root.style.colorScheme = selected;

    const button = document.getElementById('ccThemeToggle');
    if (button) {
      const dark = selected === 'dark';
      button.textContent = dark ? '☀ Light mode' : '☾ Dark mode';
      button.setAttribute('aria-label',
        dark ? 'Switch to light theme' : 'Switch to dark theme');
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('title',
        dark ? 'Switch to light theme' : 'Switch to dark theme');
    }
  }

  function install() {
    applyTheme(getTheme());

    const nav = document.querySelector('header nav');
    if (nav && !document.getElementById('ccThemeToggle')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'ccThemeToggle';
      button.className = 'cc-theme-toggle';
      button.addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
          window.localStorage.setItem(KEY, next);
        } catch (_) {
          // Theme still changes for this page when storage is unavailable.
        }
        applyTheme(next);
      });
      nav.appendChild(button);
    }

    applyTheme(getTheme());

    if (media) {
      const onSystemThemeChange = event => {
        if (!readSavedTheme()) {
          applyTheme(event.matches ? 'dark' : 'light');
        }
      };

      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onSystemThemeChange);
      } else if (typeof media.addListener === 'function') {
        media.addListener(onSystemThemeChange);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
