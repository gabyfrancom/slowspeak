/* =====================================================
   SlowSpeak — lógica principal
===================================================== */
'use strict';

/* ---------- Estado persistente ---------- */
const STORE_KEY = 'slowspeak_v1';
const defaultState = () => ({
  v: 2,
  xp: 0,
  streak: 0,
  bestStreak: 0,
  lastPractice: null, // 'YYYY-MM-DD'
  hearts: 5,
  routes: {},         // {routeId: {cur: 0, done: {lessonIdx: result}}}
  settings: { rate: 0.7, voiceURI: null, defRate: 0.7 }
});
function emptyRoute() { return { cur: 0, done: {} }; }
let state = loadState();
function loadState() {
  let s;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    s = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
  } catch (e) { s = defaultState(); }
  // migración v1 → v2 (progreso del formato antiguo)
  if (s.v !== 2) {
    const r = emptyRoute();
    r.cur = s.day || 0;
    Object.entries(s.completed || {}).forEach(([k, v]) => { r.done[k] = v; });
    s.routes = { cotidiano: r };
    s.v = 2;
  }
  ROUTES.forEach(rt => { if (!s.routes[rt.id]) s.routes[rt.id] = emptyRoute(); });
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
  return s;
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ---------- Utilidades de fecha / racha ---------- */
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function updateStreak() {
  const t = todayStr();
  if (state.lastPractice === t) return; // ya practicó hoy
  state.streak = (state.lastPractice === yesterdayStr()) ? state.streak + 1 : 1;
  state.lastPractice = t;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  saveState();
}
function refillHeartsIfNewDay() {
  const t = todayStr();
  if (state.lastPractice !== t) { /* no recargamos: solo al fallar/pasar día */ }
}

/* ---------- Referencias DOM ---------- */
const $ = id => document.getElementById(id);
const screens = ['homeScreen','lessonScreen','resultScreen','settingsScreen'];
function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle('active', s === id));
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.nav === id));
  window.scrollTo(0,0);
}

/* ---------- Voz (speechSynthesis) ---------- */
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  const sel = $('voiceSel');
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = ''; auto.textContent = 'Automática (inglés)';
  sel.appendChild(auto);
  voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  sel.value = state.settings.voiceURI || '';
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice() {
  if (!voices.length) return null;
  const pref = state.settings.voiceURI;
  return voices.find(v => v.voiceURI === pref)
      || voices.find(v => v.lang === 'en-US' && /female|samantha|zira|google us english/i.test(v.name))
      || voices.find(v => v.lang === 'en-US')
      || voices[0];
}
function speak(text, rate) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = rate !== undefined ? rate : currentRate();
  u.pitch = 1.02;
  u.lang = v ? v.lang : 'en-US';
  speechSynthesis.speak(u);
}
function currentRate() {
  const r = parseFloat($('speedRange').value);
  return isNaN(r) ? 0.7 : r;
}

/* ---------- Normalización y comparación fonética ---------- */
function normalizeWords(s) {
  return s.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\b(gonna|wanna|gotta)\b/g, m => ({gonna:'going to', wanna:'want to', gotta:'got to'}[m]))
    .split(/\s+/)
    .filter(Boolean);
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({length: m+1}, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1]===b[j-1] ? 0 : 1));
  return dp[m][n];
}
/* Compara palabra a palabra con fuzzy matching: devuelve
   {acc, matchedIdx[], missedWords[]} en 0..1 */
function scoreAttempt(target, heard) {
  const T = normalizeWords(target);
  const H = normalizeWords(heard);
  const matched = new Array(T.length).fill(false);
  const used = new Array(H.length).fill(false);
  // pase 1: coincidencia exacta
  for (let i = 0; i < T.length; i++) {
    for (let j = 0; j < H.length; j++) {
      if (!used[j] && H[j] === T[i]) { matched[i] = true; used[j] = true; break; }
    }
  }
  // pase 2: fuzzy (errores típicos de pronunciación)
  for (let i = 0; i < T.length; i++) {
    if (matched[i]) continue;
    let best = -1, bestD = 99;
    for (let j = 0; j < H.length; j++) {
      if (used[j]) continue;
      const d = lev(T[i], H[j]);
      if (d < bestD) { bestD = d; best = j; }
    }
    const tol = T[i].length <= 4 ? 0 : (T[i].length <= 7 ? 1 : 2);
    if (best >= 0 && bestD <= tol) { matched[i] = true; used[best] = true; }
  }
  const ok = matched.filter(Boolean).length;
  return {
    acc: T.length ? ok / T.length : 0,
    matched,
    words: T,
    missed: T.filter((w, i) => !matched[i])
  };
}
window.__scoreAttempt = scoreAttempt; // para pruebas

/* ---------- Reconocimiento de voz ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null, listening = false;
function supportedSR() { return !!SR; }
function startListening(onResult, onError) {
  if (!SR) { onError('unsupported'); return; }
  recog = new SR();
  recog.lang = 'en-US';
  recog.interimResults = false;
  recog.maxAlternatives = 3;
  recog.continuous = false;
  listening = true;
  recog.onresult = e => {
    const alts = Array.from(e.results[0]).map(a => a.transcript);
    onResult(alts);
  };
  recog.onerror = e => { listening = false; onError(e.error || 'error'); };
  recog.onend = () => { listening = false; };
  try { recog.start(); } catch (err) { listening = false; onError('start'); }
}
function stopListening() { if (recog && listening) { try { recog.stop(); } catch(e){} } }

/* ---------- Mascota (Honey) ---------- */
let mascotTimer = null;
function mascotSay(text, ms = 3800) {
  $('mascotBubble').textContent = text;
  $('mascot').classList.add('show');
  clearTimeout(mascotTimer);
  mascotTimer = setTimeout(() => $('mascot').classList.remove('show'), ms);
}

/* ---------- Confeti ---------- */
function confetti(n = 30) {
  const emojis = ['🎉','⭐','🐝','🍯','💛','✨','🌟'];
  const app = $('app');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'confetti';
    s.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    s.style.left = Math.random()*100 + '%';
    s.style.animationDuration = (1.6 + Math.random()*1.6) + 's';
    s.style.animationDelay = (Math.random()*0.4) + 's';
    app.appendChild(s);
    setTimeout(() => s.remove(), 3600);
  }
}

/* =====================================================
   PANTALLA HOME — varias rutas temáticas
===================================================== */
function routeStats(rt) {
  const st = state.routes[rt.id];
  const done = Object.keys(st.done).length;
  return { st, done, pct: Math.round(done / rt.lessons.length * 100) };
}
function renderHome() {
  $('streakTxt').textContent = state.streak;
  $('xpTxt').textContent = state.xp;
  $('heartTxt').textContent = state.hearts;
  const h = new Date().getHours();
  $('greetTitle').textContent = (h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches') + ', Gaby! 🐝';

  const wrap = $('routesWrap');
  wrap.innerHTML = '';
  ROUTES.forEach(rt => {
    const { done, pct } = routeStats(rt);
    const card = document.createElement('div');
    const wide = rt.id === 'cotidiano' ? ' wide' : '';
    card.className = 'route-card' + wide;
    const body = `<div class="route-emoji">${rt.emoji}</div>
      <div class="route-body"><b>${rt.title}</b>
      <span class="route-prog">${done}/${rt.lessons.length} lecciones · ${pct}%</span>
      <div class="route-bar"><div class="route-fill" style="width:${pct}%"></div></div></div>`;
    card.innerHTML = wide ? body + `<div class="day-state">${pct === 100 ? '👑' : '▶️'}</div>` : body;
    card.onclick = () => showRoute(rt.id);
    wrap.appendChild(card);
  });
}

/* =====================================================
   PANTALLA RUTA — lecciones de un tema
===================================================== */
let currentRoute = null;
function showRoute(routeId) {
  const rt = ROUTES.find(r => r.id === routeId);
  currentRoute = routeId;
  const { st } = routeStats(rt);
  $('routeTitle').textContent = rt.emoji + ' ' + rt.title;
  $('routeDesc').textContent = rt.desc;

  const wrap = $('routePathWrap');
  wrap.innerHTML = '';

  // tarjeta de la lección actual
  if (st.cur < rt.lessons.length) {
    const d = rt.lessons[st.cur];
    const card = document.createElement('div');
    card.className = 'day-card';
    const prefix = rt.id === 'cotidiano' ? `Día ${st.cur+1}: ` : `Lección ${st.cur+1}: `;
    card.innerHTML = `<div class="day-emoji">${d.emoji}</div>
      <div class="day-info"><b>${prefix}${d.topic}</b>
      <span>${d.phrases.length} frases conversacionales</span></div>
      <div class="day-state">▶️</div>`;
    card.onclick = () => startLesson(routeId, st.cur);
    wrap.appendChild(card);
  } else {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.innerHTML = `<div class="day-emoji">🏆</div>
      <div class="day-info"><b>¡Ruta completada!</b><span>Dominaste todas las lecciones de ${rt.title}</span></div>
      <div class="day-state">👑</div>`;
    card.onclick = () => showScreen('homeScreen');
    wrap.appendChild(card);
  }

  rt.lessons.forEach((d, i) => {
    if (i > 0) {
      const c = document.createElement('div');
      c.className = 'connector';
      wrap.appendChild(c);
    }
    const node = document.createElement('div');
    const done = !!st.done[i];
    const playable = done || i <= st.cur;
    node.className = 'node ' + (done ? 'done star' : (i === st.cur ? 'current' : (playable ? 'done' : 'locked')));
    node.innerHTML = `${i+1}<span class="lbl">${done ? '✓' : d.emoji}</span>`;
    node.title = d.topic;
    node.onclick = () => {
      if (playable) startLesson(routeId, i);
      else mascotSay(`🔒 Completa la lección ${st.cur+1} para desbloquear esta. ¡Tú puedes!`);
    };
    wrap.appendChild(node);
  });
  showScreen('routeScreen');
}
$('btnBack').addEventListener('click', () => { renderHome(); showScreen('homeScreen'); });

/* =====================================================
   TRANSCRIPCIÓN FONÉTICA (aproximación amigable)
   Diccionario palabra → pronunciación escrita.
===================================================== */
const PHON = {
a:"ei",about:"abaut",abroad:"abrod",account:"akaunt",afternoon:"afternun",air:"er",allergic:"aleryik",always:"olwis",am:"am",ana:"ana",and:"and",another:"anader",any:"eni",are:"ar",as:"as",at:"at",available:"aveilabol",back:"bak",bank:"bank",battery:"batri",be:"bi",become:"bikam",bed:"bed",been:"bin",before:"bifor",beginning:"biguinin",best:"best",better:"betar",big:"big",bill:"bil",bills:"bilz",birthday:"berzdei",bit:"bit",blast:"blast",break:"breik",breakfast:"brekfast",breathtaking:"bret-teikin",bright:"brait",brother:"brader",brothers:"braderz",budget:"bayet",bus:"bos",but:"bat",by:"bai",bye:"bai",caf:"kaf",calendar:"kalindar",call:"kol",calm:"kam",can:"kan","can't":"kant",card:"kard",cash:"kash",center:"sentar",challenging:"chalinyin",change:"cheinch",charge:"charch",check:"chek",chicken:"chikin",chilly:"chili",city:"siti",clear:"klir",coffee:"kofi",confident:"konfident",congratulations:"kangratshuleishonz",connection:"konekshon",cooks:"kukz",corner:"kornar",cost:"kost",could:"kud",count:"kaunt",curly:"kerli",cut:"kat",dad:"dad",day:"dei",days:"deiz",delicious:"dilishos",depends:"dipenz",difference:"difrans",disagree:"disagri",do:"du",doctor:"doktar",does:"daz",doing:"duin","don't":"dount",down:"daun",downtown:"dauntaun",dream:"drim",dressed:"drest",drink:"drink",ear:"ir",easy:"izi",eat:"it",english:"inglish",enjoy:"enllói",enough:"inaf",ever:"evar",every:"evri",everyone:"evriwuan",everything:"evrizin",excellent:"eksalent",excuse:"ikskius",experience:"ikspiriens",family:"famili",far:"far",fee:"fi",feel:"fil",feeling:"filin",fi:"fai",fine:"fain",first:"ferst",five:"faiv",fluent:"fluent",food:"fud",for:"for",forever:"forevar",forget:"forget",free:"fri",fresh:"fresh",friend:"frend",friendly:"frendli",from:"from",full:"ful",future:"fiutshar",get:"get",go:"gou",going:"gouin",good:"gud",grandparents:"grandperents",great:"greit",grilled:"grild",growing:"grouin",habits:"habits",had:"had",hair:"jer",hang:"jang",happens:"hapenz",happy:"japi",hard:"hard",has:"jaz",have:"jav","haven't":"havent",he:"ji","he's":"jiz",headache:"jedeik",help:"jelp",helps:"jelps",her:"her",here:"jir",hi:"jai",honest:"onest",hope:"joup",house:"jaus",how:"jau",humor:"jumar",hurts:"jerts",i:"ai","i'd":"aid","i'll":"ail","i'm":"aim","i've":"aiv",idea:"aidia",important:"important",in:"in",internet:"internet",into:"intu",inviting:"invaitin",is:"is","isn't":"izent",it:"it","it's":"its",job:"llab",john:"llan",journey:"llerni",just:"llast",keep:"kiip",kid:"kid",kind:"kaind",laptop:"laptop",last:"last",lately:"leitli",later:"leitar",latte:"latei",laura:"lora",learning:"lerning",leave:"liv",left:"left",let:"let","let's":"lets",life:"laif",like:"laik",link:"link",listening:"lisening",little:"lital",live:"liv",lived:"livd",lives:"livz",living:"living",long:"long",look:"luk",looking:"lukin",looks:"luks",love:"lav",lovely:"lavli",make:"meik",makes:"meiks",marketing:"marketing",may:"mei",me:"mi",media:"midia",medicine:"medsin",meet:"mit",meeting:"miting",menu:"meniu",message:"mesich",milk:"milk",mind:"maind",mine:"main",miss:"mis",missed:"mist",mom:"mom",moment:"moument",monday:"mandei",monthly:"manzli",more:"mor",morning:"morning",mornings:"morningz",movie:"muvi",much:"mach",music:"miusik",my:"mai",name:"neim",need:"nid",nervous:"nervos",never:"never",new:"nu",newlyweds:"nuliuedz",next:"nekst",nice:"nais",no:"nou",not:"not",now:"nau","o'clock":"ou-klok",oat:"out",of:"of",off:"of",often:"ofen",on:"on",one:"wuan",open:"oupen",opinion:"opinion",opportunity:"oportiuniti",or:"or",order:"order",ordering:"ordering",out:"aut",outside:"autsaid",over:"ouver",park:"park",party:"parti",pay:"pei",peanuts:"pinats",people:"pipol",perfect:"perfekt",phone:"foun",photography:"fotografi",pizza:"pitsa",play:"plei",please:"pliz",point:"point",practice:"praktis",practicing:"praktisin",quiet:"kuaiat",rain:"rein",raise:"reis",reading:"riding",ready:"redi",really:"rili",reason:"rizon",recommend:"recomend",remember:"rimember",repeat:"ripit",rewarding:"riuardin",right:"rait",running:"ranin",rush:"rash",saving:"seivin",say:"sei",school:"skul",sea:"si",seat:"sit",see:"si",send:"send",sense:"sens",service:"servis",seven:"seven",she:"shi",should:"shud",shower:"shauar",sister:"sistar",situation:"sichueishon",size:"saiz",sleep:"slip",slow:"slou",small:"smol",smaller:"smolar",so:"sou",social:"sou-shal",some:"sam",sometime:"samtain",sore:"sor",sorry:"sori",sounds:"saundz",speak:"spik",specials:"speshals",spend:"spend",sports:"sports",station:"steishon",stop:"stop",straight:"streit",sugar:"shugar",sunny:"sani",swallow:"suolou",table:"teibal",take:"teik",talk:"tok",tall:"tol",teacher:"tichar",team:"tim",than:"dan",thank:"zank",thanks:"zanks",that:"dat","that's":"dats",the:"da",then:"den",there:"der","there's":"derz",they:"dei",things:"zins",think:"zink",this:"dis",throat:"zraut",through:"zru",time:"taim",to:"tu",toast:"toust",today:"tudei",together:"tugezdar",tomorrow:"tumarou",tonight:"tunait",too:"tu",tough:"taf",train:"trein",travel:"travel",traveling:"travelin",trip:"trip",try:"trai",turn:"tern",two:"tu",up:"ap",used:"iust",usually:"iushuali",very:"veri",view:"viu",visited:"visatid",wake:"weik",want:"wont",was:"waz",watch:"wach",water:"woter",we:"wi","we're":"wir",weather:"wedhar",weekend:"wikend",well:"wel",what:"wat",when:"wen",where:"wer",why:"wai",wi:"wai",will:"wil",window:"windou",wish:"wish",with:"wiz",withdraw:"widro",wonderful:"wanderful",work:"werk",world:"werld",worry:"weri",would:"wud",year:"yir",yet:"yet",you:"iu",your:"yor"
};
function buildPron(phrase) {
  return normalizeWords(phrase).map(w => PHON[w] || w).join(' · ');
}
window.__buildPron = buildPron;

/* =====================================================
   PANTALLA LECCIÓN
===================================================== */
const lesson = { day: 0, idx: 0, tries: 0, results: [], awaitingNext: false };
function startLesson(routeId, lessonIdx) {
  const rt = ROUTES.find(r => r.id === routeId);
  lesson.routeId = routeId; lesson.data = rt.lessons[lessonIdx];
  lesson.idx = 0; lesson.tries = 0; lesson.results = [];
  // velocidad: recordar ajuste del usuario
  $('speedRange').value = state.settings.defRate;
  updateSpeedLabel();
  showScreen('lessonScreen');
  renderPhrase();
  const label = routeId === 'cotidiano' ? `Día ${lessonIdx+1}` : `Lección ${lessonIdx+1}`;
  mascotSay(`${label}: ${lesson.data.topic}. Escucha despacio y repite conmigo 🍯`);
}
function renderPhrase() {
  const d = lesson.data;
  const p = d.phrases[lesson.idx];
  lesson.awaitingNext = false;
  $('progressFill').style.width = (lesson.idx / d.phrases.length * 100) + '%';
  $('phraseEn').innerHTML = p.en.split(/(\s+)/).map(tok =>
    /^\s+$/.test(tok) || tok === '' ? tok : `<span class="word">${tok}</span>`).join('');
  $('phrasePr').textContent = '🗣️ ' + buildPron(p.en);
  $('phraseEs').textContent = p.es;
  if (p.tip) { $('tipBox').style.display = 'flex'; $('tipTxt').textContent = p.tip; }
  else $('tipBox').style.display = 'none';
  const fb = $('feedback'); fb.className = ''; fb.innerHTML = '';
  $('btnContinue').style.display = 'none';
  $('btnSpeak').disabled = false;
  $('btnSpeak').innerHTML = '🎤 Repetir';
  $('btnSpeak').classList.remove('mic-live');
  // autoplay lento al entrar
  setTimeout(() => speak(p.en), 350);
}
function updateSpeedLabel() {
  const r = currentRate();
  $('speedVal').textContent = r <= 0.6 ? 'muy lento' : r <= 0.75 ? 'lento' : r <= 0.9 ? 'medio' : 'normal';
}

$('speedRange').addEventListener('input', updateSpeedLabel);
$('btnListen').addEventListener('click', () => {
  const p = lesson.data.phrases[lesson.idx];
  speak(p.en);
});

$('btnSpeak').addEventListener('click', () => {
  if (lesson.awaitingNext) return;
  if (!supportedSR()) {
    showFeedback(null, 'unsupported');
    return;
  }
  if (listening) { stopListening(); return; }
  const btn = $('btnSpeak');
  btn.innerHTML = '🔴 Escuchando...';
  btn.classList.add('mic-live');
  mascotSay('Te escucho... habla con calma 🎙️', 5000);
  startListening(alts => {
    btn.innerHTML = '🎤 Repetir';
    btn.classList.remove('mic-live');
    const p = lesson.data.phrases[lesson.idx];
    // elegir la alternativa con mayor puntuación
    let best = null, bestAcc = -1;
    alts.forEach(t => {
      const s = scoreAttempt(p.en, t);
      if (s.acc > bestAcc) { bestAcc = s.acc; best = { ...s, heard: t }; }
    });
    showFeedback(best, 'ok');
  }, err => {
    btn.innerHTML = '🎤 Repetir';
    btn.classList.remove('mic-live');
    if (err === 'not-allowed' || err === 'service-not-allowed')
      showFeedback(null, 'mic-denied');
    else if (err === 'no-speech')
      mascotSay('No te escuché. Inténtalo de nuevo, sin prisa 🐢');
    else if (err === 'unsupported')
      showFeedback(null, 'unsupported');
    else
      mascotSay('Ocurrió un detalle técnico. Intenta otra vez 🙂');
  });
});

function paintWords(res) {
  const spans = $('phraseEn').querySelectorAll('.word');
  res.words.forEach((w, i) => {
    spans[i].style.background = res.matched[i] ? '#D8F5C0' : '#FFD6D6';
    spans[i].style.textDecoration = res.matched[i] ? 'none' : 'underline wavy #FF4B4B';
  });
}

function showFeedback(res, kind) {
  const fb = $('feedback');
  fb.className = 'show';
  lesson.tries++;
  const d = CURRICULUM[lesson.day];

  if (kind === 'unsupported') {
    fb.className = 'show bad';
    fb.innerHTML = `⚠️ <b>Tu navegador no soporta reconocimiento de voz.</b><div id="heardTxt">Usa Chrome o Edge en tu móvil/PC y permite el micrófono. Mientras tanto, escucha y repite en voz alta — tu oído también entrena.</div>`;
    lesson.awaitingNext = true;
    $('btnContinue').style.display = 'flex';
    return;
  }
  if (kind === 'mic-denied') {
    fb.className = 'show bad';
    fb.innerHTML = `🎙️ <b>Necesito permiso de micrófono.</b><div id="heardTxt">Actívalo en el ícono de candado de la barra del navegador y vuelve a intentar.</div>`;
    return;
  }

  const acc = res.acc;
  paintWords(res);
  const heardShort = res.heard.length > 90 ? res.heard.slice(0, 90) + '…' : res.heard;

  if (acc >= 0.85) {
    fb.className = 'show good';
    const perfect = acc >= 0.999;
    fb.innerHTML = `${perfect ? '🌟 ¡PERFECTO!' : '✅ ¡Excelente pronunciación!'} <b>${Math.round(acc*100)}%</b><div id="heardTxt">Te escuché: “${heardShort}”</div>`;
    lesson.results.push({ acc, perfect, missed: res.missed });
    lesson.awaitingNext = true;
    $('btnContinue').style.display = 'flex';
    $('btnSpeak').disabled = true;
    if (perfect) { state.xp += 15; confetti(14); mascotSay('¡Eso sonó hermoso! 🌟'); }
    else { state.xp += 10; mascotSay(pickEncourage()); }
  } else if (acc >= 0.6) {
    fb.className = 'show mid';
    fb.innerHTML = `🙂 <b>Buen intento: ${Math.round(acc*100)}%</b><div id="heardTxt">Te escuché: “${heardShort}”<br>Palabras a pulir: <b>${res.missed.join(', ') || '—'}</b></div>`;
    if (lesson.tries >= 2) {
      lesson.results.push({ acc, perfect: false, missed: res.missed });
      lesson.awaitingNext = true;
      $('btnContinue').style.display = 'flex';
      $('btnSpeak').disabled = true;
      state.xp += 6;
      mascotSay('Vas muy bien. En el repaso final lo verás de nuevo 💪');
    } else {
      mascotSay('Casi. Escucha otra vez y fíjate en las palabras en rojo 🐢');
      setTimeout(() => speak(d.phrases[lesson.idx].en), 700);
    }
  } else {
    fb.className = 'show bad';
    fb.innerHTML = `💪 <b>${Math.round(acc*100)}%</b> — Escucha con calma e inténtalo otra vez.<div id="heardTxt">Te escuché: “${heardShort || '(silencio)'}”</div>`;
    state.hearts = Math.max(0, state.hearts - 1);
    $('heartTxt').textContent = state.hearts;
    if (state.hearts === 0) {
      state.hearts = 5;
      mascotSay('Sin corazones... pero no pasa nada: ¡recargados! Practica sin miedo ❤️');
    } else {
      mascotSay('Sin problema. Escucha la frase otra vez, lento y claro 🍯');
    }
    setTimeout(() => speak(d.phrases[lesson.idx].en), 700);
  }
  saveState();
}

function pickEncourage() {
  const m = ['¡Muy bien! 🎉','¡Así se habla! ✨','Tu inglés suena natural 🐝','¡Qué fluidez! 🍯','Sigue así, Gaby 💛'];
  return m[Math.floor(Math.random()*m.length)];
}

$('btnContinue').addEventListener('click', () => {
  const d = lesson.data;
  lesson.idx++;
  lesson.tries = 0;
  if (lesson.idx >= d.phrases.length) finishLesson();
  else renderPhrase();
});

function finishLesson() {
  $('progressFill').style.width = '100%';
  const rs = lesson.results;
  const avgAcc = rs.length ? rs.reduce((a, r) => a + r.acc, 0) / rs.length : 0;
  const perfectCount = rs.filter(r => r.perfect).length;
  const missedAll = [...new Set(rs.flatMap(r => r.missed))];

  updateStreak();
  // guardar resultado de la lección (guarda el mejor intento)
  const rt = ROUTES.find(r => r.id === lesson.routeId);
  const lst = rt.lessons;
  const lessonPos = lst.indexOf(lesson.data);
  const st = state.routes[lesson.routeId];
  const prev = st.done[lessonPos];
  if (!prev || avgAcc > prev.acc) {
    st.done[lessonPos] = { acc: avgAcc, perfect: perfectCount, missed: missedAll };
  }
  if (lessonPos === st.cur) st.cur++;
  state.hearts = 5;
  saveState();

  $('resultEmoji').textContent = avgAcc >= 0.85 ? '🏆' : avgAcc >= 0.6 ? '🎉' : '🌱';
  $('resultTitle').textContent = avgAcc >= 0.85 ? '¡Lección dominada!' : avgAcc >= 0.6 ? '¡Lección completada!' : 'Lección terminada — sigue practicando';
  $('rAcc').textContent = Math.round(avgAcc * 100) + '%';
  $('rXp').textContent = '+' + (perfectCount * 15 + Math.max(0, rs.length - perfectCount) * 10);
  $('rPerfect').textContent = perfectCount + '/' + rs.length;

  const chips = $('wordChips');
  chips.innerHTML = '';
  const words = [...new Set(lst.flatMap(l => l.phrases).flatMap(p => normalizeWords(p.en)))];
  if (!missedAll.length) {
    chips.innerHTML = '<span class="wchip ok">¡Todas perfectas! 🌟</span>';
  } else {
    words.forEach(w => {
      const s = document.createElement('span');
      const ok = !missedAll.includes(w);
      s.className = 'wchip ' + (ok ? 'ok' : 'miss');
      s.textContent = ok ? '✓ ' + w : '✗ ' + w;
      chips.appendChild(s);
    });
  }
  showScreen('resultScreen');
  if (avgAcc >= 0.7) confetti(40);
  const rDone = Object.keys(st.done).length;
  mascotSay(rDone >= lst.length ? `¡Ruta ${rt.title} completada! Eres increíble 👑`
    : state.streak > 1 ? `¡Racha de ${state.streak} días! 🔥` : '¡Primera lección hecha! Vuelve mañana 🔥');
}

$('btnFinish').addEventListener('click', () => { showRoute(lesson.routeId); });
$('btnReplay').addEventListener('click', () => startLesson(lesson.routeId, ROUTES.find(r => r.id === lesson.routeId).lessons.indexOf(lesson.data)));

/* =====================================================
   SETTINGS
===================================================== */
$('btnSettings').addEventListener('click', () => {
  $('setDay').textContent = Math.min(state.day + 1, CURRICULUM.length) + ' / ' + CURRICULUM.length;
  $('setStreak').textContent = state.bestStreak + ' 🔥';
  $('defSpeedSel').value = String(state.settings.defRate);
  showScreen('settingsScreen');
});
$('voiceSel').addEventListener('change', e => {
  state.settings.voiceURI = e.target.value || null; saveState();
  speak('Hello! This is my voice.', state.settings.defRate);
});
$('defSpeedSel').addEventListener('change', e => {
  state.settings.defRate = parseFloat(e.target.value); saveState();
  $('speedRange').value = e.target.value; updateSpeedLabel();
});
$('btnReset').addEventListener('click', () => {
  if (confirm('¿Segura? Se borrará todo tu progreso.')) {
    state = defaultState(); saveState(); renderHome(); showScreen('homeScreen');
    mascotSay('Nueva aventura, desde el Día 1 🐝');
  }
});

/* ---------- Navegación inferior ---------- */
document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', () => {
    if (n.dataset.nav === 'homeScreen') renderHome();
    if (n.dataset.nav === 'settingsScreen') $('btnSettings').click();
    showScreen(n.dataset.nav);
  });
});

/* ---------- Arranque ---------- */
updateSpeedLabel();
renderHome();
mascotSay('¡Hola Gaby! Soy Honey 🍯 Toca el Día 1 y practiquemos inglés conversacional, paso a paso.', 6000);
