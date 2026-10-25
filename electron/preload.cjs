'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, ...args) => ipcRenderer.invoke(`vault:${method}`, ...args);
contextBridge.exposeInMainWorld('vault', {
  initialize: () => invoke('initialize'),
  preparePublish: (target,options) => invoke('prepare-publish',target,options),
  publishNote: (target,options,digest) => invoke('publish-note',target,options,digest),
  listPublications: () => invoke('list-publications'),
  unpublishNote: id => invoke('unpublish-note',id),
  copyPublishLink: id => invoke('copy-publish-link',id),
  openPublishedNote: id => invoke('open-published-note',id),
  snapshot: () => invoke('snapshot'),
  createNote: (path, content) => invoke('create-note', path, content),
  writeNote: (path, content) => invoke('write-note', path, content),
  renameNote: (oldPath, newPath) => invoke('rename-note', oldPath, newPath),
  trashNote: path => invoke('trash-note', path),
  createFolder: path => invoke('create-folder', path),
  openVault: () => invoke('open-vault'),
  createVault: () => invoke('create-vault'),
  revealVault: () => invoke('reveal-vault'),
  onMenuAction: callback => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('vault:menu-action', listener);
    return () => ipcRenderer.removeListener('vault:menu-action', listener);
  },
  onBeforeClose: callback => {
    const listener = () => callback();
    ipcRenderer.on('vault:before-close', listener);
    return () => ipcRenderer.removeListener('vault:before-close', listener);
  },
  readyToClose: () => invoke('ready-to-close'),
  rendererReady: () => invoke('renderer-ready'),
  openDocument: file => invoke('open-document', file),
  onOpenDocument: callback => {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on('vault:open-document', listener);
    return () => ipcRenderer.removeListener('vault:open-document', listener);
  },
});
