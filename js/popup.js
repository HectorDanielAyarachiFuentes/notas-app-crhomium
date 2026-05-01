// popup.js - lógica para guardar/editar/eliminar notas usando chrome.storage.local
import { getNotes, saveNotes } from './utils.js';
import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive, getAuthTokenAndInfo, removeAuthToken } from './drive-sync.js';

const titleEl = document.getElementById('title');
const contentEl = document.getElementById('content');
const charCounterEl = document.getElementById('char-counter');
const saveBtn = document.getElementById('saveBtn');
const editorTitleEl = document.getElementById('editor-title');
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
const userNameEl = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');
const autoSyncToggle = document.getElementById('auto-sync-toggle');

const tabs = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');
const searchInput = document.getElementById('search-input');
const settingsBtn = document.getElementById('settings-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
const versionSpan = document.getElementById('extension-version');
const themeSelector = document.getElementById('theme-selector');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');
const syncTabLoginBtn = document.getElementById('sync-tab-login-btn');
const syncTabExportBtn = document.getElementById('sync-tab-export-btn');
const pinBtn = document.getElementById('pin-btn');

let editingId = null;
let statusTimeout = null;
let autoSaveTimeout = null;
let isAutoSyncEnabled = false;
let isLoggedIn = false;

function switchTab(targetTab) {
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === targetTab);
  });
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${targetTab}`);
  });
  
  // Add a small bounce effect to the active panel
  const activePanel = document.getElementById(`tab-${targetTab}`);
  activePanel.style.animation = 'none';
  activePanel.offsetHeight; // trigger reflow
  activePanel.style.animation = 'fadeIn 0.4s ease-out';
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
    editorTitleEl.textContent = 'Editar nota';
    newBtn.innerHTML = 'Cancelar'; 
    newBtn.classList.add('danger-text');
    status('Editando nota...', 'info', -1);
    switchTab('create');
    titleEl.focus();
    updateCharCount(); // Actualizar contador al abrir
    renderNotes(); // Re-render para mostrar el resaltado
  };

  const li = document.createElement('li');
  li.className = `noteItem ${note.id === editingId ? 'editing' : ''}`;
  
  const title = document.createElement('div');
  title.className = 'noteTitle';
  title.textContent = note.title || '(Sin título)';

  const text = document.createElement('div');
  text.className = 'noteText';
  text.textContent = note.content || '';

  const dateEl = document.createElement('div');
  dateEl.className = 'noteDate';
  const date = new Date(note.updatedAt);
  dateEl.textContent = date.toLocaleString();

  title.addEventListener('click', openNoteForEditing);
  text.addEventListener('click', openNoteForEditing);
  dateEl.addEventListener('click', openNoteForEditing);
  
  const controls = document.createElement('div');
  controls.className = 'noteControls';

  const openBtn = document.createElement('button');
  openBtn.className = 'btn-icon';
  openBtn.title = 'Editar nota';
  openBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation(); 
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

  li.appendChild(title);
  li.appendChild(text);
  li.appendChild(dateEl);
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
    notesList.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 40px; opacity: 0.5;">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="13" x2="15" y2="13"></line><line x1="9" y1="17" x2="15" y2="17"></line><line x1="9" y1="9" x2="10" y2="9"></line></svg>
        <p>No se encontraron notas</p>
      </div>
    `;
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
  editorTitleEl.textContent = 'Nueva Nota';
  newBtn.innerHTML = 'Limpiar';
  newBtn.classList.remove('danger-text');
  titleEl.classList.remove('invalid');
  contentEl.classList.remove('invalid');
  status('Editor limpio.', 'info');
  updateCharCount(); // Resetear contador al limpiar
  browserAPI.storage.local.remove(['editorDraft', 'editingIdDraft']); // Limpiar borradores al resetear
  renderNotes(); // Re-render para quitar cualquier resaltado
}

function updateCharCount() {
  const length = contentEl.value.length;
  charCounterEl.textContent = `${length} caracteres`;
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

async function performSave(isAutoSave = false) {
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  
  if (!isAutoSave) {
    titleEl.classList.remove('invalid');
    contentEl.classList.remove('invalid');
    if (titleEl.parentElement) titleEl.parentElement.classList.remove('shake');

    if (!title && !content) {
      titleEl.classList.add('invalid');
      contentEl.classList.add('invalid');
      if (titleEl.parentElement) titleEl.parentElement.classList.add('shake');
      status('La nota está vacía. Escribe algo.', 'danger');
      return;
    }
    setButtonLoading(saveBtn, true, 'Guardando...');
  }

  const notes = await getNotes();
  const now = Date.now();

  if (editingId) {
    const noteToUpdate = notes.find(n => n.id === editingId);
    if (noteToUpdate) {
      // Solo guardar si algo cambió para no saturar chrome.storage.sync
      if (noteToUpdate.title === title && noteToUpdate.content === content) {
        if (!isAutoSave) setButtonLoading(saveBtn, false);
        return;
      }
      noteToUpdate.title = title;
      noteToUpdate.content = content;
      noteToUpdate.updatedAt = now;
    }
  } else if (!isAutoSave) {
    // Solo crear nueva nota si NO es auto-guardado (o si decidimos auto-crear)
    notes.push({
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: now,
      updatedAt: now
    });
  } else {
    // Es auto-guardado de una nota NUEVA, guardamos borrador local
    await browserAPI.storage.local.set({ 
      editorDraft: { title, content },
      editingIdDraft: editingId // Guardar si estamos editando o no
    });
    return;
  }

  try {
    await saveNotes(notes);
    renderNotes();
    
    if (!isAutoSave) {
      status('Nota guardada.', 'success');
      if (isLoggedIn && isAutoSyncEnabled) {
        uploadNotesToDrive(notes).then(() => status('Nota sincronizada con Drive.', 'success', 1500));
      }
      await browserAPI.storage.local.remove(['editorDraft', 'editingIdDraft']);
      clearEditor();
      switchTab('history');
      status('¡Nota guardada con éxito!', 'success');
    } else {
      console.log("Auto-guardado exitoso.");
    }
  } catch (error) {
    if (!isAutoSave) status('Error al guardar: ' + error.message, 'danger');
  } finally {
    if (!isAutoSave) setButtonLoading(saveBtn, false);
  }
}

saveBtn.addEventListener('click', () => performSave(false));

function triggerAutoSave() {
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(() => {
    performSave(true);
  }, 1000); // 1 segundo de debounce
}

titleEl.addEventListener('input', triggerAutoSave);
contentEl.addEventListener('input', () => {
  updateCharCount();
  triggerAutoSave();
});

newBtn.addEventListener('click', () => {
  clearEditor();
  switchTab('create');
  titleEl.focus();
});

searchInput.addEventListener('input', (e) => {
  renderNotes(e.target.value);
});

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Evita que el clic se propague al listener del documento
  const isHidden = settingsDropdown.style.display === 'none';
  settingsDropdown.style.display = isHidden ? 'block' : 'none';
});

// Cierra el menú si se hace clic en cualquier otro lugar
document.addEventListener('click', (e) => {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsDropdown = document.getElementById('settings-dropdown');
  
  if (settingsDropdown && settingsBtn && 
      !settingsDropdown.contains(e.target) && 
      !settingsBtn.contains(e.target)) {
    settingsDropdown.style.display = 'none';
  }
});

themeSelector.addEventListener('change', (e) => {
  const selectedTheme = e.target.value;
  applyTheme(selectedTheme);
  browserAPI.storage.sync.set({ theme: selectedTheme });
});

function applyTheme(theme) {
  const docEl = document.documentElement;
  docEl.classList.remove('theme-light', 'theme-dark', 'theme-system');
  if (theme === 'light') {
    docEl.classList.add('theme-light');
  } else if (theme === 'dark') {
    docEl.classList.add('theme-dark');
  } else {
    docEl.classList.add('theme-system');
  }
}

async function exportNotes() {
  try {
    const notes = await getNotes();
    const notesJSON = JSON.stringify(notes, null, 2);
    const blob = new Blob([notesJSON], { type: 'application/json' });
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `notas-export-${date}.json`;

    // Usar la API de descargas de Chrome si está disponible (más fiable en extensiones)
    if (chrome && chrome.downloads) {
      const reader = new FileReader();
      reader.onload = function() {
        chrome.downloads.download({
          url: reader.result,
          filename: fileName,
          saveAs: true
        });
      };
      reader.readAsDataURL(blob);
    } else {
      // Fallback para navegadores sin chrome.downloads
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    status('Notas exportadas con éxito.', 'success');
  } catch (error) {
    console.error("Error al exportar:", error);
    status('Error al exportar: ' + error.message, 'danger');
  }
}

exportBtn.addEventListener('click', exportNotes);
if (syncTabExportBtn) syncTabExportBtn.addEventListener('click', exportNotes);

importBtn.addEventListener('click', () => {
  importFileInput.click();
});

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const importedNotes = JSON.parse(event.target.result);
      if (!Array.isArray(importedNotes)) {
        throw new Error('El archivo no contiene un array de notas válido.');
      }

      // Lógica de fusión inteligente
      const localNotes = await getNotes();
      const notesMap = new Map();

      [...localNotes, ...importedNotes].forEach(note => {
        if (!note.id || !note.updatedAt) return; // Ignorar notas malformadas
        const existing = notesMap.get(note.id);
        if (!existing || note.updatedAt > existing.updatedAt) {
          notesMap.set(note.id, note);
        }
      });

      const mergedNotes = Array.from(notesMap.values());
      await saveNotes(mergedNotes);
      await renderNotes();
      status(`${importedNotes.length} notas importadas y fusionadas.`, 'success');
      switchTab('history');

    } catch (error) {
      status(`Error al importar: ${error.message}`, 'danger', 5000);
    }
  };
  reader.readAsText(file);
});

contentEl.addEventListener('input', () => {
  updateCharCount();
  triggerAutoSave();
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
    userNameEl.textContent = `Bienvenido, ${userInfo.given_name || 'Usuario'}`;
    userEmailEl.textContent = userInfo.email || '';
    userProfileEl.style.display = 'flex';
    loginPromptEl.style.display = 'none';
    uploadBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'block';
    downloadBtn.style.display = 'inline-block';
    syncActionsEl.style.display = 'flex';
    syncLoggedOutMsg.style.display = 'none';
    
    // Cambiar icono a Logout
    loginBtn.title = "Cerrar sesión";
    loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`;
    loginBtn.classList.add('active');
  } else {
    userProfileEl.style.display = 'none';
    loginPromptEl.style.display = 'block';
    uploadBtn.style.display = 'none'; 
    downloadBtn.style.display = 'none';
    syncActionsEl.style.display = 'none';
    syncLoggedOutMsg.style.display = 'flex';

    // Restaurar icono a Login
    loginBtn.title = "Iniciar sesión";
    loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>`;
    loginBtn.classList.remove('active');
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
    const { userInfo } = await getAuthTokenAndInfo(true); // Pide login interactivo
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
  if (isLoggedIn) {
    if (confirm('¿Deseas cerrar la sesión de Google?')) {
      try {
        status('Cerrando sesión...', 'info', -1);
        await removeAuthToken();
        updateSyncUI(false);
        status('Sesión cerrada con éxito.', 'success');
      } catch (error) {
        status(`Error: ${error.message}`, 'danger');
      }
    }
    return;
  }

  const loginSuccess = await loginToDrive();

  if (loginSuccess && isAutoSyncEnabled) {
    status('Login exitoso. Iniciando sincronización automática...', 'info');
    await autoSyncNotes();
  }
}

if (loginBtn) loginBtn.addEventListener('click', handleSyncTabActivation);
if (syncTabLoginBtn) syncTabLoginBtn.addEventListener('click', handleSyncTabActivation);

if (pinBtn) {
  pinBtn.addEventListener('click', async () => {
    try {
      // Intentar abrir el panel lateral
      if (chrome && chrome.sidePanel) {
        // En MV3, esto requiere el permiso 'sidePanel'
        await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
        window.close(); // Cerrar el popup al abrir el panel lateral
      } else {
        status('El panel lateral no es compatible con este navegador.', 'danger');
      }
    } catch (error) {
      console.error("Error al abrir el panel lateral:", error);
      status('Error: ' + error.message, 'danger');
    }
  });
}

uploadBtn.addEventListener('click', async () => {
  if (!confirm('Esto sobrescribirá las notas en Google Drive con tus notas locales. ¿Deseas continuar?')) return;
  setButtonLoading(uploadBtn, true);
  try {
    status('Subiendo notas...', 'info', -1);
    const localNotes = await getNotes();
    await uploadNotesToDrive(localNotes);
    status('Notas subidas a Google Drive con éxito.', 'success');
    
    // --- Mejora de feedback visual ---
    uploadBtn.style.backgroundColor = 'var(--success-accent)';
    uploadBtn.textContent = '¡Subido!';
    setTimeout(() => {
        uploadBtn.style.backgroundColor = ''; // Revertir al color original
        setButtonLoading(uploadBtn, false); // Restaurar texto y estado
    }, 2000);
    // No llamamos a setButtonLoading aquí para controlar el estado manualmente

  } catch (error) {
    updateSyncUI(false); // Si hay error de token, reflejarlo en la UI
    console.error("Error al subir notas:", error);
    status(`Error al subir: ${error.message}`, 'danger', 5000);
    setButtonLoading(uploadBtn, false); // Restaurar en caso de error
  } finally {
    // El setButtonLoading se maneja en los bloques try/catch ahora
  }
});

/**
 * Lógica para descargar y guardar las notas.
 */
async function downloadNotes() {
  setButtonLoading(downloadBtn, true);
  status('Bajando notas...', 'info', -1);
  try {
    const driveNotes = await downloadNotesFromDrive();
    if (driveNotes) {
      await saveNotes(driveNotes);
      await renderNotes(); // Actualizar la lista en la pestaña de historial
      status('Notas bajadas de Google Drive con éxito.', 'success');
      // --- Mejora de feedback visual ---
      downloadBtn.style.backgroundColor = 'var(--success-accent)';
      downloadBtn.textContent = '¡Descargado!';
      setTimeout(() => {
        downloadBtn.style.backgroundColor = ''; // Revertir al color original
        setButtonLoading(downloadBtn, false); // Restaurar texto y estado
      }, 2000);
    } else {
      status('No se encontraron notas en Google Drive para bajar.', 'info');
      setButtonLoading(downloadBtn, false);
    }
  } catch (error) {
    updateSyncUI(false); // Si hay error de token, reflejarlo en la UI
    console.error("Error al bajar notas:", error);
    status(`Error al bajar: ${error.message}`, 'danger', 5000);
    setButtonLoading(downloadBtn, false); // Asegurarse de reactivar el botón en caso de error
  }
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
    if (isLoggedIn) {
      status('Sincronización automática activada.', 'success');
      autoSyncNotes();
    } else {
      status('Inicia sesión para activar la sincronización.', 'info', -1);
      await handleSyncTabActivation(); // Iniciar login
    }
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
    const { userInfo } = await getAuthTokenAndInfo(false);
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

    // --- Mejora de feedback visual para auto-sync ---
    const syncOptionEl = document.querySelector('.sync-option');
    if (syncOptionEl) {
      syncOptionEl.classList.add('success');
      setTimeout(() => {
        syncOptionEl.classList.remove('success');
      }, 2000);
    }

  } catch (error) {
    status(`Error de sincronización: ${error.message}`, 'danger', 5000);
  }
}

/**
 * Función principal de inicialización.
 * Se ejecuta cuando el DOM está completamente cargado.
 */
async function init() {
  // Ajustar estilos si estamos en el panel lateral (no en un popup)
  // En el panel lateral, el width/height suele ser flexible.
  if (window.innerWidth > 500 || !window.matchMedia('(max-width: 450px)').matches) {
     // Si el ancho es mayor al del popup, quitamos los límites fijos
     document.body.style.width = '100%';
     document.body.style.height = '100vh';
  }

  // 0. Cargar configuración de auto-sincronización
  const { autoSyncEnabled } = await browserAPI.storage.sync.get({ autoSyncEnabled: false });
  isAutoSyncEnabled = autoSyncEnabled;
  autoSyncToggle.checked = isAutoSyncEnabled;

  // Cargar borrador y estado de edición si existe
  const { editorDraft, editingIdDraft } = await browserAPI.storage.local.get(['editorDraft', 'editingIdDraft']);
  
  if (editingIdDraft) {
    editingId = editingIdDraft;
    // Recuperar los datos de la nota original para compararlos si el borrador fallara,
    // pero aquí priorizamos el editorDraft que es lo más reciente escrito.
    if (editorDraft) {
      titleEl.value = editorDraft.title || '';
      contentEl.value = editorDraft.content || '';
    }
    editorTitleEl.textContent = 'Editar nota';
    newBtn.innerHTML = 'Cancelar'; 
    newBtn.classList.add('danger-text');
    status('Sesión de edición restaurada.', 'info');
  } else if (editorDraft && (editorDraft.title || editorDraft.content)) {
    titleEl.value = editorDraft.title || '';
    contentEl.value = editorDraft.content || '';
    status('Borrador restaurado.', 'info');
  }

  // Cargar preferencia de tema
  const { theme } = await browserAPI.storage.sync.get({ theme: 'system' });
  themeSelector.value = theme;
  applyTheme(theme);

  // 1. Renderizar la lista de notas en la pestaña de historial.
  updateCharCount();
  renderNotes();
  
  // Cargar versión de la extensión
  if (versionSpan) {
    const manifest = browserAPI.runtime.getManifest();
    versionSpan.textContent = manifest.version;
  }

  // 2. Comprobar el estado de la conexión de Google Drive en segundo plano.
  await checkInitialSyncStatus();

  // 3. Asegurarse de que la pestaña correcta esté visible al inicio.
  // (El HTML ya define 'history' como activa, pero esto lo haría más robusto si cambiara)
  // switchTab('history');
}

// Esperar a que el DOM esté completamente cargado para ejecutar el script.
// Esto asegura que todos los elementos HTML están disponibles.
document.addEventListener('DOMContentLoaded', init);