let cachedWorker = null;
let currentLang = null;
let currentMode = null;
let workerCreationPromise = null;

async function getOrCreateWorker(targetLang, isBestMode) {
  let lang = targetLang || 'spa';
  // Añadir siempre inglés como modelo secundario
  if (lang !== 'eng') lang = lang + '+eng';

  if (cachedWorker && currentLang === lang && currentMode === isBestMode) {
    return cachedWorker;
  }

  // Si ya hay una creación en proceso, esperamos a que termine
  if (workerCreationPromise) {
    await workerCreationPromise;
    if (cachedWorker && currentLang === lang && currentMode === isBestMode) {
      return cachedWorker;
    }
  }

  workerCreationPromise = (async () => {
    if (cachedWorker) {
      await cachedWorker.terminate();
    }
    
    console.log(`Offscreen: Creando/Precargando worker para: ${lang} (Mode: ${isBestMode ? 'Best' : 'Fast'})`);
    const langPathDir = isBestMode ? 'OCR/tessdata_best/' : 'OCR/tessdata/';

    cachedWorker = await Tesseract.createWorker(lang, 1, {
      workerPath: chrome.runtime.getURL('OCR/scripts/worker.min.js'),
      corePath: chrome.runtime.getURL('OCR/scripts/tesseract-core-simd.wasm.js'),
      langPath: chrome.runtime.getURL(langPathDir),
      workerBlobURL: false,
      cacheMethod: 'write', // Cambiado a 'write' para cachear en IndexedDB y acelerar arranques futuros
      gzip: true
    });
    currentLang = lang;
    currentMode = isBestMode;
  })();

  await workerCreationPromise;
  workerCreationPromise = null;
  return cachedWorker;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.evt === 'preloadLocalOCR') {
    getOrCreateWorker(message.ocrLang, message.bestMode).catch(e => console.warn('Offscreen: Precarga falló:', e));
    sendResponse({ success: true });
    return true;
  }

  if (message.evt === 'performLocalOCR') {
    (async () => {
      try {
        await getOrCreateWorker(message.ocrLang, message.bestMode);

        // Preprocesar la imagen para mejorar la precisión del OCR
        const preprocessed = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              // Escalar dinámicamente: Tesseract prefiere texto de ~30px de alto.
              // Imágenes enormes (ej: 2000px) confunden al motor, y pequeñas necesitan escalado.
              // Apuntamos a un ancho óptimo de ~1500px, con un factor máximo de 3x y mínimo de 1x.
              const scale = Math.max(1, Math.min(3, 1500 / img.width));
              canvas.width = img.width * scale;
              canvas.height = img.height * scale;
              const ctx = canvas.getContext('2d');

              // DESACTIVAR el suavizado (anti-aliasing). El suavizado difumina los bordes
              // de las fuentes condensadas/pegadas, haciendo que Tesseract fusione letras
              // (ej: "municipales" -> "Muelas"). Bordes nítidos (crisp edges) son clave para OCR.
              ctx.imageSmoothingEnabled = false;

              // 1. Dibujar imagen escalada
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              let data = imgData.data;

              // Guardar copia de colores originales para detección de emojis por color
              const origColors = new Uint8Array(data.length);
              origColors.set(data);

              // 2. Preprocesamiento integral: Escala de grises + Normalización (Histogram Stretching)
              // Esta solución unificada reemplaza los parches anteriores y garantiza una imagen
              // óptima para el motor LSTM de Tesseract (texto negro sobre fondo blanco).
              const totalPixels = canvas.width * canvas.height;
              let minGray = 255, maxGray = 0;
              const grays = new Uint8Array(totalPixels);
              let pi = 0;
              
              for (let i = 0; i < data.length; i += 4) {
                // Luminancia estándar
                let g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
                grays[pi++] = g;
                if (g < minGray) minGray = g;
                if (g > maxGray) maxGray = g;
              }
              
              const range = maxGray - minGray || 1;
              let brightnessSum = 0;
              pi = 0;
              
              for (let i = 0; i < data.length; i += 4) {
                let stretched = Math.round((grays[pi++] - minGray) / range * 255);
                brightnessSum += stretched;
                data[i] = data[i+1] = data[i+2] = stretched;
              }
              
              // 3. Inversión inteligente: Tesseract requiere texto oscuro sobre fondo claro.
              // Si el brillo promedio es bajo (fondo oscuro), invertimos los colores.
              const avgBrightness = brightnessSum / totalPixels;
              if (avgBrightness < 127) {
                for (let i = 0; i < data.length; i += 4) {
                  data[i] = data[i+1] = data[i+2] = 255 - data[i];
                }
              }

              ctx.putImageData(imgData, 0, 0);
              resolve({ dataUrl: canvas.toDataURL('image/png'), scale: scale, origColors: origColors, imgWidth: canvas.width, imgHeight: canvas.height });
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
        const rawLines = data.lines || [];

        // ══════════════════════════════════════════════════════════════════════
        // Post-procesamiento avanzado: formateo armónico del texto
        // ══════════════════════════════════════════════════════════════════════

        // ── Paso 1: Fusionar líneas en la misma posición Y ──────────────────
        // Tesseract a veces parte una línea visual en dos si hay emojis/iconos
        const mergedLines = [];
        for (const line of rawLines) {
          if (!line.bbox) { mergedLines.push(line); continue; }
          const midY = (line.bbox.y0 + line.bbox.y1) / 2;
          const lastMerged = mergedLines[mergedLines.length - 1];
          if (lastMerged && lastMerged.bbox) {
            const lastMidY = (lastMerged.bbox.y0 + lastMerged.bbox.y1) / 2;
            const lastH = lastMerged.bbox.y1 - lastMerged.bbox.y0;
            // Si el centro Y está dentro del 40% de la altura de la línea anterior → misma línea
            if (Math.abs(midY - lastMidY) < lastH * 0.4) {
              lastMerged.text = (lastMerged.text || '') + ' ' + (line.text || '');
              lastMerged.words = (lastMerged.words || []).concat(line.words || []);
              lastMerged.bbox.x1 = Math.max(lastMerged.bbox.x1, line.bbox.x1);
              lastMerged.bbox.y0 = Math.min(lastMerged.bbox.y0, line.bbox.y0);
              lastMerged.bbox.y1 = Math.max(lastMerged.bbox.y1, line.bbox.y1);
              continue;
            }
          }
          // Clonar para no mutar data original
          mergedLines.push({
            text: line.text,
            words: [...(line.words || [])],
            bbox: { ...line.bbox },
            confidence: line.confidence
          });
        }

        // ── Paso 2: Diccionario de emojis mal leídos por Tesseract ─────────
        // Solo se aplica cuando la confianza de la palabra es baja (< 50%)
        const EMOJI_MISREADS = {
          // ── Thumbs / reacciones ──
          'Q':  '👎', 'qb': '👎', 'Qb': '👎', 'Y': '👎', 'y': '👎',
          'qd': '👎', 'Qd': '👎', 'Ql': '👎',
          'db': '👍', 'dh': '👍', 'dD': '👍', '(de': '👍', 'de': '👍',
          'cb': '👍', 'Cb': '👍', 'Gb': '👍', 'gb': '👍',
          'dP': '👍', 'dp': '👍', 'th': '👍',

          // ── Caras felices / risa ──
          'E8': '😎', 'e8': '😎', 'eB': '😎', 'E 8': '😎', 'EB': '😎',
          'eD': '😂', '8D': '😂', 'BD': '😂', 'bD': '😂',
          'O': '🤣', 'O)': '🤣', 'O}': '🤣', 'oO': '🤣', 'OO': '🤣', 'Oo': '🤣',
          'eP': '😋', 'ep': '😋',
          ':D': '😁', ':)': '🙂', 'B)': '😎',
          'xD': '😆', 'XD': '😆', 'xd': '😆',
          ';)': '😉', ';D': '😉',
          'eO': '😊', 'e0': '😊', 'eC': '😊',
          'e@': '😍', 'eé': '😍',

          // ── Caras tristes / negativas ──
          ':(': '😞', ':c': '😢', ':C': '😢',
          'e>': '😭', 'T_T': '😭', 'TT': '😭',
          'D:': '😱', ':O': '😮', ':o': '😮',
          ':P': '😛', ':p': '😛', 'xP': '😜',
          '>:(': '😡', 'eé': '😤',

          // ── Corazones ──
          '<3': '❤️', 'c3': '❤️', 'C3': '❤️', 'e3': '❤️',
          'S2': '❤️', 's2': '❤️',

          // ── Fuego / efectos ──
          'JJ': '🎵', 'JT': '🎵', 'Jf': '🎶', 'Jj': '🎵',
          '@': '🔥',  // solo con baja confianza

          // ── Flechas / direcciones ──
          'Vv': '⬇️', 'VV': '⬇️', 'vv': '⬇️',
          'AV': '⬆️', 'Av': '⬆️', 'AA': '⬆️',
          '>>': '▶️', '<<': '◀️',

          // ── Checks / cruces ──
          'V': '✔️', 'X': '❌',

          // ── Manos / gestos ──
          'ok': '👌', 'OK': '👌',
          'v/': '✌️',

          // ── Estrellas / items ──
          '*': '⭐', '**': '🌟',
          '#': '🔢',

          // ── Misc social media ──
          'RT': '🔁',  // retweet
          'DM': '✉️',  // mensaje directo
        };

        // Variantes normalizadas (sin espacios) para matcheo rápido
        const EMOJI_KEYS_NOSPACE = {};
        for (const k of Object.keys(EMOJI_MISREADS)) {
          EMOJI_KEYS_NOSPACE[k.replace(/\s/g, '')] = EMOJI_MISREADS[k];
        }

        // ── Paso 3: Reconstruir texto con validación por diccionario ─────────
        // Sistema integral: cada palabra se valida contra el diccionario español.
        // Si conf > 80%: aceptar (Tesseract seguro)
        // Si conf 50-80%: validar contra diccionario, intentar corregir si no está
        // Si conf < 50%: solo aceptar si está en diccionario o es emoji
        for (const line of mergedLines) {
          if (!line.words || !line.words.length) continue;

          const cleanWords = [];
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            const conf = word.confidence || 0;
            let text = (word.text || '').trim();
            if (!text) continue;

            // Eliminar tokens de ruido visual
            if (/^[|_~=\-\\\/\[\]{}<>]+$/.test(text)) continue;

            // Eliminar puntuación suelta con baja confianza
            if (conf < 60 && /^[.,;:!?'"'`´""''«»]+$/.test(text)) continue;

            // Limpiar comillas/apóstrofes pegados
            text = text.replace(/^[''`´"""\u201c\u201d]+/, '');
            text = text.replace(/[''`´"""\u201c\u201d]+$/, '');
            if (!text) continue;

            // ── Emoji mapping (solo baja confianza) ──
            if (conf < 50) {
              const noSpace = text.replace(/\s/g, '');
              if (EMOJI_MISREADS[text]) { cleanWords.push(EMOJI_MISREADS[text]); continue; }
              if (EMOJI_KEYS_NOSPACE[noSpace]) { cleanWords.push(EMOJI_KEYS_NOSPACE[noSpace]); continue; }
              if (w + 1 < line.words.length) {
                const nw = line.words[w + 1];
                if ((nw.confidence || 0) < 50) {
                  const combined = text + (nw.text || '').trim();
                  if (EMOJI_MISREADS[combined] || EMOJI_KEYS_NOSPACE[combined]) {
                    cleanWords.push(EMOJI_MISREADS[combined] || EMOJI_KEYS_NOSPACE[combined]);
                    w++; continue;
                  }
                }
              }
            }
            // ── Intentar fusionar palabras cortadas por Tesseract ──
            // Ej: "fue te" (fuerte), "vi al" (viral), "cien os" (cientos)
            if (w + 1 < line.words.length) {
              const nw = line.words[w + 1];
              // Verificar físicamente si el espacio entre cajas es muy pequeño
              // Un espacio real suele ser > 25% del alto de la letra.
              // Si el gap es muy pequeño, Tesseract partió la palabra o se comió una letra fina.
              const height = word.bbox.y1 - word.bbox.y0;
              const gap = nw.bbox.x0 - word.bbox.x1;
              const gapRatio = gap / height;

              if (gapRatio < 0.25) { // Solo fusionar si están físicamente muy cerca
                const nextText = (nw.text || '').trim().replace(/^[''`´"""\u201c\u201d]+/, '').replace(/[''`´"""\u201c\u201d]+$/, '');
                if (nextText) {
                  const combined = text + nextText;
                  let mergedValid = null;
                  if (isSpanishWord(combined)) {
                    mergedValid = combined;
                  } else {
                    const corrected = autoCorrectOCRWord(combined);
                    if (corrected) mergedValid = corrected;
                  }
                  
                  if (mergedValid) {
                    cleanWords.push(mergedValid);
                    w++; // saltar nextText
                    continue;
                  }
                }
              }
            }

            // ── Validación por diccionario y Confianza ──
            const isValid = isSpanishWord(text);

            if (conf >= 80) {
              // Confianza alta: Confiamos 100% en Tesseract.
              // Nuestro diccionario es pequeño, así que no debemos destruir palabras
              // perfectamente leídas (ej: "Desapareció", "encontraron") solo porque no estén en él.
              cleanWords.push(text);
            } else if (conf >= 50) {
              // Confianza media
              if (isValid) {
                cleanWords.push(text);
              } else if (text.length >= 4 && /[aeiouáéíóú]/i.test(text) && !/[0-9]/.test(text)) {
                // Si parece una palabra normal (tiene vocales, longitud razonable, sin números),
                // asumimos que es una palabra válida que no está en nuestro diccionario.
                cleanWords.push(text);
              } else {
                // Si parece basura (no tiene vocales, es corta, o tiene números raros), intentamos rescatarla
                const split = trySplitMergedWord(text);
                if (split) { cleanWords.push(split); continue; }
                const corrected = autoCorrectOCRWord(text);
                if (corrected) { cleanWords.push(corrected); continue; }
                
                // Si todo falla, pero al menos tiene vocales, la mantenemos por las dudas
                if (/[aeiouáéíóú]/i.test(text)) cleanWords.push(text);
              }
            } else {
              // Baja confianza (<50%): Tesseract está adivinando
              if (isValid) {
                cleanWords.push(text);
              } else {
                // Aquí el diccionario y corrector son obligatorios para rescatar la palabra
                const corrected = autoCorrectOCRWord(text);
                if (corrected) { cleanWords.push(corrected); continue; }
                const split = trySplitMergedWord(text);
                if (split) { cleanWords.push(split); continue; }
                
                // Solo mantener si es larga y tiene vocales (último recurso)
                if (text.length >= 5 && /[aeiouáéíóú]/i.test(text)) cleanWords.push(text);
              }
            }
          }
          line.text = cleanWords.join(' ');
        }

        // ── Paso 3b: Limpieza contextual de líneas de reacciones (YouTube) ──
        for (const line of mergedLines) {
          const text = (line.text || '').trim();
          if (!/Responder/i.test(text)) continue;
          let cleaned = text.replace(/[—–\-|]/g, ' ').replace(/  +/g, ' ').trim();
          const numMatch = cleaned.match(/(\d+)/);
          const count = numMatch ? numMatch[1] : '';
          const parts = cleaned.split(/\s+/);
          const responderIdx = parts.findIndex(p => /^Responder$/i.test(p));
          if (responderIdx >= 0 && parts.length <= 6) {
            const junk = parts.filter(p => !/^\d+$/.test(p) && !/^Responder$/i.test(p) && p.length <= 4);
            if (junk.length >= 1) {
              line.text = count ? '👍 ' + count + ' 👎 Responder' : '👍 👎 Responder';
            }
          }
        }

        // ── Paso 3c: Filtrar líneas basura por confianza promedio ────────────
        // Líneas como "eimierviónn" o ". EE" tienen confianza baja en todas sus palabras
        for (const line of mergedLines) {
          if (!line.words || !line.words.length) continue;
          const wordsWithConf = line.words.filter(w => (w.text || '').trim().length > 0);
          if (wordsWithConf.length === 0) { line.text = ''; continue; }
          const avgConf = wordsWithConf.reduce((sum, w) => sum + (w.confidence || 0), 0) / wordsWithConf.length;
          const lineText = (line.text || '').trim();
          // Línea con confianza promedio < 40% y texto corto (< 10 chars) → basura
          if (avgConf < 40 && lineText.length < 10) {
            line.text = '';
            continue;
          }
          // Línea con confianza promedio < 25% independientemente del largo → basura
          if (avgConf < 25) {
            line.text = '';
            continue;
          }
          // Línea que es una sola palabra sin sentido (no tiene vocales y < 50% conf)
          if (wordsWithConf.length === 1 && avgConf < 50 && !/[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(lineText)) {
            line.text = '';
          }
        }

        // ── Paso 4: Calcular altura promedio para detección de párrafos ──────
        let totalLineHeight = 0, validLineCount = 0;
        for (const line of mergedLines) {
          if (line.bbox) {
            totalLineHeight += (line.bbox.y1 - line.bbox.y0);
            validLineCount++;
          }
        }
        const avgLineHeight = validLineCount > 0 ? totalLineHeight / validLineCount : 40;
        const PARAGRAPH_GAP = avgLineHeight * 0.8;

        // ── Paso 5: Ensamblar con párrafos, limpieza final por línea ─────────
        const formattedLines = [];
        for (let i = 0; i < mergedLines.length; i++) {
          const line = mergedLines[i];
          let text = (line.text || '').trimEnd();
          if (!text) continue;

          // 5a. Limpiar artefactos al inicio de línea
          text = text.replace(/^[\x22\u201c\u201d\u201e\u201f\u2018\u2019\u00ab\u00bb"""''`´]+\s*/, '');
          text = text.replace(/^[a-zA-Z]{1,3}\s*[.,;:]\s+/g, '');
          text = text.replace(/^[a-z]{1,2}\s+(?=[A-Z])/, '');
          text = text.replace(/^[A-Z]\.\s+/, '');

          // 5b. Limpiar artefactos al final de línea
          text = text.replace(/\s+[Vv]{1,2}$/, '');
          text = text.replace(/\s+[|\\\/]$/, '');
          text = text.replace(/\s+[A-Z]\.$/, '');
          // Quitar dos puntos/coma sueltos al final que no sean parte del texto
          text = text.replace(/[:;]$/, '');

          // 5c. UNIVERSAL: En español los apóstrofes NUNCA unen palabras
          // Reemplazar TODOS los apóstrofes entre letras por espacio
          // "lo'que" → "lo que", "volveria'a'dejar" → "volveria a dejar", "me'he" → "me he"
          text = text.replace(/(\w)[''`´'](\w)/g, '$1 $2');

          // 5d. Normalizar espacios
          text = text.replace(/  +/g, ' ').trim();

          // 5e. Correcciones OCR español
          text = text.replace(/\bl\b(?=\s+\d)/g, '↳');

          // 5f. Ignorar líneas vacías o basura
          if (text.length <= 1 && !/[\d@#]/.test(text)) continue;
          if (text.length <= 3 && !/[\d@#]/.test(text) && !/^[A-ZÁÉÍÓÚ]/.test(text)) continue;

          // 5g. Detectar gap vertical grande → párrafo
          if (i > 0 && mergedLines[i - 1].bbox && line.bbox) {
            const gap = line.bbox.y0 - mergedLines[i - 1].bbox.y1;
            if (gap > PARAGRAPH_GAP) {
              formattedLines.push('');
            }
          }

          formattedLines.push(text);
        }

        // ── Paso 5: Limpieza final global ────────────────────────────────────
        let formattedText = formattedLines.join('\n').trim();
        // Colapsar 3+ saltos de línea consecutivos a máximo 2 (un párrafo)
        formattedText = formattedText.replace(/\n{3,}/g, '\n\n');

        // Correcciones comunes de OCR español: preposiciones fusionadas
        const spanishFixes = [
          [/\bair\b/g, 'a ir'],
          [/\bala\b(?=\s)/g, 'a la'],
          [/\bael\b/g, 'a el'],
          [/\bdela\b/g, 'de la'],
          [/\bdel a\b/g, 'de la'],
          [/\benla\b/g, 'en la'],
          [/\benel\b/g, 'en el'],
          [/\bconla\b/g, 'con la'],
          [/\bconel\b/g, 'con el'],
          [/\bporla\b/g, 'por la'],
          [/\bporel\b/g, 'por el'],
          [/\bSimi\b/g, 'Si mi'],
          [/\bmeha\b/gi, 'me ha'],
          [/\bmehe\b/gi, 'me he'],
          [/\bseha\b/gi, 'se ha'],
          [/\bnohe\b/gi, 'no he'],
          [/\bporque\s*que\b/g, 'porque'],
          [/\bque que\b/g, 'que'],
          [/\bhey\b(?=[,. ])/g, 'he'],
          [/\bvolveria\b/g, 'volvería'],
          [/\bseria\b/g, 'sería'],
          [/\bpodria\b/g, 'podría'],
          [/\btendria\b/g, 'tendría'],
          [/\bharia\b/g, 'haría'],
          [/\bqueria\b/g, 'quería'],
          [/\bdeberia\b/g, 'debería'],
        ];
        for (const [pattern, replacement] of spanishFixes) {
          formattedText = formattedText.replace(pattern, replacement);
        }
        // Limpiar espacios dobles residuales
        formattedText = formattedText.replace(/  +/g, ' ');

        // ── Paso 6: Fallback — detección de emojis por color ─────────────────
        // Si Tesseract devolvió texto vacío o muy corto, escanear la imagen
        // original buscando clusters de píxeles amarillos (emojis tipo cara).
        if (formattedText.replace(/\s/g, '').length <= 2) {
          try {
            const oc = preprocessed.origColors;
            const cw = preprocessed.imgWidth;
            const ch = preprocessed.imgHeight;
            if (oc && cw && ch) {
              // Buscar píxeles "amarillo/naranja" (cara de emoji)
              // HSL: Hue 20-65°, Saturation > 35%, Lightness 35-90%
              let emojiPixelCount = 0;
              let minX = cw, maxX = 0, minY = ch, maxY = 0;
              for (let y = 0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                  const i = (y * cw + x) * 4;
                  const r = oc[i], g = oc[i+1], b = oc[i+2];
                  const max = Math.max(r, g, b), min = Math.min(r, g, b);
                  const l = (max + min) / 2 / 255;
                  const d = max - min;
                  if (d === 0 || l < 0.35 || l > 0.90) continue;
                  const s = d / (1 - Math.abs(2 * l - 1)) / 255;
                  if (s < 0.35) continue;
                  let hue = 0;
                  if (max === r) hue = 60 * (((g - b) / d) % 6);
                  else if (max === g) hue = 60 * ((b - r) / d + 2);
                  else hue = 60 * ((r - g) / d + 4);
                  if (hue < 0) hue += 360;
                  // Amarillo/naranja/dorado: 20° - 65°
                  if (hue >= 20 && hue <= 65) {
                    emojiPixelCount++;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                  }
                }
              }

              // Si hay suficientes píxeles amarillos (>2% de la imagen)
              if (emojiPixelCount > (cw * ch) * 0.02) {
                const emojiSize = Math.max((maxY - minY) || 1, 10);
                const totalWidth = maxX - minX;
                const emojiCount = Math.max(1, Math.round(totalWidth / emojiSize));
                formattedText = '😂'.repeat(Math.min(emojiCount, 20));
              }
            }
          } catch(e) {
            console.warn('Offscreen: Emoji color detection failed:', e);
          }
        }

        // ══════════════════════════════════════════════════════════════════════

        const lines = rawLines.map(line => {
          let maxHeight = line.bbox ? ((line.bbox.y1 - line.bbox.y0) / scale) : 0;
          let minTop = line.bbox ? (line.bbox.y0 / scale) : 0;

          const words = (line.words || []).map(word => ({
            WordText: word.text,
            Left:   word.bbox ? (word.bbox.x0 / scale) : 0,
            Top:    word.bbox ? (word.bbox.y0 / scale) : 0,
            Width:  word.bbox ? ((word.bbox.x1 - word.bbox.x0) / scale) : 0,
            Height: word.bbox ? ((word.bbox.y1 - word.bbox.y0) / scale) : 0
          }));

          return { MaxHeight: maxHeight, MinTop: minTop, Words: words };
        });

        const textOverlay = {
          HasOverlay: lines.length > 0,
          Message: "Total lines: " + lines.length,
          Lines: lines
        };

        sendResponse({
          result: {
            ParsedResults: [{ ParsedText: formattedText, TextOverlay: textOverlay }],
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
