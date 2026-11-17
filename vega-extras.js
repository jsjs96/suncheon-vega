/* VEGA 확장 모듈: 코치 엔트리 + 배구 일지 + 코치 탭 + 팀 로고
   index.html 과 같은 폴더에 두면 자동으로 불러와집니다. */
import { collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
const V = window.__vega, db = V.db, sampleData = V.sampleData;
const { showToast, sortMembers, isEventPast, getTodayString } = V;
/* 푸시 알림 기능은 제거되었습니다. 이전에 알림을 켜 둔 기기에 남은 토큰/구독은 한 번 정리합니다. */
(function cleanupOldPush() {
  try {
    const t = localStorage.getItem('vxPushToken');
    if (t) deleteDoc(doc(db, 'fcmTokens', t)).catch(() => {});
    ['vxPush', 'vxPushToken', 'vxPushAt', 'vxPushOff', 'vxPushHide'].forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
})();
/* ============================ 블록 시작 ============================ */
sampleData.lineups = [];

const LINEUP_COURT_SIZE = 9;
const LINEUP_TOTAL = 15;   /* 엔트리 전체 인원: 1~9번 선발, 10~15번 후보 */   /* 9인제: 인원 확인용일 뿐, 위치는 고정되지 않음 */
const lnClampPct = (v) => Math.round(Math.min(94, Math.max(6, v)) * 10) / 10;
let lineupDraft = null;
let lineupDrag = null;

const lnEsc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canEditLineup = () => !!(V.user() && (V.user().role === 'coach' || V.user().role === 'admin'));
const getLineup = (eventId) => (sampleData.lineups || []).find(l => String(l.id) === String(eventId));

function ensureLineupModal() {
  let m = document.getElementById('lineupModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'lineupModal';
  m.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex hidden items-center justify-center p-3';
  m.innerHTML = '<div id="lineupModalBody" class="v2-lineup w-full max-w-md max-h-[92vh] overflow-y-auto" role="dialog" aria-modal="true" aria-label="엔트리"></div>';
  document.body.appendChild(m);
  return m;
}
/* [추가] 엔트리 창이 열려 있는 동안 휴대폰 화면이 꺼지지 않게 (지원하는 기기에서만) */
let lnWake = null;
async function lnWakeOn() {
  try { if ('wakeLock' in navigator && !lnWake) { lnWake = await navigator.wakeLock.request('screen'); lnWake.addEventListener('release', () => { lnWake = null; }); } } catch (e) { lnWake = null; }
}
function lnWakeOff() { try { if (lnWake) lnWake.release(); } catch (e) {} lnWake = null; }
document.addEventListener('visibilitychange', () => {
  const m = document.getElementById('lineupModal');
  if (document.visibilityState === 'visible' && m && !m.classList.contains('hidden')) lnWakeOn();
});
window.closeLineupModal = () => {
  lineupDraft = null;
  const m = document.getElementById('lineupModal');
  if (m) m.classList.add('hidden');
  lnWakeOff();
};

/* ---------- 내 역할 판별 ---------- */
function getMyLineupRole(lineup) {
  if (!V.user() || !lineup) return null;
  const me = V.user().name;
  const p = (lineup.placed || []).find(x => x.name === me);
  if (p) { const i = lnServe(lineup).indexOf(me); return { type: 'court', no: i >= 0 ? i + 1 : null }; }
  const bi = (lineup.bench || []).indexOf(me);
  if (bi >= 0) return { type: 'bench', no: 10 + bi };
  return { type: 'none' };
}

/* ---------- 코트 / 칩 HTML ---------- */
function lineupCourtHTML(placed, interactive, myName, serve, act) {
  const chips = placed.map(p => { const si = (serve || []).indexOf(p.name); return `
    <div ${interactive ? `data-name="${lnEsc(p.name)}" data-from="court"` : ''}
         class="${interactive ? 'lineup-chip cursor-grab' : ''} v2-courtchip ${p.name === myName || p.name === act ? 'is-me' : ''}"
         style="left:${p.x}%;top:${p.y}%;touch-action:none;">${lnNoTag(p.name)}${lnEsc(p.name)}${si >= 0 ? `<i class="sv" aria-label="서브 ${si + 1}번">${si + 1}</i>` : ''}</div>`; }).join('');
  return `
    <div id="lineupCourt" class="v2-court select-none" style="touch-action:none;" aria-label="코트 배치">
      <div class="net" aria-hidden="true"></div><i class="post l" aria-hidden="true"></i><i class="post r" aria-hidden="true"></i>
      <span class="netlab" aria-hidden="true">NET</span>
      <div class="back" aria-hidden="true"></div><div class="attack" aria-hidden="true"></div>
      ${placed.length === 0 && interactive ? '<p class="empty">명단의 이름을 코트로 끌어다 놓거나<br>이름을 누르면 코트에 들어가요</p>' : ''}
      ${chips}
      ${(() => { const p = act && placed.find(x => x.name === act); if (!p) return ''; const below = p.y < 70;
        return `<div class="v2-chipmenu" style="left:${Math.min(78, Math.max(22, p.x))}%;top:${below ? `calc(${p.y}% + 26px)` : `calc(${p.y}% - 26px)`};transform:translate(-50%, ${below ? '0' : '-100%'})" role="menu" aria-label="${lnEsc(p.name)} 메뉴">
          <button type="button" role="menuitem" onclick="window.lineupChipAct('bench')">후보로</button>
          <button type="button" role="menuitem" onclick="window.lineupChipAct('out')" class="is-red">빼기</button>
          <button type="button" role="menuitem" onclick="window.lineupChipAct('close')" aria-label="닫기">✕</button>
        </div>`; })()}
    </div>`;
}
window.lineupChipAct = (what) => {
  const L = lineupDraft; if (!L || !L._act) return;
  syncLineupInputs();
  const n = L._act; L._act = null;
  if (what === 'bench') { removeFromLineup(L, n); L.bench = [n, ...L.bench.filter(x => x !== n)]; }
  else if (what === 'out') removeFromLineup(L, n);
  renderLineupEditor();
};

/* ---------- 에디터 렌더 ---------- */
function syncLineupInputs() {
  if (!lineupDraft) return;
  const memo = document.getElementById('lineupMemo');
  if (memo) lineupDraft.memo = memo.value;
}

function getLineupCandidates(L) {
  const evt = sampleData.events.find(e => String(e.id) === String(L.eventId));
  const votes = (evt && evt.type === 'regular') ? (sampleData.regularVotesByDate[evt.date] || null) : null;
  const names = sortMembers(sampleData.members)
    .filter(m => m.role === 'admin' || m.role === 'member')
    .map(m => m.name);
  const all = [...names, ...(L.guests || [])];
  const used = new Set([...L.placed.map(p => p.name), ...L.bench]);
  return { votes, list: all.filter(n => !used.has(n)) };
}

/* [추가] 초성 검색: 'ㅇㄷ' → 임도윤, 유다인 */
const LN_CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const lnCho = (str) => [...str].map(ch => { const c = ch.charCodeAt(0) - 0xAC00; return (c >= 0 && c <= 11171) ? LN_CHO[Math.floor(c / 588)] : ch; }).join('');
const lnIsCho = (q) => /^[ㄱ-ㅎ]+$/.test(q);
function lnMatch(name, q) {
  if (!q) return null;
  if (/^\d+$/.test(q)) return lnNo(name) === q ? [0, 0] : null;   /* 숫자를 치면 배번으로 찾기 */
  let i = name.indexOf(q);
  if (i < 0 && lnIsCho(q)) i = lnCho(name).indexOf(q);
  return i < 0 ? null : [i, i + q.length];
}
/* [추가] 배번: 회원 명단의 number (운영진이 회원 수정에서 입력) */
const lnNo = (name) => { const m = sampleData.members.find(x => x.name === name); return m && m.number !== undefined && m.number !== null && String(m.number).trim() !== '' ? String(m.number).trim() : ''; };
const lnNoTag = (name) => { const n = lnNo(name); return n ? `<b class="no">${lnEsc(n)}</b>` : ''; };
/* [추가] 서브 순서: 코트에 있는 선수만, 순서대로 */
const lnServe = (L) => (L.serveOrder || []).filter(n => (L.placed || []).some(p => p.name === n));
const LN_SLOTS = [[20, 22], [50, 22], [80, 22], [20, 52], [50, 52], [80, 52], [20, 80], [50, 80], [80, 80]];
function lnAutoPlace(L, name, toCourt) {
  removeFromLineup(L, name);
  /* [변경] 선발(코트) 9명이 차면 다음 사람은 후보로 → 1~9번 선발, 10~15번 후보 */
  if (!toCourt && L.placed.length >= LINEUP_COURT_SIZE) { L.bench.push(name); return; }
  const free = LN_SLOTS.find(([x, y]) => !L.placed.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 10)) || [50, 66];
  L.placed.push({ name, x: free[0], y: free[1] });
}
function lineupSearchHTML(L) {
  const q = (L._q || '').trim();
  if (!q) return '';
  const { votes, list } = getLineupCandidates(L);
  const isGuest = (n) => (L.guests || []).includes(n);
  const hits = list.map(n => ({ n, r: lnMatch(n, q) })).filter(x => x.r).slice(0, 8);
  const exact = sampleData.members.some(m => m.name === q) || isGuest(q) || L.placed.some(p => p.name === q) || L.bench.includes(q);
  const label = (n) => isGuest(n) ? '게스트' : ((lnNo(n) ? lnNo(n) + '번 · ' : '') + '회원' + (votes ? ' · ' + (votes[n] || '미투표') : ''));
  const hl = (n, [a, b]) => `${lnEsc(n.slice(0, a))}<mark>${lnEsc(n.slice(a, b))}</mark>${lnEsc(n.slice(b))}`;
  return `<p class="text-xs v2-mut mt-2 mb-1.5">${hits.length ? `명단에서 ${hits.length}명 찾았어요 · 누르면 코트에 들어가요` : '명단에서 찾지 못했어요'}</p>
    <div class="v2-hits">
      ${hits.map(h => `<button type="button" onclick="window.lineupPick('${lnEsc(h.n)}')"><span>${hl(h.n, h.r)}</span><small>${label(h.n)}</small></button>`).join('')}
      ${!exact && !lnIsCho(q) && !/^\d+$/.test(q) ? `<button type="button" class="add" onclick="window.addLineupGuest(true)"><span>"${lnEsc(q)}" 게스트로 추가</span><small>명단에 없는 사람</small></button>` : ''}
    </div>`;
}
window.lineupSearch = (el) => {
  if (!lineupDraft) return;
  lineupDraft._q = el.value;
  const box = document.getElementById('lineupSearchHits');
  if (box) box.innerHTML = lineupSearchHTML(lineupDraft);
};
window.lineupPick = (name) => {
  if (!lineupDraft) return;
  lnAutoPlace(lineupDraft, name);
  if (lineupDraft.placed.some(p => p.name === name)) lineupDraft.serveOrder = [...lnServe(lineupDraft), name];
  lineupDraft._q = '';
  renderLineupEditor();
};

function lineupServeHTML(L) {
  const order = lnServe(L);
  const rest = L.placed.map(p => p.name).filter(n => !order.includes(n));
  const total = L.placed.length + L.bench.length;
  if (!total) return '';
  const ico = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const UP = 'M6 15l6-6 6 6', DN = 'M6 9l6 6 6-6', X = 'M6 6l12 12M18 6L6 18';
  const starters = order.map((n, i) => `<li>
      <span class="v2-num k">${i + 1}</span><span class="nm">${lnNoTag(n)}${lnEsc(n)}</span>
      <button type="button" onclick="window.lineupServeMove(${i}, -1)" ${i === 0 ? 'disabled' : ''} aria-label="${lnEsc(n)} 앞으로">${ico(UP)}</button>
      <button type="button" onclick="window.lineupServeMove(${i}, 1)" ${(i === order.length - 1 && rest.length) ? 'disabled' : ''} aria-label="${lnEsc(n)} 뒤로${i === order.length - 1 ? ' (후보로)' : ''}">${ico(DN)}</button>
      <button type="button" onclick="window.lineupServeRemove(${i})" aria-label="${lnEsc(n)} 순서에서 빼기">${ico(X)}</button>
    </li>`).join('');
  const subs = L.bench.map((n, i) => `<li class="is-sub">
      <span class="v2-num k">${10 + i}</span><span class="nm">${lnNoTag(n)}${lnEsc(n)}</span>
      <button type="button" onclick="window.lineupBenchMove(${i}, -1)" ${(i === 0 && (L.placed.length >= LINEUP_COURT_SIZE || rest.length)) ? 'disabled' : ''} aria-label="${lnEsc(n)} 앞으로${i === 0 ? ' (선발로)' : ''}">${ico(UP)}</button>
      <button type="button" onclick="window.lineupBenchMove(${i}, 1)" ${i === L.bench.length - 1 ? 'disabled' : ''} aria-label="${lnEsc(n)} 뒤로">${ico(DN)}</button>
      <button type="button" onclick="window.lineupBenchRemove(${i})" aria-label="${lnEsc(n)} 엔트리에서 빼기">${ico(X)}</button>
    </li>`).join('');
  return `<div class="v2-serve">
    <p class="v2-llab">엔트리 순서<span>${total}/${LINEUP_TOTAL}명</span></p>
    <p class="v2-serve-sec">선발 · 서브 순서 <b>1~9번</b><span>${L.placed.length}/${LINEUP_COURT_SIZE}</span></p>
    ${order.length ? `<ol>${starters}</ol>` : ''}
    ${rest.length ? `<p class="text-xs v2-mut mt-2 mb-1.5">코트에 있는 선수예요. 누르는 순서대로 ${order.length + 1}번이 돼요</p>
      <div class="flex flex-wrap gap-1.5">${rest.map(n => `<button type="button" onclick="window.lineupServeAdd('${lnEsc(n)}')" class="v2-lchip" style="cursor:pointer">${lnNoTag(n)}${lnEsc(n)}</button>`).join('')}</div>` : ''}
    ${!L.placed.length ? '<p class="text-xs v2-mut m-0">명단에서 이름을 누르면 1번부터 선발로 들어가요</p>' : ''}
    <p class="v2-serve-sec" style="margin-top:14px">후보 <b>10~15번</b><span>${L.bench.length}/${LINEUP_TOTAL - LINEUP_COURT_SIZE}</span></p>
    ${L.bench.length ? `<ol>${subs}</ol>` : `<p class="text-xs v2-mut m-0">선발 9명이 차면 다음에 누른 사람은 후보로 들어가요</p>`}
    ${total > LINEUP_TOTAL ? `<p class="v2-note" style="margin:10px 0 0;background:#D91920;color:#fff;font-weight:700">엔트리가 ${total}명이에요. ${LINEUP_TOTAL}명까지만 넣어 주세요.</p>` : ''}
  </div>`;
}
const lnSync = () => { syncLineupInputs(); };
window.lineupServeAdd = (name) => { const L = lineupDraft; if (!L) return; lnSync(); L.serveOrder = [...lnServe(L), name]; renderLineupEditor(); };
window.lineupServeRemove = (i) => { const L = lineupDraft; if (!L) return; lnSync(); const o = lnServe(L); o.splice(i, 1); L.serveOrder = o; renderLineupEditor(); };
window.lineupServeMove = (i, d) => {
  const L = lineupDraft; if (!L) return; lnSync();
  const o = lnServe(L);
  if (d > 0 && i === o.length - 1) {
    /* 선발 마지막 → 후보 맨 앞(10번)으로 */
    const n = o[i];
    L.placed = L.placed.filter(p => p.name !== n);
    L.bench = [n, ...L.bench.filter(x => x !== n)];
    L.serveOrder = o.slice(0, i);
    return renderLineupEditor();
  }
  const j = i + d; if (j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]]; L.serveOrder = o; renderLineupEditor();
};
window.lineupBenchMove = (i, d) => {
  const L = lineupDraft; if (!L) return; lnSync();
  if (d < 0 && i === 0) {
    /* 후보 맨 앞(10번) → 선발 마지막 번호로 */
    if (L.placed.length >= LINEUP_COURT_SIZE) return alert(`선발이 이미 ${LINEUP_COURT_SIZE}명이에요. 선발 한 명을 먼저 후보로 내려 주세요.`);
    const n = L.bench[0];
    lnAutoPlace(L, n, true);
    L.serveOrder = [...lnServe(L).filter(x => x !== n), n];
    return renderLineupEditor();
  }
  const j = i + d; if (j < 0 || j >= L.bench.length) return;
  const b = [...L.bench]; [b[i], b[j]] = [b[j], b[i]]; L.bench = b; renderLineupEditor();
};
window.lineupBenchRemove = (i) => { const L = lineupDraft; if (!L) return; lnSync(); L.bench = L.bench.filter((_, k) => k !== i); renderLineupEditor(); };


/* ---------- [추가] 엔트리 공유 이미지 (단톡방에 올리기 좋은 1080×1350 사진) ---------- */
async function lnDrawEntryImage(lu) {
  const body = getComputedStyle(document.body).fontFamily || 'sans-serif';
  try { await Promise.all([document.fonts.load('40px "Black Han Sans"'), document.fonts.load('40px "Alfa Slab One"')]); } catch (e) {}
  /* 높이는 내용에 맞춰서: 메모가 짧거나 없으면 빈 공간 없이 */
  const W = 1080;
  const mc = document.createElement('canvas').getContext('2d');
  mc.font = `500 24px ${body}`;
  const memoLines = [];
  if (lu.memo) {
    String(lu.memo).split('\n').forEach(par => {
      let line = '';
      for (const ch of par.split(' ')) { const t = line ? line + ' ' + ch : ch; if (mc.measureText(t).width > W - 176 && line) { memoLines.push(line); line = ch; } else line = t; }
      memoLines.push(line);
    });
  }
  const nStart = Math.max((lu.placed || []).length, lnServe(lu).length), nBench = (lu.bench || []).length;
  const listEnd = 290 + 14 + nStart * 48 + (nBench ? 36 + nBench * 48 : 0);
  const contentEnd = Math.max(listEnd, 280 + 600 + 6);
  const memoTop = contentEnd + 36, memoH = memoLines.length ? 74 + memoLines.length * 36 : 0;
  const H = (memoLines.length ? memoTop + memoH : contentEnd) + 70;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const F = (px, fam, w) => `${w || ''} ${px}px ${fam}`.trim();
  const DISP = '"Black Han Sans", ' + body, SLAB = '"Alfa Slab One", serif';
  const rr = (x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const fit = (txt, max, px, fam, w) => { let s = px; c.font = F(s, fam, w); while (c.measureText(txt).width > max && s > 14) { s -= 1; c.font = F(s, fam, w); } return s; };

  /* 바탕 · 머리 */
  c.fillStyle = '#EFEFF0'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0A0A0A'; c.fillRect(0, 0, W, 230);
  c.fillStyle = '#D91920'; c.fillRect(0, 230, W, 6);
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#d4d4d8'; c.font = F(22, body, 700); c.fillText('S U N C H E O N', 60, 62);
  c.fillStyle = '#D91920'; c.font = F(40, SLAB); c.fillText('VEGA', 60, 108);
  c.fillStyle = '#FFB61E'; c.font = F(26, DISP); c.textAlign = 'right'; c.fillText('ENTRY', W - 60, 62); c.textAlign = 'left';
  const title = lu.title || '엔트리';
  fit(title, W - 120, 64, DISP); c.fillStyle = '#fff'; c.fillText(title, 60, 180);
  const d = new Date((lu.date || '') + 'T00:00:00');
  const evt = sampleData.events.find(e => String(e.id) === String(lu.eventId || lu.id));
  const sub = [isNaN(d) ? '' : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} (${'일월화수목금토'[d.getDay()]})`, evt && evt.time, evt && evt.location].filter(Boolean).join('  ·  ');
  c.fillStyle = '#a1a1aa'; c.font = F(28, body, 500); c.fillText(sub, 60, 218);

  /* 코트 */
  const cx = 60, cy = 280, cs = 600;
  c.fillStyle = '#e4e4e7'; c.fillRect(cx - 6, cy - 6, cs + 12, cs + 12);
  c.fillStyle = '#1f1113'; c.fillRect(cx, cy, cs, cs);
  c.fillStyle = '#111113'; c.fillRect(cx, cy + cs / 3, cs, cs * 2 / 3);
  c.fillStyle = '#e4e4e7'; c.fillRect(cx, cy + cs / 3 - 2, cs, 4);
  c.fillStyle = '#f4f4f5'; c.fillRect(cx - 6, cy - 6, cs + 12, 12);
  c.fillStyle = '#D91920'; c.fillRect(cx - 6, cy - 6, 12, 22); c.fillRect(cx + cs - 6, cy - 6, 12, 22);
  c.fillStyle = '#8a8a92'; c.font = F(16, body, 900); c.textAlign = 'center'; c.fillText('N E T', cx + cs / 2, cy + 34);
  const serve = lnServe(lu);
  (lu.placed || []).forEach(p => {
    const px = cx + cs * p.x / 100, py = cy + cs * p.y / 100;
    const no = lnNo(p.name);
    const fs = fit(p.name, 130, 26, body, 800);
    c.font = F(18, DISP); const nw = no ? Math.max(26, c.measureText(no).width + 10) : 0;
    c.font = F(fs, body, 800); const tw = c.measureText(p.name).width;
    const w = tw + 30 + (no ? nw + 8 : 0), h = 50;
    rr(px - w / 2, py - h / 2, w, h, 12); c.fillStyle = '#fff'; c.fill();
    let tx = px - w / 2 + 15;
    if (no) { rr(tx, py - 12, nw, 24, 5); c.fillStyle = '#0A0A0A'; c.fill(); c.fillStyle = '#FFB61E'; c.font = F(18, DISP); c.textAlign = 'center'; c.fillText(no, tx + nw / 2, py + 7); tx += nw + 8; }
    c.fillStyle = '#0A0A0A'; c.font = F(fs, body, 800); c.textAlign = 'left'; c.fillText(p.name, tx, py + fs * 0.36); c.textAlign = 'center';
    const si = serve.indexOf(p.name);
    if (si >= 0) { c.beginPath(); c.arc(px + w / 2 - 4, py - h / 2 + 2, 15, 0, Math.PI * 2); c.fillStyle = '#D91920'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#111113'; c.stroke(); c.fillStyle = '#fff'; c.font = F(18, DISP); c.fillText(String(si + 1), px + w / 2 - 4, py - h / 2 + 9); }
  });
  c.textAlign = 'left';

  /* 순서 목록 */
  const lx = 700, lw = W - 60 - lx;
  let y = 290;
  const head = (t, n) => { c.fillStyle = '#6b6b73'; c.font = F(22, body, 800); c.fillText(t, lx, y); c.textAlign = 'right'; c.fillStyle = '#0A0A0A'; c.font = F(24, DISP); c.fillText(n, lx + lw, y); c.textAlign = 'left'; y += 14; };
  const row = (k, name, isSub) => {
    rr(lx, y, lw, 42, 8); c.fillStyle = '#fff'; c.fill();
    c.fillStyle = isSub ? '#8a8a92' : '#D91920'; c.font = F(24, DISP); c.fillText(String(k), lx + 14, y + 30);
    const no = lnNo(name);
    let x = lx + 58;
    if (no) { c.font = F(18, DISP); const nw = Math.max(26, c.measureText(no).width + 10); rr(x, y + 9, nw, 24, 5); c.fillStyle = '#0A0A0A'; c.fill(); c.fillStyle = '#FFB61E'; c.textAlign = 'center'; c.fillText(no, x + nw / 2, y + 28); c.textAlign = 'left'; x += nw + 8; }
    c.fillStyle = '#0A0A0A'; fit(name, lx + lw - x - 10, 24, body, 800); c.fillText(name, x, y + 30);
    y += 48;
  };
  const starters = serve.length ? serve : (lu.placed || []).map(p => p.name);
  head('선발 · 서브 순서', `${(lu.placed || []).length}명`);
  starters.forEach((n, i) => row(serve.length ? i + 1 : '·', n, false));
  (lu.placed || []).map(p => p.name).filter(n => serve.length && !serve.includes(n)).forEach(n => row('·', n, false));
  if ((lu.bench || []).length) { y += 22; head('후보', `${lu.bench.length}명`); lu.bench.forEach((n, i) => row(10 + i, n, true)); }

  /* 메모 */
  if (memoLines.length) {
    rr(60, memoTop, W - 120, memoH, 16); c.fillStyle = '#fff'; c.fill();
    c.fillStyle = '#0A0A0A'; c.font = F(24, body, 900); c.fillText('코치 메모', 88, memoTop + 44);
    c.fillStyle = '#3f3f46'; c.font = F(24, body, 500);
    memoLines.forEach((ln, i) => c.fillText(ln, 88, memoTop + 84 + i * 36));
  }
  c.fillStyle = '#8a8a92'; c.font = F(20, body, 500); c.textAlign = 'right'; c.fillText('VEGA 앱에서 만든 엔트리', W - 60, H - 28); c.textAlign = 'left';
  return cv;
}
window.lineupShareImage = async (src) => {
  const lu = src === 'draft' ? (syncLineupInputs(), lineupDraft) : (sampleData.lineups || []).find(l => String(l.id) === String(src));
  if (!lu) return;
  const btn = document.getElementById('lnShareBtn'); if (btn) { btn.disabled = true; btn.dataset.t = btn.textContent; btn.textContent = '이미지 만드는 중…'; }
  try {
    const cv = await lnDrawEntryImage(lu);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const name = `VEGA_엔트리_${(lu.date || '').replace(/-/g, '')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${lu.title} 엔트리` }); } catch (e) { if (e && e.name !== 'AbortError') throw e; }
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      if (typeof V.showToast === 'function') V.showToast('엔트리 이미지를 저장했어요');
    }
  } catch (e) { console.error(e); alert('이미지를 만들지 못했어요. 다시 시도해 주세요.'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.t || '이미지로 공유'; } }
};

/* [추가] 지난 엔트리 불러오기: 코트 배치 · 서브 순서 · 후보 · 게스트를 그대로 가져와 몇 명만 바꾸기 */
function lineupLoadHTML(L) {
  const others = (sampleData.lineups || []).filter(l => String(l.id) !== String(L.eventId) && ((l.placed || []).length || (l.bench || []).length))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);
  if (!others.length) return '';
  if (!L._loadOpen) return `<button type="button" onclick="window.lineupLoadToggle()" class="v2-btn w-full"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>지난 엔트리 불러오기</button>`;
  return `<div class="v2-load">
    <div class="flex items-center justify-between mb-2"><p class="v2-llab" style="margin:0">지난 엔트리 불러오기</p><button type="button" onclick="window.lineupLoadToggle()" class="v2-btn is-sm">닫기</button></div>
    <p class="text-xs v2-mut mt-0 mb-2">고르면 코트 배치, 서브 순서, 후보가 그대로 들어와요</p>
    ${others.map(l => { const d = new Date((l.date || '') + 'T00:00:00'); const ok = !isNaN(d);
      return `<button type="button" onclick="window.lineupLoadFrom('${lnEsc(String(l.id))}')" class="v2-row">
        <span class="v2-num" style="font-size:18px;width:44px">${ok ? `${d.getMonth() + 1}/${d.getDate()}` : ''}</span>
        <span class="v2-ell font-bold">${lnEsc(l.title || '')}</span>
        <span class="text-xs v2-mut shrink-0">선발 ${(l.placed || []).length} · 후보 ${(l.bench || []).length}</span>
      </button>`; }).join('')}
  </div>`;
}
window.lineupLoadToggle = () => { if (!lineupDraft) return; syncLineupInputs(); lineupDraft._loadOpen = !lineupDraft._loadOpen; renderLineupEditor(); };
window.lineupLoadFrom = (id) => {
  const L = lineupDraft; if (!L) return;
  const src = (sampleData.lineups || []).find(l => String(l.id) === String(id));
  if (!src) return;
  syncLineupInputs();
  if ((L.placed.length || L.bench.length) && !confirm('지금 배치한 선수는 지우고, 고른 엔트리로 바꿀까요?')) return;
  L.placed = (src.placed || []).map(p => ({ ...p }));
  L.bench = [...(src.bench || [])];
  L.serveOrder = [...(src.serveOrder || [])];
  L.guests = [...new Set([...(L.guests || []), ...(src.guests || [])])];
  L._loadOpen = false; L._act = null;
  renderLineupEditor();
  if (typeof V.showToast === 'function') V.showToast('지난 엔트리를 불러왔어요');
};

function renderLineupEditor() {
  syncLineupInputs();
  const L = lineupDraft;
  if (!L) return;
  const body = document.getElementById('lineupModalBody');
  const { votes, list } = getLineupCandidates(L);
  const hasVotes = !!votes;
  const onlyAttend = hasVotes && L._onlyAttend !== false;
  const shown = onlyAttend ? list.filter(n => (votes[n] === '참가') || (L.guests || []).includes(n)) : list;
  const published = L.status === 'published';
  const d = new Date(L.date + 'T00:00:00');

  const rosterChips = shown.length === 0
    ? '<p class="text-xs v2-mut py-2 m-0">표시할 인원이 없습니다.</p>'
    : shown.map(n => {
        const isGuest = (L.guests || []).includes(n);
        const st = hasVotes ? votes[n] : null;
        return `<span class="inline-flex items-center gap-0.5">
          <span data-name="${lnEsc(n)}" data-from="roster" class="lineup-chip v2-lchip" style="touch-action:none;">${lnNoTag(n)}${lnEsc(n)}${st === '참가' ? '<i class="dot" aria-label="참가 투표"></i>' : ''}${isGuest ? '<b class="g">게스트</b>' : ''}</span>
          ${isGuest ? `<button type="button" onclick="window.removeLineupGuest('${lnEsc(n)}')" class="v2-lx" aria-label="${lnEsc(n)} 게스트 빼기">✕</button>` : ''}
        </span>`;
      }).join('');

  const benchChips = L.bench.length === 0
    ? '<p class="text-xs v2-mut m-0">여기로 끌어다 놓으면 교체 명단이 돼요</p>'
    : L.bench.map(n => `<span data-name="${lnEsc(n)}" data-from="bench" class="lineup-chip v2-lchip is-bench" style="touch-action:none;"><i class="sn">${10 + L.bench.indexOf(n)}</i>${lnNoTag(n)}${lnEsc(n)}</span>`).join('');

  body.innerHTML = `
    <header class="v2-lhead">
      <div class="flex items-center justify-between">
        <p class="m-0 text-xs font-bold" style="color:#a1a1aa">엔트리 작성</p>
        <span class="flex items-center gap-1">${L.placed.length ? `<button id="lnShareBtn" onclick="window.lineupShareImage('draft')" class="v2-btn is-sm" style="background:transparent;border-color:#3f3f46;color:#e4e4e7">이미지로 공유</button>` : ''}
        <button onclick="window.closeLineupModal()" class="v2-lclose" aria-label="닫기"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>
      </div>
      <h3 class="v2-num" style="margin:0;font-size:24px;color:#fff">${lnEsc(L.title)}</h3>
      <p class="flex items-center gap-2 text-[13px] mt-1.5 mb-0" style="color:#d4d4d8"><span class="v2-tag ${published ? 'is-red' : 'is-amber'}">${published ? '공개됨' : '초안'}</span>${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]} · ${published ? '회원에게 보여요' : '아직 회원에게 안 보여요'}</p>
      <div class="v2-stats" style="--n:2">
        <div><span class="v2-num"><span style="color:#FFB61E">${L.placed.length}</span><small style="color:#71717a"> / ${LINEUP_COURT_SIZE}</small></span><p>코트</p></div>
        <div><span class="v2-num">${L.bench.length}<small style="color:#71717a"> / ${LINEUP_TOTAL - LINEUP_COURT_SIZE}</small></span><p>후보</p></div>
      </div>
    </header>
    <div class="v2-lmain">
      <div class="v2-lcol is-l">
        <div style="order:2" class="v2-lstack">
      ${lineupCourtHTML(L.placed, true, null, lnServe(L), L._act)}
      <p class="text-xs v2-mut" style="margin:-10px 0 0">선수를 누르면 <b>후보로 · 빼기</b>를 고를 수 있어요. 코트 밖으로 끌어 놓아도 빠져요.</p>
        </div>
        <div style="order:5">
      <div id="lineupBench" class="v2-lbench">
        <p class="v2-llab">후보 (10~15번)<span>끌어 놓으면 후보</span></p>
        <div class="flex flex-wrap gap-1.5">${benchChips}</div>
      </div>
        </div>
      </div>
      <div class="v2-lcol is-r">
        <div style="order:1">${lineupLoadHTML(L)}</div>
        <div style="order:4">${lineupServeHTML(L)}</div>
        <div style="order:6">
      <div id="lineupRoster">
        <div class="flex justify-between items-center mb-2 gap-2">
          <p class="v2-llab" style="margin:0">명단</p>
          ${hasVotes ? `<div class="v2-seg" style="--n:2;padding:2px" role="group" aria-label="명단 보기"><button type="button" onclick="window.toggleLineupAttendFilter(true)" class="${onlyAttend ? 'is-on' : ''}" style="min-height:32px;padding:0 10px;font-size:12px">참가자만</button><button type="button" onclick="window.toggleLineupAttendFilter(false)" class="${!onlyAttend ? 'is-on' : ''}" style="min-height:32px;padding:0 10px;font-size:12px">전체</button></div>` : ''}
        </div>
        <div class="v2-lsearch">
          <label for="lineupGuestInput" class="sr-only">이름 검색</label>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>
          <input id="lineupGuestInput" type="text" value="${lnEsc(L._q || '')}" oninput="window.lineupSearch(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();const b=document.querySelector('#lineupSearchHits button');if(b)b.click();}" placeholder="이름 · 초성(ㅎㄱㄷ) · 배번" autocomplete="off" />
        </div>
        <div id="lineupSearchHits">${lineupSearchHTML(L)}</div>
        <p class="text-xs v2-mut mt-3 mb-1.5">${hasVotes ? (onlyAttend ? '참가 투표한 사람과 게스트' : '전체 명단') + ' · 빨간 점은 참가 투표' : '전체 명단'} · 코트로 끌어다 놓으세요</p>
        <div class="flex flex-wrap gap-1.5">${rosterChips}</div>
      </div>
        </div>
        <div style="order:7">
      <div>
        <label for="lineupMemo" class="v2-llab">코치 메모 · 전술 포인트</label>
        <textarea id="lineupMemo" rows="3" placeholder="예: 리시브는 센터 쪽으로 집중, 서브는 5번 자리 공략" class="w-full p-3 border border-gray-300 rounded-xl text-sm leading-relaxed">${lnEsc(L.memo || '')}</textarea>
      </div>
        </div>
        <div style="order:8" class="flex justify-center">
      ${getLineup(L.eventId) ? `<button onclick="window.deleteLineup()" class="v2-ldel">이 엔트리 삭제</button>` : ''}
        </div>
      </div>
    </div>
    <div class="v2-lbar">
      ${published ? `
        <button onclick="window.saveLineup('draft')" class="v2-btn">비공개로 전환</button>
        <button onclick="window.saveLineup('published')" class="v2-btn is-red">수정 반영</button>
      ` : `
        <button onclick="window.saveLineup('draft')" class="v2-btn">임시저장</button>
        <button onclick="window.saveLineup('published')" class="v2-btn is-red">회원에게 공개</button>
      `}
    </div>
  `;
  bindLineupDrag(body);

  const courtEl = document.getElementById('lineupCourt');
  courtEl.addEventListener('click', (ev) => {
    const D = lineupDraft;
    if (!D || !D._selected || ev.target.closest('.lineup-chip')) return;
    const rect = courtEl.getBoundingClientRect();
    removeFromLineup(D, D._selected);
    D.placed.push({
      name: D._selected,
      x: lnClampPct((ev.clientX - rect.left) / rect.width * 100),
      y: lnClampPct((ev.clientY - rect.top) / rect.height * 100)
    });
    D._selected = null;
    renderLineupEditor();
  });
  const benchEl = document.getElementById('lineupBench');
  benchEl.addEventListener('click', (ev) => {
    const D = lineupDraft;
    if (!D || !D._selected || ev.target.closest('.lineup-chip')) return;
    removeFromLineup(D, D._selected);
    D.bench.push(D._selected);
    D._selected = null;
    renderLineupEditor();
  });
}

/* ---------- 드래그 & 탭 ---------- */
function removeFromLineup(L, name) {
  L.placed = L.placed.filter(p => p.name !== name);
  L.bench = L.bench.filter(n => n !== name);
}

function bindLineupDrag(root) {
  root.querySelectorAll('.lineup-chip').forEach(el => {
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      lineupDrag = { name: el.dataset.name, from: el.dataset.from, sx: ev.clientX, sy: ev.clientY, moved: false, ghost: null };
      document.addEventListener('pointermove', onLineupMove);
      document.addEventListener('pointerup', onLineupUp);
      document.addEventListener('pointercancel', onLineupUp);
    });
  });
}

/* [추가] 끄는 중 화면 위·아래 끝에 가까우면 엔트리 창이 저절로 스크롤 */
let lnScrollTimer = null, lnScrollDir = 0;
function lnAutoScroll(y) {
  const box = document.getElementById('lineupModalBody');
  if (!box) return;
  const r = box.getBoundingClientRect();
  lnScrollDir = y > r.bottom - 70 ? 1 : y < r.top + 70 ? -1 : 0;
  if (lnScrollDir && !lnScrollTimer) {
    lnScrollTimer = setInterval(() => { if (!lnScrollDir || !lineupDrag) { clearInterval(lnScrollTimer); lnScrollTimer = null; return; } box.scrollTop += lnScrollDir * 14; }, 16);
  }
}
function lnZoneAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest('#lineupCourt') ? 'court' : hit.closest('#lineupBench') ? 'bench' : hit.closest('#lineupRoster') ? 'roster' : null;
}

function onLineupMove(ev) {
  const d = lineupDrag;
  if (!d) return;
  if (!d.moved) {
    if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return;
    d.moved = true;
    const g = document.createElement('div');
    g.className = 'fixed z-[80] pointer-events-none v2-ghost';
    g.textContent = d.name;
    document.body.appendChild(g);
    d.ghost = g;
  }
  d.ghost.style.left = ev.clientX + 'px';
  d.ghost.style.top = ev.clientY + 'px';
  d.ghost.style.transform = 'translate(-50%,-140%)';
  /* 코트 밖으로 끌면 '놓으면 빠져요' 표시 */
  if (d.from === 'court') {
    const z = lnZoneAt(ev.clientX, ev.clientY);
    const out = z !== 'court';
    d.ghost.classList.toggle('is-out', out && z !== 'bench');
    d.ghost.textContent = out ? (z === 'bench' ? `${d.name} → 후보` : `${d.name} 빼기`) : d.name;
  }
  lnAutoScroll(ev.clientY);
}

function onLineupUp(ev) {
  document.removeEventListener('pointermove', onLineupMove);
  document.removeEventListener('pointerup', onLineupUp);
  document.removeEventListener('pointercancel', onLineupUp);
  lnScrollDir = 0;
  const d = lineupDrag;
  lineupDrag = null;
  if (!d) return;
  if (d.ghost) d.ghost.remove();
  const L = lineupDraft;
  if (!L) return;

  /* 탭(드래그 아님) */
  if (!d.moved) {
    if (d.from === 'roster') {
      lnAutoPlace(L, d.name);   /* [변경] 이름을 누르면 바로 코트 빈 자리에 들어감 → 끌어서 자유롭게 옮김 */
      if (L.placed.some(p => p.name === d.name)) L.serveOrder = [...lnServe(L), d.name];   /* 누른 순서대로 서브 번호 */
      L._act = null;
    } else if (d.from === 'bench') {
      removeFromLineup(L, d.name);
      L._act = null;
    } else if (d.from === 'court') {
      L._act = L._act === d.name ? null : d.name;   /* [추가] 코트 선수를 누르면 '후보로 · 빼기' 메뉴 */
    }
    syncLineupInputs();
    renderLineupEditor();
    return;
  }
  L._act = null;

  /* 코트 선수를 코트 밖(후보 칸 말고 아무 데나)에 놓으면 엔트리에서 빠짐 */
  if (d.from === 'court') {
    const z = lnZoneAt(ev.clientX, ev.clientY);
    if (z !== 'court' && z !== 'bench') { removeFromLineup(L, d.name); syncLineupInputs(); renderLineupEditor(); return; }
  }

  /* 드롭 */
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!hit) return;
  const zone = hit.closest('#lineupCourt') ? 'court'
             : hit.closest('#lineupBench') ? 'bench'
             : hit.closest('#lineupRoster') ? 'roster' : null;
  if (!zone) return;

  removeFromLineup(L, d.name);

  if (zone === 'court') {
    const rect = document.getElementById('lineupCourt').getBoundingClientRect();
    L.placed.push({
      name: d.name,
      x: lnClampPct((ev.clientX - rect.left) / rect.width * 100),
      y: lnClampPct((ev.clientY - rect.top) / rect.height * 100)
    });
  } else if (zone === 'bench') {
    L.bench.push(d.name);
  }
  L._selected = null;
  renderLineupEditor();
}

/* ---------- 게스트 / 필터 ---------- */
window.toggleLineupAttendFilter = (checked) => {
  if (!lineupDraft) return;
  lineupDraft._onlyAttend = checked;
  renderLineupEditor();
};
window.addLineupGuest = (fromSearch) => {
  if (!lineupDraft) return;
  const input = document.getElementById('lineupGuestInput');
  const name = (input ? input.value : '').trim();
  if (!name) return;
  const exists = sampleData.members.some(m => m.name === name) || (lineupDraft.guests || []).includes(name);
  if (exists) return alert('이미 명단에 있는 이름입니다.');
  lineupDraft.guests = [...(lineupDraft.guests || []), name];
  if (fromSearch) { lnAutoPlace(lineupDraft, name); if (lineupDraft.placed.some(p => p.name === name)) lineupDraft.serveOrder = [...lnServe(lineupDraft), name]; }
  lineupDraft._q = '';
  renderLineupEditor();
};
window.removeLineupGuest = (name) => {
  if (!lineupDraft) return;
  lineupDraft.guests = (lineupDraft.guests || []).filter(n => n !== name);
  removeFromLineup(lineupDraft, name);
  renderLineupEditor();
};

/* ---------- 열기 / 저장 / 삭제 ---------- */
window.openLineupEditor = (eventId) => {
  if (!canEditLineup()) return alert('엔트리 작성은 코치와 운영진만 가능합니다.');
  const evt = sampleData.events.find(e => String(e.id) === String(eventId));
  if (!evt) return;
  window.closeEventDetailModal();

  const ex = getLineup(eventId);
  lineupDraft = {
    eventId: String(evt.id),
    title: evt.title,
    date: evt.date,
    placed: ex ? (ex.placed || []).map(p => ({ ...p })) : [],
    bench: ex ? [...(ex.bench || [])] : [],
    guests: ex ? [...(ex.guests || [])] : [],
    memo: ex ? (ex.memo || '') : '',
    serveOrder: ex ? [...(ex.serveOrder || [])] : [],
    status: ex ? ex.status : 'draft'
  };
  /* [추가] 정기운동 투표에서 회원들이 추가한 게스트도 엔트리 명단에 자동으로 넣음 */
  if (evt.type === 'regular') {
    ((sampleData.regularGuestsByDate || {})[evt.date] || []).filter(g => g && (!g.status || g.status === 'approved')).forEach(g => {   /* 승인된 게스트만 */
      if (g && g.name && !lineupDraft.guests.includes(g.name) && !sampleData.members.some(m => m.name === g.name)) lineupDraft.guests.push(g.name);
    });
  }
  const m = ensureLineupModal();
  m.classList.remove('hidden');
  renderLineupEditor();
  lnWakeOn();
};

window.saveLineup = async (status) => {
  if (!canEditLineup()) return alert('엔트리 작성은 코치와 운영진만 가능합니다.');
  syncLineupInputs();
  const L = lineupDraft;
  if (!L) return;

  if (status === 'published') {
    if (L.placed.length === 0) return alert('코트에 선수를 배치해 주세요.');
    if (L.placed.length !== LINEUP_COURT_SIZE && !confirm(`코트에 ${L.placed.length}명이 배치되어 있습니다 (${LINEUP_COURT_SIZE}명이 아님).\n그대로 공개할까요?`)) return;

    const evt = sampleData.events.find(e => String(e.id) === String(L.eventId));
    if (evt && evt.type === 'regular') {
      const votes = sampleData.regularVotesByDate[evt.date] || {};
      const notAttend = [...L.placed.map(p => p.name), ...L.bench]
        .filter(n => !(L.guests || []).includes(n) && votes[n] !== '참가');
      if (notAttend.length > 0 && !confirm(`참가로 투표하지 않은 인원이 포함되어 있습니다:\n${notAttend.join(', ')}\n\n그대로 공개할까요?`)) return;
    }
  }

  const ex = getLineup(L.eventId);
  const data = {
    eventId: L.eventId,
    title: L.title,
    date: L.date,
    placed: L.placed,
    bench: L.bench,
    serveOrder: lnServe(L),
    guests: L.guests || [],
    memo: (L.memo || '').trim(),
    status: status,
    createdBy: ex && ex.createdBy ? ex.createdBy : V.user().name,
    updatedBy: V.user().name,
    updatedAt: serverTimestamp()
  };
  if (status === 'published') {
    if (!ex || ex.status !== 'published') data.publishedAt = serverTimestamp();
    else data.edited = true;
  }

  try {
    await setDoc(doc(db, "lineups", String(L.eventId)), data, { merge: true });
    showToast(status === 'published' ? '엔트리가 공개되었어요 📢' : '임시저장 되었어요', 2600);
    window.closeLineupModal();
  } catch (err) {
    console.error(err);
    alert('저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
};

window.deleteLineup = async () => {
  if (!canEditLineup() || !lineupDraft) return;
  if (!confirm('이 엔트리를 삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, "lineups", String(lineupDraft.eventId)));
    window.closeLineupModal();
    showToast('엔트리를 삭제했어요');
  } catch (err) {
    console.error(err);
    alert('삭제 중 오류가 발생했습니다.');
  }
};

/* ---------- 보기(전체 열람) ---------- */
window.openLineupView = (eventId) => {
  const lu = getLineup(eventId);
  if (!lu) return alert('등록된 엔트리가 없습니다.');
  if (lu.status !== 'published' && !canEditLineup()) return alert('아직 공개되지 않은 엔트리입니다.');
  window.closeEventDetailModal();

  const myName = V.user() ? V.user().name : null;
  const role = getMyLineupRole(lu);

  const m = ensureLineupModal();
  const d = new Date(lu.date + 'T00:00:00');
  document.getElementById('lineupModalBody').innerHTML = `
    <header class="v2-lhead">
      <div class="flex items-center justify-between">
        <p class="m-0 text-xs font-bold" style="color:#a1a1aa">엔트리</p>
        <button onclick="window.closeLineupModal()" class="v2-lclose" aria-label="닫기"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <h3 class="v2-num" style="margin:0;font-size:24px;color:#fff">${lnEsc(lu.title)}</h3>
      <p class="text-[13px] mt-1.5 mb-0" style="color:#d4d4d8">${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}${lu.edited ? ' · 수정됨' : ''}${lu.status !== 'published' ? ' · <span class="v2-tag is-amber">초안</span>' : ''}</p>
      ${role ? `<p class="m-0 mt-3 text-sm font-bold" style="color:${role.type === 'court' ? '#FFB61E' : '#fff'}">${role.type === 'court' ? `나는 선발이에요${role.no ? ` · 서브 ${role.no}번` : ''}` : role.type === 'bench' ? `나는 후보 ${role.no}번이에요. 준비해 주세요` : '이번 엔트리에는 들어가지 않았어요'}</p>` : ''}
    </header>
    <div class="v2-lmain">
      <div class="v2-lcol is-l"><div style="order:1">
      ${lineupCourtHTML(lu.placed || [], false, myName, lnServe(lu))}
      </div></div>
      <div class="v2-lcol is-r"><div style="order:2" class="v2-lstack">
      ${(lnServe(lu).length || (lu.bench || []).length) ? `<div class="v2-serve"><p class="v2-llab">엔트리 순서</p>
        ${lnServe(lu).length ? `<p class="v2-serve-sec">선발 · 서브 순서</p><ol>${lnServe(lu).map((n, i) => `<li><span class="v2-num k">${i + 1}</span><span class="nm ${n === myName ? 'is-me' : ''}">${lnNoTag(n)}${lnEsc(n)}</span></li>`).join('')}</ol>` : ''}
        ${(lu.bench || []).length ? `<p class="v2-serve-sec" style="margin-top:12px">후보</p><ol>${lu.bench.map((n, i) => `<li class="is-sub"><span class="v2-num k">${10 + i}</span><span class="nm ${n === myName ? 'is-me' : ''}">${lnNoTag(n)}${lnEsc(n)}</span></li>`).join('')}</ol>` : ''}
      </div>` : ''}
      ${lu.memo ? `<div><p class="v2-llab">코치 메모</p><p class="v2-note m-0 whitespace-pre-line">${lnEsc(lu.memo)}</p></div>` : ''}
      <p class="text-xs v2-mut m-0">작성: ${lnEsc(lu.createdBy || '')}</p>
      </div></div>
    </div>
    <div class="v2-lbar"><button onclick="window.closeLineupModal()" class="v2-btn">닫기</button><button id="lnShareBtn" onclick="window.lineupShareImage('${lnEsc(String(lu.id))}')" class="v2-btn is-ink">이미지로 공유</button></div>
  `;
  m.classList.remove('hidden');
  lnWakeOn();
};

/* ---------- 일정 상세 모달에 버튼 주입 ---------- */
window.injectLineupButtons = (evt) => {
  const old = document.getElementById('eventDetailLineupBox');
  if (old) old.remove();
  if (!evt || evt.type === 'dinner') return;

  const lu = getLineup(evt.id);
  const edit = canEditLineup();
  if (!edit && !(lu && lu.status === 'published')) return;

  const box = document.createElement('div');
  box.id = 'eventDetailLineupBox';
  box.className = 'mb-2';
  if (edit) {
    const badge = !lu ? '' : lu.status === 'published'
      ? '<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded ml-1">공개됨</span>'
      : '<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded ml-1">초안</span>';
    box.innerHTML = `
      <button onclick="window.openLineupEditor('${evt.id}')" class="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold py-2.5 rounded-xl text-xs transition">📋 엔트리 ${lu ? '수정' : '작성'}${badge}</button>
      ${lu ? `<button onclick="window.openLineupView('${evt.id}')" class="w-full mt-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 font-bold py-2 rounded-xl text-xs">미리보기</button>` : ''}`;
  } else {
    box.innerHTML = `<button onclick="window.openLineupView('${evt.id}')" class="w-full bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold py-2.5 rounded-xl text-xs transition">📋 엔트리 보기</button>`;
  }
  const inner = document.querySelector('#eventDetailModal > div');
  inner.insertBefore(box, inner.lastElementChild);
};

/* ---------- 홈 카드 ---------- */
function renderLineupHomeCardHTML() {
  const items = (sampleData.lineups || [])
    .filter(l => l.status === 'published')
    .map(l => ({ l, evt: sampleData.events.find(e => String(e.id) === String(l.eventId)) }))
    .filter(x => x.evt && !isEventPast(x.evt))
    .sort((a, b) => a.evt.date.localeCompare(b.evt.date))
    .slice(0, 2);
  if (items.length === 0) return '';

  return `
    <section class="v2-card mb-5" style="border-color:#FFB61E">
      <div class="v2-head"><h2 class="v2-h"><span>📋</span> 엔트리 공개</h2></div>
      <div class="flex flex-col gap-2">
        ${items.map(({ l, evt }) => {
          const r = getMyLineupRole(l);
          const mine = !r ? '' : r.type === 'court' ? `내 자리: 선발${r.no ? ` · 서브 ${r.no}번` : ''}` : r.type === 'bench' ? `후보 ${r.no}번, 준비해 주세요` : '이번 엔트리에는 들어가지 않았어요';
          const t = ({ regular: 'regular', match: 'match', friendly: 'friendly' })[evt.type] || 'etc';
          const d = new Date(evt.date + 'T00:00:00');
          return `
            <button onclick="window.openLineupView('${l.id}')" class="v2-evt">
              <span class="v2-date t-${t}"><b>${d.getDate()}</b><small>${d.getMonth() + 1}월 · ${'일월화수목금토'[d.getDay()]}</small></span>
              <span class="min-w-0 flex-1"><span class="block text-[15px] font-bold truncate">${lnEsc(evt.title)}${l.edited ? ' <span class="text-xs v2-mut font-medium">수정됨</span>' : ''}</span><span class="block text-[13px] mt-0.5 font-bold" style="color:${r && r.type === 'court' ? 'var(--vg-red-text)' : 'var(--vg-faint)'}">${mine || '엔트리를 확인해 보세요'}</span></span>
              <span class="v2-more shrink-0">보기</span>
            </button>`;
        }).join('')}
      </div>
    </section>`;
}

/* ===================== 공통 ===================== */
const U = () => V.user();
const agoStr = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isStaff = () => !!U() && (U().role === 'coach' || U().role === 'admin');
const isCoach = () => !!U() && U().role === 'coach';
const TAGS = ['서브','리시브','토스','스파이크','블로킹','디그','커버','소통'];
const MOODS = [['bad','😅 힘들었어요'],['mid','😐 보통'],['good','😆 좋았어요']];
const MOOD_ICON = { bad: '😅', mid: '😐', good: '😆' };
sampleData.journals = []; sampleData.plan = null;
const newest = (a, b) => (b.date || '').localeCompare(a.date || '') || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
const myJournals = () => sampleData.journals.filter(j => U() && j.author === U().name).sort(newest);
const thisMonth = (l) => l.filter(j => (j.date || '').startsWith(getTodayString().substring(0, 7)));
const topTags = (l, key, n) => { const c = {}; l.forEach(j => (j[key] || []).forEach(t => c[t] = (c[t] || 0) + 1)); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n); };

function modal(html) {
  let m = document.getElementById('vxModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'vxModal';
    m.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex hidden items-center justify-center p-3';
    m.innerHTML = '<div class="bg-white rounded-2xl p-4 w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto"></div>';
    document.body.appendChild(m);
  }
  m.firstChild.innerHTML = html;
  m.classList.remove('hidden');
}
window.vxClose = () => { const m = document.getElementById('vxModal'); if (m) m.classList.add('hidden'); };

/* ===================== 팀 로고 (logo.png 가 있으면 우선 사용, 없으면 SVG) ===================== */
const LOGO_SVG = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 100 100" class="rounded-full shrink-0" role="img" aria-label="Suncheon VEGA"><circle cx="50" cy="50" r="50" fill="#fff"/><g fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"><path d="M30 36c4-12 16-18 30-17"/><path d="M62 24c10 6 14 18 8 30"/><path d="M30 44c-4 12 4 22 18 24"/><path d="M42 32c8 4 14 12 14 22"/><path d="M56 54c-8 2-18 0-24-8"/></g><text x="50" y="82" font-size="11" font-weight="900" text-anchor="middle" fill="#111" font-family="Arial Black,Arial,sans-serif">SUNCHEON</text><text x="50" y="93" font-size="8" text-anchor="middle" fill="#111" letter-spacing="2" font-family="Arial,sans-serif">V.E.G.A</text></svg>`;
function makeLogo(sz, file = 'logo-w.png') {
  const i = new Image();
  i.width = i.height = sz; i.alt = 'VEGA'; i.className = 'rounded-full bg-white shrink-0 object-contain';
  i.onerror = () => { const s = document.createElement('span'); s.innerHTML = LOGO_SVG(sz); i.replaceWith(s.firstChild); };
  i.src = file;
  return i;
}
function applyLogo() {
  const h = document.querySelector('header span.text-xl');
  if (h) h.replaceWith(makeLogo(36, 'logo-mark-w.png'));
  const t = document.querySelector('#loginModal h2');
  if (t && !document.getElementById('vxLoginLogo')) {
    const w = document.createElement('div');
    w.id = 'vxLoginLogo'; w.className = 'flex justify-center mb-2';
    w.appendChild(makeLogo(72, 'logo-w.png'));
    t.parentNode.insertBefore(w, t);
  }
}

/* ===================== 배구 일지 ===================== */
let jd = null, jLimit = 5;
function journalCardHTML() {
  const mine = myJournals(), m = thisMonth(mine);
  const avg = m.length ? (m.reduce((s, j) => s + (j.rating || 0), 0) / m.length).toFixed(1) : '-';
  const tt = topTags(m, 'improveTags', 3);
  const soon = mine.filter((j) => (j.date || '') <= agoStr(358) && (j.date || '') >= agoStr(365)).length;
  return `<section class="v2-card mt-4 sm:mt-5">
    <div class="v2-head">
      <h3 class="v2-h"><span>📓</span> 나의 배구 일지</h3>
      <button onclick="window.vxJournalOpen()" class="v2-btn is-red is-sm">일지 쓰기</button>
    </div>
    ${soon ? `<p class="v2-note" style="background:#D91920;color:#fff;font-weight:700">${soon}개의 일지가 일주일 안에 보관 기간(1년)이 끝나요. 지금 다운로드해 두세요.</p>` : ''}
    <div class="v2-duo">
      <div><p>이번 달 작성</p><span class="v2-num">${m.length}<small>회</small></span></div>
      <div><p>평균 셀프 평가</p><span class="v2-num ${avg === '-' ? 'v2-mut' : ''}">${avg}${avg === '-' ? '' : '<small>점</small>'}</span></div>
    </div>
    ${tt.length ? `<p class="text-[13px] mt-3 mb-0"><span class="v2-mut">자주 적은 아쉬운 기술</span> ${tt.map(([t, c]) => `<strong>${t}</strong> ${c}`).join(' · ')}</p>` : ''}
    <div class="mt-2">
      ${mine.length === 0 ? '<div class="v2-empty"><p>운동 끝나고 30초만 투자해 첫 일지를 남겨 보세요.</p><button onclick="window.vxJournalOpen()" class="v2-btn is-sm">첫 일지 쓰기</button></div>' : ''}
      ${mine.slice(0, jLimit).map(j => `
        <button onclick="window.vxJournalOpen('${j.id}')" class="v2-row" style="display:block">
          <span class="flex justify-between items-center text-xs mb-1"><span class="font-bold">${j.date}</span><span class="v2-mut">${j.sharedWithCoach ? '코치 공유' : '나만 보기'}${(j.coachComments || []).length ? ' · 코치 코멘트' : ''}</span></span>
          <span class="block text-[13px] v2-mut truncate">${lnEsc(j.improve || j.good || j.next || '')}</span>
        </button>`).join('')}
    </div>
    ${mine.length > jLimit ? '<button onclick="window.vxJournalMore()" class="v2-btn w-full mt-2">더보기</button>' : ''}
    <div class="flex items-center justify-between gap-2 mt-3 pt-3" style="border-top:1px solid var(--vg-line)">
      <p class="text-xs v2-mut m-0">일지는 1년 보관돼요</p>
      <button onclick="window.vxJournalDownload()" class="v2-btn is-sm">내 일지 다운로드</button>
    </div>
  </section>`;
}
window.vxJournalDownload = () => {
  const rows = myJournals().slice().reverse();
  if (!rows.length) return alert('다운로드할 일지가 없습니다.');
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['날짜', '컨디션', '역할', '잘된 것', '아쉬운 것', '아쉬운 기술', '다음에 해볼 것', '다음 기술', '셀프 평가', '코치 공유', '코치 코멘트'];
  const moodName = { bad: '힘들었어요', mid: '보통', good: '좋았어요' };
  const line = (j) => [j.date, moodName[j.mood] || '', j.role, j.good, j.improve, (j.improveTags || []).join(', '), j.next, (j.nextTags || []).join(', '), j.rating, j.sharedWithCoach ? '공유' : '나만 보기', (j.coachComments || []).map((c) => c.by + ': ' + c.text).join(' / ')].map(q).join(',');
  const csv = '\ufeff' + [head.map(q).join(','), ...rows.map(line)].join('\r\n');
  window.vxDownload('배구일지_' + U().name + '_' + getTodayString() + '.csv', csv, 'text/csv;charset=utf-8');
  showToast('일지를 내려받았어요 (엑셀로 열 수 있어요)', 3000);
};
window.vxJournalMore = () => { jLimit += 5; paint(); };

function jSync() {
  if (!jd) return;
  [['jDate', 'date'], ['jRole', 'role'], ['jGood', 'good'], ['jImprove', 'improve'], ['jNext', 'next']].forEach(([id, k]) => { const e = document.getElementById(id); if (e) jd[k] = e.value; });
}
window.vxJournalOpen = (id) => {
  if (!U()) return window.openLoginModal();
  const ex = id && sampleData.journals.find(j => j.id === id);
  if (ex && ex.author !== U().name) return;
  jd = ex ? { ...ex, improveTags: [...(ex.improveTags || [])], nextTags: [...(ex.nextTags || [])] }
          : { id: null, date: getTodayString(), eventId: '', role: '', mood: 'good', good: '', improve: '', next: '', improveTags: [], nextTags: [], rating: 3, sharedWithCoach: false, coachComments: [] };
  jRender();
};
window.vxTag = (key, t) => { jSync(); const a = jd[key], i = a.indexOf(t); if (i >= 0) a.splice(i, 1); else a.push(t); jRender(); };
window.vxSet = (k, v) => { jSync(); jd[k] = v; jRender(); };
window.vxPickEvent = (id) => { jSync(); const e = sampleData.events.find(x => String(x.id) === String(id)); jd.eventId = id; if (e) jd.date = e.date; jRender(); };
function tagRow(key) {
  const on = key === 'improveTags' ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-indigo-100 text-indigo-800 border-indigo-300';
  return TAGS.map(t => `<button type="button" onclick="window.vxTag('${key}','${t}')" class="px-2.5 py-1 rounded-full text-[11px] font-bold border ${jd[key].includes(t) ? on : 'bg-white text-gray-500 border-gray-300'}">${t}</button>`).join('');
}
function jRender() {
  const votes = sampleData.regularVotesByDate || {};
  const evts = sampleData.events.filter(e => e.type === 'regular' && (isEventPast(e) || e.date === getTodayString()) && (votes[e.date] || {})[U().name] === '참가').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const prev = myJournals().find(j => j.id !== jd.id && j.next);
  const fld = (id, label, val, ph) => `<label class="block text-xs font-bold text-gray-700 mt-3 mb-1">${label}</label><input id="${id}" value="${lnEsc(val || '')}" placeholder="${ph}" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs" />`;
  modal(`
    <div class="flex justify-between items-center mb-2 pb-2 border-b"><h3 class="text-sm font-black text-indigo-950">📓 배구 일지</h3><button onclick="window.vxClose()" class="text-gray-400 font-bold text-lg">&times;</button></div>
    <p class="text-[10px] text-gray-400 mb-2">📌 일지는 작성일로부터 1년간 보관돼요.</p>
    ${prev ? `<p class="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 mb-2">💡 지난번 다짐: ${lnEsc(prev.next)}</p>` : ''}
    <label class="block text-xs font-bold text-gray-700 mb-1">운동 선택 (참가한 정기운동)</label>
    <select onchange="window.vxPickEvent(this.value)" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs bg-white"><option value="">직접 날짜 입력</option>${evts.map(e => `<option value="${e.id}" ${String(e.id) === String(jd.eventId) ? 'selected' : ''}>${e.date} ${lnEsc(e.title)}</option>`).join('')}</select>
    <input id="jDate" type="date" value="${jd.date}" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs mt-2" />
    <label class="block text-xs font-bold text-gray-700 mt-3 mb-1">컨디션</label>
    <div class="grid grid-cols-3 gap-1.5">${MOODS.map(([k, l]) => `<button type="button" onclick="window.vxSet('mood','${k}')" class="py-2 rounded-xl text-[11px] font-bold border ${jd.mood === k ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-white text-gray-500 border-gray-300'}">${l}</button>`).join('')}</div>
    ${fld('jRole', '오늘 한 역할', jd.role, '예: 전위 레프트, 후반엔 후위 수비')}
    ${fld('jGood', '잘된 것', jd.good, '한 줄이면 충분해요')}
    ${fld('jImprove', '아쉬운 것', jd.improve, '한 줄이면 충분해요')}
    <div class="flex flex-wrap gap-1.5 mt-2">${tagRow('improveTags')}</div>
    ${fld('jNext', '다음에 해볼 것', jd.next, '다음 운동 때 시도할 것')}
    <div class="flex flex-wrap gap-1.5 mt-2">${tagRow('nextTags')}</div>
    <label class="block text-xs font-bold text-gray-700 mt-3 mb-1">셀프 평가</label>
    <div class="flex gap-1">${[1, 2, 3, 4, 5].map(n => `<button type="button" onclick="window.vxSet('rating',${n})" class="text-2xl ${n <= jd.rating ? 'text-amber-400' : 'text-gray-300'}">★</button>`).join('')}</div>
    <label class="flex items-center justify-between mt-3 p-3 bg-gray-50 rounded-xl text-xs font-bold text-gray-800">코치에게 공유<input type="checkbox" ${jd.sharedWithCoach ? 'checked' : ''} onchange="window.vxSet('sharedWithCoach',this.checked)" class="w-4 h-4" /></label>
    ${(jd.coachComments || []).length ? `<div class="mt-3 space-y-1">${jd.coachComments.map(c => `<p class="text-[11px] bg-indigo-50 border border-indigo-100 text-indigo-900 rounded-xl px-3 py-2">🧢 ${lnEsc(c.by)}: ${lnEsc(c.text)}</p>`).join('')}</div>` : ''}
    <div class="flex gap-2 mt-4"><button onclick="window.vxClose()" class="w-1/2 bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs">취소</button><button onclick="window.vxJournalSave()" class="w-1/2 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">저장</button></div>
    ${jd.id ? '<button onclick="window.vxJournalDel()" class="w-full mt-2 text-[11px] text-rose-600 font-bold py-1.5">🗑️ 이 일지 삭제</button>' : ''}`);
}
window.vxJournalSave = async () => {
  jSync();
  if (!(jd.good.trim() || jd.improve.trim() || jd.next.trim())) return alert('잘된 것, 아쉬운 것, 다음에 해볼 것 중 하나는 적어 주세요.');
  const data = { author: U().name, date: jd.date, eventId: jd.eventId || '', role: jd.role.trim(), mood: jd.mood, good: jd.good.trim(), improve: jd.improve.trim(), next: jd.next.trim(), improveTags: jd.improveTags, nextTags: jd.nextTags, rating: jd.rating, sharedWithCoach: !!jd.sharedWithCoach, updatedAt: serverTimestamp() };
  try {
    if (jd.id) await setDoc(doc(db, 'journals', jd.id), data, { merge: true });
    else await addDoc(collection(db, 'journals'), { ...data, coachComments: [], createdAt: serverTimestamp() });
    showToast('일지를 저장했어요 📓'); window.vxClose();
  } catch (e) { console.error(e); alert('저장 중 오류가 발생했습니다.'); }
};
window.vxJournalDel = async () => {
  if (!jd || !jd.id || !confirm('이 일지를 삭제하시겠습니까?')) return;
  try { await deleteDoc(doc(db, 'journals', jd.id)); window.vxClose(); } catch (e) { alert('삭제 중 오류가 발생했습니다.'); }
};

/* ===================== 코치 탭 ===================== */
let planDraft = null, coachJLimit = 5;
window.vxCoachOpen = (id) => {
  if (!isCoach()) return;
  const j = sampleData.journals.find(x => x.id === id);
  if (!j) return;
  const tg = (a, c) => (a || []).map(t => `<span class="text-[10px] px-1.5 py-0.5 rounded-full ${c}">${t}</span>`).join(' ');
  modal(`
    <div class="flex justify-between items-center mb-2 pb-2 border-b"><h3 class="text-sm font-black text-indigo-950">${lnEsc(j.author)} · ${j.date}</h3><button onclick="window.vxClose()" class="text-gray-400 font-bold text-lg">&times;</button></div>
    <p class="text-xs text-gray-500 mb-2">${MOOD_ICON[j.mood] || ''} ${lnEsc(j.role || '역할 미기재')} · 셀프 평가 ${'★'.repeat(j.rating || 0)}</p>
    ${j.good ? `<p class="text-xs mb-2"><strong>잘된 것</strong><br/>${lnEsc(j.good)}</p>` : ''}
    ${j.improve ? `<p class="text-xs mb-2"><strong>아쉬운 것</strong><br/>${lnEsc(j.improve)}<br/>${tg(j.improveTags, 'bg-rose-100 text-rose-800')}</p>` : ''}
    ${j.next ? `<p class="text-xs mb-2"><strong>다음에 해볼 것</strong><br/>${lnEsc(j.next)}<br/>${tg(j.nextTags, 'bg-indigo-100 text-indigo-800')}</p>` : ''}
    ${(j.coachComments || []).map(c => `<p class="text-[11px] bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mb-1">🧢 ${lnEsc(c.by)}: ${lnEsc(c.text)}</p>`).join('')}
    <textarea id="vxCmt" rows="3" placeholder="코멘트를 남기면 작성자만 볼 수 있어요" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs mt-2"></textarea>
    <div class="flex gap-2 mt-3"><button onclick="window.vxClose()" class="w-1/2 bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs">닫기</button><button onclick="window.vxCoachSend('${j.id}')" class="w-1/2 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">코멘트 등록</button></div>`);
};
window.vxCoachSend = async (id) => {
  const text = document.getElementById('vxCmt').value.trim();
  const j = sampleData.journals.find(x => x.id === id);
  if (!text || !j) return alert('코멘트를 입력해 주세요.');
  try {
    await updateDoc(doc(db, 'journals', id), { coachComments: [...(j.coachComments || []), { by: U().name, text, date: getTodayString() }] });
    showToast('코멘트를 남겼어요'); window.vxClose();
  } catch (e) { alert('등록 중 오류가 발생했습니다.'); }
};
window.vxCoachMore = () => { coachJLimit += 5; renderCoach(document.getElementById('app')); };
window.vxPlanInput = (el) => { planDraft = el.value; };
window.vxPlanSave = async () => {
  const text = (planDraft ?? (sampleData.plan ? sampleData.plan.text : '') ?? '').trim();
  try { await setDoc(doc(db, 'trainingPlans', 'current'), { text, by: U().name, updatedAt: serverTimestamp() }); planDraft = null; showToast('훈련 계획을 저장했어요 🏋️'); }
  catch (e) { alert('저장 중 오류가 발생했습니다.'); }
};

function renderCoach(app) {
  if (!app) return;
  if (!isStaff()) {
    app.innerHTML = `<div class="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100 max-w-md mx-auto my-8"><span class="text-4xl block mb-3">🧢</span><h3 class="text-base font-black text-gray-900 mb-2">코치 전용 페이지</h3><p class="text-xs text-gray-500 mb-5">코치 계정으로 로그인 후 이용해 주세요.</p><button onclick="window.openLoginModal()" class="bg-indigo-950 text-white font-bold text-xs px-5 py-2.5 rounded-xl">로그인 하기</button></div>`;
    return;
  }
  const upcoming = sampleData.events.filter(e => !isEventPast(e) && e.type !== 'dinner').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const luOf = (id) => (sampleData.lineups || []).find(l => String(l.id) === String(id));
  const names = { regular: '정기', match: '대회', etc: '기타' };
  const starts = {};
  (sampleData.lineups || []).filter(l => l.status === 'published').forEach(l => (l.placed || []).forEach(p => starts[p.name] = (starts[p.name] || 0) + 1));
  const startList = Object.entries(starts).sort((a, b) => b[1] - a[1]);
  const shared = sampleData.journals.filter(j => j.sharedWithCoach).sort(newest);
  const unreplied = shared.filter(j => !(j.coachComments || []).length);
  const sm = thisMonth(shared), tt = topTags(sm, 'improveTags', 5);
  const bad = sm.filter(j => j.mood === 'bad').length;
  const plan = planDraft ?? (sampleData.plan ? sampleData.plan.text : '');
  const card = (inner) => `<div class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100">${inner}</div>`;

  const typeKey = (t) => ({ regular: 'regular', match: 'match', friendly: 'friendly' })[t] || 'etc';
  const typeShort = { regular: '정기', match: '대회', friendly: '친선', etc: '기타' };
  const maxStart = startList.length ? startList[0][1] : 0;
  const maxTag = tt.length ? tt[0][1] : 0;
  app.innerHTML = `<div class="space-y-4 sm:space-y-5">
    <section class="v2-plate" aria-label="코치 요약">
      <span class="v2-tag is-amber">코치 모드</span>
      <h2 class="v2-num" style="margin:8px 0 0;font-size:24px;color:#fff">코치 대시보드</h2>
      ${isCoach() ? `<div class="v2-stats">
        <div><span class="v2-num ${unreplied.length ? 'is-amber' : ''}">${unreplied.length}<small>건</small></span><p>코멘트 대기</p></div>
        <div><span class="v2-num">${sm.length}<small>건</small></span><p>이번 달 공유 일지</p></div>
        <div><span class="v2-num">${sm.length ? Math.round(bad / sm.length * 100) : 0}<small>%</small></span><p>힘들었다 응답</p></div>
      </div>` : '<p class="text-xs mt-2 mb-0" style="color:#a1a1aa">운영진은 엔트리와 훈련 계획을 볼 수 있어요</p>'}
    </section>
    <section class="v2-card" aria-label="엔트리">
      <div class="v2-head" style="margin-bottom:4px"><h3 class="v2-h"><span>📋</span> 엔트리</h3></div>
      <p class="v2-sub" style="margin:0 0 8px">다가오는 일정마다 선발 명단을 짜 두세요</p>
      ${upcoming.length === 0 ? `<div class="v2-empty"><p>엔트리를 짤 다가오는 일정이 없어요.</p><button onclick="window.switchTab('calendar')" class="v2-btn is-sm">일정 보기</button></div>` : ''}
      ${upcoming.map(e => { const l = luOf(e.id); const st = !l ? ['미작성', 'is-line'] : l.status === 'published' ? ['공개됨', 'is-ink'] : ['초안', 'is-amber'];
        const d = new Date(e.date + 'T00:00:00'); const k = typeKey(e.type);
        return `<div class="v2-entry">
          <span class="v2-date t-${k}" style="width:48px"><b style="font-size:20px">${d.getDate()}</b><small>${typeShort[k]}</small></span>
          <span class="min-w-0 flex-1"><span class="block text-sm font-bold truncate">${lnEsc(e.title)}</span><span class="flex items-center gap-1.5 mt-1"><span class="v2-tag ${st[1]}">${st[0]}</span><span class="text-xs v2-mut">${d.getMonth() + 1}/${d.getDate()} ${e.time || ''}</span></span></span>
          <button onclick="window.openLineupEditor('${e.id}')" class="v2-btn ${l ? '' : 'is-red'}" style="min-height:40px">${l ? '수정' : '작성'}</button>
        </div>`; }).join('')}
      ${startList.length ? `<p class="text-[13px] font-black mt-3 mb-2 pt-3" style="border-top:1px solid var(--vg-line)">선발 횟수 <span class="text-xs font-medium v2-mut">공개된 엔트리 기준</span></p>
        <div class="flex flex-col gap-1.5">${startList.slice(0, 12).map(([n, c]) => `<div class="v2-starter"><span class="truncate">${lnEsc(n)}</span><span class="v2-meter"><span style="width:${maxStart ? Math.round(c / maxStart * 100) : 0}%"></span></span><span class="v2-num">${c}</span></div>`).join('')}</div>` : ''}
    </section>
    <section class="v2-card" aria-label="이번 주 훈련 계획">
      <div class="v2-head" style="margin-bottom:4px"><h3 class="v2-h"><span>🏋️</span> 이번 주 훈련 계획</h3></div>
      <p class="v2-sub" style="margin:0 0 10px">저장하면 모든 회원의 홈에 보여요</p>
      <label for="vxPlanInput" class="sr-only">훈련 계획</label>
      <textarea id="vxPlanInput" rows="4" oninput="window.vxPlanInput(this)" placeholder="예: 이번 주는 리시브 집중. 2인 1조 리시브 → 토스 연결 20분" class="w-full p-3 border border-gray-300 rounded-xl text-sm leading-relaxed">${lnEsc(plan)}</textarea>
      <button onclick="window.vxPlanSave()" class="v2-btn is-ink w-full mt-2" style="min-height:48px">훈련 계획 저장</button>
    </section>
    ${isCoach() ? `<section class="v2-card" aria-label="회원 일지">
      <div class="v2-head" style="margin-bottom:4px"><h3 class="v2-h"><span>📓</span> 회원 일지</h3></div>
      <p class="v2-sub" style="margin:0 0 12px">공유를 켠 일지만 보여요 · 코멘트 안 단 글이 위로</p>
      ${tt.length ? `<div class="v2-plate" style="padding:14px;border-radius:12px;margin-bottom:8px">
        <p class="text-[13px] font-bold m-0 mb-2.5">이번 달 팀이 아쉬워한 기술</p>
        ${tt.map(([t, c], i) => `<div class="v2-skill"><span class="v2-num" style="color:${i === 0 ? '#FFB61E' : '#71717a'}">${i + 1}</span><span>${lnEsc(t)}</span><span class="v2-meter ${i === 0 ? 'is-amber' : ''}"><span style="width:${maxTag ? Math.round(c / maxTag * 100) : 0}%"></span></span><span class="v2-num">${c}</span></div>`).join('')}
      </div>` : ''}
      ${shared.length === 0 ? '<div class="v2-empty"><p>회원이 일지를 쓰고 코치 공유를 켜면 여기에 모여요.</p></div>' : ''}
      ${[...unreplied, ...shared.filter(j => (j.coachComments || []).length)].slice(0, coachJLimit).map(j => { const done = (j.coachComments || []).length;
        return `<button onclick="window.vxCoachOpen('${j.id}')" class="v2-row" style="display:block">
          <span class="flex items-center gap-1.5 text-sm font-bold">${lnEsc(j.author)}<span class="text-xs font-medium v2-mut">${(j.date || '').substring(5)}</span><span class="v2-tag ml-auto ${done ? 'is-soft' : 'is-red'}">${done ? '코멘트 완료' : '코멘트 필요'}</span></span>
          <span class="block text-[13px] v2-mut mt-1 truncate">${lnEsc(j.improve || j.good || j.next || '')}</span>
        </button>`; }).join('')}
      ${shared.length > coachJLimit ? '<button onclick="window.vxCoachMore()" class="v2-btn w-full mt-2">더보기</button>' : ''}
    </section>` : ''}
  </div>`;
}

/* ===================== 탭/화면 연결 ===================== */
function planCardHTML() {
  const t = sampleData.plan && sampleData.plan.text;
  return t ? `<section class="v2-card mb-5"><div class="v2-head" style="margin-bottom:8px"><h2 class="v2-h"><span>🏋️</span> 이번 주 훈련</h2></div><p class="text-sm leading-relaxed whitespace-pre-line m-0">${lnEsc(t)}</p></section>` : '';
}
function installCardHTML() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone || localStorage.getItem('vxInstallHide')) return '';
  const wrap = (inner) => `<section class="v2-card mb-5"><div class="flex justify-between items-start gap-2"><div class="text-sm leading-relaxed">${inner}</div><button onclick="window.vxInstallHide()" class="v2-lclose" style="color:var(--vg-faint);margin:-8px -8px 0 0" aria-label="설치 안내 닫기">&times;</button></div></section>`;
  if (window.__deferredInstall) return wrap('<p class="font-black text-gray-900 mb-1">📲 홈 화면에 앱으로 설치</p><p class="mb-2">설치하면 아이콘으로 바로 열려요.</p><button onclick="window.vxInstall()" class="v2-btn is-ink is-sm">앱 설치하기</button>');
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return wrap('<p class="font-black text-gray-900 mb-1">📲 홈 화면에 앱으로 설치</p><p>Safari 하단의 <strong>공유 버튼</strong> → <strong>홈 화면에 추가</strong>를 눌러 주세요.</p>');
  return '';
}
window.vxInstall = async () => { const p = window.__deferredInstall; if (!p) return; p.prompt(); try { await p.userChoice; } catch (e) {} window.__deferredInstall = null; paint(); };
window.vxInstallHide = () => { localStorage.setItem('vxInstallHide', '1'); paint(); };
window.__vegaPaint = () => paint();
/* ===================== 앱 설치 현황 ===================== */
function reportStatus(force) {
  const u = U();
  if (!u) return;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ua = navigator.userAgent, platform = /iphone|ipad|ipod/i.test(ua) ? 'ios' : /android/i.test(ua) ? 'android' : 'pc';
  const key = [u.name, standalone, platform].join('|');
  if (!force && key === localStorage.getItem('vxStatusKey') && Date.now() - Number(localStorage.getItem('vxStatusAt') || 0) < 6 * 3600 * 1000) return;
  localStorage.setItem('vxStatusKey', key); localStorage.setItem('vxStatusAt', String(Date.now()));
  const data = { name: u.name, platform, lastSeen: serverTimestamp() };
  data[standalone ? 'standaloneAt' : 'browserAt'] = serverTimestamp();
  setDoc(doc(db, 'appStatus', u.name), data, { merge: true }).catch(() => {});
}
let stUnsub = null, stKey = null;
sampleData.appStatus = {};
function bindStatus() {
  const u = U(), key = u && u.role === 'admin' ? u.name : '';
  if (key === stKey) return;
  stKey = key;
  if (stUnsub) { stUnsub(); stUnsub = null; }
  sampleData.appStatus = {};
  if (!key) return;
  stUnsub = onSnapshot(collection(db, 'appStatus'), (s) => { const o = {}; s.docs.forEach((d) => { o[d.id] = d.data(); }); sampleData.appStatus = o; paint(); });
}
const tsMs = (t) => (t && (t.toMillis ? t.toMillis() : t.seconds ? t.seconds * 1000 : 0)) || 0;
const agoText = (t) => { const ms = tsMs(t); if (!ms) return '-'; const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? '오늘' : d + '일 전'; };
function statusRows() {
  const st = sampleData.appStatus || {};
  return sortMembers(sampleData.members).map((m) => {
    const s = st[m.name] || null;
    const inst = s && s.standaloneAt ? 'app' : s && s.browserAt ? 'web' : 'none';
    const rest = m.role === 'rest';
    const stale = s && tsMs(s.lastSeen) && Date.now() - tsMs(s.lastSeen) > 14 * 86400000;
    return { name: m.name, rest, s, inst, stale, problem: !rest && inst !== 'app' };
  });
}
function statusCardHTML() {
  const rows = statusRows(), active = rows.filter((r) => !r.rest);
  const appN = active.filter((r) => r.inst === 'app').length, webN = active.filter((r) => r.inst === 'web').length;
  const instLabel = { app: '<span class="text-emerald-700">📲 설치 앱</span>', web: '<span class="text-amber-700">🌐 브라우저만</span>', none: '<span class="text-gray-400">❔ 기록 없음</span>' };
  const plat = { ios: 'iOS', android: '안드로이드', pc: 'PC' };
  const sorted = [...rows].sort((a, b) => (b.problem - a.problem) || a.name.localeCompare(b.name, 'ko'));
  return `<div class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100">
    <h3 class="text-xs sm:text-sm font-black text-gray-900 mb-1 flex items-center gap-1.5"><span>📲</span> 앱 설치 현황</h3>
    <p class="text-[11px] text-gray-400 mb-3 leading-relaxed">회원이 <strong>새 버전으로 앱을 한 번 열어야</strong> 기록돼요. 설치만 하고 열지 않은 경우는 알 수 없어요. (쉼회원은 집계 제외)</p>
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="bg-gray-50 rounded-xl p-3 text-center"><span class="text-[11px] text-gray-500 block">설치 앱으로 접속</span><span class="text-lg font-black text-indigo-950">${appN} / ${active.length}명</span></div>
      <div class="bg-gray-50 rounded-xl p-3 text-center"><span class="text-[11px] text-gray-500 block">브라우저로만 접속</span><span class="text-lg font-black text-indigo-950">${webN} / ${active.length}명</span></div>
    </div>
    <div class="space-y-1.5 max-h-96 overflow-y-auto">
      ${sorted.map((r) => `<div class="flex items-center justify-between gap-2 p-2 rounded-xl text-xs ${r.problem ? 'bg-rose-50' : 'bg-gray-50'} ${r.rest ? 'opacity-50' : ''}">
        <span class="font-bold text-gray-900 min-w-0 truncate">${lnEsc(r.name)}${r.rest ? ' <span class="text-[10px] text-gray-400">쉼</span>' : ''}</span>
        <span class="flex items-center gap-2 shrink-0 text-[11px]">${instLabel[r.inst]}<span class="text-gray-400 w-14 text-right">${r.s ? agoText(r.s.lastSeen) : '-'}${r.stale ? ' ⚠️' : ''}</span></span>
      </div>`).join('')}
    </div>
    <p class="text-[10px] text-gray-400 mt-2">기기 종류는 마지막 접속 기준이에요. ⚠️ 는 14일 넘게 접속하지 않은 회원이에요.</p>
    <button onclick="window.vxCopyStatusGuide()" class="w-full mt-3 bg-indigo-950 text-white text-xs font-bold py-2.5 rounded-xl">📋 안내가 필요한 분 문구 복사 (단톡방용)</button>
  </div>`;
}
window.vxCopyStatusGuide = async () => {
  const rows = statusRows().filter((r) => !r.rest);
  const needInstall = rows.filter((r) => r.inst !== 'app').map((r) => r.name);
  if (!needInstall.length) return alert('안내가 필요한 분이 없어요. 모두 설치 앱으로 접속했어요 🎉');
  const text = '[순천 VEGA 앱 안내]\n📲 앱 설치 후 새 앱으로 접속이 필요한 분:\n' + needInstall.join(', ') + '\n\n' +
    '주소: https://jsjs96.github.io/suncheon-vega/\n홈 화면에 추가 → 설치한 앱을 열어 로그인';
  try { await navigator.clipboard.writeText(text); showToast('안내 문구를 복사했어요. 단톡방에 붙여넣으세요', 3500); }
  catch (e) { prompt('아래 문구를 복사해 주세요', text); }
};

function inject() {
  const app = document.getElementById('app');
  if (!app) return;
  const t = V.tab();
  if (t === 'home') {
    let w = document.getElementById('vxHome');
    if (!w) {
      w = document.createElement('div'); w.id = 'vxHome';
      /* [PC] 오른쪽 칸에 자리가 있으면 그곳에, 아니면 기존처럼 공지사항 바로 아래에 */
      const slot = document.getElementById('pcHomeExtras');
      const nt = document.getElementById('homeNotice');
      if (slot) slot.appendChild(w);
      else app.insertBefore(w, nt && nt.parentNode === app ? nt.nextSibling : app.firstChild);
    }
    w.innerHTML = installCardHTML() + renderLineupHomeCardHTML() + planCardHTML();
  } else if (t === 'admin' && U() && U().role === 'admin') {
    let w = document.getElementById('vxStatus');
    const root = app.firstElementChild;
    if (!w && root) { w = document.createElement('div'); w.id = 'vxStatus'; root.insertBefore(w, root.children[1] || null); }
    if (w) w.innerHTML = statusCardHTML();
  } else if (t === 'myinfo' && U()) {
    let w = document.getElementById('vxJournal');
    const root = app.firstElementChild;
    if (!w && root) { w = document.createElement('div'); w.id = 'vxJournal'; root.appendChild(w); }
    if (w) w.innerHTML = journalCardHTML();
  }
}
function paint() { if (V.tab() === 'coach') renderCoach(document.getElementById('app')); else inject(); }
function syncNav() {
  bindJournals();
  bindStatus();
  reportStatus(false);
  const nav = document.querySelector('nav');
  let b = document.getElementById('nav-coach');
  if (nav && isStaff()) {
    if (!b) { b = document.createElement('button'); b.id = 'nav-coach'; b.onclick = () => window.switchTab('coach'); b.innerHTML = '<svg class="vg-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5h6v2.5H9z"/><path d="m8.8 13 2.2 2.2 4.2-4.4"/></svg> 코치'; nav.appendChild(b); }
    b.className = 'flex flex-col items-center text-[10px] sm:text-xs font-bold ' + (V.tab() === 'coach' ? 'text-indigo-900' : 'text-gray-400 hover:text-indigo-900');
  } else if (b) b.remove();
  applyLogo();
}
const _switch = window.switchTab;
window.switchTab = (tab, cat) => { _switch(tab, cat); if (tab === 'coach') renderCoach(document.getElementById('app')); syncNav(); };
const _detail = window.openEventDetail;
window.openEventDetail = (id) => { _detail(id); window.injectLineupButtons(sampleData.events.find(e => String(e.id) === String(id))); };

onSnapshot(query(collection(db, 'lineups'), where('date', '>=', agoStr(365))), (s) => { sampleData.lineups = s.docs.map(d => ({ id: d.id, ...d.data() })); V.refresh(); paint(); });
/* 일지: 일반회원은 내 일지만, 코치는 내 일지 + 공유된 일지만 불러옵니다 (읽기 절약 + 개인정보 보호) */
let jUnsubs = [], jKey = null;
function bindJournals() {
  const u = U(), key = u ? u.name + '|' + u.role : '';
  if (key === jKey) return;
  jKey = key;
  jUnsubs.forEach((f) => f()); jUnsubs = []; sampleData.journals = [];
  if (!u) { paint(); return; }
  const parts = { mine: [], shared: [] };
  const merge = () => { const m = new Map(); [...parts.mine, ...parts.shared].forEach((j) => m.set(j.id, j)); sampleData.journals = [...m.values()]; paint(); };
  const col = collection(db, 'journals');
  jUnsubs.push(onSnapshot(query(col, where('author', '==', u.name)), (s) => { parts.mine = s.docs.map((d) => ({ id: d.id, ...d.data() })); merge(); }));
  if (u.role === 'coach') jUnsubs.push(onSnapshot(query(col, where('sharedWithCoach', '==', true)), (s) => { parts.shared = s.docs.map((d) => ({ id: d.id, ...d.data() })); merge(); }));
}
bindJournals();
onSnapshot(collection(db, 'trainingPlans'), (s) => { const d = s.docs.find(x => x.id === 'current'); sampleData.plan = d ? d.data() : null; V.refresh(); paint(); });
new MutationObserver(inject).observe(document.getElementById('app'), { childList: true });
/* [개선] 0.8초마다 돌던 검사(setInterval) 대신, 화면이 그려질 때·앱으로 돌아올 때만 실행 */
let navTimer = null;
const syncNavSoon = () => { if (navTimer) return; navTimer = setTimeout(() => { navTimer = null; syncNav(); }, 50); };
window.addEventListener('vega:render', syncNavSoon);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNavSoon(); });
setInterval(() => { if (!document.hidden) syncNav(); }, 15000);   /* 혹시 놓친 변화를 위한 느린 안전장치 */
syncNav(); inject();
