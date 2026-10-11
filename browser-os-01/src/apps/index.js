import welcome from './welcome.js';
import terminal from './terminal.js';
import files from './files.js';
import editor from './editor.js';
import viewer from './viewer.js';
import paint from './paint.js';
import calc from './calc.js';
import settings from './settings.js';
import web from './web.js';

// Order matters: it is the order shown in the Start menu and on the desktop.
export const APPS = [
  welcome,
  terminal,
  files,
  editor,
  viewer,
  paint,
  calc,
  web,
  settings,
].map((app) => ({ ...app, shortcut: app.shortcut ?? (app.id !== 'welcome') }));
