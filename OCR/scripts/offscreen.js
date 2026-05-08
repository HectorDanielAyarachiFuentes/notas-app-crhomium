let cachedWorker = null;
let currentLang = null;
let currentMode = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.evt === 'performLocalOCR') {
    (async () => {
      try {
        let lang = message.ocrLang || 'spa';
        // Añadir siempre inglés como modelo secundario para perfeccionar lectura de '@', números y usernames
        if (lang !== 'eng') {
           lang = lang + '+eng';
        }
        const isBestMode = !!message.bestMode;
        
        if (!cachedWorker || currentLang !== lang || currentMode !== isBestMode) {
          if (cachedWorker) {
            await cachedWorker.terminate();
          }
          
          console.log(`Offscreen: Creando worker para: ${lang} (Mode: ${isBestMode ? 'Best' : 'Fast'})`);
          
          const langPathDir = isBestMode ? 'OCR/tessdata_best/' : 'OCR/tessdata/';

          cachedWorker = await Tesseract.createWorker(lang, 1, {
            workerPath: chrome.runtime.getURL('OCR/scripts/worker.min.js'),
            corePath: chrome.runtime.getURL('OCR/scripts/tesseract-core-simd.wasm.js'),
            langPath: chrome.runtime.getURL(langPathDir),
            workerBlobURL: false,
            cacheMethod: 'none',
            gzip: true
          });
          currentLang = lang;
          currentMode = isBestMode;
        }

        // Preprocesar la imagen para mejorar la precisión del OCR
        const preprocessed = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const scale = 3; // Escalar 3x para alta resolución
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              const ctx = canvas.getContext('2d');

              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';

              // 1. Dibujar imagen escalada
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imgData.data;

              // 2. Convertir a grises con luminancia perceptual y buscar min/max
              //    (naranja RGB(255,165,0) → ~173; negro → 0; blanco → 255)
              let minGray = 255, maxGray = 0;
              const grays = new Uint8Array(canvas.width * canvas.height);
              let pi = 0;
              for (let i = 0; i < data.length; i += 4) {
                let g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
                grays[pi++] = g;
                if (g < minGray) minGray = g;
                if (g > maxGray) maxGray = g;
              }

              // 3. Histogram stretching: estirar el rango real al rango 0-255
              //    Maximiza el contraste sin destruir información (Tesseract binariza internamente)
              const range = maxGray - minGray || 1;
              let brightnessSum = 0;
              pi = 0;
              for (let i = 0; i < data.length; i += 4) {
                let stretched = Math.round((grays[pi++] - minGray) / range * 255);
                brightnessSum += stretched;
                data[i] = data[i+1] = data[i+2] = stretched;
              }

              // 4. Si fondo oscuro, invertir para que Tesseract reciba texto oscuro sobre fondo claro
              const avgBrightness = brightnessSum / (data.length / 4);
              if (avgBrightness < 127) {
                for (let i = 0; i < data.length; i += 4) {
                  data[i] = data[i+1] = data[i+2] = 255 - data[i];
                }
              }

              ctx.putImageData(imgData, 0, 0);
              resolve({ dataUrl: canvas.toDataURL('image/png'), scale: scale });
            } catch (e) {
              reject(new Error('Error al procesar imagen: ' + e.message));
            }
          };
          img.onerror = () => reject(new Error('Error al cargar imagen.'));
          img.src = message.imagepath;
        });

        console.log('Offscreen: Procesando OCR...');

        // PSM 6 = SINGLE_BLOCK: trata la imagen como un bloque uniforme de texto.
        // Es el modo ideal para carteles, letreros e imágenes con pocas líneas.
        // PSM 3 (auto) falla en estas imágenes porque intenta detectar columnas/párrafos.
        try {
          await cachedWorker.setParameters({ tessedit_pageseg_mode: '6' });
        } catch(e) {
          console.warn('Offscreen: No se pudo fijar PSM, usando modo por defecto.', e);
        }

        // Timeout de seguridad de 30 segundos
        const recognizePromise = cachedWorker.recognize(preprocessed.dataUrl);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('El motor OCR tardó demasiado (Timeout)')), 30000));
        
        const { data } = await Promise.race([recognizePromise, timeoutPromise]);
        
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
