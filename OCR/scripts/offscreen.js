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

        // Preprocesar la imagen para mejorar enormemente la precisión del OCR
        const preprocessed = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = 2; // Escalar 2x mejora la lectura de textos pequeños
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            
            // Filtro de escala de grises y aumento de contraste (binarización simple)
            ctx.filter = 'grayscale(100%) contrast(150%)';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            resolve({
              dataUrl: canvas.toDataURL('image/jpeg', 1.0),
              scale: scale
            });
          };
          img.src = message.imagepath;
        });

        console.log('Offscreen: Procesando OCR...');
        const { data } = await cachedWorker.recognize(preprocessed.dataUrl);
        const scale = preprocessed.scale;
        
        const lines = (data.lines || []).map(line => {
          let maxHeight = line.bbox ? ((line.bbox.y1 - line.bbox.y0) / scale) : 0;
          let minTop = line.bbox ? (line.bbox.y0 / scale) : 0;
          
          const words = (line.words || []).map(word => {
            return {
              WordText: word.text,
              Left: word.bbox ? (word.bbox.x0 / scale) : 0,
              Top: word.bbox ? (word.bbox.y0 / scale) : 0,
              Width: word.bbox ? ((word.bbox.x1 - word.bbox.x0) / scale) : 0,
              Height: word.bbox ? ((word.bbox.y1 - word.bbox.y0) / scale) : 0
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
