import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Linking, ScrollView, Platform, Share, Image as RNImage, Switch
} from 'react-native';

// ---- Native fallback: phone app me localStorage nahi hota, isliye temporary memory storage ----
if (typeof localStorage === 'undefined') {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

// ---- AI backend ----
const AI_URL = 'https://nexdare-ai.vercel.app/api/ask';

// ---- Firebase Auth (email + password) ----
const FIREBASE_API_KEY = 'AIzaSyCOon-MP5tYqOgBDOjkodb_4vKHMVyBEPk';

// ---- Login token (Firebase Auth) - database ko pata chalta hai ki kaun login hai ----
let authState = { idToken: null, refreshToken: null, exp: 0 };
try {
  const savedAuth = JSON.parse(localStorage.getItem('nexdare_auth'));
  if (savedAuth && savedAuth.refreshToken) authState = savedAuth;
} catch (e) {}
const saveAuthState = () => {
  try { localStorage.setItem('nexdare_auth', JSON.stringify(authState)); } catch (e) {}
};
const setAuthTokens = (tk) => {
  authState = {
    idToken: tk.idToken,
    refreshToken: tk.refreshToken,
    exp: tk.expiresIn ? Date.now() + Number(tk.expiresIn) * 1000 : 0,
  };
  saveAuthState();
};
const clearAuthTokens = () => {
  authState = { idToken: null, refreshToken: null, exp: 0 };
  try { localStorage.removeItem('nexdare_auth'); } catch (e) {}
};
let refreshing = null;
const refreshIdToken = () => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(authState.refreshToken),
    });
    const d = await res.json();
    if (!res.ok) throw new Error('Token refresh fail');
    authState = {
      idToken: d.id_token,
      refreshToken: d.refresh_token || authState.refreshToken,
      exp: Date.now() + Number(d.expires_in) * 1000,
    };
    saveAuthState();
    return authState.idToken;
  })();
  refreshing.then(() => { refreshing = null; }, () => { refreshing = null; });
  return refreshing;
};
const getToken = async () => {
  if (!authState.refreshToken && !authState.idToken) return null;
  if (!authState.idToken || Date.now() > authState.exp - 60000) {
    try { await refreshIdToken(); } catch (e) {}
  }
  return authState.idToken;
};

// ---- Firebase Realtime Database (REST) ----
const DB_URL = 'https://truthdare-battle-d81c8-default-rtdb.asia-southeast1.firebasedatabase.app';
const db = null;
const ref = (_db, path, query) => ({ path, query });
const listeners = new Set();
const pollAll = () => listeners.forEach((f) => f());

const call = async (method, path, body, query) => {
  const tok = await getToken();
  const parts = [];
  if (tok) parts.push('auth=' + tok);
  if (query) parts.push(query);
  const res = await fetch(DB_URL + '/' + path + '.json' + (parts.length ? '?' + parts.join('&') : ''), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Database error ' + res.status);
  return res.json();
};
const set = async (r, data) => { await call('PUT', r.path, data); pollAll(); };
const update = async (r, data) => { await call('PATCH', r.path, data); pollAll(); };
const push = async (r, data) => { await call('POST', r.path, data); pollAll(); };
const remove = async (r) => { await call('DELETE', r.path); pollAll(); };
const get = async (r) => {
  const val = await call('GET', r.path, undefined, r.query);
  return { exists: () => val !== null, val: () => val };
};
const onValue = (r, cb) => {
  let stopped = false;
  const poll = async () => {
    try {
      const val = await call('GET', r.path, undefined, r.query);
      if (!stopped) cb({ val: () => val });
    } catch (e) {}
  };
  listeners.add(poll);
  poll();
  const timer = setInterval(poll, 1000);
  return () => { stopped = true; clearInterval(timer); listeners.delete(poll); };
};

// ---- Helpers ----
const randomId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cleanHtml = (t) =>
  t.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
const MAX_DM_FILE = 2 * 1024 * 1024;
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const readAsDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('File padh nahi paye'));
  r.readAsDataURL(file);
});
const compressImage = (dataUrl) => new Promise((res, rej) => {
  const img = new window.Image();
  img.onload = () => {
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    res(c.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => rej(new Error('Photo khul nahi payi'));
  img.src = dataUrl;
});
const cleanAI = (t) => String(t).replace(/\*\*/g, '').replace(/^\* /gm, '• ');

// ---- Firebase Web SDK loader (only used for "Continue with Google") ----
const FIREBASE_WEB_CONFIG = {
  apiKey: FIREBASE_API_KEY,
  authDomain: 'truthdare-battle-d81c8.firebaseapp.com',
  projectId: 'truthdare-battle-d81c8',
  appId: '1:772641204553:web:b1d52e1c3a19edabed5298',
};
const loadScriptOnce = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = src;
  el.onload = () => resolve();
  el.onerror = () => reject(new Error('Google login ka script load nahi hua, internet check karo'));
  document.head.appendChild(el);
});
let fbPromise = null;
const loadFirebase = () => {
  if (fbPromise) return fbPromise;
  fbPromise = (async () => {
    await loadScriptOnce('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
    await loadScriptOnce('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
    const fb = window.firebase;
    if (!fb.apps.length) fb.initializeApp(FIREBASE_WEB_CONFIG);
    return fb;
  })();
  fbPromise.catch(() => { fbPromise = null; });
  return fbPromise;
};

// ---- End-to-end encryption (WebCrypto) ----
const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc8 = (t) => new TextEncoder().encode(t);
const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
};
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const cleanPub = (k) => ({ kty: k.kty, crv: k.crv, x: k.x, y: k.y });
const canon = (k) => JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y });

let sessionIdentity = null;
const loadIdentity = async () => {
  if (sessionIdentity) return sessionIdentity;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('nexdare_id_v1')); } catch (e) {}
  if (stored && stored.sid && stored.pub && stored.priv) {
    try {
      const priv = await subtle.importKey('jwk', stored.priv, ECDH, false, ['deriveBits']);
      sessionIdentity = { sid: stored.sid, pub: stored.pub, priv };
      return sessionIdentity;
    } catch (e) {}
  }
  const kp = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const pub = cleanPub(await subtle.exportKey('jwk', kp.publicKey));
  const privJwk = await subtle.exportKey('jwk', kp.privateKey);
  const sid = randomId();
  try { localStorage.setItem('nexdare_id_v1', JSON.stringify({ sid, pub, priv: privJwk })); } catch (e) {}
  sessionIdentity = { sid, pub, priv: kp.privateKey };
  return sessionIdentity;
};

const deriveShared = async (priv, otherPub) => {
  const pub = await subtle.importKey('jwk', cleanPub(otherPub), ECDH, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const aes = await subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const tag = enc8('nexdare-call:');
  const buf = new Uint8Array(tag.length + 32);
  buf.set(tag, 0);
  buf.set(new Uint8Array(bits), tag.length);
  const callHash = hex(await subtle.digest('SHA-256', buf)).slice(0, 24);
  return { aes, callHash };
};

const safetyCode = async (a, b) => {
  const parts = [canon(a), canon(b)].sort();
  const d = await subtle.digest('SHA-256', enc8(parts.join('|')));
  return hex(d).slice(0, 20).match(/.{1,5}/g).join(' ');
};

const encryptText = async (aes, text) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc8(text));
  return { iv: b64(iv), ct: b64(ct) };
};

const decryptText = async (aes, m) => {
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, aes, unb64(m.ct));
    return new TextDecoder().decode(pt);
  } catch (e) {
    return null;
  }
};

// ---- Translations ----
const translations = {
  en: {
    welcome: 'WELCOME', start: '💘 Start', createRoom: '✦  Create a Room', joinRoom: '✦  Join a Room',
    next: 'Next  ›', back: '‹  Back', adlax: '🔎  Adlax', chat: '💬  Chat',
    roomCode: 'Room code:', waitingPartner: 'Send this code to your partner, waiting...',
    youAre: 'You are', chooseSide: 'Choose your side 🪙', flip: 'Flip the coin!',
    result: 'Result:', firstAsk: 'will ask the first question 🎉', startBattle: 'Start Battle!',
    waitingFlip: 'P1 is flipping the coin...', scores: 'Scores', asker: 'is asking', answerer: 'will answer',
    truth: 'Truth 💭', dare: 'Dare 😈', customQ: '📝 Write your own', send: 'Send 🚀',
    waitingQ: 'is choosing a question...', yourAnswer: 'Your answer', partnerAnswer: "Partner's answer",
    writeAnswer: 'Write your answer...', pickPic: '📷 Pick pic', changePic: '📷 Change pic',
    sendAnswer: 'Send answer 🚀', waitAnswer: 'Waiting for answer...',
    donePlus: 'Done / Told (+1) ✅', failedMinus: "Couldn't do (-1) ❌",
    endGame: 'End Game', gameOver: 'Game Over 🏁', won: 'won! 🏆', draw: 'Draw! 🤝',
    newGame: 'New Game', join: 'Join', roomNotFound: 'Room not found, check code', roomFull: 'Room is full',
    encrypted: '🔒 encrypted', encryptionPending: '⏳ encryption setting up...', needBrowser: 'browser required',
    clearData: '🗑️ Clear Data', profile: '👤 Profile', friends: '👥 Friends', leaderboard: '🏆 Leaderboard',
    daily: '📅 Daily Challenge', settings: '⚙️ Settings', save: 'Save', name: 'Name', bio: 'Bio',
    avatar: 'Avatar emoji', friendCode: 'Your friend code', addFriend: 'Add Friend',
    enterFriendCode: 'Enter friend code', noFriends: 'No friends yet', remove: 'Remove',
    dailyTruth: 'Daily Truth', dailyDare: 'Daily Dare', complete: 'Mark Complete', completed: 'Completed today!',
    bonus: 'Bonus points!', language: 'Language', sound: 'Sound Effects', notifications: 'Notifications',
    clearConfirm: 'Clear all local data? This cannot be undone.', yesClear: 'Yes, Clear', cancel: 'Cancel',
    dataCleared: 'All local data cleared.', notice: 'Notice', error: 'Error',
    searching: 'Searching...', nothingFound: 'Nothing found 😕', recent: 'Recent searches:',
    clearHistory: 'Clear history', incognitoOn: '🔒 Incognito: ON', incognitoOff: '🔒 Incognito: OFF',
    sourceWiki: 'Source: Wikipedia', fullPage: '🌐 Read full page', results: '‹  Results',
    aiPlaceholder: 'Ask AI anything...', thinking: 'Thinking...', clear: 'Clear',
    newChat: '➕  New Chat', joinChat: '🔑  Join Chat', chatCode: 'Chat code',
    chatFull: 'This chat is full (only 2 people).', chatDeleted: 'This chat has been deleted.',
    waitPartner: '⏳ Waiting for partner... share this code', e2e: '🔒 End-to-end encrypted  •  Safety code: ',
    videoCall: '📹 Video Call', saveChat: '💾 Save', deleteChat: 'Delete chat', confirmDelete: 'Sure? Tap again',
    noMsg: 'No messages yet. Send the first one! 👋', you: 'You', partner: 'Partner',
    deleteForMe: 'Delete for me', deleteForAll: 'Delete for everyone', leaveChat: '‹  Leave chat',
    msgPlaceholder: 'Type a message...', picOnlyWeb: 'Sending pics currently works only in browser.',
    needPartner: 'Wait for the other player to join and encryption.', needTextOrPic: 'Write an answer or pick a pic first.',
    needBrowserChat: 'Encryption needs a browser (Chrome). Chat is disabled on this device.',
    logout: '🚪 Logout',
  },
  hi: {
    welcome: 'स्वागत है', start: '💘 शुरू करें', createRoom: '✦  रूम बनाएं', joinRoom: '✦  रूम जॉइन करें',
    next: 'अगला  ›', back: '‹  वापस', adlax: '🔎  Adlax', chat: '💬  चैट',
    roomCode: 'रूम कोड:', waitingPartner: 'यह कोड पार्टनर को भेजो, इंतज़ार हो रहा है...',
    youAre: 'तुम हो', chooseSide: 'अपना साइड चुनो 🪙', flip: 'सिक्का उछालो!',
    result: 'नतीजा:', firstAsk: 'पहला सवाल पूछेगा 🎉', startBattle: 'बैटल शुरू!',
    waitingFlip: 'P1 सिक्का उछाल रहा है...', scores: 'स्कोर', asker: 'पूछ रहा है', answerer: 'जवाब देगा',
    truth: 'ट्रुथ 💭', dare: 'डेयर 😈', customQ: '📝 अपना सवाल लिखो', send: 'भेजो 🚀',
    waitingQ: 'सवाल चुन रहा है...', yourAnswer: 'तेरा जवाब', partnerAnswer: 'सामने वाले का जवाब',
    writeAnswer: 'अपना जवाब लिखो...', pickPic: '📷 पिक चुनो', changePic: '📷 पिक बदलो',
    sendAnswer: 'जवाब भेजो 🚀', waitAnswer: 'जवाब का इंतज़ार...',
    donePlus: 'कर दिया / बता दिया (+1) ✅', failedMinus: 'नहीं कर पाया (-1) ❌',
    endGame: 'गेम खत्म', gameOver: 'गेम खत्म 🏁', won: 'जीता! 🏆', draw: 'ड्रॉ! 🤝',
    newGame: 'नया गेम', join: 'जॉइन', roomNotFound: 'रूम नहीं मिला, कोड चेक करो', roomFull: 'रूम फुल है',
    encrypted: '🔒 एन्क्रिप्टेड', encryptionPending: '⏳ एन्क्रिप्शन बन रही है...', needBrowser: 'ब्राउज़र चाहिए',
    clearData: '🗑️ डेटा साफ करें', profile: '👤 प्रोफाइल', friends: '👥 फ्रेंड्स', leaderboard: '🏆 लीडरबोर्ड',
    daily: '📅 डेली चैलेंज', settings: '⚙️ सेटिंग्स', save: 'सेव', name: 'नाम', bio: 'बायो',
    avatar: 'अवतार इमोजी', friendCode: 'तेरा फ्रेंड कोड', addFriend: 'फ्रेंड जोड़ो',
    enterFriendCode: 'फ्रेंड कोड डालो', noFriends: 'अभी कोई फ्रेंड नहीं', remove: 'हटाओ',
    dailyTruth: 'डेली ट्रुथ', dailyDare: 'डेली डेयर', complete: 'पूरा किया', completed: 'आज पूरा हो गया!',
    bonus: 'बोनस पॉइंट्स!', language: 'भाषा', sound: 'साउंड इफेक्ट्स', notifications: 'नोटिफिकेशन',
    clearConfirm: 'सारा लोकल डेटा साफ कर दें? यह वापस नहीं आ सकता।', yesClear: 'हाँ, साफ करो', cancel: 'कैंसल',
    dataCleared: 'सारा लोकल डेटा साफ हो गया।', notice: 'सूचना', error: 'एरर',
    searching: 'ढूंढ रहा हूँ...', nothingFound: 'कुछ नहीं मिला 😕', recent: 'हाल की सर्च:',
    clearHistory: 'हिस्ट्री साफ करो', incognitoOn: '🔒 इनकॉग्निटो: ON', incognitoOff: '🔒 इनकॉग्निटो: OFF',
    sourceWiki: 'सोर्स: विकिपीडिया', fullPage: '🌐 पूरा पढ़ो', results: '‹  रिजल्ट्स',
    aiPlaceholder: 'AI से कुछ भी पूछो...', thinking: 'सोच रहा हूँ...', clear: 'साफ',
    newChat: '➕  नया चैट', joinChat: '🔑  चैट जॉइन', chatCode: 'चैट कोड',
    chatFull: 'यह चैट फुल है (सिर्फ 2 लोग)।', chatDeleted: 'यह चैट डिलीट हो चुकी है।',
    waitPartner: '⏳ पार्टनर का इंतज़ार... यह कोड भेजो', e2e: '🔒 एंड-टू-एंड एन्क्रिप्टेड  •  सेफ्टी कोड: ',
    videoCall: '📹 वीडियो कॉल', saveChat: '💾 सेव', deleteChat: 'चैट डिलीट', confirmDelete: 'पक्का? दोबारा दबाओ',
    noMsg: 'अभी कोई मैसेज नहीं। पहला भेजो! 👋', you: 'तुम', partner: 'पार्टनर',
    deleteForMe: 'मेरे लिए डिलीट', deleteForAll: 'सबके लिए डिलीट', leaveChat: '‹  चैट छोड़ो',
    msgPlaceholder: 'मैसेज लिखो...', picOnlyWeb: 'पिक भेजना अभी सिर्फ ब्राउज़र में चलता है।',
    needPartner: 'दूसरे प्लेयर के जुड़ने और एन्क्रिप्शन का इंतज़ार करो।', needTextOrPic: 'पहले जवाब लिखो या पिक चुनो।',
    needBrowserChat: 'एन्क्रिप्शन के लिए ब्राउज़र (Chrome) चाहिए। इस डिवाइस पर चैट बंद है।',
    logout: '🚪 लॉगआउट',
  },
  es: {
    welcome: 'BIENVENIDO', start: '💘 Empezar', createRoom: '✦  Crear sala', joinRoom: '✦  Unirse a sala',
    next: 'Siguiente  ›', back: '‹  Atrás', adlax: '🔎  Adlax', chat: '💬  Chat',
    roomCode: 'Código de sala:', waitingPartner: 'Envía este código a tu pareja, esperando...',
    youAre: 'Eres', chooseSide: 'Elige tu lado 🪙', flip: '¡Lanza la moneda!',
    result: 'Resultado:', firstAsk: 'hará la primera pregunta 🎉', startBattle: '¡Empezar batalla!',
    waitingFlip: 'P1 está lanzando la moneda...', scores: 'Puntuaciones', asker: 'está preguntando', answerer: 'responderá',
    truth: 'Verdad 💭', dare: 'Reto 😈', customQ: '📝 Escribe tu propia', send: 'Enviar 🚀',
    waitingQ: 'está eligiendo pregunta...', yourAnswer: 'Tu respuesta', partnerAnswer: 'Respuesta del otro',
    writeAnswer: 'Escribe tu respuesta...', pickPic: '📷 Elegir foto', changePic: '📷 Cambiar foto',
    sendAnswer: 'Enviar respuesta 🚀', waitAnswer: 'Esperando respuesta...',
    donePlus: 'Hecho / Dicho (+1) ✅', failedMinus: 'No pudo (-1) ❌',
    endGame: 'Terminar juego', gameOver: 'Fin del juego 🏁', won: '¡ganó! 🏆', draw: '¡Empate! 🤝',
    newGame: 'Nuevo juego', join: 'Unirse', roomNotFound: 'Sala no encontrada', roomFull: 'Sala llena',
    encrypted: '🔒 cifrado', encryptionPending: '⏳ configurando cifrado...', needBrowser: 'se necesita navegador',
    clearData: '🗑️ Borrar datos', profile: '👤 Perfil', friends: '👥 Amigos', leaderboard: '🏆 Clasificación',
    daily: '📅 Reto diario', settings: '⚙️ Ajustes', save: 'Guardar', name: 'Nombre', bio: 'Bio',
    avatar: 'Emoji de avatar', friendCode: 'Tu código de amigo', addFriend: 'Añadir amigo',
    enterFriendCode: 'Introduce código de amigo', noFriends: 'Aún no hay amigos', remove: 'Quitar',
    dailyTruth: 'Verdad diaria', dailyDare: 'Reto diario', complete: 'Marcar completado', completed: '¡Completado hoy!',
    bonus: '¡Puntos extra!', language: 'Idioma', sound: 'Efectos de sonido', notifications: 'Notificaciones',
    clearConfirm: '¿Borrar todos los datos locales? No se puede deshacer.', yesClear: 'Sí, borrar', cancel: 'Cancelar',
    dataCleared: 'Todos los datos locales borrados.', notice: 'Aviso', error: 'Error',
    searching: 'Buscando...', nothingFound: 'Nada encontrado 😕', recent: 'Búsquedas recientes:',
    clearHistory: 'Borrar historial', incognitoOn: '🔒 Incógnito: ON', incognitoOff: '🔒 Incógnito: OFF',
    sourceWiki: 'Fuente: Wikipedia', fullPage: '🌐 Leer página completa', results: '‹  Resultados',
    aiPlaceholder: 'Pregunta lo que quieras a la IA...', thinking: 'Pensando...', clear: 'Limpiar',
    newChat: '➕  Nuevo chat', joinChat: '🔑  Unirse al chat', chatCode: 'Código de chat',
    chatFull: 'Este chat está lleno (solo 2 personas).', chatDeleted: 'Este chat ha sido eliminado.',
    waitPartner: '⏳ Esperando pareja... comparte este código', e2e: '🔒 Cifrado de extremo a extremo  •  Código de seguridad: ',
    videoCall: '📹 Videollamada', saveChat: '💾 Guardar', deleteChat: 'Eliminar chat', confirmDelete: '¿Seguro? Toca otra vez',
    noMsg: 'Aún no hay mensajes. ¡Envía el primero! 👋', you: 'Tú', partner: 'Pareja',
    deleteForMe: 'Eliminar para mí', deleteForAll: 'Eliminar para todos', leaveChat: '‹  Salir del chat',
    msgPlaceholder: 'Escribe un mensaje...', picOnlyWeb: 'Enviar fotos solo funciona en el navegador por ahora.',
    needPartner: 'Espera a que el otro jugador se una y al cifrado.', needTextOrPic: 'Escribe una respuesta o elige una foto primero.',
    needBrowserChat: 'El cifrado necesita un navegador (Chrome). Chat desactivado en este dispositivo.',
    logout: '🚪 Cerrar sesión',
  },
  fr: {
    welcome: 'BIENVENUE', start: '💘 Commencer', createRoom: '✦  Créer une salle', joinRoom: '✦  Rejoindre une salle',
    next: 'Suivant  ›', back: '‹  Retour', adlax: '🔎  Adlax', chat: '💬  Chat',
    roomCode: 'Code de salle :', waitingPartner: 'Envoie ce code à ton partenaire, en attente...',
    youAre: 'Tu es', chooseSide: 'Choisis ton côté 🪙', flip: 'Lance la pièce !',
    result: 'Résultat :', firstAsk: 'posera la première question 🎉', startBattle: 'Commencer la bataille !',
    waitingFlip: 'P1 lance la pièce...', scores: 'Scores', asker: 'pose la question', answerer: 'répondra',
    truth: 'Vérité 💭', dare: 'Défi 😈', customQ: '📝 Écris la tienne', send: 'Envoyer 🚀',
    waitingQ: 'choisit une question...', yourAnswer: 'Ta réponse', partnerAnswer: 'Réponse du partenaire',
    writeAnswer: 'Écris ta réponse...', pickPic: '📷 Choisir photo', changePic: '📷 Changer photo',
    sendAnswer: 'Envoyer la réponse 🚀', waitAnswer: 'En attente de réponse...',
    donePlus: 'Fait / Dit (+1) ✅', failedMinus: "N'a pas pu (-1) ❌",
    endGame: 'Terminer la partie', gameOver: 'Fin de partie 🏁', won: 'a gagné ! 🏆', draw: 'Égalité ! 🤝',
    newGame: 'Nouvelle partie', join: 'Rejoindre', roomNotFound: 'Salle introuvable', roomFull: 'Salle pleine',
    encrypted: '🔒 chiffré', encryptionPending: '⏳ configuration du chiffrement...', needBrowser: 'navigateur requis',
    clearData: '🗑️ Effacer les données', profile: '👤 Profil', friends: '👥 Amis', leaderboard: '🏆 Classement',
    daily: '📅 Défi quotidien', settings: '⚙️ Paramètres', save: 'Enregistrer', name: 'Nom', bio: 'Bio',
    avatar: "Emoji d'avatar", friendCode: 'Ton code ami', addFriend: 'Ajouter un ami',
    enterFriendCode: 'Entre le code ami', noFriends: "Pas encore d'amis", remove: 'Supprimer',
    dailyTruth: 'Vérité du jour', dailyDare: 'Défi du jour', complete: 'Marquer comme fait', completed: "Terminé aujourd'hui !",
    bonus: 'Points bonus !', language: 'Langue', sound: 'Effets sonores', notifications: 'Notifications',
    clearConfirm: 'Effacer toutes les données locales ? Irréversible.', yesClear: 'Oui, effacer', cancel: 'Annuler',
    dataCleared: 'Toutes les données locales effacées.', notice: 'Info', error: 'Erreur',
    searching: 'Recherche...', nothingFound: 'Rien trouvé 😕', recent: 'Recherches récentes :',
    clearHistory: "Effacer l'historique", incognitoOn: '🔒 Incognito : ON', incognitoOff: '🔒 Incognito : OFF',
    sourceWiki: 'Source : Wikipedia', fullPage: '🌐 Lire la page complète', results: '‹  Résultats',
    aiPlaceholder: "Demande n'importe quoi à l'IA...", thinking: 'Réflexion...', clear: 'Effacer',
    newChat: '➕  Nouveau chat', joinChat: '🔑  Rejoindre le chat', chatCode: 'Code du chat',
    chatFull: 'Ce chat est plein (seulement 2 personnes).', chatDeleted: 'Ce chat a été supprimé.',
    waitPartner: '⏳ En attente du partenaire... partage ce code', e2e: '🔒 Chiffrement de bout en bout  •  Code de sécurité : ',
    videoCall: '📹 Appel vidéo', saveChat: '💾 Sauvegarder', deleteChat: 'Supprimer le chat', confirmDelete: 'Sûr ? Appuie encore',
    noMsg: 'Pas encore de messages. Envoie le premier ! 👋', you: 'Toi', partner: 'Partenaire',
    deleteForMe: 'Supprimer pour moi', deleteForAll: 'Supprimer pour tous', leaveChat: '‹  Quitter le chat',
    msgPlaceholder: 'Écris un message...', picOnlyWeb: "Envoyer des photos fonctionne uniquement dans le navigateur pour l'instant.",
    needPartner: "Attends que l'autre joueur rejoigne et le chiffrement.", needTextOrPic: "Écris une réponse ou choisis une photo d'abord.",
    needBrowserChat: 'Le chiffrement nécessite un navigateur (Chrome). Chat désactivé sur cet appareil.',
    logout: '🚪 Déconnexion',
  },
};

// ---- Themes ----
const themes = {
  p1: { bg: '#2b0a1d', accent: '#ff3d7f', accent2: '#ffc2d6', glow: '#ff3d7f', glow2: '#7a1450', e: ['💖', '🌹', '✨'] },
  p2: { bg: '#150f3a', accent: '#8b6bff', accent2: '#d3c7ff', glow: '#8b6bff', glow2: '#ff4fa3', e: ['💜', '🌙', '✨'] },
  p3: { bg: '#33130f', accent: '#ff8a4c', accent2: '#ffd0b0', glow: '#ff8a4c', glow2: '#c2185b', e: ['🌅', '🧡', '✨'] },
  room: { bg: '#2d0b12', accent: '#ff4458', accent2: '#ffc1c8', glow: '#ff4458', glow2: '#6a0f2d', e: ['🔥', '💥', '💘'] },
  adlax: { bg: '#062a33', accent: '#2ed0c4', accent2: '#b8f5ef', glow: '#2ed0c4', glow2: '#1e6fd9', e: ['🔎', '🌊', '✨'] },
  chat: { bg: '#102338', accent: '#f08fa0', accent2: '#ffd9de', glow: '#f08fa0', glow2: '#2f6fb3', e: ['💬', '🌙', '💌'] },
  settings: { bg: '#1a1a2e', accent: '#e94560', accent2: '#f5c6d0', glow: '#e94560', glow2: '#0f3460', e: ['⚙️', '✨', '🔧'] },
};

// ---- Truths / Dares ----
const truths = [
  'Tera sabse bada darr kya hai?',
  'Aakhri jhooth kya bola tha aur kisse?',
  'Tera sabse embarrassing moment kaunsa tha?',
  'Phone mein sabse ajeeb photo kaunsi hai?',
  'Kis cheez ke liye tu sabse zyada paise kharch karta hai?',
  'What is your biggest fear?',
  'What was the last lie you told and to whom?',
  'What is your most embarrassing moment?',
];
const dares = [
  'Ek funny face banao aur 10 second hold karo.',
  'Ek gaana 15 second tak gao.',
  'Apna best filmy dialogue bolke dikhao.',
  '10 pushups karo.',
  '30 second bina hase raho.',
  'Make a funny face and hold it for 10 seconds.',
  'Sing a song for 15 seconds.',
  'Do 10 push-ups.',
];

// ---- Sound Effects ----
let audioCtx = null;
const playSound = (type, enabled) => {
  if (!enabled || typeof window === 'undefined') return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === 'click') {
      osc.frequency.value = 600;
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
    } else if (type === 'success') {
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.setValueAtTime(659, now + 0.08);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now); osc.stop(now + 0.25);
    } else if (type === 'error') {
      osc.frequency.value = 200;
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'msg') {
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now); osc.stop(now + 0.12);
    }
  } catch (e) {}
};

const showNotif = (title, body, enabled) => {
  if (!enabled) return;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/favicon.ico' }); } catch (e) {}
  }
};

export default function App() {
  // ---- State ----
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState('home');
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [room, setRoom] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [query, setQuery] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [history, setHistory] = useState([]);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [detail, setDetail] = useState(null);
  const [adMode, setAdMode] = useState('ai');
  const [aiMsgs, setAiMsgs] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [chatCode, setChatCode] = useState(null);
  const [chatJoin, setChatJoin] = useState('');
  const [chatData, setChatData] = useState(null);
  const [ident, setIdent] = useState(null);
  const [shared, setShared] = useState(null);
  const [chatFull, setChatFull] = useState(false);
  const [plain, setPlain] = useState([]);
  const [hidden, setHidden] = useState([]);
  const [selMsg, setSelMsg] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [rshared, setRshared] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyImg, setReplyImg] = useState(null);
  const [replyPlain, setReplyPlain] = useState(null);
  const [replyPic, setReplyPic] = useState(null);
  const scrollRef = useRef(null);
  const aiScrollRef = useRef(null);
  const lastChat = useRef('');
  const lastDm = useRef('');
  const dmScrollRef = useRef(null);
  const dmImgLoading = useRef({});

  const [profile, setProfile] = useState({ name: '', bio: '', avatar: '😎', friendCode: '' });
  const [friends, setFriends] = useState([]);
  const [friendInput, setFriendInput] = useState('');
  const [scoresHistory, setScoresHistory] = useState([]);
  const [dailyDone, setDailyDone] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [notifOn, setNotifOn] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [uiLang, setUiLang] = useState('en');

  // ---- Auth state (email + password) ----
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authStep, setAuthStep] = useState('form'); // 'form' | 'verify'
  const [pendingToken, setPendingToken] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingUid, setPendingUid] = useState('');
  const [pendingRefresh, setPendingRefresh] = useState('');

  // ---- Permanent friends + chat ----
  const [usernameInput, setUsernameInput] = useState('');
  const [cloudFriends, setCloudFriends] = useState({});
  const [friendReqs, setFriendReqs] = useState({});
  const [reqName, setReqName] = useState('');
  const [dmFriend, setDmFriend] = useState(null);
  const [dmPubStr, setDmPubStr] = useState('');
  const [dmShared, setDmShared] = useState(null);
  const [dmRaw, setDmRaw] = useState({});
  const [dmPlain, setDmPlain] = useState([]);
  const [dmText, setDmText] = useState('');
  const [dmSel, setDmSel] = useState(null);
  const [dmHidden, setDmHidden] = useState([]);
  const [pubError, setPubError] = useState('');
  const [dmImgs, setDmImgs] = useState({});
  const [dmBusy, setDmBusy] = useState(false);
  const [globalBoard, setGlobalBoard] = useState([]);
  const [boardTab, setBoardTab] = useState('global');
  const [boardLoading, setBoardLoading] = useState(false);

  const t = (key) => (translations[uiLang] && translations[uiLang][key]) || translations.en[key] || key;

  // Load persisted data
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('nexdare_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user && user.email && user.uid && authState.refreshToken) {
          setCurrentUser(user);
          setIsLoggedIn(true);
          setProfile(prev => ({ ...prev, ...user }));
        } else {
          localStorage.removeItem('nexdare_user');
        }
      }
      const p = JSON.parse(localStorage.getItem('nexdare_profile') || '{}');
      if (p.name || p.friendCode) setProfile(prev => ({ ...prev, ...p }));
      else {
        const fc = randomId().slice(0, 8);
        const initial = { name: '', bio: '', avatar: '😎', friendCode: fc };
        setProfile(initial);
        localStorage.setItem('nexdare_profile', JSON.stringify(initial));
      }
      const f = JSON.parse(localStorage.getItem('nexdare_friends') || '[]');
      setFriends(f);
      const sc = JSON.parse(localStorage.getItem('nexdare_scores') || '[]');
      setScoresHistory(sc);
      const d = localStorage.getItem('nexdare_daily_' + new Date().toDateString());
      setDailyDone(!!d);
      const s = localStorage.getItem('nexdare_sound');
      if (s !== null) setSoundOn(s === '1');
      const n = localStorage.getItem('nexdare_notif');
      if (n !== null) setNotifOn(n === '1');
      const l = localStorage.getItem('nexdare_uilang');
      if (l && translations[l]) setUiLang(l);
      const h = JSON.parse(localStorage.getItem('nexdare_history') || '[]');
      setHistory(h);
    } catch (e) {}
  }, []);

  const saveProfile = (p) => {
    setProfile(p);
    try { localStorage.setItem('nexdare_profile', JSON.stringify(p)); } catch (e) {}
    if (currentUser && currentUser.uid) {
      const updated = { ...currentUser, ...p };
      setCurrentUser(updated);
      localStorage.setItem('nexdare_user', JSON.stringify(updated));
      set(ref(db, 'users/' + currentUser.uid), updated).catch(() => {});
      if (currentUser.username) {
        update(ref(db, 'profiles/' + currentUser.uid), {
          name: p.name || currentUser.username, avatar: p.avatar || '😎', bio: p.bio || '',
        }).catch(() => {});
      }
    }
  };
  const saveFriends = (f) => {
    setFriends(f);
    try { localStorage.setItem('nexdare_friends', JSON.stringify(f)); } catch (e) {}
  };
  const addScore = (entry) => {
    const next = [entry, ...scoresHistory].slice(0, 50);
    setScoresHistory(next);
    try { localStorage.setItem('nexdare_scores', JSON.stringify(next)); } catch (e) {}
  };

  // ---- Email + password login WITH email verification (Firebase Auth REST) ----
  const authCall = async (endpoint, body) => {
    const res = await fetch(
      'https://identitytoolkit.googleapis.com/v1/' + endpoint + '?key=' + FIREBASE_API_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await res.json();
    if (!res.ok) {
      const code = (data && data.error && data.error.message) || 'UNKNOWN';
      const err = new Error(code);
      err.code = code;
      throw err;
    }
    return data;
  };

  const authMsg = (code) => {
    const c = String(code || 'UNKNOWN');
    if (c.indexOf('EMAIL_EXISTS') === 0) return 'Ye email pehle se registered hai, Login karo.';
    if (c.indexOf('INVALID_LOGIN_CREDENTIALS') === 0 || c.indexOf('INVALID_PASSWORD') === 0 || c.indexOf('EMAIL_NOT_FOUND') === 0)
      return 'Email ya password galat hai.';
    if (c.indexOf('WEAK_PASSWORD') === 0) return 'Password bahut kamzor hai.';
    if (c.indexOf('TOO_MANY_ATTEMPTS') === 0) return 'Bahut try ho gaye, thodi der baad aao.';
    if (c.indexOf('OPERATION_NOT_ALLOWED') === 0) return 'Firebase me Email/Password ON nahi hai.';
    if (c.indexOf('INVALID_ID_TOKEN') === 0 || c.indexOf('TOKEN_EXPIRED') === 0 || c.indexOf('USER_NOT_FOUND') === 0)
      return 'Session purana ho gaya. Wapas jaake Login karo.';
    return 'Error: ' + c;
  };

  const sendVerifyMail = async (token) => {
    await authCall('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: token });
  };

  const finishLogin = async (uid, mail, extra, tokens) => {
    if (tokens) setAuthTokens(tokens);
    let userData = {
      uid,
      email: mail,
      name: profile.name || (extra && extra.name) || '',
      bio: profile.bio || '',
      avatar: profile.avatar || '😎',
      friendCode: profile.friendCode || randomId().slice(0, 8),
      lastLogin: Date.now(),
    };
    try {
      const snap = await get(ref(db, 'users/' + uid));
      if (snap.exists()) {
        userData = { ...userData, ...snap.val(), uid, email: mail, lastLogin: Date.now() };
      }
      await set(ref(db, 'users/' + uid), userData);
    } catch (e) {}
    try {
      const ps = await get(ref(db, 'profiles/' + uid));
      if (ps.exists() && ps.val().username) userData.username = ps.val().username;
    } catch (e) {}
    localStorage.setItem('nexdare_user', JSON.stringify(userData));
    setCurrentUser(userData);
    setProfile((prev) => ({ ...prev, ...userData }));
    setIsLoggedIn(true);
    setAuthStep('form');
    setPendingToken(''); setPendingEmail(''); setPendingUid(''); setPendingRefresh('');
    setEmail(''); setPassword('');
    setError('');
    setNotice('Login successful! 🎉');
    playSound('success', soundOn);
  };

  const submitAuth = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail.includes('@') || !mail.includes('.')) {
      setError('Sahi email daalo'); playSound('error', soundOn); return;
    }
    if (password.length < 6) {
      setError('Password kam se kam 6 akshar ka rakho'); playSound('error', soundOn); return;
    }
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const data = await authCall(
        authMode === 'signup' ? 'accounts:signUp' : 'accounts:signInWithPassword',
        { email: mail, password, returnSecureToken: true }
      );
      if (authMode === 'signup') {
        await sendVerifyMail(data.idToken);
        setPendingToken(data.idToken); setPendingEmail(data.email); setPendingUid(data.localId); setPendingRefresh(data.refreshToken);
        setAuthStep('verify');
        setNotice('Verification link bhej diya: ' + data.email);
        playSound('success', soundOn);
      } else {
        const info = await authCall('accounts:lookup', { idToken: data.idToken });
        const u = info.users && info.users[0];
        if (u && u.emailVerified) {
          await finishLogin(data.localId, data.email, undefined, { idToken: data.idToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn });
        } else {
          setPendingToken(data.idToken); setPendingEmail(data.email); setPendingUid(data.localId); setPendingRefresh(data.refreshToken);
          setAuthStep('verify');
          setNotice('Email abhi verify nahi hua. Mail ka link kholo ya "Mail dobara bhejo" dabao.');
        }
      }
    } catch (e) {
      setError(authMsg(e.code || e.message));
      playSound('error', soundOn);
    }
    setAuthLoading(false);
  };

  const checkVerified = async () => {
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const info = await authCall('accounts:lookup', { idToken: pendingToken });
      const u = info.users && info.users[0];
      if (u && u.emailVerified) {
        await finishLogin(pendingUid, pendingEmail, undefined, { idToken: pendingToken, refreshToken: pendingRefresh, expiresIn: 0 });
      } else {
        setError('Abhi email verify nahi hua. Mail me link pe tap karo, phir yahan dobara dabao.');
        playSound('error', soundOn);
      }
    } catch (e) {
      setError(authMsg(e.code || e.message));
      playSound('error', soundOn);
    }
    setAuthLoading(false);
  };

  const resendVerify = async () => {
    setError(''); setNotice('');
    try {
      await sendVerifyMail(pendingToken);
      setNotice('Mail dobara bhej diya. Spam folder bhi check karo.');
      playSound('success', soundOn);
    } catch (e) {
      setError(authMsg(e.code || e.message));
      playSound('error', soundOn);
    }
  };

  const googleLogin = async () => {
    if (Platform.OS !== 'web') {
      setError('Google login sirf website (browser) me chalta hai.');
      return;
    }
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const fb = await loadFirebase();
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await fb.auth().signInWithPopup(provider);
      const u = result.user;
      const gToken = await u.getIdToken();
      await finishLogin(u.uid, u.email, { name: u.displayName || '' }, { idToken: gToken, refreshToken: u.refreshToken, expiresIn: 3500 });
    } catch (e) {
      const c = String((e && e.code) || '');
      let msg = 'Google login nahi hua: ' + ((e && e.message) || c);
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') msg = 'Google ki window band ho gayi. Dobara try karo.';
      else if (c === 'auth/popup-blocked') msg = 'Browser ne popup roka hai. Popup allow karke dobara dabao.';
      else if (c === 'auth/unauthorized-domain') msg = 'Ye website Firebase ke Authorised domains me nahi hai. Live site (nexdare-web.vercel.app) pe try karo.';
      else if (c === 'auth/operation-not-allowed') msg = 'Firebase me Google sign-in ON nahi hai.';
      setError(msg);
      playSound('error', soundOn);
    }
    setAuthLoading(false);
  };

  const forgotPassword = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail.includes('@') || !mail.includes('.')) { setError('Pehle upar Email daalo'); return; }
    setError(''); setNotice('');
    try {
      await authCall('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: mail });
      setNotice('Password badalne ka link mail par bhej diya. Spam bhi dekho.');
      playSound('success', soundOn);
    } catch (e) {
      const c = String((e && e.code) || '');
      setError(c.indexOf('EMAIL_NOT_FOUND') === 0 ? 'Is email se koi account nahi hai.' : authMsg(c || (e && e.message)));
      playSound('error', soundOn);
    }
  };

  const backToForm = () => {
    setAuthStep('form');
    setPendingToken(''); setPendingEmail(''); setPendingUid(''); setPendingRefresh('');
    setPassword(''); setError(''); setNotice('');
  };

  const logout = () => {
    clearAuthTokens();
    setCloudFriends({}); setFriendReqs({}); setDmFriend(null);
    try { if (window.firebase && window.firebase.apps.length) window.firebase.auth().signOut(); } catch (e) {}
    localStorage.removeItem('nexdare_user');
    setCurrentUser(null);
    setIsLoggedIn(false);
    setEmail('');
    setPassword('');
    setAuthMode('login');
    setAuthStep('form');
    setNotice('Logged out');
    playSound('click', soundOn);
  };

  // ---- Username + friends + permanent chat ----
  const addCloudPoints = async (points, opts) => {
    if (!currentUser || !currentUser.uid || !currentUser.username) return;
    try {
      const r = ref(db, 'leaderboard/' + currentUser.uid);
      const snap = await get(r);
      const cur = snap.exists() ? snap.val() : {};
      await set(r, {
        username: currentUser.username,
        name: currentUser.name || currentUser.username,
        avatar: currentUser.avatar || '😎',
        points: (cur.points || 0) + points,
        games: (cur.games || 0) + (opts && opts.game ? 1 : 0),
        wins: (cur.wins || 0) + (opts && opts.won ? 1 : 0),
        t: Date.now(),
      });
    } catch (e) {}
  };

  const loadBoard = async () => {
    setBoardLoading(true);
    try {
      const v = await call('GET', 'leaderboard', undefined, 'orderBy=%22points%22&limitToLast=20');
      const list = Object.keys(v || {}).map((k) => ({ uid: k, ...v[k] }));
      list.sort((a, b) => (b.points || 0) - (a.points || 0));
      setGlobalBoard(list);
    } catch (e) {
      setError('Leaderboard load nahi hua: ' + e.message);
    }
    setBoardLoading(false);
  };

  const copyText = async (txt) => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(txt);
        setNotice('Copy ho gaya ✅');
      } else {
        await Share.share({ message: txt });
      }
    } catch (e) {}
  };

  const claimUsername = async () => {
    const uname = usernameInput.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      setError('Username 3 se 20 akshar ka ho: sirf a-z, 0-9 aur _'); playSound('error', soundOn); return;
    }
    if (!currentUser || !currentUser.uid) return;
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const snap = await get(ref(db, 'usernames/' + uname));
      if (snap.exists() && snap.val() !== currentUser.uid) {
        setError('Ye username kisi ne le liya hai, doosra chuno.'); playSound('error', soundOn);
        setAuthLoading(false); return;
      }
      await set(ref(db, 'usernames/' + uname), currentUser.uid);
      await set(ref(db, 'profiles/' + currentUser.uid), {
        username: uname,
        name: currentUser.name || uname,
        avatar: currentUser.avatar || '😎',
        bio: currentUser.bio || '',
      });
      const updated = { ...currentUser, username: uname, name: currentUser.name || uname };
      localStorage.setItem('nexdare_user', JSON.stringify(updated));
      setCurrentUser(updated);
      setProfile((prev) => ({ ...prev, name: updated.name }));
      setUsernameInput('');
      setNotice('Username set ho gaya: @' + uname + ' 🎉');
      playSound('success', soundOn);
    } catch (e) {
      setError('Username save nahi hua: ' + e.message); playSound('error', soundOn);
    }
    setAuthLoading(false);
  };

  const sendFriendRequest = async () => {
    const uname = reqName.trim().toLowerCase().replace(/^@/, '');
    if (!uname) return;
    if (!currentUser || !currentUser.uid || !currentUser.username) return;
    if (uname === currentUser.username) { setError('Khud ko add nahi kar sakte 😄'); return; }
    setError(''); setNotice('');
    try {
      const snap = await get(ref(db, 'usernames/' + uname));
      if (!snap.exists()) { setError('Ye username nahi mila. Spelling check karo.'); playSound('error', soundOn); return; }
      const targetUid = snap.val();
      if (cloudFriends[targetUid]) { setNotice('Ye pehle se aapka friend hai.'); return; }
      if (friendReqs[targetUid]) { setNotice('Unhone aapko request bheji hai. Neeche Accept karo.'); return; }
      await set(ref(db, 'friendReqs/' + targetUid + '/' + currentUser.uid), {
        uid: currentUser.uid,
        username: currentUser.username,
        name: currentUser.name || currentUser.username,
        avatar: currentUser.avatar || '😎',
        t: Date.now(),
      });
      setReqName('');
      setNotice('Request bhej di ✅ @' + uname + ' accept karega to chat shuru ho jayegi.');
      playSound('success', soundOn);
    } catch (e) {
      setError('Request nahi gayi: ' + e.message); playSound('error', soundOn);
    }
  };

  const acceptRequest = async (r) => {
    if (!currentUser || !currentUser.uid) return;
    try {
      const chatId = [currentUser.uid, r.uid].sort().join('_');
      const since = Date.now();
      await set(ref(db, 'friends/' + currentUser.uid + '/' + r.uid), {
        uid: r.uid, username: r.username, name: r.name || r.username, avatar: r.avatar || '😎', chatId, since,
      });
      await set(ref(db, 'friends/' + r.uid + '/' + currentUser.uid), {
        uid: currentUser.uid, username: currentUser.username, name: currentUser.name || currentUser.username,
        avatar: currentUser.avatar || '😎', chatId, since,
      });
      await remove(ref(db, 'friendReqs/' + currentUser.uid + '/' + r.uid));
      setNotice('@' + r.username + ' ab aapka friend hai 🎉');
      playSound('success', soundOn);
    } catch (e) {
      setError('Accept nahi hua: ' + e.message); playSound('error', soundOn);
    }
  };

  const declineRequest = async (r) => {
    try { await remove(ref(db, 'friendReqs/' + currentUser.uid + '/' + r.uid)); }
    catch (e) { setError('Error: ' + e.message); }
  };

  const removeCloudFriend = async (f) => {
    try { await remove(ref(db, 'friends/' + currentUser.uid + '/' + f.uid)); }
    catch (e) { setError('Error: ' + e.message); }
  };

  const openDm = (f) => {
    setDmFriend(f); setDmShared(null); setDmPlain([]); setDmRaw({}); setDmPubStr('');
    setDmImgs({}); dmImgLoading.current = {}; setDmBusy(false);
    lastDm.current = '';
    setDmSel(null); setDmText(''); setError(''); setNotice('');
    let h = [];
    try { h = JSON.parse(localStorage.getItem('nexdare_dmhidden_' + f.chatId)) || []; } catch (e) {}
    setDmHidden(h);
    if (subtle) loadIdentity().then(setIdent).catch(() => {});
    setScreen('dm');
  };

  const leaveDm = () => {
    setDmFriend(null); setDmShared(null); setDmPlain([]); setDmRaw({});
    setDmSel(null); setError(''); setNotice('');
    setScreen('friends');
  };

  const sendDm = async () => {
    const text = dmText.trim();
    if (!text || !dmFriend) return;
    if (!dmShared || !currentUser) { setNotice('Friend ki encryption abhi ready nahi hai. Unhe app kholne ko bolo.'); return; }
    setDmText(''); setNotice('');
    try {
      const enc = await encryptText(dmShared.aes, text);
      await push(ref(db, 'dm/' + dmFriend.chatId + '/messages'), {
        from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now(),
      });
      playSound('msg', soundOn);
    } catch (e) { setError('Message nahi gaya: ' + e.message); playSound('error', soundOn); }
  };

  const sendDmFile = async (file) => {
    if (!dmFriend || !dmShared || !currentUser) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    setError(''); setNotice('');
    const isImg = !!file.type && file.type.indexOf('image/') === 0;
    if (!isImg && file.size > MAX_DM_FILE) { setError('File badi hai. 2 MB tak ki file bhej sakte ho.'); return; }
    if (file.size > 25 * 1024 * 1024) { setError('Ye file bahut badi hai.'); return; }
    setDmBusy(true);
    try {
      let dataUrl = await readAsDataUrl(file);
      let type = file.type || 'application/octet-stream';
      if (isImg) { dataUrl = await compressImage(dataUrl); type = 'image/jpeg'; }
      if (dataUrl.length > 3000000) { setError('File badi hai. 2 MB tak ki file bhej sakte ho.'); setDmBusy(false); return; }
      const fid = randomId();
      const encD = await encryptText(dmShared.aes, dataUrl);
      await set(ref(db, 'dm/' + dmFriend.chatId + '/files/' + fid), {
        iv: encD.iv, ct: encD.ct, from: currentUser.uid, t: Date.now(),
      });
      const caption = dmText.trim();
      const meta = JSON.stringify({ __f: 1, id: fid, name: file.name || 'file', type, size: file.size, text: caption });
      const encM = await encryptText(dmShared.aes, meta);
      await push(ref(db, 'dm/' + dmFriend.chatId + '/messages'), {
        from: currentUser.uid, iv: encM.iv, ct: encM.ct, t: Date.now(),
      });
      setDmText('');
      playSound('msg', soundOn);
    } catch (e) {
      setError('File nahi gayi: ' + e.message); playSound('error', soundOn);
    }
    setDmBusy(false);
  };

  const pickDmFile = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    if (!dmShared) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) sendDmFile(file);
    };
    input.click();
  };

  const downloadDmFile = async (f) => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    try {
      let data = dmImgs[f.id];
      if (!data || data === 'ERR') {
        const v = await call('GET', 'dm/' + dmFriend.chatId + '/files/' + f.id);
        if (!v) { setError('File nahi mili (delete ho gayi hogi).'); return; }
        data = await decryptText(dmShared.aes, v);
      }
      if (!data) { setError('File decrypt nahi hui.'); return; }
      const a = document.createElement('a');
      a.href = data;
      a.download = f.name || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) { setError('Download nahi hua: ' + e.message); }
  };

  const dmDeleteForMe = () => {
    if (!dmSel || !dmFriend) return;
    const h = [...dmHidden, dmSel.key];
    setDmHidden(h);
    try { localStorage.setItem('nexdare_dmhidden_' + dmFriend.chatId, JSON.stringify(h)); } catch (e) {}
    setDmSel(null);
  };

  const dmDeleteForAll = async () => {
    if (!dmSel || !dmFriend || !currentUser || dmSel.from !== currentUser.uid) return;
    try {
      await remove(ref(db, 'dm/' + dmFriend.chatId + '/messages/' + dmSel.key));
      if (dmSel.file) await remove(ref(db, 'dm/' + dmFriend.chatId + '/files/' + dmSel.file.id)).catch(() => {});
    } catch (e) { setError('Delete nahi hua: ' + e.message); }
    setDmSel(null);
  };

  // ---- Rest of original logic (rooms, chat, etc.) ----
  const keysStr = chatData && chatData.keys ? JSON.stringify(chatData.keys) : '';
  const roomKeysStr = room && room.keys ? JSON.stringify(room.keys) : '';
  const replyMeta = room && room.reply ? room.reply : null;
  const replyCt = replyMeta ? replyMeta.ct : '';
  const replyRid = replyMeta ? replyMeta.rid : '';
  const qText = room && room.question ? room.question.text : '';

  useEffect(() => {
    if (!roomCode) return;
    const unsub = onValue(ref(db, 'rooms/' + roomCode), (snap) => setRoom(snap.val()));
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode || !role || !subtle) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await loadIdentity();
        if (cancelled) return;
        setIdent(id);
        await update(ref(db, 'rooms/' + roomCode + '/keys'), { [role]: id.pub });
      } catch (e) {
        setError('Encryption setup nahi hua: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [roomCode, role]);

  useEffect(() => {
    if (!ident || !role || !room || !room.keys) return;
    const otherRole = role === 'P1' ? 'P2' : 'P1';
    const other = room.keys[otherRole];
    if (!other) { setRshared(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const sh = await deriveShared(ident.priv, other);
        const safety = await safetyCode(ident.pub, other);
        if (!cancelled) setRshared({ aes: sh.aes, safety });
      } catch (e) {
        if (!cancelled) setError('Key error: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [ident, role, roomKeysStr]);

  useEffect(() => {
    if (!rshared || !replyMeta) { setReplyPlain(null); return; }
    let cancelled = false;
    (async () => {
      const txt = await decryptText(rshared.aes, replyMeta);
      if (cancelled) return;
      try {
        setReplyPlain(
          txt === null ? null : { ...JSON.parse(txt), from: replyMeta.from, hasImg: !!replyMeta.img }
        );
      } catch (e) {
        setReplyPlain(null);
      }
    })();
    return () => { cancelled = true; };
  }, [rshared, replyCt]);

  useEffect(() => {
    if (!rshared || !roomCode || !replyMeta || !replyMeta.img) { setReplyPic(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const v = await call('GET', 'chats/img-' + roomCode);
        if (!v || v.rid !== replyMeta.rid) return;
        const data = await decryptText(rshared.aes, v);
        if (!cancelled && data) setReplyPic(data);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [rshared, replyRid]);

  useEffect(() => {
    setReplyText('');
    setReplyImg(null);
  }, [qText]);

  useEffect(() => {
    if (!chatCode) return;
    const unsub = onValue(ref(db, 'chats/' + chatCode), (snap) => {
      const v = snap.val();
      const str = JSON.stringify(v);
      if (str !== lastChat.current) {
        lastChat.current = str;
        setChatData(v === null ? { gone: true } : v);
      }
    });
    return () => unsub();
  }, [chatCode]);

  useEffect(() => {
    if (!chatCode || !subtle) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await loadIdentity();
        if (cancelled) return;
        setIdent(id);
        const snap = await get(ref(db, 'chats/' + chatCode + '/keys'));
        const keys = snap.val() || {};
        if (!keys[id.sid] && Object.keys(keys).length >= 2) { setChatFull(true); return; }
        if (!keys[id.sid]) await update(ref(db, 'chats/' + chatCode + '/keys'), { [id.sid]: id.pub });
        let h = [];
        try { h = JSON.parse(localStorage.getItem('nexdare_hidden_' + chatCode)) || []; } catch (e) {}
        setHidden(h);
      } catch (e) {
        setError('Encryption setup nahi hua: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [chatCode]);

  useEffect(() => {
    if (!ident || !chatData || !chatData.keys) return;
    const others = Object.keys(chatData.keys).filter((k) => k !== ident.sid);
    if (others.length === 0) { setShared(null); return; }
    const otherPub = chatData.keys[others[0]];
    let cancelled = false;
    (async () => {
      try {
        const sh = await deriveShared(ident.priv, otherPub);
        const safety = await safetyCode(ident.pub, otherPub);
        if (!cancelled) setShared({ aes: sh.aes, callHash: sh.callHash, safety });
      } catch (e) {
        if (!cancelled) setError('Key error: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [ident, keysStr]);

  useEffect(() => {
    if (!shared || !chatData || !chatData.messages) { setPlain([]); return; }
    let cancelled = false;
    (async () => {
      const list = Object.keys(chatData.messages).map((k) => ({ key: k, ...chatData.messages[k] }));
      list.sort((a, b) => a.t - b.t);
      const out = [];
      for (const m of list.slice(-60)) {
        const text = await decryptText(shared.aes, m);
        out.push({ key: m.key, sid: m.sid, t: m.t, text: text === null ? '🔒 (decrypt nahi ho paya)' : text });
      }
      if (!cancelled) setPlain(out);
    })();
    return () => { cancelled = true; };
  }, [shared, chatData]);

  // Public encryption key publish (for permanent chat)
  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.uid || !currentUser.username || !subtle) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await loadIdentity();
        if (cancelled) return;
        await update(ref(db, 'profiles/' + currentUser.uid), { pub: id.pub });
        if (!cancelled) setPubError('');
      } catch (e) {
        if (!cancelled) setPubError('Encryption key save nahi hui: ' + e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, currentUser && currentUser.uid, currentUser && currentUser.username, screen === 'friends']);

  // Friends + requests (only while Friends / Chat screen is open)
  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.uid || !currentUser.username) return;
    if (screen !== 'friends' && screen !== 'dm') return;
    const uid = currentUser.uid;
    const u1 = onValue(ref(db, 'friends/' + uid), (snap) => setCloudFriends(snap.val() || {}));
    const u2 = onValue(ref(db, 'friendReqs/' + uid), (snap) => setFriendReqs(snap.val() || {}));
    return () => { u1(); u2(); };
  }, [isLoggedIn, screen, currentUser && currentUser.uid, currentUser && currentUser.username]);

  // Friend's public key
  useEffect(() => {
    if (screen !== 'dm' || !dmFriend) return;
    const unsub = onValue(ref(db, 'profiles/' + dmFriend.uid + '/pub'), (snap) => setDmPubStr(JSON.stringify(snap.val())));
    return () => unsub();
  }, [screen, dmFriend && dmFriend.uid]);

  // Shared secret
  useEffect(() => {
    if (!ident || !dmPubStr || dmPubStr === 'null' || screen !== 'dm') { setDmShared(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const other = JSON.parse(dmPubStr);
        const sh = await deriveShared(ident.priv, other);
        const safety = await safetyCode(ident.pub, other);
        if (!cancelled) setDmShared({ aes: sh.aes, safety });
      } catch (e) {
        if (!cancelled) setDmShared(null);
      }
    })();
    return () => { cancelled = true; };
  }, [ident, dmPubStr, screen]);

  // Messages (last 100)
  useEffect(() => {
    if (screen !== 'dm' || !dmFriend) return;
    const unsub = onValue(
      { path: 'dm/' + dmFriend.chatId + '/messages', query: 'orderBy=%22%24key%22&limitToLast=100' },
      (snap) => {
        const v = snap.val();
        const str = JSON.stringify(v);
        if (str !== lastDm.current) { lastDm.current = str; setDmRaw(v || {}); }
      }
    );
    return () => unsub();
  }, [screen, dmFriend && dmFriend.chatId]);

  // Decrypt messages
  useEffect(() => {
    if (!dmShared) { setDmPlain([]); return; }
    let cancelled = false;
    (async () => {
      const list = Object.keys(dmRaw).map((k) => ({ key: k, ...dmRaw[k] }));
      list.sort((a, b) => a.t - b.t);
      const out = [];
      for (const m of list) {
        const text = await decryptText(dmShared.aes, m);
        let shown = text === null ? '🔒 (decrypt nahi ho paya)' : text;
        let file = null;
        if (text && text.indexOf('{"__f":1') === 0) {
          try {
            const j = JSON.parse(text);
            file = { id: j.id, name: j.name, type: j.type, size: j.size };
            shown = j.text || '';
          } catch (e) {}
        }
        out.push({ key: m.key, from: m.from, t: m.t, text: shown, file });
      }
      if (!cancelled) setDmPlain(out);
    })();
    return () => { cancelled = true; };
  }, [dmShared, dmRaw]);

  // Leaderboard opens -> load global list
  useEffect(() => {
    if (screen === 'leaderboard' && isLoggedIn) loadBoard();
  }, [screen]);

  // Photos load automatically
  useEffect(() => {
    if (!dmShared || !dmFriend) return;
    dmPlain.forEach((m) => {
      const f = m.file;
      if (f && f.type && f.type.indexOf('image/') === 0 && !dmImgs[f.id] && !dmImgLoading.current[f.id]) {
        dmImgLoading.current[f.id] = true;
        (async () => {
          try {
            const v = await call('GET', 'dm/' + dmFriend.chatId + '/files/' + f.id);
            if (!v) { dmImgLoading.current[f.id] = false; return; }
            const data = await decryptText(dmShared.aes, v);
            setDmImgs((prev) => ({ ...prev, [f.id]: data || 'ERR' }));
          } catch (e) { dmImgLoading.current[f.id] = false; }
        })();
      }
    });
  }, [dmPlain, dmShared]);

  const visible = plain.filter((m) => !hidden.includes(m.key));
  const dmVisible = dmPlain.filter((m) => !dmHidden.includes(m.key));

  let th = themes.p1;
  if (screen === 'home') th = page === 1 ? themes.p1 : page === 2 ? themes.p2 : themes.p3;
  else if (screen === 'join' || screen === 'room') th = themes.room;
  else if (screen === 'adlax') th = themes.adlax;
  else if (screen === 'chat' || screen === 'dm') th = themes.chat;
  else if (['settings', 'profile', 'friends', 'leaderboard', 'daily'].includes(screen)) th = themes.settings;

  const Btn = ({ label, onPress, big }) => (
    <TouchableOpacity
      style={[s.b, { backgroundColor: th.accent, shadowColor: th.accent }, big ? s.bBig : null]}
      onPress={() => { playSound('click', soundOn); onPress && onPress(); }}
    >
      <Text style={[s.bt, big ? s.btBig : null]}>{label}</Text>
    </TouchableOpacity>
  );
  const Nav = ({ label, onPress }) => (
    <TouchableOpacity style={[s.nav, { borderColor: th.accent + '88' }]} onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
      <Text style={[s.navt, { color: th.accent2 }]}>{label}</Text>
    </TouchableOpacity>
  );
  const Mini = ({ label, onPress }) => (
    <TouchableOpacity style={[s.mini, { borderColor: th.accent + '88' }]} onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
      <Text style={[s.miniT, { color: th.accent2 }]}>{label}</Text>
    </TouchableOpacity>
  );
  const dots = (n) => (
    <View style={s.dotRow}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={[s.dot, i === n ? { width: 26, backgroundColor: th.accent } : null]} />
      ))}
    </View>
  );

  const roomRef = () => ref(db, 'rooms/' + roomCode);
  const freshCode = async (base, make) => {
    for (let i = 0; i < 6; i++) {
      const code = make();
      const snap = await get(ref(db, base + code));
      if (!snap.exists()) return code;
    }
    throw new Error('Code nahi ban paya, dobara try karo');
  };
  const roomCodeMaker = () => String(Math.floor(1000 + Math.random() * 9000));
  const chatCodeMaker = () => randomId().slice(0, 8);

  const resetReply = () => {
    setRshared(null); setReplyPlain(null); setReplyPic(null);
    setReplyText(''); setReplyImg(null);
  };

  const createRoom = async () => {
    try {
      const code = await freshCode('rooms/', roomCodeMaker);
      await set(ref(db, 'rooms/' + code), {
        stage: 'lobby', p2: false, scores: { P1: 0, P2: 0 }, callId: 'tdb' + randomId(),
      });
      resetReply();
      setError(''); setRole('P1'); setRoom(null); setRoomCode(code); setScreen('room');
      playSound('success', soundOn);
      showNotif('Nexdare', 'Room created: ' + code, notifOn);
    } catch (e) { setError('Error: ' + e.message); playSound('error', soundOn); }
  };

  const joinRoom = async () => {
    try {
      const code = joinCode.trim();
      const snap = await get(ref(db, 'rooms/' + code));
      if (!snap.exists()) { setError(t('roomNotFound')); playSound('error', soundOn); return; }
      if (snap.val().p2) { setError(t('roomFull')); playSound('error', soundOn); return; }
      await update(ref(db, 'rooms/' + code), { p2: true, stage: 'flip' });
      resetReply();
      setError(''); setRole('P2'); setRoom(null); setRoomCode(code); setScreen('room');
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); playSound('error', soundOn); }
  };

  const leave = () => {
    if (room && room.scores) {
      addScore({
        date: new Date().toISOString(),
        p1: room.scores.P1,
        p2: room.scores.P2,
        role,
        name: profile.name || role,
      });
      if (currentUser && currentUser.username && role && (room.stage === 'game' || room.stage === 'end')) {
        const mine = role === 'P1' ? room.scores.P1 : room.scores.P2;
        const opp = role === 'P1' ? room.scores.P2 : room.scores.P1;
        addCloudPoints(mine, { game: true, won: mine > opp });
      }
    }
    resetReply();
    setRoomCode(null); setRoom(null); setRole(null);
    setJoinCode(''); setError(''); setNotice(''); setCustomMode(false); setCustomText('');
    setPage(2); setScreen('home');
  };

  const choose = (side) => update(roomRef(), { pick: side, result: null });
  const flip = () => {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    update(roomRef(), { result, asker: result === room.pick ? 'P1' : 'P2' });
    playSound('success', soundOn);
  };
  const startBattle = () => update(roomRef(), { stage: 'game' });
  const ask = (kind) =>
    update(roomRef(), { question: { kind, text: pickOne(kind === 'Truth' ? truths : dares) } });
  const sendCustom = () => {
    const text = customText.trim();
    if (!text) return;
    update(roomRef(), { question: { kind: 'Sawal', text } });
    setCustomText(''); setCustomMode(false);
  };
  const judge = (delta) => {
    const answerer = room.asker === 'P1' ? 'P2' : 'P1';
    update(roomRef(), {
      scores: { ...room.scores, [answerer]: room.scores[answerer] + delta },
      question: null,
      reply: null,
      asker: answerer,
    });
    remove(ref(db, 'chats/img-' + roomCode)).catch(() => {});
    playSound(delta > 0 ? 'success' : 'error', soundOn);
  };
  const endGame = () => update(roomRef(), { stage: 'end' });

  const pickImage = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          const max = 480;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          setReplyImg(c.toDataURL('image/jpeg', 0.55));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const sendReply = async () => {
    const text = replyText.trim();
    if (!text && !replyImg) { setNotice(t('needTextOrPic')); return; }
    if (!rshared) { setNotice(t('needPartner')); return; }
    try {
      const rid = randomId();
      const encT = await encryptText(rshared.aes, JSON.stringify({ text }));
      if (replyImg) {
        const encI = await encryptText(rshared.aes, replyImg);
        await set(ref(db, 'chats/img-' + roomCode), { rid, iv: encI.iv, ct: encI.ct });
      }
      await update(roomRef(), {
        reply: { iv: encT.iv, ct: encT.ct, from: role, rid, img: !!replyImg },
      });
      setReplyText(''); setReplyImg(null); setNotice('');
      playSound('msg', soundOn);
    } catch (e) {
      setError('Jawab nahi gaya: ' + e.message);
      playSound('error', soundOn);
    }
  };

  const backToTools = () => { setError(''); setNotice(''); setDetail(null); setPage(3); setScreen('home'); };

  const doSearch = async (q) => {
    const text = (q !== undefined ? q : query).trim();
    if (!text) return;
    setQuery(text);
    if (!incognito) {
      const next = [text, ...history.filter((x) => x !== text)].slice(0, 5);
      setHistory(next);
      try { localStorage.setItem('nexdare_history', JSON.stringify(next)); } catch (e) {}
    }
    setSearching(true); setSearched(true); setError('');
    try {
      const wikiLang = uiLang === 'hi' ? 'hi' : uiLang === 'es' ? 'es' : uiLang === 'fr' ? 'fr' : 'en';
      const res = await fetch(
        'https://' + wikiLang + '.wikipedia.org/w/api.php?action=query&list=search&srlimit=8&format=json&origin=*&srsearch=' +
          encodeURIComponent(text)
      );
      const data = await res.json();
      const list = (data.query && data.query.search) || [];
      setResults(list.map((r) => ({ id: String(r.pageid), title: r.title, snippet: cleanHtml(r.snippet) })));
    } catch (e) {
      setError('Search nahi ho paya: ' + e.message);
      setResults([]);
    }
    setSearching(false);
  };

  const openResult = async (r) => {
    setError('');
    setDetail({ id: r.id, title: r.title, text: 'Load ho raha hai...' });
    try {
      const wikiLang = uiLang === 'hi' ? 'hi' : uiLang === 'es' ? 'es' : uiLang === 'fr' ? 'fr' : 'en';
      const res = await fetch(
        'https://' + wikiLang + '.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&pageids=' +
          r.id
      );
      const data = await res.json();
      const p = data.query.pages[r.id];
      setDetail({ id: r.id, title: r.title, text: (p && p.extract) || 'Is page ka summary nahi mila.' });
    } catch (e) {
      setDetail({ id: r.id, title: r.title, text: 'Load nahi ho paya: ' + e.message });
    }
  };

  const askAI = async () => {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    if (!AI_URL) { setError('AI ka backend link daalna baaki hai.'); return; }
    const next = [...aiMsgs, { role: 'user', content: text }];
    setAiMsgs(next); setAiInput(''); setAiBusy(true); setError('');
    try {
      const res = await fetch(AI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-12).map((m, i, arr) =>
            m.role === 'user' && i === arr.length - 1
              ? { ...m, content: m.content + '\n\n(Aaj ki tareekh: ' + new Date().toDateString() + ')' }
              : m
          ),
        }),
      });
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {}
      if (!res.ok || !data) {
        setError('AI server se sahi jawab nahi aaya (status ' + res.status + ').');
      } else {
        setAiMsgs([...next, { role: 'assistant', content: cleanAI(data.reply || 'Jawab nahi mila.') }]);
        playSound('msg', soundOn);
      }
    } catch (e) {
      setError('AI se baat nahi ho paayi: ' + e.message);
    }
    setAiBusy(false);
  };

  const createChat = async () => {
    try {
      const code = await freshCode('chats/', chatCodeMaker);
      await set(ref(db, 'chats/' + code), { created: Date.now() });
      setError(''); setChatData(null); setShared(null); setPlain([]); setChatFull(false);
      lastChat.current = '';
      setChatCode(code);
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const joinChat = async () => {
    try {
      const code = chatJoin.trim().toLowerCase();
      const snap = await get(ref(db, 'chats/' + code));
      if (!snap.exists()) { setError('Chat nahi mila, code check karo'); return; }
      setError(''); setChatData(null); setShared(null); setPlain([]); setChatFull(false);
      lastChat.current = '';
      setChatCode(code);
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const leaveChat = () => {
    lastChat.current = '';
    setChatCode(null); setChatData(null); setShared(null); setPlain([]); setHidden([]);
    setSelMsg(null); setConfirmDel(false); setChatFull(false);
    setChatJoin(''); setMsgText(''); setError(''); setNotice('');
    setPage(3); setScreen('home');
  };
  const sendMsg = async () => {
    const text = msgText.trim();
    if (!text) return;
    if (!shared || !ident) { setNotice(t('needPartner')); return; }
    setMsgText(''); setNotice('');
    try {
      const enc = await encryptText(shared.aes, text);
      await push(ref(db, 'chats/' + chatCode + '/messages'), { sid: ident.sid, iv: enc.iv, ct: enc.ct, t: Date.now() });
      playSound('msg', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const deleteForMe = () => {
    if (!selMsg) return;
    const h = [...hidden, selMsg.key];
    setHidden(h);
    try { localStorage.setItem('nexdare_hidden_' + chatCode, JSON.stringify(h)); } catch (e) {}
    setSelMsg(null);
  };
  const deleteForAll = async () => {
    if (!selMsg || !ident || selMsg.sid !== ident.sid) return;
    try { await remove(ref(db, 'chats/' + chatCode + '/messages/' + selMsg.key)); }
    catch (e) { setError('Error: ' + e.message); }
    setSelMsg(null);
  };
  const deleteChat = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await remove(ref(db, 'chats/' + chatCode)); }
    catch (e) { setError('Error: ' + e.message); return; }
    leaveChat();
  };
  const saveChat = async () => {
    const lines = visible.map(
      (m) => '[' + new Date(m.t).toLocaleString() + '] ' + (ident && m.sid === ident.sid ? t('you') : t('partner')) + ': ' + m.text
    );
    const body = 'Nexdare chat ' + chatCode + '\n\n' + lines.join('\n');
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([body], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nexdare-chat.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setNotice('Chat file mein save ho gayi.');
      } catch (e) { setError('Save nahi ho paya: ' + e.message); }
    } else {
      try { await Share.share({ message: body }); } catch (e) {}
    }
  };
  const startChatCall = () => {
    if (!shared) return;
    Linking.openURL('https://meet.jit.si/nexdare-' + shared.callHash);
  };

  const clearAllData = () => {
    try {
      localStorage.removeItem('nexdare_id_v1');
      localStorage.removeItem('nexdare_profile');
      localStorage.removeItem('nexdare_friends');
      localStorage.removeItem('nexdare_scores');
      localStorage.removeItem('nexdare_history');
      localStorage.removeItem('nexdare_sound');
      localStorage.removeItem('nexdare_notif');
      localStorage.removeItem('nexdare_uilang');
      localStorage.removeItem('nexdare_user');
      clearAuthTokens();
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('nexdare_hidden_') || k.startsWith('nexdare_daily_')) localStorage.removeItem(k);
      });
      sessionIdentity = null;
      setProfile({ name: '', bio: '', avatar: '😎', friendCode: randomId().slice(0, 8) });
      setFriends([]);
      setScoresHistory([]);
      setHistory([]);
      setDailyDone(false);
      setSoundOn(true);
      setNotifOn(false);
      setUiLang('en');
      setIsLoggedIn(false);
      setCurrentUser(null);
      setShowClearConfirm(false);
      setNotice(t('dataCleared'));
      playSound('success', true);
    } catch (e) {
      setError('Clear failed: ' + e.message);
    }
  };

  const addFriend = () => {
    const code = friendInput.trim().toLowerCase();
    if (!code || code.length < 4) return;
    if (friends.some((f) => f.code === code)) {
      setNotice('Already in friends list');
      return;
    }
    if (code === profile.friendCode) {
      setNotice('Cannot add yourself');
      return;
    }
    const next = [...friends, { code, name: code, added: Date.now() }];
    saveFriends(next);
    setFriendInput('');
    setNotice('Friend added!');
    playSound('success', soundOn);
  };

  const removeFriend = (code) => {
    saveFriends(friends.filter((f) => f.code !== code));
  };

  const getDaily = () => {
    const d = new Date().toDateString();
    let seed = 0;
    for (let i = 0; i < d.length; i++) seed = (seed * 31 + d.charCodeAt(i)) >>> 0;
    const tIdx = seed % truths.length;
    const dIdx = (seed * 7) % dares.length;
    return { truth: truths[tIdx], dare: dares[dIdx] };
  };

  const completeDaily = () => {
    const key = 'nexdare_daily_' + new Date().toDateString();
    localStorage.setItem(key, '1');
    setDailyDone(true);
    addScore({ date: new Date().toISOString(), p1: 2, p2: 0, role: 'Daily', name: profile.name || 'You', bonus: true });
    addCloudPoints(2, { game: false, won: false });
    setNotice(t('bonus'));
    playSound('success', soundOn);
    showNotif('Nexdare', 'Daily Challenge completed! +2 points', notifOn);
  };

  const requestNotif = async () => {
    if (typeof Notification === 'undefined') {
      setNotice('Notifications not supported');
      return;
    }
    const perm = await Notification.requestPermission();
    const on = perm === 'granted';
    setNotifOn(on);
    localStorage.setItem('nexdare_notif', on ? '1' : '0');
    if (on) showNotif('Nexdare', 'Notifications enabled!', true);
  };

  const renderRoom = () => {
    if (!room) return <Text style={s.bt}>Loading...</Text>;
    const me = role;
    const callBtn = room.callId ? (
      <Btn label={t('videoCall')} onPress={() => Linking.openURL('https://meet.jit.si/' + room.callId)} />
    ) : null;

    if (room.stage === 'lobby') {
      return (
        <>
          <Text style={s.bt}>{t('roomCode')}</Text>
          <Text style={[s.code, { color: th.accent2 }]}>{roomCode}</Text>
          <Text style={s.sm}>{t('waitingPartner')}</Text>
          <Nav label={t('back')} onPress={leave} />
        </>
      );
    }

    if (room.stage === 'flip') {
      return (
        <>
          <Text style={s.sm}>{t('youAre')} {me}</Text>
          {me === 'P1' && !room.result && (
            <>
              <Text style={s.bt}>{t('chooseSide')}</Text>
              <Btn label={(room.pick === 'Heads' ? '✅ ' : '') + 'Heads'} onPress={() => choose('Heads')} />
              <Btn label={(room.pick === 'Tails' ? '✅ ' : '') + 'Tails'} onPress={() => choose('Tails')} />
              {room.pick && <Btn label={t('flip')} onPress={flip} />}
            </>
          )}
          {me === 'P2' && !room.result && (
            <Text style={s.bt}>{t('waitingFlip')}{room.pick ? ' (P1 chose ' + room.pick + ')' : ''}</Text>
          )}
          {room.result && (
            <>
              <Text style={s.t}>{t('result')} {room.result}</Text>
              <Text style={s.bt}>{room.asker} {t('firstAsk')}</Text>
              {me === 'P1' && <Btn label={t('startBattle')} onPress={startBattle} />}
              {me === 'P2' && <Text style={s.sm}>P1 will start the battle...</Text>}
            </>
          )}
          {callBtn}
        </>
      );
    }

    if (room.stage === 'game') {
      const answerer = room.asker === 'P1' ? 'P2' : 'P1';
      const iAsk = me === room.asker;
      return (
        <ScrollView style={s.gameScroll} contentContainerStyle={s.gameInner}>
          <Text style={s.sm}>
            {t('youAre')} {me}  •  {rshared ? t('encrypted') : subtle ? t('encryptionPending') : t('needBrowser')}
          </Text>
          <Text style={s.bt}>P1: {room.scores.P1}   |   P2: {room.scores.P2}</Text>
          <Text style={s.sm}>{room.asker} {t('asker')}, {answerer} {t('answerer')}</Text>

          {!room.question && (iAsk ? (
            customMode ? (
              <>
                <TextInput style={s.i2} placeholder="Write your question or dare"
                  value={customText} onChangeText={setCustomText} multiline />
                <Btn label={t('send')} onPress={sendCustom} />
                <Nav label={t('cancel')} onPress={() => setCustomMode(false)} />
              </>
            ) : (
              <>
                <Btn label={t('truth')} onPress={() => ask('Truth')} />
                <Btn label={t('dare')} onPress={() => ask('Dare')} />
                <Btn label={t('customQ')} onPress={() => setCustomMode(true)} />
              </>
            )
          ) : (
            <Text style={s.sm}>{room.asker} {t('waitingQ')}</Text>
          ))}

          {room.question && (
            <>
              <Text style={[s.q, { color: th.accent2 }]}>{room.question.kind}: {room.question.text}</Text>

              {replyPlain && (
                <View style={s.replyBox}>
                  <Text style={s.bname}>{replyPlain.from === me ? t('yourAnswer') : t('partnerAnswer')}</Text>
                  {!!replyPlain.text && <Text style={s.btext}>{replyPlain.text}</Text>}
                  {!!replyPic && <RNImage source={{ uri: replyPic }} style={s.pic} resizeMode="contain" />}
                  {replyPlain.hasImg && !replyPic && <Text style={s.sm}>Pic loading...</Text>}
                </View>
              )}

              {!iAsk && !replyPlain && (subtle ? (
                <>
                  <TextInput style={s.i2} placeholder={t('writeAnswer')}
                    value={replyText} onChangeText={setReplyText} multiline />
                  {!!replyImg && <RNImage source={{ uri: replyImg }} style={s.picSmall} resizeMode="cover" />}
                  <Nav label={replyImg ? t('changePic') : t('pickPic')} onPress={pickImage} />
                  <Btn label={t('sendAnswer')} onPress={sendReply} />
                </>
              ) : (
                <Text style={s.sm}>{t('needBrowser')}</Text>
              ))}

              {iAsk ? (
                <>
                  {!replyPlain && <Text style={s.sm}>{t('waitAnswer')}</Text>}
                  <Btn label={t('donePlus')} onPress={() => judge(1)} />
                  <Btn label={t('failedMinus')} onPress={() => judge(-1)} />
                </>
              ) : (
                <Text style={s.sm}>Answer or perform! {room.asker} will decide.</Text>
              )}
            </>
          )}

          {callBtn}
          <Nav label={t('endGame')} onPress={endGame} />
        </ScrollView>
      );
    }

    return (
      <>
        <Text style={s.t}>{t('gameOver')}</Text>
        <Text style={s.bt}>P1: {room.scores.P1}   |   P2: {room.scores.P2}</Text>
        <Text style={[s.q, { color: th.accent2 }]}>
          {room.scores.P1 > room.scores.P2 ? 'P1 ' + t('won') : room.scores.P2 > room.scores.P1 ? 'P2 ' + t('won') : t('draw')}
        </Text>
        <Btn label={t('newGame')} onPress={leave} />
      </>
    );
  };

  let title = 'Nexdare 💘';
  if (screen === 'adlax') title = 'Adlax 🔎';
  else if (screen === 'chat') title = 'Chat 💬';
  else if (screen === 'home') title = page === 1 ? null : page === 2 ? 'Let the battle begin' : 'Make it special';
  else if (screen === 'profile') title = t('profile');
  else if (screen === 'friends') title = t('friends');
  else if (screen === 'leaderboard') title = t('leaderboard');
  else if (screen === 'daily') title = t('daily');
  else if (screen === 'settings') title = t('settings');
  else if (screen === 'dm') title = null;

  const inChat = screen === 'chat' && !!chatCode;
  const inDm = screen === 'dm';
  const needUsername = isLoggedIn && !!currentUser && !currentUser.username;
  const myUid = currentUser ? currentUser.uid : null;
  const inAdlax = screen === 'adlax';
  const inGame = screen === 'room' && !!room && room.stage === 'game';
  const myId = ident ? ident.sid : null;

  return (
    <View style={[s.c, { backgroundColor: th.bg }, inChat || inDm || inAdlax || inGame || ['profile','friends','leaderboard','daily','settings'].includes(screen) ? s.cTop : null]}>
      <View pointerEvents="none" style={[s.glow, { top: -90, right: -70, backgroundColor: th.glow }]} />
      <View pointerEvents="none" style={[s.glow2, { bottom: -110, left: -80, backgroundColor: th.glow2 }]} />
      {!inChat && !inGame && !inDm && (
        <View pointerEvents="none" style={s.floatWrap}>
          <Text style={[s.floaty, { top: 70, left: 22, fontSize: 30 }]}>{th.e[0]}</Text>
          <Text style={[s.floaty, { top: 150, right: 24, fontSize: 24 }]}>{th.e[1]}</Text>
          <Text style={[s.floaty, { bottom: 80, right: 28, fontSize: 34 }]}>{th.e[2]}</Text>
          <Text style={[s.floaty, { bottom: 150, left: 22, fontSize: 24 }]}>{th.e[0]}</Text>
        </View>
      )}

      {/* ========== AUTH SCREEN (email + password) ========== */}
      {!isLoggedIn ? (
        <View style={{ width: '100%', alignItems: 'center', paddingHorizontal: 24, zIndex: 10 }}>
          <Text style={[s.welcome, { color: th.accent2 }]}>Nexdare</Text>
          {authStep === 'verify' ? (
            <>
              <Text style={[s.q, { color: th.accent2 }]}>📧 Email verify karo</Text>
              <Text style={[s.sm, { marginBottom: 16 }]}>
                Humne {pendingEmail} pe ek link bheji hai. Mail kholo (Spam/Promotions bhi dekho), link pe tap karo, phir neeche button dabao.
              </Text>
              <Btn
                label={authLoading ? 'Check ho raha...' : 'Maine verify kar liya ✅'}
                onPress={checkVerified}
              />
              <Nav label="📩 Mail dobara bhejo" onPress={resendVerify} />
              <Nav label="← Wapas" onPress={backToForm} />
            </>
          ) : (
            <>
              {Platform.OS === 'web' && (
                <>
                  <Btn
                    label={authLoading ? 'Ruko...' : '🔵 Google se Login'}
                    onPress={googleLogin}
                  />
                  <View style={{ height: 14 }} />
                </>
              )}
              <TextInput
                style={s.i}
                placeholder="Email"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={s.i}
                placeholder="Password"
                secureTextEntry
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
              />
              <Btn
                label={authLoading ? 'Ruko...' : authMode === 'login' ? 'Login' : 'Account banao'}
                onPress={submitAuth}
              />
              <Nav
                label={authMode === 'login' ? 'Naya account banao' : 'Pehle se account hai? Login'}
                onPress={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setError(''); }}
              />
              {authMode === 'login' && <Nav label="Password bhool gaye?" onPress={forgotPassword} />}
            </>
          )}
          {!!error && <Text style={[s.sm, { color: '#ff6b6b', marginTop: 14 }]}>{error}</Text>}
          {!!notice && <Text style={[s.sm, { color: th.accent2, marginTop: 12 }]}>{notice}</Text>}
        </View>
      ) : needUsername ? (
        <View style={{ width: '100%', alignItems: 'center', paddingHorizontal: 24, zIndex: 10 }}>
          <Text style={[s.welcome, { color: th.accent2 }]}>Nexdare</Text>
          <Text style={[s.q, { color: th.accent2, marginBottom: 12 }]}>Username</Text>
          <TextInput
            style={s.i}
            placeholder="Username"
            autoCapitalize="none"
            value={usernameInput}
            onChangeText={setUsernameInput}
          />
          <Btn label={authLoading ? 'Ruko...' : 'Save'} onPress={claimUsername} />
          <Nav label={t('logout')} onPress={logout} />
          {!!error && <Text style={[s.sm, { color: '#ff6b6b', marginTop: 14 }]}>{error}</Text>}
          {!!notice && <Text style={[s.sm, { color: th.accent2, marginTop: 12 }]}>{notice}</Text>}
        </View>
      ) : (
        <>
          {!!title && !inChat && !inGame && !inDm && (
            <Text style={inAdlax ? s.tSmall : screen === 'home' ? s.tStyled : s.t}>{title}</Text>
          )}

          {screen === 'home' && page === 1 && (
            <>
              <Text style={[s.welcome, { color: th.accent2 }]}>{t('welcome')}</Text>
              <View style={[s.rule, { backgroundColor: th.accent }]} />
              <Text style={[s.logo, { color: th.accent2, textShadowColor: th.accent }]}>Nexdare</Text>
              <Btn big label={t('start')} onPress={() => setPage(2)} />
              {dots(1)}
            </>
          )}

          {screen === 'home' && page === 2 && (
            <>
              <Btn label={t('createRoom')} onPress={createRoom} />
              <Btn label={t('joinRoom')} onPress={() => { setError(''); setScreen('join'); }} />
              <Nav label={t('next')} onPress={() => setPage(3)} />
              <Nav label={t('back')} onPress={() => setPage(1)} />
              {dots(2)}
            </>
          )}

          {screen === 'home' && page === 3 && (
            <>
              <Btn label={t('adlax')} onPress={() => { setError(''); setScreen('adlax'); }} />
              <Btn label={t('chat')} onPress={() => { setError(''); setNotice(''); setScreen('chat'); }} />
              <Btn label={t('daily')} onPress={() => setScreen('daily')} />
              <Btn label={t('profile')} onPress={() => setScreen('profile')} />
              <Btn label={t('friends')} onPress={() => setScreen('friends')} />
              <Btn label={t('leaderboard')} onPress={() => setScreen('leaderboard')} />
              <Btn label={t('settings')} onPress={() => setScreen('settings')} />
              <Nav label={t('back')} onPress={() => setPage(2)} />
              {dots(3)}
            </>
          )}

          {screen === 'join' && (
            <>
              <TextInput style={s.i} placeholder="Room code" keyboardType="number-pad"
                value={joinCode} onChangeText={setJoinCode} />
              <Btn label={t('join')} onPress={joinRoom} />
              <Nav label={t('back')} onPress={leave} />
            </>
          )}

          {screen === 'room' && renderRoom()}

          {inAdlax && (
            <>
              <View style={s.modeRow}>
                <TouchableOpacity
                  style={[s.modeBtn, adMode === 'ai' ? { backgroundColor: th.accent } : null]}
                  onPress={() => setAdMode('ai')}
                >
                  <Text style={s.modeT}>✦ AI</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.modeBtn, adMode === 'search' ? { backgroundColor: th.accent } : null]}
                  onPress={() => setAdMode('search')}
                >
                  <Text style={s.modeT}>🔎 Search</Text>
                </TouchableOpacity>
              </View>

              {adMode === 'ai' ? (
                <>
                  <ScrollView
                    ref={aiScrollRef}
                    style={s.msgBox}
                    onContentSizeChange={() => aiScrollRef.current && aiScrollRef.current.scrollToEnd({ animated: true })}
                  >
                    {aiMsgs.length === 0 && (
                      <Text style={s.sm}>Ask anything, Adlax AI will answer.</Text>
                    )}
                    {aiMsgs.map((m, i) => (
                      <View
                        key={i}
                        style={[s.bubble, m.role === 'user' ? [s.mine, { backgroundColor: th.accent }] : s.theirs]}
                      >
                        <Text style={s.btext}>{m.content}</Text>
                      </View>
                    ))}
                    {aiBusy && <Text style={s.sm}>{t('thinking')}</Text>}
                  </ScrollView>
                  <View style={s.sendRow}>
                    <TextInput style={s.msgInput} placeholder={t('aiPlaceholder')}
                      value={aiInput} onChangeText={setAiInput} onSubmitEditing={askAI} />
                    <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={askAI}>
                      <Text style={s.bt}>➤</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={s.miniRow}>
                    <Mini label={t('clear')} onPress={() => setAiMsgs([])} />
                    <Mini label={t('back')} onPress={backToTools} />
                  </View>
                </>
              ) : detail ? (
                <>
                  <ScrollView style={s.msgBox}>
                    <Text style={[s.q, { color: th.accent2 }]}>{detail.title}</Text>
                    <Text style={s.btext}>{detail.text}</Text>
                    <Text style={s.sm}>{t('sourceWiki')}</Text>
                  </ScrollView>
                  <Btn
                    label={t('fullPage')}
                    onPress={() => {
                      const wikiLang = uiLang === 'hi' ? 'hi' : uiLang === 'es' ? 'es' : uiLang === 'fr' ? 'fr' : 'en';
                      Linking.openURL('https://' + wikiLang + '.wikipedia.org/?curid=' + detail.id);
                    }}
                  />
                  <Nav label={t('results')} onPress={() => setDetail(null)} />
                </>
              ) : (
                <>
                  <TextInput style={s.i2} placeholder="Search anything..."
                    value={query} onChangeText={setQuery} onSubmitEditing={() => doSearch()} />
                  <Btn label="Search" onPress={() => doSearch()} />
                  <Nav
                    label={incognito ? t('incognitoOn') : t('incognitoOff')}
                    onPress={() => setIncognito((v) => !v)}
                  />
                  <ScrollView style={s.msgBox}>
                    {searching && <Text style={s.sm}>{t('searching')}</Text>}
                    {!searching && searched && results.length === 0 && <Text style={s.sm}>{t('nothingFound')}</Text>}
                    {results.map((r) => (
                      <TouchableOpacity key={r.id} style={[s.card, { borderColor: th.accent + '55' }]} onPress={() => openResult(r)}>
                        <Text style={[s.cardT, { color: th.accent2 }]}>{r.title}</Text>
                        <Text style={s.cardS}>{r.snippet}</Text>
                      </TouchableOpacity>
                    ))}
                    {!searched && !incognito && history.length > 0 && (
                      <>
                        <Text style={s.sm}>{t('recent')}</Text>
                        {history.map((h) => (
                          <TouchableOpacity key={h} onPress={() => doSearch(h)}>
                            <Text style={[s.hist, { color: th.accent2 }]}>🕘 {h}</Text>
                          </TouchableOpacity>
                        ))}
                        <Nav label={t('clearHistory')} onPress={() => { setHistory([]); localStorage.removeItem('nexdare_history'); }} />
                      </>
                    )}
                  </ScrollView>
                  <Nav label={t('back')} onPress={backToTools} />
                </>
              )}
            </>
          )}

          {screen === 'chat' && !chatCode && (
            subtle ? (
              <>
                <Btn label={t('newChat')} onPress={createChat} />
                <TextInput style={s.i} placeholder={t('chatCode')} autoCapitalize="none"
                  value={chatJoin} onChangeText={setChatJoin} />
                <Btn label={t('joinChat')} onPress={joinChat} />
                <Nav label={t('back')} onPress={backToTools} />
              </>
            ) : (
              <>
                <Text style={s.sm}>{t('needBrowserChat')}</Text>
                <Nav label={t('back')} onPress={backToTools} />
              </>
            )
          )}

          {inChat && (chatFull ? (
            <>
              <Text style={s.sm}>{t('chatFull')}</Text>
              <Nav label={t('back')} onPress={leaveChat} />
            </>
          ) : chatData && chatData.gone ? (
            <>
              <Text style={s.sm}>{t('chatDeleted')}</Text>
              <Nav label={t('back')} onPress={leaveChat} />
            </>
          ) : (
            <>
              <Text style={[s.code2, { color: th.accent2 }]}>{chatCode}</Text>
              <Text style={s.sm}>
                {shared ? t('e2e') + shared.safety : t('waitPartner')}
              </Text>
              <View style={s.miniRow}>
                {!!shared && <Mini label={t('videoCall')} onPress={startChatCall} />}
                <Mini label={t('saveChat')} onPress={saveChat} />
                <Mini label={confirmDel ? t('confirmDelete') : t('deleteChat')} onPress={deleteChat} />
              </View>
              <ScrollView
                ref={scrollRef}
                style={s.msgBox}
                onContentSizeChange={() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true })}
              >
                {visible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
                {visible.map((m) => {
                  const mine = myId && m.sid === myId;
                  const sel = selMsg && selMsg.key === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      onPress={() => setSelMsg(sel ? null : m)}
                      style={[
                        s.bubble,
                        mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs,
                        sel ? s.selBubble : null,
                      ]}
                    >
                      <Text style={s.bname}>{mine ? t('you') : t('partner')}</Text>
                      <Text style={s.btext}>{m.text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {!!selMsg && (
                <View style={s.miniRow}>
                  <Mini label={t('deleteForMe')} onPress={deleteForMe} />
                  {selMsg.sid === myId && <Mini label={t('deleteForAll')} onPress={deleteForAll} />}
                  <Mini label={t('cancel')} onPress={() => setSelMsg(null)} />
                </View>
              )}
              <View style={s.sendRow}>
                <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')}
                  value={msgText} onChangeText={setMsgText} onSubmitEditing={sendMsg} />
                <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendMsg}>
                  <Text style={s.bt}>➤</Text>
                </TouchableOpacity>
              </View>
              <Nav label={t('leaveChat')} onPress={leaveChat} />
            </>
          ))}

          {screen === 'profile' && (
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, width: '100%' }}>
              <Text style={[s.code2, { color: th.accent2, fontSize: 48 }]}>{profile.avatar}</Text>
              <Text style={s.sm}>Username: @{currentUser ? currentUser.username : ''}</Text>
              {currentUser && <Text style={s.sm}>📧 {currentUser.email}</Text>}
              <TextInput style={s.i} placeholder={t('name')} value={profile.name}
                onChangeText={(v) => setProfile({ ...profile, name: v })} />
              <TextInput style={s.i2} placeholder={t('bio')} value={profile.bio}
                onChangeText={(v) => setProfile({ ...profile, bio: v })} multiline />
              <TextInput style={s.i} placeholder={t('avatar')} value={profile.avatar}
                onChangeText={(v) => setProfile({ ...profile, avatar: v })} maxLength={2} />
              <Btn label={t('save')} onPress={() => { saveProfile(profile); setNotice('Profile saved!'); playSound('success', soundOn); }} />
              <Nav label={t('back')} onPress={() => setScreen('home')} />
            </ScrollView>
          )}

          {screen === 'friends' && (
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, width: '100%' }}>
              <Text style={s.sm}>Tumhara username</Text>
              <Text style={[s.code2, { color: th.accent2 }]}>@{currentUser ? currentUser.username : ''}</Text>
              <Mini label="📋 Copy" onPress={() => copyText('@' + (currentUser ? currentUser.username : ''))} />
              {!!pubError && <Text style={[s.sm, { color: '#ff6b6b' }]}>{pubError}</Text>}

              <TextInput style={s.i} placeholder="Friend ka username" autoCapitalize="none"
                value={reqName} onChangeText={setReqName} />
              <Btn label="Request bhejo 📩" onPress={sendFriendRequest} />

              {Object.keys(friendReqs).length > 0 && (
                <>
                  <Text style={[s.q, { color: th.accent2 }]}>Friend requests</Text>
                  {Object.keys(friendReqs).map((k) => {
                    const r = friendReqs[k];
                    return (
                      <View key={k} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
                        <Text style={[s.cardT, { color: th.accent2 }]}>{(r.avatar || '😎') + ' ' + (r.name || r.username)}</Text>
                        <Text style={s.cardS}>@{r.username}</Text>
                        <View style={s.miniRow}>
                          <Mini label="Accept ✅" onPress={() => acceptRequest(r)} />
                          <Mini label="Reject" onPress={() => declineRequest(r)} />
                        </View>
                      </View>
                    );
                  })}
                </>
              )}

              <Text style={[s.q, { color: th.accent2 }]}>Friends</Text>
              {Object.keys(cloudFriends).length === 0 ? (
                <Text style={s.sm}>{t('noFriends')}</Text>
              ) : (
                Object.keys(cloudFriends).map((k) => {
                  const f = cloudFriends[k];
                  return (
                    <View key={k} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
                      <Text style={[s.cardT, { color: th.accent2 }]}>{(f.avatar || '😎') + ' ' + (f.name || f.username)}</Text>
                      <Text style={s.cardS}>@{f.username}</Text>
                      <View style={s.miniRow}>
                        <Mini label="💬 Chat" onPress={() => openDm(f)} />
                        <Mini label={t('remove')} onPress={() => removeCloudFriend(f)} />
                      </View>
                    </View>
                  );
                })
              )}
              <Nav label={t('back')} onPress={() => setScreen('home')} />
            </ScrollView>
          )}

          {screen === 'dm' && dmFriend && (
            subtle ? (
              <>
                <Text style={[s.code2, { color: th.accent2 }]}>{(dmFriend.avatar || '😎') + ' ' + (dmFriend.name || dmFriend.username)}</Text>
                <Text style={s.sm}>
                  {dmShared
                    ? t('e2e') + dmShared.safety
                    : !ident
                      ? '⏳ Aapki encryption key ban rahi hai...'
                      : (!dmPubStr || dmPubStr === 'null')
                        ? '⏳ @' + dmFriend.username + ' ki encryption key abhi nahi mili. Unhe site kholkar Friends screen par aane ko bolo.'
                        : '⚠️ Encryption key match nahi hui'}
                </Text>
                {!!pubError && <Text style={[s.sm, { color: '#ff6b6b' }]}>{pubError}</Text>}
                <ScrollView
                  ref={dmScrollRef}
                  style={s.msgBox}
                  onContentSizeChange={() => dmScrollRef.current && dmScrollRef.current.scrollToEnd({ animated: true })}
                >
                  {dmVisible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
                  {dmVisible.map((m) => {
                    const mine = myUid && m.from === myUid;
                    const sel = dmSel && dmSel.key === m.key;
                    return (
                      <TouchableOpacity
                        key={m.key}
                        onPress={() => setDmSel(sel ? null : m)}
                        style={[
                          s.bubble,
                          mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs,
                          sel ? s.selBubble : null,
                        ]}
                      >
                        <Text style={s.bname}>{mine ? t('you') : (dmFriend.name || dmFriend.username)}</Text>
                        {!!m.file && m.file.type && m.file.type.indexOf('image/') === 0 && (
                          dmImgs[m.file.id] && dmImgs[m.file.id] !== 'ERR' ? (
                            <RNImage source={{ uri: dmImgs[m.file.id] }} style={s.dmPic} resizeMode="cover" />
                          ) : (
                            <Text style={s.btext}>{dmImgs[m.file.id] === 'ERR' ? '🖼️ Photo khul nahi payi' : '🖼️ Photo load ho rahi hai...'}</Text>
                          )
                        )}
                        {!!m.file && !(m.file.type && m.file.type.indexOf('image/') === 0) && (
                          <Text style={s.btext}>📎 {m.file.name} ({fmtSize(m.file.size)})</Text>
                        )}
                        {!!m.file && (
                          <TouchableOpacity onPress={() => downloadDmFile(m.file)}>
                            <Text style={[s.bname, { marginTop: 4, textDecorationLine: 'underline' }]}>⬇️ Download</Text>
                          </TouchableOpacity>
                        )}
                        {!!m.text && <Text style={s.btext}>{m.text}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                {!!dmSel && (
                  <View style={s.miniRow}>
                    <Mini label={t('deleteForMe')} onPress={dmDeleteForMe} />
                    {dmSel.from === myUid && <Mini label={t('deleteForAll')} onPress={dmDeleteForAll} />}
                    <Mini label={t('cancel')} onPress={() => setDmSel(null)} />
                  </View>
                )}
                {dmBusy && <Text style={s.sm}>⏳ File bhej raha hoon...</Text>}
                <View style={s.sendRow}>
                  <TouchableOpacity style={s.attachBtn} onPress={pickDmFile}>
                    <Text style={s.bt}>📎</Text>
                  </TouchableOpacity>
                  <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')}
                    value={dmText} onChangeText={setDmText} onSubmitEditing={sendDm} />
                  <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendDm}>
                    <Text style={s.bt}>➤</Text>
                  </TouchableOpacity>
                </View>
                <Nav label={t('back')} onPress={leaveDm} />
              </>
            ) : (
              <>
                <Text style={s.sm}>{t('needBrowserChat')}</Text>
                <Nav label={t('back')} onPress={leaveDm} />
              </>
            )
          )}

          {screen === 'leaderboard' && (
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, width: '100%' }}>
              <View style={s.miniRow}>
                <Mini label={(boardTab === 'global' ? '✅ ' : '') + '🌍 Global'} onPress={() => setBoardTab('global')} />
                <Mini label={(boardTab === 'mine' ? '✅ ' : '') + '📱 Mere games'} onPress={() => setBoardTab('mine')} />
                {boardTab === 'global' && <Mini label="🔄" onPress={loadBoard} />}
              </View>
              {boardTab === 'global' ? (
                globalBoard.length === 0 ? (
                  <Text style={s.sm}>{boardLoading ? 'Load ho raha hai...' : 'Abhi koi score nahi'}</Text>
                ) : (
                  globalBoard.map((b, i) => (
                    <View key={b.uid} style={[s.card, { borderColor: b.uid === myUid ? th.accent : th.accent + '55', width: '90%' }]}>
                      <Text style={[s.cardT, { color: th.accent2 }]}>
                        {'#' + (i + 1) + '  ' + (b.avatar || '😎') + ' ' + (b.name || b.username) + (b.uid === myUid ? ' (tum)' : '')}
                      </Text>
                      <Text style={s.cardS}>@{b.username} • {b.points || 0} points • {b.games || 0} games • {b.wins || 0} jeet</Text>
                    </View>
                  ))
                )
              ) : scoresHistory.length === 0 ? (
                <Text style={s.sm}>No games yet</Text>
              ) : (
                scoresHistory.slice(0, 20).map((sc, i) => (
                  <View key={i} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
                    <Text style={[s.cardT, { color: th.accent2 }]}>
                      {sc.name || sc.role} {sc.bonus ? '⭐' : ''}
                    </Text>
                    <Text style={s.cardS}>
                      P1: {sc.p1} | P2: {sc.p2} • {new Date(sc.date).toLocaleDateString()}
                    </Text>
                  </View>
                ))
              )}
              <Nav label={t('back')} onPress={() => setScreen('home')} />
            </ScrollView>
          )}

          {screen === 'daily' && (
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, width: '100%' }}>
              {(() => {
                const d = getDaily();
                return (
                  <>
                    <Text style={[s.q, { color: th.accent2 }]}>{t('dailyTruth')}</Text>
                    <Text style={s.btext}>{d.truth}</Text>
                    <Text style={[s.q, { color: th.accent2, marginTop: 20 }]}>{t('dailyDare')}</Text>
                    <Text style={s.btext}>{d.dare}</Text>
                    {dailyDone ? (
                      <Text style={[s.sm, { marginTop: 20 }]}>{t('completed')}</Text>
                    ) : (
                      <Btn label={t('complete')} onPress={completeDaily} />
                    )}
                  </>
                );
              })()}
              <Nav label={t('back')} onPress={() => setScreen('home')} />
            </ScrollView>
          )}

          {screen === 'settings' && (
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40, width: '100%' }}>
              <Text style={s.sm}>{t('language')}</Text>
              <View style={s.miniRow}>
                {['en', 'hi', 'es', 'fr'].map((l) => (
                  <Mini key={l} label={l.toUpperCase()} onPress={() => {
                    setUiLang(l);
                    localStorage.setItem('nexdare_uilang', l);
                  }} />
                ))}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
                <Text style={[s.sm, { marginRight: 12 }]}>{t('sound')}</Text>
                <Switch value={soundOn} onValueChange={(v) => {
                  setSoundOn(v);
                  localStorage.setItem('nexdare_sound', v ? '1' : '0');
                }} />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
                <Text style={[s.sm, { marginRight: 12 }]}>{t('notifications')}</Text>
                <Switch value={notifOn} onValueChange={(v) => {
                  if (v) requestNotif();
                  else {
                    setNotifOn(false);
                    localStorage.setItem('nexdare_notif', '0');
                  }
                }} />
              </View>

              <Btn label={t('logout')} onPress={logout} />

              {!showClearConfirm ? (
                <Btn label={t('clearData')} onPress={() => setShowClearConfirm(true)} />
              ) : (
                <>
                  <Text style={s.sm}>{t('clearConfirm')}</Text>
                  <Btn label={t('yesClear')} onPress={clearAllData} />
                  <Nav label={t('cancel')} onPress={() => setShowClearConfirm(false)} />
                </>
              )}

              <Nav label={t('back')} onPress={() => setScreen('home')} />
            </ScrollView>
          )}

          {!!error && isLoggedIn && <Text style={[s.sm, { color: '#ff6b6b', marginTop: 10 }]}>{error}</Text>}
          {!!notice && isLoggedIn && <Text style={[s.sm, { color: th.accent2, marginTop: 8 }]}>{notice}</Text>}
        </>
      )}
    </View>
  );
}

// ---- Styles ----
const s = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  cTop: { justifyContent: 'flex-start', paddingTop: 50 },
  glow: { position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.25 },
  glow2: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.2 },
  floatWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  floaty: { position: 'absolute', opacity: 0.35 },
  welcome: { fontSize: 18, letterSpacing: 6, fontWeight: '600', marginBottom: 8 },
  rule: { width: 60, height: 3, borderRadius: 2, marginBottom: 12 },
  logo: { fontSize: 42, fontWeight: '800', marginBottom: 30, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  t: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 16, textAlign: 'center' },
  tStyled: { fontSize: 22, fontWeight: '600', color: '#fff', marginBottom: 20, textAlign: 'center', opacity: 0.9 },
  tSmall: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  bt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btBig: { fontSize: 20 },
  b: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, marginVertical: 8, minWidth: 220, alignItems: 'center', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  bBig: { paddingVertical: 18, minWidth: 240 },
  nav: { borderWidth: 1.5, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 22, marginVertical: 6 },
  navt: { fontSize: 15, fontWeight: '600' },
  mini: { borderWidth: 1, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, marginHorizontal: 4 },
  miniT: { fontSize: 13, fontWeight: '600' },
  miniRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginVertical: 8 },
  dotRow: { flexDirection: 'row', marginTop: 28 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffffff44', marginHorizontal: 4 },
  code: { fontSize: 42, fontWeight: '800', letterSpacing: 8, marginVertical: 12 },
  code2: { fontSize: 22, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  sm: { color: '#ffffffbb', fontSize: 14, textAlign: 'center', marginVertical: 6, paddingHorizontal: 10 },
  i: { backgroundColor: '#ffffff18', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, color: '#fff', fontSize: 16, width: '85%', marginVertical: 8, textAlign: 'center' },
  i2: { backgroundColor: '#ffffff18', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, color: '#fff', fontSize: 15, width: '90%', marginVertical: 8, minHeight: 80, textAlignVertical: 'top' },
  q: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginVertical: 10, paddingHorizontal: 12 },
  gameScroll: { width: '100%', maxHeight: '80%' },
  gameInner: { alignItems: 'center', paddingBottom: 30 },
  replyBox: { backgroundColor: '#ffffff15', borderRadius: 16, padding: 14, marginVertical: 10, width: '90%' },
  bname: { color: '#ffffff99', fontSize: 12, marginBottom: 4 },
  btext: { color: '#fff', fontSize: 15, lineHeight: 22 },
  pic: { width: '100%', height: 180, borderRadius: 12, marginTop: 8 },
  picSmall: { width: 120, height: 120, borderRadius: 12, marginVertical: 8 },
  modeRow: { flexDirection: 'row', marginBottom: 12 },
  modeBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20, marginHorizontal: 6, backgroundColor: '#ffffff15' },
  modeT: { color: '#fff', fontWeight: '600', fontSize: 14 },
  msgBox: { width: '100%', maxHeight: 320, marginVertical: 8 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginVertical: 4, marginHorizontal: 8 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#ffffff18', borderBottomLeftRadius: 4 },
  selBubble: { borderWidth: 2, borderColor: '#fff' },
  sendRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 8 },
  msgInput: { flex: 1, backgroundColor: '#ffffff18', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, color: '#fff', fontSize: 15, marginRight: 8 },
  attachBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff18', marginRight: 8 },
  dmPic: { width: 220, height: 220, borderRadius: 12, marginBottom: 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#ffffff12', borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 1 },
  cardT: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardS: { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
  hist: { fontSize: 14, marginVertical: 4 },
});
