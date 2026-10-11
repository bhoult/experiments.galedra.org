import { EventBus } from './core/eventbus.js';
import { Store } from './core/store.js';
import { VirtualFS } from './core/fs.js';
import { Theme, WALLPAPERS, ACCENTS } from './core/theme.js';
import { WindowManager } from './core/wm.js';
import { Shell } from './core/shell.js';
import { Dialogs } from './core/dialogs.js';
import { debounce, VERSION } from './core/utils.js';
import { APPS } from './apps/index.js';
import { NS } from './core/store.js';

const bus = new EventBus();
const store = new Store(NS, bus);
const fs = new VirtualFS(bus, store);
const theme = new Theme(bus, store);

// Shared context handed to every app on mount.
const ctx = {
  bus, store, fs, theme, apps: APPS, accents: ACCENTS, wallpapers: WALLPAPERS, version: VERSION,
};

const dialogs = new Dialogs(document.getElementById('dialogs'));

const wm = new WindowManager({ bus, layer: document.getElementById('windows'), apps: APPS, ctx });
const shell = new Shell({ bus, wm, fs, store, theme, apps: APPS, dialogs, version: VERSION });

/* Storage problems are reported by the Store; warn once instead of silently losing data. */
let storageWarned = false;
const warnStorage = (detail) => {
  if (storageWarned) return;
  storageWarned = true;
  shell.toast('Storage is not durable', detail, 'err');
};
/* One place decides what a storage failure means for the user. The store classifies the
   cause; this maps a cause to a sentence a person can act on — instead of pasting a
   browser's wording, which differs between engines. */
const STORAGE_MESSAGES = {
  quota: 'Storage is full. Recent changes will not survive a reload — Settings ▸ Storage shows what is stored.',
  serialisation: 'A setting could not be saved: its value is not data that can be stored.',
  unavailable: 'This browser is refusing all storage (private mode?). Changes will not survive a reload.',
  unknown: 'Storage refused a write. Changes may not survive a reload.',
};
bus.on('store:error', ({ kind }) => warnStorage(STORAGE_MESSAGES[kind] || STORAGE_MESSAGES.unknown));

Object.assign(ctx, {
  wm,
  shell,
  launch: (appId, opts) => shell.launch(appId, opts),
  openPath: (path, cwd) => shell.openPath(path, cwd),
  toast: (...args) => shell.toast(...args),
  dialogs,
  confirm: (opts) => dialogs.confirm(opts),
  prompt: (opts) => dialogs.prompt(opts),
});

/* Session restore: reopen the windows you had when the page last loaded. */
const saveLayout = debounce(() => store.save('layout', wm.serialize()), 400);
bus.on('win:created', saveLayout);
bus.on('win:closed', saveLayout);
bus.on('win:state', saveLayout);
window.addEventListener('beforeunload', () => store.save('layout', wm.serialize()));

async function boot() {
  if (!store.available) warnStorage('This browser blocks storage, so nothing you do will be saved.');
  const layout = store.load('layout');
  if (Array.isArray(layout) && layout.length) {
    await wm.restore(layout);
  } else {
    await shell.launch('welcome');
    store.save('layout', []);
  }
}

boot();

// Handy for poking at the OS from the devtools console.
window.browserOS = { bus, store, fs, theme, wm, shell, dialogs, apps: APPS, launch: ctx.launch, openPath: ctx.openPath };
