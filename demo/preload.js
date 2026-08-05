const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getInit: () => ipcRenderer.invoke('get-init'),
  cycleCharacter: () => ipcRenderer.invoke('cycle-character'),
  // キャラクター設定ウィンドウ
  openCharacterManager: () => ipcRenderer.send('open-character-manager'),
  listCharactersFull: () => ipcRenderer.invoke('list-characters-full'),
  selectCharacter: (id) => ipcRenderer.invoke('select-character', id),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  createCharacter: (payload) => ipcRenderer.invoke('create-character', payload),
  deleteCharacter: (id) => ipcRenderer.invoke('delete-character', id),
  // 図鑑（151の保存枠）と進化
  listDex: () => ipcRenderer.invoke('list-dex'),
  selectDex: (no) => ipcRenderer.invoke('select-dex', no),
  createDexCharacter: (payload) => ipcRenderer.invoke('create-dex-character', payload),
  deleteDexOverride: (no) => ipcRenderer.invoke('delete-dex-override', no),
  addProgress: (pts) => ipcRenderer.invoke('add-progress', pts),
  getProgress: () => ipcRenderer.invoke('get-progress'),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', { dx, dy }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setMouseIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  onEvent: (cb) => ipcRenderer.on('pet-event', (_e, data) => cb(data)),
});
