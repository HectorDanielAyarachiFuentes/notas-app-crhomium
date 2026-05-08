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

        // Preprocesar la imagen para mejorar enormemente la precisión del OCR
        const preprocessed = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const scale = 3; // Escalar 3x para ultra alta resolución
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              const ctx = canvas.getContext('2d');
              
              // Habilitar suavizado de alta calidad para preservar las curvas de la arroba '@'
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              
              // 1. Dibujar la imagen original para analizar su brillo
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imgData.data;
              let colorSum = 0;
              // Muestrear píxeles para calcular el brillo promedio
              for(let x = 0, len = data.length; x < len; x+=16) {
                  colorSum += (data[x] + data[x+1] + data[x+2]) / 3;
              }
              let brightness = Math.floor(colorSum / (data.length / 16));
              
              // 2. Si es Dark Mode (brillo < 127), aplicar INVERTIR
              let invertFilter = brightness < 127 ? ' invert(100%)' : '';
              
              // 3. Limpiar y redibujar con escala de grises. 
              // Quitamos el contrast(150%) porque destruye el anti-aliasing y rompe las líneas finas del @
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.filter = 'grayscale(100%)' + invertFilter;
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              
              resolve({
                dataUrl: canvas.toDataURL('image/jpeg', 1.0),
                scale: scale
              });
            } catch (e) {
              reject(new Error('Error al procesar la imagen en canvas: ' + e.message));
            }
          };
          img.onerror = () => reject(new Error('Error al cargar la imagen para preprocesamiento.'));
          img.src = message.imagepath;
        });

        console.log('Offscreen: Procesando OCR...');
        
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
