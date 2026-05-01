// background.js - opcional: por ahora solo registra la instalación
import browserAPI from './browser-api.js';

browserAPI.runtime.onInstalled.addListener(() => {
  console.log('Notas extension installed.');
});
