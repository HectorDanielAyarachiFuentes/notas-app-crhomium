import browserAPI from './browser-api.js';
import { getNotes, saveNotes } from './utils.js';

browserAPI.runtime.onInstalled.addListener(() => {
  console.log('Notas Pro: Extensión instalada correctamente.');
  browserAPI.contextMenus.create({
    id: "save-to-notes-selection",
    title: "Guardar en Notas Pro",
    contexts: ["selection"]
  });
});

browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "save-to-notes-selection" && info.selectionText) {
    handleAutoSave({
      content: info.selectionText.trim(),
      title: tab.title || "Selección web",
      url: tab.url
    });
  }
});

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'autoSaveNote') {
    handleAutoSave(message);
    sendResponse({ success: true });
  } else if (message.action === 'performBackgroundOCR') {
    handleBackgroundOCR(message.tab).then(sendResponse);
    return true;
  }
  return true;
});

async function handleAutoSave(data) {
  try {
    const notes = await getNotes();
    const now = Date.now();
    const isDuplicate = notes.some(n => n.content === data.content && (now - n.createdAt < 5000));
    if (isDuplicate) return;

    notes.push({
      id: crypto.randomUUID(),
      title: data.title ? (data.title.length > 30 ? data.title.substring(0, 30) + '...' : data.title) : "Copiado",
      content: data.content,
      createdAt: now,
      updatedAt: now,
      sourceUrl: data.url
    });
    await saveNotes(notes);

    browserAPI.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png', 
      title: '¡Nota Guardada!',
      message: data.content.length > 60 ? data.content.substring(0, 60) + '...' : data.content
    });
  } catch (error) {
    console.error('Error al auto-guardar:', error);
  }
}

// --- OCR Logic ---
let isProcessingOCR = false;

async function handleBackgroundOCR(tab) {
  if (isProcessingOCR) return { success: false, error: 'Ya hay un proceso en curso.' };
  isProcessingOCR = true;

  try {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['js/content-script.js'] });
    } catch (e) {
      throw new Error('No se puede acceder a esta página por restricciones del navegador.');
    }

    const selection = await chrome.tabs.sendMessage(tab.id, { action: "startSelection" });
    if (!selection || selection.cancelled) {
      isProcessingOCR = false;
      return { success: false, cancelled: true };
    }

    const fullDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const croppedDataUrl = await processImageOffscreen(fullDataUrl, selection);
    const extractedText = await callOCRSpace(croppedDataUrl);

    if (extractedText) {
      const notes = await getNotes();
      const now = Date.now();
      const footer = `\n\n--- \nFuente: ${tab.url}`;
      
      notes.push({
        id: crypto.randomUUID(),
        title: tab.title || 'Nota de OCR',
        content: extractedText + footer,
        createdAt: now,
        updatedAt: now,
        sourceUrl: tab.url
      });
      await saveNotes(notes);

      browserAPI.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'OCR Finalizado',
        message: 'El texto ha sido guardado en tus notas.'
      });

      isProcessingOCR = false;
      return { success: true, text: extractedText };
    } else {
      throw new Error('No se detectó texto.');
    }
  } catch (error) {
    isProcessingOCR = false;
    return { success: false, error: error.message };
  }
}

async function processImageOffscreen(dataUrl, coords) {
  if (!(await hasOffscreenDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'OCR Image Processing'
    });
  }
  const response = await chrome.runtime.sendMessage({ action: 'cropImage', dataUrl, coords });
  if (response.success) return response.croppedDataUrl;
  throw new Error(response.error);
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function callOCRSpace(dataUrl) {
  const formData = new FormData();
  formData.append('base64image', dataUrl);
  formData.append('language', 'spa');
  formData.append('apikey', 'helloworld');
  const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: formData });
  const result = await response.json();
  if (result.IsErroredOnProcessing) throw new Error(result.ErrorMessage[0]);
  return result.ParsedResults[0].ParsedText;
}
