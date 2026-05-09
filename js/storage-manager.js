// storage-manager.js
// Capa de abstracción de almacenamiento.
// Todos los módulos leen/escriben notas a través de este módulo.
// Decide internamente si usar chrome.storage.local (modo local) o Google Drive.

import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive } from './drive-sync.js';

const MODE_KEY        = 'storage_mode';        // 'local' | 'drive'
const NOTES_LOCAL_KEY = 'notes';               // clave en chrome.storage.local
const PROFILE_KEY     = 'local_user_profile';  // nombre e ícono personalizados

/** @typedef {'local'|'drive'} StorageMode */

// ─────────────────────────────────────────────
// Modo activo
// ─────────────────────────────────────────────

/**
 * Devuelve el modo activo guardado ('local' por defecto).
 * @returns {Promise<StorageMode>}
 */
export async function getStorageMode() {
  const { [MODE_KEY]: mode } = await browserAPI.storage.local.get({ [MODE_KEY]: 'local' });
  return mode;
}

/**
 * Cambia el modo de almacenamiento activo.
 * @param {StorageMode} mode
 */
export async function setStorageMode(mode) {
  return new Promise(resolve => {
    browserAPI.storage.local.set({ [MODE_KEY]: mode }, () => {
      if (browserAPI.runtime.lastError) { /* Ignorar */ }
      resolve();
    });
  });
}

// ─────────────────────────────────────────────
// CRUD de notas
// ─────────────────────────────────────────────

/**
 * Obtiene las notas según el modo activo.
 * @returns {Promise<Array>}
 */
export async function getNotes() {
  const mode = await getStorageMode();

  if (mode === 'drive') {
    try {
      const driveNotes = await downloadNotesFromDrive();
      return driveNotes ?? [];
    } catch (err) {
      console.log('[StorageManager] Drive no disponible, usando caché local:', err.message);
      // Fallback a local si Drive falla (p.ej. sin internet)
      const { [NOTES_LOCAL_KEY]: notes = [] } = await browserAPI.storage.local.get({ [NOTES_LOCAL_KEY]: [] });
      return notes;
    }
  }

  // Modo local
  const { [NOTES_LOCAL_KEY]: notes = [] } = await browserAPI.storage.local.get({ [NOTES_LOCAL_KEY]: [] });
  return notes;
}

/**
 * Guarda las notas según el modo activo.
 * En modo Drive también escribe la caché local para offline/fallback.
 * @param {Array} notes
 */
export async function saveNotes(notes) {
  const mode = await getStorageMode();

  // Siempre guardar en local como caché/respaldo
  await new Promise(resolve => {
    browserAPI.storage.local.set({ [NOTES_LOCAL_KEY]: notes }, () => {
      if (browserAPI.runtime.lastError) { /* Ignorar */ }
      resolve();
    });
  });

  if (mode === 'drive') {
    try {
      await uploadNotesToDrive(notes);
    } catch (err) {
      console.log('[StorageManager] No se pudo subir a Drive:', err.message);
      throw err; // Propagar para que el UI pueda mostrar el error
    }
  }
}

// ─────────────────────────────────────────────
// Fusión local ↔ Drive
// ─────────────────────────────────────────────

/**
 * Fusiona notas locales con las de Drive usando la estrategia "última edición gana".
 * Sube el resultado a Drive y actualiza el caché local.
 * @returns {Promise<Array>} El array fusionado
 */
export async function mergeLocalWithDrive() {
  const localNotes = await getLocalNotes();
  let driveNotes = [];

  try {
    driveNotes = (await downloadNotesFromDrive()) ?? [];
  } catch {
    // Drive vacío o sin conexión, usamos solo las locales
  }

  const notesMap = new Map();
  [...localNotes, ...driveNotes].forEach(note => {
    if (!note.id) return;
    const existing = notesMap.get(note.id);
    if (!existing || note.updatedAt > existing.updatedAt) {
      notesMap.set(note.id, note);
    }
  });

  const merged = Array.from(notesMap.values());
  // Guardar fusión tanto en local como en Drive
  await new Promise(resolve => {
    browserAPI.storage.local.set({ [NOTES_LOCAL_KEY]: merged }, () => {
      if (browserAPI.runtime.lastError) { /* Ignorar */ }
      resolve();
    });
  });
  
  try {
    await uploadNotesToDrive(merged);
  } catch (err) {
    console.log('[StorageManager] No se pudo subir el resultado de la fusión a Drive:', err.message);
    // No lanzamos error aquí porque ya guardamos en local y la fusión se completó.
    // El usuario verá sus notas actualizadas en local.
  }
  
  return merged;
}

/**
 * Devuelve SIEMPRE las notas del almacenamiento local (independiente del modo).
 * Útil para preguntar si hay notas locales antes de iniciar sesión.
 * @returns {Promise<Array>}
 */
export async function getLocalNotes() {
  const { [NOTES_LOCAL_KEY]: notes = [] } = await browserAPI.storage.local.get({ [NOTES_LOCAL_KEY]: [] });
  return notes;
}

// ─────────────────────────────────────────────
// Perfil local (nombre + emoji/ícono)
// ─────────────────────────────────────────────

/**
 * Devuelve el perfil de usuario local personalizado.
 * @returns {Promise<{name: string, icon: string}>}
 */
export async function getLocalProfile() {
  const { [PROFILE_KEY]: profile } = await browserAPI.storage.local.get({
    [PROFILE_KEY]: { name: 'Mi Espacio', icon: '📝' }
  });
  return profile;
}

/**
 * Guarda el perfil de usuario local.
 * @param {{ name: string, icon: string }} profile
 */
export async function saveLocalProfile(profile) {
  await new Promise(resolve => {
    browserAPI.storage.local.set({ [PROFILE_KEY]: profile }, () => {
      if (browserAPI.runtime.lastError) { /* Ignorar */ }
      resolve();
    });
  });
}
