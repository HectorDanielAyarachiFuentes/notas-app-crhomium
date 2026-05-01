// browser-api.js - Polyfill para compatibilidad entre navegadores (Chrome, Edge, Opera)

// Opera y Firefox usan el namespace `browser`, mientras que Chrome y Edge usan `chrome`.
// Este código selecciona el que esté disponible.
const browserAPI = globalThis.browser || globalThis.chrome;

export default browserAPI;