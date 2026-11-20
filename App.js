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

  const [profile, setProfile] = useState({ name: '', bio: '', avatar: '😎' });
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
  const skins = {
    rose: { name: 'Rose 🌹', bg: '#2a0a18', accent: '#ff4d8d', accent2: '#ffd1e3', glow: '#ff4d8d', glow2: '#8a1c4d' },
    orchid: { name: 'Orchid 💜', bg: '#24092a', accent: '#c850c0', accent2: '#f3c9ef', glow: '#c850c0', glow2: '#ff4d8d' },
    peach: { name: 'Peach 🍑', bg: '#2b0f14', accent: '#ff7a8a', accent2: '#ffdadf', glow: '#ff7a8a', glow2: '#b0235a' },
    wine: { name: 'Wine 🍷', bg: '#220810', accent: '#d6336c', accent2: '#fbc4d4', glow: '#d6336c', glow2: '#5c0f2b' },
    night: { name: 'Midnight 🌙', bg: '#150f2e', accent: '#ff6fa5', accent2: '#e0d4ff', glow: '#7c5cff', glow2: '#ff6fa5' },
  };

  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('nexdare_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        if (user && user.email && user.uid && authState.refreshToken) {
          setCurrentUser(user); setIsLoggedIn(true);
          setProfile((prev) => ({ ...prev, name: user.name || '', bio: user.bio || '', avatar: user.avatar || '😎' }));
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
          name: p.name || currentUser.username, avatar: p.avatar || '😎', bio: p.bio || '', photo: myPhoto || '',
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
    let userData = { uid, email: mail, name: profile.name || (extra && extra.name) || '', bio: profile.bio || '', avatar: profile.avatar || '😎', lastLogin: Date.now() };
    try {
      const snap = await get(ref(db, 'users/' + uid));
      if (snap.exists()) userData = { ...userData, ...snap.val(), uid, email: mail, lastLogin: Date.now() };
      await set(ref(db, 'users/' + uid), userData);
    } catch (e) {}
    try {
      const ps = await get(ref(db, 'profiles/' + uid));
      if (ps.exists() && ps.val().username) userData.username = ps.val().username;
    } catch (e) {}
    localStorage.setItem('nexdare_user', JSON.stringify(userData));
    setCurrentUser(userData);
    setProfile((prev) => ({ ...prev, name: userData.name || '', bio: userData.bio || '', avatar: userData.avatar || '😎' }));
    setIsLoggedIn(true); setAuthStep('form');
    setPendingToken(''); setPendingEmail(''); setPendingUid(''); setPendingRefresh('');
    setEmail(''); setPassword(''); setError(''); setNotice('Login successful! 🎉');
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
      setProfile({ name: '', bio: '', avatar: '😎' });
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
    for (const u of uids) {
      try { out[u] = (await call('GET', 'presence/' + u)) || null; } catch (e) {}
    }
    setPresMap((p) => ({ ...p, ...out }));
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
  const albumAdd = () => {
    if (Platform.OS !== 'web') { setNotice(t('picOnlyWeb')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      setAlbumBusy(true); setError('');
      try {
        const small = await compressImageTo(await readAsDataUrl(f), 900, 0.65);
        const enc = await encryptText(palAes, small);
        await push(ref(db, cidPath('album')), { from: currentUser.uid, iv: enc.iv, ct: enc.ct, t: Date.now() });
        await albumLoad();
      } catch (e) { setError('Photo nahi gayi: ' + e.message); }
      setAlbumBusy(false);
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
      const paths = ['friendReqs/' + uid, 'userGroups/' + uid, 'blocks/' + uid, 'profiles/' + uid];
      if (currentUser.username) paths.push('usernames/' + currentUser.username);
      for (const p of paths) await remove(ref(db, p)).catch(() => {});
      clearAllData(); logout(); setDelConfirm(false);
      setNotice('Account delete ho gaya.');
    } catch (e) {
      setError('Account delete nahi hua: ' + e.message + '. Ek baar logout karke dobara login karo, phir try karo.');
    }
  };
  // ===== GAMES + COUPLE SPACE + SAFETY END =====

  // ===== PART 2 END. Neeche Part 3 paste karo (const Btn se shuru) =====

  const visible = plain.filter((m) => !hidden.includes(m.key));
  const dmVisible = dmPlain.filter((m) => !dmHidden.includes(m.key));
  const grpVisible = grpPlain.filter((m) => !grpHidden.includes(m.key));
  const myId = ident ? ident.sid : null;
  const myUid = currentUser ? currentUser.uid : null;
  const totalUnread = Object.keys(unread).reduce((a, k) => a + (unread[k] || 0), 0);

  let th = themes.p1;
  if (screen === 'home') th = page === 1 ? themes.p1 : page === 2 ? themes.p2 : themes.p3;
  else if (screen === 'join' || screen === 'room') th = themes.room;
  else if (screen === 'chat' || screen === 'dm' || screen === 'groups') th = themes.chat;
  else if (screen === 'games' || screen === 'ttt' || screen === 'tdhub' || screen === 'wyr' || screen === 'nhie' || screen === 'quiz') th = themes.p2;
  else if (screen === 'couple' || screen === 'daily' || screen === 'mem' || screen === 'album' || screen === 'notes') th = themes.p3;
  else th = themes.settings;
  if (skin && skins[skin]) th = { ...th, ...skins[skin] };

  const Btn = ({ label, onPress, big }) => (
    <TouchableOpacity style={[s.b, { backgroundColor: th.accent, shadowColor: th.accent }, big ? s.bBig : null]}
      onPress={() => { playSound('click', soundOn); onPress && onPress(); }}>
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
      {[1, 3].map((i) => <View key={i} style={[s.dot, i === n ? { width: 26, backgroundColor: th.accent } : null]} />)}
    </View>
  );
  const myLetterName = profile.name || (currentUser && (currentUser.email || currentUser.name || currentUser.username)) || '';
  const Pic = ({ uri, emoji, size, name, getHd }) => {
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

  const titles = { chat: 'Private Chat 💬', profile: t('profile'), friends: t('friends'), groups: 'Group Chat 👥', games: 'NexGames 🎮', tdhub: 'Truth or Dare Battle 🔥', style: 'Nexstyle ♡', settings: t('settings') };
  const title = screen === 'home' ? (page === 1 ? null : page === 2 ? 'NexGames 🎮' : 'Make it special') : titles[screen] || (screen === 'join' ? 'Join' : null);
  const inChat = screen === 'chat' && !!chatCode;
  const inDm = screen === 'dm';
  const inGame = screen === 'room' && !!room && room.stage === 'game';
  const needUsername = isLoggedIn && !!currentUser && !currentUser.username;
  const friendSeen = dmFriend ? (dmSeen[dmFriend.uid] || 0) : 0;
  const partnerName = chatData && chatData.names && ident ? (Object.keys(chatData.names).filter((k) => k !== ident.sid).map((k) => chatData.names[k])[0] || t('partner')) : t('partner');
  const full = inChat || inDm || inGame || ['profile', 'friends', 'groups', 'style', 'settings', 'couple', 'daily', 'mem', 'album', 'notes', 'wyr', 'nhie', 'quiz'].includes(screen);
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
  const pairGate = (content) => {
    if (!subtle) return <Text style={s.sm}>{t('needBrowserChat')}</Text>;
    if (!pal || palPicking) {
      const fl = Object.keys(cloudFriends).map((k) => cloudFriends[k]);
      return (<>
        <Text style={s.sm}>Kiske saath khelna hai? Apne 💌 Message wale dost me se chuno</Text>
        {fl.length === 0 && <Text style={s.sm}>Abhi koi friend nahi hai. Pehle Message me friend add karo.</Text>}
        <View style={{ width: '100%' }}>
          {fl.map((f) => chatRow({ rowKey: f.uid, uri: pics[f.uid], emoji: f.avatar || '😎', title: f.name || f.username, sub: '@' + f.username, getHd: hdOf(f.uid), onPress: () => choosePal(f) }))}
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
    <Btn label={albumBusy ? 'Ruko...' : '📸 Photo jodo'} onPress={albumAdd} />
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
          <Btn label={t('friends') + (totalUnread ? '  🔴 ' + (totalUnread >= 20 ? '20+' : totalUnread) : '')} onPress={() => { setError(''); setNotice(''); setScreen('friends'); }} />
          <Btn label="💞 Couple Space" onPress={() => goScreen('couple')} />
          <Btn label="🎨 Nexstyle ♡" onPress={() => setScreen('style')} />
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
            <Btn label={t('save')} onPress={() => { saveProfile(profile); setNotice('Profile saved!'); }} />
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {screen === 'style' && (
          <ScrollView contentContainerStyle={sc}>
            <Text style={s.sm}>Theme chuno, har jagah badal jayegi 💞</Text>
            <View style={s.miniRow}>
              {Object.keys(skins).map((k) => <Mini key={k} label={(skin === k ? '✅ ' : '') + skins[k].name} onPress={() => { setSkin(k); localStorage.setItem('nexdare_skin', k); }} />)}
              <Mini label="Auto" onPress={() => { setSkin(''); localStorage.removeItem('nexdare_skin'); }} />
            </View>
            <Text style={s.sm}>Apni photo (profile aur chats me dikhegi)</Text>
            <Pic uri={myPhoto} emoji={profile.avatar} size={70} name={myLetterName} getHd={myPhotoHd ? async () => myPhotoHd : undefined} />
            <Mini label="📷 Apni photo lagao" onPress={() => pickPhoto('me')} />
            <Text style={s.sm}>Background photo (poori app me)</Text>
            <View style={s.miniRow}>
              <Mini label="🖼️ Background lagao" onPress={() => pickPhoto('bg')} />
              {!!bgPhoto && <Mini label="Hatao" onPress={() => { setBgPhoto(''); localStorage.removeItem('nexdare_bgphoto'); }} />}
            </View>
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {screen === 'friends' && (
          <ScrollView contentContainerStyle={sc}>
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
                          rowKey: f.uid, uri: pics[f.uid], emoji: f.avatar || '😎', title: f.name || f.username,
                          sub: pv ? (pv.mine ? 'You: ' : '') + pv.text : '@' + f.username,
                          time: pv ? fmtListTime(pv.t) : '', badge: un,
                          onPress: () => openDm(f), onMore: () => setFriendMenu(friendMenu === f.uid ? null : f.uid),
                          getHd: hdOf(f.uid), online: isOnline(presMap[f.uid]),
                        })}
                        {friendMenu === f.uid && (
                          <View style={s.miniRow}>
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
            <TextInput style={s.i} placeholder="Naye group ka naam" placeholderTextColor={PH} value={grpNewName} onChangeText={setGrpNewName} />
            <Btn label="➕ Group banao" onPress={createGroup} />
            <TextInput style={s.i} placeholder="Group code" placeholderTextColor={PH} autoCapitalize="none" value={grpJoinCode} onChangeText={setGrpJoinCode} />
            <Btn label="🔑 Group join karo" onPress={joinGroup} />
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
            <TouchableOpacity style={{ flex: 1, marginLeft: 10 }} onPress={() => { setGrpInfo(!grpInfo); setGrpConfirm(''); }}>
              <Text numberOfLines={1} style={[s.code2, { color: th.accent2, marginBottom: 0, fontSize: 20 }]}>{grp.name}</Text>
              <Text style={s.cardS}>{Object.keys(grpMembers).length} members{(() => { const n = Object.keys(grpMembers).filter((u) => (u === myUid ? true : isOnline(presMap[u]))).length; return n ? ' • ' + n + ' online' : ''; })()} • info ke liye tap karo</Text>
            </TouchableOpacity>
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
          <ScrollView ref={grpScrollRef} style={s.msgBox} onContentSizeChange={() => grpScrollRef.current && grpScrollRef.current.scrollToEnd({ animated: true })}>
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
              <Text style={[s.code2, { color: th.accent2, marginBottom: 0 }]}>{(dmProf && dmProf.name) || dmFriend.name || dmFriend.username}</Text>
              {!!presText(presMap[dmFriend.uid]) && <Text style={[s.cardS, isOnline(presMap[dmFriend.uid]) ? { color: '#25d366' } : null]}>{presText(presMap[dmFriend.uid])}</Text>}
            </View>
            {!!dmShared && <TouchableOpacity style={s.attachBtn} onPress={startDmCall}><Text style={s.bt}>📹</Text></TouchableOpacity>}
            <TouchableOpacity style={s.attachBtn} onPress={() => setDmMenu(dmMenu ? '' : 'menu')}><Text style={s.bt}>⋮</Text></TouchableOpacity>
          </View>
          {!!dmMenu && (
            <View style={s.miniRow}>
              {dmMenu === 'report' ? (<>
                <Mini label="Spam" onPress={() => reportUser('Spam')} />
                <Mini label="Abuse" onPress={() => reportUser('Abuse')} />
                <Mini label="Fake account" onPress={() => reportUser('Fake account')} />
              </>) : (<>
                <Mini label={dmMenu === 'blockConfirm' ? 'Pakka block?' : '🚫 Block'} onPress={() => (dmMenu === 'blockConfirm' ? blockUser(dmFriend) : setDmMenu('blockConfirm'))} />
                <Mini label="⚠️ Report" onPress={() => setDmMenu('report')} />
              </>)}
              <Mini label={t('cancel')} onPress={() => setDmMenu('')} />
            </View>
          )}
          <Text style={s.sm}>{dmShared ? t('e2e') + dmShared.safety : !ident ? '⏳ Key ban rahi hai...' : !dmPubStr ? '⏳ Friend ki encryption key abhi nahi mili. Unhe site kholkar Message screen par aane ko bolo.' : '⚠️ Encryption key match nahi hui'}</Text>
          <ScrollView ref={dmScrollRef} style={s.msgBox} onContentSizeChange={() => dmScrollRef.current && dmScrollRef.current.scrollToEnd({ animated: true })}>
            {dmVisible.length === 0 && <Text style={s.sm}>{t('noMsg')}</Text>}
            {dmVisible.map((m) => {
              const mine = myUid && m.from === myUid;
              const sel = dmSel && dmSel.key === m.key;
              const data = m.file ? dmImgs[m.file.id] : null;
              return (
                <TouchableOpacity key={m.key} onPress={() => setDmSel(sel ? null : m)}
                  style={[s.bubble, mine ? [s.mine, { backgroundColor: th.accent }] : s.theirs, sel ? s.selBubble : null]}>
                  <Text style={s.bname}>{mine ? t('you') : (dmFriend.name || dmFriend.username)}</Text>
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
          <View style={s.sendRow}>
            <TouchableOpacity style={s.attachBtn} onPress={pickDmFile}><Text style={s.bt}>📎</Text></TouchableOpacity>
            <TouchableOpacity style={s.attachBtn} onPress={recording ? stopRec : startRec}><Text style={s.bt}>{recording ? '⏹' : '🎤'}</Text></TouchableOpacity>
            <TextInput style={s.msgInput} placeholder={t('msgPlaceholder')} placeholderTextColor={PH} value={dmText} onChangeText={setDmText} onSubmitEditing={sendDm} />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendDm}><Text style={s.bt}>{editing ? '✓' : '➤'}</Text></TouchableOpacity>
          </View>
          <Nav label={t('back')} onPress={leaveDm} />
        </>) : (<>
          <Text style={s.sm}>{t('needBrowserChat')}</Text>
          <Nav label={t('back')} onPress={leaveDm} />
        </>))}

        {screen === 'settings' && (
          <ScrollView contentContainerStyle={sc}>
            <View style={s.setRow}>
              <Text style={[s.sm, { marginRight: 12 }]}>{t('sound')}</Text>
              <Switch value={soundOn} onValueChange={(v) => { setSoundOn(v); localStorage.setItem('nexdare_sound', v ? '1' : '0'); }} />
            </View>
            <View style={s.setRow}>
              <Text style={[s.sm, { marginRight: 12 }]}>{t('notifications')}</Text>
              <Switch value={notifOn} onValueChange={(v) => { if (v) requestNotif(); else { setNotifOn(false); localStorage.setItem('nexdare_notif', '0'); } }} />
            </View>
            <View style={s.setRow}>
              <Text style={[s.sm, { marginRight: 12 }]}>Last seen / online dikhao</Text>
              <Switch value={showSeen} onValueChange={toggleSeen} />
            </View>
            <Nav label={'🌐 All languages: ' + ((LANGS.find((l) => l[0] === uiLang) || [0, 'English'])[1]) + (langOpen ? '  ▴' : '  ▾')} onPress={() => setLangOpen(!langOpen)} />
            {langOpen && (
              <View style={s.miniRow}>
                {LANGS.map((l) => <Mini key={l[0]} label={(uiLang === l[0] ? '✅ ' : '') + l[1]} onPress={() => { changeLang(l[0]); setLangOpen(false); }} />)}
              </View>
            )}
            <Text style={s.sm}>🛡️ Safety</Text>
            {Object.keys(blocks).length > 0 && (<>
              <Text style={s.sm}>Blocked users:</Text>
              {Object.keys(blocks).map((k) => (
                <View key={k} style={s.miniRow}>
                  <Text style={[s.sm, { alignSelf: 'center', marginRight: 8 }]}>@{blocks[k].username}</Text>
                  <Mini label="Unblock" onPress={() => unblockUser(k)} />
                </View>
              ))}
            </>)}
            <Nav label="📤 App share karo" onPress={shareApp} />
            <Nav label="📄 Privacy Policy" onPress={() => Linking.openURL('https://dandelion-metal-55e.notion.site/Nexdare-Privacy-Policy-41dab7c3e245804aaa46ef40d4cc356e')} />
            {!delConfirm ? <Nav label="🗑️ Account delete" onPress={() => setDelConfirm(true)} /> : (<>
              <Text style={s.sm}>Pakka? Aapka account aur data hamesha ke liye delete ho jayega.</Text>
              <Btn label="Haan, delete karo" onPress={deleteAccount} />
              <Nav label={t('cancel')} onPress={() => setDelConfirm(false)} />
            </>)}
            <Btn label={t('logout')} onPress={logout} />
            {!showClearConfirm ? <Btn label={t('clearData')} onPress={() => setShowClearConfirm(true)} /> : (<>
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
      {!!viewer && (
        <TouchableOpacity activeOpacity={1} onPress={() => setViewer(null)} style={s.viewerBg}>
          <RNImage source={{ uri: viewerHd && viewerHd !== 'none' ? viewerHd : viewer.uri }} style={s.viewerImg} resizeMode="contain" />
          {!!viewer.getHd && viewerHd === '' && <Text style={s.sm}>HD load ho rahi hai...</Text>}
          <Text style={s.viewerClose}>✕  Band karo</Text>
        </TouchableOpacity>
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
  msgInput: { flex: 1, backgroundColor: '#ffffff18', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, color: '#fff', fontSize: 15, marginRight: 8 },
  attachBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff18', marginRight: 6 },
  dmPic: { width: 220, height: 220, borderRadius: 12, marginBottom: 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#ffffff12', borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 1 },
  cardT: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardS: { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeT: { color: '#fff', fontSize: 12, fontWeight: '800' },
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
