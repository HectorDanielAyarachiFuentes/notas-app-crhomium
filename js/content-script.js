// content-script.js - Maneja la selección de área en la página web
(function() {
  if (window.hasOcrSelectionScript) return;
  window.hasOcrSelectionScript = true;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startSelection") {
      startSelection(sendResponse);
      return true; // Mantener el canal abierto para respuesta asíncrona
    }
  });

  function startSelection(callback) {
    const overlay = document.createElement('div');
    overlay.id = 'ocr-selection-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.3);
      cursor: crosshair;
      z-index: 999999999;
    `;

    const selector = document.createElement('div');
    selector.style.cssText = `
      position: absolute;
      border: 2px solid #4361ee;
      background: rgba(67, 97, 238, 0.1);
      display: none;
    `;

    overlay.appendChild(selector);
    document.body.appendChild(overlay);

    let startX, startY;
    let isSelecting = false;

    overlay.onmousedown = (e) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      selector.style.left = startX + 'px';
      selector.style.top = startY + 'px';
      selector.style.width = '0px';
      selector.style.height = '0px';
      selector.style.display = 'block';
    };

    overlay.onmousemove = (e) => {
      if (!isSelecting) return;
      const currentX = e.clientX;
      const currentY = e.clientY;
      
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      const left = Math.min(currentX, startX);
      const top = Math.min(currentY, startY);

      selector.style.width = width + 'px';
      selector.style.height = height + 'px';
      selector.style.left = left + 'px';
      selector.style.top = top + 'px';
    };

    overlay.onmouseup = () => {
      isSelecting = false;
      const rect = selector.getBoundingClientRect();
      document.body.removeChild(overlay);
      
      // Enviar coordenadas y dimensiones (ajustadas al pixel ratio)
      callback({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        devicePixelRatio: window.devicePixelRatio
      });
    };

    // Permitir cancelar con Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
        callback({ cancelled: true });
      }
    };
    document.addEventListener('keydown', escHandler);
  }
})();
