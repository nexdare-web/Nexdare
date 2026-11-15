import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Linking, ScrollView } from 'react-native';

// ---- Firebase Realtime Database (bina library, REST se) ----
const DB_URL = 'https://truthdare-battle-d81c8-default-rtdb.asia-southeast1.firebasedatabase.app';
const db = null;
const ref = (_db, path) => ({ path });
const listeners = new Set();
const pollAll = () => listeners.forEach((f) => f());

const call = async (method, path, body) => {
  const res = await fetch(DB_URL + '/' + path + '.json', {
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
const get = async (r) => {
  const val = await call('GET', r.path);
  return { exists: () => val !== null, val: () => val };
};
const onValue = (r, cb) => {
  let stopped = false;
  const poll = async () => {
    try {
      const val = await call('GET', r.path);
      if (!stopped) cb({ val: () => val });
    } catch (e) {}
  };
  listeners.add(poll);
  poll();
  const timer = setInterval(poll, 1000);
  return () => { stopped = true; clearInterval(timer); listeners.delete(poll); };
};
// -------------------------------------------------------------

const themes = {
  p1: { bg: '#2b0a1d', accent: '#ff3d7f', accent2: '#ffc2d6', glow: '#ff3d7f', glow2: '#7a1450', e: ['💖', '🌹', '✨'] },
  p2: { bg: '#150f3a', accent: '#8b6bff', accent2: '#d3c7ff', glow: '#8b6bff', glow2: '#ff4fa3', e: ['💜', '🌙', '✨'] },
  p3: { bg: '#33130f', accent: '#ff8a4c', accent2: '#ffd0b0', glow: '#ff8a4c', glow2: '#c2185b', e: ['🌅', '🧡', '✨'] },
  room: { bg: '#2d0b12', accent: '#ff4458', accent2: '#ffc1c8', glow: '#ff4458', glow2: '#6a0f2d', e: ['🔥', '💥', '💘'] },
  adlax: { bg: '#062a33', accent: '#2ed0c4', accent2: '#b8f5ef', glow: '#2ed0c4', glow2: '#1e6fd9', e: ['🔎', '🌊', '✨'] },
  call: { bg: '#24102f', accent: '#d85cf0', accent2: '#f3c9fb', glow: '#d85cf0', glow2: '#5b2fd6', e: ['📹', '💫', '💜'] },
  chat: { bg: '#102338', accent: '#f08fa0', accent2: '#ffd9de', glow: '#f08fa0', glow2: '#2f6fb3', e: ['💬', '🌙', '💌'] },
};

const truths = [
  'Tera sabse bada darr kya hai?',
  'Aakhri jhooth kya bola tha aur kisse?',
  'Tera sabse embarrassing moment kaunsa tha?',
  'Phone mein sabse ajeeb photo kaunsi hai?',
  'Kis cheez ke liye tu sabse zyada paise kharch karta hai?',
];
const dares = [
  'Ek funny face banao aur 10 second hold karo.',
  'Ek gaana 15 second tak gao.',
  'Apna best filmy dialogue bolke dikhao.',
  '10 pushups karo.',
  '30 second bina hase raho.',
];
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const cleanHtml = (t) =>
  t.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

export default function App() {
  const [page, setPage] = useState(1);
  const [screen, setScreen] = useState('home');
  const [role, setRole] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [room, setRoom] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');
  const [query, setQuery] = useState('');
  const [incognito, setIncognito] = useState(false);
  const [history, setHistory] = useState([]);
  const [lang, setLang] = useState('en');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [detail, setDetail] = useState(null);
  const [callCode, setCallCode] = useState('');
  const [callJoin, setCallJoin] = useState('');
  const [chatCode, setChatCode] = useState(null);
  const [chatJoin, setChatJoin] = useState('');
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [nick] = useState(() => 'Player' + Math.floor(10 + Math.random() * 90));
  const [sid] = useState(() => randomId());
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!roomCode) return;
    const unsub = onValue(ref(db, 'rooms/' + roomCode), (snap) => setRoom(snap.val()));
    return () => unsub();
  }, [roomCode]);

  useEffect(() => {
    if (!chatCode) return;
    const unsub = onValue(ref(db, 'chats/' + chatCode + '/messages'), (snap) => {
      const v = snap.val() || {};
      const arr = Object.keys(v).map((k) => ({ key: k, ...v[k] }));
      arr.sort((a, b) => a.t - b.t);
      setMessages(arr.slice(-30));
    });
    return () => unsub();
  }, [chatCode]);

  let th = themes.p1;
  if (screen === 'home') th = page === 1 ? themes.p1 : page === 2 ? themes.p2 : themes.p3;
  else if (screen === 'join' || screen === 'room') th = themes.room;
  else if (screen === 'adlax') th = themes.adlax;
  else if (screen === 'videocall') th = themes.call;
  else if (screen === 'chat') th = themes.chat;

  const Btn = ({ label, onPress, big }) => (
    <TouchableOpacity
      style={[s.b, { backgroundColor: th.accent, shadowColor: th.accent }, big ? s.bBig : null]}
      onPress={onPress}
    >
      <Text style={[s.bt, big ? s.btBig : null]}>{label}</Text>
    </TouchableOpacity>
  );
  const Nav = ({ label, onPress }) => (
    <TouchableOpacity style={[s.nav, { borderColor: th.accent + '88' }]} onPress={onPress}>
      <Text style={[s.navt, { color: th.accent2 }]}>{label}</Text>
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

  const freshCode = async (base) => {
    for (let i = 0; i < 6; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const snap = await get(ref(db, base + code));
      if (!snap.exists()) return code;
    }
    throw new Error('Code nahi ban paya, dobara try karo');
  };

  const createRoom = async () => {
    try {
      const code = await freshCode('rooms/');
      await set(ref(db, 'rooms/' + code), {
        stage: 'lobby', p2: false, scores: { P1: 0, P2: 0 }, callId: 'tdb' + randomId(),
      });
      setError(''); setRole('P1'); setRoom(null); setRoomCode(code); setScreen('room');
    } catch (e) { setError('Error: ' + e.message); }
  };

  const joinRoom = async () => {
    try {
      const code = joinCode.trim();
      const snap = await get(ref(db, 'rooms/' + code));
      if (!snap.exists()) { setError('Room nahi mila, code check karo'); return; }
      if (snap.val().p2) { setError('Room full hai'); return; }
      await update(ref(db, 'rooms/' + code), { p2: true, stage: 'flip' });
      setError(''); setRole('P2'); setRoom(null); setRoomCode(code); setScreen('room');
    } catch (e) { setError('Error: ' + e.message); }
  };

  const leave = () => {
    setRoomCode(null); setRoom(null); setRole(null);
    setJoinCode(''); setError(''); setCustomMode(false); setCustomText('');
    setPage(2); setScreen('home');
  };

  const choose = (side) => update(roomRef(), { pick: side, result: null });
  const flip = () => {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    update(roomRef(), { result, asker: result === room.pick ? 'P1' : 'P2' });
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
      asker: answerer,
    });
  };
  const endGame = () => update(roomRef(), { stage: 'end' });

  const backToTools = () => { setError(''); setDetail(null); setPage(3); setScreen('home'); };

  const doSearch = async (q) => {
    const text = (q !== undefined ? q : query).trim();
    if (!text) return;
    setQuery(text);
    if (!incognito) setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 5));
    setSearching(true); setSearched(true); setError('');
    try {
      const res = await fetch(
        'https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&srlimit=8&format=json&origin=*&srsearch=' +
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
      const res = await fetch(
        'https://' + lang + '.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&pageids=' +
          r.id
      );
      const data = await res.json();
      const p = data.query.pages[r.id];
      setDetail({ id: r.id, title: r.title, text: (p && p.extract) || 'Is page ka summary nahi mila.' });
    } catch (e) {
      setDetail({ id: r.id, title: r.title, text: 'Load nahi ho paya: ' + e.message });
    }
  };

  const openCall = (code) => {
    if (!code) { setError('Pehle call code daalo'); return; }
    setError('');
    Linking.openURL('https://meet.jit.si/nexdare-' + code.toLowerCase());
  };

  const createChat = async () => {
    try {
      const code = await freshCode('chats/');
      await set(ref(db, 'chats/' + code), { created: Date.now() });
      setError(''); setMessages([]); setChatCode(code);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const joinChat = async () => {
    try {
      const code = chatJoin.trim();
      const snap = await get(ref(db, 'chats/' + code));
      if (!snap.exists()) { setError('Chat nahi mila, code check karo'); return; }
      setError(''); setMessages([]); setChatCode(code);
    } catch (e) { setError('Error: ' + e.message); }
  };
  const leaveChat = () => {
    setChatCode(null); setMessages([]); setChatJoin(''); setMsgText('');
    setError(''); setPage(3); setScreen('home');
  };
  const sendMsg = async () => {
    const text = msgText.trim();
    if (!text) return;
    setMsgText('');
    try {
      await push(ref(db, 'chats/' + chatCode + '/messages'), { sid, name: nick, text, t: Date.now() });
    } catch (e) { setError('Error: ' + e.message); }
  };  const renderRoom = () => {
    if (!room) return <Text style={s.bt}>Loading...</Text>;
    const me = role;
    const callBtn = room.callId ? (
      <Btn label="📹 Video Call" onPress={() => Linking.openURL('https://meet.jit.si/' + room.callId)} />
    ) : null;

    if (room.stage === 'lobby') {
      return (
        <>
          <Text style={s.bt}>Room code:</Text>
          <Text style={[s.code, { color: th.accent2 }]}>{roomCode}</Text>
          <Text style={s.sm}>Ye code apne partner ko bhejo, uska wait ho raha hai... ⏳</Text>
          <Nav label="Back" onPress={leave} />
        </>
      );
    }

    if (room.stage === 'flip') {
      return (
        <>
          <Text style={s.sm}>Tu {me} hai</Text>
          {me === 'P1' && !room.result && (
            <>
              <Text style={s.bt}>Apna side chuno 🪙</Text>
              <Btn label={(room.pick === 'Heads' ? '✅ ' : '') + 'Heads'} onPress={() => choose('Heads')} />
              <Btn label={(room.pick === 'Tails' ? '✅ ' : '') + 'Tails'} onPress={() => choose('Tails')} />
              {room.pick && <Btn label="Sikka Uchhalo!" onPress={flip} />}
            </>
          )}
          {me === 'P2' && !room.result && (
            <Text style={s.bt}>P1 sikka uchhalne wala hai... 🪙{room.pick ? ' (P1 ne ' + room.pick + ' chuna)' : ''}</Text>
          )}
          {room.result && (
            <>
              <Text style={s.t}>Result: {room.result}</Text>
              <Text style={s.bt}>{room.asker} pehla sawal puchhega 🎉</Text>
              {me === 'P1' && <Btn label="Battle Shuru!" onPress={startBattle} />}
              {me === 'P2' && <Text style={s.sm}>P1 battle shuru karega...</Text>}
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
        <>
          <Text style={s.sm}>Tu {me} hai</Text>
          <Text style={s.bt}>P1: {room.scores.P1}   |   P2: {room.scores.P2}</Text>
          <Text style={s.sm}>{room.asker} puchh raha hai, {answerer} jawab dega</Text>

          {!room.question && (iAsk ? (
            customMode ? (
              <>
                <TextInput style={s.i2} placeholder="Apna sawal ya dare likho"
                  value={customText} onChangeText={setCustomText} multiline />
                <Btn label="Bhejo 🚀" onPress={sendCustom} />
                <Nav label="Cancel" onPress={() => setCustomMode(false)} />
              </>
            ) : (
              <>
                <Btn label="Truth 💭" onPress={() => ask('Truth')} />
                <Btn label="Dare 😈" onPress={() => ask('Dare')} />
                <Btn label="📝 Apna sawal likho" onPress={() => setCustomMode(true)} />
              </>
            )
          ) : (
            <Text style={s.sm}>{room.asker} sawal chun raha hai... ⏳</Text>
          ))}

          {room.question && (
            <>
              <Text style={[s.q, { color: th.accent2 }]}>{room.question.kind}: {room.question.text}</Text>
              {iAsk ? (
                <>
                  <Btn label="Kar diya / Bata diya (+1) ✅" onPress={() => judge(1)} />
                  <Btn label="Nahi kar paya (-1) ❌" onPress={() => judge(-1)} />
                </>
              ) : (
                <Text style={s.sm}>Jawab do ya kar dikhao! {room.asker} faisla karega.</Text>
              )}
            </>
          )}

          {callBtn}
          <Nav label="End Game" onPress={endGame} />
        </>
      );
    }

    return (
      <>
        <Text style={s.t}>Game Khatam 🏁</Text>
        <Text style={s.bt}>P1: {room.scores.P1}   |   P2: {room.scores.P2}</Text>
        <Text style={[s.q, { color: th.accent2 }]}>
          {room.scores.P1 > room.scores.P2 ? 'P1 jeeta! 🏆' : room.scores.P2 > room.scores.P1 ? 'P2 jeeta! 🏆' : 'Draw! 🤝'}
        </Text>
        <Btn label="Naya Game" onPress={leave} />
      </>
    );
  };

  let title = 'Nexdare 💘';
  if (screen === 'adlax') title = 'Adlax 🔎';
  else if (screen === 'videocall') title = 'Video Call 📹';
  else if (screen === 'chat') title = 'Msg 💬';
  else if (screen === 'home') title = page === 1 ? null : page === 2 ? 'Takraar ya Pyaar? 💘' : 'Aur bhi Masti ✨';
  const inChat = screen === 'chat' && !!chatCode;
  const inAdlax = screen === 'adlax';

  return (
    <View style={[s.c, { backgroundColor: th.bg }, inChat || inAdlax ? s.cTop : null]}>
      <View pointerEvents="none" style={[s.glow, { top: -90, right: -70, backgroundColor: th.glow }]} />
      <View pointerEvents="none" style={[s.glow2, { bottom: -110, left: -80, backgroundColor: th.glow2 }]} />
      {!inChat && (
        <View pointerEvents="none" style={s.floatWrap}>
          <Text style={[s.floaty, { top: 70, left: 22, fontSize: 30 }]}>{th.e[0]}</Text>
          <Text style={[s.floaty, { top: 150, right: 24, fontSize: 24 }]}>{th.e[1]}</Text>
          <Text style={[s.floaty, { bottom: 80, right: 28, fontSize: 34 }]}>{th.e[2]}</Text>
          <Text style={[s.floaty, { bottom: 150, left: 22, fontSize: 24 }]}>{th.e[0]}</Text>
        </View>
      )}

      {!!title && !inChat && <Text style={inAdlax ? s.tSmall : s.t}>{title}</Text>}

      {screen === 'home' && page === 1 && (
        <>
          <Text style={s.heroHeart}>💞</Text>
          <Text style={[s.logo, { color: th.accent2, textShadowColor: th.accent }]}>Nexdare</Text>
          <Text style={[s.tag, { color: th.accent2 }]}>Pyaar ho ya takraar,{'\n'}jeet kiski hogi? 😏</Text>
          <View style={s.chipRow}>
            {['Truth', 'Dare', 'Video Call', 'Msg'].map((c) => (
              <View key={c} style={[s.chip, { borderColor: th.accent + '88' }]}>
                <Text style={[s.chipT, { color: th.accent2 }]}>{c}</Text>
              </View>
            ))}
          </View>
          <Btn big label="💘 Start" onPress={() => setPage(2)} />
          {dots(1)}
        </>
      )}

      {screen === 'home' && page === 2 && (
        <>
          <Text style={s.sm}>Room banao, code bhejo aur dekho kaun pehle haar maanta hai 😉</Text>
          <Btn label="💕 Room Banao" onPress={createRoom} />
          <Btn label="🔑 Room Join Karo" onPress={() => { setError(''); setScreen('join'); }} />
          <Nav label="Aage  →  Tools" onPress={() => setPage(3)} />
          <Nav label="←  Peeche" onPress={() => setPage(1)} />
          {dots(2)}
        </>
      )}

      {screen === 'home' && page === 3 && (
        <>
          <Text style={s.sm}>Search, video call aur chat, sab ek jagah 💌</Text>
          <Btn label="🔎 Adlax" onPress={() => { setError(''); setScreen('adlax'); }} />
          <Btn label="📹 Video Call" onPress={() => { setError(''); setScreen('videocall'); }} />
          <Btn label="💬 Msg" onPress={() => { setError(''); setScreen('chat'); }} />
          <Nav label="←  Peeche" onPress={() => setPage(2)} />
          {dots(3)}
        </>
      )}

      {screen === 'join' && (
        <>
          <TextInput style={s.i} placeholder="Room code daalo" keyboardType="number-pad"
            value={joinCode} onChangeText={setJoinCode} />
          <Btn label="Join" onPress={joinRoom} />
          <Nav label="Back" onPress={leave} />
        </>
      )}

      {screen === 'room' && renderRoom()}      {inAdlax && (detail ? (
        <>
          <ScrollView style={s.msgBox}>
            <Text style={[s.q, { color: th.accent2 }]}>{detail.title}</Text>
            <Text style={s.btext}>{detail.text}</Text>
            <Text style={s.sm}>Source: Wikipedia</Text>
          </ScrollView>
          <Btn
            label="🌐 Poora padho"
            onPress={() => Linking.openURL('https://' + lang + '.wikipedia.org/?curid=' + detail.id)}
          />
          <Nav label="←  Results" onPress={() => setDetail(null)} />
        </>
      ) : (
        <>
          <TextInput style={s.i2} placeholder="Kuch bhi search karo..."
            value={query} onChangeText={setQuery} onSubmitEditing={() => doSearch()} />
          <Btn label="Search" onPress={() => doSearch()} />
          <Nav
            label={'🌐 Bhasha: ' + (lang === 'en' ? 'English' : 'Hindi')}
            onPress={() => setLang((l) => (l === 'en' ? 'hi' : 'en'))}
          />
          <Nav
            label={incognito ? '🔒 Incognito: ON' : '🔒 Incognito: OFF'}
            onPress={() => setIncognito((v) => !v)}
          />
          <ScrollView style={s.msgBox}>
            {searching && <Text style={s.sm}>Dhoondh raha hu...</Text>}
            {!searching && searched && results.length === 0 && <Text style={s.sm}>Kuch nahi mila 😕</Text>}
            {results.map((r) => (
              <TouchableOpacity key={r.id} style={[s.card, { borderColor: th.accent + '55' }]} onPress={() => openResult(r)}>
                <Text style={[s.cardT, { color: th.accent2 }]}>{r.title}</Text>
                <Text style={s.cardS}>{r.snippet}</Text>
              </TouchableOpacity>
            ))}
            {!searched && incognito && (
              <Text style={s.sm}>Incognito ON: app search history save nahi karegi.</Text>
            )}
            {!searched && !incognito && history.length > 0 && (
              <>
                <Text style={s.sm}>Recent searches:</Text>
                {history.map((h) => (
                  <TouchableOpacity key={h} onPress={() => doSearch(h)}>
                    <Text style={[s.hist, { color: th.accent2 }]}>🕘 {h}</Text>
                  </TouchableOpacity>
                ))}
                <Nav label="History saaf karo" onPress={() => setHistory([])} />
              </>
            )}
          </ScrollView>
          <Nav label="Back" onPress={backToTools} />
        </>
      ))}

      {screen === 'videocall' && (
        <>
          <Text style={s.sm}>Naya call banao, ya partner ka code daalke join karo</Text>
          {callCode ? (
            <>
              <Text style={s.bt}>Call code:</Text>
              <Text style={[s.code2, { color: th.accent2 }]}>{callCode}</Text>
              <Text style={s.sm}>Ye code apne partner ko bhejo.</Text>
              <Btn label="📹 Call Shuru Karo" onPress={() => openCall(callCode)} />
            </>
          ) : (
            <Btn label="➕ Naya Call Banao" onPress={() => setCallCode(randomId().slice(0, 8))} />
          )}
          <TextInput style={s.i} placeholder="Call code daalo" autoCapitalize="none"
            value={callJoin} onChangeText={setCallJoin} />
          <Btn label="Call Join Karo" onPress={() => openCall(callJoin.trim())} />
          <Nav label="Back" onPress={backToTools} />
        </>
      )}

      {screen === 'chat' && !chatCode && (
        <>
          <Btn label="➕ Naya Chat Banao" onPress={createChat} />
          <TextInput style={s.i} placeholder="Chat code daalo" keyboardType="number-pad"
            value={chatJoin} onChangeText={setChatJoin} />
          <Btn label="Chat Join Karo" onPress={joinChat} />
          <Nav label="Back" onPress={backToTools} />
        </>
      )}

      {inChat && (
        <>
          <Text style={s.sm}>Chat code: {chatCode}   •   Tu: {nick}</Text>
          <ScrollView
            ref={scrollRef}
            style={s.msgBox}
            onContentSizeChange={() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true })}
          >
            {messages.length === 0 && <Text style={s.sm}>Abhi koi msg nahi. Pehla msg bhejo! 👋</Text>}
            {messages.map((m) => (
              <View
                key={m.key}
                style={[s.bubble, m.sid === sid ? [s.mine, { backgroundColor: th.accent }] : s.theirs]}
              >
                <Text style={s.bname}>{m.sid === sid ? 'Tu' : m.name}</Text>
                <Text style={s.btext}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={s.sendRow}>
            <TextInput style={s.msgInput} placeholder="Msg likho..."
              value={msgText} onChangeText={setMsgText} />
            <TouchableOpacity style={[s.sendBtn, { backgroundColor: th.accent }]} onPress={sendMsg}>
              <Text style={s.bt}>➤</Text>
            </TouchableOpacity>
          </View>
          <Nav label="Chat Chhodo" onPress={leaveChat} />
        </>
      )}

      {!!error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, overflow: 'hidden' },
  cTop: { justifyContent: 'flex-start', paddingTop: 40 },
  glow: { position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.22 },
  glow2: { position: 'absolute', width: 320, height: 320, borderRadius: 160, opacity: 0.2 },
  floatWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  floaty: { position: 'absolute', opacity: 0.5 },
  heroHeart: { fontSize: 64, marginBottom: 4 },
  logo: {
    fontSize: 50, fontWeight: 'bold', letterSpacing: 2, marginBottom: 6,
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22,
  },
  tag: { fontSize: 18, textAlign: 'center', marginBottom: 18, lineHeight: 26 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 26 },
  chip: { borderWidth: 1, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 12, margin: 4 },
  chipT: { fontSize: 13 },
  t: { color: '#fff', fontSize: 26, marginBottom: 14, textAlign: 'center', fontWeight: '600' },
  tSmall: { color: '#fff', fontSize: 22, marginBottom: 12, textAlign: 'center' },
  b: {
    padding: 14, borderRadius: 30, marginVertical: 8, width: 260, alignItems: 'center',
    shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  bBig: { width: 290, paddingVertical: 18 },
  nav: { borderWidth: 1, padding: 12, borderRadius: 30, marginVertical: 6, width: 260, alignItems: 'center' },
  navt: { fontSize: 16 },
  dotRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ffffff33', marginHorizontal: 4 },
  bt: { color: '#fff', fontSize: 18, textAlign: 'center', fontWeight: '600' },
  btBig: { fontSize: 22 },
  sm: { color: '#d8d0e0', fontSize: 14, marginVertical: 10, textAlign: 'center', paddingHorizontal: 10 },
  q: { fontSize: 22, marginVertical: 20, textAlign: 'center' },
  code: { fontSize: 48, fontWeight: 'bold', marginVertical: 10 },
  code2: { fontSize: 30, fontWeight: 'bold', marginVertical: 8 },
  err: { color: '#ff8a8a', fontSize: 14, marginTop: 15, textAlign: 'center' },
  hist: { fontSize: 16, marginVertical: 4 },
  i: { backgroundColor: '#ffffffee', width: 240, padding: 12, borderRadius: 14, marginBottom: 10 },
  i2: { backgroundColor: '#ffffffee', width: 270, minHeight: 50, padding: 12, borderRadius: 14, marginBottom: 10 },
  msgBox: { width: '100%', flex: 1, marginVertical: 8 },
  card: { backgroundColor: '#ffffff14', borderWidth: 1, padding: 12, borderRadius: 14, marginVertical: 5 },
  cardT: { fontSize: 17, fontWeight: 'bold' },
  cardS: { color: '#cfc8d8', fontSize: 13, marginTop: 4 },
  bubble: { padding: 9, borderRadius: 14, marginVertical: 3, maxWidth: '80%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#ffffff22' },
  bname: { color: '#f0e8f5', fontSize: 11 },
  btext: { color: '#fff', fontSize: 16 },
  sendRow: { flexDirection: 'row', width: '100%', alignItems: 'center' },
  msgInput: { flex: 1, backgroundColor: '#ffffffee', padding: 12, borderRadius: 22 },
  sendBtn: { marginLeft: 8, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 22 },
});