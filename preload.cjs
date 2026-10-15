/* The only bridge between the overlay pages and the app: a few named calls, no Node access. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oakenDesktop', {
  /** cut-outs of the calibrated shop / tower boxes from a screenshot of the game display */
  capture: () => ipcRenderer.invoke('capture'),
  state: () => ipcRenderer.invoke('state'),
  /** save calibration / switches (shop, tower, scan, autoTower) */
  set: (patch) => ipcRenderer.invoke('set', patch),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  /** panel → hints layer: the badges above the shop items */
  sendHints: (data) => ipcRenderer.send('hints', data),
  onHints: (fn) => ipcRenderer.on('hints', (_e, d) => fn(d)),
  /** the shared plan (also used by the website planner when linked) */
  getPlan: () => ipcRenderer.invoke('plan:get'),
  setPlan: (p) => ipcRenderer.send('plan:set', p),
  onPlan: (fn) => ipcRenderer.on('plan', (_e, m) => fn(m)),
  calibrate: () => ipcRenderer.send('calibrate'),
  calibrated: () => ipcRenderer.send('calibrated'),
  lock: (on) => ipcRenderer.send('lock', !!on),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  /** save a snapshot (pictures + what was read) and open its folder */
  snapshot: (d) => ipcRenderer.invoke('snapshot', d),
});
