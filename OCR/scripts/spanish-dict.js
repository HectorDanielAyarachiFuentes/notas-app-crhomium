// Diccionario de las 600+ palabras más comunes del español para validación OCR
// Se usa para: (1) validar palabras, (2) detectar palabras fusionadas, (3) filtrar basura
const SPANISH_COMMON = new Set([
  // Artículos y determinantes
  'el','la','los','las','un','una','unos','unas','lo','al','del',
  // Pronombres
  'yo','tu','tú','el','él','ella','nosotros','ellos','ellas','usted','ustedes',
  'me','te','se','nos','os','le','les','mi','mí','ti','si','sí',
  'esto','esta','este','estos','estas','eso','esa','ese','esos','esas',
  'aquel','aquella','aquellos','aquellas','quien','quién','que','qué',
  'cual','cuál','cuales','cuáles','donde','dónde','como','cómo','cuando','cuándo',
  // Preposiciones y conjunciones
  'a','ante','bajo','con','contra','de','desde','en','entre','hacia',
  'hasta','para','por','según','sin','sobre','tras','y','e','o','u',
  'ni','pero','sino','mas','más','menos','aunque','porque','pues','que',
  // Verbos ser/estar/haber/ir/tener/hacer/poder/decir/dar/saber/querer/venir
  'soy','eres','es','somos','son','era','eras','fue','fuimos','fueron',
  'ser','sido','siendo','será','serán','sería','serían',
  'estoy','estás','está','estamos','están','estaba','estuve','estuvo',
  'estar','estado','estando','estaré','estarán','estaría','estarían',
  'he','has','ha','hemos','han','había','habían','hubo',
  'haber','habido','habiendo','habrá','habrán','habría','habrían',
  'voy','vas','va','vamos','van','iba','ibas','fui','fuiste',
  'ir','ido','yendo','iré','irán','iría','irían',
  'tengo','tienes','tiene','tenemos','tienen','tenía','tenían','tuvo','tuve',
  'tener','tenido','teniendo','tendré','tendrán','tendría','tendrían',
  'hago','haces','hace','hacemos','hacen','hacía','hacían','hizo','hice',
  'hacer','hecho','haciendo','haré','harán','haría','harían',
  'puedo','puedes','puede','podemos','pueden','podía','podían','pudo','pude',
  'poder','podido','pudiendo','podré','podrán','podría','podrían',
  'digo','dices','dice','decimos','dicen','decía','decían','dijo','dije',
  'decir','dicho','diciendo','diré','dirán','diría','dirían',
  'doy','das','da','damos','dan','daba','daban','dio','di',
  'dar','dado','dando','daré','darán','daría','darían',
  'sé','sabes','sabe','sabemos','saben','sabía','sabían','supo','supe',
  'saber','sabido','sabiendo','sabré','sabrán','sabría','sabrían',
  'quiero','quieres','quiere','queremos','quieren','quería','querían','quiso','quise',
  'querer','querido','queriendo','querré','querrán','querría','querrían',
  'vengo','vienes','viene','venimos','vienen','venía','venían','vino','vine',
  'venir','venido','viniendo','vendré','vendrán','vendría','vendrían',
  // Otros verbos comunes
  'ver','veo','ves','ve','vemos','ven','veía','vio','vi','visto','viendo',
  'poner','pongo','pone','ponen','ponía','puso','puesto','poniendo',
  'salir','salgo','sale','salen','salía','salió','salido','saliendo',
  'creo','cree','creen','creer','creía','creyó','creído','creyendo',
  'llegar','llego','llega','llegan','llegó','llegado','llegando',
  'pasar','paso','pasa','pasan','pasó','pasado','pasando',
  'quedar','quedo','queda','quedan','quedó','quedado','quedando',
  'deber','debo','debe','deben','debía','debió','debido','debiendo',
  'dejar','dejo','deja','dejan','dejó','dejado','dejando',
  'seguir','sigo','sigue','siguen','siguió','seguido','siguiendo',
  'encontrar','encuentro','encuentra','encuentran','encontró','encontrado',
  'llamar','llamo','llama','llaman','llamó','llamado','llamando',
  'volver','vuelvo','vuelve','vuelven','volvió','vuelto','volviendo','volvería',
  'tomar','tomo','toma','toman','tomó','tomado','tomando',
  'conocer','conozco','conoce','conocen','conoció','conocido','conociendo',
  'vivir','vivo','vive','viven','vivió','vivido','viviendo',
  'sentir','siento','siente','sienten','sintió','sentido','sintiendo',
  'tratar','trato','trata','tratan','trató','tratado','tratando',
  'mirar','miro','mira','miran','miró','mirado','mirando',
  'contar','cuento','cuenta','cuentan','contó','contado','contando',
  'empezar','empiezo','empieza','empiezan','empezó','empezado','empezando',
  'esperar','espero','espera','esperan','esperó','esperado','esperando',
  'buscar','busco','busca','buscan','buscó','buscado','buscando',
  'existir','existe','existen','existió','existido',
  'entrar','entro','entra','entran','entró','entrado','entrando',
  'trabajar','trabajo','trabaja','trabajan','trabajó','trabajado',
  'escribir','escribo','escribe','escriben','escribió','escrito',
  'perder','pierdo','pierde','pierden','perdió','perdido',
  'producir','produce','producen','produjo','producido',
  'ocurrir','ocurre','ocurren','ocurrió','ocurrido',
  'pedir','pido','pide','piden','pidió','pedido',
  'recibir','recibo','recibe','reciben','recibió','recibido',
  'recordar','recuerdo','recuerda','recuerdan','recordó','recordado',
  'terminar','termino','termina','terminan','terminó','terminado',
  'permitir','permite','permiten','permitió','permitido',
  'aparecer','aparece','aparecen','apareció','aparecido',
  'conseguir','consigo','consigue','consiguen','consiguió','conseguido',
  'comenzar','comienzo','comienza','comienzan','comenzó','comenzado',
  'servir','sirvo','sirve','sirven','sirvió','servido',
  'sacar','saco','saca','sacan','sacó','sacado',
  'necesitar','necesito','necesita','necesitan','necesitó','necesitado',
  'mantener','mantengo','mantiene','mantienen','mantuvo','mantenido',
  'leer','leo','lee','leen','leyó','leído',
  'caer','caigo','cae','caen','cayó','caído',
  'cambiar','cambio','cambia','cambian','cambió','cambiado',
  'presentar','presento','presenta','presentan','presentó','presentado',
  'crear','creo','crea','crean','creó','creado',
  'abrir','abro','abre','abren','abrió','abierto',
  'ganar','gano','gana','ganan','ganó','ganado',
  'formar','formo','forma','forman','formó','formado',
  // Adverbios
  'no','sí','ya','también','tampoco','muy','mucho','poco','bastante',
  'bien','mal','mejor','peor','aquí','ahí','allí','acá','allá',
  'hoy','ayer','mañana','ahora','antes','después','luego','siempre',
  'nunca','jamás','todavía','aún','aun','quizás','quizá','tal','vez',
  'solo','sólo','apenas','casi','tan','tanto','así','además','entonces',
  // Sustantivos comunes
  'tiempo','vida','hombre','mujer','mundo','día','año','casa','parte',
  'cosa','lugar','país','momento','ciudad','persona','gente','hijo','hija',
  'padre','madre','mano','nombre','pueblo','ejemplo','familia','agua',
  'noche','ojo','cabeza','problema','manera','tipo','punto','gobierno',
  'trabajo','verdad','razón','tierra','forma','historia','palabra','muerte',
  'caso','grupo','lado','cuenta','juego','cuerpo','fuerza','libro','orden',
  'idea','amor','guerra','poder','dinero','final','derecho','calle','mes',
  'fiesta','amigo','amiga','foto','video','texto','imagen','cara','ex',
  // Adjetivos comunes
  'bueno','buena','buenos','buenas','malo','mala','malos','malas',
  'grande','grandes','pequeño','pequeña','nuevo','nueva','viejo','vieja',
  'largo','larga','corto','corta','alto','alta','bajo','baja',
  'mismo','misma','mismos','mismas','otro','otra','otros','otras',
  'todo','toda','todos','todas','cada','mucho','mucha','muchos','muchas',
  'poco','poca','pocos','pocas','algún','alguno','alguna','algunos','algunas',
  'ningún','ninguno','ninguna','primero','primera','último','última',
  'solo','sola','solos','solas','propio','propia','propios','propias',
  'cierto','cierta','verdadero','verdadera','posible','posibles',
  'mejor','mejores','peor','peores','mayor','mayores','menor','menores',
  // Números
  'cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
  'once','doce','trece','catorce','quince','veinte','treinta','cien','mil',
  // Expresiones comunes en memes/redes
  'jaja','jajaja','lol','like','xd','wtf','omg',
  'nadie','nada','algo','alguien','todo','siempre','nunca',
  're','muy','tan','súper','super','mega','ultra',
  'perro','gato','perrito','gatito','mascota','dormir','contigo',
  'visita','acostumbrado','acostumbrada','fuerte','teoría','teoria',
  'viral','mujer','mujeres','hombre','hombres','engañó','engaño',
  'ciento','cientos','cliente','clientes','pasar','hermano','sister','murió',
]);

// Función para verificar si una palabra está en el diccionario (case-insensitive)
function isSpanishWord(word) {
  if (!word) return false;
  const lower = word.toLowerCase().replace(/[.,;:!?¡¿""''`´\u201c\u201d]+/g, '');
  if (!lower) return false;
  if (SPANISH_COMMON.has(lower)) return true;
  // Números puros
  if (/^\d+$/.test(lower)) return true;
  // Palabras con tilde que podrían estar sin ella
  const sinTilde = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (SPANISH_COMMON.has(sinTilde)) return true;
  
  // Revisar sufijos comunes (diminutivos, adverbios)
  if (lower.endsWith('mente')) {
    const root = lower.slice(0, -5);
    if (SPANISH_COMMON.has(root) || SPANISH_COMMON.has(root + 'o') || SPANISH_COMMON.has(root + 'a')) return true;
  }
  if (lower.endsWith('ito') || lower.endsWith('ita')) {
    const root = lower.slice(0, -3);
    if (SPANISH_COMMON.has(root + 'o') || SPANISH_COMMON.has(root + 'a') || SPANISH_COMMON.has(root + 'e')) return true;
  }
  if (lower.endsWith('itos') || lower.endsWith('itas')) {
    const root = lower.slice(0, -4);
    if (SPANISH_COMMON.has(root + 'o') || SPANISH_COMMON.has(root + 'a') || SPANISH_COMMON.has(root + 'e')) return true;
  }
  if (lower.endsWith('ísimo') || lower.endsWith('ísima')) {
    const root = lower.slice(0, -5);
    if (SPANISH_COMMON.has(root + 'o') || SPANISH_COMMON.has(root + 'a') || SPANISH_COMMON.has(root + 'e')) return true;
  }

  return false;
}

// Intenta dividir una palabra fusionada en 2 palabras válidas del diccionario
// "Simi" → "Si mi", "enlo" → "en lo", "mehe" → "me he"
function trySplitMergedWord(word) {
  if (!word || word.length < 3) return null;
  const lower = word.toLowerCase();
  // Intentar dividir en todas las posiciones posibles (2 palabras)
  for (let i = 1; i < lower.length; i++) {
    const left = lower.substring(0, i);
    const right = lower.substring(i);
    if (isSpanishWord(left) && isSpanishWord(right)) {
      // Preservar mayúscula original del inicio
      const resultLeft = word[0] === word[0].toUpperCase() ? left.charAt(0).toUpperCase() + left.slice(1) : left;
      return resultLeft + ' ' + right;
    }
  }

  // Intentar con un carácter "basura" en el medio (ej: perritolestá -> perrito l está)
  for (let i = 1; i < lower.length - 1; i++) {
    for (let j = i + 1; j < lower.length; j++) {
      if (j - i > 2) continue; // max 2 caracteres de basura en medio
      const left = lower.substring(0, i);
      const right = lower.substring(j);
      if (isSpanishWord(left) && isSpanishWord(right)) {
        const resultLeft = word[0] === word[0].toUpperCase() ? left.charAt(0).toUpperCase() + left.slice(1) : left;
        return resultLeft + ' ' + right;
      }
    }
  }

  return null;
}

// Algoritmo de distancia de Levenshtein para encontrar la palabra más cercana (autocorrección)
function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
  for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}

// Corrige palabras que tienen 1 letra mal leída por Tesseract
function autoCorrectOCRWord(word) {
  if (!word || word.length < 4) return null; // No auto-corregir palabras muy cortas (peligroso)
  const lower = word.toLowerCase().replace(/[.,;:!?¡¿""''`´\u201c\u201d]+/g, '');
  if (!lower || lower.length < 4) return null;
  
  // Buscar la palabra más cercana en el diccionario (tolerancia de 1 error)
  for (const dictWord of SPANISH_COMMON) {
    // Solo comparar palabras de longitud similar para rendimiento
    if (Math.abs(dictWord.length - lower.length) > 1) continue;
    
    const dist = getLevenshteinDistance(lower, dictWord);
    // Si hay exactamente 1 error (letra cambiada, añadida o quitada), corregir
    // Para palabras muy largas (>= 8 chars), toleramos hasta 2 errores
    const maxErrors = lower.length >= 8 ? 2 : 1;
    if (dist > 0 && dist <= maxErrors) {
      // Devolver manteniendo la capitalización original si la tenía
      return word[0] === word[0].toUpperCase() ? dictWord.charAt(0).toUpperCase() + dictWord.slice(1) : dictWord;
    }
  }
  return null;
}
