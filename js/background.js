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

// Escuchar mensajes del monitor de portapapeles
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'autoSaveNote') {
    handleAutoSave(message);
    sendResponse({ success: true });
  }
  return true;
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

    // Notificación visual (Ruta corregida sin / inicial)
    browserAPI.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-48.png', 
      title: '¡Nota Guardada!',
      message: data.content.length > 60 ? data.content.substring(0, 60) + '...' : data.content,
      silent: true
    });
  } catch (error) {
    console.error('Error al auto-guardar nota:', error);
  }
}
