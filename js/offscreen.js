// js/offscreen.js - Canvas image processing in background

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'cropImage') {
    try {
      const croppedDataUrl = await cropImage(message.dataUrl, message.coords);
      sendResponse({ success: true, croppedDataUrl });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

async function cropImage(dataUrl, coords) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = coords.devicePixelRatio || 1;
      const sx = coords.x * dpr;
      const sy = coords.y * dpr;
      const sw = coords.width * dpr;
      const sh = coords.height * dpr;
      const maxDim = 1200;
      let scale = 1;
      if (sw > maxDim || sh > maxDim) {
        scale = Math.min(maxDim / sw, maxDim / sh);
      }

      canvas.width = sw * scale;
      canvas.height = sh * scale;
      
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => reject(new Error("Error al cargar la imagen en offscreen"));
    img.src = dataUrl;
  });
}
