// utils.js - helper functions
import browserAPI from './browser-api.js';

/**
 * Obtiene las notas del almacenamiento sincronizado.
 * Devuelve un array de notas o un array vacío si no hay ninguna.
 * @returns {Promise<Array>}
 */
export async function getNotes() {
  // Comprueba si la API de la extensión está disponible
  if (browserAPI && browserAPI.storage) {
    // Usamos la versión moderna de la API que devuelve una promesa.
    // El objeto {notes: []} establece un valor predeterminado si 'notes' no existe.
    // Usamos local para evitar los límites estrictos de cuota de sync.
    const { notes } = await browserAPI.storage.local.get({ notes: [] });
    return notes;
  }
  // Fallback para desarrollo local (solo si estamos en un contexto con window/localStorage)
  if (typeof localStorage !== 'undefined') {
    console.warn("chrome.storage.sync no encontrado. Usando localStorage como alternativa.");
    const notesJSON = localStorage.getItem('notes');
    return notesJSON ? JSON.parse(notesJSON) : [];
  }
  
  return [];
}

/**
 * Guarda un array de notas en el almacenamiento sincronizado.
 * @param {Array} notes - El array de notas a guardar.
 * @returns {Promise<void>}
 */
export async function saveNotes(notes) {
  if (browserAPI && browserAPI.storage) {
    // Usamos chrome.storage.sync para consistencia y aprovechamos la promesa nativa.
    // Usamos local para mayor capacidad y velocidad.
    return browserAPI.storage.local.set({ notes });
  }
  // Fallback para desarrollo local
  if (typeof localStorage !== 'undefined') {
    console.warn("API de almacenamiento no encontrada. Usando localStorage como alternativa.");
    localStorage.setItem('notes', JSON.stringify(notes));
  }
  return Promise.resolve(); // Simula el comportamiento asíncrono
}
