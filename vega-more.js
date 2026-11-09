/* VEGA 추가 기능: 경기 기록 · 팀 나누기 · 포지션/실력 프로필 · 월간 리포트 · 연말 결산 · 칭호 축하 팝업 · 다크모드 */
import { collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
const V = window.__vega, db = V.db, S = V.sampleData, U = () => V.user(), esc = V.esc, toast = V.showToast;
const isStaff = () => !!U() && (U().role === 'admin' || U().role === 'coach');
const POS = ['세터', '레프트', '라이트', '센터', '리베로', '올라운더'], LV = ['', '입문', '초급', '중급', '상급', '선출급'];
const t0 = Date.now(), ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
let matches = [], profiles = {};
onSnapshot(collection(db, 'matches'), (s) => { matches = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); inject(); }, () => {});
onSnapshot(collection(db, 'profiles'), (s) => { profiles = {}; s.docs.forEach((d) => { profiles[d.id] = d.data(); }); inject(); }, () => {});

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

/* ---------- 경기 기록 ---------- */
const res = (m) => { let a = 0, b = 0; (m.sets || []).forEach((s) => { if (s.a > s.b) a++; else if (s.b > s.a) b++; }); return { a, b, win: a > b, draw: a === b }; };
const record = (list) => list.reduce((r, m) => { const x = res(m); if (x.win) r.w++; else if (x.draw) r.d++; else r.l++; return r; }, { w: 0, d: 0, l: 0 });
window.vmMatches = () => {
  const r = record(matches);
  const rows = matches.slice(0, 15).map((m) => { const x = res(m); return `<div class="p-2.5 rounded-xl bg-gray-50 border border-gray-100 text-xs">
    <div class="flex justify-between items-center gap-2"><b class="truncate">${esc(m.opponent || '자체 경기')}</b><span class="shrink-0 font-black ${x.win ? 'text-emerald-600' : x.draw ? 'text-gray-500' : 'text-rose-600'}">${x.win ? '승' : x.draw ? '무' : '패'} ${x.a}:${x.b}</span></div>
    <div class="text-[10px] text-gray-400 mt-0.5">${esc(m.date)} · ${(m.sets || []).map((s) => s.a + ':' + s.b).join(' / ')}${m.note ? ' · ' + esc(m.note) : ''}</div>
    ${U() && U().role === 'admin' ? `<button onclick="vmMatchDel('${m.id}')" class="text-[10px] text-rose-500 mt-1">삭제</button>` : ''}</div>`; }).join('');
  const inp = 'p-1.5 border border-gray-300 rounded-lg text-xs w-full';
  const form = isStaff() ? `<div class="mt-4 pt-3 border-t border-gray-100"><p class="text-xs font-black text-gray-800 mb-2">➕ 경기 기록 추가</p>
    <div class="grid grid-cols-2 gap-2 mb-2"><input id="vmMDate" type="date" value="${V.getTodayString()}" class="${inp}"><input id="vmMOpp" placeholder="상대팀 (비우면 자체경기)" maxlength="30" class="${inp}"></div>
    <p class="text-[10px] text-gray-400 mb-1">세트 점수 (우리 : 상대) — 치른 세트만 입력</p>
    ${[1, 2, 3, 4, 5].map((i) => `<div class="flex items-center gap-1.5 mb-1"><span class="text-[10px] text-gray-400 w-8">${i}세트</span><input id="vmA${i}" type="number" min="0" class="${inp}"><span>:</span><input id="vmB${i}" type="number" min="0" class="${inp}"></div>`).join('')}
    <input id="vmMNote" placeholder="메모 (선택)" maxlength="60" class="${inp} mt-1 mb-2"><button onclick="vmMatchSave()" class="w-full ${btn}">저장</button></div>` : '';
  modal(hd('🏐 경기 기록 · 전적') + `<p class="text-xs text-gray-600 mb-3">통산 <b class="text-emerald-600">${r.w}승</b> ${r.d ? r.d + '무 ' : ''}<b class="text-rose-600">${r.l}패</b></p><div class="space-y-1.5">${rows || '<p class="text-xs text-gray-400 py-6 text-center">아직 기록이 없어요.</p>'}</div>${form}`);
};
window.vmMatchSave = async () => {
  const g = (id) => document.getElementById(id), sets = [];
  for (let i = 1; i <= 5; i++) { const a = g('vmA' + i).value, b = g('vmB' + i).value; if (a !== '' && b !== '') sets.push({ a: +a, b: +b }); }
  if (!sets.length) return alert('세트 점수를 입력해 주세요.');
  try { await addDoc(collection(db, 'matches'), { date: g('vmMDate').value || V.getTodayString(), opponent: g('vmMOpp').value.trim(), note: g('vmMNote').value.trim(), sets, by: U().name, createdAt: serverTimestamp() }); toast('경기 기록을 저장했어요 🏐'); window.vmMatches(); }
  catch (e) { console.error(e); alert('저장 중 오류가 발생했어요. (Firestore 규칙에 matches 컬렉션 허용이 필요할 수 있어요)'); }
};
window.vmMatchDel = async (id) => { if (!confirm('이 경기 기록을 삭제할까요?')) return; try { await deleteDoc(doc(db, 'matches', id)); } catch (e) { alert('삭제 중 오류가 발생했어요.'); } };

/* ---------- 포지션 · 실력 프로필 ---------- */
const myProf = () => profiles[U().name] || {};
const saveProf = async (patch) => { try { await setDoc(doc(db, 'profiles', U().name), { ...patch, updatedAt: serverTimestamp() }, { merge: true }); } catch (e) { console.error(e); alert('저장 중 오류가 발생했어요. (Firestore 규칙에 profiles 컬렉션 허용이 필요할 수 있어요)'); } };
window.vmPos = (x) => { const a = [...(myProf().positions || [])], i = a.indexOf(x); if (i >= 0) a.splice(i, 1); else a.push(x); saveProf({ positions: a }); };
window.vmLv = (n) => saveProf({ level: n });

/* ---------- 팀 나누기 (운영진/코치) ---------- */
let ts = { date: null, n: 2, teams: null };
function splitTeams(names, n) {
  const arr = names.map((x) => ({ n: x, lv: (profiles[x] || {}).level || 3, pos: (profiles[x] || {}).positions || [], r: Math.random() })).sort((a, b) => b.lv - a.lv || a.r - b.r);
  const t = Array.from({ length: n }, () => []);
  arr.forEach((p, i) => { const k = i % n; t[Math.floor(i / n) % 2 ? n - 1 - k : k].push(p); });   /* 뱀 드래프트: 실력 균형 */
  return t;
}
window.vmTeams = (reshuffle) => {
  if (!isStaff()) return;
  const today = V.getTodayString(), from = ymd(new Date(Date.now() - 7 * 86400000));
  const evs = S.events.filter((e) => e.type === 'regular' && e.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  if (!evs.length) return modal(hd('⚖️ 팀 나누기') + '<p class="text-xs text-gray-500 py-8 text-center">나눌 정기운동이 없어요.</p>');
  if (!ts.date || !evs.some((e) => e.date === ts.date)) { ts.date = (evs.find((e) => e.date >= today) || evs[0]).date; ts.teams = null; }
  const names = Object.entries(S.regularVotesByDate[ts.date] || {}).filter(([, v]) => v === '참가').map(([k]) => k);
  if (!ts.teams || reshuffle === true) ts.teams = splitTeams(names, ts.n);
  const teams = ts.teams.map((t, i) => `<div class="p-2.5 rounded-xl bg-gray-50 border border-gray-100"><p class="text-xs font-black text-indigo-950 mb-1">팀 ${i + 1} · ${t.length}명 · 평균 실력 ${t.length ? (t.reduce((s, p) => s + p.lv, 0) / t.length).toFixed(1) : '-'}</p>
    <div class="flex flex-wrap gap-1">${t.map((p) => `<span class="text-[11px] bg-white border border-gray-200 rounded-full px-2 py-0.5">${esc(p.n)}${p.pos[0] ? ' <span class="text-gray-400">' + p.pos[0] + '</span>' : ''}</span>`).join('')}</div></div>`).join('');
  modal(hd('⚖️ 팀 나누기') + `<div class="flex gap-2 mb-3"><select onchange="vmTsDate(this.value)" class="flex-1 p-2 border border-gray-300 rounded-xl text-xs font-bold bg-gray-50">${evs.map((e) => `<option value="${e.date}" ${e.date === ts.date ? 'selected' : ''}>${e.date} ${esc(e.title)}</option>`).join('')}</select>
    <select onchange="vmTsN(+this.value)" class="p-2 border border-gray-300 rounded-xl text-xs font-bold bg-gray-50"><option value="2" ${ts.n === 2 ? 'selected' : ''}>2팀</option><option value="3" ${ts.n === 3 ? 'selected' : ''}>3팀</option></select></div>
    <p class="text-[11px] text-gray-500 mb-2">참가 ${names.length}명 기준 · 프로필 실력(미입력은 중급)으로 균형 있게 나눠요.</p>
    <div class="space-y-2 mb-3">${names.length ? teams : '<p class="text-xs text-gray-400 py-6 text-center">참가자가 없어요.</p>'}</div>
    <div class="flex gap-2"><button onclick="vmTeams(true)" class="flex-1 ${btn}">🔀 다시 섞기</button><button onclick="vmTsCopy()" class="flex-1 bg-white border border-gray-300 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl">📋 복사</button></div>`);
};
window.vmTsDate = (d) => { ts.date = d; ts.teams = null; window.vmTeams(); };
window.vmTsN = (n) => { ts.n = n; ts.teams = null; window.vmTeams(); };
window.vmTsCopy = () => copy(`[순천 VEGA 팀 편성 ${ts.date}]\n` + (ts.teams || []).map((t, i) => `팀 ${i + 1}: ${t.map((p) => p.n).join(', ')}`).join('\n'));

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
  const rc = record(matches.filter((m) => (m.date || '').startsWith(key)));
  return { n, c, rate: n ? Math.round(c / n * 100) : 0, team: tot ? Math.round(hit / tot * 100) : 0, best, mineR: rd.filter((d) => R[d][name]).length, posPct: all ? Math.round(pos / all * 100) : null,
    perfect: Object.values(months).filter((m) => m.n >= 2 && m.c === m.n).length, topMonth: top && top[1].c ? top[0] : null, sessions: ev.length, rc };
}
let rp = { mode: 'month', key: null };
window.vmReport = (mode) => { if (!U()) return; if (mode) { rp.mode = mode; rp.key = null; } paintReport(); };
window.vmRpKey = (v) => { rp.key = v; paintReport(); };
function reportLines(st, name) {
  const month = rp.mode === 'month', L = [['출석', `${st.c} / ${st.n}회`], ['출석률', `${st.rate}%  (팀 평균 ${st.team}%)`], ['최고 연속 출석', `${st.best}회`]];
  if (!month) { L.push(['개근한 달', `${st.perfect}번`]); if (st.topMonth) L.push(['가장 많이 나온 달', `${+st.topMonth.slice(5)}월`]); L.push(['올해 정기운동', `${st.sessions}회`]); }
  L.push(['소감·만족도 참여', `${st.mineR}회`]); if (st.posPct !== null) L.push(['팀 만족도(긍정)', `${st.posPct}%`]);
  if (st.rc.w + st.rc.d + st.rc.l) L.push(['팀 경기 전적', `${st.rc.w}승 ${st.rc.d ? st.rc.d + '무 ' : ''}${st.rc.l}패`]);
  L.push(['보유 칭호', `${V.badges(name).filter((b) => b.earned).length}개`]); return L;
}
function paintReport() {
  const ks = [...new Set(V.past().map((e) => e.date.substring(0, rp.mode === 'month' ? 7 : 4)))].sort().reverse();
  const tabs = `<div class="grid grid-cols-2 gap-1.5 mb-3">${[['month', '월간 리포트'], ['year', '연말 결산']].map(([m, l]) => `<button onclick="vmReport('${m}')" class="py-2 rounded-xl text-xs font-bold ${rp.mode === m ? 'bg-indigo-950 text-white' : 'bg-gray-100 text-gray-600'}">${l}</button>`).join('')}</div>`;
  if (!ks.length) return modal(hd('📊 리포트') + tabs + '<p class="text-xs text-gray-500 py-8 text-center">아직 집계된 정기운동이 없어요.</p>');
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
setInterval(checkBadges, 4000);

/* ---------- 다크모드 ---------- */
const isDark = () => document.documentElement.classList.contains('dark');
function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = on ? '#000000' : '#1e1b4b';
  const b = document.getElementById('vmDarkBtn'); if (b) b.textContent = on ? '☀️' : '🌙';
}
window.vmDark = () => { const on = !isDark(); localStorage.setItem('vxDark', on ? '1' : '0'); applyDark(on); inject(); };
(function darkBtn() {
  const b = document.createElement('button'); b.id = 'vmDarkBtn'; b.onclick = window.vmDark; b.setAttribute('aria-label', '다크모드 전환');
  b.style.cssText = 'position:fixed;right:10px;bottom:84px;z-index:60;width:38px;height:38px;border-radius:50%;background:#fff;border:1px solid #d1d5db;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:18px;opacity:.85';
  document.body.appendChild(b); applyDark(isDark());
})();

/* ---------- 홈 · 내 정보 카드 주입 ---------- */
function homeCard() {
  const r = record(matches), last = matches[0], x = last ? res(last) : null;
  return `<section class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100 mb-5"><div class="flex justify-between items-center mb-2"><h2 class="text-sm sm:text-base font-black text-gray-900 flex items-center gap-1.5"><span>🏐</span> 경기 · 팀</h2>
    <span class="text-[11px] font-bold text-gray-500">통산 <b class="text-emerald-600">${r.w}승</b> <b class="text-rose-600">${r.l}패</b></span></div>
    ${last ? `<p class="text-[11px] text-gray-500 mb-2 truncate">최근: ${esc(last.date.substring(5))} ${esc(last.opponent || '자체 경기')} ${x.win ? '승' : x.draw ? '무' : '패'} ${x.a}:${x.b}</p>` : '<p class="text-[11px] text-gray-400 mb-2">아직 경기 기록이 없어요.</p>'}
    <div class="flex gap-2"><button onclick="vmMatches()" class="flex-1 ${btn}">📋 경기 기록</button>${isStaff() ? `<button onclick="vmTeams()" class="flex-1 bg-white border border-gray-300 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl">⚖️ 팀 나누기</button>` : ''}</div></section>`;
}
function myCard() {
  const p = myProf(), pos = p.positions || [], lv = p.level || 0, chip = (on) => on ? 'bg-indigo-950 text-white border-indigo-950' : 'bg-gray-50 text-gray-600 border-gray-200';
  return `<div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mt-4"><h3 class="text-xs sm:text-sm font-black text-gray-900 mb-1 flex items-center gap-1.5"><span>🧩</span> 내 프로필 · 리포트</h3>
    <p class="text-[11px] text-gray-400 mb-2">포지션과 실력은 팀 나누기에 쓰여요. (운영진·코치에게만 활용돼요)</p>
    <p class="text-[11px] font-bold text-gray-700 mb-1">가능 포지션</p><div class="flex flex-wrap gap-1.5 mb-3">${POS.map((x) => `<button onclick="vmPos('${x}')" class="text-[11px] font-bold px-2.5 py-1 rounded-full border ${chip(pos.includes(x))}">${x}</button>`).join('')}</div>
    <p class="text-[11px] font-bold text-gray-700 mb-1">내 실력 (스스로 평가)</p><div class="grid grid-cols-5 gap-1 mb-3">${[1, 2, 3, 4, 5].map((n) => `<button onclick="vmLv(${n})" class="text-[11px] font-bold py-1.5 rounded-lg border ${chip(lv === n)}">${LV[n]}</button>`).join('')}</div>
    <div class="grid grid-cols-2 gap-2"><button onclick="vmReport('month')" class="${btn}">📊 월간 리포트</button><button onclick="vmReport('year')" class="${btn}">🎊 연말 결산</button></div>
    <button onclick="vmDark()" class="w-full mt-2 bg-white border border-gray-300 text-gray-700 text-xs font-bold py-2 rounded-xl">${isDark() ? '☀️ 라이트 모드로 전환' : '🌙 다크 모드로 전환'}</button></div>`;
}
function inject() {
  const app = document.getElementById('app'); if (!app) return;
  const t = V.tab();
  if (t === 'home') {
    let w = document.getElementById('vmHome');
    if (!w) { w = document.createElement('div'); w.id = 'vmHome'; const a = document.getElementById('vxHome') || document.getElementById('homeNotice'); app.insertBefore(w, a ? a.nextSibling : app.firstChild); }
    w.innerHTML = homeCard();
  } else if (t === 'myinfo' && U()) {
    let w = document.getElementById('vmMy'), root = app.firstElementChild;
    if (!w && root) { w = document.createElement('div'); w.id = 'vmMy'; root.appendChild(w); }
    if (w) w.innerHTML = myCard();
  }
}
new MutationObserver(inject).observe(document.getElementById('app'), { childList: true });
inject();
