// Every app that ships with TridOS. Only the App Store is installed at first; Settings opens from the  menu.

import appstore from './appstore.js';
import finder from './finder.js';
import terminal from './terminal.js';
import editor from './editor.js';
import grapher from './grapher.js';
import studio from './studio.js';
import settings from './settings.js';
import distributor from './distributor.js';
import tricycle from './tricycle.js';
import clock from './clock.js';
import { calculator, converter, calendar } from './utilities.js';

import { notes, colorPicker } from './productivity.js';
import { monitor, diskUsage } from './monitor.js';
import spreadsheets from './spreadsheet.js';

export function loadBuiltinApps() {
  const list = [appstore, finder, terminal, editor, grapher, studio, distributor, settings, tricycle, clock, calculator, converter, calendar, notes, colorPicker, monitor, diskUsage, spreadsheets];
  return Object.fromEntries(list.map((a) => [a.id, a]));
}
