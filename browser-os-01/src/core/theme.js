import { debounce } from './utils.js';

export const WALLPAPERS = [
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(140deg, #16213e 0%, #0f3460 45%, #1a1a2e 100%)' },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(160deg, #2b1055 0%, #7597de 100%)' },
  { id: 'forest', label: 'Forest', css: 'linear-gradient(150deg, #0b2b1e 0%, #1f5c3d 55%, #0b2b1e 100%)' },
  { id: 'sunset', label: 'Sunset', css: 'linear-gradient(160deg, #2d1b4e 0%, #b23a48 55%, #f6a94a 100%)' },
  { id: 'slate', label: 'Slate', css: 'linear-gradient(150deg, #1b1f2a 0%, #2f3646 60%, #1b1f2a 100%)' },
  { id: 'grid', label: 'Grid', css: 'linear-gradient(180deg, #0d1117 0%, #101826 100%), repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 48px)' },
  { id: 'paper', label: 'Paper', css: 'linear-gradient(160deg, #e9edf5 0%, #d7deea 60%, #c3cddd 100%)' },
  { id: 'candy', label: 'Candy', css: 'linear-gradient(140deg, #ff9a9e 0%, #fad0c4 40%, #a1c4fd 100%)' },
];

export const ACCENTS = [
  { id: 'blue', label: 'Blue', css: '#4f8cff' },
  { id: 'violet', label: 'Violet', css: '#a06bff' },
  { id: 'teal', label: 'Teal', css: '#21c7b8' },
  { id: 'amber', label: 'Amber', css: '#f2a33c' },
  { id: 'rose', label: 'Rose', css: '#ff5f8f' },
  { id: 'lime', label: 'Lime', css: '#7ac94a' },
];

const DEFAULTS = {
  theme: 'dark',
  accent: 'blue',
  wallpaper: 'aurora',
  customWallpaper: null,
  icons: true,
};

export class Theme {
  constructor(bus, store) {
    this.bus = bus;
    this.store = store;
    this.settings = { ...DEFAULTS, ...(store.load('settings') || {}) };
    this.save = debounce(() => store.save('settings', this.settings), 150);
    this.wallpaperEl = document.getElementById('wallpaper');
    this.apply();
  }

  apply() {
    const root = document.documentElement;
    root.dataset.theme = this.settings.theme;
    root.dataset.accent = this.settings.accent;
    const custom = this.settings.customWallpaper;
    const preset = WALLPAPERS.find((w) => w.id === this.settings.wallpaper) || WALLPAPERS[0];
    this.wallpaperEl.style.background = custom || preset.css;
    this.wallpaperEl.style.backgroundSize = 'cover';
    this.wallpaperEl.style.backgroundPosition = 'center';
  }

  set(key, value) {
    this.settings[key] = value;
    this.apply();
    this.save();
    this.bus.emit('settings:change', { key, value });
  }

  reset() {
    this.settings = { ...DEFAULTS };
    this.store.save('settings', this.settings);
    this.apply();
    this.bus.emit('settings:change', { key: null, value: null });
  }
}
