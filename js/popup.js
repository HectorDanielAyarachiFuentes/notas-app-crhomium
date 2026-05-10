import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive, removeAuthToken } from './drive-sync.js';
import {
  getNotes, saveNotes, getStorageMode, setStorageMode,
  getLocalNotes, mergeLocalWithDrive, getLocalProfile, saveLocalProfile
} from './storage-manager.js';

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
const deleteAllBtn = document.getElementById('deleteAllBtn');
const settingsDropdown = document.getElementById('settings-dropdown');
const versionSpan = document.getElementById('extension-version');
const themeSelector = document.getElementById('theme-selector');
const psmSelector = document.getElementById('psm-selector');
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');
const syncTabLoginBtn = document.getElementById('sync-tab-login-btn');
const syncTabExportBtn = document.getElementById('sync-tab-export-btn');
const pinBtn = document.getElementById('pin-btn');
const ocrBtn = document.getElementById('ocr-btn');

// Mode toggle
const modeLocalBtn  = document.getElementById('mode-local-btn');
const modeDriveBtn  = document.getElementById('mode-drive-btn');
const localModePanel = document.getElementById('local-mode-panel');
const driveModePanel = document.getElementById('drive-mode-panel');

// Local profile
const localProfileIcon   = document.getElementById('local-profile-icon');
const localProfileName   = document.getElementById('local-profile-name');
const localNameInput     = document.getElementById('local-name-input');
const editLocalNameBtn   = document.getElementById('edit-local-name-btn');
const localIconTrigger   = document.getElementById('local-icon-picker-trigger');
const emojiPicker        = document.getElementById('emoji-picker');
const emojiGrid          = document.getElementById('emoji-grid');
const localHeaderIcon    = document.getElementById('local-header-icon');
const localHeaderName    = document.getElementById('local-header-name');

// Sync modal
const syncModalOverlay = document.getElementById('sync-modal-overlay');
const syncModalYes     = document.getElementById('sync-modal-yes');
const syncModalNo      = document.getElementById('sync-modal-no');
const syncModalCancel  = document.getElementById('sync-modal-cancel');

let editingId = null;
let statusTimeout = null;
let autoSaveTimeout = null;
let isAutoSyncEnabled = false;
let isLoggedIn = false;
let currentMode = 'local'; // 'local' | 'drive'
let currentProfile = { name: 'Mi Espacio', icon: '📝' };

// ─── Emojis disponibles ───
const EMOJI_LIST = [
  '📝','📓','📔','📒','📕','📗','📘','📙',
  '🗒️','📋','📄','📃','🗂️','🗃️','📁','🗄️',
  '✏️','🖊️','🖋️','🔏','🔐','🔑','💡','⭐',
  '🌟','🔥','💎','🎯','🚀','🌈','🦋','🐾',
  '🍀','🌺','🌸','🎨','🎭','🏆','❤️','💜',
  '💙','💚','🧡','🤍','🌙','☀️','⚡','🌊'
];

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
  browserAPI.storage.local.remove(['editorDraft', 'editingIdDraft'], () => {
    if (browserAPI.runtime.lastError) { /* Ignorar */ }
  }); // Limpiar borradores al resetear
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
    await new Promise(resolve => {
      browserAPI.storage.local.set({ 
        editorDraft: { title, content },
        editingIdDraft: editingId 
      }, () => {
        if (browserAPI.runtime.lastError) { /* Ignorar */ }
        resolve();
      });
    });
    return;
  }

  try {
    if (currentMode === 'drive') {
      await saveNotes(notes);
    } else {
      // En modo local, usamos browserAPI directamente para saltar la lógica de Drive en storage-manager
      await new Promise(resolve => {
        browserAPI.storage.local.set({ notes: notes }, () => {
          if (browserAPI.runtime.lastError) { /* Ignorar */ }
          resolve();
        });
      });
    }
    renderNotes();
    
    if (!isAutoSave) {
      status('Nota guardada.', 'success');
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

if (deleteAllBtn) {
  deleteAllBtn.addEventListener('click', async () => {
    const notes = await getNotes();
    if (notes.length === 0) {
      status('No hay notas para borrar.', 'info');
      return;
    }
    if (!confirm('¿Estás seguro de que quieres borrar TODAS las notas? Esta acción no se puede deshacer.')) return;
    
    if (currentMode === 'drive') {
      await saveNotes([]);
    } else {
      await browserAPI.storage.local.set({ notes: [] });
    }
    
    renderNotes();
    clearEditor();
    status('Todas las notas han sido eliminadas.', 'success');
  });
}

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
  browserAPI.storage.sync.set({ theme: selectedTheme }, () => {
    if (browserAPI.runtime.lastError) {
      // Si sync falla en Opera, intentar en local como fallback
      browserAPI.storage.local.set({ theme: selectedTheme }, () => {
        if (browserAPI.runtime.lastError) { /* Ignorar */ }
      });
    }
  });
});

  if (psmSelector) {
    psmSelector.addEventListener('change', (e) => {
      browserAPI.storage.sync.set({ psmMode: e.target.value }, () => {
        if (browserAPI.runtime.lastError) {
          browserAPI.storage.local.set({ psmMode: e.target.value }, () => {
             if (browserAPI.runtime.lastError) { /* Ignorar */ }
          });
        }
      });
    });
  }

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
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn("Error al descargar:", chrome.runtime.lastError.message);
            // Fallback: abrir en nueva pestaña
            const a = document.createElement('a');
            a.href = reader.result;
            a.download = fileName;
            a.click();
          }
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
      const tabs = await browserAPI.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs[0];
      
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        status('El navegador no permite el uso de OCR en esta página.', 'danger', 5000);
        return;
      }

      // 🪄 EFECTO MÁGICO: Activar animación de escaneo antes de cerrar
      const container = document.querySelector('.container');
      if (container) container.classList.add('ocr-processing');
      status('Iniciando escáner...', 'info');

      // Enviar la solicitud OCR al background
      browserAPI.runtime.sendMessage({ action: 'performBackgroundOCR', tab }, (response) => {
        if (browserAPI.runtime.lastError) {
          console.warn("Error enviando mensaje OCR:", browserAPI.runtime.lastError.message);
        }
      });
      
      // Retrasar el cierre un poco más (600ms) para que se vea la animación de la línea de luz
      setTimeout(() => window.close(), 600);
    } catch (e) {
      status('Error: ' + e.message, 'danger');
    }
  });
}

if (pinBtn) {
  pinBtn.addEventListener('click', async () => {
    try {
      // Verificamos no solo si el objeto existe, sino si la función open está disponible
      if (typeof chrome !== 'undefined' && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id }, () => {
          if (chrome.runtime.lastError) {
            console.warn("sidePanel.open falló:", chrome.runtime.lastError.message);
            // Fallback si la función está pero falla (ej. por falta de gesto de usuario o soporte parcial)
            openFallbackWindow();
          } else {
            window.close();
          }
        });
      } else {
        openFallbackWindow();
      }
    } catch (e) {
      console.error("Error al anclar:", e);
      openFallbackWindow();
    }
  });
}

async function openFallbackWindow() {
  try {
    await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 450, height: 750 });
    window.close();
  } catch (err) {
    status('Error al anclar.', 'danger');
  }
}

// --- Sincronización ---
function updateSyncUI(isConnected, userInfo = null) {
  isLoggedIn = isConnected;
  syncLoadingMsg.style.display = 'none';
  loginPromptEl.style.display = 'none';
  userAvatarEl.classList.remove('loading');

  const syncActionsEl = document.getElementById('sync-actions');
  if (isConnected && currentMode === 'drive') {
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
    // Si estamos en modo local o no hay conexión, mostrar el perfil local en el header
    userProfileEl.style.display = 'none';
    loginPromptEl.style.display = 'flex';
    uploadBtn.style.display = 'none'; 
    downloadBtn.style.display = 'none';
    syncActionsEl.style.display = 'none';
    
    if (currentMode === 'drive') {
      syncLoggedOutMsg.style.display = 'flex';
      loginBtn.title = "Iniciar sesión";
      loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>`;
      loginBtn.classList.remove('active');
    } else {
      syncLoggedOutMsg.style.display = 'none';
      // En modo local, el loginBtn (icono de la derecha) puede servir para ir a la pestaña sync
      loginBtn.title = "Ajustes de cuenta";
      loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
      loginBtn.classList.remove('active');
    }
  }
}

async function loginToDrive() {
  syncLoadingMsg.style.display = 'block';
  userAvatarEl.classList.add('loading');
  try {
    const { userInfo } = await getAuthTokenAndInfo(true);
    updateSyncUI(true, userInfo);

    // Verificar si hay notas locales para ofrecer sincronización
    const localNotes = await getLocalNotes();
    if (localNotes.length > 0) {
      // Mostrar modal ANTES de cambiar modo — usuario decide
      isSyncModalOpen = true;
      showSyncModal(localNotes.length);
      // El modo drive se activa dentro de los handlers del modal
    } else {
      // Sin notas locales: pasar a Drive directamente
      await applyStorageMode('drive', true);
      await renderNotes();
    }
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
        await applyStorageMode('local', true);
        status('Sesión cerrada. Modo local activado.', 'success');
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
    await applyStorageMode('local', true);
    await renderNotes();
    status('Sesión cerrada. Modo local activado.', 'success');
  } catch (error) {
    status(`Error al cerrar sesión: ${error.message}`, 'danger', 5000);
  }
});

autoSyncToggle.addEventListener('change', async (e) => {
  isAutoSyncEnabled = e.target.checked;
  browserAPI.storage.sync.set({ autoSyncEnabled: isAutoSyncEnabled }, () => {
    if (browserAPI.runtime.lastError) {
      browserAPI.storage.local.set({ autoSyncEnabled: isAutoSyncEnabled });
    }
  });
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

// Bandera para evitar que autoSync corra mientras el modal está abierto
let isSyncModalOpen = false;

async function autoSyncNotes() {
  if (!isLoggedIn || !isAutoSyncEnabled || isSyncModalOpen || currentMode !== 'drive') return;
  status('Sincronizando notas...', 'info', -1);
  try {
    const merged = await mergeLocalWithDrive();
    await renderNotes();
    status('Notas sincronizadas con éxito.', 'success');
  } catch (error) {
    // Si el error es de autenticación y ya no estamos en modo Drive o sesión, ignorar silenciosamente
    if (!isLoggedIn || currentMode !== 'drive') {
      console.warn('Auto-sync cancelado o fallido tras cambio de modo/sesión:', error.message);
      return;
    }
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

// ─── Modo de almacenamiento ───
async function applyStorageMode(mode, save = false) {
  currentMode = mode;
  if (save) await setStorageMode(mode);

  modeLocalBtn.classList.toggle('active', mode === 'local');
  modeDriveBtn.classList.toggle('active', mode === 'drive');
  localModePanel.style.display = mode === 'local' ? 'block' : 'none';
  driveModePanel.style.display = mode === 'drive' ? 'block' : 'none';

  // Sincronizar el header con el modo activo
  if (mode === 'local') {
    userProfileEl.style.display = 'none';
    loginPromptEl.style.display = 'flex';
    syncLoggedOutMsg.style.display = 'none';
    // Cambiar icono del header loginBtn a uno de "cuenta"
    loginBtn.title = "Ajustes de cuenta";
    loginBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
    loginBtn.classList.remove('active');
  } else {
    // Modo Drive: mostrar perfil si está logueado, sino prompt de login
    if (isLoggedIn) {
      userProfileEl.style.display = 'flex';
      loginPromptEl.style.display = 'none';
      syncLoggedOutMsg.style.display = 'none';
      loginBtn.classList.add('active');
    } else {
      userProfileEl.style.display = 'none';
      loginPromptEl.style.display = 'flex';
      syncLoggedOutMsg.style.display = 'flex';
      loginBtn.classList.remove('active');
    }
    // Restaurar icono de login original para modo Drive
    loginBtn.title = isLoggedIn ? "Cerrar sesión" : "Iniciar sesión";
    loginBtn.innerHTML = isLoggedIn 
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>`;
  }
}

modeLocalBtn.addEventListener('click', async () => {
  if (currentMode === 'local') return;
  
  if (isLoggedIn && !confirm('¿Estás seguro de salir del modo Drive? Tus notas dejarán de sincronizarse automáticamente.')) {
    return;
  }
  
  await applyStorageMode('local', true);
  await renderNotes();
  status('Modo local activado.', 'info');
});

modeDriveBtn.addEventListener('click', async () => {
  if (currentMode === 'drive') return;
  await applyStorageMode('drive', true);
  if (!isLoggedIn) {
    status('Iniciá sesión para usar Drive.', 'info', 3000);
  } else {
    await renderNotes();
    status('Modo Drive activado.', 'success');
  }
});

// ─── Perfil Local ───
function buildEmojiPicker(selectedIcon) {
  emojiGrid.innerHTML = '';
  EMOJI_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn' + (emoji === selectedIcon ? ' selected' : '');
    btn.textContent = emoji;
    btn.addEventListener('click', async () => {
      currentProfile.icon = emoji;
      await saveLocalProfile(currentProfile);
      localProfileIcon.textContent = emoji;
      localHeaderIcon.textContent = emoji;
      emojiPicker.style.display = 'none';
      status('Ícono actualizado.', 'success');
    });
    emojiGrid.appendChild(btn);
  });
}

localIconTrigger.addEventListener('click', () => {
  const visible = emojiPicker.style.display === 'block';
  if (!visible) buildEmojiPicker(currentProfile.icon);
  emojiPicker.style.display = visible ? 'none' : 'block';
});

editLocalNameBtn.addEventListener('click', () => {
  localNameInput.value = currentProfile.name;
  localNameInput.style.display = 'block';
  localProfileName.style.display = 'none';
  editLocalNameBtn.style.display = 'none';
  localNameInput.focus();
});

async function commitLocalName() {
  const newName = localNameInput.value.trim() || 'Mi Espacio';
  currentProfile.name = newName;
  await saveLocalProfile(currentProfile);
  localProfileName.textContent = newName;
  localHeaderName.textContent = newName;
  localNameInput.style.display = 'none';
  localProfileName.style.display = '';
  editLocalNameBtn.style.display = '';
  status('Nombre actualizado.', 'success');
}

localNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') commitLocalName();
  if (e.key === 'Escape') {
    localNameInput.style.display = 'none';
    localProfileName.style.display = '';
    editLocalNameBtn.style.display = '';
  }
});
localNameInput.addEventListener('blur', commitLocalName);

function applyLocalProfile(profile) {
  currentProfile = profile;
  localProfileIcon.textContent = profile.icon;
  localProfileName.textContent = profile.name;
  localHeaderIcon.textContent = profile.icon;
  localHeaderName.textContent = profile.name;
}

// ─── Modal de sincronización ───
function showSyncModal(localCount) {
  document.getElementById('sync-modal-body').textContent =
    `Tenés ${localCount} nota${localCount !== 1 ? 's' : ''} guardada${localCount !== 1 ? 's' : ''} localmente. ¿Querés sincronizarlas con Google Drive?`;
  syncModalOverlay.style.display = 'flex';
}

function hideSyncModal() {
  syncModalOverlay.style.display = 'none';
  isSyncModalOpen = false;
}

syncModalYes.addEventListener('click', async () => {
  hideSyncModal();
  await applyStorageMode('drive', true);
  status('Fusionando notas...', 'info', -1);
  try {
    const merged = await mergeLocalWithDrive();
    await renderNotes();
    status(`${merged.length} notas sincronizadas con Drive. ✓`, 'success', 3000);
  } catch (e) {
    status('Error al sincronizar: ' + e.message, 'danger', 4000);
  }
});

syncModalNo.addEventListener('click', async () => {
  hideSyncModal();
  await applyStorageMode('drive', true);
  status('Usando solo Drive (notas locales no subidas).', 'info', 3000);
  await renderNotes();
});

syncModalCancel.addEventListener('click', async () => {
  hideSyncModal();
  // Revertir: cerrar sesión y volver a modo local
  await removeAuthToken();
  updateSyncUI(false);
  await applyStorageMode('local', true);
  status('Inicio de sesión cancelado.', 'info');
});

// --- Inicialización ---
async function init() {
  if (window.innerWidth > 500 || !window.matchMedia('(max-width: 450px)').matches) {
     document.body.style.width = '100%';
     document.body.style.height = '100vh';
  }

  // Cargar modo guardado
  const savedMode = await getStorageMode();
  await applyStorageMode(savedMode);

  // Cargar perfil local
  const profile = await getLocalProfile();
  applyLocalProfile(profile);

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

  const { theme, psmMode } = await browserAPI.storage.sync.get({ theme: 'system', psmMode: 'auto' });
  themeSelector.value = theme;
  if (psmSelector) psmSelector.value = psmMode;
  applyTheme(theme);

  updateCharCount();
  renderNotes();

  if (versionSpan) {
    const manifest = browserAPI.runtime.getManifest();
    versionSpan.textContent = manifest.version;
  }

  await checkInitialSyncStatus();

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

// Botón "Ver Guía" en Ajustes
const showGuideBtn = document.getElementById('show-guide-btn');
if (showGuideBtn) {
  showGuideBtn.addEventListener('click', () => {
    switchTab('help');
    settingsDropdown.style.display = 'none'; // Cerrar el menú de ajustes
  });
}
