/* VEGA 확장 모듈: 코치 엔트리 + 배구 일지 + 코치 탭 + 팀 로고
   index.html 과 같은 폴더에 두면 자동으로 불러와집니다. */
import { collection, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-messaging.js";
const V = window.__vega, db = V.db, sampleData = V.sampleData;
const { showToast, sortMembers, isEventPast, getTodayString } = V;
/* 알림 서버(Apps Script 웹앱) 주소는 이 파일이 아니라 vega-config.js 에 입력합니다. 비어 있으면 자동 알림만 꺼집니다. */
const NOTIFY_URL = window.VEGA_NOTIFY_URL || '';   /* 주소는 vega-config.js 에 입력 */
window.vxNotifyReady = !!NOTIFY_URL;
window.vxNotify = (type, id) => {
  if (!NOTIFY_URL) return false;
  try { fetch(NOTIFY_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ type, id: String(id) }) }); return true; } catch (e) { return false; }
};
/* ============================ 블록 시작 ============================ */
sampleData.lineups = [];

const LINEUP_COURT_SIZE = 9;   /* 9인제: 인원 확인용일 뿐, 위치는 고정되지 않음 */
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
  m.innerHTML = '<div id="lineupModalBody" class="bg-white rounded-2xl p-4 w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto"></div>';
  document.body.appendChild(m);
  return m;
}
window.closeLineupModal = () => {
  lineupDraft = null;
  const m = document.getElementById('lineupModal');
  if (m) m.classList.add('hidden');
};

/* ---------- 내 역할 판별 ---------- */
function getMyLineupRole(lineup) {
  if (!V.user() || !lineup) return null;
  const p = (lineup.placed || []).find(x => x.name === V.user().name);
  if (p) return { type: 'court' };
  if ((lineup.bench || []).includes(V.user().name)) return { type: 'bench' };
  return { type: 'none' };
}

/* ---------- 코트 / 칩 HTML ---------- */
function lineupCourtHTML(placed, interactive, myName) {
  const chips = placed.map(p => `
    <div ${interactive ? `data-name="${lnEsc(p.name)}" data-from="court"` : ''}
         class="${interactive ? 'lineup-chip cursor-grab' : ''} absolute flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shadow ${p.name === myName ? 'bg-amber-400 text-indigo-950 ring-2 ring-white' : 'bg-indigo-950 text-white'}"
         style="left:${p.x}%;top:${p.y}%;transform:translate(-50%,-50%);touch-action:none;white-space:nowrap;">
      ${lnEsc(p.name)}
    </div>`).join('');
  return `
    <div id="lineupCourt" class="relative w-full rounded-xl overflow-hidden border-2 border-amber-300 select-none"
         style="aspect-ratio:1/1;background:linear-gradient(#fef3c7,#fde68a);touch-action:none;">
      <div class="absolute top-0 left-0 right-0 h-2 bg-gray-800"></div>
      <span class="absolute top-2.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-gray-500">NET</span>
      <div class="absolute left-0 right-0 border-t-2 border-dashed border-amber-400" style="top:33.3%"></div>
      ${placed.length === 0 && interactive ? '<p class="absolute inset-0 flex items-center justify-center text-[11px] text-amber-700 font-bold text-center px-6">아래 명단에서 이름을 누른 뒤<br/>원하는 위치를 누르거나, 끌어다 놓으세요</p>' : ''}
      ${chips}
    </div>`;
}

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

  const rosterChips = shown.length === 0
    ? '<p class="text-[11px] text-gray-400 py-2">표시할 인원이 없습니다.</p>'
    : shown.map(n => {
        const isGuest = (L.guests || []).includes(n);
        const st = hasVotes ? (votes[n] || '미정') : null;
        const mark = isGuest ? '🙋' : st === '참가' ? '✅' : st === '불참' ? '⛔' : st === '미정' ? '❔' : '';
        return `<span class="inline-flex items-center gap-0.5">
          <span data-name="${lnEsc(n)}" data-from="roster" class="lineup-chip cursor-grab px-2.5 py-1 rounded-full text-[11px] font-bold border ${L._selected === n ? 'bg-indigo-950 text-white border-indigo-950 ring-2 ring-indigo-300' : 'bg-gray-100 text-gray-800 border-gray-300'}" style="touch-action:none;">${mark} ${lnEsc(n)}</span>
          ${isGuest ? `<button type="button" onclick="window.removeLineupGuest('${lnEsc(n)}')" class="text-[10px] text-rose-500 font-bold px-1">✕</button>` : ''}
        </span>`;
      }).join('');

  const benchChips = L.bench.length === 0
    ? '<p class="text-[11px] text-gray-400 py-1">여기로 끌어다 놓으면 교체 명단이 됩니다.</p>'
    : L.bench.map(n => `<span data-name="${lnEsc(n)}" data-from="bench" class="lineup-chip cursor-grab px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300" style="touch-action:none;">🔄 ${lnEsc(n)}</span>`).join('');

  body.innerHTML = `
    <div class="flex justify-between items-center mb-2 pb-2 border-b">
      <h3 class="text-sm font-black text-indigo-950">📋 엔트리 작성</h3>
      <button onclick="window.closeLineupModal()" class="text-gray-400 hover:text-gray-600 font-bold text-lg">&times;</button>
    </div>
    <p class="text-xs font-bold text-gray-800 mb-0.5 truncate">${lnEsc(L.title)}</p>
    <p class="text-[11px] text-gray-400 mb-2">${L.date} · 상태: ${published ? '<strong class="text-emerald-600">공개됨</strong>' : '<strong class="text-amber-600">초안(비공개)</strong>'} · 코트 ${L.placed.length}명 / 교체 ${L.bench.length}명</p>

    ${lineupCourtHTML(L.placed, true, null)}
    <p class="text-[10px] text-gray-400 mt-1 mb-3 leading-relaxed">${L._selected ? `<strong class="text-indigo-800">${lnEsc(L._selected)}</strong> 선택됨 → 코트에서 <strong>원하는 위치를 누르세요</strong> (교체 칸을 누르면 교체 명단)` : '💡 명단 이름을 누른 뒤 코트의 <strong>원하는 위치를 누르거나</strong>, 끌어다 놓으세요. 코트 위 이름은 끌어서 자유롭게 옮기고, 명단/교체 칸으로 끌어 놓으면 코트에서 빠집니다.'}</p>

    <div id="lineupBench" class="mb-3 p-2.5 rounded-xl bg-emerald-50 border border-dashed border-emerald-300">
      <p class="text-[11px] font-black text-emerald-900 mb-1.5">🔄 교체 명단</p>
      <div class="flex flex-wrap gap-1.5">${benchChips}</div>
    </div>

    <div id="lineupRoster" class="mb-3 p-2.5 rounded-xl bg-gray-50 border border-gray-200">
      <div class="flex justify-between items-center mb-1.5 gap-2">
        <p class="text-[11px] font-black text-gray-800">👥 명단 (눌러서 추가 · 끌어서 배치)</p>
        ${hasVotes ? `<label class="flex items-center gap-1 text-[10px] font-bold text-gray-600 shrink-0"><input type="checkbox" ${onlyAttend ? 'checked' : ''} onchange="window.toggleLineupAttendFilter(this.checked)"> 참가자만</label>` : ''}
      </div>
      <div class="flex flex-wrap gap-1.5">${rosterChips}</div>
      <div class="flex gap-1.5 mt-2.5">
        <input id="lineupGuestInput" type="text" placeholder="게스트 이름 추가" class="flex-1 p-2 border border-gray-300 rounded-lg text-xs" />
        <button type="button" onclick="window.addLineupGuest()" class="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold px-3 rounded-lg shrink-0">+ 추가</button>
      </div>
    </div>

    <label class="block text-xs font-bold text-gray-700 mb-1">📝 코치 메모 (전술 포인트)</label>
    <textarea id="lineupMemo" rows="3" placeholder="예: 리시브는 센터 쪽으로 집중, 서브는 존 5 공략" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs mb-3">${lnEsc(L.memo || '')}</textarea>

    <div class="flex gap-2">
      ${published ? `
        <button onclick="window.saveLineup('draft')" class="w-1/2 bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs">비공개로 전환</button>
        <button onclick="window.saveLineup('published')" class="w-1/2 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">수정 반영</button>
      ` : `
        <button onclick="window.saveLineup('draft')" class="w-1/2 bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs">임시저장</button>
        <button onclick="window.saveLineup('published')" class="w-1/2 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">📢 공개하기</button>
      `}
    </div>
    ${getLineup(L.eventId) ? `<button onclick="window.deleteLineup()" class="w-full mt-2 text-[11px] text-rose-600 font-bold py-1.5">🗑️ 이 엔트리 삭제</button>` : ''}
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

function onLineupMove(ev) {
  const d = lineupDrag;
  if (!d) return;
  if (!d.moved) {
    if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return;
    d.moved = true;
    const g = document.createElement('div');
    g.className = 'fixed z-[80] pointer-events-none px-3 py-1.5 rounded-full text-xs font-bold bg-indigo-600 text-white shadow-lg';
    g.textContent = d.name;
    document.body.appendChild(g);
    d.ghost = g;
  }
  d.ghost.style.left = ev.clientX + 'px';
  d.ghost.style.top = ev.clientY + 'px';
  d.ghost.style.transform = 'translate(-50%,-140%)';
}

function onLineupUp(ev) {
  document.removeEventListener('pointermove', onLineupMove);
  document.removeEventListener('pointerup', onLineupUp);
  document.removeEventListener('pointercancel', onLineupUp);
  const d = lineupDrag;
  lineupDrag = null;
  if (!d) return;
  if (d.ghost) d.ghost.remove();
  const L = lineupDraft;
  if (!L) return;

  /* 탭(드래그 아님) */
  if (!d.moved) {
    if (d.from === 'roster') {
      L._selected = (L._selected === d.name) ? null : d.name;
    } else if (d.from === 'bench') {
      removeFromLineup(L, d.name);
      L._selected = null;
    }
    renderLineupEditor();
    return;
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
window.addLineupGuest = () => {
  if (!lineupDraft) return;
  const input = document.getElementById('lineupGuestInput');
  const name = (input ? input.value : '').trim();
  if (!name) return;
  const exists = sampleData.members.some(m => m.name === name) || (lineupDraft.guests || []).includes(name);
  if (exists) return alert('이미 명단에 있는 이름입니다.');
  lineupDraft.guests = [...(lineupDraft.guests || []), name];
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
    status: ex ? ex.status : 'draft'
  };
  const m = ensureLineupModal();
  m.classList.remove('hidden');
  renderLineupEditor();
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
    if (status === 'published') window.vxNotify('lineup', L.eventId);
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
  const roleText = !role ? '' : role.type === 'court'
    ? '🏐 당신은 <strong>코트 선발</strong>입니다!'
    : role.type === 'bench' ? '🔄 당신은 <strong>교체 명단</strong>입니다. 준비해 주세요!'
    : '이번 엔트리에는 포함되지 않았어요.';

  const m = ensureLineupModal();
  document.getElementById('lineupModalBody').innerHTML = `
    <div class="flex justify-between items-center mb-2 pb-2 border-b">
      <h3 class="text-sm font-black text-indigo-950">📋 엔트리</h3>
      <button onclick="window.closeLineupModal()" class="text-gray-400 hover:text-gray-600 font-bold text-lg">&times;</button>
    </div>
    <p class="text-xs font-bold text-gray-800 mb-0.5">${lnEsc(lu.title)}</p>
    <p class="text-[11px] text-gray-400 mb-2">${lu.date}${lu.edited ? ' · (수정됨)' : ''}${lu.status !== 'published' ? ' · <strong class="text-amber-600">초안(비공개)</strong>' : ''}</p>
    ${roleText ? `<p class="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 mb-3">${roleText}</p>` : ''}
    ${lineupCourtHTML(lu.placed || [], false, myName)}
    <div class="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
      <p class="text-[11px] font-black text-emerald-900 mb-1.5">🔄 교체 명단</p>
      <div class="flex flex-wrap gap-1.5">
        ${(lu.bench || []).length === 0 ? '<span class="text-[11px] text-gray-400">없음</span>' :
          lu.bench.map(n => `<span class="px-2.5 py-1 rounded-full text-[11px] font-bold ${n === myName ? 'bg-amber-400 text-indigo-950' : 'bg-white text-emerald-900 border border-emerald-300'}">${lnEsc(n)}</span>`).join('')}
      </div>
    </div>
    ${lu.memo ? `<div class="mt-3"><p class="text-[11px] font-black text-gray-800 mb-1">📝 코치 메모</p><p class="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-line leading-relaxed">${lnEsc(lu.memo)}</p></div>` : ''}
    <p class="text-[10px] text-gray-400 mt-2">작성: ${lnEsc(lu.createdBy || '')}</p>
    <button onclick="window.closeLineupModal()" class="w-full mt-3 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">닫기</button>
  `;
  m.classList.remove('hidden');
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
    <section class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-amber-300 mb-5">
      <h2 class="text-sm sm:text-base font-black text-gray-900 mb-3 flex items-center gap-1.5"><span>📋</span> 엔트리 공개!</h2>
      <div class="space-y-2">
        ${items.map(({ l, evt }) => {
          const r = getMyLineupRole(l);
          const mine = !r ? '' : r.type === 'court'
            ? '<span class="text-emerald-700 font-bold">🏐 내 자리: 코트 선발</span>'
            : r.type === 'bench' ? '<span class="text-emerald-700 font-bold">🔄 교체 명단 — 준비해 주세요</span>'
            : '<span class="text-gray-400">이번 엔트리에는 포함되지 않았어요</span>';
          return `
            <div onclick="window.openLineupView('${l.id}')" class="flex items-center justify-between gap-2 p-3 bg-amber-50 hover:bg-amber-100/70 border border-amber-200 rounded-xl cursor-pointer">
              <div class="min-w-0">
                <p class="text-xs font-black text-indigo-950 truncate">${lnEsc(evt.title)} <span class="text-[10px] text-gray-500 font-bold">${evt.date.substring(5)}${l.edited ? ' · 수정됨' : ''}</span></p>
                <p class="text-[11px] mt-0.5">${mine || '엔트리를 확인해 보세요'}</p>
              </div>
              <span class="text-[11px] font-bold text-amber-800 shrink-0">보기 →</span>
            </div>`;
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
function makeLogo(sz, file = 'logo.png') {
  const i = new Image();
  i.width = i.height = sz; i.alt = 'VEGA'; i.className = 'rounded-full bg-white shrink-0 object-contain';
  i.onerror = () => { const s = document.createElement('span'); s.innerHTML = LOGO_SVG(sz); i.replaceWith(s.firstChild); };
  i.src = file;
  return i;
}
function applyLogo() {
  const h = document.querySelector('header span.text-xl');
  if (h) h.replaceWith(makeLogo(36, 'logo-mark.png'));
  const t = document.querySelector('#loginModal h2');
  if (t && !document.getElementById('vxLoginLogo')) {
    const w = document.createElement('div');
    w.id = 'vxLoginLogo'; w.className = 'flex justify-center mb-2';
    w.appendChild(makeLogo(72));
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
  return `<div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mt-4 sm:mt-5">
    <div class="flex justify-between items-center mb-3">
      <h3 class="text-xs sm:text-sm font-black text-gray-900">📓 나의 배구 일지</h3>
      <button onclick="window.vxJournalOpen()" class="bg-indigo-900 text-white text-xs px-3 py-1.5 rounded-lg font-bold">+ 일지 쓰기</button>
    </div>
    <div class="flex items-center justify-between gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2 mb-3">
      <p class="text-[11px] text-gray-600 leading-relaxed">📌 일지는 작성일로부터 <strong>1년간</strong> 보관돼요. 필요한 기록은 다운로드해 두세요.</p>
      <button onclick="window.vxJournalDownload()" class="shrink-0 bg-white border border-gray-300 text-gray-700 text-[11px] font-bold px-2.5 py-1.5 rounded-lg">⬇️ 내 일지 다운로드</button>
    </div>
    ${soon ? `<p class="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 font-bold rounded-xl px-3 py-2 mb-3">⏰ ${soon}개의 일지가 일주일 안에 보관 기간(1년)이 끝나요. 지금 다운로드해 두세요.</p>` : ''}
    <div class="grid grid-cols-2 gap-2 mb-3">
      <div class="bg-gray-50 rounded-xl p-3"><span class="text-[11px] text-gray-500 block">이번 달 작성</span><span class="text-lg font-black text-indigo-950">${m.length}회</span></div>
      <div class="bg-gray-50 rounded-xl p-3"><span class="text-[11px] text-gray-500 block">평균 셀프 평가</span><span class="text-lg font-black text-indigo-950">${avg}${avg === '-' ? '' : '점'}</span></div>
    </div>
    ${tt.length ? `<p class="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-3">자주 적은 아쉬운 기술: ${tt.map(([t, c]) => `<strong>${t}</strong> ${c}회`).join(' · ')}</p>` : ''}
    <div class="space-y-2">
      ${mine.length === 0 ? '<p class="text-xs text-gray-400 py-6 text-center">운동 후 30초만 투자해 첫 일지를 남겨 보세요.</p>' : ''}
      ${mine.slice(0, jLimit).map(j => `
        <div onclick="window.vxJournalOpen('${j.id}')" class="p-2.5 bg-gray-50 hover:bg-indigo-50/50 rounded-xl cursor-pointer">
          <div class="flex justify-between items-center text-[11px] mb-0.5">
            <span class="font-bold text-gray-800">${MOOD_ICON[j.mood] || ''} ${j.date}</span>
            <span class="text-gray-400">${j.sharedWithCoach ? '코치 공유' : '나만 보기'}${(j.coachComments || []).length ? ' · 💬 코치 코멘트' : ''}</span>
          </div>
          <p class="text-xs text-gray-600 truncate">${lnEsc(j.improve || j.good || j.next || '')}</p>
        </div>`).join('')}
    </div>
    ${mine.length > jLimit ? '<button onclick="window.vxJournalMore()" class="w-full mt-2 text-xs font-bold text-indigo-900 py-1.5">더보기</button>' : ''}
  </div>`;
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
    window.vxNotify('comment', id);
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

  app.innerHTML = `<div class="space-y-4 sm:space-y-5">
    <div class="bg-gradient-to-r from-indigo-950 to-indigo-900 text-white p-4 sm:p-5 rounded-2xl shadow-sm">
      <span class="text-[10px] font-bold bg-amber-400 text-indigo-950 px-2 py-0.5 rounded-full">코치 모드</span>
      <h2 class="text-lg font-black mt-1">🧢 코치 대시보드</h2>
      <p class="text-[11px] text-indigo-200 mt-1">${isCoach() ? `코멘트 기다리는 일지 ${unreplied.length}건` : '운영진은 엔트리와 훈련 계획을 볼 수 있어요'}</p>
    </div>
    ${card(`<h3 class="text-xs sm:text-sm font-black text-gray-900 mb-3">📋 엔트리 (다가오는 일정)</h3><div class="space-y-2">
      ${upcoming.length === 0 ? '<p class="text-xs text-gray-400 py-4 text-center">다가오는 일정이 없습니다.</p>' : ''}
      ${upcoming.map(e => { const l = luOf(e.id); const st = !l ? ['미작성', 'bg-gray-100 text-gray-600'] : l.status === 'published' ? ['공개됨', 'bg-emerald-100 text-emerald-800'] : ['초안', 'bg-amber-100 text-amber-800'];
        return `<div class="flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-xl"><div class="min-w-0"><p class="text-xs font-bold text-gray-900 truncate"><span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 mr-1">${names[e.type] || '기타'}</span>${lnEsc(e.title)}</p><p class="text-[11px] text-gray-500">${e.date.substring(5)} ${e.time || ''}</p></div><div class="flex items-center gap-1.5 shrink-0"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${st[1]}">${st[0]}</span><button onclick="window.openLineupEditor('${e.id}')" class="text-[11px] bg-indigo-950 text-white px-2.5 py-1 rounded-lg font-bold">${l ? '수정' : '작성'}</button></div></div>`; }).join('')}
    </div>${startList.length ? `<p class="text-[11px] font-bold text-gray-700 mt-4 mb-1.5">공개된 엔트리 선발 횟수</p><div class="flex flex-wrap gap-1.5">${startList.map(([n, c]) => `<span class="text-[11px] bg-gray-100 border border-gray-200 text-gray-700 px-2 py-0.5 rounded-full">${lnEsc(n)} ${c}회</span>`).join('')}</div>` : ''}`)}
    ${card(`<h3 class="text-xs sm:text-sm font-black text-gray-900 mb-1">🏋️ 이번 주 훈련 계획</h3><p class="text-[11px] text-gray-400 mb-2">저장하면 모든 회원의 홈에 표시됩니다.</p><textarea rows="4" oninput="window.vxPlanInput(this)" placeholder="예: 이번 주는 리시브 집중. 2인 1조 리시브 → 토스 연결 20분" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs">${lnEsc(plan)}</textarea><button onclick="window.vxPlanSave()" class="w-full mt-2 bg-indigo-950 text-white font-bold py-2.5 rounded-xl text-xs">훈련 계획 저장</button>`)}
    ${isCoach() ? card(`<h3 class="text-xs sm:text-sm font-black text-gray-900 mb-1">📓 회원 일지 (공유된 글)</h3><p class="text-[11px] text-gray-400 mb-3">공유를 켠 일지만 보입니다. 코멘트가 없는 글이 위로 올라와요.</p>
      <div class="grid grid-cols-2 gap-2 mb-3"><div class="bg-gray-50 rounded-xl p-3"><span class="text-[11px] text-gray-500 block">이번 달 공유 일지</span><span class="text-lg font-black text-indigo-950">${sm.length}건</span></div><div class="bg-gray-50 rounded-xl p-3"><span class="text-[11px] text-gray-500 block">힘들었다는 응답</span><span class="text-lg font-black text-indigo-950">${sm.length ? Math.round(bad / sm.length * 100) : 0}%</span></div></div>
      ${tt.length ? `<p class="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-3">팀 아쉬운 기술 TOP: ${tt.map(([t, c]) => `<strong>${t}</strong> ${c}`).join(' · ')}</p>` : ''}
      <div class="space-y-2">${shared.length === 0 ? '<p class="text-xs text-gray-400 py-4 text-center">공유된 일지가 없습니다.</p>' : ''}
      ${[...unreplied, ...shared.filter(j => (j.coachComments || []).length)].slice(0, coachJLimit).map(j => `<div onclick="window.vxCoachOpen('${j.id}')" class="p-2.5 bg-gray-50 hover:bg-indigo-50/50 rounded-xl cursor-pointer"><div class="flex justify-between text-[11px] mb-0.5"><span class="font-bold text-gray-800">${MOOD_ICON[j.mood] || ''} ${lnEsc(j.author)} · ${j.date}</span><span class="${(j.coachComments || []).length ? 'text-gray-400' : 'text-rose-600 font-bold'}">${(j.coachComments || []).length ? '코멘트 완료' : '코멘트 필요'}</span></div><p class="text-xs text-gray-600 truncate">${lnEsc(j.improve || j.good || j.next || '')}</p></div>`).join('')}</div>
      ${shared.length > coachJLimit ? '<button onclick="window.vxCoachMore()" class="w-full mt-2 text-xs font-bold text-indigo-900 py-1.5">더보기</button>' : ''}`) : ''}
  </div>`;
}

/* ===================== 탭/화면 연결 ===================== */
function planCardHTML() {
  const t = sampleData.plan && sampleData.plan.text;
  return t ? `<section class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-indigo-200 mb-5"><h2 class="text-sm sm:text-base font-black text-gray-900 mb-2">🏋️ 이번 주 훈련</h2><p class="text-xs text-gray-700 leading-relaxed whitespace-pre-line">${lnEsc(t)}</p></section>` : '';
}
function installCardHTML() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone || localStorage.getItem('vxInstallHide')) return '';
  const wrap = (inner) => `<section class="bg-white p-4 rounded-2xl shadow-sm border border-indigo-200 mb-5"><div class="flex justify-between items-start gap-2"><div class="text-xs text-gray-700 leading-relaxed">${inner}</div><button onclick="window.vxInstallHide()" class="text-gray-400 font-bold text-lg leading-none shrink-0">&times;</button></div></section>`;
  if (window.__deferredInstall) return wrap('<p class="font-black text-gray-900 mb-1">📲 홈 화면에 앱으로 설치</p><p class="mb-2">설치하면 아이콘으로 바로 열려요.</p><button onclick="window.vxInstall()" class="bg-indigo-950 text-white text-xs font-bold px-3 py-2 rounded-xl">앱 설치하기</button>');
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return wrap('<p class="font-black text-gray-900 mb-1">📲 홈 화면에 앱으로 설치</p><p>Safari 하단의 <strong>공유 버튼</strong> → <strong>홈 화면에 추가</strong>를 눌러 주세요.</p>');
  return '';
}
window.vxInstall = async () => { const p = window.__deferredInstall; if (!p) return; p.prompt(); try { await p.userChoice; } catch (e) {} window.__deferredInstall = null; paint(); };
window.vxInstallHide = () => { localStorage.setItem('vxInstallHide', '1'); paint(); };
window.__vegaPaint = () => paint();
/* ===================== 푸시 알림 (FCM) : 자동 복구 포함 ===================== */
const VAPID_KEY = '';   /* 선택: 비워도 기본 키로 동작 */
let pushOK = false, fgBound = false, lastPushUser = null, pushBusy = false;
const pushOn = () => typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem('vxPushOff') !== '1' && !!localStorage.getItem('vxPushToken');
function bindForeground() {
  if (fgBound || !pushOK) return;
  try { onMessage(getMessaging(getApp()), (p) => { const n = p.notification || {}; showToast('🔔 ' + (n.title || '') + ' ' + (n.body || ''), 4500); }); fgBound = true; } catch (e) {}
}
/* 앱을 열 때마다(6시간에 한 번) 토큰을 다시 확인·등록해서, 저장소가 지워지거나 토큰이 바뀌어도 알림이 자동으로 이어지게 합니다 */
async function refreshPush(force) {
  const u = U();
  if (pushBusy || !pushOK || !u || typeof Notification === 'undefined' || Notification.permission !== 'granted' || localStorage.getItem('vxPushOff') === '1') return;
  const fresh = Date.now() - Number(localStorage.getItem('vxPushAt') || 0) < 6 * 3600 * 1000;
  if (!force && fresh && localStorage.getItem('vxPushToken') && lastPushUser === u.name) return;
  pushBusy = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(getApp()), { serviceWorkerRegistration: reg, ...(VAPID_KEY ? { vapidKey: VAPID_KEY } : {}) });
    if (!token) return;
    const old = localStorage.getItem('vxPushToken');
    await setDoc(doc(db, 'fcmTokens', token), { name: u.name, role: u.role, ua: navigator.userAgent.slice(0, 120), updatedAt: serverTimestamp() }, { merge: true });
    if (old && old !== token) deleteDoc(doc(db, 'fcmTokens', old)).catch(() => {});
    localStorage.setItem('vxPush', '1'); localStorage.setItem('vxPushToken', token); localStorage.setItem('vxPushAt', String(Date.now()));
    lastPushUser = u.name;
    bindForeground();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    paint();
  } catch (e) { console.warn('푸시 토큰 갱신 실패', e); }
  finally { pushBusy = false; }
}
isSupported().then((ok) => { pushOK = ok; if (ok) { bindForeground(); refreshPush(false); } paint(); }).catch(() => {});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPush(false); });
function pushSync() {
  const u = U();
  if (!u && lastPushUser) {   /* 로그아웃: 이 기기로 이전 회원의 알림이 가지 않게 등록 해제 */
    const t = localStorage.getItem('vxPushToken');
    lastPushUser = null;
    if (t) deleteDoc(doc(db, 'fcmTokens', t)).catch(() => {});
    return;
  }
  if (u) refreshPush(false);
}
function pushCardHTML(inMy) {
  if (!U() || !pushOK) return '';
  const on = pushOn(), denied = Notification.permission === 'denied';
  if (!inMy && (on || denied || localStorage.getItem('vxPushHide'))) return '';
  const what = '투표 마감 전날, 엔트리 공개, 코치 코멘트, 새 공지를 알려드려요.';
  const body = on ? `<p class="font-black text-gray-900 mb-1">🔔 알림 켜짐</p><p class="mb-2">${what}</p><div class="flex gap-2"><button onclick="window.vxPushDisable()" class="bg-gray-200 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl">알림 끄기</button><button onclick="window.vxPushReconnect()" class="bg-white border border-gray-300 text-gray-700 text-xs font-bold px-3 py-2 rounded-xl">🔄 다시 연결</button></div><p class="text-[10px] text-gray-400 mt-2">알림이 안 오면 "다시 연결"을 눌러 보세요.</p>`
    : denied ? '<p class="font-black text-gray-900 mb-1">🔕 알림이 차단되어 있어요</p><p>브라우저(또는 앱) 설정에서 이 사이트의 알림을 허용해 주세요.</p>'
    : `<p class="font-black text-gray-900 mb-1">🔔 알림 받기</p><p class="mb-2">${what}</p><button onclick="window.vxPushEnable()" class="bg-indigo-950 text-white text-xs font-bold px-3 py-2 rounded-xl">알림 켜기</button>`;
  return `<section class="bg-white p-4 rounded-2xl shadow-sm border border-indigo-200 ${inMy ? 'mb-4' : 'mb-5'}"><div class="flex justify-between items-start gap-2"><div class="text-xs text-gray-700 leading-relaxed">${body}</div>${inMy ? '' : '<button onclick="window.vxPushHide()" class="text-gray-400 font-bold text-lg leading-none shrink-0">&times;</button>'}</div></section>`;
}
window.vxPushEnable = async () => {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return alert('알림 권한이 허용되지 않았어요. 브라우저(또는 앱) 설정에서 허용해 주세요.');
    localStorage.removeItem('vxPushOff');
    await refreshPush(true);
    if (!localStorage.getItem('vxPushToken')) throw new Error('토큰 없음');
    showToast('알림을 켰어요 🔔'); paint();
  } catch (e) { console.error(e); alert('알림을 켜지 못했어요. 홈 화면에 설치한 앱에서 다시 시도해 주세요.'); }
};
window.vxPushReconnect = async () => { await refreshPush(true); showToast('알림을 다시 연결했어요 🔄'); paint(); };
window.vxPushDisable = async () => {
  const t = localStorage.getItem('vxPushToken');
  localStorage.setItem('vxPushOff', '1');
  try { if (t) await deleteDoc(doc(db, 'fcmTokens', t)); await deleteToken(getMessaging(getApp())); } catch (e) {}
  localStorage.removeItem('vxPush'); localStorage.removeItem('vxPushToken'); lastPushUser = null;
  showToast('알림을 껐어요'); paint();
};
window.vxPushHide = () => { localStorage.setItem('vxPushHide', '1'); paint(); };

function inject() {
  const app = document.getElementById('app');
  if (!app) return;
  const t = V.tab();
  if (t === 'home') {
    let w = document.getElementById('vxHome');
    if (!w) { w = document.createElement('div'); w.id = 'vxHome'; app.insertBefore(w, app.firstChild); }
    w.innerHTML = renderLineupHomeCardHTML() + planCardHTML() + installCardHTML() + pushCardHTML(false);
  } else if (t === 'myinfo' && U()) {
    let w = document.getElementById('vxJournal');
    const root = app.firstElementChild;
    if (!w && root) { w = document.createElement('div'); w.id = 'vxJournal'; root.appendChild(w); }
    if (w) w.innerHTML = pushCardHTML(true) + journalCardHTML();
  }
}
function paint() { if (V.tab() === 'coach') renderCoach(document.getElementById('app')); else inject(); }
function syncNav() {
  pushSync();
  bindJournals();
  const nav = document.querySelector('nav');
  let b = document.getElementById('nav-coach');
  if (nav && isStaff()) {
    if (!b) { b = document.createElement('button'); b.id = 'nav-coach'; b.onclick = () => window.switchTab('coach'); b.innerHTML = '<span class="text-base md:text-sm">🧢</span> 코치'; nav.appendChild(b); }
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
setInterval(syncNav, 800);
syncNav(); inject();
