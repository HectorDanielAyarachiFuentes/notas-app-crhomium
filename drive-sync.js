// drive-sync.js - Lógica para la sincronización con Google Drive
import browserAPI from './browser-api.js';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
const NOTES_FILE_NAME = 'notes_extension_data.json';

/**
 * Obtiene un token de autenticación de OAuth2.
 * @returns {Promise<string>} El token de acceso.
 * @param {boolean} interactive - Si se debe mostrar un popup de login al usuario.
 */
function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    // Añadimos una guarda para asegurarnos de que la API existe.
    if (!browserAPI || !browserAPI.identity) {
      return reject(new Error("La API de identidad no está disponible. Asegúrate de ejecutar esto como una extensión."));
    }

    console.log(`getAuthToken, interactive: ${interactive}`);
    browserAPI.identity.getAuthToken({ interactive }, (token) => {
      if (browserAPI.runtime.lastError) {
        reject(new Error(`getAuthToken Error: ${browserAPI.runtime.lastError.message}`));
      } else {
        console.log("Token obtenido con éxito.");
        resolve(token);
      }
    });
  });
}

/**
 * Busca el archivo de notas en el espacio de la aplicación en Google Drive.
 * @param {string} token - El token de autenticación.
 * @returns {Promise<string|null>} El ID del archivo si se encuentra, o null.
 */
async function findNotesFile(token) {
  console.log("Buscando archivo de notas en Drive...");
  const response = await fetch(`${DRIVE_API_URL}/files?q=name='${NOTES_FILE_NAME}'&spaces=appDataFolder`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`Error al buscar archivo: ${response.statusText}`);
  const data = await response.json();
  const fileId = data.files.length > 0 ? data.files[0].id : null;
  console.log(fileId ? `Archivo encontrado con ID: ${fileId}` : "Archivo no encontrado.");
  return data.files.length > 0 ? data.files[0].id : null;
}

/**
 * Sube las notas a Google Drive. Crea el archivo si no existe.
 * @param {Array} notes - El array de notas a guardar.
 * @returns {Promise<void>}
 */
export async function uploadNotesToDrive(notes) {
  console.log("Iniciando subida de notas...");
  const token = await getAuthToken();
  const fileId = await findNotesFile(token);
  const notesJSON = JSON.stringify(notes);
  const blob = new Blob([notesJSON], { type: 'application/json' });

  const metadata = {
    name: NOTES_FILE_NAME,
    mimeType: 'application/json',
  };

  // Si el archivo no existe, lo creamos en el appDataFolder
  if (!fileId) {
    metadata.parents = ['appDataFolder'];
  }

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const uploadUrl = fileId
    ? `${DRIVE_UPLOAD_URL}/files/${fileId}?uploadType=multipart` // Actualizar
    : `${DRIVE_UPLOAD_URL}/files?uploadType=multipart`; // Crear

  const response = await fetch(uploadUrl, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error al subir notas: ${response.statusText}. Detalles: ${errorBody}`);
  }
  console.log("Notas subidas con éxito.");
}

/**
 * Descarga las notas desde Google Drive.
 * @returns {Promise<Array|null>} El array de notas o null si no hay archivo.
 */
export async function downloadNotesFromDrive() {
  console.log("Iniciando bajada de notas...");
  const token = await getAuthToken();
  const fileId = await findNotesFile(token);

  if (!fileId) {
    console.log('No se encontró archivo de notas en Google Drive.');
    return null;
  }

  const response = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error al descargar notas: ${response.statusText}. Detalles: ${errorBody}`);
  }

  const notes = await response.json();
  console.log("Notas bajadas con éxito.");
  return notes;
}

/**
 * Obtiene la información del usuario para mostrar en la UI.
 * Devuelve tanto el token como la información del perfil.
 * @param {boolean} interactive - Si se debe mostrar un popup de login al usuario.
 * @returns {Promise<{token: string, userInfo: Object}>} El token y la información del usuario.
 */
export async function getUserInfo(interactive = false) {
    console.log("Obteniendo información del usuario...");
    const token = await getAuthToken(interactive);
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Error al obtener info de usuario: ${response.statusText}`);
    }
    const userInfo = await response.json();
    return { token, userInfo };
}

/**
 * Elimina el token de autenticación de la caché del navegador.
 * @returns {Promise<void>}
 */
export async function removeAuthToken() {
  return new Promise(async (resolve, reject) => {
    if (!browserAPI || !browserAPI.identity) {
      return reject(new Error("La API de identidad no está disponible."));
    }
    console.log("Intentando remover token de la caché...");
    try {
      const token = await getAuthToken(false); // Obtener token actual para removerlo
      await browserAPI.identity.removeCachedAuthToken({ token });
      console.log("Token removido de la caché.");
      resolve();
    } catch (error) {
      console.error("Error al remover el token:", error.message);
      reject(error);
    }
  });
}