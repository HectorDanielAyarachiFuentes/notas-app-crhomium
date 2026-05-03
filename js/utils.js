// utils.js - helper functions
// Re-exporta desde storage-manager para mantener compatibilidad hacia atrás.
// background.js y otros módulos que importen desde aquí siguen funcionando sin cambios.
export { getNotes, saveNotes } from './storage-manager.js';

