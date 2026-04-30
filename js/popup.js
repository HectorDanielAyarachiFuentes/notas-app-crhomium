import { getNotes, saveNotes } from './utils.js';
import browserAPI from './browser-api.js';
import { uploadNotesToDrive, downloadNotesFromDrive, getAuthTokenAndInfo, removeAuthToken } from './drive-sync.js';

// Detección de Panel Lateral vs Popup
function detectSidePanel() {
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
  
  const activePanel = document.getElementById(`tab-${targetTab}`);
  activePanel.style.animation = 'none';
  activePanel.offsetHeight; // reflow
  activePanel.style.animation = 'fadeIn 0.4s ease-out';
}

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

// --- Gestión de Notas ---
function createNoteListItem(note) {
  const li = document.createElement('li');
  li.className = `noteItem ${note.id === editingId ? 'editing' : ''}`;
  
  const content = `
    <div class="noteTitle">${note.title || '(Sin título)'}</div>
    <div class="noteText">${note.content || ''}</div>
    <div class="noteDate">${new Date(note.updatedAt).toLocaleString()}</div>
    <div class="noteControls">
      <button class="btn-icon edit-btn" title="Editar"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
      <button class="btn-icon delete-btn" title="Eliminar"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
    </div>
  `;
  li.innerHTML = content;

  li.querySelector('.edit-btn').addEventListener('click', () => {
    editingId = note.id;
    titleEl.value = note.title;
    contentEl.value = note.content;
    editorTitleEl.textContent = 'Editar nota';
    newBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>Cancelar</span>`;
    newBtn.classList.add('danger-text');
    switchTab('create');
    titleEl.focus();
    updateCharCount();
    renderNotes();
  });

  li.querySelector('.delete-btn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta nota?')) return;
    const notes = await getNotes();
    await saveNotes(notes.filter(x => x.id !== note.id));
    renderNotes();
    if (editingId === note.id) clearEditor();
    status('Nota eliminada.', 'danger');
  });

  return li;
}

async function renderNotes(filterText = '') {
  const notes = await getNotes();
  notesList.innerHTML = '';
  const lowerFilter = filterText.toLowerCase();
  const filtered = notes.filter(n => n.title.toLowerCase().includes(lowerFilter) || n.content.toLowerCase().includes(lowerFilter));
  
  if (filtered.length === 0) {
    notesList.innerHTML = '<div class="empty-state"><p>No se encontraron notas</p></div>';
    return;
  }
  
  filtered.sort((a, b) => b.updatedAt - a.updatedAt).forEach(n => notesList.appendChild(createNoteListItem(n)));
}

function status(text, type = 'info', timeout = 2000) {
  clearTimeout(statusTimeout);
  statusEl.textContent = text || '';
  statusEl.className = `status ${type} ${text ? 'show' : ''}`;
  if (timeout !== -1 && text) statusTimeout = setTimeout(() => statusEl.className = 'status', timeout);
}

function clearEditor() {
  editingId = null;
  titleEl.value = '';
  contentEl.value = '';
  editorTitleEl.textContent = 'Nueva Nota';
  newBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg><span>Limpiar</span>`;
  newBtn.classList.remove('danger-text');
  updateCharCount();
  renderNotes();
}

function updateCharCount() {
  charCounterEl.textContent = `${contentEl.value.length} caracteres`;
}

async function performSave(isAutoSave = false) {
  const title = titleEl.value.trim();
  const content = contentEl.value.trim();
  if (!isAutoSave && !title && !content) {
    status('La nota está vacía.', 'danger');
    return;
  }

  const notes = await getNotes();
  const now = Date.now();

  if (editingId) {
    const note = notes.find(n => n.id === editingId);
    if (note) {
      if (note.title === title && note.content === content) return;
      note.title = title;
      note.content = content;
      note.updatedAt = now;
    }
  } else if (!isAutoSave) {
    notes.push({ id: crypto.randomUUID(), title, content, createdAt: now, updatedAt: now });
  } else {
    await browserAPI.storage.local.set({ editorDraft: { title, content } });
    return;
  }

  try {
    await saveNotes(notes);
    renderNotes();
    if (!isAutoSave) {
      status('¡Guardado!', 'success');
      clearEditor();
      switchTab('history');
    }
  } catch (e) {
    if (!isAutoSave) status('Error: ' + e.message, 'danger');
  }
}

// --- Eventos ---
saveBtn.addEventListener('click', () => performSave(false));
newBtn.addEventListener('click', clearEditor);
searchInput.addEventListener('input', (e) => renderNotes(e.target.value));

contentEl.addEventListener('input', () => {
  updateCharCount();
  clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(() => performSave(true), 1000);
});

// --- OCR y Extras ---
if (ocrBtn) {
  ocrBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        status('No se permite OCR en esta página.', 'danger');
        return;
      }

      status('Procesando OCR...', 'info', -1);
      const response = await chrome.runtime.sendMessage({ action: 'performBackgroundOCR', tab });
      
      if (response.success) {
        contentEl.value += (contentEl.value ? '\n\n' : '') + response.text;
        if (!titleEl.value) titleEl.value = tab.title;
        updateCharCount();
        status('¡OCR completado!', 'success');
        switchTab('create');
      } else {
        status('Error OCR: ' + response.error, 'danger');
      }
    } catch (e) {
      status('Error: ' + e.message, 'danger');
    }
  });
}

if (pinBtn) {
  pinBtn.addEventListener('click', async () => {
    try {
      if (chrome.sidePanel) {
        await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
        window.close();
      } else {
        await chrome.windows.create({ url: 'popup.html', type: 'popup', width: 450, height: 750 });
        window.close();
      }
    } catch (e) {
      status('Error al anclar.', 'danger');
    }
  });
}

// Inicialización
renderNotes();
browserAPI.storage.sync.get(['theme']).then(res => {
  if (res.theme) themeSelector.value = res.theme;
});