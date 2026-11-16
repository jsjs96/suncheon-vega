/* VEGA 추가 기능: 월간 리포트 · 연말 결산 · 칭호 축하 팝업 · 다크모드 */
const V = window.__vega, S = V.sampleData, U = () => V.user(), esc = V.esc, toast = V.showToast;
const t0 = Date.now();
/* ---------- 공통 모달 ---------- */
const close = window.vmClose = () => { const m = document.getElementById('vmModal'); if (m) m.remove(); };
function modal(html) {
  let m = document.getElementById('vmModal');
  if (!m) { m = document.createElement('div'); m.id = 'vmModal'; m.className = 'fixed inset-0 z-[250] bg-black/50 flex items-end sm:items-center justify-center p-3'; m.addEventListener('click', (e) => { if (e.target === m) close(); }); document.body.appendChild(m); }
  m.innerHTML = `<div class="bg-white rounded-2xl w-full max-w-md max-h-[88vh] overflow-y-auto p-4 shadow-2xl">${html}</div>`;
}
const hd = (t) => `<div class="flex justify-between items-center mb-3"><h3 class="text-sm font-black text-gray-900">${t}</h3><button onclick="vmClose()" class="text-gray-400 text-lg px-2">✕</button></div>`;
const btn = 'bg-indigo-950 text-white text-xs font-bold px-3 py-2 rounded-xl';
const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('복사했어요. 단톡방에 붙여넣으세요', 3000); } catch (e) { prompt('아래 문구를 복사해 주세요', text); } };

/* ---------- 월간 리포트 · 연말 결산 ---------- */
const POSITIVE = ['🔥', '😆', '💪'];
function stats(name, key) {
  const ev = V.past().filter((e) => e.date.startsWith(key)), mine = ev.filter((e) => V.eligible(name, e));
  const votes = (e) => S.regularVotesByDate[e.date] || {}, att = (e) => votes(e)[name] === '참가';
  const n = mine.length, c = mine.filter(att).length;
  let best = 0, run = 0; mine.forEach((e) => { run = att(e) ? run + 1 : 0; best = Math.max(best, run); });
  let tot = 0, hit = 0; const mem = S.members.filter((m) => m.role === 'admin' || m.role === 'member');
  ev.forEach((e) => mem.forEach((m) => { if (V.eligible(m.name, e)) { tot++; if (votes(e)[m.name] === '참가') hit++; } }));
  const R = V.reactions(), rd = Object.keys(R).filter((d) => d.startsWith(key)); let pos = 0, all = 0;
  rd.forEach((d) => Object.values(R[d]).forEach((e) => { all++; if (POSITIVE.includes(e)) pos++; }));
  const months = {}; mine.forEach((e) => { const k = e.date.substring(0, 7); months[k] = months[k] || { n: 0, c: 0 }; months[k].n++; if (att(e)) months[k].c++; });
  const top = Object.entries(months).sort((a, b) => b[1].c - a[1].c)[0];
  return { n, c, rate: n ? Math.round(c / n * 100) : 0, team: tot ? Math.round(hit / tot * 100) : 0, best, mineR: rd.filter((d) => R[d][name]).length, posPct: all ? Math.round(pos / all * 100) : null,
    perfect: Object.values(months).filter((m) => m.n >= 2 && m.c === m.n).length, topMonth: top && top[1].c ? top[0] : null, sessions: ev.length };
}
let rp = { mode: 'month', key: null };
window.vmReport = (mode) => { if (!U()) return; if (mode) { rp.mode = mode; rp.key = null; } paintReport(); };
window.vmRpKey = (v) => { rp.key = v; paintReport(); };
function reportLines(st, name) {
  const month = rp.mode === 'month', L = [['출석', `${st.c} / ${st.n}회`], ['출석률', `${st.rate}%  (팀 평균 ${st.team}%)`], ['최고 연속 출석', `${st.best}회`]];
  if (!month) { L.push(['개근한 달', `${st.perfect}번`]); if (st.topMonth) L.push(['가장 많이 나온 달', `${+st.topMonth.slice(5)}월`]); L.push(['올해 정기운동', `${st.sessions}회`]); }
  L.push(['소감·만족도 참여', `${st.mineR}회`]); if (st.posPct !== null) L.push(['팀 만족도(긍정)', `${st.posPct}%`]);
  L.push(['보유 칭호', `${V.badges(name).filter((b) => b.earned).length}개`]); return L;
}
function paintReport() {
  const ks = [...new Set(V.past().map((e) => e.date.substring(0, rp.mode === 'month' ? 7 : 4)))].sort().reverse();
  const tabs = `<div class="grid grid-cols-2 gap-1.5 mb-3">${[['month', '월간 리포트'], ['year', '연말 결산']].map(([m, l]) => `<button onclick="vmReport('${m}')" class="py-2 rounded-xl text-xs font-bold ${rp.mode === m ? 'bg-indigo-950 text-white' : 'bg-gray-100 text-gray-600'}">${l}</button>`).join('')}</div>`;
  if (!ks.length) return modal(hd('📊 리포트') + tabs + '<p class="text-xs text-gray-500 py-5 text-center">아직 집계된 정기운동이 없어요.</p>');
  if (!ks.includes(rp.key)) rp.key = ks[0];
  const name = U().name, st = stats(name, rp.key), month = rp.mode === 'month', L = reportLines(st, name);
  const title = month ? `${rp.key.slice(0, 4)}년 ${+rp.key.slice(5)}월 리포트` : `${rp.key}년 VEGA 결산`;
  const msg = st.n === 0 ? '이 기간에는 집계된 운동이 없어요.' : st.rate >= 90 ? '코트의 주인공이에요! 정말 대단해요 👏' : st.rate >= 70 ? '꾸준함이 실력이에요. 멋져요 💪' : st.rate >= 40 ? '함께 뛰어서 즐거웠어요. 다음에도 코트에서 만나요 🏐' : '언제든 편하게 돌아오세요. 코트가 기다리고 있어요 🙌';
  modal(hd('📊 리포트') + tabs + `<select onchange="vmRpKey(this.value)" class="w-full p-2 border border-gray-300 rounded-xl text-xs font-bold bg-gray-50 mb-3">${ks.map((k) => `<option value="${k}" ${k === rp.key ? 'selected' : ''}>${month ? k.slice(0, 4) + '년 ' + +k.slice(5) + '월' : k + '년'}</option>`).join('')}</select>
    <div class="bg-gradient-to-br from-indigo-950 to-indigo-800 text-white rounded-2xl p-4 vm-keep-bg"><p class="text-[10px] text-indigo-200 font-bold">🏐 순천 VEGA</p><h4 class="text-base font-black mb-0.5">${title}</h4><p class="text-xs text-amber-300 font-bold mb-3">${esc(name)}님</p>
    <div class="space-y-1.5">${L.map(([k, v]) => `<div class="flex justify-between text-xs bg-white/10 rounded-lg px-3 py-1.5"><span class="text-indigo-100">${k}</span><b>${v}</b></div>`).join('')}</div><p class="text-[11px] text-indigo-100 mt-3 leading-relaxed">${msg}</p></div>
    <button onclick="vmRpCopy()" class="w-full mt-3 ${btn}">📋 텍스트로 복사해서 공유</button>`);
}
window.vmRpCopy = () => { const name = U().name, st = stats(name, rp.key); copy(`🏐 순천 VEGA ${rp.mode === 'month' ? rp.key.slice(0, 4) + '년 ' + +rp.key.slice(5) + '월 리포트' : rp.key + '년 결산'} - ${name}\n` + reportLines(st, name).map(([k, v]) => `· ${k}: ${v}`).join('\n')); };

/* ---------- 칭호 획득 축하 팝업 ---------- */
function checkBadges() {
  const u = U();
  if (!u || Date.now() - t0 < 8000 || !S.events.length || !Object.keys(S.regularVotesByDate).length || document.getElementById('vmCele')) return;
  const all = V.badges(u.name).filter((b) => b.earned), key = 'vmBadgeSeen_' + u.name; let seen = null;
  try { seen = JSON.parse(localStorage.getItem(key)); } catch (e) {}
  const names = all.map((b) => b.name);
  if (!Array.isArray(seen)) { localStorage.setItem(key, JSON.stringify(names)); return; }   /* 처음엔 조용히 기준만 저장 */
  const fresh = all.filter((b) => !seen.includes(b.name));
  if (!fresh.length) return;
  localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...names])]));
  const w = document.createElement('div'); w.id = 'vmCele'; w.className = 'fixed inset-0 z-[400] bg-black/60 flex items-center justify-center p-4 overflow-hidden';
  const conf = Array.from({ length: 22 }, () => `<span style="position:fixed;top:-6vh;left:${Math.random() * 100}vw;font-size:${16 + Math.random() * 14}px;animation:vmFall ${2 + Math.random() * 2}s linear ${Math.random()}s forwards;pointer-events:none">${['🎉', '✨', '🎊', '🏐', '⭐'][Math.floor(Math.random() * 5)]}</span>`).join('');
  w.innerHTML = `${conf}<div class="bg-white rounded-3xl shadow-2xl w-full max-w-xs p-5 text-center" style="animation:vmPop .5s ease-out"><p class="text-xs font-black text-amber-600 mb-1">🎉 새 칭호 획득!</p>
    <div class="space-y-3 my-3 max-h-[50vh] overflow-y-auto">${fresh.slice(0, 6).map((b) => `<div><div class="text-5xl">${b.icon}</div><p class="text-sm font-black text-gray-900">${esc(b.name)}</p><p class="text-[11px] text-gray-500">${esc(b.desc)}</p></div>`).join('')}${fresh.length > 6 ? `<p class="text-xs text-gray-500">외 ${fresh.length - 6}개</p>` : ''}</div>
    <button id="vmCeleOk" class="w-full ${btn}">확인</button></div>`;
  document.body.appendChild(w);
  const done = () => { const e = document.getElementById('vmCele'); if (e) e.remove(); };
  document.getElementById('vmCeleOk').onclick = done; w.addEventListener('click', (e) => { if (e.target === w) done(); });
}
const st = document.createElement('style');
st.textContent = '@keyframes vmPop{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}@keyframes vmFall{to{transform:translateY(112vh) rotate(360deg)}}';
document.head.appendChild(st);
/* [개선] 4초마다 칭호를 계산하던 방식 대신, 화면이 갱신될 때(데이터가 바뀔 때)만 검사 */
let badgeTimer = null;
const checkBadgesSoon = () => { if (badgeTimer) clearTimeout(badgeTimer); badgeTimer = setTimeout(() => { badgeTimer = null; if (!document.hidden) checkBadges(); }, 1500); };
window.addEventListener('vega:render', checkBadgesSoon);
setTimeout(checkBadgesSoon, 8500);   /* 앱을 연 직후 8초 대기 조건 이후 한 번 확인 */

/* ---------- 다크모드 ---------- */
const isDark = () => document.documentElement.classList.contains('dark');
function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = '#0a0a0a';
  const b = document.getElementById('vmDarkBtn'); if (b) b.textContent = on ? '☀️' : '🌙';
}
window.vmDark = () => { const on = !isDark(); localStorage.setItem('vxDark', on ? '1' : '0'); applyDark(on); inject(); };
/* [변경] 화면을 가리던 오른쪽 아래 떠 있는 버튼 대신, 헤더의 달·해 아이콘으로 전환 (index.html renderHeader) */
applyDark(isDark());

/* ---------- 내 정보 카드 주입 ---------- */
function myCard() {
  return `<div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mt-4"><h3 class="text-xs sm:text-sm font-black text-gray-900 mb-3 flex items-center gap-1.5"><span>📊</span> 리포트 · 화면 설정</h3>
    <div class="grid grid-cols-2 gap-2"><button onclick="vmReport('month')" class="${btn}">📊 월간 리포트</button><button onclick="vmReport('year')" class="${btn}">🎊 연말 결산</button></div>
    <button onclick="vmDark()" class="w-full mt-2 bg-white border border-gray-300 text-gray-700 text-xs font-bold py-2 rounded-xl">${isDark() ? '☀️ 라이트 모드로 전환' : '🌙 다크 모드로 전환'}</button>
    <p class="text-[11px] font-bold text-gray-500 mt-3 mb-1.5">🔠 글자 크기</p>
    <div class="grid grid-cols-3 gap-2">${FONT_LEVELS.map(([v, label]) => `<button onclick="vmFont(${v})" class="${curFont() === v ? 'bg-indigo-950 text-white border border-transparent' : 'bg-white border border-gray-300 text-gray-700'} text-xs font-bold py-2 rounded-xl">${label}</button>`).join('')}</div></div>`;
}

/* ---------- [추가] 글자 크게 보기 ----------
   글자만 커지고 칸·여백은 그대로 (vega-theme.css 맨 아래 규칙). 기기별로 저장됩니다. */
const FONT_LEVELS = [[1, '보통'], [1.15, '크게'], [1.3, '아주 크게']];
const curFont = () => { const f = parseFloat(localStorage.getItem('vxFont') || '1'); return FONT_LEVELS.some(([v]) => v === f) ? f : 1; };
function applyFont(f) {
  const h = document.documentElement;
  h.classList.toggle('vx-fs', f > 1);
  if (f > 1) h.style.setProperty('--vg-fs', String(f)); else h.style.removeProperty('--vg-fs');
}
window.vmFont = (f) => {
  try { localStorage.setItem('vxFont', String(f)); } catch (e) {}
  applyFont(f);
  inject();
  toast(f > 1 ? '글자를 크게 했어요' : '기본 글자 크기로 돌아왔어요');
};
applyFont(curFont());
function inject() {
  const app = document.getElementById('app'); if (!app) return;
  const t = V.tab();
  if (t === 'myinfo' && U()) {
    let w = document.getElementById('vmMy'), root = app.firstElementChild;
    if (!w && root) { w = document.createElement('div'); w.id = 'vmMy'; root.appendChild(w); }
    if (w) w.innerHTML = myCard();
  }
}
new MutationObserver(inject).observe(document.getElementById('app'), { childList: true });
inject();

/* ======================================================================
   [추가] 화면 다듬기 (모든 탭 공통)
   1) 카드 제목의 이모지를 선 아이콘으로 통일
   2) 운영진 탭: 카드 접기/펼치기 + 위쪽 바로가기 버튼 (펼친 상태는 기기에 기억)
   화면이 그려질 때마다 자동으로 다시 적용됩니다.
   ====================================================================== */
const VX_ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 11h8M8 16h5"/>',
  clipcheck: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-3"/>',
  ball: '<circle cx="12" cy="12" r="10"/><path d="M11.1 7.1a16.6 16.6 0 0 1 10.9 4M12 12a12.6 12.6 0 0 1-8.7 5M16.8 13.6a16.6 16.6 0 0 1-9 7.5M20.7 17a12.8 12.8 0 0 0-8.7-5 13.3 13.3 0 0 1 0-10M6.3 3.8a16.6 16.6 0 0 0 1.9 11.5"/>',
  dumbbell: '<path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16.5 9a3 3 0 0 1 0 6M19.5 6a7 7 0 0 1 0 12"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  medal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3"/>',
  sprout: '<path d="M12 22V12M12 12C12 7 8 5 4 5c0 4 3 7 8 7zM12 12c0-4 3-7 8-7 0 4-3 7-8 7z"/>',
  crown: '<path d="M3 7l4 4 5-6 5 6 4-4-2 12H5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M12 8C10 4 6 4 7 7c.5 1.5 5 1 5 1s4.5.5 5-1c1-3-3-3-5 1"/>'
};
const VX_EMOJI = {
  '📅': 'calendar', '🗓️': 'calendar', '🗓': 'calendar', '📋': 'clipboard', '💬': 'message', '📓': 'book', '📖': 'book',
  '📊': 'chart', '📈': 'chart', '🏐': 'ball', '🏋️': 'dumbbell', '🏋': 'dumbbell', '🧢': 'clipcheck', '🔒': 'lock',
  '📲': 'phone', '📱': 'phone', '📦': 'archive', '📣': 'megaphone', '📢': 'megaphone', '📝': 'pencil', '✍️': 'pencil', '✍': 'pencil',
  '👥': 'users', '👤': 'user', '🏆': 'trophy', '🏅': 'medal', '🎖️': 'medal', '🎖': 'medal', '🏁': 'flag', '🎥': 'video', '🎬': 'video',
  '🌱': 'sprout', '👑': 'crown', '🎯': 'target', '🔥': 'flame', '🎁': 'gift', '🎊': 'gift', '🎉': 'gift'
};
const vxSvg = (k) => `<svg class="vx-hico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VX_ICONS[k]}</svg>`;
const VX_LEAD = /^\s*(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;

function vxIconize(root) {
  root.querySelectorAll('h2, h3').forEach(h => {
    if (h.dataset.vxIco) return;
    h.dataset.vxIco = '1';
    /* 경우 1: <h3><span>📅</span> 제목</h3> */
    const first = h.firstElementChild;
    if (first && first.tagName === 'SPAN' && !first.children.length) {
      const m = first.textContent.trim().match(VX_LEAD);
      const k = m && VX_EMOJI[m[1]];
      if (k && first.textContent.trim() === m[1]) { first.innerHTML = vxSvg(k); return; }
    }
    /* 경우 2: <h3>📅 제목</h3> */
    const tn = [...h.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!tn || h.firstChild !== tn && !(h.firstChild.nodeType === 3 && !h.firstChild.textContent.trim() && h.childNodes[1] === tn)) return;
    const m = tn.textContent.match(VX_LEAD);
    const k = m && VX_EMOJI[m[1]];
    if (!k) return;
    tn.textContent = tn.textContent.replace(VX_LEAD, '');
    const span = document.createElement('span');
    span.innerHTML = vxSvg(k);
    span.style.cssText = 'display:inline-flex;margin-right:6px;vertical-align:middle';
    h.insertBefore(span, tn);
  });
}

/* ---------- 운영진 탭 접기 ---------- */
let vxAdminOpen = {};
try { vxAdminOpen = JSON.parse(localStorage.getItem('vxAdminOpen') || '{}'); } catch (e) {}
const vxDefaultOpen = (key) => /오늘의 정기운동|정기운동 종료/.test(key);
const vxIsOpen = (key) => (key in vxAdminOpen ? vxAdminOpen[key] : vxDefaultOpen(key));
function vxSaveOpen() { try { localStorage.setItem('vxAdminOpen', JSON.stringify(vxAdminOpen)); } catch (e) {} }
const vxCardKey = (h) => h.textContent.replace(/\(.*?\)/g, '').replace(/[0-9/·:]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);

window.vxToggleCard = (key, force) => {
  vxAdminOpen[key] = typeof force === 'boolean' ? force : !vxIsOpen(key);
  vxSaveOpen(); vxEnhance();
};
window.vxJumpCard = (key) => {
  vxAdminOpen[key] = true; vxSaveOpen(); vxEnhance();
  const card = [...document.querySelectorAll('[data-vx-key]')].find(c => c.dataset.vxKey === key);
  if (card) {
    const y = card.getBoundingClientRect().top + window.scrollY - (window.innerWidth >= 1024 ? 130 : 120);
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
};
window.vxAllCards = (open) => {
  document.querySelectorAll('[data-vx-key]').forEach(c => { vxAdminOpen[c.dataset.vxKey] = open; });
  vxSaveOpen(); vxEnhance();
};

function vxEnhanceAdmin(app) {
  const root = app.firstElementChild;
  if (!root || !root.classList.contains('space-y-4')) return;
  const cards = [...root.children].slice(1).filter(c => c.id !== 'vxAdminNav');
  const keys = [];
  cards.forEach(card => {
    /* 바깥 상자가 한 겹 더 있는 카드(앱 설치 현황 등)는 안쪽 카드로 내려감 */
    while (card.children.length === 1 && card.firstElementChild.querySelector('h2, h3')) card = card.firstElementChild;
    const h = card.querySelector('h2, h3');
    if (!h) return;
    let head = h;
    while (head.parentElement && head.parentElement !== card) head = head.parentElement;
    if (head === card) return;
    const key = card.dataset.vxKey || vxCardKey(h);
    if (!key) return;
    card.dataset.vxKey = key;
    keys.push(key);
    head.classList.add('vx-head');
    if (!h.querySelector('.vx-fold-chev')) {
      h.classList.add('vx-fold-title');
      h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
      h.insertAdjacentHTML('beforeend', '<svg class="vx-fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
      h.addEventListener('click', () => window.vxToggleCard(card.dataset.vxKey));
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.vxToggleCard(card.dataset.vxKey); } });
    }
    const open = vxIsOpen(key);
    card.classList.toggle('vx-collapsed', !open);
    h.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  /* 바로가기 버튼 줄 */
  let nav = document.getElementById('vxAdminNav');
  if (!nav) {
    nav = document.createElement('div'); nav.id = 'vxAdminNav';
    nav.className = 'bg-white/95 backdrop-blur rounded-2xl shadow-sm border border-gray-100 p-2.5';
    root.insertBefore(nav, root.children[1] || null);
  } else if (nav.parentElement !== root || root.children[1] !== nav) {
    root.insertBefore(nav, root.children[1] || null);
  }
  const html = `<div class="vx-chips">
      <button onclick="vxAllCards(true)" class="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-indigo-950 text-white">모두 펼치기</button>
      <button onclick="vxAllCards(false)" class="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-gray-100 text-gray-700">모두 접기</button>
      ${keys.map(k => `<button onclick="vxJumpCard('${k.replace(/'/g, "\\'")}')" class="shrink-0 text-xs font-bold px-3 py-2 rounded-lg border ${vxIsOpen(k) ? 'bg-indigo-50 text-indigo-800 border-indigo-200' : 'bg-white text-gray-600 border-gray-200'}">${k}</button>`).join('')}
    </div>`;
  if (nav.dataset.html !== html) { nav.dataset.html = html; nav.innerHTML = html; }
}

let vxBusy = false, vxQueued = false;
function vxEnhance() {
  if (vxBusy) return;
  vxBusy = true;
  try {
    const app = document.getElementById('app');
    if (!app) return;
    vxIconize(app);
    if (app.dataset.tab === 'admin') vxEnhanceAdmin(app);
  } catch (e) { console.warn('[vx] UI 다듬기 오류', e); }
  finally { vxBusy = false; }
}
new MutationObserver(() => {
  if (vxQueued) return;
  vxQueued = true;
  queueMicrotask(() => { vxQueued = false; vxEnhance(); });
}).observe(document.getElementById('app'), { childList: true, subtree: true });
vxEnhance();
