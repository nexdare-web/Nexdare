import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  Linking, ScrollView, Platform, Share, Image as RNImage, Switch
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
    next: 'Next ›', back: '‹ Back', chat: '💬 Private Chat',
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
    clearData: '🗑️ Clear Data', profile: '👤 Profile', friends: '👥 NexAmore ♡', settings: '⚙️ Settings',
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

  const t = (key) => translations.en[key] || key;
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
        const small = await new Promise((res, rej) => {
          const img = new window.Image();
          img.onload = () => {
            const max = which === 'me' ? 120 : 800;
            const sc = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            res(c.toDataURL('image/jpeg', which === 'me' ? 0.6 : 0.5));
          };
          img.onerror = () => rej(new Error('Photo khul nahi payi'));
          img.src = du;
        });
        if (which === 'me') {
          setMyPhoto(small); localStorage.setItem('nexdare_myphoto', small);
          if (currentUser && currentUser.username) update(ref(db, 'profiles/' + currentUser.uid), { photo: small }).catch(() => {});
        } else { setBgPhoto(small); localStorage.setItem('nexdare_bgphoto', small); }
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
  const leaveDm = () => { setDmFriend(null); setDmShared(null); setDmPlain([]); setDmRaw({}); setDmSel(null); setEditing(null); setError(''); setNotice(''); setScreen('friends'); };

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
    const u2 = onValue(ref(db, 'friendReqs/' + uid), (snap) => setFriendReqs(snap.val() || {}));
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
          const v = await call('GET', 'dm/' + f.chatId + '/messages', undefined, 'orderBy=%22%24key%22&limitToLast=1');
          const m = v ? v[Object.keys(v)[0]] : null;
          if (!m) { if (lastNotif.current[f.chatId] === undefined) lastNotif.current[f.chatId] = 0; continue; }
          const prev = lastNotif.current[f.chatId];
          lastNotif.current[f.chatId] = m.t;
          if (prev !== undefined && m.t > prev && m.from !== currentUser.uid) {
            playSound('msg', soundOn);
            const hiddenTab = typeof document !== 'undefined' && document.hidden;
            if (hiddenTab || !(dmFriend && dmFriend.chatId === f.chatId)) showNotif('NexAmore ♡', (f.name || f.username) + ' ne message bheja 💌', notifOn);
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
    setPage(2); setScreen('home');
  };
  const choose = (side) => update(roomRef(), { pick: side, result: null });
  const flip = () => {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    update(roomRef(), { result, asker: result === room.pick ? 'P1' : 'P2' });
    playSound('success', soundOn);
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
      ['nexdare_id_v1', 'nexdare_profile', 'nexdare_sound', 'nexdare_notif', 'nexdare_user', 'nexdare_skin', 'nexdare_myphoto', 'nexdare_bgphoto'].forEach((k) => localStorage.removeItem(k));
      clearAuthTokens();
      Object.keys(localStorage).forEach((k) => { if (k.startsWith('nexdare_hidden_') || k.startsWith('nexdare_dmhidden_')) localStorage.removeItem(k); });
      sessionIdentity = null;
      setProfile({ name: '', bio: '', avatar: '😎' });
      setSkin(''); setMyPhoto(''); setBgPhoto('');
      setSoundOn(true); setNotifOn(false); setIsLoggedIn(false); setCurrentUser(null);
      setShowClearConfirm(false); setNotice(t('dataCleared'));
    } catch (e) { setError('Clear failed: ' + e.message); }
  };
  const requestNotif = async () => {
    if (typeof Notification === 'undefined') { setNotice('Notifications not supported'); return; }
    const perm = await Notification.requestPermission();
    const on = perm === 'granted';
    setNotifOn(on); localStorage.setItem('nexdare_notif', on ? '1' : '0');
    if (on) showNotif('NexAmore ♡', 'Notifications ON ho gayi!', true);
  };

  // ===== PART 2 END. Neeche Part 3 paste karo (const Btn se shuru) =====
  const visible = plain.filter((m) => !hidden.includes(m.key));
  const dmVisible = dmPlain.filter((m) => !dmHidden.includes(m.key));
  const myId = ident ? ident.sid : null;
  const myUid = currentUser ? currentUser.uid : null;

  let th = themes.p1;
  if (screen === 'home') th = page === 1 ? themes.p1 : page === 2 ? themes.p2 : themes.p3;
  else if (screen === 'join' || screen === 'room') th = themes.room;
  else if (screen === 'chat' || screen === 'dm') th = themes.chat;
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
      {[1, 2, 3].map((i) => <View key={i} style={[s.dot, i === n ? { width: 26, backgroundColor: th.accent } : null]} />)}
    </View>
  );
  const Pic = ({ uri, emoji, size }) => uri
    ? <RNImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    : <Text style={{ fontSize: size * 0.8 }}>{emoji}</Text>;
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
      return (<>
        <Text style={s.sm}>{t('youAre')} {me}</Text>
        {me === 'P1' && !room.result && (<>
          <Text style={s.bt}>{t('chooseSide')}</Text>
          <Btn label={(room.pick === 'Heads' ? '✅ ' : '') + 'Heads'} onPress={() => choose('Heads')} />
          <Btn label={(room.pick === 'Tails' ? '✅ ' : '') + 'Tails'} onPress={() => choose('Tails')} />
          {room.pick && <Btn label={t('flip')} onPress={flip} />}
        </>)}
        {me === 'P2' && !room.result && <Text style={s.bt}>{t('waitingFlip')}</Text>}
        {room.result && (<>
          <Text style={s.t}>{t('result')} {room.result}</Text>
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

  const titles = { chat: 'Private Chat 💬', profile: t('profile'), friends: t('friends'), style: 'Nexstyle ♡', settings: t('settings') };
  const title = screen === 'home' ? (page === 1 ? null : page === 2 ? 'Let the battle begin' : 'Make it special') : titles[screen] || (screen === 'join' ? 'Join' : null);
  const inChat = screen === 'chat' && !!chatCode;
  const inDm = screen === 'dm';
  const inGame = screen === 'room' && !!room && room.stage === 'game';
  const needUsername = isLoggedIn && !!currentUser && !currentUser.username;
  const friendSeen = dmFriend ? (dmSeen[dmFriend.uid] || 0) : 0;
  const partnerName = chatData && chatData.names && ident ? (Object.keys(chatData.names).filter((k) => k !== ident.sid).map((k) => chatData.names[k])[0] || t('partner')) : t('partner');
  const full = inChat || inDm || inGame || ['profile', 'friends', 'style', 'settings'].includes(screen);
  const sc = { alignItems: 'center', paddingBottom: 40, width: '100%' };
  const PH = '#ffffff88';

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
        {!!title && !full && <Text style={screen === 'home' ? s.tStyled : s.t}>{title}</Text>}

        {screen === 'home' && page === 1 && (<>
          <Text style={[s.welcome, { color: th.accent2 }]}>{t('welcome')}</Text>
          <View style={[s.rule, { backgroundColor: th.accent }]} />
          <Text style={[s.logo, { color: th.accent2, textShadowColor: th.accent }]}>Nexdare</Text>
          <Btn big label={t('start')} onPress={() => setPage(2)} />
          {dots(1)}
        </>)}

        {screen === 'home' && page === 2 && (<>
          <View style={s.sideRow}>
            <TouchableOpacity style={[s.b, s.bHalf, { backgroundColor: th.accent, shadowColor: th.accent }]} onPress={() => { playSound('click', soundOn); createRoom(); }}>
              <Text style={[s.bt, { textAlign: 'center' }]}>{t('createRoom')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.b, s.bHalf, { backgroundColor: th.accent, shadowColor: th.accent }]} onPress={() => { playSound('click', soundOn); setError(''); setScreen('join'); }}>
              <Text style={[s.bt, { textAlign: 'center' }]}>{t('joinRoom')}</Text>
            </TouchableOpacity>
          </View>
          <View style={s.sideRow}>
            <View style={{ marginHorizontal: 14 }}><Nav label={t('back')} onPress={() => setPage(1)} /></View>
            <View style={{ marginHorizontal: 14 }}><Nav label={t('next')} onPress={() => setPage(3)} /></View>
          </View>
          {dots(2)}
        </>)}

        {screen === 'home' && page === 3 && (<>
          <Btn label={t('chat')} onPress={() => { setError(''); setNotice(''); setScreen('chat'); }} />
          <Btn label={t('friends')} onPress={() => { setError(''); setNotice(''); setScreen('friends'); }} />
          <Btn label="🎨 Nexstyle ♡" onPress={() => setScreen('style')} />
          <Btn label={t('profile')} onPress={() => setScreen('profile')} />
          <Btn label={t('settings')} onPress={() => setScreen('settings')} />
          <Nav label={t('back')} onPress={() => setPage(2)} />
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
            {!!shared && <Mini label={t('videoCall')} onPress={startChatCall} />}
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
            <Pic uri={myPhoto} emoji={profile.avatar} size={90} />
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
            <Pic uri={myPhoto} emoji={profile.avatar} size={70} />
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
                    <Text style={[s.cardT, { color: th.accent2 }]}>{(r.avatar || '😎') + ' ' + (r.name || r.username)}</Text>
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
            {Object.keys(cloudFriends).length === 0 ? <Text style={s.sm}>{t('noFriends')}</Text> : Object.keys(cloudFriends).map((k) => {
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
            })}
            <Nav label={t('back')} onPress={() => setScreen('home')} />
          </ScrollView>
        )}

        {screen === 'dm' && dmFriend && (subtle ? (<>
          <View style={s.dmHead}>
            <Pic uri={dmProf && dmProf.photo} emoji={dmFriend.avatar || '😎'} size={40} />
            <Text style={[s.code2, { color: th.accent2, marginLeft: 10, marginBottom: 0 }]}>{(dmProf && dmProf.name) || dmFriend.name || dmFriend.username}</Text>
          </View>
          <Text style={s.sm}>{dmShared ? t('e2e') + dmShared.safety : !ident ? '⏳ Key ban rahi hai...' : !dmPubStr ? '⏳ Friend ki encryption key abhi nahi mili. Unhe site kholkar NexAmore screen par aane ko bolo.' : '⚠️ Encryption key match nahi hui'}</Text>
          <View style={s.miniRow}>{!!dmShared && <Mini label={t('videoCall')} onPress={startDmCall} />}</View>
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
  dmHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sendRow: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 8 },
  msgInput: { flex: 1, backgroundColor: '#ffffff18', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16, color: '#fff', fontSize: 15, marginRight: 8 },
  attachBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff18', marginRight: 6 },
  dmPic: { width: 220, height: 220, borderRadius: 12, marginBottom: 6 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#ffffff12', borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 1 },
  cardT: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardS: { color: '#ffffffaa', fontSize: 13, lineHeight: 18 },
});
