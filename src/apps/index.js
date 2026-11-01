// Every app that ships with TridOS. Only the App Store is installed at first; Settings opens from the  menu.

import appstore from './appstore.js';
import finder from './finder.js';
import terminal from './terminal.js';
import editor from './editor.js';
import grapher from './grapher.js';
import studio from './studio.js';
import settings from './settings.js';

export function loadBuiltinApps() {
  const list = [appstore, finder, terminal, editor, grapher, studio, settings];
  return Object.fromEntries(list.map((a) => [a.id, a]));
}
