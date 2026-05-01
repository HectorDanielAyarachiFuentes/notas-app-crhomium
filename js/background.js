import browserAPI from './browser-api.js';
import { getNotes, saveNotes } from './utils.js';

browserAPI.runtime.onInstalled.addListener(() => {
  console.log('Notas Pro: Extensión instalada/actualizada correctamente (V4).');
  // Crear el menú contextual para cuando el usuario selecciona texto
  browserAPI.contextMenus.create({
    id: "save-to-notes-selection",
    title: "Guardar en Notas Pro",
    contexts: ["selection"]
  });
});

// Escuchar clics en el menú contextual
browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-to-notes-selection" && info.selectionText) {
    handleAutoSave({
      content: info.selectionText.trim(),
      title: tab.title || "Selección web",
      url: tab.url
    });
  }
});

// Escuchar mensajes del monitor de portapapeles y el módulo OCR
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Acciones de Notas Pro ---
  if (message.action === 'autoSaveNote') {
    handleAutoSave(message);
    sendResponse({ success: true });
    return true;
  } 
  
  if (message.action === 'performBackgroundOCR') {
    handleBackgroundOCR(message.tab).then(sendResponse);
    return true;
  }

  // --- Eventos del Módulo OCR (Copyfish) ---
  if (message.evt === '_bootStrapResources') {
    (async () => {
      try {
        const configRes = await fetch(chrome.runtime.getURL('OCR/config/config.json'));
        const config = await configRes.text();
        const htmlRes = await fetch(chrome.runtime.getURL('OCR/dialog.html'));
        const htmlStr = await htmlRes.text();
        sendResponse({ config, htmlStr });
      } catch (e) {
        console.error('Error in _bootStrapResources:', e);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (message.evt === '_bootStrapMessageDialog') {
    (async () => {
      try {
        const htmlRes = await fetch(chrome.runtime.getURL('OCR/message-dialog.html'));
        const htmlStr = await htmlRes.text();
        sendResponse({ htmlStr });
      } catch (e) {
        console.error('Error in _bootStrapMessageDialog:', e);
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (message.evt === 'capture-screen') {
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 }, (dataURL) => {
      chrome.tabs.getZoom(sender.tab.id, (zf) => {
        sendResponse({ dataURL, zf });
      });
    });
    return true;
  }

  if (message.evt === 'saveOCRText') {
    handleAutoSave({
      content: message.text,
      title: (sender.tab && sender.tab.title) || "OCR Extraído",
      url: (sender.tab && sender.tab.url) || ""
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.evt === 'ready' || message.evt === 'capture-done') {
    isProcessingOCR = false;
    sendResponse({ success: true });
    return true;
  }

  if (message.evt === 'get-best-server') {
    (async () => {
      try {
        const configRes = await fetch(chrome.runtime.getURL('OCR/config/config.json'));
        const config = await configRes.json();
        const server = config.ocr_api_list[0]; // Por ahora devolvemos el primero
        sendResponse({ server: server });
      } catch (e) {
        console.error('Error en get-best-server:', e);
        sendResponse({ server: { id: "1" } }); // Fallback
      }
    })();
    return true;
  }

  if (message.evt === 'set-server-responsetime') {
    console.log('OCR Server response time updated:', message);
    sendResponse({ success: true });
    return true;
  }

	if (message.evt === 'open-window') {
		chrome.tabs.create({ url: message.url });
		sendResponse({ success: true });
		return true;
	}

	if (message.evt === 'open-settings') {
		chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=settings') });
		sendResponse({ success: true });
		return true;
	}

	if (message.evt === 'open-app') {
		chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
		sendResponse({ success: true });
		return true;
	}

  console.log('Mensaje no manejado:', message);
  return false;
});

async function handleAutoSave(data) {
  try {
    const notes = await getNotes();
    const now = Date.now();

    // Evitar duplicados exactos muy recientes
    const isDuplicate = notes.some(n => n.content === data.content && (now - n.createdAt < 5000));
    if (isDuplicate) return;

    const newNote = {
      id: crypto.randomUUID(),
      title: data.title ? (data.title.length > 30 ? data.title.substring(0, 30) + '...' : data.title) : "Copiado",
      content: data.content,
      createdAt: now,
      updatedAt: now,
      sourceUrl: data.url
    };

    notes.push(newNote);
    await saveNotes(notes);

    // Notificación visual
    browserAPI.notifications.create('save-' + Date.now(), {
      type: 'basic',
      iconUrl: '/icons/icon-48.png', 
      title: '¡Nota Guardada!',
      message: data.content.length > 60 ? data.content.substring(0, 60) + '...' : data.content,
      silent: true
    }).catch(err => console.warn('Error al mostrar notificación:', err));
  } catch (error) {
    console.error('Error al auto-guardar nota:', error);
  }
}

// --- OCR Logic (Enhanced with Copyfish) ---
let isProcessingOCR = false;

async function handleBackgroundOCR(tab) {
  if (isProcessingOCR) return { success: false, error: 'Ya hay un proceso en curso.' };
  isProcessingOCR = true;

  try {
    // Verificar disponibilidad del tab
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => true });
    } catch (e) {
      isProcessingOCR = false;
      throw new Error('No se puede acceder a esta página por restricciones del navegador (ej. páginas internas de Chrome).');
    }

    // Inyectar polyfill y dependencias
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'OCR/scripts/crossbrowser.js',
        'OCR/scripts/jquery.min.js',
        'OCR/scripts/overlay.js',
        'OCR/scripts/cs.js'
      ]
    });

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [
        'OCR/styles/cs.css'
      ]
    });

    // Esperar un momento para la inicialización de los scripts
    await new Promise(r => setTimeout(r, 400));

    // Activar selección
    chrome.tabs.sendMessage(tab.id, { evt: 'enableselection' });
    
    // Seguridad: Resetear flag después de un tiempo razonable si algo falla
    setTimeout(() => { isProcessingOCR = false; }, 10000);

    return { success: true };

  } catch (error) {
    isProcessingOCR = false;
    return { success: false, error: error.message };
  }
}

