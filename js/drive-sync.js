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
  const params = new URLSearchParams({
    q: `name='${NOTES_FILE_NAME}'`,
    // 'appDataFolder' es una carpeta oculta especial para datos de la aplicación.
    // El usuario no puede ver este archivo directamente en su Google Drive.
    spaces: 'appDataFolder', 
    fields: 'files(id)' // Pedimos solo el ID para optimizar la respuesta
  });
  const url = `${DRIVE_API_URL}/files?${params.toString()}`;

  try {
    const { response } = await driveApiRequest(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    }, token);

    // ¡Comprobación crucial! Asegurarse de que la respuesta fue exitosa.
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`La API de Drive respondió con error ${response.status}: ${errorBody}`);
    }

    const data = await response.json(); // Ahora 'response' es el objeto correcto
    const fileId = data.files.length > 0 ? data.files[0].id : null;
    console.log(fileId ? `Archivo encontrado con ID: ${fileId}` : "Archivo no encontrado.");
    return fileId;
  } catch (error) {
    // Si el error persiste después del reintento, lo lanzamos.
    throw new Error(`Error al buscar archivo: ${error.message}`);
  }
}

/**
 * Envuelve una solicitud a la API de Drive para manejar la reautenticación.
 * @param {string} url - La URL a la que se hará la solicitud.
 * @param {object} options - Las opciones para fetch().
 * @param {string} token - El token a usar.
 * @returns {Promise<Response>}
 */
async function driveApiRequest(url, options, initialToken) {
  let token = initialToken;
  let response = await fetch(url, options);

  if (response.status === 401) {
    console.warn("Token inválido o expirado. Reintentando con un nuevo token...");
    token = await getAuthToken(false); // Obtener nuevo token no interactivamente
    options.headers['Authorization'] = `Bearer ${token}`;
    response = await fetch(url, options); // Reintentar la solicitud
  }

  // Si la respuesta sigue sin ser exitosa (incluso después del reintento)
  if (!response.ok) {
    const errorBody = await response.text();
    // Intentamos parsear el error para dar un mensaje más útil
    try {
      const errorJson = JSON.parse(errorBody);
      if (response.status === 403 && errorJson.error?.details?.[0]?.reason === 'SERVICE_DISABLED') {
        throw new Error("La API de Google Drive no está habilitada en tu proyecto de Google Cloud. Por favor, actívala y vuelve a intentarlo.");
      }
      // Si es otro error, mostramos el mensaje de la API
      const errorMessage = errorJson.error?.message || errorBody;
      throw new Error(`Error ${response.status}: ${errorMessage}`);
    } catch (e) {
      // Si el cuerpo del error no es JSON o es nuestro error personalizado, lo relanzamos
      throw e.message.startsWith("La API de Google Drive") ? e : new Error(`Error ${response.status}: ${errorBody}`);
    }
  }
  return { response, token }; // Devolver también el token (puede ser el nuevo)
}

/**
 * Sube las notas a Google Drive. Crea el archivo si no existe.
 * @param {Array} notes - El array de notas a guardar.
 * @returns {Promise<void>}
 */
export async function uploadNotesToDrive(notes) {
  console.log("Iniciando subida de notas...");
  let { token } = await getAuthTokenAndInfo();
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

  const options = {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form
  };

  // Usamos el wrapper y actualizamos el token por si cambió
  const { response, token: newToken } = await driveApiRequest(uploadUrl, options, token);
  token = newToken;

  // La comprobación de !response.ok ya se hace dentro de driveApiRequest,
  // por lo que si llegamos aquí, la operación fue exitosa.
  // if (!response.ok) {
  //   const errorBody = await response.text();
  //   throw new Error(`Error al subir notas: ${response.statusText}. Detalles: ${errorBody}`);
  // }
  console.log("Notas subidas con éxito.");
}

/**
 * Descarga las notas desde Google Drive.
 * @returns {Promise<Array|null>} El array de notas o null si no hay archivo.
 */
export async function downloadNotesFromDrive() {
  console.log("Iniciando bajada de notas...");
  let { token } = await getAuthTokenAndInfo();
  const fileId = await findNotesFile(token);

  if (!fileId) {
    console.log('No se encontró archivo de notas en Google Drive.');
    return null;
  }

  const url = `${DRIVE_API_URL}/files/${fileId}?alt=media`;
  const options = {
    headers: { 'Authorization': `Bearer ${token}` }
  };
  // Usamos el wrapper y actualizamos el token por si cambió
  const { response, token: newToken } = await driveApiRequest(url, options, token);
  token = newToken;

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
export async function getAuthTokenAndInfo(interactive = false) {
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
  if (!browserAPI || !browserAPI.identity) {
    throw new Error("La API de identidad no está disponible.");
  }
  console.log("Intentando remover token y cerrar sesión...");
  try {
    // Primero, obtenemos el token actual para poder invalidarlo.
    const token = await getAuthToken(false);
    if (token) {
      // Invalidamos el token en la caché del navegador.
      await browserAPI.identity.removeCachedAuthToken({ token });
      // Invalidamos el token en los servidores de Google.
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      console.log("Token de autenticación invalidado.");
    }
  } catch (error) {
    // Aunque falle, continuamos para asegurar que la sesión se cierre en la extensión.
    console.warn("No se pudo invalidar el token (quizás ya había expirado):", error.message);
  }
}