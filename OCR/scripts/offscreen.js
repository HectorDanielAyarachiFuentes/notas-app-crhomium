// offscreen.js
let cachedWorker = null;
let currentLang = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.evt === 'performLocalOCR') {
    (async () => {
      try {
        const lang = message.ocrLang || 'spa';
        
        if (!cachedWorker || currentLang !== lang) {
          if (cachedWorker) {
            await cachedWorker.terminate();
          }
          
          console.log('Offscreen: Creando worker para:', lang);
          // Usamos rutas absolutas y DESACTIVAMOS el blob para evitar problemas de origen en Opera
          cachedWorker = await Tesseract.createWorker(lang, 1, {
            workerPath: chrome.runtime.getURL('OCR/scripts/worker.min.js'),
            corePath: chrome.runtime.getURL('OCR/scripts/tesseract-core-simd.wasm.js'),
            langPath: chrome.runtime.getURL('OCR/tessdata/'),
            workerBlobURL: false, // CLAVE: Evita que se cree un blob: origin que Opera bloquea
            cacheMethod: 'none',
            gzip: true
          });
          currentLang = lang;
        }

        console.log('Offscreen: Procesando...');
        const { data: { text } } = await cachedWorker.recognize(message.imagepath);
        
        sendResponse({ 
          result: { 
            ParsedResults: [{ ParsedText: text, TextOverlay: { Lines: [] } }],
            IsErroredOnProcessing: false,
            OCRExitCode: 1
          } 
        });
      } catch (e) {
        console.error('Error en Offscreen OCR:', e);
        if (cachedWorker) {
          await cachedWorker.terminate();
          cachedWorker = null;
        }
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }
});
