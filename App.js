import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Linking, ScrollView, Platform, Share, Image as RNImage, Switch, Animated, Easing
} from 'react-native';

if (typeof localStorage === 'undefined') {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}

const FIREBASE_API_KEY = 'AIzaSyCOon-MP5tYqOgBDOjkodb_4vKHMVyBEPk';

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
  let inFlight = false;
  let hasLastValue = false;
  let skipN = 0;
  let lastSerialized = '';
  const poll = async () => {
    if (stopped || inFlight) return;
    if (typeof document !== 'undefined' && document.hidden && (skipN++ % 6) !== 0) return;
    inFlight = true;
    try {
      const val = await call('GET', r.path, undefined, r.query);
      if (stopped) return;
      const serialized = JSON.stringify(val);
      // Match Firebase onValue behavior: notify React only when data changes.
      if (!hasLastValue || serialized !== lastSerialized) {
        hasLastValue = true;
        lastSerialized = serialized;
        cb({ val: () => val });
      }
    } catch (e) {
    } finally {
      inFlight = false;
    }
  };
  listeners.add(poll);
  poll();
  const timer = setInterval(poll, 600);
  return () => { stopped = true; clearInterval(timer); listeners.delete(poll); };
};

const randomId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
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

const translations = {
  en: {
    welcome: 'WELCOME', start: '💘 Start', createRoom: '✦ Create a Room', joinRoom: '✦ Join a Room',
    next: 'Next ›', back: '‹ Back', chat: '👥 Group Chat',
    roomCode: 'Room code:', waitingPartner: 'Send this code to your partner, waiting...',
    youAre: 'You are', chooseSide: 'Choose your side 🪙', flip: 'Flip the coin!',
    result: 'Result:', firstAsk: 'will ask the first question 🎉', startBattle: 'Start Battle!',
    waitingFlip: 'P1 is flipping the coin...', asker: 'is asking', answerer: 'will answer',
    truth: 'Truth 💭', dare: 'Dare 😈', customQ: '📝 Write your own', send: 'Send 🚀',
    waitingQ: 'is choosing a question...', yourAnswer: 'Your answer', partnerAnswer: "Partner's answer",
    writeAnswer: 'Write your answer...', pickPic: '📷 Pick pic', changePic: '📷 Change pic',
    sendAnswer: 'Send answer 🚀', waitAnswer: 'Waiting for answer...',
    donePlus: 'Done / Told (+1) ✅', failedMinus: "Couldn't do (-1) ❌",
    endGame: 'End Game', gameOver: 'Game Over 🏁', won: 'won! 🏆', draw: 'Draw! 🤝',
    newGame: 'New Game', join: 'Join', roomNotFound: 'Room not found, check code', roomFull: 'Room is full',
    encrypted: '🔒 encrypted', encryptionPending: '⏳ encryption setting up...', needBrowser: 'browser required',
    clearData: '🗑️ Clear Data', profile: '👤 Profile', friends: '💌 Message', settings: '⚙️ Settings',
    save: 'Save', name: 'Name', bio: 'Bio', avatar: 'Avatar emoji',
    noFriends: 'No friends yet', remove: 'Remove', sound: 'Sound Effects', notifications: 'Notifications',
    clearConfirm: 'Clear all local data? This cannot be undone.', yesClear: 'Yes, Clear', cancel: 'Cancel',
    dataCleared: 'All local data cleared.',
    newChat: '➕ New Chat', joinChat: '🔑 Join Chat', chatCode: 'Chat code',
    chatFull: 'This chat is full (only 2 people).', chatDeleted: 'This chat has been deleted.',
    waitPartner: '⏳ Waiting for partner... share this code', e2e: '🔒 End-to-end encrypted • Safety code: ',
    videoCall: '📹 Video Call', saveChat: '💾 Save', deleteChat: 'Delete chat', confirmDelete: 'Sure? Tap again',
    noMsg: 'No messages yet. Send the first one! 👋', you: 'You', partner: 'Partner',
    deleteForMe: 'Delete for me', deleteForAll: 'Delete for everyone', leaveChat: '‹ Leave chat',
    msgPlaceholder: 'Type a message...', picOnlyWeb: 'Sending pics currently works only in browser.',
    needPartner: 'Wait for the other player to join and encryption.', needTextOrPic: 'Write an answer or pick a pic first.',
    needBrowserChat: 'Encryption needs a browser (Chrome). Chat is disabled on this device.',
    logout: '🚪 Logout',
  },
};

const themes = {
  p1: { bg: '#2a0a18', accent: '#ff4d8d', accent2: '#ffd1e3', glow: '#ff4d8d', glow2: '#8a1c4d', e: ['💖', '🌹', '✨'] },
  p2: { bg: '#24092a', accent: '#c850c0', accent2: '#f3c9ef', glow: '#c850c0', glow2: '#ff4d8d', e: ['💜', '🦋', '✨'] },
  p3: { bg: '#2b0f14', accent: '#ff7a8a', accent2: '#ffdadf', glow: '#ff7a8a', glow2: '#b0235a', e: ['🌹', '💌', '✨'] },
  room: { bg: '#2d0b16', accent: '#ff3d6e', accent2: '#ffc1d1', glow: '#ff3d6e', glow2: '#6a0f35', e: ['🔥', '💘', '💋'] },
  chat: { bg: '#2a0f24', accent: '#f06292', accent2: '#ffd9e6', glow: '#f06292', glow2: '#7b2d7f', e: ['💬', '🌙', '💌'] },
  settings: { bg: '#2a0d1f', accent: '#e8508a', accent2: '#f9cde0', glow: '#e8508a', glow2: '#7a1450', e: ['💞', '✨', '🌹'] },
};

const truths = [
  'Tumhe mere baare me sabse pehle kya pasand aaya tha?',
  'Kab laga ki tumhe mujhse pyaar ho gaya hai?',
  'Meri kaunsi aadat tumhe sabse cute lagti hai?',
  'Kya kabhi mujhe chhup kar dekha hai? Kab?',
  'Hamari pehli mulaqat me tum kya soch rahe the?',
  'Meri kaunsi cheez tumhe sabse zyada yaad aati hai jab hum door hote hain?',
  'Kya tumne kabhi mere liye koi sapna dekha hai? Kya tha?',
  'Mujhse kaunsi baat kehna chahte ho jo abhi tak keh nahi paye?',
  'Hum dono ka sabse favourite pal kaunsa raha hai?',
  'Kya tumhe kabhi mujhse jealousy hui hai? Kis baat par?',
  'Agar hum ek din ke liye kahin bhi ja sakein, to tum kahan jaoge?',
  'Mere kis gift ya surprise ne tumhe sabse zyada khush kiya?',
  'Tumhare hisaab se hamare rishte ki sabse khoobsurat baat kya hai?',
  'Kya tum mujhe kabhi miss karte ho jab main busy hota/hoti hoon?',
  'Meri kaunsi galti tum aaj bhi yaad rakhte ho?',
  'Tumhe mere saath kaunsi cheez karne me sabse zyada maza aata hai?',
  'Agar main kal se kuch badal doon, to tum kya chahoge ki main badlu?',
  'Kya tum mere saath future me ghar, shaadi ya trip ke baare me sochte ho?',
  'Tumhara mere liye sabse romantic idea kya hai?',
  'Kaun si ek baat hai jo tumhe meri sabse zyada pasand hai?',
  'Kya tumne kabhi mere naam ka koi nickname socha hai? Kya?',
  'Tumhe pehli baar mujhe hug karke kaisa laga tha?',
  'Kaunsa gaana sunte hi tumhe meri yaad aati hai?',
  'Agar main kisi din udaas ho jaun, to tum mujhe kaise khush karoge?',
  'Mujhse kabhi kuch chhupaya hai jo ab bata sakte ho?',
];
const dares = [
  'Mujhe ek pyaari si shayari suna do.',
  'Mere liye 10 second ka ek romantic dialogue bolo.',
  'Mujhe 3 cheezein batao jo tumhe mujhme sabse zyada pasand hain.',
  'Mujhe abhi ek sweet voice message ya line bhejo.',
  'Mere naam ka ek gaana gungunao.',
  'Apni ek purani photo bhejo jisme tum sabse cute lagte ho.',
  'Mujhe aankhon me dekh kar 10 second tak ek bhi baar hase bina "I love you" bolo.',
  'Mere liye ek chhoti si love letter 2 line me likho.',
  'Mujhe ek filmy romantic style me propose karo.',
  'Mere liye ek pyaara sa compliment do, jo tumne pehle kabhi nahi diya.',
  'Mujhe apni favourite yaad batao jo humne saath guzari ho.',
  'Ek heart emoji ke saath mujhe sabse sweet message likho.',
  'Mere liye ek chhoti si dance move karo.',
  'Mujhe 5 alag nicknames do jo tum mujhe bulane ke liye use kar sakte ho.',
  'Aankhein band karke batao ki main kaisa/kaisi dikhta/dikhti hoon.',
  'Mere saath ek selfie lo aur mujhe bhejo.',
  'Mujhe abhi ek pyaara sa promise do.',
  'Mujhe apni pasand ki ek romantic date plan karke batao.',
  'Mere bina tumhara din kaisa guzarta hai, 3 line me likho.',
  'Mujhe ek flying kiss emoji ke saath good night bolo.',
  'Mere liye 20 second tak sirf meri tareef karo.',
  'Mujhe ek romantic song ki ek line gaakar sunao.',
  'Mere naam se apne phone me ek cute contact name rakho aur screenshot bhejo.',
  'Mujhe ek chhoti si kahani sunao jisme hum dono hero hon.',
  'Mere liye ek pyaara sa "thank you" message likho.',
];

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

// ===== PART 1 END. Neeche Part 2 paste karo (export default function App ... se shuru) =====

// ===== EXTRA START: ye Part 1 ke neeche aur Part 2 ("export default function App") ke upar paste karo =====

truths.push(
  'Hamari kaunsi baat yaad karke tum ab bhi muskuraate ho?',
  'Mujhe pehli baar dekhkar tumhare dil me kya aaya tha?',
  'Kya tumne kabhi mere liye koi gaana ya shayari likhi hai?',
  'Meri kaunsi nazar tumhe sabse zyada pasand hai?',
  'Agar hum ek raat ke liye kahin phans jayein, to tum kya karoge?',
  'Tumhe lagta hai hum dono me sabse zyada kya common hai?',
  'Kya tumne kabhi mujhse milne ke liye jhooth bola hai?',
  'Meri kaunsi cheez tumhe thodi si irritate karti hai, par phir bhi pyaari lagti hai?',
  'Mujhse sabse pehle kya kehna chahoge jab hum agli baar milenge?',
  'Kya tum mujhe apne ghar walon se milwane ke baare me sochte ho?',
  'Hamari kaunsi date tumhe sabse special lagi?',
  'Kya kabhi raat ko mujhe yaad karke neend nahi aayi?',
  'Mere kaunse kapde tumhe sabse zyada pasand hain?',
  'Agar main kal tumse door chala/chali jaun, to tum kya karoge?',
  'Mujhe lekar tumhara sabse bada sapna kya hai?',
  'Kya tumne kabhi mere message baar baar padhe hain?',
  'Meri kaunsi aawaz ya line tumhe sabse zyada yaad rehti hai?',
  'Hamare rishte me tumhe sabse zyada kis baat ka darr lagta hai?',
  'Tumhe mere saath kaunsi jagah par waqt bitana sabse achha lagta hai?',
  'Pehli baar jab humne haath pakda, tumhe kaisa laga tha?',
  'Mujhe khush karne ke liye tumne aaj tak sabse bada kya kiya hai?',
  'Agar hum bachpan me milte, to tumhe kya lagta hum kaise dost hote?',
  'Kya tumhe lagta hai ki hum ek dusre ke liye bane hain? Kyun?',
  'Meri woh kaunsi baat hai jo tumhe sabse zyada hasaati hai?',
  'Agar main tumse ek vaada maangu, to wo kya hoga jo tum turant doge?'
);
dares.push(
  'Mujhe apni aankhon se 15 second tak bina palak jhapkaye dekho.',
  'Mere liye ek chhota sa love song hum karke sunao.',
  'Mujhe batao ki main tumhe sabse zyada kab pyaara/pyaari lagta/lagti hoon.',
  'Apne haath se ek chhota sa heart banake mujhe photo bhejo.',
  'Mere naam ke har akshar se ek pyaara shabd batao.',
  'Mujhe ek romantic voice note bhejo jisme tum mera naam lo.',
  'Mujhe 1 se 10 tak ginti sunao, har number ke saath ek tareef ke saath.',
  'Mere liye 30 second ka ek romantic dialogue bolo.',
  'Mujhe ek selfie bhejo jisme tum mere liye muskura rahe ho.',
  'Mere liye ek 3 line ki love poem abhi likho.',
  'Mujhe batao ki agar hum kal date par jaayein to tum kya pehnoge/pehnogi.',
  'Mujhe ek lamba, pyaara sa "good morning" message likho.',
  'Mere liye apni awaaz me ek chhoti si lori gaao.',
  'Mujhe ek surprise gift ka idea batao jo tum mujhe dena chahte ho.',
  'Mujhe apni phone gallery ki ek pyaari yaad ki photo dikhao.',
  'Mere liye ek romantic emoji story bhejo, sirf emojis me.',
  'Mujhe abhi 3 baar "I miss you" alag alag andaaz me bolo.',
  'Mere naam ka ek cute nickname socho aur mujhe batao kyun.',
  'Mujhe apni pehli impression ke baare me 2 line likho.',
  'Mere liye ek chhoti si romantic shayari banao.',
  'Mujhe tumhari pasand ka ek romantic gaana bhejo aur batao kyun.',
  'Mere saath ek funny selfie lo, jisme dono acting karein.',
  'Mere liye apne haath se ek chhoti si card ya drawing banao aur bhejo.',
  'Mujhe batao ki hamari love story ka title kya hoga.',
  'Mere liye ek romantic quote likho jo sirf mere liye ho.'
);

translations.hi = { ...translations.en,
  welcome: 'स्वागत है', start: '💘 शुरू करें', createRoom: '✦ रूम बनाएं', joinRoom: '✦ रूम जॉइन करें',
  next: 'अगला ›', back: '‹ वापस', chat: '👥 ग्रुप चैट', profile: '👤 प्रोफाइल', settings: '⚙️ सेटिंग्स',
  send: 'भेजो 🚀', truth: 'ट्रुथ 💭', dare: 'डेयर 😈', customQ: '📝 अपना सवाल लिखो',
  donePlus: 'कर दिया / बता दिया (+1) ✅', failedMinus: 'नहीं कर पाया (-1) ❌', endGame: 'गेम खत्म', newGame: 'नया गेम',
  join: 'जॉइन', msgPlaceholder: 'मैसेज लिखो...', you: 'तुम', partner: 'पार्टनर', save: 'सेव', logout: '🚪 लॉगआउट',
  sound: 'साउंड इफेक्ट्स', notifications: 'नोटिफिकेशन', cancel: 'कैंसल', videoCall: '📹 वीडियो कॉल',
  startBattle: 'बैटल शुरू!', flip: 'सिक्का उछालो!', chooseSide: 'अपना साइड चुनो 🪙', noMsg: 'अभी कोई मैसेज नहीं। पहला भेजो! 👋',
};
translations.es = { ...translations.en,
  welcome: 'BIENVENIDO', start: '💘 Empezar', createRoom: '✦ Crear sala', joinRoom: '✦ Unirse a sala',
  next: 'Siguiente ›', back: '‹ Atrás', chat: '👥 Chat de grupo', profile: '👤 Perfil', settings: '⚙️ Ajustes',
  send: 'Enviar 🚀', truth: 'Verdad 💭', dare: 'Reto 😈', customQ: '📝 Escribe la tuya',
  donePlus: 'Hecho / Dicho (+1) ✅', failedMinus: 'No pudo (-1) ❌', endGame: 'Terminar juego', newGame: 'Nuevo juego',
  join: 'Unirse', msgPlaceholder: 'Escribe un mensaje...', you: 'Tú', partner: 'Pareja', save: 'Guardar', logout: '🚪 Cerrar sesión',
  sound: 'Efectos de sonido', notifications: 'Notificaciones', cancel: 'Cancelar', videoCall: '📹 Videollamada',
  startBattle: '¡Empezar batalla!', flip: '¡Lanza la moneda!', chooseSide: 'Elige tu lado 🪙', noMsg: 'Aún no hay mensajes. ¡Envía el primero! 👋',
};
translations.fr = { ...translations.en,
  welcome: 'BIENVENUE', start: '💘 Commencer', createRoom: '✦ Créer une salle', joinRoom: '✦ Rejoindre une salle',
  next: 'Suivant ›', back: '‹ Retour', chat: '👥 Chat de groupe', profile: '👤 Profil', settings: '⚙️ Paramètres',
  send: 'Envoyer 🚀', truth: 'Vérité 💭', dare: 'Défi 😈', customQ: '📝 Écris la tienne',
  donePlus: 'Fait / Dit (+1) ✅', failedMinus: "N'a pas pu (-1) ❌", endGame: 'Terminer la partie', newGame: 'Nouvelle partie',
  join: 'Rejoindre', msgPlaceholder: 'Écris un message...', you: 'Toi', partner: 'Partenaire', save: 'Enregistrer', logout: '🚪 Déconnexion',
  sound: 'Effets sonores', notifications: 'Notifications', cancel: 'Annuler', videoCall: '📹 Appel vidéo',
  startBattle: 'Commencer la bataille !', flip: 'Lance la pièce !', chooseSide: 'Choisis ton côté 🪙', noMsg: 'Pas encore de messages. Envoie le premier ! 👋',
};

const LANGS = [
  ['en', 'English'], ['hi', 'हिन्दी'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
  ['it', 'Italiano'], ['ru', 'Русский'], ['ar', 'العربية'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文'],
  ['bn', 'বাংলা'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['mr', 'मराठी'], ['gu', 'ગુજરાતી'], ['pa', 'ਪੰਜਾਬੀ'],
  ['ur', 'اردو'], ['tr', 'Türkçe'], ['id', 'Indonesia'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'],
];

const autoCache = {};
const autoTranslate = async (code) => {
  try {
    const saved = localStorage.getItem('nexdare_tr2_' + code);
    if (saved) { autoCache[code] = JSON.parse(saved); return; }
    const keys = Object.keys(translations.en);
    const out = {};
    for (let i = 0; i < keys.length; i += 20) {
      const chunk = keys.slice(i, i + 20);
      const q = chunk.map((k) => translations.en[k]).join('\n');
      const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + code + '&dt=t&q=' + encodeURIComponent(q));
      const d = await res.json();
      const parts = d[0].map((x) => x[0]).join('').split('\n');
      if (parts.length === chunk.length) chunk.forEach((k, j) => { out[k] = parts[j].trim(); });
    }
    autoCache[code] = out;
    localStorage.setItem('nexdare_tr2_' + code, JSON.stringify(out));
  } catch (e) { autoCache[code] = {}; }
};

// ===== EXTRA END =====

// ===== GROUP CHAT HELPERS =====
const groupIdOf = async (code) => hex(await subtle.digest('SHA-256', enc8('nexdare-gid:' + code))).slice(0, 24);
const groupKeyOf = async (code) => {
  const base = await subtle.importKey('raw', enc8(code), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: enc8('nexdare-group-v1'), iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
};
const newGroupCode = () => {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a).map((x) => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
};
const fmtListTime = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString();
};
const letterOf = (name) => {
  const c = String(name || '').trim().replace(/^@/, '').charAt(0);
  return c ? c.toUpperCase() : '?';
};
const LETTER_COLORS = ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#009688', '#43a047', '#fb8c00', '#f4511e', '#8d6e63'];
const avLbl = (av) => (av && av !== '😎' ? av + ' ' : '');
const resizeDataUrl = (du, max, q) => new Promise((res, rej) => {
  const img = new window.Image();
  img.onload = () => {
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    res(c.toDataURL('image/jpeg', q));
  };
  img.onerror = () => rej(new Error('Photo khul nahi payi'));
  img.src = du;
});
const hdOf = (uid) => () => call('GET', 'profiles/' + uid + '/photoHd');
const isOnline = (p) => !!p && !p.hide && !!p.on && !!p.t && Date.now() - p.t < 45000;
const presText = (p) => {
  if (!p || p.hide || !p.t) return '';
  if (isOnline(p)) return 'online';
  const d = new Date(p.t);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff <= 0) return 'last seen today at ' + hm;
  if (diff === 1) return 'last seen yesterday at ' + hm;
  return 'last seen ' + d.toLocaleDateString() + ' at ' + hm;
};
// ---- Tic Tac Toe helpers ----
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const tttCheck = (b) => {
  for (const l of TTT_LINES) {
    if (b[l[0]] !== '-' && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { w: b[l[0]], line: l };
  }
  return b.indexOf('-') >= 0 ? null : { w: 'draw', line: [] };
};
const tttScore = (b, turn) => {
  const r = tttCheck(b);
  if (r) return r.w === 'O' ? 1 : r.w === 'X' ? -1 : 0;
  let best = turn === 'O' ? -2 : 2;
  for (let i = 0; i < 9; i++) {
    if (b[i] === '-') {
      const sc = tttScore(b.slice(0, i) + turn + b.slice(i + 1), turn === 'O' ? 'X' : 'O');
      best = turn === 'O' ? Math.max(best, sc) : Math.min(best, sc);
    }
  }
  return best;
};
const tttCpuMove = (b, level) => {
  const emp = [];
  for (let i = 0; i < 9; i++) if (b[i] === '-') emp.push(i);
  if (!emp.length) return -1;
  if (level === 'easy' && Math.random() < 0.65) return pickOne(emp);
  let best = -2; let mv = [];
  for (const i of emp) {
    const sc = tttScore(b.slice(0, i) + 'O' + b.slice(i + 1), 'X');
    if (sc > best) { best = sc; mv = [i]; } else if (sc === best) mv.push(i);
  }
  return pickOne(mv);
};
const TTT_FRESH = { board: '---------', turn: 'X', status: 'play', line: [], scores: { you: 0, cpu: 0, draw: 0 }, round: 0 };
const tttApply = (g, i, sym) => {
  const board = g.board.slice(0, i) + sym + g.board.slice(i + 1);
  const r = tttCheck(board);
  if (!r) return { ...g, board, turn: sym === 'X' ? 'O' : 'X' };
  const scores = { ...g.scores };
  if (r.w === 'draw') scores.draw++; else if (r.w === 'X') scores.you++; else scores.cpu++;
  return { ...g, board, status: r.w === 'draw' ? 'draw' : 'win', winner: r.w, line: r.line, scores };
};
// ---- Wallpaper themes ----
const rngOf = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const HEART_PATH = 'M0 8 C-14 -4 -10 -16 0 -9 C10 -16 14 -4 0 8Z';
const wallSvg = (w) => {
  const W = 720; const H = 1560;
  const R = rngOf(w.seed || 7);
  const rr = (a, b) => a + R() * (b - a);
  const f0 = (n) => n.toFixed(0);
  const defs = '<defs><linearGradient id="g" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="' + w.c1 + '"/><stop offset="0.55" stop-color="' + w.c2 + '"/><stop offset="1" stop-color="' + w.c3 + '"/></linearGradient>'
    + '<filter id="b" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="45"/></filter>'
    + '<filter id="s" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter></defs>';
  let o = '<rect width="720" height="1560" fill="url(#g)"/>';
  const stars = (n) => { for (let i = 0; i < n; i++) o += '<circle cx="' + f0(rr(0, W)) + '" cy="' + f0(rr(0, H * 0.7)) + '" r="' + rr(0.6, 2.2).toFixed(1) + '" fill="#fff" opacity="' + rr(0.3, 0.95).toFixed(2) + '"/>'; };
  const moon = () => { o += '<circle cx="560" cy="240" r="120" fill="' + w.c4 + '" opacity="0.35" filter="url(#b)"/><circle cx="560" cy="240" r="60" fill="#fff" opacity="0.92"/>'; };
  const t = w.type;
  if (t === 'bokeh') {
    for (let i = 0; i < 18; i++) o += '<circle cx="' + f0(rr(0, W)) + '" cy="' + f0(rr(0, H)) + '" r="' + f0(rr(30, 130)) + '" fill="' + (i % 2 ? w.c4 : w.c5) + '" opacity="' + rr(0.12, 0.34).toFixed(2) + '" filter="url(#s)"/>';
  } else if (t === 'stars') {
    stars(160); moon();
  } else if (t === 'waves') {
    if (w.stars) stars(70);
    for (let i = 0; i < 6; i++) {
      const y = 760 + i * 130;
      o += '<path d="M0 ' + y + ' C180 ' + (y - 80) + ' 300 ' + (y + 80) + ' 480 ' + y + ' S700 ' + (y - 40) + ' 720 ' + y + ' L720 1560 L0 1560 Z" fill="' + w.c4 + '" opacity="' + (0.1 + i * 0.07).toFixed(2) + '"/>';
    }
  } else if (t === 'hearts') {
    for (let i = 0; i < 42; i++) o += '<path transform="translate(' + f0(rr(0, W)) + ' ' + f0(rr(0, H)) + ') rotate(' + f0(rr(-30, 30)) + ') scale(' + rr(0.8, 3.4).toFixed(2) + ')" d="' + HEART_PATH + '" fill="' + w.c4 + '" opacity="' + rr(0.1, 0.35).toFixed(2) + '"/>';
  } else if (t === 'petals') {
    for (let i = 0; i < 50; i++) {
      const cx = rr(0, W); const cy = rr(0, H);
      o += '<ellipse cx="' + f0(cx) + '" cy="' + f0(cy) + '" rx="' + f0(rr(8, 20)) + '" ry="' + f0(rr(15, 34)) + '" transform="rotate(' + f0(rr(0, 180)) + ' ' + f0(cx) + ' ' + f0(cy) + ')" fill="' + w.c4 + '" opacity="' + rr(0.22, 0.6).toFixed(2) + '"/>';
    }
    o += '<circle cx="120" cy="1300" r="180" fill="' + w.c4 + '" opacity="0.18" filter="url(#b)"/>';
  } else if (t === 'mountains') {
    o += '<circle cx="360" cy="700" r="150" fill="' + w.c4 + '" opacity="0.55" filter="url(#b)"/><circle cx="360" cy="700" r="90" fill="' + w.c5 + '" opacity="0.9"/>';
    for (let i = 0; i < 4; i++) {
      const base = 930 + i * 150;
      let d = 'M0 1560 L0 ' + f0(base - rr(40, 200));
      for (let x = 90; x <= 720; x += 90) d += ' L' + x + ' ' + f0(base - rr(40, 200));
      d += ' L720 1560 Z';
      o += '<path d="' + d + '" fill="' + w.c6 + '" opacity="' + (0.3 + i * 0.2).toFixed(2) + '"/>';
    }
  } else if (t === 'aurora') {
    stars(w.stars ? 120 : 60);
    const cols = [w.c4, w.c5, w.c6];
    for (let i = 0; i < 3; i++) {
      const y = 420 + i * 230;
      o += '<ellipse cx="360" cy="' + y + '" rx="430" ry="75" fill="' + cols[i] + '" opacity="0.5" transform="rotate(-18 360 ' + y + ')" filter="url(#b)"/>';
    }
  } else if (t === 'neon') {
    o += '<circle cx="360" cy="780" r="170" fill="' + w.c4 + '" opacity="0.85"/><rect x="0" y="900" width="720" height="660" fill="' + w.c3 + '"/>';
    o += '<ellipse cx="360" cy="900" rx="420" ry="40" fill="' + w.c5 + '" opacity="0.5" filter="url(#b)"/>';
    for (let k = 1; k <= 9; k++) o += '<line x1="0" y1="' + f0(900 + k * k * 8) + '" x2="720" y2="' + f0(900 + k * k * 8) + '" stroke="' + w.c5 + '" stroke-width="2" opacity="0.55"/>';
    for (let x = -900; x <= 1620; x += 150) o += '<line x1="360" y1="900" x2="' + x + '" y2="1560" stroke="' + w.c5 + '" stroke-width="2" opacity="0.5"/>';
  } else if (t === 'city') {
    if (w.stars) stars(80);
    o += '<circle cx="520" cy="640" r="150" fill="' + w.c4 + '" opacity="0.5" filter="url(#b)"/><circle cx="520" cy="640" r="70" fill="' + w.c5 + '" opacity="0.9"/>';
    for (let layer = 0; layer < 3; layer++) {
      let x = -20;
      while (x < W) {
        const bw = rr(50, 115); const bh = rr(220, 560) - layer * 80;
        o += '<rect x="' + f0(x) + '" y="' + f0(1560 - bh) + '" width="' + f0(bw) + '" height="' + f0(bh) + '" fill="' + w.c6 + '" opacity="' + (0.35 + layer * 0.3).toFixed(2) + '"/>';
        if (layer === 2) {
          for (let wy = 1560 - bh + 18; wy < 1530; wy += 36) for (let wx = x + 10; wx < x + bw - 14; wx += 24) if (R() > 0.55) o += '<rect x="' + f0(wx) + '" y="' + f0(wy) + '" width="9" height="14" fill="' + w.c5 + '" opacity="0.8"/>';
        }
        x += bw + rr(2, 14);
      }
    }
  } else if (t === 'dunes') {
    o += '<circle cx="360" cy="660" r="140" fill="' + w.c4 + '" opacity="0.6" filter="url(#b)"/><circle cx="360" cy="660" r="80" fill="' + w.c5 + '" opacity="0.95"/>';
    for (let i = 0; i < 5; i++) {
      const y = 900 + i * 120;
      o += '<path d="M0 ' + y + ' C150 ' + (y - 90) + ' 330 ' + (y + 60) + ' 480 ' + (y - 30) + ' S680 ' + (y + 20) + ' 720 ' + (y - 20) + ' L720 1560 L0 1560 Z" fill="' + w.c6 + '" opacity="' + (0.25 + i * 0.15).toFixed(2) + '"/>';
    }
  } else if (t === 'snow') {
    stars(50);
    for (let i = 0; i < 90; i++) o += '<circle cx="' + f0(rr(0, W)) + '" cy="' + f0(rr(0, H)) + '" r="' + rr(1.5, 6).toFixed(1) + '" fill="#fff" opacity="' + rr(0.3, 0.9).toFixed(2) + '"/>';
    for (let i = 0; i < 30; i++) o += '<circle cx="' + f0(rr(0, W)) + '" cy="' + f0(rr(0, H)) + '" r="' + f0(rr(8, 22)) + '" fill="#fff" opacity="0.22" filter="url(#s)"/>';
    for (let x = 30; x < W; x += 110) {
      const tip = 1180 - rr(0, 140);
      o += '<polygon points="' + x + ',1560 ' + (x + 45) + ',' + f0(tip) + ' ' + (x + 90) + ',1560" fill="' + w.c6 + '" opacity="0.7"/>';
    }
    o += '<path d="M0 1420 C180 1350 360 1460 720 1380 L720 1560 L0 1560 Z" fill="#fff" opacity="0.22"/>';
  } else if (t === 'geo') {
    const cols = [w.c4, w.c5, w.c6];
    for (let i = 0; i < 34; i++) {
      const cx = rr(0, W); const cy = rr(0, H); const sz = rr(90, 260);
      let pts = '';
      for (let k = 0; k < 3; k++) pts += f0(cx + rr(-sz, sz)) + ',' + f0(cy + rr(-sz, sz)) + ' ';
      o += '<polygon points="' + pts + '" fill="' + cols[i % 3] + '" opacity="' + rr(0.08, 0.34).toFixed(2) + '"/>';
    }
  } else if (t === 'rain') {
    for (let i = 0; i < 10; i++) o += '<circle cx="' + f0(rr(0, W)) + '" cy="' + f0(rr(700, H)) + '" r="' + f0(rr(30, 110)) + '" fill="' + (i % 2 ? w.c4 : w.c5) + '" opacity="' + rr(0.1, 0.26).toFixed(2) + '" filter="url(#b)"/>';
    for (let i = 0; i < 130; i++) {
      const x = rr(0, W); const y = rr(0, H);
      o += '<line x1="' + f0(x) + '" y1="' + f0(y) + '" x2="' + f0(x - 9) + '" y2="' + f0(y + 38) + '" stroke="' + w.c6 + '" stroke-width="1.6" opacity="' + rr(0.15, 0.5).toFixed(2) + '"/>';
    }
  } else if (t === 'forest') {
    if (w.stars) stars(50);
    moon();
    for (let i = 0; i < 3; i++) {
      for (let x = -40; x < W; x += 70) {
        const tip = 900 + i * 130 - rr(0, 170);
        o += '<polygon points="' + x + ',1560 ' + (x + 40) + ',' + f0(tip) + ' ' + (x + 80) + ',1560" fill="' + w.c6 + '" opacity="' + (0.3 + i * 0.25).toFixed(2) + '"/>';
      }
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1560" preserveAspectRatio="xMidYMid slice">' + defs + o + '</svg>';
};
const WALL_CACHE = {};
const wallUri = (w) => {
  const k = JSON.stringify(w);
  if (!WALL_CACHE[k]) WALL_CACHE[k] = 'data:image/svg+xml;utf8,' + encodeURIComponent(wallSvg(w));
  return WALL_CACHE[k];
};
const SKINS = {
  rose: { name: 'Rose Garden 🌹', bg: '#2a0a18', accent: '#ff4d8d', accent2: '#ffd1e3', glow: '#ff4d8d', glow2: '#8a1c4d', e: ['🌹', '💖', '✨'], wall: { type: 'petals', seed: 3, c1: '#3a0b22', c2: '#6b1238', c3: '#1f0612', c4: '#ff8fb8' } },
  orchid: { name: 'Orchid Dream 💜', bg: '#24092a', accent: '#c850c0', accent2: '#f3c9ef', glow: '#c850c0', glow2: '#ff4d8d', e: ['💜', '🦋', '✨'], wall: { type: 'bokeh', seed: 5, c1: '#2a0b3a', c2: '#4b1565', c3: '#14051c', c4: '#e08cff', c5: '#ff7ac8' } },
  peach: { name: 'Peach Sunset 🍑', bg: '#2b0f14', accent: '#ff7a8a', accent2: '#ffdadf', glow: '#ff7a8a', glow2: '#b0235a', e: ['🍑', '🌅', '✨'], wall: { type: 'mountains', seed: 11, c1: '#5a1d3a', c2: '#d9566a', c3: '#ffb08a', c4: '#ffd9a0', c5: '#fff2c8', c6: '#4a1530' } },
  wine: { name: 'Wine Night 🍷', bg: '#220810', accent: '#d6336c', accent2: '#fbc4d4', glow: '#d6336c', glow2: '#5c0f2b', e: ['🍷', '🕯️', '✨'], wall: { type: 'bokeh', seed: 8, c1: '#2b0a14', c2: '#5a1226', c3: '#14040a', c4: '#ff5c8a', c5: '#ffb36b' } },
  night: { name: 'Midnight Stars 🌙', bg: '#150f2e', accent: '#ff6fa5', accent2: '#e0d4ff', glow: '#7c5cff', glow2: '#ff6fa5', e: ['🌙', '⭐', '✨'], wall: { type: 'stars', seed: 21, c1: '#0b0820', c2: '#1c1450', c3: '#3a1d6e', c4: '#9d8cff' } },
  ocean: { name: 'Ocean Waves 🌊', bg: '#08202e', accent: '#2bb7e8', accent2: '#cdeeff', glow: '#2bb7e8', glow2: '#0d4f8a', e: ['🌊', '🐚', '✨'], wall: { type: 'waves', seed: 4, c1: '#06304a', c2: '#0b5c86', c3: '#052033', c4: '#7fe0ff' } },
  aurora: { name: 'Aurora ✨', bg: '#071a1a', accent: '#3ddc97', accent2: '#d2ffe9', glow: '#3ddc97', glow2: '#7c5cff', e: ['🌌', '💚', '✨'], wall: { type: 'aurora', seed: 13, c1: '#04101f', c2: '#081c2e', c3: '#0b2b3a', c4: '#3ddc97', c5: '#7c5cff', c6: '#4dd0ff' } },
  sakura: { name: 'Cherry Blossom 🌸', bg: '#2a0f1c', accent: '#ff8fb1', accent2: '#ffe0ea', glow: '#ff8fb1', glow2: '#c2487a', e: ['🌸', '🌷', '✨'], wall: { type: 'petals', seed: 17, c1: '#3b1327', c2: '#7a2a52', c3: '#a8406f', c4: '#ffc2d6' } },
  galaxy: { name: 'Galaxy 🌌', bg: '#0f0a24', accent: '#b388ff', accent2: '#e9dcff', glow: '#7c4dff', glow2: '#ff4da6', e: ['🌌', '🪐', '✨'], wall: { type: 'aurora', stars: true, seed: 29, c1: '#07041a', c2: '#140a38', c3: '#2a0f52', c4: '#7c4dff', c5: '#ff4da6', c6: '#4d8bff' } },
  neon: { name: 'Neon City 🌆', bg: '#12082a', accent: '#ff2bd6', accent2: '#c9f6ff', glow: '#00e5ff', glow2: '#ff2bd6', e: ['🌆', '⚡', '✨'], wall: { type: 'neon', seed: 2, c1: '#0d0524', c2: '#2a0b5e', c3: '#14052e', c4: '#ff4fd8', c5: '#00e5ff' } },
  forest: { name: 'Forest Night 🌲', bg: '#0b1f14', accent: '#4cc275', accent2: '#d9ffe6', glow: '#4cc275', glow2: '#146b3a', e: ['🌲', '🍃', '✨'], wall: { type: 'forest', stars: true, seed: 31, c1: '#06140e', c2: '#0f3322', c3: '#1b5a3a', c4: '#d9ffe6', c6: '#04100a' } },
  gold: { name: 'Golden Hour 🌅', bg: '#2a1a08', accent: '#ffb347', accent2: '#ffe9c2', glow: '#ffb347', glow2: '#b8531c', e: ['🌅', '🧡', '✨'], wall: { type: 'mountains', seed: 19, c1: '#3a1a10', c2: '#c2602a', c3: '#ffc36b', c4: '#ffe08a', c5: '#fff6d0', c6: '#2e1208' } },
  lavender: { name: 'Lavender Mist 💐', bg: '#1d1030', accent: '#a98bff', accent2: '#ece3ff', glow: '#a98bff', glow2: '#6a3fb8', e: ['💐', '🦋', '✨'], wall: { type: 'bokeh', seed: 23, c1: '#241446', c2: '#4a2f86', c3: '#150c2a', c4: '#c9b3ff', c5: '#ff9ed8' } },
  candy: { name: 'Candy Pop 🍭', bg: '#2a0c26', accent: '#ff6ec7', accent2: '#fff0fa', glow: '#ff6ec7', glow2: '#6ec7ff', e: ['🍭', '💖', '✨'], wall: { type: 'hearts', seed: 9, c1: '#3a0f3a', c2: '#7a2a72', c3: '#2a0c4a', c4: '#ff9de0' } },
  ice: { name: 'Ice Queen ❄️', bg: '#0b1c2a', accent: '#7fd6ff', accent2: '#e8f8ff', glow: '#7fd6ff', glow2: '#4d8bff', e: ['❄️', '💙', '✨'], wall: { type: 'waves', stars: true, seed: 37, c1: '#0a1a2e', c2: '#16406a', c3: '#0d2744', c4: '#cfeeff' } },
  hearts: { name: 'Love Hearts 💘', bg: '#2a0508', accent: '#ff3d57', accent2: '#ffd0d6', glow: '#ff3d57', glow2: '#7a0f1f', e: ['💘', '❤️', '💋'], wall: { type: 'hearts', seed: 15, c1: '#3a0610', c2: '#7a1020', c3: '#2a0508', c4: '#ff5a73' } },
  ember: { name: 'Ember 🔥', bg: '#240a05', accent: '#ff6b3d', accent2: '#ffe0d2', glow: '#ff6b3d', glow2: '#8a2008', e: ['🔥', '🧡', '✨'], wall: { type: 'bokeh', seed: 27, c1: '#2a0a04', c2: '#6a1c08', c3: '#1a0602', c4: '#ff7a3d', c5: '#ffc04d' } },
  mint: { name: 'Mint Breeze 🍃', bg: '#0a2420', accent: '#38d9c0', accent2: '#d6fff7', glow: '#38d9c0', glow2: '#0f7a6a', e: ['🍃', '💚', '✨'], wall: { type: 'waves', seed: 6, c1: '#06302a', c2: '#0f6a5c', c3: '#07241f', c4: '#9ff5e4' } },
  skyline: { name: 'Midnight City 🏙️', bg: '#0a0f24', accent: '#4da3ff', accent2: '#d6e8ff', glow: '#4da3ff', glow2: '#7c5cff', e: ['🏙️', '🌃', '✨'], r: 10, wall: { type: 'city', seed: 41, stars: true, c1: '#050a1f', c2: '#14234f', c3: '#0a1230', c4: '#4da3ff', c5: '#ffd166', c6: '#05091c' } },
  sunsetcity: { name: 'Sunset City 🌇', bg: '#2a0f1f', accent: '#ff7a45', accent2: '#ffe1cf', glow: '#ff7a45', glow2: '#c2185b', e: ['🌇', '🧡', '✨'], wall: { type: 'city', seed: 52, c1: '#3a1030', c2: '#c2185b', c3: '#ff8a50', c4: '#ffb27a', c5: '#fff0c8', c6: '#2a0a24' } },
  desert: { name: 'Desert Gold 🏜️', bg: '#2a1608', accent: '#ffb347', accent2: '#ffecc7', glow: '#ffb347', glow2: '#b8531c', e: ['🏜️', '🌵', '✨'], wall: { type: 'dunes', seed: 5, c1: '#4a2310', c2: '#c76a2a', c3: '#2a1206', c4: '#ffcf7a', c5: '#fff3c9', c6: '#5c2a0c' } },
  rosedunes: { name: 'Rose Dunes 🌷', bg: '#2a0c1c', accent: '#ff6f9c', accent2: '#ffe3ee', glow: '#ff6f9c', glow2: '#b23a6e', e: ['🌷', '💗', '✨'], wall: { type: 'dunes', seed: 9, c1: '#3a0f2a', c2: '#b23a6e', c3: '#240a1a', c4: '#ff9ec0', c5: '#ffe3ee', c6: '#4a1030' } },
  snowfall: { name: 'Snowfall ⛄', bg: '#0c1a2c', accent: '#9fd8ff', accent2: '#f0f9ff', glow: '#9fd8ff', glow2: '#5b8cff', e: ['⛄', '❄️', '✨'], wall: { type: 'snow', seed: 8, c1: '#0a1830', c2: '#1d3f6e', c3: '#0c1a2c', c4: '#ffffff', c6: '#0a1f3a' } },
  crystal: { name: 'Crystal Geo 💎', bg: '#0d1030', accent: '#7c9cff', accent2: '#e1e8ff', glow: '#7c9cff', glow2: '#e040fb', e: ['💎', '🔷', '✨'], r: 8, wall: { type: 'geo', seed: 13, c1: '#0a0d2e', c2: '#26307a', c3: '#120a30', c4: '#7c9cff', c5: '#e040fb', c6: '#4dd0e1' } },
  lowpoly: { name: 'Low-Poly Teal 🔷', bg: '#06201f', accent: '#26d0b4', accent2: '#d3fff6', glow: '#26d0b4', glow2: '#0d7a8a', e: ['🔷', '💚', '✨'], r: 8, wall: { type: 'geo', seed: 29, c1: '#041a1a', c2: '#0c5560', c3: '#06201f', c4: '#26d0b4', c5: '#7ef0dc', c6: '#0d7a8a' } },
  rainy: { name: 'Rainy Night 🌧️', bg: '#0b1220', accent: '#6aa8ff', accent2: '#dbe9ff', glow: '#6aa8ff', glow2: '#3a4a8a', e: ['🌧️', '☔', '✨'], wall: { type: 'rain', seed: 19, c1: '#070d1a', c2: '#1a2b4d', c3: '#0b1220', c4: '#9cc3ff', c5: '#ff9ec0', c6: '#4d6fb3' } },
  amoled: { name: 'Pure Black ⚫', bg: '#000000', accent: '#ff4d8d', accent2: '#ffd1e3', glow: '#ff4d8d', glow2: '#7c5cff', e: ['⚫', '💖', '✨'], wall: { type: 'stars', seed: 77, c1: '#000000', c2: '#05050a', c3: '#000000', c4: '#ffffff' } },
  cosmic: { name: 'Cosmic Love 💫', bg: '#10061f', accent: '#ff5fa2', accent2: '#ffd6ea', glow: '#ff5fa2', glow2: '#7c4dff', e: ['💫', '💞', '✨'], wall: { type: 'hearts', seed: 61, c1: '#12062a', c2: '#3a0f5c', c3: '#10061f', c4: '#ff5fa2', c5: '#b388ff' } },
};
const SPLASH_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwQDAwQEBAQFBQQFBwsHBwYGBw4KCggLEA4RERAOEA8SFBoWEhMYEw8QFh8XGBsbHR0dERYgIh8cIhocHRz/2wBDAQUFBQcGBw0HBw0cEhASHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBz/wAARCAOqAu4DASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAcIBgkBBAUCA//EAFcQAQABAwMBBQIFDgsFBQgDAQABAgMEBQYRBwgSITFBUWETFCJxgQkVMjVCUnJzkZWhsbLSGBkjMzY3Vld1wdMWNGKSoiRDU9HwFyUmRFRjguF0g5PC/8QAHAEBAAICAwEAAAAAAAAAAAAAAAUGBAcCAwgB/8QAOxEBAAEDAgMEBwYFBQADAAAAAAECAwQFEQYSITFBUXEHEyIyYZGxFDM0coHRIzVCocEVFiRS4SVUYv/aAAwDAQACEQMRAD8A1/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcADL9ndK969QLnc2xtfVtVjnibmNjVTap+e5PyY+mU5bc7AvV/WqbdWdi6PotNXnGdnRVVH0WorBV4XhwfqbG57lETnb40exX6xYxLt2PyzNLv/AMWlqf8AeJh/mqv/AFQUPF8P4tPUv7xMP801/wCqfxaepf3iYf5pr/1QUPF8P4tPUv7xMP8ANNf+qfxaepf3iYf5pr/1QUPF8P4tPUv7xMP801/6p/Fp6l/eJh/mmv8A1QUPF8P4tPUv7xMP801/6p/Fp6l/eJh/mmv/AFQUPF8P4tPUv7xMP801/wCqfxaepf3iYf5pr/1QUPF8P4tPUv7xMP8ANNf+qfxaepf3iYf5pr/1QUPF8P4tPUv7xMP801/6p/Fp6l/eJh/mmv8A1QUPF8P4tPUv7xMP801/6p/Fp6l/eJh/mmv/AFQUPF8P4tPUv7xMP801/wCqfxaepf3iYf5pr/1QUPF8P4tPUv7xMP8ANNf+qfxaepf3iYf5pr/1QUPF8P4tPUv7xMP801/6p/Fp6l/eJh/mmv8A1QUPF8J+pp6nx4dRMPn/AAqv/VeXqH1NrdtumfrfvTQ8ir2ZGPes/q74KRiym5Own1k0Ciu5i6Pgazbo55nTs6iZ4/BudyZ+aIlBm6dh7n2Rlzi7j0DU9Jv88RTm41dqKvmmY4mPmkGPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHm/bEw8jUMqzi4li7fyb9cW7Vm1RNVdyqZ4immmPGZmfSGw/s19hixotWBuvqbZtZWd3Yu2Nv1UxVasT6Tfnyrqj7yPkxPnM+UBVnoz2VuoHWauzl4Onzpe3q/GdX1GmqizVT/8Abp+yuz+D4e2YbAOk3Yq6bdNKLWVqGDG59apmKpy9Vt01WqJj7yx9jHt+V3p96xlq1bsW6Ldqimi3RTFNNNMcRTEeURHpD7B+VjHs4tmizZtUWrNEd2m3RTFNNMeyIjwh+oAAAAAAAAAAAAAAAAAAAAAAAAAAAOpqOmYWr4lzD1DDx8zEuxxXYyLdNy3XHsmmqJiXbAVO6udgzYe+Iu521Kp2pq80zPweNb7+Hcq99rnmj2fImI90qBdWuz9vvoxmVUbk0ev63TX3bWqYvN3Eu+zivj5Mz97VET7m6509U0rB1vT8nT9Sw7GZg5VE272PkW4rt3KZ84qpnwmAaDRd/tL9h3K2zb1Hd3Te3dzNHpmq9kaHFM1XsWnzmbM+dyiPH5P2UR5d70pBMceYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9LNm5k3rdmzbquXblUU0UURM1VTM8RERHnL817Owp2bqNXv43VPctiZxMS9P1lxa6fC7cp8JyJ91M8xT7aomfSOQlvsjdk3H6X4OJvLduNF3euTbmqzj1+NOmUVR5cet2Y86vueZpj1mbbkRxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMcqDdsrskW67Go9R9iYXdvU97I1jS7NPhXHnVkWqY8pjzrpjz8ao8eeb8uKqYrpmmY5ifQGgIWn7ZvZwo6Rblt7m29YqjaGuXav5KI+Tg5M81Ta/Aqjmafmqj0jmrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM36RdOM7qx1E0HaeDNVFWo34i9eiOfgbNPyrlz/wDGiJn3zxHq3abd0DT9q6DpuiaVj04+m6dj0Y2Pap+4t0RERH5IUq+pz9M7eHt/cG/8uzTOVn3frbhVTHjTZo4qu1R+FXNMf/1r0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwrq1040/qx0+1vaepRFNvULMxavcczYvR427kfg1RE++OY9Wkrcm3tQ2nr+paHq2PVj6lp1+vGyLVUfY10zxP0eHhPrDfU1o/VEOmlGhb80be2HZinH3BYnHy5pjw+M2YiIqn31W5p/5JBS8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABzHm4e/sbR43DvXbmkTT3o1HUcbFmPb37tNP+YNy3QDZtGwejWy9CiiKLtjTrVy/ERx/LXI+Euf9VcpJfNuim3RTRTERTTHERHpEeT6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVw7cWzaN19n/W8qKIqytCvWdStTx4xFNXcr/6LlX5IWPYr1M0S3uXp3uzR7tMVUahpeVj8e+q1VET+XgGiufCRzPm4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASf2c8anK68dOrdcc0/XzEq/wCW5FX+SMEq9mj+v3p1/jOP+0DdSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+L1um9art1xzTXE0zHunwfbifIGgzU7cWtRy7ceVN2umPoql1Xd1j7bZ34+5+1LpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJV7NH9fvTr/Gcf9pFSVezR/X706/xnH/aBupAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB0dV1nB0TFqytQyrWPYp867lXEPkzERvLlTTNc8tMby7winM7QWz8bIqs0ZVy7xPEV0W5mmfpZXtHqBo+8aKviGRTN2n7jvczP8A69jhTet1TtEsu9p2VYo9ZdtzEeMwysB2MIAAAAcT5OXE+QNB+sfbbO/H3P2pdJ3dY+22d+PuftS6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACVezR/X706/xnH/AGkVJV7NH9fvTr/Gcf8AaBupAAAAAAAAAAfF27RZt13LldNFFEd6qqqeIiPbLGd/9Qtv9NNu5Gubiz7WJhWYnjvT8q5P3tMestXnXvtf7r6r52TgaPk5Oi7Xnm3Ti2a+K79PtuVR7fZALq9UO21046f5mRpmJkZGt6la5pqp06Iqot1eya58J+jlX2Pqi2p4+o13Le06cjGmfD4fNqpqiPwYjhRuZ58yJBtd6SduDYfUXNxtK1Om/oGr3+KaKcvibNyqfuaa4/z4WeorpuUxVRVFVNUcxMeUtA1FyaKoqpmYmJ5iY84bT+xB1rvdRtj3Nu6pfrvazoFFFE3K55qu2p5imqZ9vp9ALWAAAAAxDqD1N2v0v0avVdzarYwceInuU11fLuz7KafOZBl8zx5vP1LXdL0ajv6hqGLiUT91fu00R+mWtbrX28Nzbqy7mDsOq9oWk0zMfGpiJyL37se5VXWt4a9uO/cv6vrGfnXbk8zVfv1Vfo54Bu+x+oe0su7Tasbm0e7cqniKaM23VM/REsjorpuUxVTVFUTHMTEtA9m/csVxXarrorp8YqoqmJj8ib+jXak3v0n1bG/955Wp6F34+G0/JuTXE0+vdmeZiQbixhvTLqboHVba2HuDQMum7j36fl2ufl2avWmqPSYZkAAD4u3ItW6q6vsaYmZUx6z75yN17oyMe3drjT8Sr4Oi13vk1THnVwt1ubInF0DUbsTxNNirifoUCza5uZl+uZmqaq6p5mfeiNVuzTTFEd7YfAGBbvX7mTXG809n6uvMeEeL3dp7ny9o61j6jiVzT8HVHfp58KqfV4jjz+dBUVzRVExLauVj0ZFqq1djeJhsM0XUqNY0vEzbc/Jv24r/ACw77Aujd25e6faRVdmZr+D45lnq4255qYl5vy7UWr9duOyJmABzY4AA4nycuJ8gaD9Y+22d+PuftS6Tu6x9ts78fc/al0gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEq9mj+v3p1/jOP+0ipKvZo/r96df4zj/tA3UgAAAAAAAMV6h9Q9B6Y7Zy9wbhzKcbBx48ImflXKvSmmPWZe9quqYmiabl6jnX6LGHi26rt27XPEU0xHMy1G9qrr9f6172rowbly3tjS6ptYdnveFyfW7Me2fT3Axvr9121nrhvC9qWXXXY0ixM0YODFU9y1R6TMffT6yiMc+YOBInTPo5uPqd9ccnTrHwOkaZZrv5moXo4tWqaaZnjn1qnjyhH9+ii3euUUVd6imqYir2wD81sfqfus3MLrVc0+JmLefgXJq4n1o4mOfyqnLR9gbErv8AXrHvRH8nj6ffmqfn4iAbWwAAYl1K6h6R0w2hqO49Zv028bEomaaJniq7X6UR75BjXXLrpt/obtedV1ar4fOv80YmBbqj4S/V/lTHrLUj1Y6tbg6v7syde13ImqapmLGNFUzbx6OfCmmP8379aOrer9ZN65u4NTrqptVVTRi43emabFv0iPf7UdADmPFIfTXohvfqzlfA7Z0S9kWYnivKuR3LFHz1z4fkBHZDPerfSXXeje542/r849WZNmm9FWPX36JifewIFluxZ1au9PuquHpeTeqjSNemMW5RNXyaLk/Y1cfP4S2zxPMRMTzEtCu38+5peuabmWpmK8fIt3YmPPwqhvW2zm06lt3S8uiZmm/jW6+Z99MA9UAGPb48Nqat+Iq/UoTf8L9z3VSvtvnw2nq34ir9ShN/+eufhSg9X7aW0/R17l7zh8Q4cnpPzIaGy6uyV4ukfEbC0jj/AMOGcMH6R/0B0j8VDOFxs+5DzbqH4q55z9QB2MMAAcT5OXE+QNB+sfbbO/H3P2pdJ3dY+22d+PuftS6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACVezR/X706/xnH/aRUlXs0f1+9Ov8Zx/2gbqQAAAAAARP2iOr+P0Y6b6hrsxFzUbv/Z8K1P3V2qPCfmjzkFbu3p17t6bp0dNtEyInNye7c1O5bq/m6POm388+ctdczzPL09xa/n7o1rO1fVL9eRn5t2q7duVzzM1TLywEsdCehOv9cdz0adptqqzpliqmc3Pqj5FmiZ8o9tU+kI+2ztvUd265g6NpWPXk5+ZdptW7dFPPjM+fzR6tzfQjpLgdG+nunbfxaaasruxdzL/AB43b0x8qfo8oBDvaIjQez52a8ja+g2acf49bjBsTH2VyqeJrrqn1mY5asKp5ld/6oxvGcvd23ds2rnyMLGm/eo5+6rn5P6FH5AXw+py7Oru6vufdF2ifgrdqjFs1ene5mav8lEI824TshbA/wBgui2iW7tHczNRo+OX6Zjyqq8Y/RwCeQAfnkX7eLYuX71dNFq3TNVVVU8RER5y1Q9sTtCXOrO8KtD0uvjbGjXJotcT/vFyPCa593pC3fbg6yz096dTt7Tb8U61uCJs/Jn5Vux91V7ufJqpqqmqZmZ5mfaDhzHn73CU+hXRXWete87OkYFuujT7Mxczcvj5Nm3z7fbPoDPuy92XM7rfqFeq6rXdwtp4dcRXdiOKsmrnxoo93tltU2ttXSdl6FiaLomHbxNOxKIot2qI48PbPtl+Oy9n6XsPbOnaBo+PTYwMG1FuimPOfbM++Z8Xu11RRTNVUxFMRzMz6QDVj9UA1ixqPWq3i2oiK8DBotXPnnx/VKqKVe0huuN59ad26pTPNv43VYomPKYo+T4fkRUDsYNM15mPTTHNVVymIj6Yb1NhYteHszQbFyOK7eHaiY9/dhpW6S6HO5OpW1dLimavjOoWaZj3d7mf1N4uJYjGxbFmPK3RFP5I4B+wAMT6lXvgNkazc73HFifFRGueaqp8+Z5Xi6vV00dPdb59bMwo35eHqgtXn2qYbW9HdP8ABvT8X04nymfRy4q+xn2IeO1siufZlezphYjH2PpFEf8Agx+pl7Htj0fB7U0mnjj+Qo/VDIVyt+5DzVmTzZFyfjP1AHNjAADifJy4nyBoP1j7bZ34+5+1LpO7rH22zvx9z9qXSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASr2aP6/enX+M4/7SKkq9mj+v3p1/jOP+0DdSAAAAAA16/VItbzZ1PZ+jc1Rp8WbmV7puc939UNhSvnaw7P9zrhsyx9aqrdvcelVVXcXv8AhF6JjxtzPv8AT3g1DTHh9LiInll25umG79oatc0rWNvahjZtueO58DVVz80xzErGdmfsc65vvWMbXt6YN7Ttr2Ji5RZu+FzMn0iI9KfaCZuwx2eY0DSaOom4MeY1TOo40+zXH81Zn7uffV+pdq7cps2q7lc8UURNUz7Ih+eFh2NOxLGJjW6bWPYoi3bopjiKaYjiIRN2muokdNekGv6nbr7mZkWpxcaY84rrjjn6Aas+0RvyrqL1f3NrcXO/jzkVWMeef+6o8KUWvu7cqu3a7lc8111TVM++XwDIti7du7r3joejWqJrqzsu3Zmn/hmqOZ/Jy3m6Hp1GkaNgafbiIoxbFFmOPZTER/k1e9g7p7O6OrUa5kWe9h6FZqu0zPjHws+ER+SW1EB0Na1fF0DSM3VM65FvEw7VV67XPpTTHMu+qD29er3+yOwrOz9Pu8alr/Pw3d86LEefzcz+oFE+0B1cyusnUXUNfu96jCp/kcS1PlRap8vD2z5os85J83EA/fDw72flWcbHtzcv3q4ooop86qp8obh+y30YsdHummDjXrdM63qNNOVnXYjx79UcxTE+yIUm7DPRWN+b5ubq1TH7+jaDMTRFUeFzIny8PdHi2kU0xTTFMRxEeEQDlhPV3dtjZHTbcut364pjFw7k0+PjNUxxHH0yzZRT6ob1RuafpukbGwb0015fOTmRTPE9zyppn3T5g1652Tczsy/k3apquXq6rlUz6zM8uvwT4kecRwCzfYX2ZVubrZi59dqK8XRrFWRXz6VT4U/pbYvJTH6nz09+s2xs/dl+ju5Gr3Jotz7bVM+H6YlOXVjrHjbOx69P0yqm/q9cce2LXvl13LtNumaquxlYWFezb0WLFO9Us23bvzRNm4lV/U8umiY8rVPjXV80IP3D2nL9dU0aHpUUUx93lVef0QgjVtZztczK8vUMq7fv1zNU1V1c+Pu9jpIG/qlyqdrfSG2NK4ExLFEVZnt1f2SDuPrPurc+DkYGZkWIw78cVW6LUfrR7EORH3Ltdyd653XLD0/GwqeTGoimPgOaKZuVU0x91MRH5XDsYFHwmdi0T91dpj9LjTG8u6/VyW6qvgv3taj4PbumU+zHo/U9d5+h2/gtIwaPvbNMfoeguVPuw81X53u1T8ZAHJ1AADifJy4nyBoP1j7bZ34+5+1LpO7rH22zvx9z9qXSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASr2aP6/enX+M4/7SKkq9mj+v3p1/jOP+0DdSAAAAAAAD867Fq5PNVuiqfbNMS+6aYpjiIiI9zkAa8vqi/UCu7qu3dmY9yYt2bU5mRET4VTVPFMT83HP0thdyum3RVXVMU00xzMz6Q0sdovfFzqD1h3Tq9VU/AxlVWLNMzzFNFE92OPyc/SCKpcx+hw9/ZO3L27d26LodiObuoZVuxEfPV4/o5BtF7D3Tuzs7o5hapctd3UddqnKu18edE/YfoWaeTtjRMbbe3tM0nEo7mNhY9Fmin2REcPWB0dZ1XG0LSc3UsuuKMXDs1XrlUz5U0xzLSt1u6n6h1a6hapr+ddmq1VcqtYtvnmLdmJnuxC+nb06xTtPZFnZmm5Hd1LXP94mir5VFiPOPpn9DWJIOZd3RtMyda1XD07Dtzcysu7TZt0xHPNVU8Q6ULidgno/b3dvbJ3lqVnvafoPEY8VR4V359ffxH6wXo7P3TCz0m6YaNoEUU/HIt/C5Vcfd3avGrx9Y9iUXERERxHk5B811RRRVVVPERHMtMPaZ35V1D6y7l1Sm5NeLavzjY/jzxbo8IbTu0Pv6npv0l3BrUTMX/gZx7MxPjFyuJiJaWMi/Xk37t65PNy7VNdU+2ZnmQfm9Xbeh39y6/pukYtM1ZGfkUWKOI54708c/Q8qlZrsR7It7g6s0a7m0f8Au7b1mvLqqmPCLnHh+iZJmIfYiZnaF79Z1vC6D9MdF2zpNqn49ZxqbFuI8oq4+VXP08yrBm5t/Ucq7lZN2q7fu1d6quqfGZn1ZJ1E3Xf3dufNzLlfNmmubdmn2UxPgxRV87Jm9cmO6G9OFdDo07FiuqP4lXWf2ceEueXD9MfHu5V6izZt1V3bk92mmnxmZYMRM9IWiqqmiJqqnpD4GYbk6b6xtPRsTU9S+Ct05U8U2eZ79PzsOhzrt1W52qdOLmWcuj1lirmjs3cvQ0Cibuu6ZR99kW4n8rz2R7CxvjW7tKtzx/OxV+R9sR/EiPi6dTq5cO7V8JXvwae5h2KfZRH6nYfnZju2bceymH6LjHY831TvMyAPr4AAOJ8nLifIGg/WPttnfj7n7Uuk7usfbbO/H3P2pdIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABKvZo/r96df4zj/tIqSr2aP6/enX+M4/7QN1IAAAAAAAAAI/63bsjZPSzc+szMRVZxK6aZ9k1RNMfraRsi/Xk37l65VNVy5VNVUz6zLa727danSuh2VjxV3Yz8qizPvjiZ/yanQFquwdsGndHVyNZv2puYuh2Zu+XhFyqOKZ+hVVsu+p17etY3TnW9a+D4v5efVa7/H2VNNMcfp5BdB5O59w4W1Nv6lrWoXqbWFgWKr92uueIiIj/ANQ9ZRTt99cKMLS7XTnR8imcnKmLuo1UVeNFEeVufn9YBSjq/wBStQ6rb81bceoVzxk3Z+Bt88027cTxTEfQwNzyccg72iaTla9quHpmDaqvZeZdps2rdMczVVVPEQ3QdAel2N0k6Z6RoFqmPjUUfDZVzjibl2rxmZ/V9CjvYG6OVbk3hkb41LFmrTNH+RiVV0/JuX585/8Axj9LZiABIKH/AFRjfc4+m7b2fYu8VZFVWZfpifOmPCnn6WvFYLtm7pvbm676/FVzvY+B3cW1TzzFMUx4/pV9BzDYJ2eNBt7B7NWfrlVE2tU3JdmmK5jxm3z8nj6IUK0LS72t6xgabj0TXfzL9FmimPOZqmIbRurejWNmdOtn7Zxae5j4mPRTFPHHjEeP6WNl18lmqUzw/jxkajZtzG/Xf5dUG+fj6+Tjgg81SntehojaNnPzLR9COl1jTMG3uDU7MV517xsU1x/NU/8AmgHp7pVGt7z0fDu0xVaqvRVXT7YhfDHsUY1m3at0xTRRHERHomNLx4qmbk9zW3Hur3LNNODanbm6z5eCBu07dpp0jSbc+dVyeFYoWW7UX+5aH+Mr/UrU6NT+/lL8Cx/8XHnIyvppTNe9tJimPHvsUZp0mj/4+0mPfUw8f7ynzWHWPwN78sryW/5un5ofTij7Gn5nK4vOMgAAADifJy4nyBoP1j7bZ34+5+1LpO7rH22zvx9z9qXSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASr2aP6/enX+M4/7SKkq9mj+v3p1/jOP+0DdSAAAAAAAAACo/wBUKt1V9HdOmmmZinUqJnj0+RU1ctvHbS21f3F0M1ica3Ny7g105HcjzmI8JaiJjxAhtR7AF+3d6Id2iY5t592mr5/BquWS7M/aoyOhONqWlZunV6houVNV+m1aqiK7d3jjnmfSeIBsp61dUdO6R9P9U3FnXaab1u3NGLanzu3pj5MRHr4+MtLu6dy6hvDcGo65q2RXfz8+7Vdu11TzPMz5fMzzrf163N1v1+c7WL02dOszxi6fbq/k7Mf51e9FQOHubQ2vqG89yaZoWl2K7+dn3qbNuiiOZ8Z8Z+iPF4fHLYb2COhF7TbV7qLrmLFNzIo+C02i5HyqaJ+yuce/0+YFuukvTzB6X7E0nbeDboppxbcfCVUx9ncn7Kr6ZZuADrajk/E8DKyPD+RtV3PH3RM/5Oyx3f1yuzsrX66JmKowr3Ex+BINJPULWK9wb43DqlyvvVZebduzPz1Sxl++XPOVfmfGZrq8fpfgCZ+yptmrdPXTaeLFMzTYvzlVeyPg458WwvtPWau5o9yI+RHMT7lLexJuPbez+oGqa9uXVMXTcTCxOYv5FXEePPMR6z9CYuqnay211Q3Li7Y2/hXbmBRc8NSuz3fhKo58KafZ72Lm081mqITvDV+LGp2q58dvn0eC4HKpvQTMulGdbwN/6LcuVRTTVd+D5n3rzU1RVETE8xLXTZvV4963dtVTRdoqiqmqJ8phONrtIahZ27GHRhR9cqaO5F6qeaY96Y0/LotUTRW1zxjw7lahkW7+LTv02n93e7TOu4mVl6Zplq7FeTj83K4j7mJV9h2tQ1HJ1XMvZmZdqu5F6ea66vOZdWJ5R+Ve9fXNa3aDpcaZhU4++8x2z8XLNek39P8ASvnq/Uwpl/S678BvnSa/+KYccf7ynzd+sdcC9+WV6qfsafmcvmieaKZ90PpcHnGQAAABxPk5cT5A0H6x9ts78fc/al0nd1j7bZ34+5+1LpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJV7NH9fvTr/Gcf9pFSVezR/X706/xnH/aBupAAAAAAAAAB5+u6Rj6/o+dpeXRFeNmWa7NcTHpVEx/m0mdXunWodLt/azt3ULFVv4teqmzVxPduWpnmmqJ9Y4bw0L9obs8aJ1025Nm9FvE3Bi0VfEs+KfGmfvavbTM/kBppkZz1I6R7t6U6xd03c2kX8SqmqYt5HdmbN6Pvqa/KYlg/dn2eAOB9026q6ooppmapniIiPGZWM6H9jze3VTNxM3U8S7oe2apiqvLyqO7cuU+y3RPjM++eAeH2ZOguodat8Y9FyxXTtvT66bufkVRxTMRPhbifWZ/U3A6bp2NpOBj4WJZos42PRFu3bojiKaYjiIeDsDp/oXTXbWHoOgYVvGwsaiKfk08VXJ9aqp9ZllAAADp6vhRqWl5uHPH/aLNdrx/4qZj/N3AGiXf23cjae89d0XKoqou4WXctTFUceVU8Sxtfbt19nnUb2rVdRtv4tWRjXqYo1GxZo5qtzEeFziPTjzULmOJnwBxE8O7pWoV6ZqONl2+e/ZriqOPdLp8D5MRMbS50V1W6orp7YXO0DV7OvaRiZ9iqJpvURNXun1enzEIL6AZ+u6lrf1g0/Tc3UbV7meLFE1RZn2zPlEJ4yMe7i3q7N63Vbu0T3aqao4mmfequZjVWa58G++Hdatani0zv7UdsPzcuJ8XLEWEAH0e1s/IjF3RpVzx/n6Y/LLxZ8npbc/pBpX/APJt/rdlj7ylgapEfY7vlLYHjVd7HtT7aYfq/DD8MWzH/DD91xjseb6u2QB9fAABxPk5cT5A0H6x9ts78fc/al0nd1j7bZ34+5+1LpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJV7NH9fvTr/Gcf9pFSVezR/X706/xnH/aBupAAAAAAAAAAAB52saDpe4MSrE1XT8XOxqomJt5Nqm5T+SYQvq3Y46PaxmV5V7alFu5XPNXwF+u3TP0RPCeQEW7O7OnTPY12m9o+08Ci9RPNNd+n4aYn2xNfKUaaYoiIpiIiPCIj0cgAAAAAAPi9Zt5Fqu1dopuW64mmqiuOYqifSY9VROrnYJ2tvfU8jVtsalXt7NyJmq5Yi338eqqfXux4x9C3wDWnd+pyb3ou1U290aJXb58K/g7kc/QkLYX1ObTMHJt5G8tz16hTRVFU4un2/gqK49lVVXj+ReoBjGy+nu2un2lW9N25pGLp+NRHd/kqI71X4VXnV9LH9/9HdF3zzkVc4mfEfJvWoiOfn9qRxwrt03I2qjdkYuXexLkXbFU01Qp7rfZ73dptdc4lrHzbMTPyqLkU1cfNLGo6TbxmqKfrHkRPPHivNwcI+rSrMzvG8LfZ491K3Ty1RTPx2U4xOgO8L+Feyb2PYx/g6Zqi3Vc71VXHp4Iyy8W9g5FzHyLdVu7bnu1U1RxMS2KcI/3t0f2/va7OTk27ljM/wDGsT3Zn5/a6b+lU8n8LtSGl8fXovT9ujemfDuUliefakzotsnK3TumzlTaq+t+FPfuXJjw73pEJYwOzJolnJivL1HKv2YnmKKfkz9M+qYtA29p+2tOt4GnY9NnHtxxER5z75n1cMbTK6a+a52Qy9d43x72NVYwomZq6bz3PTopiiimmPKI4fQJxq0AAAAcT5OXE+QNB+sfbbO/H3P2pdJ3dY+22d+PuftS6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACVezR/X706/wAZx/2kVJV7NH9fvTr/ABnH/aBupAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcT5OXE+QNB+sfbbO/H3P2pdJ3dY+22d+PuftS6QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACU+zZci3176dVVeX16xo/LXx/mixl3SvV/rB1M2bqszxTg6viZFU+6m9RM/oBvQHEOQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHFUxETMzxEeLl4u8NTp0TaWvanXV3aMHBv5FU+yKLdVX+QNE+rVRXqmbVHlN6uf+qXTfVyqa65qqnmqrxmffL5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfVuuq3XTXRM010zzEx5xPo+QG9Hpfumje3Trau4aKoq+uem4+RXx6V1UR3o+irmPoZaqH9T46hxuTpNm7WyLvezNs5c026Zq5n4vema6PyV/CR+RbwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABB3a+3XG0uz3vO/Ffdv5+PTptqIniapv1RRV/wBE1z9CcWv76o/1Ciqvamw8a7E93vatmUxV6+NuzEx//rPj7gUCnzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABM/Zf6vXejvVnSNUvZE29Cz64wdUpn7GbFcx8uffRVxX9Ex6tytu5Tdt010VRVRVHMVUzzEx7YaA20HsNdfrG+dmWti65nU/wC0+g2+5ixdn5WXh0xHdmJ9arf2Mx592KZ8fEFvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeZuPX8Da2g6lreqZFOPp2nY9eTkXap8KKKKZmZ/JDSP1W6i6l1W3/re7NUni/qN7vUWo8rNqmO7btx7qaYiPfPM+q5Xb86+Wb9u10v29nU3OK4va5XZq5iJpmJt48zHrE/Lqj04oj2woEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9jau6dV2VuLTtf0TMuYeq6depv2L9HnTVHtj1iY5iYnwmJmJeOA3Q9n3rzonXTZmPqWJdtWNdxqKaNT03vfLx7vHjVEec26p8aavonxiUutE2wt/a/003Rhbj21n3MLU8Sr5NdPjTcpnzorp8qqJ9Yn9fEtsnQDtRbS65afYxbd+3pm7aLfeydHvV/KmY86rNU/zlHr4fKj1j1kJ1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA54AVu7WPaWw+i21ruk6NlWrm+dTtd3EsxxV8TonwnIrj048e7E+dXpMRLzO0r2w9A6UYOfoG2Mmxq2+JibXctzFdjT6pj7O7PlNceluPX7LiPCdWuu67qW5tXzdX1fNv52p5tybt/Jv1d6u5XPnMz/AOuAdXLy7+flXsrKvXL2TfrquXLtyqaqq6qp5mqZnxmZmZmZfiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADsYOflaZl2MzCyb2Nl2K4uWr1muaK7dUeVVNUeMTHth1wF6ehf1QDN0i1j6L1Px72o41PFFGt4lETfojy/lbfhFz8Knir3VSvbsrqPtPqNp0Z+1tfwNWx+Imr4tdiqu3z6V0fZUT7qohopehouvaptzULWoaRqOXp+fanmjIxL1Vq5T81VMxIN93PI1UdPe3t1P2haoxdanB3Ph0z9lqFM28iI9kXaOOfnqpqlPm3PqkW0sqKKdf2frOBXPhNWFetZNMf8ANNE/rBdsVjw+3t0ayaYm7qWrYvP3N7TbkzH/ACd53v4dHRP+0uX+bMj9wFjhXH+HR0T/ALS5f5syP3D+HR0T/tLl/mzI/cBY4Vx/h0dE/wC0uX+bMj9w/h0dE/7S5f5syP3AWOFcf4dHRP8AtLl/mzI/cP4dHRP+0uX+bMj9wFjhXH+HR0T/ALS5f5syP3D+HR0T/tLl/mzI/cBY4Vx/h0dE/wC0uX+bMj9w/h0dE/7S5f5syP3AWOFcf4dHRP8AtLl/mzI/cP4dHRP+0uX+bMj9wFjhXH+HR0T/ALS5f5syP3D+HR0T/tLl/mzI/cBY4Vx/h0dE/wC0uX+bMj9w/h0dE/7S5f5syP3AWOFcf4dHRP8AtLl/mzI/cP4dHRP+0uX+bMj9wFjhXH+HR0T/ALS5f5syP3D+HR0T/tLl/mzI/cBY4Vx/h0dE/wC0uX+bMj9w/h0dE/7S5f5syP3AWOFcJ7dHROI/pJl/mzI/debndvvo7iUzVZzNazJjyixp1Uc/880gtCc8KL7k+qTaDZprp25sjUsurypuajlUY8f8tEVz+lXnqL23uq2/Ka8fE1OztvT6uYmzo1M27lUe+7VM18/gzSDZh1G607F6UYlV/dW4sPBvRT3qMTv9/Ju+zu2qeap+fjj3tfvXrt17j39aydD2NbyNuaBc71FzLmuIzsmmfTvU+FqPdTMz/wAXoqRmZuTqOVdysvIu5GTeqmq5evVzXXXPtmqfGZfgDmququqaqpmapnmZn1cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADOdo9P72t24ysuqbOLP2Ph41uq9eos081cs/TtNydRvRYxaear6fGWDCZc7pXpt3HmnFu3LV7jwqqnmEWa3ouToebXjZNPFUeU+kw6rGZavztRPVIavw1n6TTFeTT7M98dYeaAykAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/bEtxdybVE+VVURKyemWKMbT8a1RHFNFuIiI+ZWqzXNu7RXHnTPKyWjXpv6VhXZ867VM/oQusRO1LaXo0mj1mRH9W0fLq7yM+rODTVYxMqKflRzTMpMYZ1Moirbkz6xXCNwauW/TK8cV2Iv6Rfpnujf5dUHALY86gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOY81kdvfaPT/xNP6lbo81kdvfaPT/xNP6kPrHuU+bZno0/E5H5Y+r0mHdSv6OV/hwzFh3Ur+jlf4cInE++p82xuIv5XkfllBgC3PNoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADmnzWR299o9P/ABNP6lbqfNZHb32j0/8AE0/qQ+se5S2Z6NPxOR+WPq9Jh3Ur+jdf4cMxYd1K/o3X+HCJxPvqfNsbiL+V5H5ZQYAtzzaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADmKZqniI5mfR+vxTI/8C7/ySD8RzMTE8THEuAAAAAAAAAAAAAAAB++JhZOffpsYti7fvVTxFu1RNVU/RD1Nb2dr+26aK9X0fNwqLkRNNV+zVTTP0+QPEAAHZxcDKze98Xx717uxzPwduauPyQ69VM01TTVExVHhMT6A4AAAAAAAAABzT5rI7e+0en/iaf1K3R5rI7e+0en/AImn9SH1j3KWzPRp+JyPyx9XpMO6lf0br/DhmLDupUc7bufhwicT76nzbG4i/leR+WUGALc82gAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM16YdLNydW9z42g7cwq7165VHwt+aZ+Cx6PWuur0gGLaVpOdrmoWNP03FvZebkVRRbs2aZqqrmfSIXA6WfU+N17ktY+fvTU7W38O5He+KWqYvZXHvj7Gn8sre9A+y3tPobj05mPE6lua7b7t7U78eNPPnTbp+5j9MpQ3pv/AG1080mvU9y6xiabh0xPFV+5ETXPspjzmfmBHnTvsrdL+m9iiMHbeNnZsR8rM1KmL92Z93e8KfohJ3+x+3Yp7v1i0vu8ccfFLf8A5KRdTPqi1i3Rk4Wwtv113fGmjUNTmIpp/wCKm1Hn9MoW0TtvdYsvXdOs3tdw6rN7Jt010fEbfExNURMAux1y7JOyOpu3c65pOjYej7notzXi5mHbi1FdceVNymPCqJ8vdy1Ma1o+XoGrZmmZ1ubWXh3arN2ifuaqZ4mG+fBvVZOFj3q4iKrlumuYj2zES1D9szGs4vX7cdFmiKKau5XMR5czHjIIBAAGQbO2Rr+/tas6PtzS8nUc+7PhbsUTV3Y9tU+ke+WxTo52A9q7bxsTUt+Xq9c1fimurCoqmjFs1efd8PG59PgCg2wOje+Op9yqna23czUKKJiK7tMRTbp59tVXELCaf9Tt6lZWHbvZOr7dxb1VPM2a71yqqn3TNNHH5GzDSdH07b+n2cDTMLHwsGxT3bdjHtxRRRHuiPB5eRv/AGvibgwdv3tf02jWs7n4vhTkU/C3ePGeKefcDTz1d7PG+ui9/ncWmRVptVUUWtRxavhMe5Mx5RPnE+6YhFTe5vvaGn782lq23tTsW72JqFiq1MV0892qY+TVHvieJaOt1aJXtvcmq6Rcq71eDk3LE1ccczTVMA8gAAABZXs7dkPcfWHMs6prVvI0baEU9/45VTHwmT/w26Z/XPgy/sZdmK5v3Wre9N2adcjbOBVFWJj5FvinPue3x86Kf0y2YV14ekYPerqsYmFjUeczFFu3TH6IgGAdMug2wukmPFO2tBsWcqae7Xm3o+FyK/nrnxiPdHDM9xbZ0fd2kZOk63p2Nn6dk0zRcsZFEVUzH+U++FNO0H27rW19Sr0HptGHqOTa5i/ql6PhLNNXstxE/K49ZlZroPqWua10n2xqu486vN1fUMaMm7erp7sz355iOPdEg1hdqnoJV0Q33NrBq7+3dUiq/gTM81W6efG3V76Z8PegVfX6o9uaxXqO1NAop5v2rVzIuVc/Y96YiI/QoUDb32Odubc0/oXtzN0fCsRezrdVeVkTRE3LtzvTE96fPw8uFUu3z0c0rZu49N3doti3jWtbqrjJx7VEU0U3aePlRx99zzKZfqeO+I1bp1qm17lNNNzSMmbtv5XjVRX4zPHulm/bk2j/ALS9CtRyqLXfvaPfoy4qiPGmn7Gr9cA1KgAPc/2O3B9Zp1n6zZ31q54+NfAVfB/l4WD7J3Zg1LqvuLE3Dr2Jfxdm4NcXZu10cRm10z/N08+ntn2Npl/RtLp0S5pdzDx6dJizNqrH7kRbi3xxMceXHANCgzLqxh6bp/Ujc+NpFFFGmWs25TYpo8oo58OGGgD6t26rlUU0UzVVPpDMNF6dapq1qL1cU49ufL4TmJl13L1FqN652Z2DpuVn1+rxbc1T8GGiVcbpFR/8xqEx7qKP/N85XSKPPG1Dn3XKOP1MX/UcffbmTv8AsnWuTn9T+m8b/VGFmibt2iiPOqeFktGszY0rCtT50WqYn8iGMnYuraPl2q67E3bNNcc3LfjHmnDFju41mPZRH6kfql6m5TRyTvC5+j/Tb+HdyPtNE01dI6/q/VhvUuqKduVx6zXDMkd9WLlVOnY1MVTFM1TzDAwo3v0x8Vv4ou+q0nIq/wDzt80RW7dd2uKKKZqqq8IiPVlen9Odaz7cXPgYs0z4x8LPHLI+l+g496i5qN6iK66J4o70c8T7UppXM1Kq3XNu3HY19wzwPZzsanMzap2q7Ijp0+Mogxuk2oVzPw+VYop9tPMvSs9IbX/e6lV81NuEmiPq1LIn+rZcrPA+jW+21zecz/iYYZg9M9FxaI+FpuZFftqniPyPSjY+g8RH1vtshHRVk3qp3mqUva0HTbNPLRj07eUT9WKZfTvQsqniMebU+2iphG5OmV7TbFzKwb037VEczRMcVRCYnExExMTHMS7LWdetzvzbwwNR4S0vNtzT6qKau6aem3y6Sq7VTNMzExxMeEw7OnYN3Us2zi2Y5ru1d2GfdRto0YVX1yw7fds1z/KUx6S8zplYi7uKmqY57lM1QsH2qmqxN6lpyeHrtjV6NNyO+qOvjE98M40vpnpWLYpjLiq/e48Z54iHjbt6b41jDuZmmTVTNqOarU+PMe6UoPyyKIuWLtE+VVMx+hX6M29FfNNTcmVwrpd3FnHpsxHTpMdsT479qsNVM01TTMcTHg9vQ9qalr1UfFrM/B8+Nyrwphm+3+n0Zep5GXqFE041Nc9y3MfZpLxsWzh2abNi3TbtU+EU0xxCVydTij2bfWWvtB4DuZU+uzp5aN+kd8/tCM7XSKZsx8JqMU3fZTRzEfSw7cu0c3bl2Phoi5Zq+xuU+UrBvH3RhWs7RMui7TExTRNUTPpLDsale9ZHPO8Ss+r8DadOJVOLTyV0xvE7zO+3jurm9nQ9s5+vX6aMa1Pc9a58odjbO2ruvapFinmLFFXy6+PKE86fp+PpmLbx8a3TRbojjiI80hm58WPZo6z9FJ4W4Rq1aZv5EzTaif1q8vh8WFaZ0r06xbpnNvV37nrFHyYehe6a6FdtzTFq7RV6VRXM8MvEJVmX5nfnlte1wzpNqj1cY9O3xjefnPVCu6OnORotirKxbk5GPE/KjjiqmGCzHErR10U10zTVETTMcTE+qF+oe1rWj5VOVjU8WL8zM0x5UylsDPm5Pq7va11xfwfbwrc5uDG1Ee9T4fGPgwQBLtbAAAAAAAAAAAAAAAAAAAAAAAAAAAADb32NNH2tpvQ3QsjbsY9V/Lpm5qF6jiblV/mYmK58/DyiJ9GoR72g713HtazkWdE1zUdOs5McXaMTIqtxc+eInxBtK7QPbD2x0goyNJ0ebGubrp8Jxbdz+Sx5/wDuVR6/8MNaHVPq3ujrDuW5ru5s74a/x3LNi3HdtY9HpTRT6f5sJu3a79yq5drqruVzzVVVPMzPtmXwA9TbfP8AtFpHEcz8bteEfhw8tN/ZM6eW+o3W3b2FlWJvadg1znZNPp3bfjTz7u93Qbg9I+1WDzExPwFHn+DDUh20557QG4vGJ8Lfl8zbjqOdY0nTsrOyKoox8W1VeuT7KaYmZ/RDSL1i3zc6jdRte3FXx3czIqm1x6W+Z7sfkBgqQ+knRbdnWbXqdM23p9y5aomPjOZXHFnGpn1qq/y82V9mvs85/Xrdd3Fru3sHb2DT383Pot97j2W6efDvT+jzbY+nPTfb3Sza2Jt7bmFTjYNiPlVedd6v1rrn1qkGO9EOh23eh+1LWkaPapu512IqzdQrpj4XJr9ZmfSmPSH4dau0BtLolotzK1jLt39Vqp/7Pplm5Hw12ePDmPuaffLAe0p2stC6N6fk6Rot/G1LedUd2MWKu9Ticx9lc49fZS1W7p3Tq289dzdb1zNu5upZlc3Lt67VzMzPpHsj3AnLq32y+ovU6u/i4udO39Er5p+JadXMVV0z4cV3POr9DwOyrpFW5+v+zbN/Iu0xRlTfqriue9PcpmriJ98oUXx+p49KLWdm6t1BzrczOFXOHhRVT4TVNPNVcfN5A2C52XRgYOTl3P5uxbqu1fNTEzP6mi3qDrNvcW+Nw6rZji1m5t2/THsiqqZbk+vG+MTp70n3PrWVXRTNGJXZs0VT43Llcd2KY9s+PP0NJd2v4S5XV99MyD4AAW37IvZSnqtdo3fueLtjbGHfj4DH7vjn10zzMcz5UR5T7UC9HOm2pdVeoOjbd0/FuXqL1+mrKqpjwtWImO/VM+kcN1+39CwNsaLhaRpmPRj4GFaptWrdEcRFMA/a1awdC0ym3bpsYen4VriIiIot2rdMfkiIiGuHtpdqDH3xep2Rs3UovaBYnvZ2Xj1T3cq5HlRE+tNP6Zej2ye1Zqedq+r9OdqXqcfScefi+o5lH85frj7K3E/c0xPh71L9u7f1LdmuYWkaXi3cvUM25Fu3atU96qqZ936QSX2bOk97q91R0rSrmLfu6Rj1xkZ923HhbtRPrPvnwblbFnG0vAt2bVNFjExrcU00x4U0UUx+qIhGXQLonovRPZGLpeBj0zqmRRTd1DLq8a713jxjn72PKIYD2tO0bp/SHbF/QsLuZO59Xx67du13v93t1Rx36o+nwgGv/tT9T46p9X9a1HHrirTcSr4ni92eYmijw70fP5oVfVyubtyqur7KqZmXyCzXYV3fk7d66afp1vicfW7NzEuU1TxHhHeiY9/yW0vdun2NW2vrGFk2KcixkYl2iq1VHMV80T4NJXSrdWRsnqNtnXsWeLuFm26/omeKv0TLePh5NGdiWMmj+bv26blPPsmOf8waFdWxqsXVczHm3VRVbvVU9yY8Y8fJa/spdkXM6h6pb3HvnS8vE2nZpi5j2bkfBzn1envij2z6rC7c7Fmm3euGub33B8Fc0KM6rKwNLiIqpu1TPPNz2UxPlC1+o6lgaBpl/Oz8mxhafiW+/cvXaoot2qI9ZnyiAc4Gn4Og6ZZw8OxZxNPxLfdt26Iimi3REfohQ7tfdr+mbeRsbp7qUVd6Jt6lqmPPhx5Tat1frmPmeF2ue19TuWmNo9Otar+tE0zGfqONM0/GOfuKavPu+32qO1VTXVNVUzNU+MzPqDmuuq5XVXXVNVVU8zMz4y9PQdBytezaMfHoqmnn5dcR4Uw6OJi3MzIt2LVM1XK54iIT7tHblrb2mUW+7E5FyO9cq48efYws3LjHo6dsrVwrw7VrGT7fS3T70/4jzcaDs7TdDtUdyxRdyIjxu1xzP0exkMRwCsV3Krk81U7t8YuHYxLcWseiKaY8APIcWScAAI56s/7jifPKRkc9Wf8AccT55ZeB+IpVri/+T3/KPrDz+l24LOP8Np+Rcpomuebc1TxzPsStE8xzHjHtVdorqoqiqmZiqPWHrY+6dYxYiLWo5NNMfc9+eErlab62ua6J23a+4e46jTsWnEybc1RT2TE9dv1WMcTVFMeMxHvmUCWt17kz5ps2MvJrqq8IiifFkWBszcupW+/mZ9+xTV503K5mWDXp8Wvva4hbsXjOc6eXBxK6/lEfNJ2TquDh0zVfy7NuI9aq4eVVvnQKapj642p98c8MTo6UV3Ko+G1Svj14p5ftd6R4s0cW9RvRV76I4cabOJHvXJ+Ttu6jxHX1s4dNMfGqJn6wz/CzsbUbFN/FvUXrVXlVTPg7DH9qbcq23iXLE5E3oqq5jw44ZAwrkUxVMUTvC04Ny/cx6K8mjlrmOseEvK3JifHtEzbPHjVbmY+hGvS2x3NayefOimYSxm/7pkfi6v1Iv6Z/bzP+af1s7Gqn7NdhU9dsU/65gXe+d4+XVK4COXYB187OsadjV5GTci3aojmZkiJmdoca66bdM11ztEP3mYiOZmIj3sF3xuqzbx6tLwq6b2Vf+RV3Z57v/wC2E7r33mavkV2ca5VZw6Z4iKJ4mr533060j66az8Yu81UWPlePjzKXtYHqaPX3p7OuzW+ocWzqeR/pWm0+/PLNfw79o8u9JWzNvRoWlURXH/ab3yrk/wCTJDjgRdyublU11dstg4WJbw7FGPajammNnEzERMzPEQ4orpuU96iqKqfbEsI6i7l+tmD8SsXOMi9HjMT40w9jZU1Tt3EmvnmY58XZVjzTai7PfLAtaxbu6jVp9uN5pp3mfCfBkLFuoGHTlbcyKqo8bfyollLwN6TxtrP/AAHzHmYu0zHjDt1mim5p9+mrs5avor1PmE+YuDzOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAANiv1Ojp78S0TcW9Mqzxdza6cLFrn1tx41/8AVEKD7M2pqO+d06Vt3SrfwmfqV+mxbj2TM+M/NEcz9Ddj0u2DhdMdh6JtfAiJtafYiiuuP+8uT411fTVzIIx7Y+/Y2L0O1v4K/wDA52r8YGPMefNXjV/0xP5WtnoB0M1jrpvW1peHRXZ0nHmLuoZvHybNvnyifvp8oha/ti06v1q6ubU6V7Wmcm/iUTfzIp8aLM1z411z6RTTC2nR3pFoPRnZ2Nt/Q7MR5XMrJq8a8i7x41VT+qPSAev096ebf6X7YxdvbcwaMTAx48ePGu7V611T61SrF2vu1lX05pq2dsrMs1bluxPxzLo4r+JUz9zHp35/Q9Xtkdpmelmjf7KbYzKad26hR/K3aPGcKzP3Xurn09keLV1mZmRqOXey8u/cv5N+ua7l25V3qq6p85mZ85Azc3J1LLv5eXfuX8q/XNy5duVTVVXVM8zMzPnL8ABzTEzMREczPlDdD2Y9mU7F6I7S034OaL13FjLvRMcT37vy559/jDWX2U+l0dUur+j4WTYm7pOn1xmZkR95T4xH01RENw+TkY2lYF2/dqps4mLamuqfKKKKY5n6IiAUA+qL9QLtefoGy8e9TOPbt/Hcm36xcmZij/p/WoSk/tBdR56qdV9wbioqirEu3vgsWYjjmzR4UfoRgA5ppmqqKYiZmZ4iI9XCdOyb0ljqz1c0zFyrdVWj6Vxn5kx600T8mn6auIBe7sYdC6elmwY1vU8eKdya/RTduzPjNqz50UR7OeeZZP2peutjonsG5exu5c3BqnesYVqZ+x8PlXJ91P602ZOTj6XgXci9VRZxMW3NddXlTRRTHM/REQ01dpTqzk9XeqOqar8YmvS8er4vg0UzPcptU+UxHpM+cgivUdQyta1LIzcq5XfzMq5NyuurxqrqmWzHsT9nC1sLb9jfW4cX/wCJtUtc4tu5/wDKWKo8J49Kqo8/ZCvnYp7OuVvzdePvPcOl1TtTTJmvHm/HFOXfj7GIj1pp85n2tmmsavp+29JydS1HJtYmn4dua7t25PdpopgGHdZerOjdG9k5m4dWufLiJt4tiPsr92Ynu0xHs9Z9zTFvbeGp793RqW4NXybmRnZ12q5VVXVz3YmfCmPZEexJPaV65aj1p39m5Xxm5G3sK5VZ07G54pptxP2cx99V5yhYAHMRNUxERzM+gPuxXXbvW67XPwlNUTTx58+jeR0lz8zU+mW0srULNyzm3dNsTdouU92qKu5EeMenPmpz2P8AsiUWbeBv7fmD3rtURe07TL8eFP3t25T+mIn5194iKYiIiIiPKIB52v69p22NHzNX1bKt4mnYdubt69cnimimGrPtP9rTU+sV+7t7Qu/g7Ps3Jnu+VzMmJ8Kq/d/wrl9uHa+qbi6G6jf07MuWbWl3acvKs01cRetR4TE+3iZieGpQAH3Ztzdu0UR51TwPsRMztCRulei038m/qF2jn4LimjmPWUtvF2rplGl6Hi2aKYiqaYqqn2zL2lSzL3rr01dz0Xwzpkadp1uz/VMbz5z1/wDBh28t7U7dmnHx6KbmVXHM97yoZFrOo0aVp1/KrmIiimePn9FddSz7uo5l3Iu1zVVXVM8yydOxIvVTVX2QheNOI69Ls02Madrlff4R/wCvQzt2avn3qrlzOvR3vuaapiI+h+mm7x1fTb9NyjMu10x9xcq71M/Q8AT/AKi3ty8sbNORqmbF310Xqubt33lMG3+pv1yyrGLk4kUXLk93vUT4JEVz2r9v8H8ZCxceUK/qViizXEURtu3NwPq+XqeLcqy6uaaZ2if0cow6uZMRRhWPWeapSeibq5/vmF+BLr06N8illcbVzRo13bv2j+6NGV7T2Vk7iufCV96zh0+dzjz+Z+Oytuzr+q0UV0z8Wt/KuT7vYnnFxbOFYosWKIotURxFMQlc/O9T/Do7fo19wfwnGp/8vK+6iekf9p/Z0dH2/gaJYotYtiiKqY4m5MfKq+eXqAr1VU1TvVO7dFmxbsURbtUxTTHdAHL5i5TM8RVEz7OXx27w+gAdPVL1OPp2Vcq8qbc/qRd0zvxVuDLpifCuJmGcb8y/im28rieJuRFMIz6a3Jp3HRxP2UTylcS3vi3KmveIs3l1/Csx/T1+c7JxARTYT8MvLtYWNcyL1UU27cczKC94btyNwZlVEVd3EtzMUUUz4T75Zh1V1mqzZsafar47/wAquI/QiZPaZixFPrqu2exp/jziC5cvzptidqafe+M+HlDmEy9LNO+LaTeyZ879Xh80IapiZmIjzWH2hiRh7ewaOOJmiKp+eXZqtfLainxlhejzEi7qVV6Y9yn+89HuPm5V3KKqojmYiZ4fQrrdsoZq2pq+5tdu379q5bx6rnM13PCIj3JewsS3gYlnGtRxbtUxTDsDJyMqq9ERPSIQej6BY0uq5domaq653mZ+gxPqHmRi7bv0+HN2YphlczFMTMzxEeqGOo25qNWy6cTHq5sWJmJmPWXPBszdvRt2QxOLtSt4OmXOafarjliPP9mBz5gLU89gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALUdgbadzXettvVJsd7H0XEuZE3Jjwprq+RHHv8ZbN97atf0HaOs6hi01VZljGrnHppjmarsxxRHH4UwrR2Aunc7Y6VXtyZFuKcrcN6a6OY+VTaomaY+iZ8Vsrtmi/TFNymKqYnnuz4xIIU7OvRW9010fM1zcV6M/fW4KvjGpZ1fjVT3vGLUT6REz48er57TfX3B6IbIvXbV2i5ubUaKrenY3PjE+U3Zj72n9MpI6ib+0bpntHUty65kU2cHCtzVxM/Ku1/c0U+2ZnwaYurXU7WOrW9dQ3Hq9+uuq/XMWLNVXNNi1z8miPdEAxrcG4NS3Tq+Xq2r5l3L1DLrm5dvXauaqpl5gAA9vaG3cndm59J0XEt1XL+fk27EU0+fFVURM/kBsX+p8dMK9vbD1HeeZbiMrXrnweN7abFE/51JN7Y+/rOyOiGuWqcibWfrFMYWPFM8VfKn5Ux7uI4+lM20tu4m0ds6ToeDaot4unY1GPRTTHEfJpiOfpnxawu3X1Ptb26r16Lp+VXd0/b9v4rVET8ib3PNfh7Ynw59wKsVT3pmfa4ABs0+p47Jt6R061fcldFM5Gr5MUUXOPGLdEcTT+VrLhuh7MWgWNu9DNm42PTTTF3DpyKuI45qr8ZkGBduXqDd2Z0ZyNPxLtdvN169GJFVE8TFuPGuf1R9Ki/Zj7POrdZ96YV/MwMi3tDEufC52bVTNNFcR4/B0z6zM+Hh5Q2HdYuidvrhvjbePrVyq3tPb9NWRlWKeYqzL1cx3aIn0piI8Z9/CY9J0jTNs6VZwNNxMfA03Fo4os2aYot26Y93+YONJ0rTdraLj6fgY9nC0zAtRRbt0RFNFqimP/AF4tdnbT7UOFvaK9g7SyKruk413nPzaJ4pyK6fKin20x7fWWedsztU6Ta0DM2DszVIytRy5+D1DNxLnyLNET424qjzqn149GuuZmqZmZ5mfOQcAALjdibs3U7+1ejfW5MSmvbum3uMXHu08xl3qfXj1ppn9LGezt2Pta6v2bGt6vcuaXtqa4/l5o+Xfp9YtxPn7OfKPe2g7P2jpOxNtadt/RManG0zAtRatW48/fMz6zM+MyDt63renbX0bL1XU8m1iadhW5uXbtc8U0UxH/AK8FRej/AGs8nqx2jcjRbNVePtO7iXLOn48xETXcpmJ+Eq98xE+HpyiLt19frm5Neq6faFmz9Z9Nric6uzV8m/ej7mZj0p8uParR0S3VOy+q+09a+FqtUY2db79VPjxTVPdn9Eg3H9V9tUbw6b7o0S5EzTm4F2mIp85mKeY/TENHObj1YmXfsV0VUV2q5pmmrziYnyb87dy3kWablExXauUxVE+kxP8A+ml/tKbLv7G6w7l0+7TMW7uTXkWvk92O5XVMxwCJXqbdsRka1h26vKquHlvV23epsa5hV1TxTFyOXXd35J28GXgcs5Vvm7OaPqsZapii1RTEcRERHD7fNuqK6Kao8YmOYfSmy9P09kbI56rahNnDxsSmuY+EmapiPVEKYOqekXcvEx8y1TNXwPNNXEeiH58Fm0zl9RGzQ/HcXY1eubkdNo28tgBIKa9nav2/wfxkLFR5QrrtT+kGD+MhYqPKEBq/3lPk3F6Nvwl780fRyibq3HObhfgJZRT1WjnUMHw+5/zY2m/iITfHEb6Pcj40/VlHT3RqdM0Si7NMfC5Hypn3ejLnnaFEU6PhxHl8HD0WNfrmu5VVKe0nGoxcK1ZtxtEUx9HxcuUWqKq66opopjmZn0RlujqZNNdeNpU8ccxN2Y8/mZH1Fy7uLt6v4KZj4SqKZ49iCZnmeZSem4dFyPWV9VD444lycK5GDizy7xvM9/Xuh6VzcGp3aqqqs7ImavGf5SXobZzM3L1zDtTkXqpruRz8ufFjjK+ntMVbkxefSUtfppotVTEdzXOlXb2Rn2aK7k9ao758U8RHEQ5BUXpJGHVjOqpt4uLTVMRPNVUMb6b/ANI7PzOz1Pyarut9yfsaI4h1um39I7XzLFbo5MGfJpPNyJyOK6Z8K4j5JzAV1uxB/UuZncNyJmeIjwYWzPqV/SK780MMW7E+5p8nm7iP+aZH5pd3ScecrUce1H3VULJY1qLOPatxHEUUxHH0K8bW+3uHz5d9Yun7GETrEzzUw2H6NbVMWL9zv3iHIMW3VvGnbN21RcxqrsXKeYmKuEVbt1XKuWiOrYmbm2MGzN/Iq5aY72Uvi7dosW5uXK6aKKfGaqp4iEUZHVvKqiqLODao58pmqZ4YfrG6tT1quZyMmvuT9xTPFP5Eha0q9VPt9IUzP9IOnWaJ+zRNyry2j5yzzevUGzVYrwdMud+auaa7senzIqqqmuZmZmZnzmTxmX3VZuU096aKoj2zCbx8eixTy0tU6xrGVrF/19/u7IjsiH5gMhDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD1ds6Flbn3DpmjYduq5lahkUY9FNMczzVVEc/Rzy8peHsC9DL+q67PUvVbXd07T5rs6fRVHjdvccTXHuiJmPnBsA2ZtyztDaei6FYimLWm4lrHjuxxEzTTETP0zzL3KqoopmqqYimPGZn0c+SnPbI7UlnYemZmxdsXou7kzbc28zIpnwwrdUeNP4cxP0QCuXbV7QEdT93U7Z0TImrbWiV1UzVTPhkX4niqvj2R5Qqo5qqmuqaqpmapnmZlwAAAuX9T56X07j3zqW8s2x3sPQqIt49Ux4fGKv/KnmVNG3bsU7Pr2n0G0Su/bppydUruZtU0+tNU/J5+iAS/1H3jh7A2Nru48653MfTsWu7z6zVxxTEfTMNHev6ve1/W9Q1PIqmq/mX671czPPM1Ty2HfVE9/3dL21t/aOPe7k6lVVlX4pnxqop8Ij5uZlrgABzTTNdUU0xM1TPERHqDhu17P+Rayei+yK7NcV0fWyzHMTz4xHi1+9nfsV7j6h5mBr278e7o+1Pk3ot3PDIzKfSKafuaZ9Zn6Gz3RtHwdv6XiaZpuNbxsHEtxatWbdPFNFMRxEA7d69bx7Vd27XTbtURNVVdc8RTEeczPpDXJ2xu1jVuLIvbG2LqVUaRb5p1DPx65j4zV/wCHTMfcR6+1Y/tsYm7r/RbULu2Myqzi2K4q1O1bifhLuP5fJmPSJ45j1hqQnnmefMHMzMzMzPMy4ABarsldlrN6qazY3NuTFuY+z8G5FVNN2jj4/XE89ynn7n2y9/spdjq/1A+L7w3xYvYu2omK8TCnmi5mzE/ZT7Lf62yrGxsLRNOt2LFuziYGJb7tNFMRRbtUUx+SIiALVrC0XTqbdumziYGJb4imIii3aopj8kREKG9pXtyxTOo7S6cVRXTNM2cjXOZjx8pizH//AF+R4PbF7Wlrc0ZOw9j5s16VTM0ahqNmriMiYn+bon72PWfVRyZ5nkH6X79zJvXL165Vcu3KpqqrqnmapnzmZcWrldm7Rct1TTXRMVU1R6THlL4Abp+zfv6Oo/R3bOsVcxk048Y1/nzm5b+TM/Txyq59Ua2HVXZ21vHGx5nu97DyrlMc++jn9LqfU5uoGbcztx7LvfymFTZpzrNU1fzcxPdmmI9k88rY9pDadzenRbd2l2LVFzK+KVXrMV+UV0fK5/JEg0qvqiqaK6aqZ4mJ5iS5RNFdVM8c0zMTw+R9iduqw2ztRjUtAxLne71dFMUVfPD3kL9PN22dFu14eZV3ce9PMV/eyma3cpu0U10VRVRVHMTHrCqZtibN2enSex6H4X1e3qWBbmKvbpiIqjv3j93F23Ret1UV0xVRVHExKGN09P8AUcPNu3sKzVkYtczVE0edPu4TUOONlV49W9Lv1zh/G1m1Fu/vE09kx2wrJe0/KsVd25j3KJ9lVMw+IxL8zERarmZ8o4WZuYtm9PNy1RXPtqpiXxGDi01RVGPaiY8piiElGsdOtH91Gq9GntezkdPy/wDqJ9obC1KcrF1C/FNi1RVFUU1/ZT9CYI8gRmTk15FXNUvmiaHj6PZmzj7zv1mZ75EYdWMeYnByY9OYlJ7zdZ0TE1zGmxlUcx6THnEmLeizdiuew4g02vUtPuYtv3p7POJ3dfaubbztCw7lueeKIpn3S9pgOh0XNmax9ar9zv4eXPNmufDifYz58yKIpr3p7J6w5aLk1XsWLd2NrlHs1R4TH7x1h09U061quFdxb0RNFyOOZjnifagjX9pahouVcprsVV2efk3KY5iYWDfNdum5TNNdMVUz6THLtxMyvHnp1iWBxDwxj61TE1zy109kx9JVjjFvTPEWq+fmZlsHSs2zruNfqxbsWonxqmmYiEyRgYsTExjWomPL5EP3iIjwiOIZd7VZuUTRFParum+j6nEyKMiu/vyzExER4fq5ARDZCI+qOi3qMunUKKJmzX5zHpLyOm39I7XzJm1bT7WqaffxrtMTTXTPp5SjHp3p0Y25sumY5mzExHPzpmxk8+JXRPbENXatoU4/EOPk2vduVb+Ux1lLYCGbRQb1K/pFd+ZhrKN/ZVOVuPK4+4nusXW/FjazTE+DzXr9cV6lfqp7Oafq7mlX5xtQx7sedNcLJ41yLuParieYqpif0Kw0zNMxMecJ+2Pq9vVNCx4puRN2zTFFcesI3V7czTTXHcu/o3zaaL17Fqn3oiY/TtZKwfqTod7U9NpyLNPeqx4mZpiPHhnDiYiqJiYiYn0lDWbs2q4rjubO1PT7eoYteLc7KoVeqpmmZiY4mHf0jRMzWsmmxi2aq5mfGYjwj504Z2x9Fz783rmL3a5nme5PES9fT9LxNLsxaxLFFumI48I8Z+eUzc1enl9inq1jieje/wCv/wCTdj1ceHbP7MZ2509wNIopuZVNOVkTHj36eaaZ9zJbukYF+1Nq5h2KqJjjiaId0Q9d+5cq5qp6tm4mk4eHZixZtxFPlvv5+KE9/wC0qNDv0ZOLz8Wu/c8fYywdMvVTLt29Is2Kpj4SurmI9UNLJp9yq5Zia2jeMcHHwtUrt43SJiJ28JkAZqrAAAAAAAAAAAAAAAAAAAAAAAAAAAADc32Wc3RcvoTs76x3rdzGs4sW7sU+dN6JnvxMek8tMiRem/XTfnSa3fs7V16/h4t+Zqrx6oiu1NX33dnw594NnHad7S2mdDdu1YuFVay94Z1ExiYk+MWYn/vbnuj0j1ak9e13P3Nq+Zq2qZFWRn5l2q9duVfdVVTzLubt3jrm+tbyNZ3DqV/UNSyJ5rvXquZ90R7IeEAAAABHm3A9jLcN/cXZ92xdyJpm5ifC4nhPPyaK5iP0NPy+P1PXq/iabf1bp/quXTanLrjK074SeIqr8q7ce+fMHsfVINs3L2JtHcFGNM27HwuLXeifKZmKoif0tezep1C6ebf6obZytvbkwoytOyPSJ7tduqPKqmr0mFUqPqb20IzYuVbw1mrE7/e+A+AtRPd5+x73n9INdGjaHqO4tSx9N0rCv5ufkVxRbsWKJrrqmfdDZV2aOxXpuwacHdO96Leobl7sXLWBVEVWMOZ8ufv64/JEp/6bdDdidJsW3a2zoGNj5FMTE5lyPhMirnz5uT4/RHg7vVHqvtrpHtrI1vcWdRZt0Uz8Dj0zzdyK/Smin1+fygGT6zremba0vI1LVc2xg6fjUzXdv364pooiPf8A5KmV9vfbGodVtE27pOLzta/fnHy9WyYmmZqnwoqop+973HjPopf117S27ut2pXbebk1Ye3rdyZxtMsTxbpj0mv76r3yhaKppmJiZiY8YmAb8dRwMTXNLycHKopvYWZZqtXKfOK6Ko4n9EtUXaW7KGvdItbu6loeNlaptHKq5tX7dua68aZ+4uRH6J9U1dkrtj0UW8TZHUPOiiKYptafq12eIiIjiLdyf1VflX3irF1HFiYm1kYt6nmJjiuiuP1TANIexejm+Oo+rU6bt3bmdk35+yrqtTbtW49tVdXEQvv0B7CWk7LvWNd3/AHLGsaxRxVawLXM41if+Ln7Of0Li4uDi4NFVvFx7Niiqe9NNqiKYmfbxCJernaa6f9HbVdrV9UjL1eI5o0zB4uXp+f0p+mQSrmZmBoOm15GVex8LT8W3zVXcqii3aoiPyREQ1p9qztgZW/8AKytpbLyLmPti1M28jLp+TXnT5Tx7KP1oz68dqreHWzIu4Vd3617Ypr5tabj1eFXsm5V51T+iEDAAAAAlzs0dQp6a9ZNt6vdvTbwbl6MbKjvcRVbufJ8fdEzE/Q3N1U2NQxKqZmi9jX6OJ4nmmumqP1TEtBETMTExPEw2WdiztN6duTRMPp/uXKmxr+HT3cLIv1/JyrceVHM+VUez1BWPtidDLPSLf8ZOjYeRb23qtHw1muqO9RRc+7o73u9kq3tvvbLvbeo6Ebho1ybHxiqmn4hTc47/AMPz4TTHzctQUgRPCRNkb9+tsU4Oo1TON9xcnzo//SOx037FF6nkrSWl6rkaXkRkY07T3x3THhKz+Nk2cuzTesXKblqqOYqpnmH6q7aPuvVND8MXJq7n3lXjT+Rl+D1byaOKcvDt3I9aqZ4n8iCu6Vdpn2OsNuaf6QdOv0RGTvbq7+m8fOEtCPaerGnTHji3ufdMOf8A2sab/wDS3/0Mb7Dkf9E3/uzR/wD7Ef3/AGSCIxzurdEUTGHhc1z63J8mJz1A1qc6MqcmriJ5+D5+T83Dut6ZfrjeY2RuZx5pWPVFNuqa/HaOkfNPQj7SeqeDkW4jPs1Wbkec0eNMu7l9TdFsWqqrVdy7c48KYp45dE4V+J5eWUtb4o0m5a9bF+mI+M7T8u10OqmRTYxsKqmri/TVNVEx5w52b1BsZtm3hajXFvJj5NNc+Vfzo53NuXI3Jm/D3oimimOKKI8oh4tNdVFUVUzMTHrCaowIqx4t3O36NWZfGN2zrFzNwvcnaNp7Kojv8/BaGJiqImJ5ifKYcoK0fqLq2lW6LU1U37VP3Nzz/Ky7G6tYlVuJv4ddNz1iieYRdzTb9E9I3bAweOdJyaYm5XyT4TH+YSOI9/8Aazp3/wBLf/LDpZfV2mmr/s2BFUe2uvhwjAyJ6crLucYaNbp5pvxPlEz/AISeIlr6vZU25ijTrNNfpPfmePoeBV1D1yb1dynK470/Y8eEO2jS79Xb0R2Rx/pNrb1c1V7+EbbfPZNGtarY0fT72TfrimKaZ4jnxmWC9Mo+O5+qZ0z41VeEfOjfU9cz9Xr72Vk13PdM+EMi6fbmtaFqFdrJnu4+R4TV97LM+wVWceuI61SrUcX2dR1rHruRyWqJnbfxmNt5TiS/Ozft5FuLlqumuirxiqmeYefr2t42h4N2/fuRFUR8mn1qlCU0zVVyxHVta9kWrNqb1yqIpiN90F7v/pFn/jJeG7ep5tWoZ1/Iq87lUy6i426eWiIl5kzrtN7JuXKeyZmf7jIto7lube1CmvzsVzxXHuY6Fyim5TNNXZL5iZd3DvU37M7VU9YWawNQx9TxqMjGuU3Ldcc8xLtK7aDunUNAuxVjXZm3z426vsZSjpPU7SsuzT8dqnGvescTNKuZOnXLU70RvDduicbYOdRFGTVFu5379k+U/uzgeNjbq0fLp71rULVVPv8AB1Mvfmg4nfic6muun7miJmZYkWLkztFM/JZa9WwaKPWVX6Yjx5o/dkjFNzb6wdBoqt26qcjLjw+DifCPnlhe4OqGTlxXZ06iLNqfDvz9lP8A5I+vXrl+5VcuVTVXVPMzM+aUxdLmZ5r3yUHiDj63RE2NM6z/ANpjpHl4vR13XsrX8ucjJq+amPKIeUCbppiiOWmOjU9+/cyLk3btW9U9syAOTqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHZ0/UMrSs2xm4ORdxsuxXFdu9aqmmqiqPKYmHWAXw6OfVCb+labb0zqNpuRqFyzTFNvU8Cmn4SuI/8SiZiJn3x5pbr+qFdLaaZmnD1+r3Ri0/vNWgC8/U36opq2oUXsPYWhU6bbqjinP1Di5ej28W4+TH0zKnm8t/bl6ganVqW5dZzNTy554qyLk1RRHspjyiPdDGwAACJ48kubG7TXVDp5pdGl6HujJo0+3HFuxkRF6m3H/D3ueERgJx3B2vOsG49Prwcnd2TYs1/ZVYdFNiufd3qY54QrmZuTqOTdycu/cv5F2qaq7lyqaqqpn1mZfgAAAAAAAP1xcq/hZFvIxrtdm/amKqLluqaaqZ9sTD8gHu7g3ruLddNmnXNc1HUqbMcW4y8iq5FHzcz4PCAAAAAAAAAAAAAAAAAAAA8gB6WJr+p4NPdx82/bp+9prmIfhmanmahPOVk3b0/8dXLqDjFFMTvEdXfVlX6qPV1VzNPhvO3yAHJ0AAAAPqLlceVU/lcTVM+cuAfd5AB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/9k=';
const ICON_URI = 'data:image/png;base64,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';
const gSym = (g) => (g === 'male' ? ' ♂' : g === 'female' ? ' ♀' : '');
// ---- Email OTP (EmailJS) - neeche 3 value apni EmailJS se bharo ----
const EMAILJS = { service: '', template: '', key: '' };
const sendOtpMail = async (to, code) => {
  const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: EMAILJS.service, template_id: EMAILJS.template, user_id: EMAILJS.key, template_params: { to_email: to, otp_code: code, app_name: 'Nexdare' } }),
  });
  if (!r.ok) throw new Error((await r.text()) || 'mail nahi gayi');
};
const ST_BGS = ['#ff4d8d', '#7c4dff', '#ff9800', '#00b894', '#0984e3', '#2d3436'];
const videoToSmall = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto';
  v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Video khul nahi payi')); };
  v.onloadedmetadata = async () => {
    if (!v.captureStream || typeof MediaRecorder === 'undefined') { URL.revokeObjectURL(url); reject(new Error('Video chhoti karne ke liye Chrome use karo, ya 3MB se chhoti video chuno')); return; }
    try {
      const stream = v.captureStream();
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 } : { videoBitsPerSecond: 900000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => { URL.revokeObjectURL(url); resolve(new Blob(chunks, { type: 'video/webm' })); };
      let stopped = false;
      const stopAll = () => { if (stopped) return; stopped = true; try { v.pause(); } catch (e) {} try { rec.stop(); } catch (e) {} };
      v.onended = stopAll;
      rec.start(500);
      try { await v.play(); } catch (e) { v.muted = true; await v.play(); }
      setTimeout(stopAll, Math.min(v.duration || 15, 15) * 1000 + 300);
    } catch (e) { URL.revokeObjectURL(url); reject(e); }
  };
});
// ---- Camera filters / stickers ----
const CAM_FILTERS = [
  ['Normal', 'none'],
  ['Warm', 'sepia(0.25) saturate(1.4) hue-rotate(-12deg) brightness(1.05)'],
  ['Cool', 'saturate(1.2) hue-rotate(15deg) brightness(1.05) contrast(1.05)'],
  ['Vivid', 'saturate(1.9) contrast(1.15)'],
  ['B&W', 'grayscale(1) contrast(1.15)'],
  ['Noir', 'grayscale(1) contrast(1.6) brightness(0.85)'],
  ['Vintage', 'sepia(0.7) contrast(0.95) brightness(1.05) saturate(1.2)'],
  ['Fade', 'contrast(0.85) brightness(1.15) saturate(0.8)'],
  ['Rose', 'sepia(0.3) saturate(1.6) hue-rotate(-35deg) brightness(1.05)'],
  ['Dreamy', 'brightness(1.15) contrast(0.9) saturate(1.3) blur(0.6px)'],
  ['Neon', 'saturate(2.4) contrast(1.3) hue-rotate(-20deg) brightness(1.05)'],
  ['Sunset', 'sepia(0.4) saturate(1.8) hue-rotate(-20deg) contrast(1.1)'],
];
const CAM_STICKERS = ['❤️', '😍', '🔥', '✨', '😂', '🥰', '💋', '🌹', '👑', '😎', '🎉', '💘'];
const camCompose = (cam) => new Promise((res, rej) => {
  const img = new window.Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    const f = CAM_FILTERS[cam.fi || 0][1];
    try { if (f !== 'none') ctx.filter = f; } catch (e) {}
    ctx.drawImage(img, 0, 0);
    try { ctx.filter = 'none'; } catch (e) {}
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    (cam.stickers || []).forEach((st) => { ctx.font = Math.round(c.width * 0.16) + 'px serif'; ctx.fillText(st.e, st.x * c.width, st.y * c.height); });
    if (cam.caption) {
      const h = Math.round(c.width * 0.15); const y = Math.round(c.height * 0.72);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, y, c.width, h);
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(c.width * 0.065) + 'px sans-serif';
      ctx.fillText(cam.caption, c.width / 2, y + h / 2, c.width * 0.92);
    }
    res(c.toDataURL('image/jpeg', 0.88));
  };
  img.onerror = () => rej(new Error('Photo process nahi hui'));
  img.src = cam.raw;
});
// ===== GROUP CHAT HELPERS END =====

// ===== GAMES + COUPLE DATA =====
const WYR = [
  ['Har weekend lambi drive par jaana', 'Har weekend ghar par saath movie dekhna'],
  ['Hamesha subah ka saath', 'Hamesha raat ka saath'],
  ['Surprise gift paana', 'Surprise date par jaana'],
  ['Pahaad ki trip', 'Samundar ki trip'],
  ['Roz ek love letter paana', 'Roz ek voice note paana'],
  ['Saath me khaana banana', 'Bahar restaurant me khaana'],
  ['Bahut saare dost, kam alone time', 'Kam dost, zyada couple time'],
  ['Saath me dance seekhna', 'Saath me koi instrument seekhna'],
  ['Barish me bheegna', 'Sardi me kambal me chai peena'],
  ['Pehli date dobara jeena', 'Apni shaadi ka din pehle dekhna'],
  ['Train ka lamba safar', 'Flight ka safar'],
  ['Hamesha sach bolna', 'Hamesha surprise banaye rakhna'],
  ['Saal me ek bada gift', 'Har mahine chhote gift'],
  ['Partner ko gaana sunana', 'Partner se gaana sunna'],
  ['Raat bhar baatein karna', 'Raat bhar movie marathon'],
  ['Street food date', 'Candle light dinner'],
  ['Same colour ke kapde pehnna', 'Same phone cover lagana'],
  ['Ek hafte phone-free saath rehna', 'Ek hafte door rehkar roz video call'],
  ['Saath me pet paalna', 'Saath me plants ugaana'],
  ['Zindagi bhar sirf meetha khana', 'Zindagi bhar sirf teekha khana'],
  ['Sunrise dekhna', 'Sunset dekhna'],
  ['Partner ke liye love song likhna', 'Partner ke liye love poem likhna'],
  ['Cycling trip', 'Bike trip'],
  ['Chhoti si pyaari shaadi', 'Badi dhoom-dhaam wali shaadi'],
  ['Hamesha birthday yaad rakhna', 'Hamesha anniversary yaad rakhna'],
  ['Ek raat taare dekhna', 'Ek raat bonfire ke paas baithna'],
  ['Ek din bina phone ke bitana', 'Ek din bina internet ke bitana'],
  ['Partner ke saath shopping', 'Partner ke saath trekking'],
  ['Hamesha late par romantic rehna', 'Hamesha time par par simple rehna'],
  ['Saath me koi naya shauk seekhna', 'Saath me koi purani yaad dobara jeena'],
];
const NHIE = [
  'Maine kabhi kisi ka purana message dobara padha hai.',
  'Maine kabhi raat ko bina wajah kisi ko yaad kiya hai.',
  'Maine kabhi kisi ke liye gaana dedicate kiya hai.',
  'Maine kabhi galat number par message bhej diya hai.',
  'Maine kabhi kisi se milne ke liye ghar par bahana banaya hai.',
  'Maine kabhi kisi ka birthday bhool kar baad me bahana banaya hai.',
  'Maine kabhi poori raat kisi se baatein ki hain.',
  'Maine kabhi kisi ko ignore karke baad me pachhtaya hai.',
  'Maine kabhi aaine ke saamne baat practice ki hai.',
  'Maine kabhi movie dekhte dekhte neend nikaal li hai.',
  'Maine kabhi kisi ki photo chupke se save ki hai.',
  'Maine kabhi pehli date par bahut ghabrahat mehsoos ki hai.',
  'Maine kabhi apni galti hote hue bhi sorry nahi bola.',
  'Maine kabhi jaanbujh kar reply late kiya hai.',
  'Maine kabhi surprise ke liye jhooth bola hai.',
  'Maine kabhi kisi ke saamne rote hue khud ko roka hai.',
  'Maine kabhi raat 3 baje tak kisi se chat ki hai.',
  'Maine kabhi chupke se kisi ka profile baar baar dekha hai.',
  'Maine kabhi khaane ke liye jhagda kiya hai.',
  'Maine kabhi kisi ko miss karke akele gaana suna hai.',
  'Maine kabhi kisi ka call jaanbujh kar miss kiya hai.',
  'Maine kabhi kisi ko nickname se save kiya hai.',
  'Maine kabhi bina bataye kisi ke liye kuch banaya hai.',
  'Maine kabhi kisi ki wajah se apna plan cancel kiya hai.',
  'Maine kabhi baat karte hue time ka pata hi nahi chala.',
  'Maine kabhi kisi ko dekhkar socha hai ki yahi hai.',
  'Maine kabhi kisi ke liye subah jaldi uthkar kuch kiya hai.',
  'Maine kabhi kisi ko galti se galat naam se bulaya hai.',
  'Maine kabhi kisi se baat karte hue phone ki battery khatam kar di hai.',
  'Maine kabhi kisi ka gift sabse chhupa kar rakha hai.',
];
const QUIZ_Q = [
  'Meri favourite khaane ki cheez kaunsi hai?', 'Mera favourite colour kaunsa hai?', 'Meri favourite movie ya series kaunsi hai?',
  'Mera sabse bada darr kya hai?', 'Main kaunsi jagah jaana chahta/chahti hoon?', 'Mera favourite gaana kaunsa hai?',
  'Bachpan me mera nickname kya tha?', 'Meri sabse achhi yaad kaunsi hai?', 'Main sabse zyada kis cheez se chidta/chidti hoon?',
  'Mera dream job kya hai?', 'Mera favourite season kaunsa hai?', 'Main tension me kya karta/karti hoon?',
  'Mera favourite dessert kaunsa hai?', 'Main subah ka insaan hoon ya raat ka?', 'Mera sabse bada sapna kya hai?',
  'Meri favourite hobby kaunsi hai?', 'Mera favourite festival kaunsa hai?', 'Mujhe kis cheez se sabse zyada khushi milti hai?',
  'Main chai peeta/peeti hoon ya coffee, aur kaise?', 'Mera favourite kapda kaunsa hai?', 'Mera favourite hero ya heroine kaun hai?',
  'Meri sabse badi aadat jo mujhe khud pasand nahi?', 'Main kisi me sabse pehle kya notice karta/karti hoon?',
  'Meri favourite aawaz ya sound kaunsi hai?', 'Main bachpan me kya banna chahta/chahti thi?',
];
const DAILY = [
  'Aaj tumhe sabse zyada kis baat ne khush kiya?', 'Meri kaunsi aadat tumhe sabse pyaari lagti hai?',
  'Agar aaj hum saath hote to kya karte?', 'Hamari pehli mulaqat me tumhe kya laga tha?',
  'Tumhari life ka sabse achha din kaunsa tha?', 'Tumhe mere saath kaunsi cheez karni sabse pasand hai?',
  'Agar ek superpower milti to kaunsi aur kyun?', 'Tumhara aaj ka mood ek gaane me batao.',
  'Hum dono ka ek sapna jo saath poora karna hai?', 'Meri kaunsi baat tumhe hasaati hai?',
  'Tum kis cheez ke liye mujhe thank you kehna chahte ho?', 'Agar kal chhutti ho to hum kya karein?',
  'Tumhe mere baare me sabse zyada kya pasand hai?', 'Aaj tumne kuch naya seekha?',
  'Tumhari favourite yaad hamari kaunsi hai?', 'Agar hum ek din ke liye kahin bhi ja sakein, kahan jaayein?',
  'Koi baat jo tum mujhse share karna chahte ho par kar nahi paaye?', 'Tumhe kya lagta hai 5 saal baad hum kahan honge?',
  'Ek chhoti si cheez jo mujhe khush kar de?', 'Aaj tumne kiski tareef ki?',
  'Meri kaunsi photo tumhe sabse pasand hai?', 'Tumhara favourite weekend plan kya hai?',
  'Tum mujhe kis gaane se yaad karte ho?', 'Aaj ki sabse funny baat kya hui?',
  'Hamare rishte ki sabse khoobsurat baat kya hai?', 'Agar main kal udaas hoon to tum kya karoge?',
  'Bachpan ka tumhara sabse pyaara khel kaunsa tha?', 'Ek cheez jo tum mere saath pehli baar karna chahte ho?',
  'Aaj ka tumhara sabse achha pal kaunsa tha?', 'Meri kaunsi cheez tum kabhi badalna nahi chahoge?',
  'Aaj tumhe mujhse kya kehna tha jo reh gaya?', 'Tumhe kaisi subah pasand hai?',
  'Tum apne aap me kaunsi baat sudharna chahte ho?', 'Mujhe ek line me describe karo.',
  'Agar hum ek movie hote to uska naam kya hota?', 'Tumhe kis jagah par sabse zyada sukoon milta hai?',
  'Hum dono me sabse badi samaanta kya hai?', 'Aaj tumne khud ke liye kya kiya?',
  'Meri kaunsi baat sunna tumhe pasand hai?', 'Tum kis pal me sabse zyada khush hote ho?',
  'Tumhe hamari kaunsi date sabse special lagi?', 'Agle mahine tum kya karna chahte ho jisme main saath doon?',
  'Aaj tumne mere baare me kya socha?', 'Aaj ka din ek emoji me batao aur kyun.',
  'Mujhse kaunsa sawal tum hamesha poochna chahte the?',
];
const dayKey = (d) => {
  const x = d || new Date();
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const compressImageTo = (dataUrl, max, q) => new Promise((res, rej) => {
  const img = new window.Image();
  img.onload = () => {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    res(c.toDataURL('image/jpeg', q));
  };
  img.onerror = () => rej(new Error('Photo khul nahi payi'));
  img.src = dataUrl;
});
// ===== GAMES + COUPLE DATA END =====

export default function App() {
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState('home');
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const setLink = (rel, href, type) => {
      let l = document.querySelector('link[rel="' + rel + '"]');
      if (!l) { l = document.createElement('link'); l.setAttribute('rel', rel); document.head.appendChild(l); }
      l.setAttribute('href', href);
      if (type) l.setAttribute('type', type);
    };
    setLink('icon', ICON_URI, 'image/png');
    setLink('apple-touch-icon', ICON_URI);
  }, []);
  const splashAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(splashAnim, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, []);
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [room, setRoom] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
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
  const lastChat = useRef('');
  const lastDm = useRef('');
  const dmScrollRef = useRef(null);
  const dmImgLoading = useRef({});
  const recRef = useRef(null);
  const lastNotif = useRef({});
  const seenW = useRef(0);

  const [profile, setProfile] = useState({ name: '', bio: '', avatar: '😎', gender: '' });
  const [soundOn, setSoundOn] = useState(true);
  const [notifOn, setNotifOn] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [skin, setSkin] = useState('');
  const [myPhoto, setMyPhoto] = useState('');
  const [bgPhoto, setBgPhoto] = useState('');

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authStep, setAuthStep] = useState('form');
  const [pendingToken, setPendingToken] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingUid, setPendingUid] = useState('');
  const [pendingRefresh, setPendingRefresh] = useState('');

  const [usernameInput, setUsernameInput] = useState('');
  const [cloudFriends, setCloudFriends] = useState({});
  const [friendReqs, setFriendReqs] = useState({});
  const [reqName, setReqName] = useState('');
  const [dmFriend, setDmFriend] = useState(null);
  const [dmProf, setDmProf] = useState(null);
  const [dmShared, setDmShared] = useState(null);
  const [dmRaw, setDmRaw] = useState({});
  const [dmPlain, setDmPlain] = useState([]);
  const [dmText, setDmText] = useState('');
  const [dmSel, setDmSel] = useState(null);
  const [dmHidden, setDmHidden] = useState([]);
  const [pubError, setPubError] = useState('');
  const [dmImgs, setDmImgs] = useState({});
  const [dmBusy, setDmBusy] = useState(false);
  const [dmSeen, setDmSeen] = useState({});
  const [editing, setEditing] = useState(null);
  const [recording, setRecording] = useState(false);
  const [unread, setUnread] = useState({});
  const [groupList, setGroupList] = useState({});
  const [grp, setGrp] = useState(null);
  const [grpKey, setGrpKey] = useState(null);
  const [grpRaw, setGrpRaw] = useState({});
  const [grpPlain, setGrpPlain] = useState([]);
  const [grpMembers, setGrpMembers] = useState({});
  const [grpMeta, setGrpMeta] = useState(undefined);
  const [grpText, setGrpText] = useState('');
  const [grpSel, setGrpSel] = useState(null);
  const [grpEditing, setGrpEditing] = useState(null);
  const [grpHidden, setGrpHidden] = useState([]);
  const [grpInfo, setGrpInfo] = useState(false);
  const [grpConfirm, setGrpConfirm] = useState('');
  const [grpNewName, setGrpNewName] = useState('');
  const [grpJoinCode, setGrpJoinCode] = useState('');
  const [previews, setPreviews] = useState({});
  const [pics, setPics] = useState({});
  const [friendMenu, setFriendMenu] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [viewerHd, setViewerHd] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const [cam, setCam] = useState(null);
  const [dmPlus, setDmPlus] = useState(false);
  const [nicks, setNicks] = useState({});
  const [nickEdit, setNickEdit] = useState(null);
  const [strState, setStrState] = useState('idle');
  const [strRoom, setStrRoom] = useState(null);
  const [strRaw, setStrRaw] = useState({});
  const [strPlain, setStrPlain] = useState([]);
  const [strText, setStrText] = useState('');
  const [strEnded, setStrEnded] = useState(false);
  const strJoin = useRef(0);
  const strBusy = useRef(false);
  const lastStr = useRef('');
  const strCount = useRef(-1);
  const strScroll = useRef(null);
  const strHb = useRef(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const [strPeer, setStrPeer] = useState(null);
  const [strMenu, setStrMenu] = useState(false);
  const [strShowName, setStrShowName] = useState(() => { try { return localStorage.getItem('nexdare_strname') !== '0'; } catch (e) { return true; } });
  const [stories, setStories] = useState({});
  const [svMedia, setSvMedia] = useState({});
  const [strAlive, setStrAlive] = useState(0);
  const [seenSt, setSeenSt] = useState(() => { try { return JSON.parse(localStorage.getItem('nexdare_seenst')) || {}; } catch (e) { return {}; } });
  const [sv, setSv] = useState(null);
  const [stAud, setStAud] = useState('all');
  const [stText, setStText] = useState('');
  const [stBg, setStBg] = useState(0);
  const [stBusy, setStBusy] = useState(false);
  const [closeSet, setCloseSet] = useState({});
  const camVideo = useRef(null);
  const camStream = useRef(null);
  const camRecRef = useRef(null);
  const camRecTimer = useRef(null);
  const [deactMap, setDeactMap] = useState({});
  const [acctMode, setAcctMode] = useState(null);
  const [acctPass, setAcctPass] = useState('');
  const [acctCode, setAcctCode] = useState('');
  const [acctWord, setAcctWord] = useState('');
  const [acctSent, setAcctSent] = useState(false);
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctHasPw, setAcctHasPw] = useState(true);
  const otpRef = useRef(null);
  const otpOn = !!(EMAILJS.service && EMAILJS.template && EMAILJS.key);
  const [wallDim, setWallDim] = useState(() => { try { return localStorage.getItem('nexdare_walldim') || 'normal'; } catch (e) { return 'normal'; } });
  const [myPhotoHd, setMyPhotoHd] = useState('');
  const [presMap, setPresMap] = useState({});
  const [showSeen, setShowSeen] = useState(() => { try { return localStorage.getItem('nexdare_showseen') !== '0'; } catch (e) { return true; } });
  const [grpPhoto, setGrpPhoto] = useState('');
  const [grpPics, setGrpPics] = useState({});
  const grpPicTried = useRef({});
  const [tttMode, setTttMode] = useState('pal');
  const [tttLevel, setTttLevel] = useState('hard');
  const [tttDoc, setTttDoc] = useState(null);
  const [tttCpu, setTttCpu] = useState(TTT_FRESH);
  const picTried = useRef({});
  const lastGrp = useRef('');
  const grpScrollRef = useRef(null);
  const grpCount = useRef(-1);
  const peerCache = useRef({});
  const previewKey = useRef({});
  const blocksRef = useRef({});
  const [pal, setPal] = useState(null);
  const [palAes, setPalAes] = useState(null);
  const [palPicking, setPalPicking] = useState(false);
  const [pqData, setPqData] = useState(null);
  const [quiz, setQuiz] = useState(null);
  const [quizPlain, setQuizPlain] = useState({});
  const [quizIn, setQuizIn] = useState('');
  const [quizQ, setQuizQ] = useState('');
  const [dailyDoc, setDailyDoc] = useState(null);
  const [dailyPlain, setDailyPlain] = useState({});
  const [dailyIn, setDailyIn] = useState('');
  const [streakBase, setStreakBase] = useState(0);
  const [memDoc, setMemDoc] = useState(null);
  const [memPlain, setMemPlain] = useState([]);
  const [memStart, setMemStart] = useState('');
  const [memEditing, setMemEditing] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDate, setEvDate] = useState('');
  const [notesDoc, setNotesDoc] = useState(null);
  const [notesPlain, setNotesPlain] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [noteWhen, setNoteWhen] = useState('now');
  const [albumItems, setAlbumItems] = useState([]);
  const [albumBusy, setAlbumBusy] = useState(false);
  const [blocks, setBlocks] = useState({});
  const [dmMenu, setDmMenu] = useState('');
  const [delConfirm, setDelConfirm] = useState(false);

  const [uiLang, setUiLang] = useState(localStorage.getItem('nexdare_lang') || 'en');
  const [, bump] = useState(0);
  const t = (key) => ((translations[uiLang] || autoCache[uiLang] || {})[key]) || translations.en[key] || key;
  const changeLang = async (code) => {
    setUiLang(code); localStorage.setItem('nexdare_lang', code);
    if (!translations[code]) { await autoTranslate(code); bump((n) => n + 1); }
  };
  useEffect(() => { if (uiLang !== 'en' && !translations[uiLang]) autoTranslate(uiLang).then(() => bump((n) => n + 1)); }, []);
  const skins = SKINS;

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('nexdare_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user && user.email && user.uid && authState.refreshToken) {
          setCurrentUser(user); setIsLoggedIn(true);
          setProfile((prev) => ({ ...prev, name: user.name || '', bio: user.bio || '', avatar: user.avatar || '😎', gender: user.gender || prev.gender || '' }));
        } else localStorage.removeItem('nexdare_user');
      }
      const p = JSON.parse(localStorage.getItem('nexdare_profile') || '{}');
      if (p.name || p.bio) setProfile((prev) => ({ ...prev, ...p }));
      const s1 = localStorage.getItem('nexdare_sound'); if (s1 !== null) setSoundOn(s1 === '1');
      const n1 = localStorage.getItem('nexdare_notif'); if (n1 !== null) setNotifOn(n1 === '1');
      setSkin(localStorage.getItem('nexdare_skin') || '');
      setMyPhoto(localStorage.getItem('nexdare_myphoto') || '');
      setMyPhotoHd(localStorage.getItem('nexdare_myphotohd') || '');
      setBgPhoto(localStorage.getItem('nexdare_bgphoto') || '');
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
          name: p.name || currentUser.username, avatar: p.avatar || '😎', bio: p.bio || '', gender: p.gender || '', photo: myPhoto || '',
        }).catch(() => {});
      }
    }
  };

  const pickPhoto = (which) => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const du = await readAsDataUrl(file);
        if (which === 'me') {
          const thumb = await resizeDataUrl(du, 240, 0.82);
          const hd = await resizeDataUrl(du, 1080, 0.86);
          setMyPhoto(thumb); setMyPhotoHd(hd);
          try { localStorage.setItem('nexdare_myphoto', thumb); localStorage.setItem('nexdare_myphotohd', hd); } catch (e) {}
          if (currentUser && currentUser.username) update(ref(db, 'profiles/' + currentUser.uid), { photo: thumb, photoHd: hd }).catch(() => {});
        } else {
          const small = await resizeDataUrl(du, 800, 0.5);
          setBgPhoto(small); localStorage.setItem('nexdare_bgphoto', small);
        }
        setNotice('Photo laga di 💕');
      } catch (e) { setError('Photo nahi lagi: ' + e.message); }
    };
    input.click();
  };

  const authCall = async (endpoint, body) => {
    const res = await fetch('https://identitytoolkit.googleapis.com/v1/' + endpoint + '?key=' + FIREBASE_API_KEY,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) {
      const code = (data && data.error && data.error.message) || 'UNKNOWN';
      const err = new Error(code); err.code = code; throw err;
    }
    return data;
  };
  const authMsg = (code) => {
    const c = String(code || 'UNKNOWN');
    if (c.indexOf('EMAIL_EXISTS') === 0) return 'Ye email pehle se registered hai, Login karo.';
    if (c.indexOf('INVALID_LOGIN_CREDENTIALS') === 0 || c.indexOf('INVALID_PASSWORD') === 0 || c.indexOf('EMAIL_NOT_FOUND') === 0) return 'Email ya password galat hai.';
    if (c.indexOf('WEAK_PASSWORD') === 0) return 'Password bahut kamzor hai.';
    if (c.indexOf('TOO_MANY_ATTEMPTS') === 0) return 'Bahut try ho gaye, thodi der baad aao.';
    return 'Error: ' + c;
  };
  const sendVerifyMail = async (token) => { await authCall('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: token }); };

  const finishLogin = async (uid, mail, extra, tokens) => {
    if (tokens) setAuthTokens(tokens);
    let reactivated = false;
    let cancelledDelete = false;
    let userData = { uid, email: mail, name: profile.name || (extra && extra.name) || '', bio: profile.bio || '', avatar: profile.avatar || '😎', lastLogin: Date.now() };
    try {
      const snap = await get(ref(db, 'users/' + uid));
      if (snap.exists()) userData = { ...userData, ...snap.val(), uid, email: mail, lastLogin: Date.now() };
      if (userData.deletePending && userData.deleteAt && Date.now() >= userData.deleteAt) {
        try { await purgeAccount(uid); } catch (e2) {}
        clearAuthTokens(); setAuthLoading(false); setError('');
        setNotice('Is account ka 15 din ka delete time poora ho gaya tha, isliye account delete ho gaya.');
        return;
      }
      if (userData.deletePending) { cancelledDelete = true; userData.deletePending = false; delete userData.deleteAt; reactivated = true; }
      if (userData.deactivated) { userData.deactivated = false; reactivated = true; }
      await set(ref(db, 'users/' + uid), userData);
    } catch (e) {}
    try {
      const ps = await get(ref(db, 'profiles/' + uid));
      if (ps.exists() && ps.val().username) userData.username = ps.val().username;
      if (reactivated) await update(ref(db, 'profiles/' + uid), { deactivated: false, deleteAt: null });
    } catch (e) {}
    localStorage.setItem('nexdare_user', JSON.stringify(userData));
    setCurrentUser(userData);
    setProfile((prev) => ({ ...prev, name: userData.name || '', bio: userData.bio || '', avatar: userData.avatar || '😎', gender: userData.gender || prev.gender || '' }));
    setIsLoggedIn(true); setAuthStep('form');
    setPendingToken(''); setPendingEmail(''); setPendingUid(''); setPendingRefresh('');
    setEmail(''); setPassword(''); setError(''); setNotice(reactivated ? (cancelledDelete ? 'Welcome back! Account delete cancel ho gaya 💞' : 'Welcome back! Account wapas activate ho gaya 💞') : 'Login successful! 🎉');
    playSound('success', soundOn);
  };

  const submitAuth = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail.includes('@') || !mail.includes('.')) { setError('Sahi email daalo'); return; }
    if (password.length < 6) { setError('Password kam se kam 6 akshar ka rakho'); return; }
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const data = await authCall(authMode === 'signup' ? 'accounts:signUp' : 'accounts:signInWithPassword', { email: mail, password, returnSecureToken: true });
      if (authMode === 'signup') {
        await sendVerifyMail(data.idToken);
        setPendingToken(data.idToken); setPendingEmail(data.email); setPendingUid(data.localId); setPendingRefresh(data.refreshToken);
        setAuthStep('verify'); setNotice('Verification link bhej diya: ' + data.email);
      } else {
        const info = await authCall('accounts:lookup', { idToken: data.idToken });
        const u = info.users && info.users[0];
        if (u && u.emailVerified) {
          await finishLogin(data.localId, data.email, undefined, { idToken: data.idToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn });
        } else {
          setPendingToken(data.idToken); setPendingEmail(data.email); setPendingUid(data.localId); setPendingRefresh(data.refreshToken);
          setAuthStep('verify'); setNotice('Email abhi verify nahi hua.');
        }
      }
    } catch (e) { setError(authMsg(e.code || e.message)); }
    setAuthLoading(false);
  };

  const checkVerified = async () => {
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const info = await authCall('accounts:lookup', { idToken: pendingToken });
      const u = info.users && info.users[0];
      if (u && u.emailVerified) await finishLogin(pendingUid, pendingEmail, undefined, { idToken: pendingToken, refreshToken: pendingRefresh, expiresIn: 0 });
      else setError('Abhi email verify nahi hua. Mail me link pe tap karo, phir dobara dabao.');
    } catch (e) { setError(authMsg(e.code || e.message)); }
    setAuthLoading(false);
  };
  const resendVerify = async () => {
    setError(''); setNotice('');
    try { await sendVerifyMail(pendingToken); setNotice('Mail dobara bhej diya. Spam bhi check karo.'); }
    catch (e) { setError(authMsg(e.code || e.message)); }
  };
  const googleLogin = async () => {
    if (Platform.OS !== 'web') { setError('Google login sirf website (browser) me chalta hai.'); return; }
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const fb = await loadFirebase();
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await fb.auth().signInWithPopup(provider);
      const u = result.user;
      const gToken = await u.getIdToken();
      await finishLogin(u.uid, u.email, { name: u.displayName || '' }, { idToken: gToken, refreshToken: u.refreshToken, expiresIn: 3500 });
    } catch (e) { setError('Google login nahi hua: ' + ((e && e.message) || '')); }
    setAuthLoading(false);
  };
  const forgotPassword = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail.includes('@')) { setError('Pehle upar Email daalo'); return; }
    setError(''); setNotice('');
    try { await authCall('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: mail }); setNotice('Password badalne ka link mail par bhej diya.'); }
    catch (e) { setError(authMsg(e.code || e.message)); }
  };
  const backToForm = () => {
    setAuthStep('form'); setPendingToken(''); setPendingEmail(''); setPendingUid(''); setPendingRefresh('');
    setPassword(''); setError(''); setNotice('');
  };
  const logout = () => {
    clearAuthTokens();
    setCloudFriends({}); setFriendReqs({}); setDmFriend(null);
    try { if (window.firebase && window.firebase.apps.length) window.firebase.auth().signOut(); } catch (e) {}
    localStorage.removeItem('nexdare_user');
    setCurrentUser(null); setIsLoggedIn(false); setEmail(''); setPassword('');
    setAuthMode('login'); setAuthStep('form'); setNotice('Logged out');
  };

  const copyText = async (txt) => {
    try {
      if (Platform.OS === 'web' && navigator.clipboard) { await navigator.clipboard.writeText(txt); setNotice('Copy ho gaya ✅'); }
      else await Share.share({ message: txt });
    } catch (e) {}
  };

  const claimUsername = async () => {
    const uname = usernameInput.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) { setError('Username 3 se 20 akshar ka ho: sirf a-z, 0-9 aur _'); return; }
    if (!currentUser || !currentUser.uid) return;
    setAuthLoading(true); setError(''); setNotice('');
    try {
      const snap = await get(ref(db, 'usernames/' + uname));
      if (snap.exists() && snap.val() !== currentUser.uid) { setError('Ye username kisi ne le liya hai, doosra chuno.'); setAuthLoading(false); return; }
      await set(ref(db, 'usernames/' + uname), currentUser.uid);
      await set(ref(db, 'profiles/' + currentUser.uid), { username: uname, name: currentUser.name || uname, avatar: currentUser.avatar || '😎', bio: currentUser.bio || '', photo: myPhoto || '' });
      const updated = { ...currentUser, username: uname, name: currentUser.name || uname };
      localStorage.setItem('nexdare_user', JSON.stringify(updated));
      setCurrentUser(updated); setUsernameInput('');
      setNotice('Username set ho gaya: @' + uname + ' 🎉');
    } catch (e) { setError('Username save nahi hua: ' + e.message); }
    setAuthLoading(false);
  };

  const sendFriendRequest = async () => {
    const uname = reqName.trim().toLowerCase().replace(/^@/, '');
    if (!uname || !currentUser || !currentUser.username) return;
    if (uname === currentUser.username) { setError('Khud ko add nahi kar sakte 😄'); return; }
    setError(''); setNotice('');
    try {
      const snap = await get(ref(db, 'usernames/' + uname));
      if (!snap.exists()) { setError('Ye username nahi mila. Spelling check karo.'); return; }
      const targetUid = snap.val();
      try { const dp = await call('GET', 'profiles/' + targetUid + '/deactivated'); if (dp) { setError('Ye username nahi mila. Spelling check karo.'); return; } } catch (e) {}
      if (cloudFriends[targetUid]) { setNotice('Ye pehle se aapka friend hai.'); return; }
      if (friendReqs[targetUid]) { setNotice('Unhone aapko request bheji hai. Neeche Accept karo.'); return; }
      await set(ref(db, 'friendReqs/' + targetUid + '/' + currentUser.uid), {
        uid: currentUser.uid, username: currentUser.username, name: currentUser.name || currentUser.username, avatar: currentUser.avatar || '😎', t: Date.now(),
      });
      setReqName(''); setNotice('Request bhej di ✅');
    } catch (e) { setError('Request nahi gayi: ' + e.message); }
  };
  const acceptRequest = async (r) => {
    try {
      const chatId = [currentUser.uid, r.uid].sort().join('_');
      const since = Date.now();
      await set(ref(db, 'friends/' + currentUser.uid + '/' + r.uid), { uid: r.uid, username: r.username, name: r.name || r.username, avatar: r.avatar || '😎', chatId, since });
      await set(ref(db, 'friends/' + r.uid + '/' + currentUser.uid), { uid: currentUser.uid, username: currentUser.username, name: currentUser.name || currentUser.username, avatar: currentUser.avatar || '😎', chatId, since });
      await remove(ref(db, 'friendReqs/' + currentUser.uid + '/' + r.uid));
      setNotice('@' + r.username + ' ab aapka friend hai 🎉');
    } catch (e) { setError('Accept nahi hua: ' + e.message); }
  };
  const declineRequest = async (r) => { try { await remove(ref(db, 'friendReqs/' + currentUser.uid + '/' + r.uid)); } catch (e) { setError('Error: ' + e.message); } };
  const removeCloudFriend = async (f) => { try { await remove(ref(db, 'friends/' + currentUser.uid + '/' + f.uid)); } catch (e) { setError('Error: ' + e.message); } };

  const openDm = (f) => {
    setDmFriend(f); setDmShared(null); setDmPlain([]); setDmRaw({}); setDmProf(null); setDmSeen({});
    setDmImgs({}); dmImgLoading.current = {}; setDmBusy(false); setEditing(null); seenW.current = 0;
    lastDm.current = ''; setDmSel(null); setDmText(''); setError(''); setNotice('');
    let h = [];
    try { h = JSON.parse(localStorage.getItem('nexdare_dmhidden_' + f.chatId)) || []; } catch (e) {}
    setDmHidden(h);
    if (subtle) loadIdentity().then(setIdent).catch(() => {});
    setScreen('dm');
  };
  const leaveDm = () => { setDmFriend(null); setDmShared(null); setDmPlain([]); setDmRaw({}); setDmSel(null); setEditing(null); setDmMenu(''); setError(''); setNotice(''); setScreen('friends'); };

  const sendDm = async () => {
    const text = dmText.trim();
    if (!text || !dmFriend) return;
    if (!dmShared || !currentUser) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    setDmText(''); setNotice('');
    try {
      const enc = await encryptText(dmShared.aes, text);
      if (editing) {
        await update(ref(db, 'dm/' + dmFriend.chatId + '/messages/' + editing), { iv: enc.iv, ct: enc.ct, edited: true });
        setEditing(null);
      } else {
        await push(ref(db, 'dm/' + dmFriend.chatId + '/messages'), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now() });
      }
      playSound('click', soundOn);
    } catch (e) { setError('Message nahi gaya: ' + e.message); }
  };
  const startEdit = () => {
    if (!dmSel || dmSel.from !== currentUser.uid || dmSel.file) return;
    setEditing(dmSel.key); setDmText(dmSel.text); setDmSel(null);
  };

  const sendDmData = async (dataUrl, name, type, size, caption) => {
    if (!dmFriend || !dmShared || !currentUser) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    setDmBusy(true); setError('');
    try {
      if (dataUrl.length > 3000000) { setError('File badi hai. 2 MB tak.'); setDmBusy(false); return; }
      const fid = randomId();
      const encD = await encryptText(dmShared.aes, dataUrl);
      await set(ref(db, 'dm/' + dmFriend.chatId + '/files/' + fid), { iv: encD.iv, ct: encD.ct, from: currentUser.uid, t: Date.now() });
      const meta = JSON.stringify({ __f: 1, id: fid, name, type, size, text: caption || '' });
      const encM = await encryptText(dmShared.aes, meta);
      await push(ref(db, 'dm/' + dmFriend.chatId + '/messages'), { from: currentUser.uid, iv: encM.iv, ct: encM.ct, t: Date.now() });
      playSound('click', soundOn);
    } catch (e) { setError('File nahi gayi: ' + e.message); }
    setDmBusy(false);
  };
  const sendDmFile = async (file) => {
    const isImg = !!file.type && file.type.indexOf('image/') === 0;
    if (!isImg && file.size > MAX_DM_FILE) { setError('File badi hai. 2 MB tak.'); return; }
    let dataUrl = await readAsDataUrl(file);
    let type = file.type || 'application/octet-stream';
    if (isImg) { dataUrl = await compressImage(dataUrl); type = 'image/jpeg'; }
    const caption = dmText.trim(); setDmText('');
    await sendDmData(dataUrl, file.name || 'file', type, file.size, caption);
  };
  const pickDmFile = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    if (!dmShared) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => { const f = input.files && input.files[0]; if (f) sendDmFile(f); };
    input.click();
  };

  const startRec = async () => {
    if (Platform.OS !== 'web' || !navigator.mediaDevices) { setNotice('Voice note sirf browser me chalta hai.'); return; }
    if (!dmShared) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size > MAX_DM_FILE) { setError('Voice note bada hai (max 2 MB).'); return; }
        const du = await readAsDataUrl(blob);
        await sendDmData(du, 'voice-note', blob.type || 'audio/webm', blob.size, '');
      };
      mr.start(); recRef.current = mr; setRecording(true);
    } catch (e) { setError('Mic allow nahi hua: ' + e.message); }
  };
  const stopRec = () => { try { if (recRef.current) recRef.current.stop(); } catch (e) {} setRecording(false); };

  const downloadDmFile = async (f) => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    try {
      let data = dmImgs[f.id];
      if (!data || data === 'ERR') {
        const v = await call('GET', 'dm/' + dmFriend.chatId + '/files/' + f.id);
        if (!v) { setError('File nahi mili.'); return; }
        data = await decryptText(dmShared.aes, v);
      }
      if (!data) { setError('File decrypt nahi hui.'); return; }
      const a = document.createElement('a');
      a.href = data; a.download = f.name || 'file';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { setError('Download nahi hua: ' + e.message); }
  };
  const dmDeleteForMe = () => {
    if (!dmSel || !dmFriend) return;
    const h = [...dmHidden, dmSel.key]; setDmHidden(h);
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
  const startDmCall = () => { if (dmShared) Linking.openURL('https://meet.jit.si/nexdare-' + dmShared.callHash); };

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
      } catch (e) { setError('Encryption setup nahi hua: ' + e.message); }
    })();
    return () => { cancelled = true; };
  }, [roomCode, role]);

  useEffect(() => {
    if (!ident || !role || !room || !room.keys) return;
    const other = room.keys[role === 'P1' ? 'P2' : 'P1'];
    if (!other) { setRshared(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const sh = await deriveShared(ident.priv, other);
        if (!cancelled) setRshared({ aes: sh.aes });
      } catch (e) { if (!cancelled) setError('Key error: ' + e.message); }
    })();
    return () => { cancelled = true; };
  }, [ident, role, roomKeysStr]);

  useEffect(() => {
    if (!rshared || !replyMeta) { setReplyPlain(null); return; }
    let cancelled = false;
    (async () => {
      const txt = await decryptText(rshared.aes, replyMeta);
      if (cancelled) return;
      try { setReplyPlain(txt === null ? null : { ...JSON.parse(txt), from: replyMeta.from, hasImg: !!replyMeta.img }); }
      catch (e) { setReplyPlain(null); }
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

  useEffect(() => { setReplyText(''); setReplyImg(null); }, [qText]);

  useEffect(() => {
    if (!chatCode) return;
    const unsub = onValue(ref(db, 'chats/' + chatCode), (snap) => {
      const v = snap.val();
      const str = JSON.stringify(v);
      if (str !== lastChat.current) { lastChat.current = str; setChatData(v === null ? { gone: true } : v); }
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
        await update(ref(db, 'chats/' + chatCode + '/names'), { [id.sid]: profile.name || (currentUser && currentUser.username) || 'Partner' }).catch(() => {});
        let h = [];
        try { h = JSON.parse(localStorage.getItem('nexdare_hidden_' + chatCode)) || []; } catch (e) {}
        setHidden(h);
      } catch (e) { setError('Encryption setup nahi hua: ' + e.message); }
    })();
    return () => { cancelled = true; };
  }, [chatCode]);

  useEffect(() => {
    if (!ident || !chatData || !chatData.keys) return;
    const others = Object.keys(chatData.keys).filter((k) => k !== ident.sid);
    if (others.length === 0) { setShared(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const sh = await deriveShared(ident.priv, chatData.keys[others[0]]);
        const safety = await safetyCode(ident.pub, chatData.keys[others[0]]);
        if (!cancelled) setShared({ aes: sh.aes, callHash: sh.callHash, safety });
      } catch (e) { if (!cancelled) setError('Key error: ' + e.message); }
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
        out.push({ key: m.key, sid: m.sid, t: m.t, edited: !!m.edited, text: text === null ? '🔒 (decrypt nahi ho paya)' : text });
      }
      if (!cancelled) setPlain(out);
    })();
    return () => { cancelled = true; };
  }, [shared, chatData]);

  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.username || !subtle) return;
    let cancelled = false;
    (async () => {
      try {
        const id = await loadIdentity();
        if (cancelled) return;
        await update(ref(db, 'profiles/' + currentUser.uid), { pub: id.pub });
        if (!cancelled) setPubError('');
      } catch (e) { if (!cancelled) setPubError('Encryption key save nahi hui: ' + e.message); }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn, currentUser && currentUser.uid, currentUser && currentUser.username, screen === 'friends']);

  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.username) return;
    const uid = currentUser.uid;
    const u1 = onValue(ref(db, 'friends/' + uid), (snap) => setCloudFriends(snap.val() || {}));
    const u2 = onValue(ref(db, 'friendReqs/' + uid), (snap) => { const v = snap.val() || {}; const o = {}; Object.keys(v).forEach((k) => { if (!blocksRef.current[k]) o[k] = v[k]; }); setFriendReqs(o); });
    return () => { u1(); u2(); };
  }, [isLoggedIn, currentUser && currentUser.uid, currentUser && currentUser.username]);

  useEffect(() => {
    if (screen !== 'dm' || !dmFriend) return;
    const u1 = onValue(ref(db, 'profiles/' + dmFriend.uid), (snap) => setDmProf(snap.val()));
    const u2 = onValue(ref(db, 'dm/' + dmFriend.chatId + '/seen'), (snap) => setDmSeen(snap.val() || {}));
    return () => { u1(); u2(); };
  }, [screen, dmFriend && dmFriend.uid]);

  const dmPubStr = dmProf && dmProf.pub ? JSON.stringify(dmProf.pub) : '';
  useEffect(() => {
    if (!ident || !dmPubStr || screen !== 'dm') { setDmShared(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const other = JSON.parse(dmPubStr);
        const sh = await deriveShared(ident.priv, other);
        const safety = await safetyCode(ident.pub, other);
        if (!cancelled) setDmShared({ aes: sh.aes, safety, callHash: sh.callHash });
      } catch (e) { if (!cancelled) setDmShared(null); }
    })();
    return () => { cancelled = true; };
  }, [ident, dmPubStr, screen]);

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
          try { const j = JSON.parse(text); file = { id: j.id, name: j.name, type: j.type, size: j.size }; shown = j.text || ''; } catch (e) {}
        }
        out.push({ key: m.key, from: m.from, t: m.t, edited: !!m.edited, text: shown, file });
      }
      if (!cancelled) setDmPlain(out);
    })();
    return () => { cancelled = true; };
  }, [dmShared, dmRaw]);

  useEffect(() => {
    if (screen !== 'dm' || !dmFriend || !currentUser || dmPlain.length === 0) return;
    const last = dmPlain.filter((m) => m.from !== currentUser.uid).slice(-1)[0];
    if (last && last.t > seenW.current) {
      seenW.current = last.t;
      update(ref(db, 'dm/' + dmFriend.chatId + '/seen'), { [currentUser.uid]: Date.now() }).catch(() => {});
    }
  }, [dmPlain, screen]);

  useEffect(() => {
    if (!dmShared || !dmFriend) return;
    dmPlain.forEach((m) => {
      const f = m.file;
      const ok = f && f.type && (f.type.indexOf('image/') === 0 || f.type.indexOf('audio/') === 0);
      if (ok && !dmImgs[f.id] && !dmImgLoading.current[f.id]) {
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

  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    const friendsArr = Object.keys(cloudFriends).map((k) => cloudFriends[k]);
    if (friendsArr.length === 0) return;
    const check = async () => {
      for (const f of friendsArr) {
        try {
          const v = await call('GET', 'dm/' + f.chatId + '/messages', undefined, 'orderBy=%22%24key%22&limitToLast=20');
          const arr = v ? Object.keys(v).map((k) => v[k]) : [];
          const mySeen = (await call('GET', 'dm/' + f.chatId + '/seen/' + currentUser.uid)) || 0;
          const inThis = dmFriend && dmFriend.chatId === f.chatId;
          const cnt = inThis ? 0 : arr.filter((x) => x.from !== currentUser.uid && x.t > mySeen).length;
          setUnread((u) => (u[f.chatId] === cnt ? u : { ...u, [f.chatId]: cnt }));
          const m = arr.length ? arr.reduce((a, b) => (b.t > a.t ? b : a)) : null;
          await ensurePic(f);
          if (m) await updatePreview(f, m);
          if (!m) { if (lastNotif.current[f.chatId] === undefined) lastNotif.current[f.chatId] = 0; continue; }
          const prev = lastNotif.current[f.chatId];
          lastNotif.current[f.chatId] = m.t;
          if (prev !== undefined && m.t > prev && m.from !== currentUser.uid) {
            playSound('msg', soundOn);
            const hiddenTab = typeof document !== 'undefined' && document.hidden;
            if (hiddenTab || !(dmFriend && dmFriend.chatId === f.chatId)) showNotif('Message 💌', (f.name || f.username) + ' ne message bheja 💌', notifOn);
          }
        } catch (e) {}
      }
    };
    check();
    const timer = setInterval(check, 4000);
    return () => clearInterval(timer);
  }, [isLoggedIn, JSON.stringify(Object.keys(cloudFriends)), notifOn, soundOn, dmFriend && dmFriend.chatId]);

  const freshCode = async (base, make) => {
    for (let i = 0; i < 6; i++) {
      const code = make();
      const snap = await get(ref(db, base + code));
      if (!snap.exists()) return code;
    }
    throw new Error('Code nahi ban paya, dobara try karo');
  };
  const roomRef = () => ref(db, 'rooms/' + roomCode);
  const resetReply = () => { setRshared(null); setReplyPlain(null); setReplyPic(null); setReplyText(''); setReplyImg(null); };

  const createRoom = async () => {
    try {
      const code = await freshCode('rooms/', () => String(Math.floor(1000 + Math.random() * 9000)));
      await set(ref(db, 'rooms/' + code), { stage: 'lobby', p2: false, scores: { P1: 0, P2: 0 } });
      resetReply(); setError(''); setRole('P1'); setRoom(null); setRoomCode(code); setScreen('room');
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const joinRoom = async () => {
    try {
      const code = joinCode.trim();
      const snap = await get(ref(db, 'rooms/' + code));
      if (!snap.exists()) { setError(t('roomNotFound')); return; }
      if (snap.val().p2) { setError(t('roomFull')); return; }
      await update(ref(db, 'rooms/' + code), { p2: true, stage: 'flip' });
      resetReply(); setError(''); setRole('P2'); setRoom(null); setRoomCode(code); setScreen('room');
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const leave = () => {
    resetReply();
    setRoomCode(null); setRoom(null); setRole(null);
    setJoinCode(''); setError(''); setNotice(''); setCustomMode(false); setCustomText('');
    setPage(3); setScreen('games');
  };
  // ---- Spin the bottle (coin flip ki jagah) ----
  const bottleRot = useRef(new Animated.Value(0)).current;
  const spinSeen = useRef(0);
  const [spinDone, setSpinDone] = useState(false);
  useEffect(() => {
    if (!room || room.stage !== 'flip' || !room.spin) return;
    if (spinSeen.current === room.spin.t) return;
    spinSeen.current = room.spin.t;
    setSpinDone(false);
    bottleRot.setValue(0);
    Animated.timing(bottleRot, { toValue: room.spin.deg, duration: 3800, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { setSpinDone(true); playSound('success', soundOn); });
  }, [room && room.spin && room.spin.t, room && room.stage]);
  const spinBottle = () => {
    let deg = 0;
    do { deg = 1440 + Math.floor(Math.random() * 360) + Math.floor(Math.random() * 3) * 360; }
    while (Math.abs(Math.cos(((deg % 360) * Math.PI) / 180)) < 0.15);
    const asker = Math.cos(((deg % 360) * Math.PI) / 180) > 0 ? 'P2' : 'P1';
    playSound('click', soundOn);
    update(roomRef(), { spin: { deg, t: Date.now() }, result: 'Bottle', asker });
  };
  const startBattle = () => update(roomRef(), { stage: 'game' });

  const ask = (kind) => {
    const list = kind === 'Truth' ? truths : dares;
    let used = (room.used && room.used[kind]) ? Object.keys(room.used[kind]).map((k) => room.used[kind][k]) : [];
    let avail = list.map((_, i) => i).filter((i) => !used.includes(i));
    if (avail.length === 0) { used = []; avail = list.map((_, i) => i); }
    const idx = pickOne(avail);
    update(roomRef(), { question: { kind, text: list[idx] }, ['used/' + kind]: [...used, idx] });
  };
  const sendCustom = () => {
    const text = customText.trim();
    if (!text) return;
    update(roomRef(), { question: { kind: 'Sawal', text } });
    setCustomText(''); setCustomMode(false);
  };
  const judge = (delta) => {
    const answerer = room.asker === 'P1' ? 'P2' : 'P1';
    update(roomRef(), { scores: { ...room.scores, [answerer]: room.scores[answerer] + delta }, question: null, reply: null, asker: answerer });
    remove(ref(db, 'chats/img-' + roomCode)).catch(() => {});
    playSound(delta > 0 ? 'success' : 'error', soundOn);
  };
  const endGame = () => update(roomRef(), { stage: 'end' });

  const pickImage = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          const sc = Math.min(1, 480 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
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
      await update(roomRef(), { reply: { iv: encT.iv, ct: encT.ct, from: role, rid, img: !!replyImg } });
      setReplyText(''); setReplyImg(null); setNotice('');
      playSound('msg', soundOn);
    } catch (e) { setError('Jawab nahi gaya: ' + e.message); }
  };

  const createChat = async () => {
    try {
      const code = await freshCode('chats/', () => randomId().slice(0, 8));
      await set(ref(db, 'chats/' + code), { created: Date.now() });
      setError(''); setChatData(null); setShared(null); setPlain([]); setChatFull(false);
      lastChat.current = ''; setChatCode(code);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const joinChat = async () => {
    try {
      const code = chatJoin.trim().toLowerCase();
      const snap = await get(ref(db, 'chats/' + code));
      if (!snap.exists()) { setError('Chat nahi mila, code check karo'); return; }
      setError(''); setChatData(null); setShared(null); setPlain([]); setChatFull(false);
      lastChat.current = ''; setChatCode(code);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const backToTools = () => { setError(''); setNotice(''); setPage(3); setScreen('home'); };
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
      playSound('click', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const editMsg = async () => {
    const text = msgText.trim();
    if (!text || !selMsg || !shared) return;
    try {
      const enc = await encryptText(shared.aes, text);
      await update(ref(db, 'chats/' + chatCode + '/messages/' + selMsg.key), { iv: enc.iv, ct: enc.ct, edited: true });
      setMsgText(''); setSelMsg(null);
    } catch (e) { setError('Edit nahi hua: ' + e.message); }
  };
  const deleteForMe = () => {
    if (!selMsg) return;
    const h = [...hidden, selMsg.key]; setHidden(h);
    try { localStorage.setItem('nexdare_hidden_' + chatCode, JSON.stringify(h)); } catch (e) {}
    setSelMsg(null);
  };
  const deleteForAll = async () => {
    if (!selMsg || !ident || selMsg.sid !== ident.sid) return;
    try { await remove(ref(db, 'chats/' + chatCode + '/messages/' + selMsg.key)); } catch (e) { setError('Error: ' + e.message); }
    setSelMsg(null);
  };
  const deleteChat = async () => {
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await remove(ref(db, 'chats/' + chatCode)); } catch (e) { setError('Error: ' + e.message); return; }
    leaveChat();
  };
  const saveChat = async () => {
    const vis = plain.filter((m) => !hidden.includes(m.key));
    const body = 'Nexdare chat ' + chatCode + '\n\n' + vis.map((m) => '[' + new Date(m.t).toLocaleString() + '] ' + (ident && m.sid === ident.sid ? t('you') : t('partner')) + ': ' + m.text).join('\n');
    if (Platform.OS === 'web') {
      try {
        const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
        const a = document.createElement('a'); a.href = url; a.download = 'nexdare-chat.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        setNotice('Chat file mein save ho gayi.');
      } catch (e) { setError('Save nahi ho paya: ' + e.message); }
    } else { try { await Share.share({ message: body }); } catch (e) {} }
  };
  const startChatCall = () => { if (shared) Linking.openURL('https://meet.jit.si/nexdare-' + shared.callHash); };

  const clearAllData = () => {
    try {
      ['nexdare_id_v1', 'nexdare_profile', 'nexdare_sound', 'nexdare_notif', 'nexdare_user', 'nexdare_skin', 'nexdare_myphoto', 'nexdare_myphotohd', 'nexdare_bgphoto'].forEach((k) => localStorage.removeItem(k));
      clearAuthTokens();
      Object.keys(localStorage).forEach((k) => { if (k.startsWith('nexdare_hidden_') || k.startsWith('nexdare_dmhidden_') || k.startsWith('nexdare_grphidden_')) localStorage.removeItem(k); });
      sessionIdentity = null;
      setProfile({ name: '', bio: '', avatar: '😎', gender: '' });
      setSkin(''); setMyPhoto(''); setMyPhotoHd(''); setBgPhoto('');
      setSoundOn(true); setNotifOn(false); setIsLoggedIn(false); setCurrentUser(null);
      setShowClearConfirm(false); setNotice(t('dataCleared'));
    } catch (e) { setError('Clear failed: ' + e.message); }
  };
  const requestNotif = async () => {
    if (typeof Notification === 'undefined') { setNotice('Notifications not supported'); return; }
    const perm = await Notification.requestPermission();
    const on = perm === 'granted';
    setNotifOn(on); localStorage.setItem('nexdare_notif', on ? '1' : '0');
    if (on) showNotif('Message 💌', 'Notifications ON ho gayi!', true);
  };

  // ===== GROUP CHAT + CHAT LIST PREVIEW =====
  const ensurePic = async (f) => {
    if (picTried.current[f.uid]) return;
    picTried.current[f.uid] = true;
    try {
      const prof = await call('GET', 'profiles/' + f.uid);
      if (prof && prof.photo) setPics((p) => ({ ...p, [f.uid]: prof.photo }));
    } catch (e) { picTried.current[f.uid] = false; }
  };
  const updatePreview = async (f, m) => {
    if (!subtle) return;
    try {
      const idn = await loadIdentity();
      let pc = peerCache.current[f.uid];
      if (!pc) {
        const prof = await call('GET', 'profiles/' + f.uid);
        if (!prof || !prof.pub) return;
        const sh = await deriveShared(idn.priv, prof.pub);
        pc = { aes: sh.aes, photo: prof.photo || '' };
        peerCache.current[f.uid] = pc;
        if (pc.photo) setPics((p) => ({ ...p, [f.uid]: pc.photo }));
      }
      const key = m.t + ':' + m.ct;
      if (previewKey.current[f.chatId] === key) return;
      previewKey.current[f.chatId] = key;
      const text = await decryptText(pc.aes, m);
      let shown = text === null ? '🔒 Message' : text;
      if (text && text.indexOf('{"__f":1') === 0) {
        try {
          const j = JSON.parse(text);
          shown = (j.type || '').indexOf('image/') === 0 ? '📷 Photo' : (j.type || '').indexOf('audio/') === 0 ? '🎤 Voice note' : '📎 ' + (j.name || 'File');
        } catch (e) {}
      }
      setPreviews((p) => ({ ...p, [f.chatId]: { text: shown, t: m.t, mine: m.from === currentUser.uid } }));
    } catch (e) {}
  };

  const myDisplayName = () => (profile.name || (currentUser && (currentUser.name || currentUser.username)) || 'Me');
  const memberObj = () => ({ name: myDisplayName(), avatar: (profile.avatar || (currentUser && currentUser.avatar) || '😎'), t: Date.now() });

  const enterGroup = async (code, nameHint) => {
    const gid = await groupIdOf(code);
    const aes = await groupKeyOf(code);
    setGrpRaw({}); setGrpPlain([]); setGrpMembers({}); setGrpMeta(undefined); setGrpSel(null); setGrpEditing(null);
    setGrpText(''); setGrpInfo(false); setGrpConfirm(''); lastGrp.current = ''; grpCount.current = -1;
    let h = [];
    try { h = JSON.parse(localStorage.getItem('nexdare_grphidden_' + gid)) || []; } catch (e) {}
    setGrpHidden(h);
    setGrpKey(aes);
    setGrp({ gid, code, name: nameHint || 'Group' });
    setError(''); setNotice('');
  };
  const createGroup = async () => {
    const name = grpNewName.trim();
    if (!name) { setError('Group ka naam likho'); return; }
    if (!subtle || !currentUser) { setError('Group chat ke liye browser chahiye'); return; }
    setError(''); setNotice('');
    try {
      const code = newGroupCode();
      const gid = await groupIdOf(code);
      const aes = await groupKeyOf(code);
      const encName = await encryptText(aes, name);
      await set(ref(db, 'groups/' + gid + '/meta'), { n: encName, owner: currentUser.uid, created: Date.now() });
      await set(ref(db, 'groups/' + gid + '/members/' + currentUser.uid), memberObj());
      await set(ref(db, 'userGroups/' + currentUser.uid + '/' + gid), { code, name, t: Date.now() });
      setGrpNewName('');
      await enterGroup(code, name);
      setGrpInfo(true);
    } catch (e) { setError('Group nahi bana: ' + e.message); }
  };
  const joinGroup = async () => {
    const code = grpJoinCode.trim().toLowerCase().replace(/[\s-]/g, '');
    if (!code) { setError('Group code likho'); return; }
    if (!subtle || !currentUser) { setError('Group chat ke liye browser chahiye'); return; }
    setError(''); setNotice('');
    try {
      const gid = await groupIdOf(code);
      const snap = await get(ref(db, 'groups/' + gid + '/meta'));
      if (!snap.exists()) { setError('Group nahi mila, code check karo'); return; }
      const aes = await groupKeyOf(code);
      const nm = (await decryptText(aes, snap.val().n)) || 'Group';
      await set(ref(db, 'groups/' + gid + '/members/' + currentUser.uid), memberObj());
      await set(ref(db, 'userGroups/' + currentUser.uid + '/' + gid), { code, name: nm, t: Date.now() });
      setGrpJoinCode('');
      await enterGroup(code, nm);
    } catch (e) { setError('Join nahi hua: ' + e.message); }
  };
  const openGroup = (g) => { enterGroup(g.code, g.name).catch((e) => setError('Error: ' + e.message)); };
  const closeGroup = () => {
    setGrp(null); setGrpKey(null); setGrpRaw({}); setGrpPlain([]); setGrpMembers({}); setGrpMeta(undefined);
    setGrpSel(null); setGrpEditing(null); setGrpText(''); setGrpInfo(false); setGrpConfirm(''); lastGrp.current = '';
    setError(''); setNotice('');
  };
  const leaveGroupForever = async () => {
    if (grpConfirm !== 'leave') { setGrpConfirm('leave'); return; }
    try {
      await remove(ref(db, 'groups/' + grp.gid + '/members/' + currentUser.uid));
      await remove(ref(db, 'userGroups/' + currentUser.uid + '/' + grp.gid));
    } catch (e) { setError('Error: ' + e.message); return; }
    closeGroup();
  };
  const removeGroupFromList = async (g) => {
    try {
      const gid = await groupIdOf(g.code);
      await remove(ref(db, 'groups/' + gid + '/members/' + currentUser.uid)).catch(() => {});
      await remove(ref(db, 'userGroups/' + currentUser.uid + '/' + gid));
    } catch (e) { setError('Error: ' + e.message); }
  };
  const deleteGroupForAll = async () => {
    if (grpConfirm !== 'del') { setGrpConfirm('del'); return; }
    try {
      await remove(ref(db, 'groups/' + grp.gid));
      await remove(ref(db, 'userGroups/' + currentUser.uid + '/' + grp.gid));
    } catch (e) { setError('Delete nahi hua: ' + e.message); return; }
    closeGroup();
  };
  const sendGrp = async () => {
    const text = grpText.trim();
    if (!text || !grp || !grpKey || !currentUser) return;
    setGrpText(''); setNotice('');
    try {
      const enc = await encryptText(grpKey, JSON.stringify({ n: myDisplayName(), x: text }));
      if (grpEditing) {
        await update(ref(db, 'groups/' + grp.gid + '/messages/' + grpEditing), { iv: enc.iv, ct: enc.ct, edited: true });
        setGrpEditing(null);
      } else {
        await push(ref(db, 'groups/' + grp.gid + '/messages'), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now() });
      }
      playSound('click', soundOn);
    } catch (e) { setError('Message nahi gaya: ' + e.message); }
  };
  const grpStartEdit = () => {
    if (!grpSel || grpSel.from !== currentUser.uid) return;
    setGrpEditing(grpSel.key); setGrpText(grpSel.text); setGrpSel(null);
  };
  const grpDeleteForMe = () => {
    if (!grpSel || !grp) return;
    const h = [...grpHidden, grpSel.key]; setGrpHidden(h);
    try { localStorage.setItem('nexdare_grphidden_' + grp.gid, JSON.stringify(h)); } catch (e) {}
    setGrpSel(null);
  };
  const grpDeleteForAll = async () => {
    if (!grpSel || !grp || grpSel.from !== currentUser.uid) return;
    try { await remove(ref(db, 'groups/' + grp.gid + '/messages/' + grpSel.key)); } catch (e) { setError('Delete nahi hua: ' + e.message); }
    setGrpSel(null);
  };
  const shareGroupCode = async () => {
    if (!grp) return;
    const msg = 'Nexdare pe mere group "' + grp.name + '" me join karo! Group code: ' + grp.code + '  (https://nexdare-web.vercel.app)';
    try { await Share.share({ message: msg }); } catch (e) { copyText(msg); }
  };

  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.username || screen !== 'groups') return;
    const u = onValue(ref(db, 'userGroups/' + currentUser.uid), (snap) => setGroupList(snap.val() || {}));
    return () => u();
  }, [isLoggedIn, currentUser && currentUser.uid, screen]);

  useEffect(() => {
    if (screen !== 'groups' || !grp) return;
    const u1 = onValue({ path: 'groups/' + grp.gid + '/messages', query: 'orderBy=%22%24key%22&limitToLast=100' }, (snap) => {
      const v = snap.val();
      const str = JSON.stringify(v);
      if (str !== lastGrp.current) { lastGrp.current = str; setGrpRaw(v || {}); }
    });
    const u2 = onValue(ref(db, 'groups/' + grp.gid + '/members'), (snap) => setGrpMembers(snap.val() || {}));
    const u3 = onValue(ref(db, 'groups/' + grp.gid + '/meta'), (snap) => setGrpMeta(snap.val()));
    return () => { u1(); u2(); u3(); };
  }, [screen, grp && grp.gid]);

  useEffect(() => {
    if (!grpKey) { setGrpPlain([]); return; }
    let cancelled = false;
    (async () => {
      const list = Object.keys(grpRaw).map((k) => ({ key: k, ...grpRaw[k] }));
      list.sort((a, b) => a.t - b.t);
      const out = [];
      for (const m of list) {
        const txt = await decryptText(grpKey, m);
        let name = '?';
        let text = '🔒 (decrypt nahi ho paya)';
        if (txt !== null) {
          try { const j = JSON.parse(txt); name = j.n || '?'; text = j.x; } catch (e) { text = txt; }
        }
        out.push({ key: m.key, from: m.from, t: m.t, edited: !!m.edited, name, text });
      }
      if (!cancelled) {
        if (grpCount.current >= 0 && out.length > grpCount.current && out.length && currentUser && out[out.length - 1].from !== currentUser.uid) playSound('msg', soundOn);
        grpCount.current = out.length;
        setGrpPlain(out);
      }
    })();
    return () => { cancelled = true; };
  }, [grpKey, grpRaw]);
  // ===== GROUP CHAT + CHAT LIST PREVIEW END =====

  // ===== GAMES + COUPLE SPACE + SAFETY =====
  const getPeer = async (f) => {
    let pc = peerCache.current[f.uid];
    if (pc) return pc;
    const idn = await loadIdentity();
    const prof = await call('GET', 'profiles/' + f.uid);
    if (!prof || !prof.pub) return null;
    const sh = await deriveShared(idn.priv, prof.pub);
    pc = { aes: sh.aes, photo: prof.photo || '' };
    peerCache.current[f.uid] = pc;
    if (pc.photo) setPics((p) => ({ ...p, [f.uid]: pc.photo }));
    return pc;
  };
  const choosePal = (f) => {
    setPal(f); setPalPicking(false);
    try { localStorage.setItem('nexdare_pal', f.uid); } catch (e) {}
  };
  const palName = pal ? (pal.name || pal.username) : '';
  const cidPath = (p) => 'couples/' + pal.chatId + '/' + p;
  const backToGames = () => { setError(''); setNotice(''); setPage(3); setScreen('games'); };
  const backToCouple = () => { setError(''); setNotice(''); setScreen('couple'); };
  const goScreen = (k) => { setError(''); setNotice(''); setPqData(null); setQuizIn(''); setScreen(k); };

  useEffect(() => {
    const keys = Object.keys(cloudFriends);
    if (!keys.length) return;
    let saved = null;
    try { saved = localStorage.getItem('nexdare_pal'); } catch (e) {}
    if (!pal && saved && cloudFriends[saved]) setPal(cloudFriends[saved]);
    else if (pal && !cloudFriends[pal.uid]) setPal(null);
  }, [JSON.stringify(Object.keys(cloudFriends))]);

  useEffect(() => {
    setPalAes(null);
    if (!pal || !subtle) return;
    let c = false;
    (async () => { try { const pc = await getPeer(pal); if (pc && !c) setPalAes(pc.aes); } catch (e) {} })();
    return () => { c = true; };
  }, [pal && pal.uid, palPicking]);

  blocksRef.current = blocks;
  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.username) return;
    const u = onValue(ref(db, 'blocks/' + currentUser.uid), (snap) => setBlocks(snap.val() || {}));
    return () => u();
  }, [isLoggedIn, currentUser && currentUser.uid]);

  const loadStreak = async () => {
    if (!pal || !currentUser) return;
    try {
      const v = (await call('GET', cidPath('daily'), undefined, 'orderBy=%22%24key%22&limitToLast=60')) || {};
      let n = 0;
      const d = new Date(); d.setDate(d.getDate() - 1);
      for (let i = 0; i < 60; i++) {
        const e = v[dayKey(d)];
        if (e && e[currentUser.uid] && e[pal.uid]) { n++; d.setDate(d.getDate() - 1); } else break;
      }
      setStreakBase(n);
    } catch (e) {}
  };
  useEffect(() => { if ((screen === 'couple' || screen === 'daily') && pal) loadStreak(); }, [screen, pal && pal.uid]);

  useEffect(() => {
    if (!pal || !isLoggedIn) return;
    const subs = [];
    if (screen === 'wyr' || screen === 'nhie') subs.push(onValue(ref(db, cidPath(screen)), (snap) => setPqData({ kind: screen, v: snap.val() })));
    if (screen === 'quiz') subs.push(onValue(ref(db, cidPath('quiz')), (snap) => setQuiz(snap.val())));
    if (screen === 'ttt') subs.push(onValue(ref(db, cidPath('ttt')), (snap) => setTttDoc(snap.val())));
    if (screen === 'daily') subs.push(onValue(ref(db, cidPath('daily/' + dayKey())), (snap) => setDailyDoc(snap.val())));
    if (screen === 'mem') subs.push(onValue(ref(db, cidPath('mem')), (snap) => setMemDoc(snap.val())));
    if (screen === 'notes') subs.push(onValue({ path: cidPath('notes'), query: 'orderBy=%22%24key%22&limitToLast=50' }, (snap) => setNotesDoc(snap.val())));
    return () => subs.forEach((u) => u());
  }, [screen, pal && pal.uid, isLoggedIn]);

  // ---- Would You Rather / Never Have I Ever ----
  const pqCur = (kind) => (pqData && pqData.kind === kind ? pqData.v : null);
  const pqNext = async (kind) => {
    const list = kind === 'wyr' ? WYR : NHIE;
    const cur = pqCur(kind);
    let used = (cur && cur.used) || [];
    if (used.length >= list.length) used = [];
    const pool = list.map((_, i) => i).filter((i) => !used.includes(i));
    const qi = pickOne(pool);
    try { await set(ref(db, cidPath(kind)), { qi, used: [...used, qi], n: ((cur && cur.n) || 0) + 1 }); playSound('click', soundOn); }
    catch (e) { setError('Error: ' + e.message); }
  };
  const pqPick = async (kind, i) => {
    try { await update(ref(db, cidPath(kind + '/picks')), { [currentUser.uid]: i }); playSound('click', soundOn); }
    catch (e) { setError('Error: ' + e.message); }
  };

  // ---- Presence, photos, Tic Tac Toe ----
  useEffect(() => {
    setViewerHd('');
    if (!viewer || !viewer.getHd) return;
    let c = false;
    (async () => {
      try { const h = await viewer.getHd(); if (!c) setViewerHd(h && typeof h === 'string' ? h : 'none'); } catch (e) { if (!c) setViewerHd('none'); }
    })();
    return () => { c = true; };
  }, [viewer && viewer.uri]);

  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.uid || !currentUser.username) return;
    const pRef = ref(db, 'presence/' + currentUser.uid);
    const beat = (on) => { set(pRef, showSeen ? { t: Date.now(), on } : { t: 0, on: false, hide: true }).catch(() => {}); };
    const isWeb = Platform.OS === 'web' && typeof document !== 'undefined';
    beat(true);
    const timer = setInterval(() => beat(!(isWeb && document.hidden)), 20000);
    const onVis = () => beat(!document.hidden);
    const onUnload = () => beat(false);
    if (isWeb) { document.addEventListener('visibilitychange', onVis); window.addEventListener('pagehide', onUnload); }
    return () => {
      clearInterval(timer);
      if (isWeb) { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onUnload); }
      beat(false);
    };
  }, [isLoggedIn, currentUser && currentUser.uid, showSeen]);

  const loadPres = async (uids) => {
    const out = {};
    const dout = {};
    for (const u of uids) {
      try { out[u] = (await call('GET', 'presence/' + u)) || null; } catch (e) {}
      try { dout[u] = !!(await call('GET', 'profiles/' + u + '/deactivated')); } catch (e) {}
    }
    setPresMap((p) => ({ ...p, ...out }));
    setDeactMap((p) => ({ ...p, ...dout }));
  };
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    let uids = [];
    if (screen === 'dm' && dmFriend) uids = [dmFriend.uid];
    else if (screen === 'friends') uids = Object.keys(cloudFriends);
    else if (screen === 'groups' && grp) uids = Object.keys(grpMembers).filter((u) => u !== currentUser.uid);
    if (!uids.length) return;
    loadPres(uids);
    const timer = setInterval(() => loadPres(uids), screen === 'dm' ? 10000 : 20000);
    return () => clearInterval(timer);
  }, [screen, dmFriend && dmFriend.uid, grp && grp.gid, Object.keys(cloudFriends).join(','), Object.keys(grpMembers).join(',')]);
  const toggleSeen = (v) => { setShowSeen(v); try { localStorage.setItem('nexdare_showseen', v ? '1' : '0'); } catch (e) {} };

  useEffect(() => {
    if (screen === 'groups' && grp && grpInfo) Object.keys(grpMembers).forEach((u) => ensurePic({ uid: u }));
  }, [grpInfo, Object.keys(grpMembers).join(',')]);

  // group photo (encrypted with the group key)
  const grpHdLoader = async () => {
    const v = await call('GET', 'groups/' + grp.gid + '/photoHd');
    if (!v || !v.hd) return '';
    return (await decryptText(grpKey, v.hd)) || '';
  };
  const grpHdFor = (g) => async () => {
    const v = await call('GET', 'groups/' + g.gid + '/photoHd');
    if (!v || !v.hd) return '';
    const k = await groupKeyOf(g.code);
    return (await decryptText(k, v.hd)) || '';
  };
  const loadGrpPhoto = async () => {
    if (!grp || !grpKey) return;
    try {
      const v = await call('GET', 'groups/' + grp.gid + '/photo');
      if (v && v.th) {
        const txt = await decryptText(grpKey, v.th);
        setGrpPhoto(txt || '');
        if (txt) setGrpPics((p) => ({ ...p, [grp.gid]: txt }));
      } else setGrpPhoto('');
    } catch (e) {}
  };
  useEffect(() => {
    if (screen !== 'groups' || !grp || !grpKey) return;
    setGrpPhoto('');
    loadGrpPhoto();
    const tm = setInterval(loadGrpPhoto, 60000);
    return () => clearInterval(tm);
  }, [screen, grp && grp.gid, grpKey]);
  useEffect(() => {
    if (screen !== 'groups' || grp) return;
    Object.keys(groupList).forEach(async (gid) => {
      if (grpPicTried.current[gid]) return;
      grpPicTried.current[gid] = true;
      try {
        const v = await call('GET', 'groups/' + gid + '/photo');
        if (v && v.th) {
          const k = await groupKeyOf(groupList[gid].code);
          const txt = await decryptText(k, v.th);
          if (txt) setGrpPics((p) => ({ ...p, [gid]: txt }));
        }
      } catch (e) { grpPicTried.current[gid] = false; }
    });
  }, [screen, !!grp, Object.keys(groupList).join(',')]);
  const pickGroupPhoto = () => {
    if (!grp || !grpKey) return;
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const du = await readAsDataUrl(file);
        const thumb = await resizeDataUrl(du, 240, 0.82);
        const hd = await resizeDataUrl(du, 1080, 0.86);
        const eTh = await encryptText(grpKey, thumb);
        const eHd = await encryptText(grpKey, hd);
        await set(ref(db, 'groups/' + grp.gid + '/photoHd'), { hd: eHd });
        await set(ref(db, 'groups/' + grp.gid + '/photo'), { th: eTh, t: Date.now() });
        setGrpPhoto(thumb); setGrpPics((p) => ({ ...p, [grp.gid]: thumb }));
        setNotice('Group photo laga di 💕');
      } catch (e) { setError('Photo nahi lagi: ' + e.message); }
    };
    input.click();
  };

  // share app
  const shareApp = async () => {
    const msg = 'Nexdare 💕 - couples, dost aur family ke liye chat + games app. Yahan kholo: https://nexdare-web.vercel.app';
    try { await Share.share({ message: msg }); } catch (e) { copyText(msg); }
  };

  // Tic Tac Toe (dost ke saath)
  const tttNewRound = async () => {
    if (!pal || !currentUser) return;
    const cur = tttDoc;
    const xUid = cur && cur.xUid === currentUser.uid ? pal.uid : currentUser.uid;
    try {
      await set(ref(db, cidPath('ttt')), { board: '---------', xUid, turn: xUid, status: 'play', line: '', scores: (cur && cur.scores) || {}, n: ((cur && cur.n) || 0) + 1, t: Date.now() });
      playSound('click', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const tttMove = async (i) => {
    const d = tttDoc;
    if (!d || d.status !== 'play' || d.turn !== currentUser.uid || d.board[i] !== '-') return;
    const sym = d.xUid === currentUser.uid ? 'X' : 'O';
    const b = d.board.slice(0, i) + sym + d.board.slice(i + 1);
    const r = tttCheck(b);
    const upd = { board: b, t: Date.now() };
    if (r) {
      const key = r.w === 'draw' ? 'draw' : currentUser.uid;
      upd.status = r.w === 'draw' ? 'draw' : 'win';
      upd.winner = r.w === 'draw' ? '' : currentUser.uid;
      upd.line = r.line.join('');
      upd['scores/' + key] = (((d.scores || {})[key]) || 0) + 1;
    } else upd.turn = pal.uid;
    setTttDoc({ ...d, board: b, turn: r ? d.turn : pal.uid, status: upd.status || 'play' });
    try { await update(ref(db, cidPath('ttt')), upd); playSound(r ? 'success' : 'click', soundOn); }
    catch (e) { setError('Error: ' + e.message); }
  };
  const tttResetScore = async () => { try { await update(ref(db, cidPath('ttt')), { scores: null }); } catch (e) { setError('Error: ' + e.message); } };
  // Tic Tac Toe (computer se)
  const tttCpuTap = (i) => {
    setTttCpu((g) => (g.status !== 'play' || g.turn !== 'X' || g.board[i] !== '-' ? g : tttApply(g, i, 'X')));
    playSound('click', soundOn);
  };
  const tttCpuNew = () => setTttCpu((g) => ({ ...g, board: '---------', status: 'play', line: [], winner: undefined, round: g.round + 1, turn: (g.round + 1) % 2 === 0 ? 'X' : 'O' }));
  useEffect(() => {
    if (screen !== 'ttt' || tttMode !== 'cpu') return;
    if (tttCpu.status !== 'play' || tttCpu.turn !== 'O') return;
    const tm = setTimeout(() => {
      setTttCpu((g) => {
        if (g.status !== 'play' || g.turn !== 'O') return g;
        const mv = tttCpuMove(g.board, tttLevel);
        return mv < 0 ? g : tttApply(g, mv, 'O');
      });
    }, 600);
    return () => clearTimeout(tm);
  }, [screen, tttMode, tttCpu.turn, tttCpu.status, tttCpu.round]);
  useEffect(() => { if (screen === 'ttt' && tttMode === 'cpu' && tttCpu.status !== 'play') playSound('success', soundOn); }, [tttCpu.status]);

  // ---- Love Quiz ----
  const pickQuizQ = () => {
    const used = (quiz && quiz.used) || [];
    let pool = QUIZ_Q.map((_, i) => i).filter((i) => !used.includes(i));
    if (!pool.length) pool = QUIZ_Q.map((_, i) => i);
    setQuizQ(QUIZ_Q[pickOne(pool)]);
  };
  const quizStart = async (askerUid) => {
    try {
      await set(ref(db, cidPath('quiz')), { stage: 'pick', asker: askerUid, scores: (quiz && quiz.scores) || {}, used: (quiz && quiz.used) || [] });
      setQuizQ(''); setQuizIn('');
    } catch (e) { setError('Error: ' + e.message); }
  };
  const quizSend = async () => {
    const q = quizQ.trim(); const a = quizIn.trim();
    if (!q || !a) { setError('Sawal aur jawab dono likho'); return; }
    try {
      const enc = await encryptText(palAes, a);
      const used = (quiz && quiz.used) || [];
      const idx = QUIZ_Q.indexOf(q);
      await update(ref(db, cidPath('quiz')), { stage: 'guess', q, a: enc, g: null, used: idx >= 0 ? [...used, idx] : used });
      setQuizIn(''); setQuizQ(''); setError('');
    } catch (e) { setError('Error: ' + e.message); }
  };
  const quizGuess = async () => {
    const g = quizIn.trim();
    if (!g) { setError('Apna guess likho'); return; }
    try {
      const enc = await encryptText(palAes, g);
      await update(ref(db, cidPath('quiz')), { stage: 'judge', g: enc });
      setQuizIn(''); setError('');
    } catch (e) { setError('Error: ' + e.message); }
  };
  const quizJudge = async (ok) => {
    try {
      const sc = { ...((quiz && quiz.scores) || {}) };
      const guesser = quiz.asker === currentUser.uid ? pal.uid : currentUser.uid;
      sc[guesser] = (sc[guesser] || 0) + (ok ? 1 : 0);
      await update(ref(db, cidPath('quiz')), { stage: 'done', scores: sc, correct: !!ok });
      playSound(ok ? 'success' : 'click', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const quizReset = async () => { try { await remove(ref(db, cidPath('quiz'))); setQuiz(null); } catch (e) { setError('Error: ' + e.message); } };
  useEffect(() => {
    if (screen === 'quiz' && quiz && quiz.stage === 'pick' && currentUser && quiz.asker === currentUser.uid && !quizQ) pickQuizQ();
  }, [quiz, screen]);
  useEffect(() => {
    if (!palAes || !quiz) { setQuizPlain({}); return; }
    let c = false;
    (async () => {
      const a = quiz.a ? await decryptText(palAes, quiz.a) : null;
      const g = quiz.g ? await decryptText(palAes, quiz.g) : null;
      if (!c) setQuizPlain({ a, g });
    })();
    return () => { c = true; };
  }, [palAes, JSON.stringify(quiz)]);

  // ---- Daily question ----
  const dailySend = async () => {
    const text = dailyIn.trim();
    if (!text) return;
    try {
      const enc = await encryptText(palAes, text);
      await set(ref(db, cidPath('daily/' + dayKey() + '/' + currentUser.uid)), enc);
      setDailyIn(''); setError('');
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  useEffect(() => {
    if (!palAes || !dailyDoc) { setDailyPlain({}); return; }
    let c = false;
    (async () => {
      const out = {};
      for (const uid of Object.keys(dailyDoc)) out[uid] = await decryptText(palAes, dailyDoc[uid]);
      if (!c) setDailyPlain(out);
    })();
    return () => { c = true; };
  }, [palAes, JSON.stringify(dailyDoc)]);

  // ---- Together / memories ----
  const memSaveStart = async () => {
    if (!memStart) { setError('Date chuno'); return; }
    try { await update(ref(db, cidPath('mem')), { start: memStart }); setMemEditing(false); setError(''); } catch (e) { setError('Error: ' + e.message); }
  };
  const memAddEvent = async () => {
    const title = evTitle.trim();
    if (!title || !evDate) { setError('Naam aur date dono chuno'); return; }
    try {
      const enc = await encryptText(palAes, title);
      await set(ref(db, cidPath('mem/events/' + randomId())), { iv: enc.iv, ct: enc.ct, date: evDate });
      setEvTitle(''); setEvDate(''); setError('');
    } catch (e) { setError('Error: ' + e.message); }
  };
  const memDelEvent = async (id) => { try { await remove(ref(db, cidPath('mem/events/' + id))); } catch (e) { setError('Error: ' + e.message); } };
  useEffect(() => {
    if (!palAes || !memDoc || !memDoc.events) { setMemPlain([]); return; }
    let c = false;
    (async () => {
      const out = [];
      for (const id of Object.keys(memDoc.events)) {
        const e = memDoc.events[id];
        const title = await decryptText(palAes, e);
        out.push({ id, date: e.date, title: title || '🔒' });
      }
      out.sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!c) setMemPlain(out);
    })();
    return () => { c = true; };
  }, [palAes, JSON.stringify(memDoc && memDoc.events)]);

  // ---- Sweet notes ----
  const unlockFor = (k) => {
    const d = new Date();
    if (k === '1h') return Date.now() + 3600000;
    if (k === 'am8') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); }
    if (k === 'pm9') { d.setHours(21, 0, 0, 0); if (d.getTime() < Date.now() + 600000) d.setDate(d.getDate() + 1); return d.getTime(); }
    return Date.now();
  };
  const noteSend = async () => {
    const text = noteText.trim();
    if (!text) return;
    try {
      const enc = await encryptText(palAes, text);
      await push(ref(db, cidPath('notes')), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, unlock: unlockFor(noteWhen), t: Date.now() });
      setNoteText(''); setError(''); setNotice('Note bhej diya 💌');
      playSound('success', soundOn);
    } catch (e) { setError('Error: ' + e.message); }
  };
  useEffect(() => {
    if (!palAes || !notesDoc) { setNotesPlain([]); return; }
    let c = false;
    (async () => {
      const out = [];
      for (const k of Object.keys(notesDoc)) {
        const m = notesDoc[k];
        const text = await decryptText(palAes, m);
        out.push({ key: k, from: m.from, t: m.t, unlock: m.unlock || m.t, text: text || '🔒' });
      }
      out.sort((a, b) => b.t - a.t);
      if (!c) setNotesPlain(out);
    })();
    return () => { c = true; };
  }, [palAes, JSON.stringify(notesDoc)]);

  // ---- Snapchat-style camera ----
  const camBox = () => {
    const iw = typeof window !== 'undefined' ? window.innerWidth : 360;
    const ih = typeof window !== 'undefined' ? window.innerHeight : 700;
    const bw = Math.min(iw, Math.round(ih * 0.58 * 0.75));
    return { bw, bh: Math.round(bw / 0.75) };
  };
  const stopCamStream = () => { if (camStream.current) { camStream.current.getTracks().forEach((tr) => tr.stop()); camStream.current = null; } };
  const closeCam = () => {
    try { if (camRecRef.current && camRecRef.current.state === 'recording') { camRecRef.current.onstop = null; camRecRef.current.stop(); } } catch (e) {}
    clearInterval(camRecTimer.current);
    stopCamStream(); setCam(null);
  };
  const openCamera = (cb, opts) => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.onchange = async () => { const f = input.files && input.files[0]; if (f) cb(await readAsDataUrl(f)); };
      input.click();
      return;
    }
    setCam({ cb, facing: 'environment', raw: null, fi: 0, timer: 0, count: 0, stickers: [], pick: '', caption: '', err: '', busy: false, mode: 'photo', allowVideo: !!(opts && opts.video), vid: null, rec: false, rsec: 0 });
  };
  useEffect(() => {
    if (!cam || cam.raw || cam.vid) { stopCamStream(); return; }
    let cancelled = false;
    (async () => {
      try {
        stopCamStream();
        const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cam.facing, width: { ideal: cam.mode === 'video' ? 720 : 1280 }, height: { ideal: cam.mode === 'video' ? 960 : 1280 } }, audio: cam.mode === 'video' });
        if (cancelled) { st.getTracks().forEach((tr) => tr.stop()); return; }
        camStream.current = st;
        if (camVideo.current) { camVideo.current.srcObject = st; const pr = camVideo.current.play(); if (pr && pr.catch) pr.catch(() => {}); }
      } catch (e) { if (!cancelled) setCam((c) => (c ? { ...c, err: 'Camera nahi khula. Browser me camera permission allow karo.' } : c)); }
    })();
    return () => { cancelled = true; };
  }, [!!cam, cam && cam.facing, cam && !!cam.raw, cam && !!cam.vid, cam && cam.mode]);
  useEffect(() => () => stopCamStream(), []);
  const camGrab = (facing) => {
    const v = camVideo.current;
    if (!v || !v.videoWidth) { setCam((c) => (c ? { ...c, err: 'Camera abhi ready nahi hai' } : c)); return; }
    const vw = v.videoWidth; const vh = v.videoHeight;
    let sw = vw; let sh = vh; let sx = 0; let sy = 0;
    if (vw / vh > 0.75) { sw = vh * 0.75; sx = (vw - sw) / 2; } else { sh = vw / 0.75; sy = (vh - sh) / 2; }
    const ow = Math.min(960, Math.round(sw)); const oh = Math.round(ow / 0.75);
    const c = document.createElement('canvas'); c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    if (facing === 'user') { ctx.translate(ow, 0); ctx.scale(-1, 1); }
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, ow, oh);
    setCam((x) => (x ? { ...x, raw: c.toDataURL('image/jpeg', 0.92), stickers: [], caption: '', pick: '', err: '' } : x));
  };
  const camRecToggle = () => {
    if (cam.rec) { try { camRecRef.current && camRecRef.current.stop(); } catch (e) {} return; }
    if (!camStream.current || typeof MediaRecorder === 'undefined') { setCam((x) => (x ? { ...x, err: 'Is browser me video record nahi hoti. Chrome use karo.' } : x)); return; }
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const chunks = [];
    let rec;
    try { rec = new MediaRecorder(camStream.current, mime ? { mimeType: mime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 } : { videoBitsPerSecond: 900000 }); }
    catch (e) { setCam((x) => (x ? { ...x, err: 'Video record shuru nahi hui: ' + e.message } : x)); return; }
    camRecRef.current = rec;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = async () => {
      clearInterval(camRecTimer.current);
      const blob = new Blob(chunks, { type: (rec.mimeType || 'video/webm').split(';')[0] });
      try {
        const du = await readAsDataUrl(blob);
        if (du.length > 4.6 * 1024 * 1024) { setCam((x) => (x ? { ...x, rec: false, rsec: 0, err: 'Video bahut bhari hai, chhoti record karo.' } : x)); return; }
        setCam((x) => (x ? { ...x, vid: du, rec: false, rsec: 0, err: '' } : x));
      } catch (e) { setCam((x) => (x ? { ...x, rec: false, err: 'Video save nahi hui' } : x)); }
    };
    rec.start(500);
    let sec = 0;
    setCam((x) => (x ? { ...x, rec: true, rsec: 0, err: '' } : x));
    camRecTimer.current = setInterval(() => { sec += 1; setCam((x) => (x ? { ...x, rsec: sec } : x)); if (sec >= 15) { try { rec.stop(); } catch (e) {} } }, 1000);
  };
  const camShutter = () => {
    if (!cam || cam.raw || cam.vid || cam.count) return;
    if (cam.mode === 'video') { camRecToggle(); return; }
    const facing = cam.facing;
    if (!cam.timer) { camGrab(facing); return; }
    let n = cam.timer;
    setCam((x) => (x ? { ...x, count: n } : x));
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(iv); setCam((x) => (x ? { ...x, count: 0 } : x)); camGrab(facing); }
      else setCam((x) => (x ? { ...x, count: n } : x));
    }, 1000);
  };
  const camPlace = (e) => {
    if (!cam || !cam.raw || !cam.pick) return;
    const { bw, bh } = camBox();
    const ne = (e && e.nativeEvent) || {};
    const x = Math.max(0.06, Math.min(0.94, (ne.locationX != null ? ne.locationX : bw / 2) / bw));
    const y = Math.max(0.06, Math.min(0.94, (ne.locationY != null ? ne.locationY : bh / 2) / bh));
    setCam((c) => (c ? { ...c, stickers: [...c.stickers, { e: c.pick, x, y }] } : c));
  };
  const camUse = async () => {
    if (!cam || (!cam.raw && !cam.vid) || cam.busy) return;
    const snap = cam;
    setCam((x) => (x ? { ...x, busy: true } : x));
    try { const du = snap.vid ? snap.vid : await camCompose(snap); closeCam(); await snap.cb(du); }
    catch (e) { setCam((x) => (x ? { ...x, busy: false, err: 'Photo nahi ban payi: ' + e.message } : x)); }
  };
  const sendCamToDm = async (du) => {
    const small = await compressImageTo(du, 1100, 0.75);
    const caption = dmText.trim(); setDmText('');
    await sendDmData(small, 'camera-' + Date.now() + '.jpg', 'image/jpeg', Math.round(small.length * 0.75), caption);
  };

  // ---- Account: deactivate / permanent delete (password + email OTP) ----
  const resetAcct = () => { setAcctMode(null); setAcctPass(''); setAcctCode(''); setAcctWord(''); setAcctSent(false); setAcctBusy(false); otpRef.current = null; setError(''); setNotice(''); };
  const startAcct = async (mode) => {
    resetAcct(); setAcctMode(mode);
    try {
      const tok = await getToken();
      const info = await authCall('accounts:lookup', { idToken: tok });
      const prov = ((info.users && info.users[0] && info.users[0].providerUserInfo) || []).map((x) => x.providerId);
      setAcctHasPw(prov.indexOf('password') >= 0);
    } catch (e) { setAcctHasPw(true); }
  };
  const sendAcctOtp = async () => {
    if (!currentUser || !currentUser.email) { setError('Email nahi mila'); return; }
    setAcctBusy(true); setError('');
    try {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      await sendOtpMail(currentUser.email, code);
      otpRef.current = { code, exp: Date.now() + 10 * 60000, tries: 0 };
      setAcctSent(true); setNotice('OTP bhej diya. Spam bhi check karo.');
    } catch (e) { setError('OTP nahi gaya: ' + e.message); }
    setAcctBusy(false);
  };
  const doDeactivate = async () => {
    const uid = currentUser.uid;
    await update(ref(db, 'users/' + uid), { deactivated: true, deactivatedAt: Date.now() });
    await update(ref(db, 'profiles/' + uid), { deactivated: true });
    await set(ref(db, 'presence/' + uid), { t: 0, on: false, hide: true }).catch(() => {});
    logout(); setScreen('home'); setAcctMode(null);
    setNotice('Account deactivate ho gaya. Dobara login karoge to wapas activate ho jayega 💞');
  };
  const doScheduleDelete = async () => {
    const uid = currentUser.uid;
    const at = Date.now() + 15 * 86400000;
    await update(ref(db, 'users/' + uid), { deletePending: true, deleteAt: at });
    await update(ref(db, 'profiles/' + uid), { deactivated: true, deleteAt: at });
    await set(ref(db, 'presence/' + uid), { t: 0, on: false, hide: true }).catch(() => {});
    logout(); setScreen('home'); setAcctMode(null);
    setNotice('Account 15 din baad delete hoga. Is beech login karoge to delete cancel ho jayega.');
  };
  const confirmAcct = async () => {
    if (!acctMode || !currentUser) return;
    setError(''); setAcctBusy(true);
    try {
      if (acctHasPw) {
        if (!acctPass) throw new Error('Password likho');
        const data = await authCall('accounts:signInWithPassword', { email: currentUser.email, password: acctPass, returnSecureToken: true });
        setAuthTokens({ idToken: data.idToken, refreshToken: data.refreshToken, expiresIn: data.expiresIn });
      }
      if (otpOn) {
        const o = otpRef.current;
        if (!acctSent || !o) throw new Error('Pehle OTP bhejo');
        if (Date.now() > o.exp) throw new Error('OTP expire ho gaya, dobara bhejo');
        if (o.tries >= 5) throw new Error('Bahut galat try. Naya OTP mangao');
        o.tries += 1;
        if (acctCode.trim() !== o.code) throw new Error('OTP galat hai');
      } else if (!acctHasPw && acctWord.trim().toUpperCase() !== 'CONFIRM') {
        throw new Error('Neeche box me CONFIRM likho');
      }
      otpRef.current = null;
      if (acctMode === 'deactivate') await doDeactivate(); else await doScheduleDelete();
    } catch (e) { setError(e.code ? authMsg(e.code) : e.message); }
    setAcctBusy(false);
  };

  // ---- Nicknames ----
  useEffect(() => {
    if (!isLoggedIn || !currentUser || !currentUser.uid || !currentUser.username) return;
    call('GET', 'users/' + currentUser.uid + '/nicks').then((v) => setNicks(v || {})).catch(() => {});
    call('GET', 'closeFriends/' + currentUser.uid).then((v) => setCloseSet(v || {})).catch(() => {});
  }, [isLoggedIn, currentUser && currentUser.uid]);
  const nameOf = (f) => nicks[f.uid] || f.name || f.username;
  const saveNick = async (uid, text) => {
    const v = text.trim();
    setNicks((p) => { const n = { ...p }; if (v) n[uid] = v; else delete n[uid]; return n; });
    setNickEdit(null);
    try {
      if (v) await set(ref(db, 'users/' + currentUser.uid + '/nicks/' + uid), v);
      else await remove(ref(db, 'users/' + currentUser.uid + '/nicks/' + uid));
    } catch (e) { setError('Nickname save nahi hua: ' + e.message); }
  };

  // ---- Stranger chat (Omegle style) ----
  const strStop = async (keepSearching) => {
    const rid = strRoom && strRoom.rid;
    try { if (rid) await update(ref(db, 'strangerRooms/' + rid + '/meta'), { ended: true }); } catch (e) {}
    try { if (currentUser) await remove(ref(db, 'strangerQueue/' + currentUser.uid)); } catch (e) {}
    setStrRoom(null); setStrRaw({}); setStrPlain([]); setStrText(''); setStrEnded(false);
    lastStr.current = ''; strCount.current = -1; strBusy.current = false; strHb.current = 0;
    setStrPeer(null); setStrMenu(false);
    if (keepSearching) strJoin.current = Date.now();
    setStrState(keepSearching ? 'searching' : 'idle');
  };
  const strWho = () => (strShowName
    ? { name: myDisplayName(), av: (profile.avatar && profile.avatar !== '😎') ? profile.avatar : '', g: profile.gender === 'male' || profile.gender === 'female' ? profile.gender : '' }
    : { name: 'Stranger', av: '', g: '' });
  const toggleStrName = () => { const v = !strShowName; setStrShowName(v); try { localStorage.setItem('nexdare_strname', v ? '1' : '0'); } catch (e) {} };
  const strStart = () => { strHb.current = 0; strJoin.current = Date.now(); setStrEnded(false); setStrState('searching'); setError(''); setNotice(''); };
  const strEnter = async (rid) => {
    const key = await groupKeyOf(rid);
    setStrRaw({}); setStrPlain([]); lastStr.current = ''; strCount.current = -1; setStrEnded(false);
    setStrPeer(null); setStrMenu(false);
    setStrRoom({ rid, key }); setStrState('chatting');
    try { await set(ref(db, 'strangerRooms/' + rid + '/who/' + currentUser.uid), strWho()); } catch (e) {}
    try { await remove(ref(db, 'strangerMatch/' + currentUser.uid)); } catch (e) {}
  };
  useEffect(() => {
    if (screen !== 'stranger' || strState !== 'searching' || !currentUser || !subtle) return;
    let stop = false;
    const tick = async () => {
      if (strBusy.current || stop) return;
      strBusy.current = true;
      try {
        const me = currentUser.uid;
        const m = await call('GET', 'strangerMatch/' + me);
        if (m && m.rid) {
          if (Date.now() - (m.t || 0) < 30000) { if (!stop) await strEnter(m.rid); return; }
          remove(ref(db, 'strangerMatch/' + me)).catch(() => {});
        }
        if (Date.now() - strHb.current > 3000) { await set(ref(db, 'strangerQueue/' + me), { j: strJoin.current, t: Date.now() }); strHb.current = Date.now(); }
        const q = (await call('GET', 'strangerQueue')) || {};
        const now = Date.now();
        const alive = Object.keys(q).filter((u) => q[u] && now - q[u].t < 12000)
          .map((u) => ({ u, j: q[u].j || 0 })).sort((a, b) => a.j - b.j || (a.u < b.u ? -1 : 1));
        setStrAlive(alive.length);
        Object.keys(q).filter((u) => !q[u] || now - q[u].t > 60000).forEach((u) => remove(ref(db, 'strangerQueue/' + u)).catch(() => {}));
        if (alive.length >= 2 && alive[0].u === me && !stop) {
          const other = alive[1].u;
          const rid = newGroupCode();
          await set(ref(db, 'strangerRooms/' + rid + '/meta'), { a: me, b: other, t: now });
          await set(ref(db, 'strangerMatch/' + other), { rid, t: now });
          await set(ref(db, 'strangerMatch/' + me), { rid, t: now });
          await remove(ref(db, 'strangerQueue/' + other)).catch(() => {});
          await remove(ref(db, 'strangerQueue/' + me)).catch(() => {});
        }
      } catch (e) { if (/ermission|denied/i.test(String((e && e.message) || ''))) setError('Firebase Rules me strangerQueue, strangerMatch, strangerRooms jodo, warna match nahi hoga.'); } finally { strBusy.current = false; }
    };
    tick();
    const iv = setInterval(tick, 700);
    return () => { stop = true; clearInterval(iv); };
  }, [screen, strState]);
  useEffect(() => {
    if (screen !== 'stranger' || strState !== 'chatting' || !strRoom) return;
    const u1 = onValue({ path: 'strangerRooms/' + strRoom.rid + '/messages', query: 'orderBy=%22%24key%22&limitToLast=100' }, (snap) => {
      const v = snap.val();
      const str = JSON.stringify(v);
      if (str !== lastStr.current) { lastStr.current = str; setStrRaw(v || {}); }
    });
    const u2 = onValue(ref(db, 'strangerRooms/' + strRoom.rid + '/meta'), (snap) => { const v = snap.val(); if (v && v.ended) setStrEnded(true); });
    const u3 = onValue(ref(db, 'strangerRooms/' + strRoom.rid + '/who'), (snap) => {
      const v = snap.val() || {};
      const other = Object.keys(v).find((k) => currentUser && k !== currentUser.uid);
      setStrPeer(other ? v[other] : null);
    });
    return () => { u1(); u2(); u3(); };
  }, [screen, strState, strRoom && strRoom.rid]);
  useEffect(() => {
    if (screen !== 'stranger' || strState === 'chatting') return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 800, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [screen, strState]);
  useEffect(() => {
    if (!strRoom) { setStrPlain([]); return; }
    let c = false;
    (async () => {
      const list = Object.keys(strRaw).map((k) => ({ key: k, ...strRaw[k] })).sort((a, b) => a.t - b.t);
      const out = [];
      for (const m of list) {
        const txt = await decryptText(strRoom.key, m);
        let text = '🔒';
        if (txt !== null) { try { text = JSON.parse(txt).x; } catch (e) { text = txt; } }
        out.push({ key: m.key, mine: !!currentUser && m.from === currentUser.uid, t: m.t, text });
      }
      if (!c) {
        if (strCount.current >= 0 && out.length > strCount.current && out.length && !out[out.length - 1].mine) playSound('msg', soundOn);
        strCount.current = out.length;
        setStrPlain(out);
      }
    })();
    return () => { c = true; };
  }, [strRoom && strRoom.rid, strRaw]);
  useEffect(() => { if (screen !== 'stranger' && strState !== 'idle') strStop(false); }, [screen]);
  const strSend = async (pre) => {
    const text = (typeof pre === 'string' ? pre : strText).trim();
    if (!text || !strRoom || strEnded) return;
    setStrText('');
    try {
      const enc = await encryptText(strRoom.key, JSON.stringify({ x: text }));
      await push(ref(db, 'strangerRooms/' + strRoom.rid + '/messages'), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now() });
      playSound('click', soundOn);
    } catch (e) { setError('Message nahi gaya: ' + e.message); }
  };
  const strReport = async () => {
    if (!strRoom) return;
    try { await push(ref(db, 'reports'), { type: 'stranger', room: strRoom.rid, by: currentUser.uid, t: Date.now() }); } catch (e) {}
    setNotice('Report bhej di. Shukriya 🙏');
    strStop(true);
  };

  // ---- Stories + Close friends ----
  const loadStories = async () => {
    if (!currentUser || !currentUser.uid) return;
    const me = currentUser.uid;
    const uids = [me, ...Object.keys(cloudFriends)];
    const now = Date.now();
    const out = {};
    for (const u of uids) {
      const list = [];
      for (const b of ['all', 'close']) {
        try {
          const v = await call('GET', 'stories/' + u + '/' + b);
          if (v) Object.keys(v).forEach((sid) => {
            const st = v[sid];
            if (st && st.exp > now) list.push({ ...st, sid, bucket: b, uid: u });
            else if (u === me) { remove(ref(db, 'stories/' + me + '/' + b + '/' + sid)).catch(() => {}); remove(ref(db, 'stories/' + me + '/' + b + 'M/' + sid)).catch(() => {}); }
          });
        } catch (e) {}
      }
      list.sort((a, b) => a.t - b.t);
      if (list.length) out[u] = list;
    }
    setStories(out);
  };
  useEffect(() => {
    if (!isLoggedIn || !currentUser || screen !== 'friends') return;
    loadStories();
    const tm = setInterval(loadStories, 30000);
    return () => clearInterval(tm);
  }, [screen, isLoggedIn, Object.keys(cloudFriends).join(',')]);
  const openStory = (uid) => {
    const list = stories[uid];
    if (!list || !list.length) return;
    let idx = list.findIndex((x) => !seenSt[x.sid]);
    if (idx < 0) idx = 0;
    setSv({ uid, list, idx });
  };
  const goStoryNew = () => { setError(''); setNotice(''); setScreen('storynew'); };
  const svNext = () => setSv((v) => { if (!v) return v; return v.idx + 1 < v.list.length ? { ...v, idx: v.idx + 1 } : null; });
  const svPrev = () => setSv((v) => (v && v.idx > 0 ? { ...v, idx: v.idx - 1 } : v));
  const markSeen = (st) => {
    if (!st) return;
    setSeenSt((p) => {
      if (p[st.sid]) return p;
      const n = { ...p, [st.sid]: 1 };
      try { localStorage.setItem('nexdare_seenst', JSON.stringify(n)); } catch (e) {}
      return n;
    });
    if (currentUser && st.uid !== currentUser.uid) set(ref(db, 'stories/' + st.uid + '/' + st.bucket + '/' + st.sid + '/views/' + currentUser.uid), Date.now()).catch(() => {});
  };
  useEffect(() => {
    if (!sv) return;
    const st = sv.list[sv.idx];
    if (!st) return;
    markSeen(st);
    if (st.type === 'text' || st.data || svMedia[st.sid]) return;
    let c = false;
    call('GET', 'stories/' + st.uid + '/' + st.bucket + 'M/' + st.sid)
      .then((v) => { if (!c) setSvMedia((p) => ({ ...p, [st.sid]: (v && v.data) || 'none' })); })
      .catch(() => { if (!c) setSvMedia((p) => ({ ...p, [st.sid]: 'none' })); });
    return () => { c = true; };
  }, [sv && sv.uid, sv && sv.idx]);
  const curSt = sv ? sv.list[sv.idx] : null;
  const curMedia = curSt ? (curSt.data || svMedia[curSt.sid]) : null;
  useEffect(() => {
    if (!sv || !curSt) return;
    if (curSt.type !== 'text' && !curMedia) return;
    const tm = setTimeout(svNext, curSt.type === 'vid' ? 17000 : 6000);
    return () => clearTimeout(tm);
  }, [sv && sv.uid, sv && sv.idx, curMedia]);
  useEffect(() => { if (!sv) setSvMedia({}); }, [!!sv]);
  const svDelete = async (st) => {
    try { await remove(ref(db, 'stories/' + currentUser.uid + '/' + st.bucket + '/' + st.sid)); await remove(ref(db, 'stories/' + currentUser.uid + '/' + st.bucket + 'M/' + st.sid)).catch(() => {}); } catch (e) { setError('Delete nahi hua: ' + e.message); }
    setSv(null); loadStories();
  };
  const postStory = async (data, media) => {
    if (!currentUser) return;
    setStBusy(true); setError('');
    try {
      const bucket = stAud === 'close' ? 'close' : 'all';
      const t0 = Date.now();
      const sid = randomId();
      if (media) await set(ref(db, 'stories/' + currentUser.uid + '/' + bucket + 'M/' + sid), { data: media });
      await set(ref(db, 'stories/' + currentUser.uid + '/' + bucket + '/' + sid), { ...data, t: t0, exp: t0 + 24 * 3600 * 1000 });
      setNotice('Story laga di ✨');
      await loadStories();
      setScreen('friends');
    } catch (e) { setError('Story nahi lagi: ' + e.message); }
    setStBusy(false);
  };
  const postPhotoStory = async (du) => { const small = await compressImageTo(du, 1000, 0.72); await postStory({ type: 'img' }, small); };
  const postVideoStory = async (du) => { await postStory({ type: 'vid' }, du); };
  const postCamStory = async (du) => { if (String(du).indexOf('data:video') === 0) await postVideoStory(du); else await postPhotoStory(du); };
  const pickStoryMedia = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*,video/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        if (f.type.indexOf('video/') === 0) {
          setStBusy(true); setNotice('Video chhoti ki ja rahi hai (15 sec tak lag sakte hain)...');
          let blob = f;
          if (f.size > 3 * 1024 * 1024) blob = await videoToSmall(f);
          const du = await readAsDataUrl(blob);
          if (du.length > 4.6 * 1024 * 1024) throw new Error('Video bahut badi hai, 15 sec se chhoti chuno');
          setStBusy(false); setNotice('');
          await postVideoStory(du);
        } else await postPhotoStory(await readAsDataUrl(f));
      } catch (e) { setStBusy(false); setNotice(''); setError('Story nahi lagi: ' + e.message); }
    };
    input.click();
  };
  const postTextStory = async () => {
    const tx = stText.trim();
    if (!tx) { setError('Kuch likho'); return; }
    await postStory({ type: 'text', text: tx, bg: stBg });
    setStText('');
  };
  const toggleClose = async (uid, on) => {
    setCloseSet((p) => { const n = { ...p }; if (on) n[uid] = true; else delete n[uid]; return n; });
    try {
      if (on) await set(ref(db, 'closeFriends/' + currentUser.uid + '/' + uid), true);
      else await remove(ref(db, 'closeFriends/' + currentUser.uid + '/' + uid));
    } catch (e) { setError('Save nahi hua: ' + e.message); }
  };

  // ---- Album ----
  const albumLoad = async () => {
    if (!pal || !palAes) return;
    try {
      const ids = (await call('GET', cidPath('album'), undefined, 'shallow=true')) || {};
      const keys = Object.keys(ids).slice(-12);
      const out = [];
      for (const k of keys) {
        const v = await call('GET', cidPath('album/' + k));
        if (!v) continue;
        const data = await decryptText(palAes, v);
        if (data) out.push({ id: k, from: v.from, t: v.t, data });
      }
      out.sort((a, b) => b.t - a.t);
      setAlbumItems(out);
    } catch (e) { setError('Album load nahi hua: ' + e.message); }
  };
  useEffect(() => { if (screen === 'album' && palAes) albumLoad(); }, [screen, palAes]);
  const albumUpload = async (du) => {
    setAlbumBusy(true); setError('');
    try {
      const small = await compressImageTo(du, 1100, 0.75);
      const enc = await encryptText(palAes, small);
      await push(ref(db, cidPath('album')), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now() });
      await albumLoad();
    } catch (e) { setError('Photo nahi gayi: ' + e.message); }
    setAlbumBusy(false);
  };
  const albumAdd = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { await albumUpload(await readAsDataUrl(f)); } catch (e) { setError('Photo nahi gayi: ' + e.message); }
    };
    input.click();
  };
  const albumDelete = async (id) => { try { await remove(ref(db, cidPath('album/' + id))); await albumLoad(); } catch (e) { setError('Error: ' + e.message); } };

  // ---- Block / Report / Delete account ----
  const reportUser = async (reason) => {
    if (!dmFriend || !currentUser) return;
    try {
      await push(ref(db, 'reports'), { by: currentUser.uid, target: dmFriend.uid, username: dmFriend.username, reason, t: Date.now() });
      setDmMenu(''); setNotice('Report bhej di gayi ✅');
    } catch (e) { setError('Report nahi gayi: ' + e.message); }
  };
  const blockUser = async (f) => {
    if (!f || !currentUser) return;
    try {
      await set(ref(db, 'blocks/' + currentUser.uid + '/' + f.uid), { username: f.username, name: f.name || f.username, t: Date.now() });
      await remove(ref(db, 'friends/' + currentUser.uid + '/' + f.uid)).catch(() => {});
      await remove(ref(db, 'friends/' + f.uid + '/' + currentUser.uid)).catch(() => {});
      setDmMenu(''); leaveDm(); setNotice('@' + f.username + ' block ho gaya 🚫');
    } catch (e) { setError('Block nahi hua: ' + e.message); }
  };
  const unblockUser = async (uid) => { try { await remove(ref(db, 'blocks/' + currentUser.uid + '/' + uid)); } catch (e) { setError('Error: ' + e.message); } };
  const deleteAccount = async () => {
    if (!currentUser) return;
    setError('');
    try {
      const uid = currentUser.uid;
      const tok = await getToken();
      const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + FIREBASE_API_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d.error && d.error.message) || 'delete failed'); }
      for (const k of Object.keys(cloudFriends)) {
        const f = cloudFriends[k];
        await remove(ref(db, 'friends/' + k + '/' + uid)).catch(() => {});
        await remove(ref(db, 'friends/' + uid + '/' + k)).catch(() => {});
        await remove(ref(db, 'couples/' + f.chatId)).catch(() => {});
      }
      const paths = ['friendReqs/' + uid, 'userGroups/' + uid, 'blocks/' + uid, 'profiles/' + uid, 'users/' + uid, 'presence/' + uid];
      if (currentUser.username) paths.push('usernames/' + currentUser.username);
      for (const p of paths) await remove(ref(db, p)).catch(() => {});
      clearAllData(); logout(); setDelConfirm(false); setScreen('home'); setAcctMode(null);
      setNotice('Account delete ho gaya.');
    } catch (e) {
      setError('Account delete nahi hua: ' + e.message + '. Ek baar logout karke dobara login karo, phir try karo.');
    }
  };
  const purgeAccount = async (uid) => {
    let uname = '';
    try { uname = (await call('GET', 'profiles/' + uid + '/username')) || ''; } catch (e) {}
    let friends = {};
    try { friends = (await call('GET', 'friends/' + uid)) || {}; } catch (e) {}
    const tok = await getToken();
    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete?key=' + FIREBASE_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: tok }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d.error && d.error.message) || 'delete failed'); }
    for (const k of Object.keys(friends)) {
      const f = friends[k];
      await remove(ref(db, 'friends/' + k + '/' + uid)).catch(() => {});
      await remove(ref(db, 'friends/' + uid + '/' + k)).catch(() => {});
      if (f && f.chatId) await remove(ref(db, 'couples/' + f.chatId)).catch(() => {});
    }
    const paths = ['friendReqs/' + uid, 'userGroups/' + uid, 'blocks/' + uid, 'profiles/' + uid, 'users/' + uid, 'presence/' + uid];
    if (uname) paths.push('usernames/' + uname);
    for (const p2 of paths) await remove(ref(db, p2)).catch(() => {});
  };
  // ===== GAMES + COUPLE SPACE + SAFETY END =====

  // ===== PART 2 END. Neeche Part 3 paste karo (const Btn se shuru) =====

  const visible = plain.filter((m) => !hidden.includes(m.key));
  const dmVisible = dmPlain.filter((m) => !dmHidden.includes(m.key));
  const grpVisible = grpPlain.filter((m) => !grpHidden.includes(m.key));
  const mbH = { maxHeight: Math.max(280, (typeof window !== 'undefined' ? window.innerHeight : 700) - 330) };
  const nickPanel = () => (nickEdit ? (
    <View style={s.joinRow}>
      <TextInput style={[s.i, { flex: 1, width: 'auto', marginVertical: 0 }]} placeholder="Nickname (sirf tumhe dikhega)" placeholderTextColor={PH} maxLength={24}
        value={nickEdit.text} onChangeText={(v) => setNickEdit({ ...nickEdit, text: v })} onSubmitEditing={() => saveNick(nickEdit.uid, nickEdit.text)} />
      <TouchableOpacity style={[s.roundBtn, { backgroundColor: th.accent }]} onPress={() => saveNick(nickEdit.uid, nickEdit.text)}><Text style={s.roundT}>✓</Text></TouchableOpacity>
    </View>
  ) : null);
  const ringOf = (uid) => {
    const l = stories[uid];
    if (!l) return null;
    const un = l.filter((x) => !seenSt[x.sid]);
    if (!un.length) return '#ffffff55';
    return un.some((x) => x.bucket === 'close') ? '#25d366' : th.accent;
  };
  const storyTray = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 104, width: '100%', marginBottom: 6 }} contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'flex-start' }}>
      <TouchableOpacity style={s.stItem} onPress={() => (stories[myUid] ? openStory(myUid) : goStoryNew())}>
        <View style={[s.stRing, { borderColor: ringOf(myUid) || 'transparent' }]}><Pic uri={myPhoto} emoji={profile.avatar} size={56} name={myLetterName} noTap /></View>
        <TouchableOpacity style={s.stPlus} onPress={goStoryNew}><Text style={s.stPlusT}>＋</Text></TouchableOpacity>
        <Text numberOfLines={1} style={s.stName}>Your story</Text>
      </TouchableOpacity>
      {Object.keys(cloudFriends).filter((u) => stories[u]).map((u) => {
        const f = cloudFriends[u];
        return (
          <TouchableOpacity key={u} style={s.stItem} onPress={() => openStory(u)}>
            <View style={[s.stRing, { borderColor: ringOf(u) || 'transparent' }]}><Pic uri={pics[u]} emoji={f.avatar || '😎'} size={56} name={nameOf(f)} noTap /></View>
            <Text numberOfLines={1} style={s.stName}>{nameOf(f)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // ---- Back button (Android / browser back) ----
  const navStack = useRef([]);
  const suppressPop = useRef(0);
  const innerBackRef = useRef(null);
  innerBackRef.current = () => {
    if (cam) { closeCam(); return true; }
    if (viewer) { setViewer(null); return true; }
    if (sv) { setSv(null); return true; }
    if (screen === 'groups' && grp) { closeGroup(); return true; }
    if (screen === 'stranger' && strState !== 'idle') { strStop(false); return true; }
    return false;
  };
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const st = navStack.current;
    if (!st.length) { st.push({ screen, page }); try { window.history.replaceState({ nx: 1 }, ''); } catch (e) {} return; }
    const top = st[st.length - 1];
    if (top.screen === screen && top.page === page) return;
    const prev = st[st.length - 2];
    if (prev && prev.screen === screen && prev.page === page) {
      st.pop(); suppressPop.current += 1;
      try { window.history.back(); } catch (e) {}
      return;
    }
    st.push({ screen, page });
    try { window.history.pushState({ nx: st.length }, ''); } catch (e) {}
  }, [screen, page]);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onPop = () => {
      if (suppressPop.current > 0) { suppressPop.current -= 1; return; }
      if (innerBackRef.current && innerBackRef.current()) { try { window.history.pushState({ nx: navStack.current.length }, ''); } catch (e) {} return; }
      const st = navStack.current;
      if (st.length > 1) { st.pop(); const prev = st[st.length - 1]; setPage(prev.page); setScreen(prev.screen); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const myId = ident ? ident.sid : null;
  const myUid = currentUser ? currentUser.uid : null;
  const totalUnread = Object.keys(unread).reduce((a, k) => a + (unread[k] || 0), 0);

  let th = themes.p1;
  if (screen === 'home') th = page === 1 ? themes.p1 : page === 2 ? themes.p2 : themes.p3;
  else if (screen === 'join' || screen === 'room') th = themes.room;
  else if (screen === 'chat' || screen === 'dm' || screen === 'groups' || screen === 'stranger') th = themes.chat;
  else if (screen === 'games' || screen === 'ttt' || screen === 'tdhub' || screen === 'wyr' || screen === 'nhie' || screen === 'quiz') th = themes.p2;
  else if (screen === 'couple' || screen === 'daily' || screen === 'mem' || screen === 'album' || screen === 'notes') th = themes.p3;
  else th = themes.settings;
  if (skin && skins[skin]) th = { ...th, ...skins[skin] };

  const Btn = ({ label, onPress, big }) => (
    <TouchableOpacity style={[s.b, { backgroundColor: th.accent, shadowColor: th.accent }, big ? s.bBig : null, th.r != null ? { borderRadius: th.r } : null]}
      onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
      <Text style={[s.bt, big ? s.btBig : null]}>{label}</Text>
    </TouchableOpacity>
  );
  const Nav = ({ label, onPress }) => (
    <TouchableOpacity style={[s.nav, { borderColor: th.accent + '88' }, th.r != null ? { borderRadius: th.r } : null]} onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
      <Text style={[s.navt, { color: th.accent2 }]}>{label}</Text>
    </TouchableOpacity>
  );
  const Mini = ({ label, onPress }) => (
    <TouchableOpacity style={[s.mini, { borderColor: th.accent + '88' }, th.r != null ? { borderRadius: th.r } : null]} onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
      <Text style={[s.miniT, { color: th.accent2 }]}>{label}</Text>
    </TouchableOpacity>
  );
  const dots = (n) => (
    <View style={s.dotRow}>
      {[1, 3].map((i) => <View key={i} style={[s.dot, i === n ? { width: 26, backgroundColor: th.accent } : null]} />)}
    </View>
  );
  const myLetterName = profile.name || (currentUser && (currentUser.email || currentUser.name || currentUser.username)) || '';
  const Pic = ({ uri, emoji, size, name, getHd, noTap }) => {
    if (uri && noTap) return <RNImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
    if (uri) {
      return (
        <TouchableOpacity activeOpacity={0.8} onPress={() => setViewer({ uri, getHd })}>
          <RNImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        </TouchableOpacity>
      );
    }
    if (emoji && emoji !== '😎') return <Text style={{ fontSize: size * 0.8 }}>{emoji}</Text>;
    const ch = letterOf(name);
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: LETTER_COLORS[ch.charCodeAt(0) % LETTER_COLORS.length], alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: size * 0.46, fontWeight: '700' }}>{ch}</Text>
      </View>
    );
  };
  const chatRow = ({ rowKey, uri, emoji, title, sub, time, badge, onPress, onMore, online, getHd }) => (
    <TouchableOpacity key={rowKey} activeOpacity={0.6} style={s.chatRow} onPress={onPress} onLongPress={onMore}>
      <View>
        <View style={s.avWrap}><Pic uri={uri} emoji={emoji} size={52} name={title} getHd={getHd} /></View>
        {!!online && <View style={s.onDot} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={s.rowTitle}>{title}</Text>
          {!!time && <Text style={[s.rowTime, badge ? { color: '#25d366' } : null]}>{time}</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text numberOfLines={1} style={s.rowSub}>{sub}</Text>
          {!!badge && <View style={[s.badge, { marginLeft: 8 }]}><Text style={s.badgeT}>{badge >= 20 ? '20+' : badge}</Text></View>}
        </View>
      </View>
      {!!onMore && <TouchableOpacity onPress={onMore} style={{ paddingHorizontal: 8, paddingVertical: 6 }}><Text style={[s.rowTime, { fontSize: 20 }]}>⋮</Text></TouchableOpacity>}
    </TouchableOpacity>
  );
  const isImg = (f) => f && f.type && f.type.indexOf('image/') === 0;
  const isAud = (f) => f && f.type && f.type.indexOf('audio/') === 0;

  const renderRoom = () => {
    if (!room) return <Text style={s.bt}>Loading...</Text>;
    const me = role;
    if (room.stage === 'lobby') {
      return (<>
        <Text style={s.bt}>{t('roomCode')}</Text>
        <Text style={[s.code, { color: th.accent2 }]}>{roomCode}</Text>
        <Text style={s.sm}>{t('waitingPartner')}</Text>
        <Nav label={t('back')} onPress={leave} />
      </>);
    }
    if (room.stage === 'flip') {
      const rot = bottleRot.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });
      const lblTop = 'P2' + (me === 'P2' ? ' (You)' : '');
      const lblBot = 'P1' + (me === 'P1' ? ' (You)' : '');
      return (<>
        <Text style={s.sm}>{t('youAre')} {me}</Text>
        <Text style={s.sm}>Bottle jiski taraf ruke, wo pehla sawal puchhega 🍾</Text>
        <View style={s.bottleWrap}>
          <Text style={[s.bottleLbl, { top: 4, color: th.accent2 }]}>{lblTop}</Text>
          <Animated.View style={{ width: 60, height: 200, alignItems: 'center', transform: [{ rotate: rot }] }}>
            <View style={{ width: 18, height: 78, backgroundColor: th.accent, borderTopLeftRadius: 6, borderTopRightRadius: 6 }} />
            <View style={{ width: 46, height: 122, backgroundColor: th.accent, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, opacity: 0.85 }} />
          </Animated.View>
          <Text style={[s.bottleLbl, { bottom: 4, color: th.accent2 }]}>{lblBot}</Text>
        </View>
        {!room.spin && me === 'P1' && <Btn label="🍾 Bottle ghumao" onPress={spinBottle} />}
        {!room.spin && me === 'P2' && <Text style={s.bt}>P1 bottle ghumane wala hai...</Text>}
        {!!room.spin && !spinDone && <Text style={s.sm}>Bottle ghoom rahi hai...</Text>}
        {!!room.spin && spinDone && (<>
          <Text style={s.bt}>{room.asker} {t('firstAsk')}</Text>
          {me === 'P1' && <Btn label={t('startBattle')} onPress={startBattle} />}
          {me === 'P2' && <Text style={s.sm}>P1 will start the battle...</Text>}
        </>)}
      </>);
    }
    if (room.stage === 'game') {
      const answerer = room.asker === 'P1' ? 'P2' : 'P1';
      const iAsk = me === room.asker;
      return (
        <ScrollView style={s.gameScroll} contentContainerStyle={s.gameInner}>
          <Text style={s.sm}>{t('youAre')} {me} • {rshared ? t('encrypted') : subtle ? t('encryptionPending') : t('needBrowser')}</Text>
          <Text style={s.bt}>P1: {room.scores.P1} | P2: {room.scores.P2}</Text>
          <Text style={s.sm}>{room.asker} {t('asker')}, {answerer} {t('answerer')}</Text>
          {!room.question && (iAsk ? (customMode ? (<>
            <TextInput style={s.i2} placeholder="Write your question or dare" placeholderTextColor="#ffffff88" value={customText} onChangeText={setCustomText} multiline />
            <Btn label={t('send')} onPress={sendCustom} />
            <Nav label={t('cancel')} onPress={() => setCustomMode(false)} />
          </>) : (<>
            <Btn label={t('truth')} onPress={() => ask('Truth')} />
            <Btn label={t('dare')} onPress={() => ask('Dare')} />
            <Btn label={t('customQ')} onPress={() => setCustomMode(true)} />
          </>)) : <Text style={s.sm}>{room.asker} {t('waitingQ')}</Text>)}
          {room.question && (<>
            <Text style={[s.q, { color: th.accent2 }]}>{room.question.kind}: {room.question.text}</Text>
            {replyPlain && (
              <View style={s.replyBox}>
                <Text style={s.bname}>{replyPlain.from === me ? t('yourAnswer') : t('partnerAnswer')}</Text>
                {!!replyPlain.text && <Text style={s.btext}>{replyPlain.text}</Text>}
                {!!replyPic && <RNImage source={{ uri: replyPic }} style={s.pic} resizeMode="contain" />}
                {replyPlain.hasImg && !replyPic && <Text style={s.sm}>Pic loading...</Text>}
              </View>
            )}
            {!iAsk && !replyPlain && (subtle ? (<>
              <TextInput style={s.i2} placeholder={t('writeAnswer')} placeholderTextColor="#ffffff88" value={replyText} onChangeText={setReplyText} multiline />
              {!!replyImg && <RNImage source={{ uri: replyImg }} style={s.picSmall} resizeMode="cover" />}
              <Nav label={replyImg ? t('changePic') : t('pickPic')} onPress={pickImage} />
              <Btn label={t('sendAnswer')} onPress={sendReply} />
            </>) : <Text style={s.sm}>{t('needBrowser')}</Text>)}
            {iAsk ? (<>
              {!replyPlain && <Text style={s.sm}>{t('waitAnswer')}</Text>}
              <Btn label={t('donePlus')} onPress={() => judge(1)} />
              <Btn label={t('failedMinus')} onPress={() => judge(-1)} />
            </>) : <Text style={s.sm}>Answer or perform! {room.asker} will decide.</Text>}
          </>)}
          <Nav label={t('endGame')} onPress={endGame} />
        </ScrollView>
      );
    }
    return (<>
      <Text style={s.t}>{t('gameOver')}</Text>
      <Text style={s.bt}>P1: {room.scores.P1} | P2: {room.scores.P2}</Text>
      <Text style={[s.q, { color: th.accent2 }]}>{room.scores.P1 > room.scores.P2 ? 'P1 ' + t('won') : room.scores.P2 > room.scores.P1 ? 'P2 ' + t('won') : t('draw')}</Text>
      <Btn label={t('newGame')} onPress={leave} />
    </>);
  };

  const titles = { chat: 'Private Chat 💬', profile: t('profile'), friends: t('friends'), groups: 'Group Chat 👥', games: 'NexGames 🎮', tdhub: 'Truth or Dare Battle 🔥', style: 'Theme & Wallpaper 🎨', settings: t('settings') };
  const title = screen === 'home' ? (page === 1 ? null : page === 2 ? 'NexGames 🎮' : 'Make it special') : titles[screen] || (screen === 'join' ? 'Join' : null);
  const inChat = screen === 'chat' && !!chatCode;
  const inDm = screen === 'dm';
  const inGame = screen === 'room' && !!room && room.stage === 'game';
  const needUsername = isLoggedIn && !!currentUser && !currentUser.username;
  const friendSeen = dmFriend ? (dmSeen[dmFriend.uid] || 0) : 0;
  const partnerName = chatData && chatData.names && ident ? (Object.keys(chatData.names).filter((k) => k !== ident.sid).map((k) => chatData.names[k])[0] || t('partner')) : t('partner');
  const full = inChat || inDm || inGame || ['profile', 'friends', 'groups', 'style', 'settings', 'acct', 'storynew', 'closefr', 'stranger', 'couple', 'daily', 'mem', 'album', 'notes', 'wyr', 'nhie', 'quiz'].includes(screen);
  const sc = { alignItems: 'center', paddingBottom: 40, width: '100%' };
  const PH = '#ffffff88';

  const myUidX = currentUser ? currentUser.uid : '';
  const dateInput = (value, onChange) => (Platform.OS === 'web'
    ? React.createElement('input', { type: 'date', value, onChange: (e) => onChange(e.target.value), style: { width: '80%', padding: 12, borderRadius: 14, border: '1px solid #ffffff44', background: '#ffffff18', color: '#fff', fontSize: 16, colorScheme: 'dark', margin: '6px 0' } })
    : <TextInput style={s.i} placeholder="YYYY-MM-DD" placeholderTextColor={PH} value={value} onChangeText={onChange} />);

  const renderTtt = () => {
    const grid = (board, line, canTap, onTap) => (
      <View style={s.tttGrid}>
        {[0, 1, 2].map((r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {[0, 1, 2].map((c) => {
              const i = r * 3 + c;
              const win = line.indexOf(i) >= 0;
              return (
                <TouchableOpacity key={i} activeOpacity={0.7} disabled={!canTap || board[i] !== '-'} onPress={() => onTap(i)}
                  style={[s.tttCell, win ? { backgroundColor: th.accent + '77', borderColor: th.accent } : null]}>
                  <Text style={[s.tttMark, { color: board[i] === 'X' ? th.accent2 : '#ffd166' }]}>{board[i] === '-' ? '' : board[i]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
    const modeRow = (
      <View style={s.miniRow}>
        <Mini label={(tttMode === 'pal' ? '✅ ' : '') + '👫 Dost ke saath'} onPress={() => setTttMode('pal')} />
        <Mini label={(tttMode === 'cpu' ? '✅ ' : '') + '🤖 Computer se'} onPress={() => setTttMode('cpu')} />
      </View>
    );
    if (tttMode === 'cpu') {
      const g = tttCpu;
      const msg = g.status === 'win' ? (g.winner === 'X' ? '🎉 Tum jeet gaye!' : '🤖 Computer jeet gaya!') : g.status === 'draw' ? '🤝 Draw!' : g.turn === 'X' ? 'Teri baari ✨ (X)' : 'Computer soch raha hai... (O)';
      return (<>
        {modeRow}
        <View style={s.miniRow}>
          <Mini label={(tttLevel === 'easy' ? '✅ ' : '') + 'Easy'} onPress={() => setTttLevel('easy')} />
          <Mini label={(tttLevel === 'hard' ? '✅ ' : '') + 'Hard 🔥'} onPress={() => setTttLevel('hard')} />
        </View>
        <Text style={s.bt}>{msg}</Text>
        {grid(g.board, g.line, g.status === 'play' && g.turn === 'X', tttCpuTap)}
        <Text style={s.sm}>Score - Tum: {g.scores.you} • Computer: {g.scores.cpu} • Draw: {g.scores.draw}</Text>
        <Btn label="🔄 Nayi game" onPress={tttCpuNew} />
        <Mini label="Score reset" onPress={() => setTttCpu({ ...TTT_FRESH, scores: { you: 0, cpu: 0, draw: 0 } })} />
      </>);
    }
    return (<>
      {modeRow}
      {pairGate((() => {
        const d = tttDoc;
        if (!d) return (<><Text style={s.sm}>Abhi koi game nahi chal rahi.</Text><Btn label="🎮 Game shuru karo" onPress={tttNewRound} /></>);
        const meX = d.xUid === currentUser.uid;
        const line = d.line ? String(d.line).split('').map(Number) : [];
        const myTurn = d.status === 'play' && d.turn === currentUser.uid;
        const sc = d.scores || {};
        const msg = d.status === 'win' ? (d.winner === currentUser.uid ? '🎉 Tum jeet gaye!' : '😅 ' + palName + ' jeet gaya') : d.status === 'draw' ? '🤝 Draw!' : myTurn ? 'Teri baari ✨' : palName + ' ki baari...';
        return (<>
          <Text style={s.sm}>Tum {meX ? 'X' : 'O'} • {palName} {meX ? 'O' : 'X'} • X pehle chalta hai</Text>
          <Text style={s.bt}>{msg}</Text>
          {grid(d.board, line, myTurn, tttMove)}
          <Text style={s.sm}>Score - Tum: {sc[currentUser.uid] || 0} • {palName}: {sc[pal.uid] || 0} • Draw: {sc.draw || 0}</Text>
          {d.status !== 'play' && <Btn label="🔄 Rematch" onPress={tttNewRound} />}
          <Mini label="Score reset" onPress={tttResetScore} />
        </>);
      })())}
    </>);
  };
  const setItem = ({ key, icon, title, sub, right, onPress, danger, last }) => (
    <TouchableOpacity key={key || title} activeOpacity={onPress ? 0.6 : 1} onPress={onPress}
      style={[s.setItem, last ? { borderBottomWidth: 0 } : null]}>
      <View style={[s.setIcon, { backgroundColor: (danger ? '#ff4d4d' : th.accent) + '33' }]}><Text style={{ fontSize: 18 }}>{icon}</Text></View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[s.setTitle, danger ? { color: '#ff7b7b' } : null]}>{title}</Text>
        {!!sub && <Text style={s.setSub}>{sub}</Text>}
      </View>
      {right !== undefined ? right : (onPress ? <Text style={s.setArrow}>›</Text> : null)}
    </TouchableOpacity>
  );
  const setGroup = (title, items) => (
    <View style={{ width: '100%', marginTop: 16 }}>
      <Text style={[s.setHead, { color: th.accent2 }]}>{title}</Text>
      <View style={s.setCard}>{items.map((it, i) => setItem({ ...it, last: i === items.length - 1 }))}</View>
    </View>
  );
  const pairGate = (content) => {
    if (!subtle) return <Text style={s.sm}>{t('needBrowserChat')}</Text>;
    if (!pal || palPicking) {
      const fl = Object.keys(cloudFriends).map((k) => cloudFriends[k]);
      return (<>
        <Text style={s.sm}>Kiske saath khelna hai? Apne 💌 Message wale dost me se chuno</Text>
        {fl.length === 0 && <Text style={s.sm}>Abhi koi friend nahi hai. Pehle Message me friend add karo.</Text>}
        <View style={{ width: '100%' }}>
          {fl.map((f) => chatRow({ rowKey: f.uid, uri: pics[f.uid], emoji: f.avatar || '😎', title: nameOf(f), sub: '@' + f.username, getHd: hdOf(f.uid), onPress: () => choosePal(f) }))}
        </View>
        {palPicking && !!pal && <Mini label={t('cancel')} onPress={() => setPalPicking(false)} />}
      </>);
    }
    return (<>
      <View style={s.miniRow}>
        <Text style={[s.sm, { marginRight: 10, alignSelf: 'center' }]}>Saath: {avLbl(pal.avatar) + palName}</Text>
        <Mini label="Badlo" onPress={() => setPalPicking(true)} />
      </View>
      {!palAes ? <Text style={s.sm}>⏳ Encryption key ban rahi hai... {palName} ko ek baar app kholne ko bolo.</Text> : content}
    </>);
  };

  const renderPq = (kind) => {
    const list = kind === 'wyr' ? WYR : NHIE;
    const cur = pqCur(kind);
    if (!cur) {
      return (<>
        <Text style={s.sm}>{kind === 'wyr' ? 'Dono ek hi sawal par apna jawab chunte hain. Dono ke chunne ke baad hi jawab dikhte hain.' : 'Ek baat padho. Dono chunte hain ki kiya hai ya nahi. Dono ke baad hi dikhta hai.'}</Text>
        <Btn label="Shuru karo 🎲" onPress={() => pqNext(kind)} />
      </>);
    }
    const opts = kind === 'wyr' ? list[cur.qi] : ['Haan, kiya hai 🙈', 'Kabhi nahi 😇'];
    const picks = cur.picks || {};
    const mine = picks[myUidX];
    const theirs = picks[pal.uid];
    const both = mine !== undefined && theirs !== undefined;
    return (<>
      <Text style={s.sm}>Sawal #{cur.n || 1}</Text>
      {kind === 'wyr' ? <Text style={[s.q, { color: th.accent2 }]}>Kya pasand karoge?</Text> : <Text style={[s.q, { color: th.accent2 }]}>{list[cur.qi]}</Text>}
      {opts.map((o, i) => <Btn key={i} label={(mine === i ? '✅ ' : '') + o} onPress={() => { if (mine === undefined) pqPick(kind, i); }} />)}
      {both ? (<>
        <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={s.cardS}>Tum: {opts[mine]}</Text>
          <Text style={s.cardS}>{palName}: {opts[theirs]}</Text>
          <Text style={[s.cardT, { color: th.accent2, marginTop: 8 }]}>{mine === theirs ? 'Match! 💞 Dono ka jawab ek hi' : 'Alag alag 😄'}</Text>
        </View>
        <Btn label="Agla sawal ➡️" onPress={() => pqNext(kind)} />
      </>) : mine !== undefined ? <Text style={s.sm}>⏳ {palName} ke jawab ka intezaar...</Text> : <Text style={s.sm}>Apna jawab chuno 👆</Text>}
    </>);
  };

  const renderQuiz = () => {
    const me = myUidX;
    const other = pal.uid;
    const scs = (quiz && quiz.scores) || {};
    const scoreLine = <Text style={s.bt}>Tum: {scs[me] || 0}  |  {palName}: {scs[other] || 0}</Text>;
    if (!quiz) {
      return (<>
        <Text style={s.sm}>Ek partner apne baare me sawal chunta hai aur jawab chhupa leta hai. Doosra guess karta hai. Sahi guess par +1 💘</Text>
        <Btn label="Shuru karo 💘" onPress={() => quizStart(me)} />
      </>);
    }
    const iAsk = quiz.asker === me;
    let body = null;
    if (quiz.stage === 'pick') {
      body = iAsk ? (<>
        <Text style={s.sm}>Apne baare me sawal chuno (badal bhi sakte ho) aur sachcha jawab likho. Partner ko jawab nahi dikhega.</Text>
        <TextInput style={s.i2} multiline placeholder="Sawal" placeholderTextColor={PH} value={quizQ} onChangeText={setQuizQ} />
        <Mini label="🎲 Doosra sawal" onPress={pickQuizQ} />
        <TextInput style={s.i} placeholder="Tumhara jawab" placeholderTextColor={PH} value={quizIn} onChangeText={setQuizIn} />
        <Btn label="Bhejo 🚀" onPress={quizSend} />
      </>) : <Text style={s.sm}>⏳ {palName} sawal chun raha hai...</Text>;
    } else if (quiz.stage === 'guess') {
      body = (<>
        <Text style={[s.q, { color: th.accent2 }]}>{quiz.q}</Text>
        {iAsk ? <Text style={s.sm}>⏳ {palName} guess kar raha hai...</Text> : (<>
          <Text style={s.sm}>{palName} ke baare me guess karo:</Text>
          <TextInput style={s.i} placeholder="Tumhara guess" placeholderTextColor={PH} value={quizIn} onChangeText={setQuizIn} />
          <Btn label="Guess bhejo 🎯" onPress={quizGuess} />
        </>)}
      </>);
    } else if (quiz.stage === 'judge') {
      body = (<>
        <Text style={[s.q, { color: th.accent2 }]}>{quiz.q}</Text>
        <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          {iAsk && <Text style={s.cardS}>Tumhara jawab: {quizPlain.a || '...'}</Text>}
          <Text style={s.cardS}>{iAsk ? palName + ' ka guess' : 'Tumhara guess'}: {quizPlain.g || '...'}</Text>
        </View>
        {iAsk ? (<>
          <Btn label="Sahi ✅ (+1)" onPress={() => quizJudge(true)} />
          <Btn label="Galat ❌" onPress={() => quizJudge(false)} />
        </>) : <Text style={s.sm}>⏳ {palName} check kar raha hai...</Text>}
      </>);
    } else {
      body = (<>
        <Text style={[s.q, { color: th.accent2 }]}>{quiz.q}</Text>
        <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={s.cardS}>Asli jawab: {quizPlain.a || '...'}</Text>
          <Text style={s.cardS}>Guess: {quizPlain.g || '...'}</Text>
          <Text style={[s.cardT, { color: th.accent2, marginTop: 8 }]}>{quiz.correct ? 'Sahi guess! ✅ +1' : 'Galat guess ❌'}</Text>
        </View>
        <Btn label="Agla round ➡️" onPress={() => quizStart(iAsk ? other : me)} />
      </>);
    }
    return (<>{scoreLine}{body}<Mini label="🔄 Naya game (score zero)" onPress={quizReset} /></>);
  };

  const renderDaily = () => {
    const qi = Math.floor(new Date(dayKey() + 'T00:00:00').getTime() / 86400000) % DAILY.length;
    const doc = dailyDoc || {};
    const mineAns = doc[myUidX];
    const theirAns = doc[pal.uid];
    const both = !!mineAns && !!theirAns;
    const streak = streakBase + (both ? 1 : 0);
    return (<>
      <Text style={[s.q, { color: th.accent2 }]}>🔥 {streak} din ka streak</Text>
      <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
        <Text style={s.cardS}>Aaj ka sawal</Text>
        <Text style={[s.cardT, { color: th.accent2, marginTop: 6 }]}>{DAILY[qi]}</Text>
      </View>
      {!mineAns ? (<>
        <TextInput style={s.i2} multiline placeholder="Tumhara jawab" placeholderTextColor={PH} value={dailyIn} onChangeText={setDailyIn} />
        <Btn label="Jawab bhejo 💌" onPress={dailySend} />
      </>) : !both ? <Text style={s.sm}>✅ Tumne jawab de diya. ⏳ {palName} ke jawab ke baad dono dikhenge.</Text> : (<>
        <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={s.cardS}>Tumhara jawab</Text>
          <Text style={s.btext}>{dailyPlain[myUidX] || '...'}</Text>
        </View>
        <View style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={s.cardS}>{palName} ka jawab</Text>
          <Text style={s.btext}>{dailyPlain[pal.uid] || '...'}</Text>
        </View>
      </>)}
      <Text style={s.sm}>Streak tab badhta hai jab dono roz jawab dete ho.</Text>
    </>);
  };

  const renderMem = () => {
    const md = memDoc || {};
    const today = dayKey();
    const start = md.start;
    let together = null; let annLeft = null;
    if (start) {
      together = daysBetween(start, today);
      const parts = start.split('-').map(Number);
      const pad = (n) => String(n).padStart(2, '0');
      const y = new Date().getFullYear();
      let cand = y + '-' + pad(parts[1]) + '-' + pad(parts[2]);
      if (cand < today) cand = (y + 1) + '-' + pad(parts[1]) + '-' + pad(parts[2]);
      annLeft = daysBetween(today, cand);
    }
    const lab = (d) => { const n = daysBetween(today, d); return n === 0 ? 'Aaj 🎉' : n > 0 ? n + ' din baaki' : Math.abs(n) + ' din pehle'; };
    return (<>
      {start && !memEditing ? (<>
        <Text style={[s.q, { color: th.accent2 }]}>💞 {together} din saath</Text>
        <Text style={s.sm}>{annLeft === 0 ? '🎉 Aaj anniversary hai!' : '🎉 Anniversary me ' + annLeft + ' din baaki'}</Text>
        <Mini label="Date badlo" onPress={() => { setMemStart(start); setMemEditing(true); }} />
      </>) : (<>
        <Text style={s.sm}>Rishta kab shuru hua? (ya koi khaas din)</Text>
        {dateInput(memStart, setMemStart)}
        <Btn label={t('save')} onPress={memSaveStart} />
      </>)}
      <Text style={[s.q, { color: th.accent2 }]}>Khaas din</Text>
      {memPlain.length === 0 && <Text style={s.sm}>Abhi koi khaas din nahi. Neeche jodo (jaise pehli date, trip, birthday).</Text>}
      {memPlain.map((e) => (
        <View key={e.id} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={[s.cardT, { color: th.accent2 }]}>{e.title}</Text>
          <Text style={s.cardS}>{e.date}  •  {lab(e.date)}</Text>
          <View style={s.miniRow}><Mini label="✕ Hatao" onPress={() => memDelEvent(e.id)} /></View>
        </View>
      ))}
      <TextInput style={s.i} placeholder="Din ka naam" placeholderTextColor={PH} value={evTitle} onChangeText={setEvTitle} />
      {dateInput(evDate, setEvDate)}
      <Btn label="➕ Jodo" onPress={memAddEvent} />
    </>);
  };

  const noteWhenOpts = [['now', 'Abhi'], ['1h', '1 ghante baad'], ['pm9', 'Aaj raat 9 baje'], ['am8', 'Kal subah 8 baje']];
  const renderNotes = () => (<>
    <Text style={s.sm}>Ek love note likho. Partner use tabhi khol payega jab tum chaho 💌</Text>
    <TextInput style={s.i2} multiline placeholder="Tumhara note" placeholderTextColor={PH} value={noteText} onChangeText={setNoteText} />
    <Text style={s.sm}>Kab khule?</Text>
    <View style={s.miniRow}>
      {noteWhenOpts.map((o) => <Mini key={o[0]} label={(noteWhen === o[0] ? '✅ ' : '') + o[1]} onPress={() => setNoteWhen(o[0])} />)}
    </View>
    <Btn label="Note bhejo 💌" onPress={noteSend} />
    <Text style={[s.q, { color: th.accent2 }]}>Notes</Text>
    {notesPlain.length === 0 && <Text style={s.sm}>Abhi koi note nahi.</Text>}
    {notesPlain.map((n) => {
      const mine = n.from === myUidX;
      const locked = !mine && n.unlock > Date.now();
      return (
        <View key={n.key} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
          <Text style={s.cardS}>{mine ? 'Tumne ' + palName + ' ko bheja' : palName + ' ne bheja'}</Text>
          {locked ? <Text style={[s.cardT, { color: th.accent2 }]}>🔒 Khulega: {new Date(n.unlock).toLocaleString()}</Text> : <Text style={s.btext}>{n.text}</Text>}
          {mine && n.unlock > Date.now() && <Text style={s.cardS}>Unke liye khulega: {new Date(n.unlock).toLocaleString()}</Text>}
        </View>
      );
    })}
  </>);

  const renderAlbum = () => (<>
    <Btn label={albumBusy ? 'Ruko...' : '📷 Camera se kheencho'} onPress={() => openCamera(albumUpload)} />
    <Btn label="🖼️ Gallery se jodo" onPress={albumAdd} />
    <Mini label="🔄 Refresh" onPress={albumLoad} />
    {albumItems.length === 0 && <Text style={s.sm}>Abhi koi photo nahi. Pehli photo tum jodo 💞</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
      {albumItems.map((p) => (
        <View key={p.id} style={{ margin: 6, alignItems: 'center' }}>
          <RNImage source={{ uri: p.data }} style={{ width: 150, height: 150, borderRadius: 12 }} resizeMode="cover" />
          {p.from === myUidX && <Mini label="🗑️" onPress={() => albumDelete(p.id)} />}
        </View>
      ))}
    </View>
  </>);

  return (
    <View style={[s.c, { backgroundColor: th.bg }, full ? s.cTop : null]}>
      {!!bgPhoto && <RNImage pointerEvents="none" source={{ uri: bgPhoto }} style={s.bgImg} resizeMode="cover" />}
      {!bgPhoto && !!skin && !!skins[skin] && !!skins[skin].wall && (<>
        <RNImage pointerEvents="none" source={{ uri: wallUri(skins[skin].wall) }} style={s.wallImg} resizeMode="cover" />
        <View pointerEvents="none" style={[s.wallImg, { backgroundColor: th.bg + ({ soft: '99', normal: '59', vivid: '26' }[wallDim] || '59') }]} />
      </>)}
      <View pointerEvents="none" style={[s.glow, { top: -90, right: -70, backgroundColor: th.glow }]} />
      <View pointerEvents="none" style={[s.glow2, { bottom: -110, left: -80, backgroundColor: th.glow2 }]} />
      {!full && (
        <View pointerEvents="none" style={s.floatWrap}>
          <Text style={[s.floaty, { top: 70, left: 22, fontSize: 30 }]}>{th.e ? th.e[0] : '💖'}</Text>
          <Text style={[s.floaty, { top: 150, right: 24, fontSize: 24 }]}>{th.e ? th.e[1] : '🌹'}</Text>
          <Text style={[s.floaty, { bottom: 80, right: 28, fontSize: 34 }]}>{th.e ? th.e[2] : '✨'}</Text>
        </View>
      )}

      {!isLoggedIn ? (
        <View style={s.authBox}>
          <Text style={[s.welcome, { color: th.accent2 }]}>Nexdare</Text>
          {authStep === 'verify' ? (<>
            <Text style={[s.q, { color: th.accent2 }]}>📧 Email verify karo</Text>
            <Text style={s.sm}>Humne {pendingEmail} pe link bheji hai. Mail kholo (Spam bhi dekho), link pe tap karo, phir neeche button dabao.</Text>
            <Btn label={authLoading ? 'Check ho raha...' : 'Maine verify kar liya ✅'} onPress={checkVerified} />
            <Nav label="📩 Mail dobara bhejo" onPress={resendVerify} />
            <Nav label="← Wapas" onPress={backToForm} />
          </>) : (<>
            {Platform.OS === 'web' && <Btn label={authLoading ? 'Ruko...' : '🔵 Google se Login'} onPress={googleLogin} />}
            <TextInput style={s.i} placeholder="Email" placeholderTextColor={PH} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
            <TextInput style={s.i} placeholder="Password" placeholderTextColor={PH} secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} />
            <Btn label={authLoading ? 'Ruko...' : authMode === 'login' ? 'Login' : 'Account banao'} onPress={submitAuth} />
            <Nav label={authMode === 'login' ? 'Naya account banao' : 'Pehle se account hai? Login'} onPress={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setError(''); }} />
            {authMode === 'login' && <Nav label="Password bhool gaye?" onPress={forgotPassword} />}
          </>)}
          {!!error && <Text style={[s.sm, { color: '#ff6b6b' }]}>{error}</Text>}
          {!!notice && <Text style={[s.sm, { color: th.accent2 }]}>{notice}</Text>}
        </View>
      ) : needUsername ? (
        <View style={s.authBox}>
          <Text style={[s.welcome, { color: th.accent2 }]}>Nexdare</Text>
          <Text style={[s.q, { color: th.accent2 }]}>Username chuno</Text>
          <TextInput style={s.i} placeholder="Username" placeholderTextColor={PH} autoCapitalize="none" value={usernameInput} onChangeText={setUsernameInput} />
          <Btn label={authLoading ? 'Ruko...' : t('save')} onPress={claimUsername} />
          <Nav label={t('logout')} onPress={logout} />
          {!!error && <Text style={[s.sm, { color: '#ff6b6b' }]}>{error}</Text>}
        </View>
      ) : (<>
        {!!title && !full && <Text style={screen === 'home' || screen === 'games' ? s.tStyled : s.t}>{title}</Text>}

        {screen === 'home' && page === 1 && (<>
          <Text style={[s.welcome, { color: th.accent2 }]}>{t('welcome')}</Text>
          <View style={[s.rule, { backgroundColor: th.accent }]} />
          <Text style={[s.logo, { color: th.accent2, textShadowColor: th.accent }]}>Nexdare</Text>
          <Btn big label={t('start')} onPress={() => setPage(3)} />
          {dots(1)}
        </>)}

        {screen === 'games' && (<>
          <Btn label="🔥 Truth or Dare Battle" onPress={() => { setError(''); setNotice(''); setScreen('tdhub'); }} />
          <Btn label="🤔 Would You Rather" onPress={() => goScreen('wyr')} />
          <Btn label="🙈 Never Have I Ever" onPress={() => goScreen('nhie')} />
          <Btn label="💘 Love Quiz" onPress={() => goScreen('quiz')} />
          <Btn label="⭕ Tic Tac Toe" onPress={() => goScreen('ttt')} />
          <Nav label={t('back')} onPress={backToTools} />
        </>)}

        {screen === 'tdhub' && (<>
          <Text style={s.sm}>Dono players ko ek room code se jodo. Bottle ghumake shuru hota hai.</Text>
          <View style={s.sideRow}>
            <TouchableOpacity style={[s.b, s.bHalf, { backgroundColor: th.accent, shadowColor: th.accent }]} onPress={() => { playSound('click', soundOn); createRoom(); }}>
              <Text style={[s.bt, { textAlign: 'center' }]}>{t('createRoom')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.b, s.bHalf, { backgroundColor: th.accent, shadowColor: th.accent }]} onPress={() => { playSound('click', soundOn); setError(''); setScreen('join'); }}>
              <Text style={[s.bt, { textAlign: 'center' }]}>{t('joinRoom')}</Text>
            </TouchableOpacity>
          </View>
          <Nav label={t('back')} onPress={backToGames} />
        </>)}

        {screen === 'home' && page === 3 && (<>
          <Btn label="🎮 NexGames" onPress={() => { setError(''); setNotice(''); setScreen('games'); }} />
          <Btn label={t('chat')} onPress={() => { setError(''); setNotice(''); setScreen('groups'); }} />
          <Btn label="🌍 Stranger Chat" onPress={() => { setError(''); setNotice(''); setScreen('stranger'); }} />
          <Btn label={t('friends') + (totalUnread ? '  🔴 ' + (totalUnread >= 20 ? '20+' : totalUnread) : '')} onPress={() => { setError(''); setNotice(''); setScreen('friends'); }} />
          <Btn label="💞 Couple Space" onPress={() => goScreen('couple')} />
          <Btn label={t('profile')} onPress={() => setScreen('profile')} />
          <Btn label={t('settings')} onPress={() => setScreen('settings')} />
          <Nav label={t('back')} onPress={() => setPage(1)} />
          {dots(3)}
        </>)}

        {screen === 'join' && (<>
          <TextInput style={s.i} placeholder="Room code" placeholderTextColor={PH} keyboardType="number-pad" value={joinCode} onChangeText={setJoinCode} />
          <Btn label={t('join')} onPress={joinRoom} />
          <Nav label={t('back')} onPress={leave} />
        </>)}

        {screen === 'room' && renderRoom()}

        {screen === 'chat' && !chatCode && (subtle ? (<>
          <Btn label={t('newChat')} onPress={createChat} />
          <TextInput style={s.i} placeholder={t('chatCode')} placeholderTextColor={PH} autoCapitalize="none" value={chatJoin} onChangeText={setChatJoin} />
          <Btn label={t('joinChat')} onPress={joinChat} />
          <Nav label={t('back')} onPress={backToTools} />
        </>) : (<>
          <Text style={s.sm}>{t('needBrowserChat')}</Text>
          <Nav label={t('back')} onPress={backToTools} />
        </>))}

        {inChat && (chatFull ? (<>
          <Text style={s.sm}>{t('chatFull')}</Text>
          <Nav label={t('back')} onPress={leaveChat} />
        </>) : chatData && chatData.gone ? (<>
          <Text style={s.sm}>{t('chatDeleted')}</Text>
          <Nav label={t('back')} onPress={leaveChat} />
        </>) : (<>
          <Text style={[s.code2, { color: th.accent2 }]}>{shared ? '💞 ' + partnerName : chatCode}</Text>
          <Text style={s.sm}>{shared ? t('e2e') + shared.safety : t('waitPartner') + ': ' + chatCode}</Text>
          <View style={s.miniRow}>
            <Mini label={t('saveChat')} onPress={saveChat} />
            <Mini label={confirmDel ? t('confirmDelete') : t('deleteChat')} onPress={deleteChat} />
          </View>
          <ScrollView ref={scrollRef} style={s.msgBox} onContentSizeChange={() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true })}>
            {visible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
            {visible.map((m) => {
              const mine = myId && m.sid === myId;
              const sel = selMsg && selMsg.key === m.key;
              return (
                <TouchableOpacity key={m.key} onPress={() => setSelMsg(sel ? null : m)}
                  style={[s.bubble, mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs, sel ? s.selBubble : null]}>
                  <Text style={s.bname}>{mine ? t('you') : partnerName}</Text>
                  <Text style={s.btext}>{m.text}</Text>
                  {m.edited && <Text style={s.tick}>edited</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {!!selMsg && (
            <View style={s.miniRow}>
              {selMsg.sid === myId && <Mini label="✏️ Edit" onPress={() => { setMsgText(selMsg.text); setSelMsg({ ...selMsg, editMode: true }); }} />}
              <Mini label={t('deleteForMe')} onPress={deleteForMe} />
              {selMsg.sid === myId && <Mini label={t('deleteForAll')} onPress={deleteForAll} />}
              <Mini label={t('cancel')} onPress={() => { setSelMsg(null); setMsgText(''); }} />
            </View>
          )}
          <View style={s.sendRow}>
            <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')} placeholderTextColor={PH} value={msgText} onChangeText={setMsgText} onSubmitEditing={() => (selMsg && selMsg.editMode ? editMsg() : sendMsg())} />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={() => (selMsg && selMsg.editMode ? editMsg() : sendMsg())}>
              <Text style={s.bt}>{selMsg && selMsg.editMode ? '✓' : '➤'}</Text>
            </TouchableOpacity>
          </View>
          <Nav label={t('leaveChat')} onPress={leaveChat} />
        </>))}

        {screen === 'profile' && (
          <ScrollView contentContainerStyle={sc}>
            <Pic uri={myPhoto} emoji={profile.avatar} size={90} name={myLetterName} getHd={myPhotoHd ? async () => myPhotoHd : undefined} />
            <Mini label={myPhoto ? '📷 Photo badlo' : '📷 Apni photo lagao'} onPress={() => pickPhoto('me')} />
            {currentUser && <Text style={s.sm}>@{currentUser.username} • {currentUser.email}</Text>}
            <TextInput style={s.i} placeholder={t('name')} placeholderTextColor={PH} value={profile.name} onChangeText={(v) => setProfile({ ...profile, name: v })} />
            <TextInput style={s.i2} placeholder={t('bio')} placeholderTextColor={PH} value={profile.bio} onChangeText={(v) => setProfile({ ...profile, bio: v })} multiline />
            <TextInput style={s.i} placeholder={t('avatar')} placeholderTextColor={PH} value={profile.avatar} onChangeText={(v) => setProfile({ ...profile, avatar: v })} maxLength={2} />
            <Text style={s.sm}>Tum kaun ho?</Text>
            <View style={s.miniRow}>
              <Mini label={(profile.gender === 'male' ? '✅ ' : '') + '♂ Male'} onPress={() => setProfile({ ...profile, gender: 'male' })} />
              <Mini label={(profile.gender === 'female' ? '✅ ' : '') + '♀ Female'} onPress={() => setProfile({ ...profile, gender: 'female' })} />
              <Mini label={(!profile.gender || profile.gender === 'other' ? '✅ ' : '') + 'Batana nahi'} onPress={() => setProfile({ ...profile, gender: 'other' })} />
            </View>
            <Btn label={t('save')} onPress={() => { saveProfile(profile); setNotice('Profile saved!'); }} />
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {screen === 'style' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={s.sm}>Wallpaper theme chuno: wallpaper, colours aur button ka look sab badal jayega 💞</Text>
            <View style={s.themeGrid}>
              {Object.keys(skins).map((k) => (
                <TouchableOpacity key={k} activeOpacity={0.8} style={[s.themeCard, skin === k ? { borderColor: skins[k].accent, borderWidth: 3 } : null]}
                  onPress={() => { setSkin(k); setBgPhoto(''); try { localStorage.setItem('nexdare_skin', k); localStorage.removeItem('nexdare_bgphoto'); } catch (e) {} playSound('click', soundOn); }}>
                  <RNImage pointerEvents="none" source={{ uri: wallUri(skins[k].wall) }} style={s.wallImg} resizeMode="cover" />
                  <View style={[s.themeDot, { backgroundColor: skins[k].accent }]} />
                  <View style={s.themeLabel}><Text style={s.themeName}>{(skin === k ? '✅ ' : '') + skins[k].name}</Text></View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity activeOpacity={0.8} style={[s.themeCard, { backgroundColor: '#ffffff14' }, !skin ? { borderColor: '#fff', borderWidth: 3 } : null]}
                onPress={() => { setSkin(''); try { localStorage.removeItem('nexdare_skin'); } catch (e) {} }}>
                <View style={s.themeLabel}><Text style={s.themeName}>{(!skin ? '✅ ' : '') + 'Auto (default) 🎨'}</Text></View>
              </TouchableOpacity>
            </View>
            <Text style={s.sm}>Wallpaper brightness</Text>
            <View style={s.miniRow}>
              {[['soft', '🌙 Soft'], ['normal', '☀️ Normal'], ['vivid', '🌈 Vivid']].map((d) => (
                <Mini key={d[0]} label={(wallDim === d[0] ? '✅ ' : '') + d[1]} onPress={() => { setWallDim(d[0]); try { localStorage.setItem('nexdare_walldim', d[0]); } catch (e) {} }} />
              ))}
            </View>
            {!!bgPhoto && !!skin && <Text style={s.sm}>Abhi tumhari apni background photo lagi hai, wo wallpaper ke upar dikhegi. Wallpaper dekhne ke liye neeche "Hatao" dabao.</Text>}
            <Text style={s.sm}>Apni photo (profile aur chats me dikhegi)</Text>
            <Pic uri={myPhoto} emoji={profile.avatar} size={70} name={myLetterName} getHd={myPhotoHd ? async () => myPhotoHd : undefined} />
            <Mini label="📷 Apni photo lagao" onPress={() => pickPhoto('me')} />
            <Text style={s.sm}>Background photo (poori app me)</Text>
            <View style={s.miniRow}>
              <Mini label="🖼️ Background lagao" onPress={() => pickPhoto('bg')} />
              {!!bgPhoto && <Mini label="Hatao" onPress={() => { setBgPhoto(''); localStorage.removeItem('nexdare_bgphoto'); }} />}
            </View>
            <Nav label={t('back')} onPress={() => setScreen('settings')} />
          </ScrollView>
        )}

        {screen === 'friends' && (
          <ScrollView contentContainerStyle={sc}>
            {storyTray()}
            <Text style={s.sm}>Tumhara username</Text>
            <Text style={[s.code2, { color: th.accent2 }]}>@{currentUser ? currentUser.username : ''}</Text>
            <Mini label="📋 Copy" onPress={() => copyText('@' + (currentUser ? currentUser.username : ''))} />
            {!!pubError && <Text style={[s.sm, { color: '#ff6b6b' }]}>{pubError}</Text>}
            <TextInput style={s.i} placeholder="Friend ka username" placeholderTextColor={PH} autoCapitalize="none" value={reqName} onChangeText={setReqName} />
            <Btn label="Request bhejo 📩" onPress={sendFriendRequest} />
            {Object.keys(friendReqs).length > 0 && (<>
              <Text style={[s.q, { color: th.accent2 }]}>Requests</Text>
              {Object.keys(friendReqs).map((k) => {
                const r = friendReqs[k];
                return (
                  <View key={k} style={[s.card, { borderColor: th.accent + '55', width: '90%' }]}>
                    <Text style={[s.cardT, { color: th.accent2 }]}>{avLbl(r.avatar) + (r.name || r.username)}</Text>
                    <Text style={s.cardS}>@{r.username}</Text>
                    <View style={s.miniRow}>
                      <Mini label="Accept ✅" onPress={() => acceptRequest(r)} />
                      <Mini label="Reject" onPress={() => declineRequest(r)} />
                    </View>
                  </View>
                );
              })}
            </>)}
            <Text style={[s.q, { color: th.accent2 }]}>{t('friends')}</Text>
            {Object.keys(cloudFriends).length === 0 ? <Text style={s.sm}>{t('noFriends')}</Text> : (
              <View style={{ width: '100%' }}>
                {Object.keys(cloudFriends).map((k) => cloudFriends[k])
                  .sort((a, b) => ((previews[b.chatId] && previews[b.chatId].t) || 0) - ((previews[a.chatId] && previews[a.chatId].t) || 0))
                  .map((f) => {
                    const pv = previews[f.chatId];
                    const un = unread[f.chatId] || 0;
                    return (
                      <View key={f.uid}>
                        {chatRow({
                          rowKey: f.uid, uri: pics[f.uid], emoji: f.avatar || '😎', title: nameOf(f),
                          sub: deactMap[f.uid] ? '🚫 Account deactivated' : pv ? (pv.mine ? 'You: ' : '') + pv.text : '@' + f.username,
                          time: pv ? fmtListTime(pv.t) : '', badge: un,
                          onPress: () => openDm(f), onMore: () => setFriendMenu(friendMenu === f.uid ? null : f.uid),
                          getHd: hdOf(f.uid), online: !deactMap[f.uid] && isOnline(presMap[f.uid]),
                        })}
                        {!!nickEdit && nickEdit.uid === f.uid && nickPanel()}
                        {friendMenu === f.uid && (
                          <View style={s.miniRow}>
                            <Mini label="✏️ Nickname" onPress={() => { setFriendMenu(null); setNickEdit({ uid: f.uid, text: nicks[f.uid] || '' }); }} />
                            <Mini label={t('remove')} onPress={() => { setFriendMenu(null); removeCloudFriend(f); }} />
                            <Mini label={t('cancel')} onPress={() => setFriendMenu(null)} />
                          </View>
                        )}
                      </View>
                    );
                  })}
              </View>
            )}
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {screen === 'ttt' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>⭕ Tic Tac Toe</Text>
            {renderTtt()}
            <Nav label={t('back')} onPress={backToGames} />
          </ScrollView>
        )}

        {screen === 'wyr' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>🤔 Would You Rather</Text>
            {pairGate(renderPq('wyr'))}
            <Nav label={t('back')} onPress={backToGames} />
          </ScrollView>
        )}

        {screen === 'nhie' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>🙈 Never Have I Ever</Text>
            {pairGate(renderPq('nhie'))}
            <Nav label={t('back')} onPress={backToGames} />
          </ScrollView>
        )}

        {screen === 'quiz' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>💘 Love Quiz</Text>
            {pairGate(renderQuiz())}
            <Nav label={t('back')} onPress={backToGames} />
          </ScrollView>
        )}

        {screen === 'daily' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>❓ Daily Question</Text>
            {pairGate(renderDaily())}
            <Nav label={t('back')} onPress={backToCouple} />
          </ScrollView>
        )}

        {screen === 'mem' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>💗 Hamara Safar</Text>
            {pairGate(renderMem())}
            <Nav label={t('back')} onPress={backToCouple} />
          </ScrollView>
        )}

        {screen === 'notes' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>💌 Sweet Notes</Text>
            {pairGate(renderNotes())}
            <Nav label={t('back')} onPress={backToCouple} />
          </ScrollView>
        )}

        {screen === 'album' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>📸 Shared Album</Text>
            {pairGate(renderAlbum())}
            <Nav label={t('back')} onPress={backToCouple} />
          </ScrollView>
        )}

        {screen === 'couple' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>💞 Couple Space</Text>
            {pairGate(<>
              <Text style={s.sm}>🔥 Streak: {streakBase} din</Text>
              <Btn label="❓ Daily Question" onPress={() => goScreen('daily')} />
              <Btn label="💗 Hamara Safar" onPress={() => goScreen('mem')} />
              <Btn label="📸 Shared Album" onPress={() => goScreen('album')} />
              <Btn label="💌 Sweet Notes" onPress={() => goScreen('notes')} />
            </>)}
            <Nav label={t('back')} onPress={backToTools} />
          </ScrollView>
        )}

        {screen === 'groups' && !grp && (subtle ? (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>Group Chat 👥</Text>
            <View style={s.joinRow}>
              <TextInput style={[s.i, { flex: 1, width: 'auto', marginVertical: 0 }]} placeholder="Naye group ka naam" placeholderTextColor={PH} value={grpNewName} onChangeText={setGrpNewName} onSubmitEditing={createGroup} />
              <TouchableOpacity style={[s.roundBtn, { backgroundColor: th.accent }]} onPress={createGroup}><Text style={s.roundT}>➕</Text></TouchableOpacity>
            </View>
            <Text style={s.hint}>Naam likho aur ➕ dabao: naya group ban jayega</Text>
            <View style={s.joinRow}>
              <TextInput style={[s.i, { flex: 1, width: 'auto', marginVertical: 0 }]} placeholder="Group code" placeholderTextColor={PH} autoCapitalize="none" value={grpJoinCode} onChangeText={setGrpJoinCode} onSubmitEditing={joinGroup} />
              <TouchableOpacity style={[s.roundBtn, { backgroundColor: th.accent }]} onPress={joinGroup}><Text style={s.roundT}>🔑</Text></TouchableOpacity>
            </View>
            <Text style={s.hint}>Dost ka code daalo aur 🔑 dabao: group join ho jayega</Text>
            <Text style={[s.q, { color: th.accent2 }]}>Mere groups</Text>
            {Object.keys(groupList).length === 0 ? <Text style={s.sm}>Abhi koi group nahi. Naya banao ya code se join karo.</Text> : (
              <View style={{ width: '100%' }}>
                {Object.keys(groupList).map((k) => ({ ...groupList[k], gid: k })).sort((a, b) => (b.t || 0) - (a.t || 0)).map((g) => (
                  <View key={g.gid}>
                    {chatRow({
                      rowKey: g.gid, uri: grpPics[g.gid], emoji: '👥', title: g.name, sub: 'Tap karke chat kholo', getHd: grpHdFor(g),
                      onPress: () => openGroup(g), onMore: () => setFriendMenu(friendMenu === g.gid ? null : g.gid),
                    })}
                    {friendMenu === g.gid && (
                      <View style={s.miniRow}>
                        <Mini label="🚪 Group chhodo" onPress={() => { setFriendMenu(null); removeGroupFromList(g); }} />
                        <Mini label={t('cancel')} onPress={() => setFriendMenu(null)} />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
            <Nav label={t('back')} onPress={backToTools} />
          </ScrollView>
        ) : (<>
          <Text style={s.sm}>{t('needBrowserChat')}</Text>
          <Nav label={t('back')} onPress={backToTools} />
        </>))}

        {screen === 'groups' && !!grp && (grpMeta === null ? (<>
          <Text style={s.sm}>Ye group delete ho chuka hai.</Text>
          <Nav label={t('back')} onPress={closeGroup} />
        </>) : (<>
          <View style={s.dmHead}>
            <View style={s.avWrap}><Pic uri={grpPhoto} emoji="👥" size={54} name={grp.name} getHd={grpHdLoader} /></View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text numberOfLines={1} style={[s.code2, { color: th.accent2, marginBottom: 0, fontSize: 20 }]}>{grp.name}</Text>
              <Text style={s.cardS}>{Object.keys(grpMembers).length} members{(() => { const n = Object.keys(grpMembers).filter((u) => (u === myUid ? true : isOnline(presMap[u]))).length; return n ? ' • ' + n + ' online' : ''; })()} </Text>
            </View>
            <TouchableOpacity style={s.attachBtn} onPress={() => { setGrpInfo(!grpInfo); setGrpConfirm(''); }}><Text style={s.bt}>⋮</Text></TouchableOpacity>
          </View>
          {grpInfo && (
            <View style={[s.card, { borderColor: th.accent + '55', width: '92%' }]}>
              <Text style={s.cardS}>Group code (dost isse join karenge):</Text>
              <Text style={[s.code2, { color: th.accent2 }]}>{grp.code}</Text>
              <View style={s.miniRow}>
                <Mini label="📋 Code copy" onPress={() => copyText(grp.code)} />
                <Mini label="📤 Share" onPress={shareGroupCode} />
                <Mini label="📷 Group photo" onPress={pickGroupPhoto} />
              </View>
              <Text style={[s.cardT, { color: th.accent2 }]}>Members</Text>
              {Object.keys(grpMembers).map((uid) => (
                <View key={uid} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}>
                  <Pic uri={pics[uid]} emoji={grpMembers[uid].avatar} size={34} name={grpMembers[uid].name} getHd={hdOf(uid)} />
                  <View style={{ marginLeft: 10 }}>
                    <Text style={s.cardT}>{grpMembers[uid].name + (grpMeta && grpMeta.owner === uid ? '  👑' : '') + (uid === myUid ? ' (You)' : '')}</Text>
                    {uid !== myUid && !!presText(presMap[uid]) && <Text style={[s.cardS, isOnline(presMap[uid]) ? { color: '#25d366' } : null]}>{presText(presMap[uid])}</Text>}
                  </View>
                </View>
              ))}
              <View style={s.miniRow}>
                <Mini label={grpConfirm === 'leave' ? 'Pakka chhodna hai?' : '🚪 Group chhodo'} onPress={leaveGroupForever} />
                {!!grpMeta && grpMeta.owner === myUid && <Mini label={grpConfirm === 'del' ? 'Pakka delete?' : '🗑️ Group delete'} onPress={deleteGroupForAll} />}
              </View>
            </View>
          )}
          <Text style={s.sm}>🔒 End-to-end encrypted • sirf code wale padh sakte hain</Text>
          <ScrollView ref={grpScrollRef} style={[s.msgBox, mbH]} onContentSizeChange={() => grpScrollRef.current && grpScrollRef.current.scrollToEnd({ animated: true })}>
            {grpVisible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
            {grpVisible.map((m) => {
              const mine = myUid && m.from === myUid;
              const sel = grpSel && grpSel.key === m.key;
              return (
                <TouchableOpacity key={m.key} onPress={() => setGrpSel(sel ? null : m)}
                  style={[s.bubble, mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs, sel ? s.selBubble : null]}>
                  <Text style={s.bname}>{mine ? t('you') : m.name}</Text>
                  <Text style={s.btext}>{m.text}</Text>
                  <Text style={s.tick}>{m.edited ? 'edited  ' : ''}{fmtListTime(m.t)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {!!grpSel && (
            <View style={s.miniRow}>
              {grpSel.from === myUid && <Mini label="✏️ Edit" onPress={grpStartEdit} />}
              <Mini label={t('deleteForMe')} onPress={grpDeleteForMe} />
              {grpSel.from === myUid && <Mini label={t('deleteForAll')} onPress={grpDeleteForAll} />}
              <Mini label={t('cancel')} onPress={() => setGrpSel(null)} />
            </View>
          )}
          {!!grpEditing && <Text style={s.sm}>✏️ Message edit ho raha hai <Text onPress={() => { setGrpEditing(null); setGrpText(''); }}> (cancel)</Text></Text>}
          <View style={s.sendRow}>
            <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')} placeholderTextColor={PH} value={grpText} onChangeText={setGrpText} onSubmitEditing={sendGrp} />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendGrp}><Text style={s.bt}>{grpEditing ? '✓' : '➤'}</Text></TouchableOpacity>
          </View>
          <Nav label={t('back')} onPress={closeGroup} />
        </>))}

        {screen === 'dm' && dmFriend && (subtle ? (<>
          <View style={s.dmHead}>
            <Pic uri={dmProf && dmProf.photo} emoji={dmFriend.avatar || '😎'} size={40} name={(dmProf && dmProf.name) || dmFriend.name || dmFriend.username} getHd={hdOf(dmFriend.uid)} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[s.code2, { color: th.accent2, marginBottom: 0 }]}>{nicks[dmFriend.uid] || (dmProf && dmProf.name) || dmFriend.name || dmFriend.username}</Text>
              {!!nicks[dmFriend.uid] && <Text style={s.cardS}>{(dmProf && dmProf.name) || dmFriend.name || dmFriend.username}</Text>}
              {!!presText(presMap[dmFriend.uid]) && <Text style={[s.cardS, isOnline(presMap[dmFriend.uid]) ? { color: '#25d366' } : null]}>{presText(presMap[dmFriend.uid])}</Text>}
            </View>
            {!!dmShared && <TouchableOpacity style={s.attachBtn} onPress={startDmCall}><Text style={s.bt}>📹</Text></TouchableOpacity>}
            <TouchableOpacity style={s.attachBtn} onPress={() => setDmMenu(dmMenu ? '' : 'menu')}><Text style={s.bt}>⋮</Text></TouchableOpacity>
          </View>
          {!!nickEdit && nickEdit.uid === dmFriend.uid && nickPanel()}
          {!!dmMenu && (
            <View style={s.miniRow}>
              {dmMenu === 'report' ? (<>
                <Mini label="Spam" onPress={() => reportUser('Spam')} />
                <Mini label="Abuse" onPress={() => reportUser('Abuse')} />
                <Mini label="Fake account" onPress={() => reportUser('Fake account')} />
              </>) : (<>
                <Mini label={dmMenu === 'blockConfirm' ? 'Pakka block?' : '🚫 Block'} onPress={() => (dmMenu === 'blockConfirm' ? blockUser(dmFriend) : setDmMenu('blockConfirm'))} />
                <Mini label="⚠️ Report" onPress={() => setDmMenu('report')} />
                <Mini label="✏️ Nickname" onPress={() => { setDmMenu(''); setNickEdit({ uid: dmFriend.uid, text: nicks[dmFriend.uid] || '' }); }} />
              </>)}
              <Mini label={t('cancel')} onPress={() => setDmMenu('')} />
            </View>
          )}
          <Text style={s.sm}>{dmShared ? t('e2e') + dmShared.safety : !ident ? '⏳ Key ban rahi hai...' : !dmPubStr ? '⏳ Friend ki encryption key abhi nahi mili. Unhe site kholkar Message screen par aane ko bolo.' : '⚠️ Encryption key match nahi hui'}</Text>
          <ScrollView ref={dmScrollRef} style={[s.msgBox, mbH]} onContentSizeChange={() => dmScrollRef.current && dmScrollRef.current.scrollToEnd({ animated: true })}>
            {dmVisible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
            {dmVisible.map((m) => {
              const mine = myUid && m.from === myUid;
              const sel = dmSel && dmSel.key === m.key;
              const data = m.file ? dmImgs[m.file.id] : null;
              return (
                <TouchableOpacity key={m.key} onPress={() => setDmSel(sel ? null : m)}
                  style={[s.bubble, mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs, sel ? s.selBubble : null]}>
                  <Text style={s.bname}>{mine ? t('you') : nameOf(dmFriend)}</Text>
                  {isImg(m.file) && (data && data !== 'ERR' ? <RNImage source={{ uri: data }} style={s.dmPic} resizeMode="cover" /> : <Text style={s.btext}>{data === 'ERR' ? '🖼️ Photo khul nahi payi' : '🖼️ Photo load ho rahi hai...'}</Text>)}
                  {isAud(m.file) && (data && data !== 'ERR' && Platform.OS === 'web' ? React.createElement('audio', { src: data, controls: true, style: { width: 210 } }) : <Text style={s.btext}>🎤 Voice note load ho raha hai...</Text>)}
                  {!!m.file && !isImg(m.file) && !isAud(m.file) && <Text style={s.btext}>📎 {m.file.name} ({fmtSize(m.file.size)})</Text>}
                  {!!m.file && !isAud(m.file) && (
                    <TouchableOpacity onPress={() => downloadDmFile(m.file)}><Text style={[s.bname, { textDecorationLine: 'underline' }]}>⬇️ Download</Text></TouchableOpacity>
                  )}
                  {!!m.text && <Text style={s.btext}>{m.text}</Text>}
                  <Text style={s.tick}>{m.edited ? 'edited  ' : ''}{mine ? (friendSeen >= m.t ? '✓✓ Seen' : '✓ Sent') : ''}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {!!dmSel && (
            <View style={s.miniRow}>
              {dmSel.from === myUid && !dmSel.file && <Mini label="✏️ Edit" onPress={startEdit} />}
              <Mini label={t('deleteForMe')} onPress={dmDeleteForMe} />
              {dmSel.from === myUid && <Mini label={t('deleteForAll')} onPress={dmDeleteForAll} />}
              <Mini label={t('cancel')} onPress={() => setDmSel(null)} />
            </View>
          )}
          {editing && <Text style={s.sm}>✏️ Message edit ho raha hai <Text onPress={() => { setEditing(null); setDmText(''); }}> (cancel)</Text></Text>}
          {dmBusy && <Text style={s.sm}>⏳ Bhej raha hoon...</Text>}
          {recording && <Text style={s.sm}>🔴 Record ho raha hai... ruk-ne ke liye ⏹ dabao</Text>}
          {dmPlus && !recording && (
            <View style={s.miniRow}>
              <Mini label="📷 Camera" onPress={() => { setDmPlus(false); if (!dmShared) { setNotice('Friend ki encryption abhi ready nahi hai.'); return; } openCamera(sendCamToDm); }} />
              <Mini label="📎 File" onPress={() => { setDmPlus(false); pickDmFile(); }} />
              <Mini label="🎤 Voice" onPress={() => { setDmPlus(false); startRec(); }} />
            </View>
          )}
          <View style={s.sendRow}>
            {recording
              ? <TouchableOpacity style={s.attachBtn} onPress={stopRec}><Text style={s.bt}>⏹</Text></TouchableOpacity>
              : <TouchableOpacity style={s.attachBtn} onPress={() => setDmPlus(!dmPlus)}><Text style={s.bt}>{dmPlus ? '✕' : '＋'}</Text></TouchableOpacity>}
            <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')} placeholderTextColor={PH} value={dmText} onChangeText={setDmText} onSubmitEditing={sendDm} />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendDm}><Text style={s.bt}>{editing ? '✓' : '➤'}</Text></TouchableOpacity>
          </View>
          <Nav label={t('back')} onPress={leaveDm} />
        </>) : (<>
          <Text style={s.sm}>{t('needBrowserChat')}</Text>
          <Nav label={t('back')} onPress={leaveDm} />
        </>))}

        {screen === 'stranger' && (
          <ScrollView contentContainerStyle={sc}>
            {!subtle && <Text style={s.sm}>{t('needBrowserChat')}</Text>}
            {strState === 'idle' && (
              <View style={{ alignItems: 'center', width: '100%', paddingTop: 36 }}>
                <Animated.Text style={[s.strGlobe, { transform: [{ scale: pulse }] }]}>🌍</Animated.Text>
                <Text style={s.strTitle}>Naye logon se milo</Text>
                <TouchableOpacity activeOpacity={0.85} style={[s.strGo, { backgroundColor: th.accent, shadowColor: th.accent }]} onPress={strStart}>
                  <Text style={s.strGoT}>▶</Text>
                  <Text style={s.strGoS}>Start</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.strChip} onPress={toggleStrName}>
                  <Text style={s.camChipT}>{strShowName ? '👁️ ' + myDisplayName() + ' naam se dikhoge' : '🕶️ Anonymous rahoge'}</Text>
                </TouchableOpacity>
              </View>
            )}
            {strState === 'searching' && (
              <View style={{ alignItems: 'center', width: '100%', paddingTop: 36 }}>
                <Animated.Text style={[s.strGlobe, { transform: [{ scale: pulse }] }]}>🔎</Animated.Text>
                <Text style={s.strTitle}>Dhundh raha hoon...</Text>
                <Text style={s.sm}>{strAlive <= 1 ? 'Abhi tum akele ho, thoda ruko' : 'Match mil raha hai...'}</Text>
                <Btn label="✕ Cancel" onPress={() => strStop(false)} />
              </View>
            )}
            {strState === 'chatting' && (<>
              <View style={s.dmHead}>
                <View style={{ borderWidth: 2, borderRadius: 26, padding: 1, borderColor: strPeer && strPeer.g === 'male' ? '#4da3ff' : strPeer && strPeer.g === 'female' ? '#ff7eb6' : 'transparent' }}><Pic uri={null} emoji={(strPeer && strPeer.av) || ''} size={44} name={(strPeer && strPeer.name) || 'Stranger'} noTap /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text numberOfLines={1} style={[s.code2, { color: th.accent2, marginBottom: 0 }]}>{((strPeer && strPeer.name) || 'Stranger') + gSym(strPeer && strPeer.g)}</Text>
                  <Text style={[s.cardS, { color: strEnded ? '#ff8a8a' : '#25d366' }]}>{strEnded ? 'Chala gaya' : '● Connected'}</Text>
                </View>
                {!strEnded && <TouchableOpacity style={s.attachBtn} onPress={() => strStop(true)}><Text style={s.bt}>⏭</Text></TouchableOpacity>}
                <TouchableOpacity style={s.attachBtn} onPress={() => setStrMenu(!strMenu)}><Text style={s.bt}>⋮</Text></TouchableOpacity>
              </View>
              {strMenu && (
                <View style={s.miniRow}>
                  <Mini label="⚠️ Report" onPress={() => { setStrMenu(false); strReport(); }} />
                  <Mini label="⏹ Stop" onPress={() => { setStrMenu(false); strStop(false); }} />
                </View>
              )}
              <ScrollView ref={strScroll} style={[s.msgBox, mbH]} onContentSizeChange={() => strScroll.current && strScroll.current.scrollToEnd({ animated: true })}>
                {strPlain.map((m) => (
                  <View key={m.key} style={[s.bubble, m.mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs]}>
                    <Text style={s.bname}>{m.mine ? t('you') : ((strPeer && strPeer.name) || 'Stranger')}</Text>
                    <Text style={s.btext}>{m.text}</Text>
                  </View>
                ))}
              </ScrollView>
              {strEnded ? <Btn label="➡️ Naya stranger" onPress={() => strStop(true)} /> : (<>
                {strPlain.length === 0 && (
                  <View style={s.miniRow}>
                    {['👋 Hi!', 'Kaise ho? 😊', 'Kahan se ho? 🌍'].map((q) => <Mini key={q} label={q} onPress={() => strSend(q)} />)}
                  </View>
                )}
                <View style={s.sendRow}>
                  <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')} placeholderTextColor={PH} value={strText} onChangeText={setStrText} onSubmitEditing={() => strSend()} />
                  <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={() => strSend()}><Text style={s.bt}>➤</Text></TouchableOpacity>
                </View>
              </>)}
            </>)}
            <Nav label={t('back')} onPress={backToTools} />
          </ScrollView>
        )}

        {screen === 'storynew' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>➕ Nayi story</Text>
            <Text style={s.sm}>Kisko dikhani hai?</Text>
            <View style={s.miniRow}>
              <Mini label={(stAud === 'all' ? '✅ ' : '') + '👥 Sabhi friends'} onPress={() => setStAud('all')} />
              <Mini label={(stAud === 'close' ? '✅ ' : '') + '💚 Close friends'} onPress={() => setStAud('close')} />
            </View>
            <Btn label={stBusy ? 'Ruko...' : '📷 Camera se (photo / video)'} onPress={() => openCamera(postCamStory, { video: true })} />
            <Btn label="🖼️ Gallery se (photo / video)" onPress={pickStoryMedia} />
            <Text style={s.hint}>Video max 15 sec ki rakho.</Text>
            <Text style={[s.q, { color: th.accent2 }]}>✏️ Text story</Text>
            <TextInput style={[s.i, { height: 90, textAlignVertical: 'top' }]} multiline placeholder="Kuch likho..." placeholderTextColor={PH} value={stText} onChangeText={setStText} />
            <View style={s.miniRow}>
              {ST_BGS.map((c, i) => (
                <TouchableOpacity key={c} onPress={() => setStBg(i)} style={[s.stDot, { backgroundColor: c, borderColor: stBg === i ? '#fff' : 'transparent' }]} />
              ))}
            </View>
            <Btn label={stBusy ? 'Ruko...' : '📤 Text story lagao'} onPress={postTextStory} />
            <Text style={s.hint}>Story 24 ghante baad apne aap hat jati hai.</Text>
            <Nav label="💚 Close friends list" onPress={() => setScreen('closefr')} />
            <Nav label={t('back')} onPress={() => setScreen('friends')} />
          </ScrollView>
        )}

        {screen === 'closefr' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>💚 Close Friends</Text>
            <Text style={s.sm}>Jinhe chunoge, sirf unhe "Close friends" wali story dikhegi.</Text>
            {Object.keys(cloudFriends).length === 0 ? <Text style={s.sm}>{t('noFriends')}</Text> : Object.keys(cloudFriends).map((k) => cloudFriends[k]).map((f) => (
              <View key={f.uid} style={s.closeRow}>
                <Pic uri={pics[f.uid]} emoji={f.avatar || '😎'} size={40} name={nameOf(f)} noTap />
                <Text numberOfLines={1} style={s.closeName}>{nameOf(f)}</Text>
                <Switch value={!!closeSet[f.uid]} onValueChange={(v) => toggleClose(f.uid, v)} />
              </View>
            ))}
            <Nav label={t('back')} onPress={() => setScreen('storynew')} />
          </ScrollView>
        )}

        {screen === 'acct' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>Account</Text>
            {!acctMode ? (<>
              <Text style={s.sm}>Kya karna chahte ho?</Text>
              <TouchableOpacity style={s.acctCard} onPress={() => startAcct('deactivate')}>
                <Text style={s.acctT}>⏸️  Temporarily deactivate</Text>
                <Text style={s.acctS}>Tumhara profile aur chats doston ko nahi dikhenge. Dobara login karte hi sab wapas aa jayega.</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.acctCard, { borderColor: '#ff6b6b88' }]} onPress={() => startAcct('delete')}>
                <Text style={[s.acctT, { color: '#ff8a8a' }]}>🗑️  Permanently delete</Text>
                <Text style={s.acctS}>15 din ke baad account aur saara data hamesha ke liye hat jayega. In 15 din me login karoge to delete cancel ho jayega.</Text>
              </TouchableOpacity>
            </>) : (<>
              <Text style={[s.q, { color: acctMode === 'delete' ? '#ff8a8a' : th.accent2 }]}>{acctMode === 'delete' ? '🗑️ Permanently delete' : '⏸️ Deactivate'}</Text>
              <Text style={s.sm}>{acctMode === 'delete' ? 'Account 15 din baad delete hoga. Is beech login karoge to cancel ho jayega. Pehle verify karo:' : 'Pehle verify karo:'}</Text>
              {acctHasPw && <TextInput style={s.i} placeholder="Apna password" placeholderTextColor={PH} secureTextEntry autoCapitalize="none" value={acctPass} onChangeText={setAcctPass} />}
              {otpOn ? (<>
                {!acctSent
                  ? <Btn label={acctBusy ? 'Ruko...' : '📧 Email par OTP bhejo'} onPress={sendAcctOtp} />
                  : (<>
                    <Text style={s.sm}>OTP {currentUser ? currentUser.email : ''} par bheja gaya (10 min valid)</Text>
                    <TextInput style={s.i} placeholder="6 digit OTP" placeholderTextColor={PH} keyboardType="number-pad" maxLength={6} value={acctCode} onChangeText={setAcctCode} />
                    <Mini label="🔁 OTP dobara bhejo" onPress={sendAcctOtp} />
                  </>)}
              </>) : (!acctHasPw && (<>
                <Text style={s.sm}>Confirm karne ke liye neeche CONFIRM likho</Text>
                <TextInput style={s.i} placeholder="CONFIRM" placeholderTextColor={PH} autoCapitalize="characters" value={acctWord} onChangeText={setAcctWord} />
              </>))}
              <Btn label={acctBusy ? 'Ruko...' : acctMode === 'delete' ? 'Haan, 15 din baad delete karo' : 'Deactivate karo'} onPress={confirmAcct} />
              <Nav label={t('cancel')} onPress={resetAcct} />
            </>)}
            <Nav label={t('back')} onPress={() => { resetAcct(); setScreen('settings'); }} />
          </ScrollView>
        )}

        {screen === 'settings' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={[s.q, { color: th.accent2 }]}>{t('settings')}</Text>
            {setGroup('PREFERENCES', [
              { icon: '🔊', title: t('sound'), right: <Switch value={soundOn} onValueChange={(v) => { setSoundOn(v); localStorage.setItem('nexdare_sound', v ? '1' : '0'); }} /> },
              { icon: '🔔', title: t('notifications'), right: <Switch value={notifOn} onValueChange={(v) => { if (v) requestNotif(); else { setNotifOn(false); localStorage.setItem('nexdare_notif', '0'); } }} /> },
              { icon: '🌐', title: 'Language', right: <Text style={s.setSub}>{((LANGS.find((l) => l[0] === uiLang) || [0, 'English'])[1]) + (langOpen ? '  ▴' : '  ▾')}</Text>, onPress: () => setLangOpen(!langOpen) },
              { icon: '🎨', title: 'Theme & wallpaper', sub: 'Wallpaper, colours aur apni photo', onPress: () => setScreen('style') },
            ])}
            {langOpen && (
              <View style={s.miniRow}>
                {LANGS.map((l) => <Mini key={l[0]} label={(uiLang === l[0] ? '✅ ' : '') + l[1]} onPress={() => { changeLang(l[0]); setLangOpen(false); }} />)}
              </View>
            )}
            {setGroup('PRIVACY & SAFETY', [
              { icon: '🟢', title: 'Last seen / online dikhao', sub: 'Band karoge to doosron ka bhi nahi dikhega', right: <Switch value={showSeen} onValueChange={toggleSeen} /> },
              ...Object.keys(blocks).map((k) => ({ key: 'blk' + k, icon: '🚫', title: '@' + blocks[k].username, sub: 'Blocked', right: <Mini label="Unblock" onPress={() => unblockUser(k)} /> })),
              { icon: '📄', title: 'Privacy Policy', onPress: () => Linking.openURL('https://dandelion-metal-55e.notion.site/Nexdare-Privacy-Policy-41dab7c3e245804aaa46ef40d4cc356e') },
            ])}
            {setGroup('SHARE', [
              { icon: '📤', title: 'App share karo', sub: 'Dost ko Nexdare bhejo', onPress: shareApp },
            ])}
            {setGroup('ACCOUNT', [
              { icon: '🚪', title: t('logout'), onPress: logout },
              { icon: '🧹', title: t('clearData'), onPress: () => setShowClearConfirm(true) },
              { icon: '⚙️', title: 'Account', sub: 'Deactivate ya permanently delete', danger: true, onPress: () => { resetAcct(); setScreen('acct'); } },
            ])}
            {showClearConfirm && (<>
              <Text style={s.sm}>{t('clearConfirm')}</Text>
              <Btn label={t('yesClear')} onPress={clearAllData} />
              <Nav label={t('cancel')} onPress={() => setShowClearConfirm(false)} />
            </>)}
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {!!error && <Text style={[s.sm, { color: '#ff6b6b', marginTop: 10 }]}>{error}</Text>}
        {!!notice && <Text style={[s.sm, { color: th.accent2, marginTop: 8 }]}>{notice}</Text>}
      </>)}
      {!!cam && (() => {
        const { bw, bh } = camBox();
        const flt = CAM_FILTERS[cam.fi][1];
        return (
          <View style={s.camBg}>
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 10 }}>
              <View style={[s.camTop, { width: bw }]}>
                <TouchableOpacity onPress={closeCam} style={s.camChip}><Text style={s.camChipT}>✕</Text></TouchableOpacity>
                {!cam.raw && !cam.vid && cam.mode !== 'video' && <TouchableOpacity onPress={() => setCam((c) => ({ ...c, timer: c.timer === 0 ? 3 : c.timer === 3 ? 5 : 0 }))} style={s.camChip}><Text style={s.camChipT}>{cam.timer ? '⏱ ' + cam.timer + 's' : '⏱ Off'}</Text></TouchableOpacity>}
                {cam.allowVideo && !cam.raw && !cam.vid && !cam.rec && <TouchableOpacity onPress={() => setCam((c) => ({ ...c, mode: c.mode === 'video' ? 'photo' : 'video', err: '' }))} style={s.camChip}><Text style={s.camChipT}>{cam.mode === 'video' ? '🎥 Video' : '📷 Photo'}</Text></TouchableOpacity>}
                {!cam.raw && !cam.vid && !cam.rec && <TouchableOpacity onPress={() => setCam((c) => ({ ...c, facing: c.facing === 'user' ? 'environment' : 'user' }))} style={s.camChip}><Text style={s.camChipT}>🔄 Flip</Text></TouchableOpacity>}
              </View>
              <TouchableOpacity activeOpacity={1} onPress={camPlace} style={{ width: bw, height: bh, backgroundColor: '#000', overflow: 'hidden', borderRadius: 18 }}>
                {cam.vid
                  ? React.createElement('video', { key: 'vidprev', src: cam.vid, controls: true, autoPlay: true, loop: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'cover' } })
                  : cam.raw
                    ? React.createElement('img', { src: cam.raw, style: { width: '100%', height: '100%', objectFit: 'cover', filter: flt, pointerEvents: 'none' } })
                    : React.createElement('video', { ref: camVideo, autoPlay: true, playsInline: true, muted: true, style: { width: '100%', height: '100%', objectFit: 'cover', filter: cam.mode === 'video' ? 'none' : flt, transform: cam.facing === 'user' ? 'scaleX(-1)' : 'none', pointerEvents: 'none' } })}
                {cam.rec && <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}><Text style={s.recT}>🔴 {cam.rsec}s / 15s</Text></View>}
                {cam.stickers.map((st, i) => (
                  <Text key={i} pointerEvents="none" style={{ position: 'absolute', left: st.x * bw - bw * 0.1, top: st.y * bh - bw * 0.1, fontSize: bw * 0.16, width: bw * 0.2, textAlign: 'center' }}>{st.e}</Text>
                ))}
                {!!cam.caption && cam.raw && (
                  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: bh * 0.72, height: bw * 0.15, backgroundColor: '#0000008c', alignItems: 'center', justifyContent: 'center' }}>
                    <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: bw * 0.065 }}>{cam.caption}</Text>
                  </View>
                )}
                {cam.count > 0 && <View pointerEvents="none" style={s.camCount}><Text style={s.camCountT}>{cam.count}</Text></View>}
              </TouchableOpacity>
              {!cam.vid && cam.mode !== 'video' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, maxHeight: 44, width: bw }}>
                {CAM_FILTERS.map((f, i) => (
                  <TouchableOpacity key={f[0]} onPress={() => setCam((c) => ({ ...c, fi: i }))} style={[s.camFilt, cam.fi === i ? { backgroundColor: '#ff4d8d' } : null]}>
                    <Text style={s.camChipT}>{f[0]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              )}
              {cam.vid ? (<>
                {!!cam.err && <Text style={[s.sm, { color: '#ff8a8a' }]}>{cam.err}</Text>}
                <View style={s.miniRow}>
                  <Mini label="🔁 Dobara" onPress={() => setCam((c) => ({ ...c, vid: null, err: '' }))} />
                  <Mini label={cam.busy ? 'Ruko...' : '✅ Bhejo'} onPress={camUse} />
                </View>
              </>) : !cam.raw ? (<>
                {!!cam.err && <Text style={[s.sm, { color: '#ff8a8a' }]}>{cam.err}</Text>}
                {cam.mode === 'video' && <Text style={s.hint}>{cam.rec ? 'Rokne ke liye dobara dabao (max 15 sec)' : 'Record shuru karne ke liye dabao (max 15 sec)'}</Text>}
                <TouchableOpacity onPress={camShutter} style={[s.shutter, cam.rec ? { borderColor: '#ff3b3b' } : null]}><View style={[s.shutterIn, cam.rec ? { backgroundColor: '#ff3b3b', borderRadius: 8, width: 30, height: 30 } : null]} /></TouchableOpacity>
              </>) : (<>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, maxHeight: 48, width: bw }}>
                  {CAM_STICKERS.map((e) => (
                    <TouchableOpacity key={e} onPress={() => setCam((c) => ({ ...c, pick: c.pick === e ? '' : e }))} style={[s.camFilt, cam.pick === e ? { backgroundColor: '#ff4d8d' } : null]}>
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setCam((c) => ({ ...c, stickers: c.stickers.slice(0, -1) }))} style={s.camFilt}><Text style={s.camChipT}>↩️ Undo</Text></TouchableOpacity>
                </ScrollView>
                <Text style={s.hint}>{cam.pick ? 'Photo par tap karo, sticker wahin lagega' : 'Sticker chuno, phir photo par tap karo'}</Text>
                <TextInput style={[s.i, { width: bw, marginVertical: 4 }]} placeholder="Caption likho (optional)" placeholderTextColor={PH} value={cam.caption} onChangeText={(v) => setCam((c) => ({ ...c, caption: v }))} />
                {!!cam.err && <Text style={[s.sm, { color: '#ff8a8a' }]}>{cam.err}</Text>}
                <View style={s.miniRow}>
                  <Mini label="🔁 Dobara" onPress={() => setCam((c) => ({ ...c, raw: null, err: '' }))} />
                  <Mini label={cam.busy ? 'Ruko...' : '✅ Bhejo'} onPress={camUse} />
                </View>
              </>)}
            </ScrollView>
          </View>
        );
      })()}
      {!!sv && (() => {
        const st = sv.list[sv.idx];
        if (!st) return null;
        const mineSt = sv.uid === myUid;
        const fr = cloudFriends[sv.uid];
        const owner = mineSt ? 'Your story' : (fr ? nameOf(fr) : 'Story');
        return (
          <View style={s.stBg}>
            <View style={s.stBars}>
              {sv.list.map((x, i) => <View key={x.sid} style={[s.stBar, { backgroundColor: i < sv.idx ? '#fff' : i === sv.idx ? '#ffffffcc' : '#ffffff44' }]} />)}
            </View>
            <View style={s.stHead}>
              <Pic uri={mineSt ? myPhoto : pics[sv.uid]} emoji={mineSt ? profile.avatar : (fr && fr.avatar) || '😎'} size={36} name={owner} noTap />
              <Text style={s.stHeadT}>{owner}</Text>
              {st.bucket === 'close' && <Text style={s.stHeadT}>💚</Text>}
              <Text style={[s.stHeadT, { flex: 1, textAlign: 'right', opacity: 0.7, fontSize: 12 }]}>{fmtListTime(st.t)}</Text>
              <TouchableOpacity onPress={() => setSv(null)} style={{ paddingHorizontal: 10 }}><Text style={s.stHeadT}>✕</Text></TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={1} style={{ flex: 1 }} onPress={(e) => {
              const x = (e && e.nativeEvent && e.nativeEvent.locationX) || 0;
              const w = typeof window !== 'undefined' ? window.innerWidth : 360;
              if (x < w * 0.3) svPrev(); else svNext();
            }}>
              {st.type === 'text'
                ? <View style={[s.stTextBox, { backgroundColor: ST_BGS[st.bg || 0] }]}><Text style={s.stTextT}>{st.text}</Text></View>
                : (() => {
                  const media = st.data || svMedia[st.sid];
                  if (!media) return <Text style={s.sm}>Load ho raha hai...</Text>;
                  if (media === 'none') return <Text style={s.sm}>Story load nahi hui</Text>;
                  return st.type === 'vid'
                    ? React.createElement('video', { key: st.sid, src: media, autoPlay: true, playsInline: true, onEnded: svNext, style: { width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000', pointerEvents: 'none' } })
                    : <RNImage source={{ uri: media }} style={s.stImg} resizeMode="contain" />;
                })()}
            </TouchableOpacity>
            {mineSt && (
              <View style={s.stFoot}>
                <Text style={s.stHeadT}>👁 {Object.keys(st.views || {}).length} ne dekha</Text>
                <Mini label="🗑 Delete" onPress={() => svDelete(st)} />
              </View>
            )}
          </View>
        );
      })()}
      {!!viewer && (
        <TouchableOpacity activeOpacity={1} onPress={() => setViewer(null)} style={s.viewerBg}>
          <RNImage source={{ uri: viewerHd && viewerHd !== 'none' ? viewerHd : viewer.uri }} style={s.viewerImg} resizeMode="contain" />
          {!!viewer.getHd && viewerHd === '' && <Text style={s.sm}>HD load ho rahi hai...</Text>}
          <Text style={s.viewerClose}>✕  Band karo</Text>
        </TouchableOpacity>
      )}
      {showSplash && (
        <View
          pointerEvents="auto"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            elevation: 9999,
            backgroundColor: '#000',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={{ width: '100%', height: '100%', opacity: splashAnim, transform: [{ scale: splashAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
            <RNImage source={{ uri: SPLASH_URI }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  cTop: { justifyContent: 'flex-start', paddingTop: 50 },
  bgImg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.22 },
  authBox: { width: '100%', alignItems: 'center', paddingHorizontal: 24, zIndex: 10 },
  glow: { position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.25 },
  glow2: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.2 },
  floatWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  floaty: { position: 'absolute', opacity: 0.35 },
  welcome: { fontSize: 18, letterSpacing: 6, fontWeight: '600', marginBottom: 8 },
  rule: { width: 60, height: 3, borderRadius: 2, marginBottom: 12 },
  logo: { fontSize: 42, fontWeight: '800', marginBottom: 30, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 },
  t: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 16, textAlign: 'center' },
  tStyled: { fontSize: 22, fontWeight: '600', color: '#fff', marginBottom: 20, textAlign: 'center', opacity: 0.9 },
  bt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btBig: { fontSize: 20 },
  b: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, marginVertical: 8, minWidth: 220, alignItems: 'center', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  bBig: { paddingVertical: 18, minWidth: 240 },
  bHalf: { minWidth: 0, width: 150, paddingHorizontal: 10, marginHorizontal: 8 },
  sideRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  nav: { borderWidth: 1.5, borderRadius: 24, paddingVertical: 10, paddingHorizontal: 22, marginVertical: 6 },
  navt: { fontSize: 15, fontWeight: '600' },
  mini: { borderWidth: 1, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14, marginHorizontal: 4, marginVertical: 3 },
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
  tick: { color: '#ffffffaa', fontSize: 11, textAlign: 'right', marginTop: 3 },
  pic: { width: '100%', height: 180, borderRadius: 12, marginTop: 8 },
  picSmall: { width: 120, height: 120, borderRadius: 12, marginVertical: 8 },
  msgBox: { width: '100%', maxHeight: 340, marginVertical: 8 },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginVertical: 4, marginHorizontal: 8 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#ffffff18', borderBottomLeftRadius: 4 },
  selBubble: { borderWidth: 2, borderColor: '#fff' },
  dmHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, width: '100%', paddingHorizontal: 12 },
  sendRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 8 },
  msgInput: { flex: 1, minWidth: 0, width: 0, backgroundColor: '#ffffff18', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, color: '#fff', fontSize: 15, marginRight: 8 },
  attachBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff18', marginRight: 6 },
  dmPic: { width: 220, height: 220, borderRadius: 12, marginBottom: 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#ffffff12', borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 1 },
  cardT: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardS: { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeT: { color: '#fff', fontSize: 12, fontWeight: '800' },
  wallImg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: '100%' },
  themeCard: { width: 150, height: 210, margin: 6, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: '#ffffff22', justifyContent: 'flex-end' },
  themeLabel: { backgroundColor: '#00000088', paddingVertical: 8, paddingHorizontal: 10 },
  themeName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  themeDot: { position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#fff' },
  setHead: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8, marginLeft: 6 },
  setCard: { backgroundColor: '#ffffff12', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#ffffff1a' },
  setItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#ffffff14' },
  setIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  setTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  setSub: { color: '#ffffff99', fontSize: 12, marginTop: 2 },
  setArrow: { color: '#ffffff88', fontSize: 24, marginLeft: 8 },
  joinRow: { flexDirection: 'row', alignItems: 'center', width: '92%', marginTop: 10 },
  roundBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  roundT: { fontSize: 22, color: '#fff' },
  hint: { color: '#ffffff88', fontSize: 12, marginTop: 4, marginBottom: 6, textAlign: 'center' },
  acctCard: { width: '92%', borderWidth: 1.5, borderColor: '#ffffff30', backgroundColor: '#ffffff10', borderRadius: 18, padding: 16, marginVertical: 8 },
  acctT: { color: '#fff', fontSize: 17, fontWeight: '700' },
  acctS: { color: '#ffffffaa', fontSize: 13, marginTop: 6 },
  camBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000f5', zIndex: 1000 },
  strGlobe: { fontSize: 88 },
  strTitle: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 8, marginBottom: 26 },
  strGo: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.6, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  strGoT: { color: '#fff', fontSize: 40, fontWeight: '800' },
  strGoS: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 2 },
  strChip: { backgroundColor: '#ffffff18', borderRadius: 18, paddingVertical: 9, paddingHorizontal: 16, marginTop: 28 },
  recT: { color: '#fff', fontWeight: '800', fontSize: 15, backgroundColor: '#000000aa', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  camTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  camChip: { backgroundColor: '#ffffff22', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14 },
  camChipT: { color: '#fff', fontWeight: '700', fontSize: 14 },
  camFilt: { backgroundColor: '#ffffff18', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, justifyContent: 'center' },
  camCount: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000055' },
  camCountT: { color: '#fff', fontSize: 96, fontWeight: '800' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  shutterIn: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  stItem: { width: 72, alignItems: 'center', marginRight: 8 },
  stRing: { borderWidth: 3, borderRadius: 36, padding: 2 },
  stName: { color: '#ffffffcc', fontSize: 11, marginTop: 4, width: 70, textAlign: 'center' },
  stPlus: { position: 'absolute', right: 6, top: 42, width: 22, height: 22, borderRadius: 11, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#1a0a12' },
  stPlusT: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  stDot: { width: 34, height: 34, borderRadius: 17, marginHorizontal: 5, borderWidth: 3 },
  closeRow: { flexDirection: 'row', alignItems: 'center', width: '90%', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ffffff14' },
  closeName: { flex: 1, color: '#fff', fontSize: 16, marginHorizontal: 12 },
  stBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 1100 },
  stBars: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 10 },
  stBar: { flex: 1, height: 3, borderRadius: 2, marginHorizontal: 2 },
  stHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  stHeadT: { color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 8 },
  stImg: { flex: 1, width: '100%' },
  stTextBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stTextT: { color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center' },
  stFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  onDot: { position: 'absolute', right: 1, bottom: 1, width: 14, height: 14, borderRadius: 7, backgroundColor: '#25d366', borderWidth: 2, borderColor: '#1a0a12' },
  tttGrid: { marginVertical: 10 },
  tttCell: { width: 92, height: 92, margin: 4, borderRadius: 16, backgroundColor: '#ffffff14', borderWidth: 1.5, borderColor: '#ffffff30', alignItems: 'center', justifyContent: 'center' },
  tttMark: { fontSize: 48, fontWeight: '800' },
  viewerBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000f2', alignItems: 'center', justifyContent: 'center', zIndex: 999 },
  viewerImg: { width: '100%', height: '80%' },
  viewerClose: { color: '#fff', fontSize: 16, marginTop: 16 },
  bottleWrap: { width: 250, height: 250, borderRadius: 125, borderWidth: 2, borderColor: '#ffffff30', backgroundColor: '#ffffff0d', alignItems: 'center', justifyContent: 'center', marginVertical: 14 },
  bottleLbl: { position: 'absolute', fontSize: 15, fontWeight: '700' },
  chatRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#ffffff14' },
  avWrap: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#ffffff1f', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rowTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '700' },
  rowTime: { color: '#ffffff99', fontSize: 12, marginLeft: 8 },
  rowSub: { flex: 1, color: '#ffffffaa', fontSize: 14 },
});
