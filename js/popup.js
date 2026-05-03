import { getNotes, saveNotes } from './utils.js';
import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive, removeAuthToken } from './drive-sync.js';

// Detección de Panel Lateral vs Popup
function detectSidePanel() {
  // Los popups en Chrome suelen tener un tamaño fijo. 
  // Si las dimensiones son distintas, es probable que sea el panel lateral.
  const isSide = window.innerWidth > 450 || window.innerHeight > 600;
  document.body.classList.toggle('is-side-panel', isSide);
}

detectSidePanel();
window.addEventListener('resize', detectSidePanel);

// Elementos UI
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
const ocrBtn = document.getElementById('ocr-btn');

let editingId = null;
let statusTimeout = null;
let autoSaveTimeout = null;
let isAutoSyncEnabled = false;
let isLoggedIn = false;

// --- Navegación ---
function switchTab(targetTab) {
  tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === targetTab));
  tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === `tab-${targetTab}`));
  
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
  });
});

// --- Gestión de Notas ---
function createNoteListItem(note) {
  const openNoteForEditing = () => {
    editingId = note.id;
    titleEl.value = note.title;
    contentEl.value = note.content;
    editorTitleEl.textContent = 'Editar nota';
    
    const cancelIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    newBtn.innerHTML = `${cancelIcon}<span>Cancelar</span>`; 
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
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
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
    (note.title || '').toLowerCase().includes(lowerCaseFilter) || 
    (note.content || '').toLowerCase().includes(lowerCaseFilter)
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
  clearTimeout(statusTimeout);
  if (text) {
    statusEl.textContent = text;
    statusEl.className = `status ${type} show`;
  } else {
    statusEl.className = 'status';
  }
  
  if (timeout !== -1 && text) {
    statusTimeout = setTimeout(() => {
      statusEl.className = 'status';
    }, timeout);
  }
}

function clearEditor() {
  editingId = null;
  titleEl.value = '';
  contentEl.value = '';
  editorTitleEl.textContent = 'Nueva Nota';
  
  const clearIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  newBtn.innerHTML = `${clearIcon}<span>Limpiar</span>`;
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
 */
function setButtonLoading(button, isLoading, loadingText = 'Cargando...') {
  if (!button) return;
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalHTML = button.innerHTML;
    button.innerHTML = `<span>${loadingText}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHTML) {
      button.innerHTML = button.dataset.originalHTML;
    }
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
      // Solo guardar si algo cambió
      if (noteToUpdate.title === title && noteToUpdate.content === content) {
        if (!isAutoSave) setButtonLoading(saveBtn, false);
        return;
      }
      noteToUpdate.title = title;
      noteToUpdate.content = content;
      noteToUpdate.updatedAt = now;
    }
  } else if (!isAutoSave) {
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
      editingIdDraft: editingId 
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
  }, 1000); 
}

titleEl.addEventListener('input', triggerAutoSave);
contentEl.addEventListener('input', () => {
  updateCharCount();
  triggerAutoSave();
});

newBtn.addEventListener('click', () => {
  if (editingId) {
    clearEditor();
  } else {
    clearEditor();
    switchTab('create');
    titleEl.focus();
  }
});

searchInput.addEventListener('input', (e) => {
  renderNotes(e.target.value);
});

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = settingsDropdown.style.display === 'none';
  settingsDropdown.style.display = isHidden ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
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

      const localNotes = await getNotes();
      const notesMap = new Map();

      [...localNotes, ...importedNotes].forEach(note => {
        if (!note.id || !note.updatedAt) return; 
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

// --- OCR y Extras ---
if (ocrBtn) {
  ocrBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
        status('El navegador no permite el uso de OCR en esta página.', 'danger', 5000);
        return;
      }

      status('Selecciona el área de texto...', 'info', -1);
      setButtonLoading(ocrBtn, true, 'Procesando...');
      
      const response = await chrome.runtime.sendMessage({ action: 'performBackgroundOCR', tab });
      
      if (response.success) {
        if (response.text) {
          contentEl.value += (contentEl.value ? '\n\n' : '') + response.text;
          if (!titleEl.value) titleEl.value = tab.title || 'Nota OCR';
          updateCharCount();
          triggerAutoSave();
          status('¡OCR completado!', 'success');
          switchTab('create');
        } else {
          status('Iniciando selección... El texto se guardará automáticamente al finalizar.', 'info', 5000);
        }
      } else if (!response.cancelled) {
        status('Error OCR: ' + response.error, 'danger');
      } else {
        status('OCR cancelado.', 'info');
      }
    } catch (e) {
      status('Error: ' + e.message, 'danger');
    } finally {
      setButtonLoading(ocrBtn, false);
    }
  });
}

if (pinBtn) {
  pinBtn.addEventListener('click', async () => {
    try {
      if (chrome && chrome.sidePanel) {
        await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
        window.close();
      } else {
        // Fallback para navegadores sin Side Panel nativo (Opera, etc)
        await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 450, height: 750 });
        window.close();
      }
    } catch (e) {
      console.error("Error al anclar:", e);
      status('Error al anclar.', 'danger');
    }
  });
}

// --- Sincronización ---
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

    loginBtn.title = "Iniciar sesión";
    loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>`;
    loginBtn.classList.remove('active');
  }
}

async function loginToDrive() {
  syncLoadingMsg.style.display = 'block';
  userAvatarEl.classList.add('loading');
  try {
    const { userInfo } = await getAuthTokenAndInfo(true);
    updateSyncUI(true, userInfo);
    return true;
  } catch (error) {
    updateSyncUI(false);
    if (error && error.message && !error.message.toLowerCase().includes('user did not approve access')) {
      status(`Error de conexión: ${error.message}`, 'danger', 5000);
    }
    return false;
  } finally {
    syncLoadingMsg.style.display = 'none';
    userAvatarEl.classList.remove('loading');
  }
}

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
    await autoSyncNotes();
  }
}

if (loginBtn) loginBtn.addEventListener('click', handleSyncTabActivation);
if (syncTabLoginBtn) syncTabLoginBtn.addEventListener('click', handleSyncTabActivation);

uploadBtn.addEventListener('click', async () => {
  if (!confirm('Esto sobrescribirá las notas en Google Drive con tus notas locales. ¿Deseas continuar?')) return;
  setButtonLoading(uploadBtn, true);
  try {
    status('Subiendo notas...', 'info', -1);
    const localNotes = await getNotes();
    await uploadNotesToDrive(localNotes);
    status('Notas subidas a Google Drive con éxito.', 'success');
    uploadBtn.style.backgroundColor = 'var(--success-accent)';
    uploadBtn.textContent = '¡Subido!';
    setTimeout(() => {
        uploadBtn.style.backgroundColor = '';
        setButtonLoading(uploadBtn, false);
    }, 2000);
  } catch (error) {
    updateSyncUI(false);
    status(`Error al subir: ${error.message}`, 'danger', 5000);
    setButtonLoading(uploadBtn, false);
  }
});

async function downloadNotes() {
  setButtonLoading(downloadBtn, true);
  status('Bajando notas...', 'info', -1);
  try {
    const driveNotes = await downloadNotesFromDrive();
    if (driveNotes) {
      await saveNotes(driveNotes);
      await renderNotes();
      status('Notas bajadas de Google Drive con éxito.', 'success');
      downloadBtn.style.backgroundColor = 'var(--success-accent)';
      downloadBtn.textContent = '¡Descargado!';
      setTimeout(() => {
        downloadBtn.style.backgroundColor = '';
        setButtonLoading(downloadBtn, false);
      }, 2000);
    } else {
      status('No se encontraron notas en Google Drive.', 'info');
      setButtonLoading(downloadBtn, false);
    }
  } catch (error) {
    updateSyncUI(false);
    status(`Error al bajar: ${error.message}`, 'danger', 5000);
    setButtonLoading(downloadBtn, false);
  }
}

downloadBtn.addEventListener('click', async () => {
  if (!confirm('Esto reemplazará tus notas locales con las de Google Drive. ¿Deseas continuar?')) return;
  await downloadNotes();
});

logoutBtn.addEventListener('click', async () => {
  if (!confirm('¿Deseas cerrar la sesión de Google?')) return;
  try {
    status('Cerrando sesión...', 'info', -1);
    await removeAuthToken();
    updateSyncUI(false);
    status('Sesión cerrada con éxito.', 'success');
  } catch (error) {
    status(`Error al cerrar sesión: ${error.message}`, 'danger', 5000);
  }
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
      await handleSyncTabActivation();
    }
  } else {
    status('Sincronización automática desactivada.', 'info');
  }
});

async function autoSyncNotes() {
  if (!isLoggedIn || !isAutoSyncEnabled) return;
  status('Sincronizando notas...', 'info', -1);
  try {
    const localNotes = await getNotes();
    const driveNotes = await downloadNotesFromDrive();
    if (!driveNotes) {
      await uploadNotesToDrive(localNotes);
      status('Notas locales subidas a Drive.', 'success');
      return;
    }
    const notesMap = new Map();
    [...localNotes, ...driveNotes].forEach(note => {
      const existing = notesMap.get(note.id);
      if (!existing || note.updatedAt > existing.updatedAt) {
        notesMap.set(note.id, note);
      }
    });
    const mergedNotes = Array.from(notesMap.values());
    await saveNotes(mergedNotes);
    await uploadNotesToDrive(mergedNotes);
    await renderNotes();
    status('Notas sincronizadas con éxito.', 'success');
  } catch (error) {
    status(`Error de sincronización: ${error.message}`, 'danger', 5000);
  }
}

async function checkInitialSyncStatus() {
  try {
    userAvatarEl.classList.add('loading');
    const { userInfo } = await getAuthTokenAndInfo(false);
    updateSyncUI(true, userInfo);
    if (isAutoSyncEnabled) await autoSyncNotes();
  } catch (error) {
    updateSyncUI(false);
  } finally {
    userAvatarEl.classList.remove('loading');
  }
}

// --- Inicialización ---
async function init() {
  if (window.innerWidth > 500 || !window.matchMedia('(max-width: 450px)').matches) {
     document.body.style.width = '100%';
     document.body.style.height = '100vh';
  }

  const { autoSyncEnabled } = await browserAPI.storage.sync.get({ autoSyncEnabled: false });
  isAutoSyncEnabled = autoSyncEnabled;
  autoSyncToggle.checked = isAutoSyncEnabled;

  const { editorDraft, editingIdDraft } = await browserAPI.storage.local.get(['editorDraft', 'editingIdDraft']);
  if (editingIdDraft) {
    editingId = editingIdDraft;
    if (editorDraft) {
      titleEl.value = editorDraft.title || '';
      contentEl.value = editorDraft.content || '';
    }
    editorTitleEl.textContent = 'Editar nota';
    newBtn.innerHTML = 'Cancelar'; 
    newBtn.classList.add('danger-text');
  } else if (editorDraft && (editorDraft.title || editorDraft.content)) {
    titleEl.value = editorDraft.title || '';
    contentEl.value = editorDraft.content || '';
  }

  const { theme } = await browserAPI.storage.sync.get({ theme: 'system' });
  themeSelector.value = theme;
  applyTheme(theme);

  updateCharCount();
  renderNotes();
  
  if (versionSpan) {
    const manifest = browserAPI.runtime.getManifest();
    versionSpan.textContent = manifest.version;
  }

  await checkInitialSyncStatus();

  // Soporte para apertura directa de vistas mediante parámetros de URL
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get('view');
  if (view === 'settings' && settingsDropdown) {
    settingsDropdown.style.display = 'block';
  }
}

browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.notes) {
    renderNotes();
  }
});

// Función para guardar el email del usuario para la persistencia
async function getAuthTokenAndInfo(interactive = false) {
    const { getAuthTokenAndInfo: getInfo } = await import('./drive-sync.js');
    const data = await getInfo(interactive);
    if (data && data.userInfo && data.userInfo.email) {
        await browserAPI.storage.local.set({ "cached_user_email": data.userInfo.email });
    }
    return data;
}

// Escuchar el triple clic en la versión para forzar sincronización (el truco de las 3 barras/clics)
const versionEl = document.getElementById('extension-version');
if (versionEl) {
  versionEl.style.cursor = 'pointer';
  versionEl.addEventListener('click', async (e) => {
    // 1. Triple clic para forzar sincronización
    if (e.detail === 3) {
      status('Forzando sincronización...', 'info', 3000);
      checkInitialSyncStatus();
    }
    
    // 2. Shift + Clic para copiar la URL de login (el aviso que pediste)
    if (e.shiftKey) {
      try {
        const manifest = browserAPI.runtime.getManifest();
        const clientId = "262441099949-o76obmtc9pncv801urk1elsqrglh9uaf.apps.googleusercontent.com";
        const redirectUri = encodeURIComponent("https://fokahhfcbgbncigpkkdgmhimcfjbjlbl.chromiumapp.org/");
        const scopes = encodeURIComponent(manifest.oauth2.scopes.join(' '));
        const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=${scopes}&prompt=select_account`;
        
        await navigator.clipboard.writeText(authUrl);
        status('¡URL de autenticación copiada!', 'success', 4000);
      } catch (err) {
        status('Error al copiar URL', 'danger');
      }
    }

    // 3. Ctrl + Clic para SIMULAR CADUCIDAD y probar el inicio silencioso
    if (e.ctrlKey) {
      status('Simulando caducidad...', 'info', 2000);
      // Borramos el token de la memoria y del caché, pero NO el email
      await browserAPI.storage.local.remove(['cached_oauth_token', 'cached_oauth_expiry']);
      // Forzamos la recarga inicial para ver si entra solo con el email guardado
      checkInitialSyncStatus();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
