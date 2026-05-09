// drive-sync.js - Lógica para la sincronización con Google Drive
import browserAPI from './browser-api.js';

const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3';
const NOTES_FILE_NAME = 'notes_extension_data.json';
const TOKEN_CACHE_KEY = 'cached_oauth_token';

let memoryToken = null; // Caché en memoria para la sesión actual del popup

/**
 * Obtiene un token de autenticación de OAuth2 mediante WebAuthFlow.
 * Alternativa para navegadores que no soportan getAuthToken nativo (ej. Opera, Edge).
 */
async function getAuthTokenWebFlow(interactive) {
  const manifest = browserAPI.runtime.getManifest();
  const clientId = "262441099949-o76obmtc9pncv801urk1elsqrglh9uaf.apps.googleusercontent.com";
  
  // Recuperar el correo guardado para la persistencia
  const storage = await browserAPI.storage.local.get("cached_user_email");
  const userEmail = storage.cached_user_email;

  const scopes = encodeURIComponent(manifest.oauth2.scopes.join(' '));
  const redirectUri = encodeURIComponent("https://fokahhfcbgbncigpkkdgmhimcfjbjlbl.chromiumapp.org/");
  
  let authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=${scopes}`;
  
  if (interactive) {
      authUrl += '&prompt=select_account';
  } else if (userEmail) {
      // Truco de persistencia: si tenemos el correo, intentamos entrar sin preguntar
      authUrl += `&login_hint=${encodeURIComponent(userEmail)}&prompt=none`;
  }

  return new Promise((resolve, reject) => {
    browserAPI.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: interactive
    }, async (responseUrl) => {
      if (browserAPI.runtime.lastError) {
        return reject(new Error(browserAPI.runtime.lastError.message));
      }
      if (!responseUrl) return reject(new Error("No response URL"));

      try {
        const url = new URL(responseUrl);
        const params = new URLSearchParams(url.hash.substring(1));
        const token = params.get('access_token');
        const expiresIn = params.get('expires_in') || '3600';

        if (token) {
          memoryToken = token;
          const expiryTime = Date.now() + (parseInt(expiresIn) * 1000);
          await browserAPI.storage.local.set({ 
            "cached_oauth_token": token,
            "cached_oauth_expiry": expiryTime
          });
          resolve(token);
        } else {
          reject(new Error("No token in response"));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Obtiene un token de autenticación de OAuth2.
 * @returns {Promise<string>} El token de acceso.
 * @param {boolean} interactive - Si se debe mostrar un popup de login al usuario.
 */
function getAuthToken(interactive = false) {
  return new Promise(async (resolve, reject) => {
    // Añadimos una guarda para asegurarnos de que la API existe.
    if (!browserAPI || !browserAPI.identity) {
      return reject(new Error("La API de identidad no está disponible. Asegúrate de ejecutar esto como una extensión."));
    }

    // 1. Intentar usar el token en memoria si no es una solicitud interactiva
    if (!interactive && memoryToken) {
      console.log("Usando token de memoria...");
      return resolve(memoryToken);
    }

    // 2. Intentar recuperar el token del almacenamiento local
    if (!interactive) {
      const storage = await browserAPI.storage.local.get(TOKEN_CACHE_KEY);
      if (storage[TOKEN_CACHE_KEY]) {
        console.log("Usando token de almacenamiento local...");
        memoryToken = storage[TOKEN_CACHE_KEY];
        return resolve(memoryToken);
      }
    }

    console.log(`getAuthToken, interactive: ${interactive}`);
    
    if (typeof browserAPI.identity.getAuthToken === 'function') {
      try {
        browserAPI.identity.getAuthToken({ interactive }, async (token) => {
          if (browserAPI.runtime.lastError) {
            const errorMsg = browserAPI.runtime.lastError.message || '';
            console.log(`getAuthToken nativo falló: ${errorMsg}`);
            
            if (errorMsg.includes('Function unsupported') || errorMsg.includes('not supported')) {
              console.log("Usando fallback de WebAuthFlow para este navegador...");
              getAuthTokenWebFlow(interactive).then(resolve).catch(reject);
            } else {
              reject(new Error(`getAuthToken Error: ${errorMsg}`));
            }
          } else {
            console.log("Token obtenido con éxito (nativo).");
            memoryToken = token;
            await browserAPI.storage.local.set({ [TOKEN_CACHE_KEY]: token });
            resolve(token);
          }
        });
      } catch (err) {
        console.log("Error al llamar a getAuthToken, usando fallback:", err.message);
        getAuthTokenWebFlow(interactive).then(resolve).catch(reject);
      }
    } else {
      console.log("getAuthToken no existe. Usando fallback de WebAuthFlow...");
      getAuthTokenWebFlow(interactive).then(resolve).catch(reject);
    }
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
    console.log("Token inválido o expirado. Reintentando con un nuevo token...");
    // Limpiar caché al recibir 401 para forzar la obtención de uno nuevo
    memoryToken = null;
    await browserAPI.storage.local.remove(TOKEN_CACHE_KEY);

    // Invalidar el token en la caché nativa del navegador para forzar uno nuevo
    if (browserAPI.identity && browserAPI.identity.removeCachedAuthToken) {
      await new Promise(resolve => browserAPI.identity.removeCachedAuthToken({ token: token }, () => {
        if (browserAPI.runtime.lastError) {
          console.log("removeCachedAuthToken info:", browserAPI.runtime.lastError.message);
        }
        resolve();
      }));
    }
    
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
  let token = await getAuthToken();
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
  let token = await getAuthToken();
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
    let token = await getAuthToken(interactive);
    
    let response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 401) {
        console.log("Token de usuario expirado. Reintentando...");
        memoryToken = null;
        await browserAPI.storage.local.remove(TOKEN_CACHE_KEY);

        // Invalidar el token en la caché nativa del navegador para forzar uno nuevo
        if (browserAPI.identity && browserAPI.identity.removeCachedAuthToken) {
            await new Promise(resolve => browserAPI.identity.removeCachedAuthToken({ token: token }, () => {
                if (browserAPI.runtime.lastError) { /* Silencioso */ }
                resolve();
            }));
        }

        token = await getAuthToken(interactive);
        response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    }

    if (!response.ok) {
      const statusText = response.statusText || `Status ${response.status}`;
      throw new Error(`Error al obtener info de usuario: ${statusText}`);
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
      // Limpiar caché local
      memoryToken = null;
      await browserAPI.storage.local.remove(TOKEN_CACHE_KEY);

      // Invalidamos el token en la caché del navegador, si está soportado.
      if (browserAPI.identity.removeCachedAuthToken) {
        try {
          await new Promise((resolve) => browserAPI.identity.removeCachedAuthToken({ token }, () => {
            if (browserAPI.runtime.lastError) {
              console.log("Sesión local removida con aviso:", browserAPI.runtime.lastError.message);
            }
            resolve();
          }));
        } catch (e) {
          console.warn("removeCachedAuthToken falló:", e.message);
        }
      }
      // Invalidamos el token en los servidores de Google.
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
      console.log("Token de autenticación invalidado.");
    }
  } catch (error) {
    // Aunque falle, continuamos para asegurar que la sesión se cierre en la extensión.
    console.warn("No se pudo invalidar el token (quizás ya había expirado o estamos usando WebAuthFlow):", error.message);
  }
}