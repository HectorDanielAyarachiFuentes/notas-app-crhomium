// js/clipboard-monitor.js - Versión Robusta V4
(function() {
    const VERSION = "V4";
    if (window.hasClipboardMonitor === VERSION) return;
    window.hasClipboardMonitor = VERSION;

    console.log(`Notas Pro: Monitor de portapapeles ${VERSION} activo.`);

    document.addEventListener('copy', () => {
        // Intentar obtener el API de forma segura
        const api = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) ? chrome : 
                    ((typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) ? browser : null);

        if (!api) {
            console.log('Notas Pro: No se pudo encontrar el API de la extensión. Por favor, REFRESCA esta pestaña.');
            return;
        }

        // 1. Obtener texto seleccionado (normal o de inputs)
        let text = window.getSelection().toString();
        if (!text) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                text = activeEl.value.substring(activeEl.selectionStart, activeEl.selectionEnd);
            }
        }
        
        if (text && text.trim().length > 0) {
            console.log('Notas Pro: Texto detectado, enviando...');
            try {
                api.runtime.sendMessage({
                    action: 'autoSaveNote',
                    content: text.trim(),
                    url: window.location.href,
                    title: document.title
                }, (response) => {
                    // Manejar posible error de desconexión
                    if (api.runtime.lastError) {
                        console.log('Notas Pro: El contexto cambió, se requiere refrescar la página.');
                    }
                });
            } catch (e) {
                console.error('Notas Pro: Error crítico al enviar mensaje:', e);
            }
        }
    });
})();
