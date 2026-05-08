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

              // Guardar copia de colores originales para detección de emojis por color
              const origColors = new Uint8Array(data.length);
              origColors.set(data);

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

        // ── Paso 3: Reconstruir texto usando confianza + emoji mapping ───────
        for (const line of mergedLines) {
          if (!line.words || !line.words.length) continue;

          const cleanWords = [];
          for (let w = 0; w < line.words.length; w++) {
            const word = line.words[w];
            const conf = word.confidence || 0;
            let text = (word.text || '').trim();
            if (!text) continue;

            // Eliminar tokens que son puro ruido visual (|, _, ~, etc.)
            if (/^[|_~=\-\\\/\[\]{}<>]+$/.test(text)) continue;

            // Eliminar puntuación suelta con baja confianza (., ,, ;, :, etc.)
            if (conf < 60 && /^[.,;:!?'"'`´""''«»]+$/.test(text)) continue;

            // Intentar mapear a emoji si confianza es baja
            if (conf < 50) {
              const noSpace = text.replace(/\s/g, '');

              // Match directo
              if (EMOJI_MISREADS[text]) {
                cleanWords.push(EMOJI_MISREADS[text]);
                continue;
              }
              // Match sin espacios (para "E 8" → "E8" → 😎)
              if (EMOJI_KEYS_NOSPACE[noSpace]) {
                cleanWords.push(EMOJI_KEYS_NOSPACE[noSpace]);
                continue;
              }

              // Multi-word emoji: combinar con la palabra siguiente
              if (w + 1 < line.words.length) {
                const nextWord = line.words[w + 1];
                const nextConf = nextWord.confidence || 0;
                const nextText = (nextWord.text || '').trim();
                if (nextConf < 50) {
                  const combined = text + nextText;
                  if (EMOJI_MISREADS[combined] || EMOJI_KEYS_NOSPACE[combined]) {
                    cleanWords.push(EMOJI_MISREADS[combined] || EMOJI_KEYS_NOSPACE[combined]);
                    w++;
                    continue;
                  }
                }
              }

              // Si es 1-2 chars con confianza < 40, muy probable ruido → eliminar
              if (text.length <= 2 && conf < 40) continue;

              // Si es 1-3 chars sin vocales con confianza < 45, es basura
              if (text.length <= 3 && conf < 45 && !/[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(text)) continue;
            }

            // Limpiar apóstrofes/comillas falsas pegadas al inicio o final de palabra
            // Tesseract a menudo lee "a ir sola a" como "air sola'al"
            text = text.replace(/^['`´'"]+/, '');
            text = text.replace(/['`´'"]+$/, '');
            if (!text) continue;

            cleanWords.push(text);
          }
          line.text = cleanWords.join(' ');
        }

        // ── Paso 3b: Limpieza contextual de líneas de reacciones (YouTube) ──
        // Detecta variantes de la línea "👍 N 👎 Responder" que YouTube muestra.
        // Maneja: con/sin número, separadores (—, -, |), emojis ya reemplazados.
        for (const line of mergedLines) {
          const text = (line.text || '').trim();
          if (!/Responder/i.test(text)) continue;

          // Limpiar separadores que Tesseract lee del UI (—, -, |, etc.)
          let cleaned = text.replace(/[—–\-|]/g, ' ').replace(/  +/g, ' ').trim();

          // Extraer solo el número si hay uno
          const numMatch = cleaned.match(/(\d+)/);
          const count = numMatch ? numMatch[1] : '';

          // Si la línea tiene "Responder" y es corta (típica de YouTube reactions)
          // y tiene mayoritariamente tokens cortos/emojis → formatear
          const parts = cleaned.split(/\s+/);
          const responderIdx = parts.findIndex(p => /^Responder$/i.test(p));
          if (responderIdx >= 0 && parts.length <= 6) {
            // Contar cuántos tokens no-numéricos y no-"Responder" hay
            const junk = parts.filter(p => !/^\d+$/.test(p) && !/^Responder$/i.test(p) && p.length <= 4);
            if (junk.length >= 1) {
              line.text = count ? '👍 ' + count + ' 👎 Responder' : '👍 👎 Responder';
            }
          }
        }

        // ── Paso 3: Calcular altura promedio para detección de párrafos ──────
        let totalLineHeight = 0, validLineCount = 0;
        for (const line of mergedLines) {
          if (line.bbox) {
            totalLineHeight += (line.bbox.y1 - line.bbox.y0);
            validLineCount++;
          }
        }
        const avgLineHeight = validLineCount > 0 ? totalLineHeight / validLineCount : 40;
        const PARAGRAPH_GAP = avgLineHeight * 0.8;

        // ── Paso 4: Ensamblar con párrafos, limpieza final por línea ─────────
        const formattedLines = [];
        for (let i = 0; i < mergedLines.length; i++) {
          const line = mergedLines[i];
          let text = (line.text || '').trimEnd();

          // 4a. Limpiar artefactos al inicio de línea (chars sueltos por ruido)
          text = text.replace(/^["""''`´]\s+/, '');
          // Fragmento corto (1-3 chars) + punto/coma + espacio al inicio → ruido OCR
          // Ejemplo: "ow A." → se elimina, "El texto" → se mantiene
          text = text.replace(/^[a-zA-Z]{1,3}\s*[.,;:]\s+/g, '');
          // Char suelto al inicio solo si NO forma parte de una palabra
          text = text.replace(/^([a-z])\s+(?=[A-Z@#\d])/, '');
          // Letra mayúscula sola + punto al inicio (como "A.") seguida de texto
          text = text.replace(/^[A-Z]\.\s+/, '');

          // 4b. Limpiar artefactos al final de línea
          text = text.replace(/\s+[Vv]{1,2}$/, '');    // "Vv" al final → flecha ↓ mal leída
          text = text.replace(/\s+[|\\\/]$/, '');       // Barras sueltas al final
          text = text.replace(/\s+[A-Z]\.$/, '');       // Letra + punto suelto al final

          // 4c. Normalizar espacios
          text = text.replace(/  +/g, ' ').trim();

          // 4d. Correcciones comunes de OCR en español
          text = text.replace(/\bl\b(?=\s+\d)/g, '↳');  // l sola antes de número → bullet
          // Apóstrofes que fusionan preposiciones: "sola'al" → "sola al", "ir'a" → "ir a"
          text = text.replace(/(\w)'(\w)/g, (match, before, after) => {
            // Si el apóstrofe une letras en español (no contracciones legítimas como inglés)
            // y una de las partes es una preposición corta, separar
            const afterWord = after + text.slice(text.indexOf(match) + match.length).split(/\s/)[0];
            if (/^(a|al|el|la|en|de|del|un|una|y|o|e)$/i.test(afterWord) || 
                /^(a|al|el|la|en|de|del|un|una|y|o|e)$/i.test(after)) {
              return before + ' ' + after;
            }
            return match;
          });

          // 4e. Ignorar líneas vacías o con un solo char sin sentido
          if (text.length <= 1 && !/[\d@#]/.test(text)) continue;
          // Ignorar líneas muy cortas (≤3 chars) que son solo letras sueltas sin sentido
          if (text.length <= 3 && !/[\d@#]/.test(text) && !/^[A-ZÁÉÍÓÚ]/.test(text)) continue;

          // 4f. Detectar gap vertical grande → insertar línea en blanco (párrafo)
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
        // "No vuelvo air" → "No vuelvo a ir"
        // "vuelvo ala fiesta" → "vuelvo a la fiesta"
        const spanishFixes = [
          [/\bair\b/g, 'a ir'],
          [/\bala\b(?=\s)/g, 'a la'],
          [/\bael\b/g, 'a el'],
          [/\bdel a\b/g, 'de la'],
          [/\benla\b/g, 'en la'],
          [/\benel\b/g, 'en el'],
          [/\bporque\s*que\b/g, 'porque'],
          [/\bque que\b/g, 'que'],
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
