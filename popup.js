// popup.js - lógica para guardar/editar/eliminar notas usando chrome.storage.local
import { getNotes, saveNotes } from './utils.js';
import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive, getUserInfo, removeAuthToken } from './drive-sync.js';

const titleEl = document.getElementById('title');
const contentEl = document.getElementById('content');
const charCounterEl = document.getElementById('char-counter');
const saveBtn = document.getElementById('saveBtn');
const newBtn = document.getElementById('newBtn');
const notesList = document.getElementById('notesList');
const statusEl = document.getElementById('status');

const loginBtn = document.getElementById('login-btn');
const uploadBtn = document.getElementById('upload-btn');
const syncLoadingMsg = document.getElementById('sync-loading-msg');
const downloadBtn = document.getElementById('download-btn');
const syncLoggedOutMsg = document.getElementById('sync-logged-out-msg');

const userProfileEl = document.getElementById('user-profile');
const loginPromptEl = document.getElementById('login-prompt');
const userAvatarEl = document.getElementById('user-avatar');
const userEmailEl = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const autoSyncToggle = document.getElementById('auto-sync-toggle');

const tabs = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');
const searchInput = document.getElementById('search-input');

let editingId = null;
let statusTimeout = null;
let isAutoSyncEnabled = false;
let isLoggedIn = false;

function switchTab(targetTab) {
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === targetTab);
  });
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${targetTab}`);
  });
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    switchTab(targetTab);
    // La lógica de login ahora solo se activa con el botón,
    // no al cambiar de pestaña.
  });
});

function createNoteListItem(note) {
  const openNoteForEditing = () => {
    editingId = note.id;
    titleEl.value = note.title;
    contentEl.value = note.content;
    newBtn.textContent = 'Limpiar';
    status('Editando nota...', 'info', -1);
    switchTab('create');
    titleEl.focus();
    renderNotes(); // Re-render para mostrar el resaltado
  };

  const li = document.createElement('li');
  li.className = `noteItem ${note.id === editingId ? 'editing' : ''}`;
  
  const titleRow = document.createElement('div');
  titleRow.className = 'noteTitle';

  const tspan = document.createElement('span');
  tspan.textContent = note.title || '(Sin título)';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'fs-small text-muted'; // Usar clases en lugar de estilos en línea
  const date = new Date(note.updatedAt);
  timeSpan.textContent = date.toLocaleString();

  titleRow.appendChild(tspan);
  titleRow.appendChild(timeSpan);
  titleRow.addEventListener('click', openNoteForEditing);

  const text = document.createElement('div');
  text.className = 'noteText';
  text.textContent = note.content || '';
  text.addEventListener('click', openNoteForEditing);
  
  const controls = document.createElement('div');
  controls.className = 'noteControls';

  const openBtn = document.createElement('button');
  openBtn.className = 'btn-icon';
  openBtn.title = 'Editar nota';
  openBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Evita que el evento de clic se propague al li
    openNoteForEditing();
  });
  
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-icon delete';
  delBtn.title = 'Eliminar nota';
  delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
  delBtn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta nota?')) return;
    const notes = await getNotes();
    const filtered = notes.filter(x => x.id !== note.id);
    await saveNotes(filtered);
    renderNotes();
    if (editingId === note.id) clearEditor();
    status('Nota eliminada.', 'danger');
  });

  controls.appendChild(openBtn);
  controls.appendChild(delBtn);

  li.appendChild(titleRow);
  li.appendChild(text);
  li.appendChild(controls);

  return li;
}

async function renderNotes(filterText = '') {
  const notes = await getNotes();
  notesList.innerHTML = '';
  
  const lowerCaseFilter = filterText.toLowerCase();
  const filteredNotes = notes.filter(note => 
    note.title.toLowerCase().includes(lowerCaseFilter) || 
    note.content.toLowerCase().includes(lowerCaseFilter)
  );

  if (filteredNotes.length === 0) {
    notesList.innerHTML = '<li class="text-muted">No hay notas todavía.</li>';
    return;
  }
  // newest first
  filteredNotes.sort((a, b) => b.updatedAt - a.updatedAt);
  for (const note of filteredNotes) {
    notesList.appendChild(createNoteListItem(note));
  }
}

function status(text, type = 'info', timeout = 2000) {
  clearTimeout(statusTimeout); // Limpiar temporizador anterior
  statusEl.textContent = text || '';
  statusEl.className = `status ${type}`; // Aplicar clase para el color
  if (timeout !== -1) { // Usar -1 para un mensaje persistente
    statusTimeout = setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, timeout);
  }
}

function clearEditor() {
  editingId = null;
  titleEl.value = '';
  contentEl.value = '';
  newBtn.textContent = 'Nueva';
  titleEl.classList.remove('invalid');
  contentEl.classList.remove('invalid');
  status('Editor limpio.', 'info');
  renderNotes(); // Re-render para quitar cualquier resaltado
}

/**
 * Gestiona el estado de un botón durante una operación asíncrona.
 * @param {HTMLButtonElement} button - El botón a gestionar.
 * @param {boolean} isLoading - Si la operación está cargando.
 * @param {string} [loadingText='Cargando...'] - Texto a mostrar durante la carga.
 */
function setButtonLoading(button, isLoading, loadingText = 'Cargando...') {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText;
  }
}

saveBtn.addEventListener('click', async () => {
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  
  titleEl.classList.remove('invalid');
  contentEl.classList.remove('invalid');

  if (!title && !content) {
    titleEl.classList.add('invalid');
    contentEl.classList.add('invalid');
    status('La nota está vacía. Escribe algo.', 'danger');
    return;
  }
  setButtonLoading(saveBtn, true, 'Guardando...');

  const notes = await getNotes();
  const now = Date.now();

  if (editingId) {
    const noteToUpdate = notes.find(n => n.id === editingId);
    if (noteToUpdate) {
      noteToUpdate.title = title;
      noteToUpdate.content = content;
      noteToUpdate.updatedAt = now;
    } // Si no se encuentra, no hacemos nada, el editor se limpiará.
  } else {
    // Crear nueva nota
    notes.push({
      id: crypto.randomUUID(), // Usar UUID para IDs únicos
      title,
      content,
      createdAt: now,
      updatedAt: now
    });
  }

  try {
    await saveNotes(notes);
    renderNotes();
    status('Nota guardada.', 'success');

    if (isLoggedIn && isAutoSyncEnabled) {
      uploadNotesToDrive(notes).then(() => status('Nota sincronizada con Drive.', 'success', 1500));
    }

    clearEditor();
    switchTab('history');
  } finally {
    setButtonLoading(saveBtn, false);
  }
});

newBtn.addEventListener('click', () => {
  clearEditor();
  switchTab('create');
  titleEl.focus();
});

searchInput.addEventListener('input', (e) => {
  renderNotes(e.target.value);
});

contentEl.addEventListener('input', () => {
  charCounterEl.textContent = `${contentEl.value.length} caracteres`;
});

/**
 * Muestra el estado de la conexión en la pestaña de sincronización.
 * @param {boolean} isConnected - Si el usuario está conectado.
 * @param {Object} [userInfo] - La información del perfil del usuario si está conectado.
 */
function updateSyncUI(isConnected, userInfo = null) {
  isLoggedIn = isConnected;
  syncLoadingMsg.style.display = 'none';
  loginPromptEl.style.display = 'none';
  userAvatarEl.classList.remove('loading');

  const syncActionsEl = document.getElementById('sync-actions');
  if (isConnected) {
    userAvatarEl.src = userInfo.picture || '';
    userEmailEl.textContent = userInfo.email || 'Usuario';
    userProfileEl.style.display = 'flex';
    loginPromptEl.style.display = 'none';
    uploadBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'block';
    downloadBtn.style.display = 'inline-block';
    syncActionsEl.style.display = 'flex';
    syncLoggedOutMsg.style.display = 'none';
  } else {
    userProfileEl.style.display = 'none';
    loginPromptEl.style.display = 'block';
    uploadBtn.style.display = 'none'; // Ocultar si no está logueado
    downloadBtn.style.display = 'none';
    syncActionsEl.style.display = 'none';
    syncLoggedOutMsg.style.display = 'block';
  }
}

/**
 * Intenta iniciar sesión en Google Drive de forma interactiva.
 * @returns {Promise<boolean>} `true` si el login fue exitoso, `false` en caso contrario.
 */
async function loginToDrive() {
  console.log("Intentando login interactivo...");
  syncLoadingMsg.style.display = 'block';
  userAvatarEl.classList.add('loading');

  try {
    const { userInfo } = await getUserInfo(true); // Pide login interactivo
    console.log("Login exitoso.");
    updateSyncUI(true, userInfo);
    return true;
  } catch (error) {
    console.error("Error durante el login interactivo:", error);
    updateSyncUI(false); // Mostrar estado desconectado
    if (error.message.includes('Function unsupported')) {
      const operaErrorMsg = "Error en Opera: Instala el complemento 'Install Chrome Extensions' y reinicia el navegador.";
      status(operaErrorMsg, 'danger', 10000);
    } else if (!error.message.includes('user did not approve access')) {
      // No mostrar error si el usuario simplemente cerró la ventana de login
      status(`Error de conexión: ${error.message}`, 'danger', 5000);
    }
    return false;
  } finally {
    syncLoadingMsg.style.display = 'none';
    userAvatarEl.classList.remove('loading');
  }
}

/**
 * Gestiona la activación de la pestaña de sincronización.
 * Si el usuario ya está conectado, no hace nada. Si no, intenta el login.
 */
async function handleSyncTabActivation() {
  const loginSuccess = await loginToDrive();

  if (loginSuccess) {
    try {
      // Si el login es exitoso, preguntar si se desea bajar las notas.
      if (confirm('¿Deseas sincronizar y bajar las notas desde Google Drive ahora? Esto reemplazará tus notas locales.')) {
        await downloadNotes();
      }
    } catch (error) {
      console.error("Fallo al sincronizar después del login:", error);
      status(`Error de sincronización: ${error.message}`, 'danger', 5000);
    }
  }
}

if (loginBtn) loginBtn.addEventListener('click', handleSyncTabActivation);

uploadBtn.addEventListener('click', async () => {
  if (!confirm('Esto sobrescribirá las notas en Google Drive con tus notas locales. ¿Deseas continuar?')) return;
  setButtonLoading(uploadBtn, true);
  try {
    status('Subiendo notas...', 'info', -1);
    const localNotes = await getNotes();
    await uploadNotesToDrive(localNotes);
    status('Notas subidas a Google Drive con éxito.', 'success');
  } catch (error) {
    updateSyncUI(false); // Si hay error de token, reflejarlo en la UI
    console.error("Error al subir notas:", error);
    status(`Error al subir: ${error.message}`, 'danger', 5000);
  } finally {
    setButtonLoading(uploadBtn, false);
  }
});

/**
 * Lógica para descargar y guardar las notas.
 */
async function downloadNotes() {
  setButtonLoading(downloadBtn, true);
  status('Bajando notas...', 'info', -1);
  const driveNotes = await downloadNotesFromDrive();
  if (driveNotes) {
    await saveNotes(driveNotes);
    await renderNotes(); // Actualizar la lista en la pestaña de historial
    status('Notas bajadas de Google Drive con éxito.', 'success');
  } else {
    status('No se encontraron notas en Google Drive para bajar.', 'info');
  }
  setButtonLoading(downloadBtn, false);
}

downloadBtn.addEventListener('click', async () => {
  if (!confirm('Esto reemplazará tus notas locales con las de Google Drive. ¿Deseas continuar?')) return;
  try {
    await downloadNotes();
  } catch (error) {
    updateSyncUI(false); // Si hay error de token, reflejarlo en la UI
    console.error("Error al bajar notas:", error);
    status(`Error al bajar: ${error.message}`, 'danger', 5000);
    setButtonLoading(downloadBtn, false); // Asegurarse de reactivar el botón en caso de error
  }
});

logoutBtn.addEventListener('click', async () => {
  if (!confirm('¿Deseas cerrar la sesión de Google?')) return;
  try {
    status('Cerrando sesión...', 'info', -1);
    await removeAuthToken();
    updateSyncUI(false);
    status('Sesión cerrada con éxito.', 'success');
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    status(`Error al cerrar sesión: ${error.message}`, 'danger', 5000);
  }
  // El botón de logout se oculta en updateSyncUI, no necesita reset.
});

autoSyncToggle.addEventListener('change', async (e) => {
  isAutoSyncEnabled = e.target.checked;
  await browserAPI.storage.sync.set({ autoSyncEnabled: isAutoSyncEnabled });
  if (isAutoSyncEnabled) {
    status('Sincronización automática activada.', 'success');
    autoSyncNotes();
  } else {
    status('Sincronización automática desactivada.', 'info');
  }
});

/**
 * Comprueba el estado de la conexión de sincronización al inicio sin interacción del usuario.
 */
async function checkInitialSyncStatus() {
  try {
    userAvatarEl.classList.add('loading');
    // Intenta obtener el token sin mostrar popup de login.
    // Si el usuario ya ha dado permisos, esto funcionará.
    const { userInfo } = await getUserInfo(false);
    updateSyncUI(true, userInfo);
    // Una vez logueado, comprobar si la auto-sincronización debe ejecutarse
    if (isAutoSyncEnabled) {
      await autoSyncNotes();
    }
  } catch (error) {
    // Es normal que falle si el usuario no está conectado, no es necesario mostrar un error.
    console.log("Comprobación inicial: Usuario no conectado a Google Drive.", error.message);
    updateSyncUI(false);
  } finally {
    userAvatarEl.classList.remove('loading');
  }
}

/**
 * Sincroniza las notas fusionando las locales y las de Drive.
 */
async function autoSyncNotes() {
  if (!isLoggedIn || !isAutoSyncEnabled) return;

  status('Sincronizando notas...', 'info', -1);
  try {
    const localNotes = await getNotes();
    const driveNotes = await downloadNotesFromDrive();

    if (!driveNotes) { // No hay notas en drive, subir las locales
      await uploadNotesToDrive(localNotes);
      status('Notas locales subidas a Drive.', 'success');
      return;
    }

    // Lógica de fusión
    const notesMap = new Map();
    [...localNotes, ...driveNotes].forEach(note => {
      const existing = notesMap.get(note.id);
      if (!existing || note.updatedAt > existing.updatedAt) {
        notesMap.set(note.id, note);
      }
    });

    const mergedNotes = Array.from(notesMap.values());
    await saveNotes(mergedNotes); // Guardar localmente
    await uploadNotesToDrive(mergedNotes); // Subir a Drive
    await renderNotes();
    status('Notas sincronizadas con éxito.', 'success');
  } catch (error) {
    status(`Error de sincronización: ${error.message}`, 'danger', 5000);
  }
}

/**
 * Función principal de inicialización.
 * Se ejecuta cuando el DOM está completamente cargado.
 */
async function init() {
  // 0. Cargar configuración de auto-sincronización
  const { autoSyncEnabled } = await browserAPI.storage.sync.get({ autoSyncEnabled: false });
  isAutoSyncEnabled = autoSyncEnabled;
  autoSyncToggle.checked = isAutoSyncEnabled;

  // 1. Renderizar la lista de notas en la pestaña de historial.
  charCounterEl.textContent = `${contentEl.value.length} caracteres`;
  renderNotes();

  // 2. Comprobar el estado de la conexión de Google Drive en segundo plano.
  await checkInitialSyncStatus();

  // 3. Asegurarse de que la pestaña correcta esté visible al inicio.
  // (El HTML ya define 'history' como activa, pero esto lo haría más robusto si cambiara)
  // switchTab('history');
}

// Esperar a que el DOM esté completamente cargado para ejecutar el script.
// Esto asegura que todos los elementos HTML están disponibles.
document.addEventListener('DOMContentLoaded', init);