let cachedWorker = null;
let currentLang = null;
let currentMode = null;
let workerCreationPromise = null;
let ocrMutex = Promise.resolve(); // Cola de exclusión mutua para evitar crashes de WASM

async function getOrCreateWorker(targetLang, isBestMode) {
  let lang = targetLang || 'spa';
  if (lang !== 'eng') lang = lang + '+eng';

  if (cachedWorker && currentLang === lang && currentMode === isBestMode) {
    return cachedWorker;
  }

  if (workerCreationPromise) {
    await workerCreationPromise;
    if (cachedWorker && currentLang === lang && currentMode === isBestMode) return cachedWorker;
  }

  workerCreationPromise = (async () => {
    let attempts = 0;
    let useBest = isBestMode;

    while (attempts < 2) {
      try {
        if (cachedWorker) {
          await cachedWorker.terminate().catch(() => {});
          cachedWorker = null;
        }
        
        console.log(`Offscreen: Iniciando Worker Local v7 (${lang}, Best: ${useBest}, Intento: ${attempts + 1})`);
        
        // Rutas relativas desde offscreen.html (ubicado en /OCR/)
        const workerPath = 'scripts/worker.min.js';
        const corePath = 'scripts/tesseract-core-simd.wasm.js';
        const langPath = useBest ? 'tessdata_best/' : 'tessdata/';

        // Inicialización nativa v7 (más rápida y eficiente)
        const worker = await Tesseract.createWorker(lang, useBest ? 1 : 3, {
          workerPath: workerPath,
          corePath: corePath,
          langPath: langPath,
          workerBlobURL: false,
          gzip: true,
          logger: m => {
            if (m.status === 'recognizing text') {
              console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        });

        cachedWorker = worker;
        currentLang = lang;
        currentMode = useBest;
        return cachedWorker;
      } catch (e) {
        console.error(`Offscreen: Error en intento ${attempts + 1} (Best: ${useBest}):`, e);
        attempts++;
        if (useBest) {
          console.log('Offscreen: Fallback a modo Fast por error en modelo Best');
          useBest = false; // Intentar con el modelo ligero si el pesado falla
        }
        if (cachedWorker) {
          await cachedWorker.terminate().catch(() => {});
          cachedWorker = null;
        }
        if (attempts >= 2) throw e;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  })();

  try {
    return await workerCreationPromise;
  } finally {
    workerCreationPromise = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.evt === 'preloadLocalOCR') {
    getOrCreateWorker(message.ocrLang, message.bestMode).catch(e => console.warn('Offscreen: Precarga falló:', e));
    sendResponse({ success: true });
    return true;
  }

  if (message.evt === 'performLocalOCR') {
    const task = async () => {
      try {
        await getOrCreateWorker(message.ocrLang, message.bestMode);

        // Preprocesar la imagen para mejorar la precisión del OCR
        const preprocessed = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              const MAX_PIXELS = 4000000; // Límite seguro de memoria para WebAssembly (4 MP)
              let scale = Math.max(1, Math.min(3, 1500 / img.width));
              
              if ((img.width * scale) * (img.height * scale) > MAX_PIXELS) {
                scale = Math.sqrt(MAX_PIXELS / (img.width * img.height));
              }
              
              canvas.width = Math.floor(img.width * scale);
              canvas.height = Math.floor(img.height * scale);
              const ctx = canvas.getContext('2d');
              ctx.imageSmoothingEnabled = false;

              // 1. Dibujar imagen escalada
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imgData.data;

              // Guardar copia de colores originales para detección de emojis por color
              const origColors = new Uint8Array(data.length);
              origColors.set(data);

              // 2. Preprocesamiento integral: Escala de grises + Normalización
              const totalPixels = canvas.width * canvas.height;
              let minGray = 255, maxGray = 0;
              for (let i = 0; i < data.length; i += 4) {
                let g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
                data[i] = g;
                if (g < minGray) minGray = g;
                if (g > maxGray) maxGray = g;
              }
              
              const range = maxGray - minGray || 1;
              let brightnessSum = 0;
              for (let i = 0; i < data.length; i += 4) {
                let stretched = Math.round((data[i] - minGray) / range * 255);
                brightnessSum += stretched;
                data[i] = data[i+1] = data[i+2] = stretched;
              }
              
              const avgBrightness = brightnessSum / totalPixels;
              if (avgBrightness < 127) {
                for (let i = 0; i < data.length; i += 4) {
                  data[i] = data[i+1] = data[i+2] = 255 - data[i];
                }
              }

              // 3. Reducción de Ruido y Binarización de Otsu
              let histogram = new Int32Array(256);
              for (let i = 0; i < data.length; i += 4) histogram[data[i]]++;
              
              let sum = 0;
              for (let t = 0; t < 256; t++) sum += t * histogram[t];
              let sumB = 0, wB = 0, wF = 0, varMax = 0, otsuThreshold = 0;
              for (let t = 0; t < 256; t++) {
                wB += histogram[t];
                if (wB === 0) continue;
                wF = totalPixels - wB;
                if (wF === 0) break;
                sumB += t * histogram[t];
                let mB = sumB / wB;
                let mF = (sum - sumB) / wF;
                let varBetween = wB * wF * (mB - mF) * (mB - mF);
                if (varBetween > varMax) {
                  varMax = varBetween;
                  otsuThreshold = t;
                }
              }

              const finalThreshold = Math.min(255, otsuThreshold + 15);
              for (let i = 0; i < data.length; i += 4) {
                const bw = data[i] <= finalThreshold ? 0 : 255;
                data[i] = data[i+1] = data[i+2] = bw;
              }

              // 4. Detección Inteligente de Columnas
              let isMultiColumn = false;
              if (message.psmMode === 'auto') {
                const w = canvas.width;
                const h = canvas.height;
                const colDarkness = new Uint32Array(w);
                for (let y = 0; y < h; y++) {
                  for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    if (data[i] < 128) colDarkness[x]++;
                  }
                }
                let textBlockCount = 0;
                let inTextBlock = false;
                let currentGutterWidth = 0;
                const minGutterWidth = Math.max(10, Math.floor(w * 0.015)); 
                for (let x = 0; x < w; x++) {
                  const hasText = colDarkness[x] > 2;
                  if (hasText) {
                    currentGutterWidth = 0;
                    if (!inTextBlock) { inTextBlock = true; textBlockCount++; }
                  } else {
                    currentGutterWidth++;
                    if (currentGutterWidth > minGutterWidth && inTextBlock) inTextBlock = false;
                  }
                }
                isMultiColumn = textBlockCount >= 2;
              }

              ctx.putImageData(imgData, 0, 0);
              resolve({ 
                dataUrl: canvas.toDataURL('image/png'), 
                scale: scale, 
                origColors: origColors, 
                imgWidth: canvas.width, 
                imgHeight: canvas.height,
                isMultiColumn: isMultiColumn 
              });
            } catch (e) {
              reject(new Error('Error al procesar imagen: ' + e.message));
            }
          };
          img.onerror = () => reject(new Error('Error al cargar imagen.'));
          img.src = message.imagepath;
        });

        console.log('Offscreen: Procesando OCR...');
        let psm = message.psmMode || 'auto';
        if (psm === 'auto') psm = preprocessed.isMultiColumn ? '3' : '6';
        await cachedWorker.setParameters({ tessedit_pageseg_mode: psm });

        // En Tesseract.js v7, debemos solicitar explícitamente los formatos de salida adicionales (blocks, lines, words, etc.)
        // para mantener la reconstrucción estructural que usa el resto del script.
        const recognizePromise = cachedWorker.recognize(preprocessed.dataUrl, {}, { 
          blocks: true, 
          lines: true, 
          words: true 
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout OCR')), 30000));
        const { data } = await Promise.race([recognizePromise, timeoutPromise]);

        // ── Paso 5: Ensamblaje Estructural Semántico ──
        const forceTableFormat = (message.psmMode === '3');
        let finalOutput = '';

        if (forceTableFormat) {
          // MODO TABLA: Reconstrucción geométrica
          let mergedLines = [];
          let allWords = (data.words || []).filter(w => (w.text || '').trim().length > 0 && w.bbox);
          allWords.sort((a, b) => ((a.bbox.y0 + a.bbox.y1) / 2) - ((b.bbox.y0 + b.bbox.y1) / 2));

          for (const word of allWords) {
            const midY = (word.bbox.y0 + word.bbox.y1) / 2;
            let placed = false;
            for (let i = mergedLines.length - 1; i >= 0; i--) {
              const row = mergedLines[i];
              const rowMidY = (row.bbox.y0 + row.bbox.y1) / 2;
              if (Math.abs(midY - rowMidY) < (row.bbox.y1 - row.bbox.y0) * 0.4) {
                row.words.push(word);
                row.bbox.x0 = Math.min(row.bbox.x0, word.bbox.x0);
                row.bbox.x1 = Math.max(row.bbox.x1, word.bbox.x1);
                row.bbox.y0 = Math.min(row.bbox.y0, word.bbox.y0);
                row.bbox.y1 = Math.max(row.bbox.y1, word.bbox.y1);
                placed = true; break;
              }
            }
            if (!placed) mergedLines.push({ words: [word], bbox: { ...word.bbox } });
          }

          for (const row of mergedLines) {
            row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
            const cleaned = cleanAndFormatWords(row.words);
            if (cleaned) finalOutput += `| ${cleaned.replace(/  +/g, ' | ')} |\n`;
          }
          if (finalOutput) {
            const lines = finalOutput.split('\n');
            const cols = lines[0].split('|').length - 2;
            let sep = '|'; for(let c=0; c<cols; c++) sep += ' --- |';
            finalOutput = lines[0] + '\n' + sep + '\n' + lines.slice(1).join('\n');
          }
        } else {
          // MODO FLUJO: Bloques y Párrafos (Mantiene estructura de columnas)
          const blocks = data.blocks || [];
          for (const block of blocks) {
            let blockText = '';
            for (const para of block.paragraphs || []) {
              let paraText = '';
              for (const line of para.lines || []) {
                const cleanedLine = cleanAndFormatWords(line.words);
                if (cleanedLine) {
                  if (paraText.endsWith('-')) paraText = paraText.slice(0, -1) + cleanedLine;
                  else paraText += (paraText ? ' ' : '') + cleanedLine;
                }
              }
              if (paraText) blockText += (blockText ? '\n\n' : '') + paraText;
            }
            if (blockText) finalOutput += (finalOutput ? '\n\n' : '') + blockText;
          }
        }

        // ── Paso 6: Correcciones gramaticales y limpieza final ──
        let formattedText = finalOutput.trim().split('\n').map(line => {
          let text = line.trim();
          if (!text || text.startsWith('|')) return text;
          text = text.replace(/^[\x22\u201c\u201d\u201e\u201f\u2018\u2019\u00ab\u00bb"""''`´]+\s*/, '');
          text = text.replace(/^[a-zA-Z]{1,3}\s*[.,;:]\s+/g, '');
          text = text.replace(/\s+[|\\\/]$/, '');
          text = text.replace(/(\w)[''`´'](\w)/g, '$1 $2');
          return text.replace(/  +/g, ' ');
        }).join('\n');

        formattedText = formattedText.replace(/\n{3,}/g, '\n\n');

        const spanishFixes = [
          [/\bair\b/g, 'a ir'], [/\bala\b(?=\s)/g, 'a la'], [/\bdela\b/g, 'de la'], 
          [/\benla\b/g, 'en la'], [/\benel\b/g, 'en el'], [/\bmeha\b/gi, 'me ha'],
          [/\bvolveria\b/g, 'volvería'], [/\bseria\b/g, 'sería'], [/\bpodria\b/g, 'podría']
        ];
        for (const [p, r] of spanishFixes) formattedText = formattedText.replace(p, r);

        // Overlay para la UI (Ajustado a la escala)
        let flatWords = data.words || [];
        if (flatWords.length === 0 && data.blocks) {
          data.blocks.forEach(b => {
            (b.paragraphs || []).forEach(p => {
              (p.lines || []).forEach(l => {
                (l.words || []).forEach(w => flatWords.push(w));
              });
            });
          });
        }
        
        const scale = preprocessed.scale;
        const allWordsForOverlay = flatWords.filter(w => (w.text || '').trim().length > 0 && w.bbox);
        
        const textOverlay = {
          HasOverlay: allWordsForOverlay.length > 0,
          Lines: allWordsForOverlay.map(w => ({
            MaxHeight: ((w.bbox.y1 - w.bbox.y0) / scale),
            MinTop: (w.bbox.y0 / scale),
            Words: [{
              WordText: w.text,
              Left: (w.bbox.x0 / scale), 
              Top: (w.bbox.y0 / scale),
              Width: ((w.bbox.x1 - w.bbox.x0) / scale), 
              Height: ((w.bbox.y1 - w.bbox.y0) / scale)
            }]
          }))
        };

        // Formato de respuesta esperado por cs.js (Copyfish style)
        sendResponse({ 
          result: {
            ParsedResults: [{ ParsedText: formattedText, TextOverlay: textOverlay }],
            IsErroredOnProcessing: false,
            OCRExitCode: 1
          }
        });
      } catch (e) {
        console.error('Offscreen Error:', e);
        // Si hay un error crítico en el WASM, terminamos el worker para que se reinicie en la próxima llamada
        if (cachedWorker) {
          try {
            await cachedWorker.terminate();
          } catch(err) {
            console.warn('Offscreen: No se pudo terminar el worker accidentado:', err);
          }
          cachedWorker = null;
        }
        sendResponse({ error: e.message });
      }
    };

    ocrMutex = ocrMutex.then(task);
    return true;
  }
});

function cleanAndFormatWords(words) {
  if (!words || !words.length) return '';
  const cleanWords = [];
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    const conf = word.confidence || 0;
    let text = (word.text || '').trim();
    if (!text || /^[|_~=\-\\\/\[\]{}<>]+$/.test(text)) continue;
    if (conf < 60 && /^[.,;:!?'"'`´""''«»]+$/.test(text)) continue;
    text = text.replace(/^[''`´"""\u201c\u201d]+/, '').replace(/[''`´"""\u201c\u201d]+$/, '');
    if (!text) continue;

    if (conf < 50) {
      const emoji = detectEmoji(text, words[w+1]);
      if (emoji) { cleanWords.push(emoji.text); if (emoji.consumed) w++; continue; }
    }

    if (w + 1 < words.length) {
      const fused = tryFuseWords(word, words[w+1]);
      if (fused) { cleanWords.push(fused); w++; continue; }
    }

    const isCapitalized = text.length > 0 && text[0] === text[0].toUpperCase();
    const hasAccent = /[áéíóúÁÉÍÓÚ]/.test(text);
    const trustThreshold = (hasAccent || isCapitalized) ? 70 : 80;

    if (conf >= trustThreshold || isSpanishWord(text)) cleanWords.push(text);
    else {
      const corrected = autoCorrectOCRWord(text) || trySplitMergedWord(text);
      if (corrected) cleanWords.push(corrected);
      else if (text.length >= 4 && /[aeiouáéíóú]/i.test(text)) cleanWords.push(text);
    }
  }
  return cleanWords.join(' ');
}

function detectEmoji(text, nextWord) {
  const MAP = { 'Q': '👎', 'qb': '👎', 'db': '👍', 'dh': '👍', 'E8': '😎', 'eD': '😂', '8D': '😂', '<3': '❤️' };
  if (MAP[text]) return { text: MAP[text], consumed: false };
  if (nextWord && MAP[text + nextWord.text.trim()]) return { text: MAP[text + nextWord.text.trim()], consumed: true };
  return null;
}

function tryFuseWords(w1, w2) {
  const gap = w2.bbox.x0 - w1.bbox.x1;
  if (gap / (w1.bbox.y1 - w1.bbox.y0) < 0.25) {
    const combined = w1.text.trim() + w2.text.trim();
    if (isSpanishWord(combined)) return combined;
    return autoCorrectOCRWord(combined);
  }
  return null;
}
