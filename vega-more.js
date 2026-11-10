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
(function darkBtn() {
  const b = document.createElement('button'); b.id = 'vmDarkBtn'; b.onclick = window.vmDark; b.setAttribute('aria-label', '다크모드 전환');
  b.style.cssText = 'position:fixed;right:10px;bottom:84px;z-index:60;width:38px;height:38px;border-radius:50%;background:#fff;border:1px solid #d1d5db;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:18px;opacity:.85';
  document.body.appendChild(b); applyDark(isDark());
})();

/* ---------- 내 정보 카드 주입 ---------- */
function myCard() {
  return `<div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mt-4"><h3 class="text-xs sm:text-sm font-black text-gray-900 mb-3 flex items-center gap-1.5"><span>📊</span> 리포트 · 화면 설정</h3>
    <div class="grid grid-cols-2 gap-2"><button onclick="vmReport('month')" class="${btn}">📊 월간 리포트</button><button onclick="vmReport('year')" class="${btn}">🎊 연말 결산</button></div>
    <button onclick="vmDark()" class="w-full mt-2 bg-white border border-gray-300 text-gray-700 text-xs font-bold py-2 rounded-xl">${isDark() ? '☀️ 라이트 모드로 전환' : '🌙 다크 모드로 전환'}</button></div>`;
}
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
