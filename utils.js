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
    const { notes } = await browserAPI.storage.sync.get({ notes: [] });
    return notes;
  }
  // Fallback para desarrollo local usando localStorage
  console.warn("chrome.storage.sync no encontrado. Usando localStorage como alternativa.");
  const notesJSON = localStorage.getItem('notes');
  // Devuelve las notas parseadas o un array vacío
  return notesJSON ? JSON.parse(notesJSON) : [];
}

/**
 * Guarda un array de notas en el almacenamiento sincronizado.
 * @param {Array} notes - El array de notas a guardar.
 * @returns {Promise<void>}
 */
export async function saveNotes(notes) {
  if (browserAPI && browserAPI.storage) {
    // Usamos chrome.storage.sync para consistencia y aprovechamos la promesa nativa.
    return browserAPI.storage.sync.set({ notes });
  }
  // Fallback para desarrollo local
  console.warn("API de almacenamiento no encontrada. Usando localStorage como alternativa.");
  localStorage.setItem('notes', JSON.stringify(notes));
  return Promise.resolve(); // Simula el comportamiento asíncrono
}
