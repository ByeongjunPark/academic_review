(function () {
  // 발간월별 이슈 리포트 (집필진 명단은 구글시트 '위원' 탭 → 로그인 후 서버에서 받음)
  const ISSUES = [
    { key: '2026-07', label: '7월호',  date: '2026-07-15', kw: '#인지적외주화 #참학력 #인지증강 #학습과정' },
    { key: '2026-08', label: '8월호',  date: '2026-08-12', kw: '#디지털 웰빙 #디지털기기 적정 활용' },
    { key: '2026-09', label: '9월호',  date: '2026-09-09', kw: '#특수교육대상 #이주배경학생' },
    { key: '2026-10', label: '10월호', date: '2026-10-07', kw: '#과정중심 평가 #AI피드백리터러시 #교사-AI협업' },
    { key: '2026-11', label: '11월호', date: '2026-11-11', kw: '#AI 활용 수업 모형 #OECD teaching compass' },
    { key: '2026-12', label: '12월호', date: '2026-12-02', kw: '#교원 디지털 역량 체계표 #학생 디지털 역량 체계표 #DigComp_3.0' },
    { key: '2027-01', label: '1월호',  date: '2027-01-06', kw: '지능형 학습 분석학과 맞춤형 환류 체계 동향' }
  ];
  const DEFAULT_START = 18;
  let MEMBERS = []; // [{month:'7월', name}]
  const writersOf = issue => MEMBERS.filter(m => m.month + '호' === issue.label).map(m => m.name);

  const $ = s => document.querySelector(s);
  let me = null, myMonth = '', pw = '', state = null, saveTimer = null;

  // ---------- 상태 ----------
  const myIssues = () => ISSUES.filter(i => i.label !== myMonth + '호');
  const blankSection = () => ({ title: '', items: [''] });
  function freshState() {
    const reviews = {};
    myIssues().forEach(i => { reviews[i.key] = { date: i.date, start: DEFAULT_START, sections: [blankSection(), blankSection()] }; });
    return { sosok: '', jikwi: '', reviews };
  }
  function normalize(data) {
    const s = freshState();
    if (!data) return s;
    s.sosok = data.sosok || ''; s.jikwi = data.jikwi || '';
    myIssues().forEach(i => {
      const r = data.reviews && data.reviews[i.key];
      if (!r) return;
      s.reviews[i.key] = {
        date: r.date || i.date,
        start: Number.isInteger(r.start) ? r.start : DEFAULT_START,
        sections: (r.sections && r.sections.length ? r.sections : [blankSection()])
          .map(x => ({ title: x.title || '', items: x.items && x.items.length ? x.items : [''] }))
      };
    });
    return s;
  }
  const localKey = () => 'gne_review_' + me;
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => localStorage.setItem(localKey(), JSON.stringify({ t: Date.now(), data: state })), 300);
  }

  // ---------- 서버 ----------
  async function api(payload) {
    if (!window.GAS_URL) throw new Error('서버 주소(config.js의 GAS_URL)가 아직 설정되지 않았습니다.');
    const r = await fetch(window.GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('서버 응답 오류 (' + r.status + ')');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '처리하지 못했습니다.');
    return j;
  }

  // ---------- 로그인 ----------
  const sel = $('#loginName');
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter || $('#loginForm button');
    const msg = $('#loginMsg'); msg.className = 'msg'; msg.textContent = '';
    btn.disabled = true;
    try {
      const name = sel.value.replace(/\s+/g, ''), pass = $('#loginPw').value;
      const res = await api({ action: 'login', name, pw: pass });
      me = res.name; pw = pass; myMonth = res.month; MEMBERS = res.members || [];
      sessionStorage.setItem('gne_session', JSON.stringify({ me, pw }));
      enter(res);
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
  $('#logout').addEventListener('click', () => { sessionStorage.removeItem('gne_session'); location.reload(); });

  function enter(res) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey()) || 'null'); } catch (e) { }
    const serverT = res.savedAt || 0;
    state = normalize(local && local.t > serverT ? local.data : (res.data || (local && local.data)));
    $('#login').hidden = true; $('#editor').hidden = false;
    $('#whoName').textContent = '(' + me + ')';
    $('#whoInfo').textContent = myMonth + '호' + ' 집필 · 나머지 ' + myIssues().length + '개 호 검토';
    showStatus(res.submittedAt, res.fileUrl);
    render();
  }

  function showStatus(at, url, localUrl) {
    const el = $('#status');
    if (!at) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '';
    el.append('제출 완료 · ' + new Date(at).toLocaleString('ko-KR') + ' ');
    if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.textContent = '드라이브에서 보기'; el.append(a); }
    if (localUrl) { el.append(' · '); const d = document.createElement('a'); d.href = localUrl; d.download = fileName(); d.textContent = '내 PC에 받기'; el.append(d); }
    el.append(' (수정 후 다시 제출하면 파일이 교체됩니다)');
  }

  // ---------- 화면 ----------
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  function tpl(id) { return document.getElementById(id).content.firstElementChild.cloneNode(true); }

  function render() {
    $('#sosok').value = state.sosok; $('#jikwi').value = state.jikwi;
    const box = $('#reviews'); box.innerHTML = '';
    myIssues().forEach(issue => box.append(renderReview(issue)));
  }
  $('#sosok').addEventListener('input', e => { state.sosok = e.target.value; e.target.classList.remove('invalid'); saveLocal(); });
  $('#jikwi').addEventListener('input', e => { state.jikwi = e.target.value; e.target.classList.remove('invalid'); saveLocal(); });

  function renderReview(issue) {
    const rv = state.reviews[issue.key];
    const el = tpl('tplReview');
    el.dataset.key = issue.key;
    el.querySelector('.rv-title').textContent = issue.label;
    el.querySelector('.rv-meta').textContent = '집필 ' + writersOf(issue).join('·') + ' · ' + issue.kw;
    const date = el.querySelector('.rv-date'), start = el.querySelector('.rv-start');
    for (let h = 0; h <= 21; h++) start.add(new Option(HWPX.fmtTime(h).slice(1, -1), h));
    date.value = rv.date; start.value = rv.start;
    date.addEventListener('input', () => { rv.date = date.value; date.classList.remove('invalid'); saveLocal(); });
    start.addEventListener('change', () => { rv.start = Number(start.value); saveLocal(); });
    el.querySelector('.rv-reset').addEventListener('click', () => {
      rv.date = issue.date; rv.start = DEFAULT_START; date.value = rv.date; start.value = rv.start; saveLocal();
    });
    const secBox = el.querySelector('.sections');
    const drawSecs = () => { secBox.innerHTML = ''; rv.sections.forEach((s, i) => secBox.append(renderSection(rv, i, drawSecs))); };
    drawSecs();
    el.querySelector('.add-sec').addEventListener('click', () => {
      rv.sections.push(blankSection()); drawSecs(); saveLocal();
      secBox.lastElementChild.querySelector('.sec-title').focus();
    });
    return el;
  }

  function renderSection(rv, idx, redraw) {
    const sec = rv.sections[idx];
    const el = tpl('tplSection');
    const title = el.querySelector('.sec-title');
    title.value = sec.title;
    title.addEventListener('input', () => { sec.title = title.value; title.classList.remove('invalid'); saveLocal(); });
    el.querySelector('.del-sec').addEventListener('click', () => {
      if (rv.sections.length === 1) { rv.sections[0] = blankSection(); }
      else rv.sections.splice(idx, 1);
      redraw(); saveLocal();
    });
    const itemBox = el.querySelector('.items');
    const drawItems = () => {
      itemBox.innerHTML = '';
      sec.items.forEach((txt, j) => {
        const it = tpl('tplItem');
        const ta = it.querySelector('textarea');
        ta.value = txt;
        ta.addEventListener('input', () => { sec.items[j] = ta.value; ta.classList.remove('invalid'); autosize(ta); saveLocal(); });
        ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sec.items.splice(j + 1, 0, ''); drawItems(); itemBox.children[j + 1].querySelector('textarea').focus(); saveLocal(); } });
        it.querySelector('.del-item').addEventListener('click', () => {
          if (sec.items.length === 1) sec.items[0] = ''; else sec.items.splice(j, 1);
          drawItems(); saveLocal();
        });
        itemBox.append(it);
        requestAnimationFrame(() => autosize(ta));
      });
    };
    drawItems();
    el.querySelector('.add-item').addEventListener('click', () => {
      sec.items.push(''); drawItems(); saveLocal();
      itemBox.lastElementChild.querySelector('textarea').focus();
    });
    return el;
  }

  // ---------- 검증 ----------
  function validate() {
    document.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    const bad = [];
    if (!state.sosok.trim()) bad.push($('#sosok'));
    if (!state.jikwi.trim()) bad.push($('#jikwi'));
    const out = [];
    myIssues().forEach(issue => {
      const rv = state.reviews[issue.key];
      const card = document.querySelector(`.review[data-key="${issue.key}"]`);
      if (!rv.date) bad.push(card.querySelector('.rv-date'));
      const secEls = card.querySelectorAll('.sec');
      const sections = [];
      rv.sections.forEach((s, i) => {
        const items = s.items.map(x => x.trim()).filter(Boolean);
        const title = s.title.trim();
        if (!title && !items.length) return; // 완전히 빈 소제목은 무시
        if (!title) bad.push(secEls[i].querySelector('.sec-title'));
        if (!items.length) bad.push(secEls[i].querySelector('.item-text'));
        sections.push({ title, items });
      });
      if (!sections.length) bad.push(secEls[0].querySelector('.sec-title'), secEls[0].querySelector('.item-text'));
      out.push({ label: issue.label, date: rv.date, start: rv.start, sections });
    });
    bad.forEach(x => x && x.classList.add('invalid'));
    if (bad.length) { bad[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; }
    return out;
  }

  // ---------- 저장 / 제출 ----------
  const fileName = () => '자문의견서(' + me + ').hwpx';
  function toBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function setMsg(text, ok) { const m = $('#actionMsg'); m.textContent = text; m.className = 'msg' + (ok ? ' ok' : ''); }

  $('#saveBtn').addEventListener('click', async () => {
    const b = $('#saveBtn'); b.disabled = true; setMsg('저장 중…', true);
    try { await api({ action: 'save', name: me, pw, data: state }); setMsg('임시저장했습니다. 다른 기기에서도 이어서 쓸 수 있습니다.', true); }
    catch (e) { setMsg(e.message); }
    b.disabled = false;
  });

  $('#submitBtn').addEventListener('click', async () => {
    const reviews = validate();
    if (!reviews) { setMsg('빨간 칸을 채워 주세요. (소속·직위, 각 호마다 소제목 1개 이상 + 활동내용 1개 이상)'); return; }
    if (!confirm('자문의견서를 제출할까요?\n구글 드라이브에 ' + fileName() + ' 로 저장됩니다.')) return;
    const b = $('#submitBtn'); b.disabled = true; setMsg('한글 파일을 만들고 있습니다…', true);
    try {
      const bytes = await HWPX.build({ name: me, sosok: state.sosok.trim(), jikwi: state.jikwi.trim(), reviews });
      setMsg('드라이브에 저장 중…', true);
      const res = await api({ action: 'submit', name: me, pw, data: state, fileName: fileName(), file: toBase64(bytes) });
      const localUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }));
      showStatus(res.submittedAt, res.fileUrl, localUrl);
      setMsg('제출했습니다. 감사합니다!', true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setMsg(e.message); }
    b.disabled = false;
  });

  // 새로고침 시 세션 유지
  try {
    const ss = JSON.parse(sessionStorage.getItem('gne_session') || 'null');
    if (ss && ss.me) {
      sel.value = ss.me; $('#loginPw').value = ss.pw;
      $('#loginForm').requestSubmit();
    }
  } catch (e) { }
})();
