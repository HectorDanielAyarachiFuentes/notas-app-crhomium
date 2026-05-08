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
        const { data } = await cachedWorker.recognize(message.imagepath);
        
        const lines = (data.lines || []).map(line => {
          let maxHeight = line.bbox ? (line.bbox.y1 - line.bbox.y0) : 0;
          let minTop = line.bbox ? line.bbox.y0 : 0;
          
          const words = (line.words || []).map(word => {
            return {
              WordText: word.text,
              Left: word.bbox ? word.bbox.x0 : 0,
              Top: word.bbox ? word.bbox.y0 : 0,
              Width: word.bbox ? (word.bbox.x1 - word.bbox.x0) : 0,
              Height: word.bbox ? (word.bbox.y1 - word.bbox.y0) : 0
            };
          });

          return {
            MaxHeight: maxHeight,
            MinTop: minTop,
            Words: words
          };
        });

        const textOverlay = {
          HasOverlay: lines.length > 0,
          Message: "Total lines: " + lines.length,
          Lines: lines
        };
        
        sendResponse({ 
          result: { 
            ParsedResults: [{ ParsedText: data.text, TextOverlay: textOverlay }],
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
