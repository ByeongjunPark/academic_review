(function () {
  // 호 목록·키워드·집필진은 구글시트('집필진 명단' 탭)에서 로그인 후 서버로부터 받는다.
  // 여기에는 기본 검토일정만 둔다.
  const DEFAULT_DATES = {
    '7월': '2026-06-11', '8월': '2026-07-15', '9월': '2026-08-12', '10월': '2026-09-09',
    '11월': '2026-10-07', '12월': '2026-11-11', '1월': '2026-12-02'
  };
  // 예전 기본값으로 저장된 임시저장은 새 기본값으로 바꿔 준다
  const OLD_DATES = {
    '7월': '2026-07-15', '8월': '2026-08-12', '9월': '2026-09-09', '10월': '2026-10-07',
    '11월': '2026-11-11', '12월': '2026-12-02', '1월': '2027-01-06'
  };
  const MAX_DATE = '2026-12-10';
  const DEFAULT_START = 18, DEFAULT_END = 21, MIN_HOURS = 3;

  let ISSUES = []; // [{key:'8월', label:'8월호', date, kw, title, writers}]
  const writersOf = issue => issue.writers || [];
  function setIssues(list) {
    ISSUES = (list || []).map(i => ({
      key: i.month, label: i.month + '호', date: DEFAULT_DATES[i.month] || '',
      summary: Array.isArray(i.summary) ? i.summary : (i.kw ? [i.kw] : []), title: /참조/.test(i.title || '') ? '' : (i.title || ''), writers: i.writers || []
    }));
  }

  const $ = s => document.querySelector(s);
  let me = null, myMonth = '', pw = '', state = null, saveTimer = null;

  // ---------- 상태 ----------
  const myIssues = () => ISSUES.filter(i => i.key !== myMonth);
  const blankSection = () => ({ title: '', items: [''] });
  const blankReview = i => ({ date: i.date, start: DEFAULT_START, end: DEFAULT_END, sections: [blankSection(), blankSection()] });
  function freshState() {
    const reviews = {};
    myIssues().forEach(i => { reviews[i.key] = blankReview(i); });
    return { sosok: '', jikwi: '', stamp: '', reviews };
  }
  function normalize(data) {
    const s = freshState();
    if (!data) return s;
    s.sosok = data.sosok || ''; s.jikwi = data.jikwi || ''; s.stamp = data.stamp || '';
    myIssues().forEach(i => {
      const r = data.reviews && data.reviews[i.key];
      if (!r) return;
      const start = Number.isInteger(r.start) ? r.start : DEFAULT_START;
      s.reviews[i.key] = {
        date: !r.date || r.date === OLD_DATES[i.key] ? i.date : r.date,
        start,
        end: Number.isInteger(r.end) ? r.end : start + 3,
        sections: (r.sections && r.sections.length ? r.sections : [blankSection()])
          .map(x => ({ title: x.title || '', items: x.items && x.items.length ? x.items : [''] }))
      };
    });
    return s;
  }
  const localKey = () => 'gne_review_' + me;
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(localKey(), JSON.stringify({ t: Date.now(), data: state }));
      updateProgress();
    }, 250);
  }

  // ---------- 팝업 ----------
  function dialog({ icon = '', title = '', body = '', ok = '확인', cancel = '' }) {
    const d = $('#dlg');
    $('#dlgIcon').textContent = icon; $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = body;
    $('#dlgOk').textContent = ok;
    $('#dlgCancel').textContent = cancel; $('#dlgCancel').hidden = !cancel;
    return new Promise(resolve => {
      const done = v => { d.close(); $('#dlgOk').onclick = $('#dlgCancel').onclick = null; d.oncancel = null; resolve(v); };
      $('#dlgOk').onclick = () => done(true);
      $('#dlgCancel').onclick = () => done(false);
      d.oncancel = e => { e.preventDefault(); done(false); };
      d.showModal(); $('#dlgOk').focus();
    });
  }
  const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    btn.disabled = true; btn.textContent = '확인 중…';
    try {
      const name = sel.value.replace(/\s+/g, ''), pass = $('#loginPw').value;
      const res = await api({ action: 'login', name, pw: pass });
      me = res.name; pw = pass; myMonth = res.month; setIssues(res.issues);
      sessionStorage.setItem('gne_session', JSON.stringify({ me, pw }));
      enter(res);
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false; btn.textContent = '들어가기';
  });
  $('#logout').addEventListener('click', () => { sessionStorage.removeItem('gne_session'); location.reload(); });

  function enter(res) {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey()) || 'null'); } catch (e) { }
    const serverT = res.savedAt || 0;
    state = normalize(local && local.t > serverT ? local.data : (res.data || (local && local.data)));
    $('#login').hidden = true; $('#editor').hidden = false;
    $('#whoName').textContent = me;
    $('#whoInfo').textContent = (myMonth ? myMonth + '호를 집필하셨으니, ' : '') + '나머지 ' + myIssues().length + '개 호의 검토 의견을 남겨 주세요.';
    showStatus(res.submittedAt, res.fileUrl);
    render();
  }

  function showStatus(at, url, localUrl) {
    const el = $('#status');
    if (!at) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '';
    el.append('✅ 제출 완료 · ' + new Date(at).toLocaleString('ko-KR') + ' · ');
    if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.textContent = '드라이브에서 보기'; el.append(a); }
    if (localUrl) { el.append(' · '); const d = document.createElement('a'); d.href = localUrl; d.download = fileName(); d.textContent = '내 PC에 받기'; el.append(d); }
    el.append(' (수정 후 다시 제출하면 파일이 교체돼요)');
  }

  // ---------- 화면 ----------
  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  function tpl(id) { return document.getElementById(id).content.firstElementChild.cloneNode(true); }

  function render() {
    $('#sosok').value = state.sosok; $('#jikwi').value = state.jikwi;
    showStamp();
    const box = $('#reviews'); box.innerHTML = '';
    myIssues().forEach(issue => box.append(renderReview(issue)));
    updateProgress();
  }
  $('#sosok').addEventListener('input', e => { state.sosok = e.target.value; e.target.classList.remove('invalid'); saveLocal(); });
  $('#jikwi').addEventListener('input', e => { state.jikwi = e.target.value; e.target.classList.remove('invalid'); saveLocal(); });

  // 호별 작성 완료 여부: 소제목 + 활동내용이 채워진 묶음이 1개 이상, 빈칸 섞인 묶음 없음, 날짜·시간 유효
  function reviewDone(rv) {
    if (!rv.date || rv.date > MAX_DATE || rv.end - rv.start < MIN_HOURS) return false;
    let ok = 0;
    for (const s of rv.sections) {
      const t = s.title.trim(), n = s.items.filter(x => x.trim()).length;
      if (!t && !n) continue;
      if (!t || !n) return false;
      ok++;
    }
    return ok > 0;
  }
  function updateProgress() {
    if (!state) return;
    const list = myIssues();
    let n = 0;
    list.forEach(i => {
      const done = reviewDone(state.reviews[i.key]);
      if (done) n++;
      const card = document.querySelector(`.review[data-key="${i.key}"]`);
      if (card) card.classList.toggle('done', done);
    });
    $('#progCount').textContent = n + ' / ' + list.length;
    $('#progBar').style.width = (list.length ? n / list.length * 100 : 0) + '%';
    $('#progLabel').textContent = n === list.length ? '모두 작성했어요! 제출만 하면 끝' : '작성 현황';
    document.querySelector('.progress').classList.toggle('all', n === list.length && n > 0);
  }

  // ---------- 인장 ----------
  function showStamp() {
    const has = !!state.stamp;
    $('#stampImg').hidden = !has; $('#stampEmpty').hidden = has; $('#stampDel').hidden = !has;
    if (has) $('#stampImg').src = state.stamp;
    $('#stampBox').classList.remove('invalid');
  }
  // 정사각형 PNG로 줄여서 저장 (시트 한 칸에 들어가도록 크기 제한)
  function shrinkStamp(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let out = '';
        for (const size of [200, 150, 110]) {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
          const w = img.naturalWidth * k, h = img.naturalHeight * k;
          c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          out = c.toDataURL('image/png');
          if (out.length < 45000) break;
        }
        URL.revokeObjectURL(img.src);
        resolve(out);
      };
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      img.src = URL.createObjectURL(file);
    });
  }
  $('#stampFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { state.stamp = await shrinkStamp(f); showStamp(); saveLocal(); setMsg('인장을 등록했어요.', true); }
    catch (err) { setMsg(err.message); }
  });
  $('#stampDel').addEventListener('click', () => { state.stamp = ''; showStamp(); saveLocal(); });

  const hh = h => String(h).padStart(2, '0') + ':00';

  function renderReview(issue) {
    const rv = state.reviews[issue.key];
    const el = tpl('tplReview');
    el.dataset.key = issue.key;
    el.querySelector('.rv-title').textContent = issue.label;
    el.querySelector('.rv-meta').textContent = ['집필 ' + writersOf(issue).join('·'), issue.title].filter(Boolean).join(' · ');
    const sum = el.querySelector('.rv-summary');
    if (issue.summary.length) issue.summary.forEach(t => { const li = document.createElement('li'); li.textContent = t; sum.append(li); });
    else sum.remove();
    const date = el.querySelector('.rv-date'), start = el.querySelector('.rv-start'), end = el.querySelector('.rv-end'), dur = el.querySelector('.rv-dur');
    date.max = MAX_DATE;
    for (let h = 0; h <= 23; h++) start.add(new Option(hh(h), h));
    for (let h = 1; h <= 24; h++) end.add(new Option(hh(h), h));
    const showDur = () => {
      const d = rv.end - rv.start;
      const bad = d < MIN_HOURS;
      dur.textContent = d > 0 ? d + '시간' + (bad ? ' · 3시간 이상 필요' : '') : '시간을 확인하세요';
      dur.classList.toggle('bad', bad);
      start.classList.toggle('invalid', bad); end.classList.toggle('invalid', bad);
    };
    const sync = () => { date.value = rv.date; start.value = rv.start; end.value = rv.end; showDur(); };
    sync();
    date.addEventListener('input', () => { rv.date = date.value; date.classList.toggle('invalid', !!rv.date && rv.date > MAX_DATE); saveLocal(); });
    start.addEventListener('change', () => {
      const keep = rv.end - rv.start;
      rv.start = Number(start.value);
      rv.end = Math.min(24, rv.start + Math.max(MIN_HOURS, keep)); // 시작을 옮기면 종료도 함께 옮김
      sync(); saveLocal();
    });
    end.addEventListener('change', () => { rv.end = Number(end.value); showDur(); saveLocal(); });
    el.querySelector('.rv-reset').addEventListener('click', () => {
      rv.date = issue.date; rv.start = DEFAULT_START; rv.end = DEFAULT_END; date.classList.remove('invalid'); sync(); saveLocal();
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
  // 반환: { reviews } 또는 { problems: [문장...], first: 요소 }
  function validate() {
    document.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    const bad = [], problems = [];
    if (!state.sosok.trim()) bad.push($('#sosok'));
    if (!state.jikwi.trim()) bad.push($('#jikwi'));
    if (bad.length) problems.push('기본 정보의 소속·직위를 적어 주세요.');
    const out = [];
    myIssues().forEach(issue => {
      const rv = state.reviews[issue.key];
      const card = document.querySelector(`.review[data-key="${issue.key}"]`);
      const L = issue.label;
      if (!rv.date) { bad.push(card.querySelector('.rv-date')); problems.push(`${L}: 검토일을 정해 주세요.`); }
      else if (rv.date > MAX_DATE) { bad.push(card.querySelector('.rv-date')); problems.push(`${L}: 검토일은 12월 10일까지만 가능해요.`); }
      const hours = rv.end - rv.start;
      if (hours < MIN_HOURS) {
        bad.push(card.querySelector('.rv-start'), card.querySelector('.rv-end'));
        problems.push(`${L}: 검토 시간이 ${hours > 0 ? hours + '시간' : '올바르지 않아요'} → 3시간 이상이어야 해요.`);
      }
      const secEls = card.querySelectorAll('.sec');
      const sections = [];
      let missing = false;
      rv.sections.forEach((s, i) => {
        const items = s.items.map(x => x.trim()).filter(Boolean);
        const title = s.title.trim();
        if (!title && !items.length) return; // 완전히 빈 소제목은 무시
        if (!title) { bad.push(secEls[i].querySelector('.sec-title')); missing = true; }
        if (!items.length) { bad.push(secEls[i].querySelector('.item-text')); missing = true; }
        sections.push({ title, items });
      });
      if (!sections.length) { bad.push(secEls[0].querySelector('.sec-title'), secEls[0].querySelector('.item-text')); missing = true; }
      if (missing) problems.push(`${L}: 소제목과 활동내용을 1개 이상 채워 주세요.`);
      out.push({ label: L, date: rv.date, start: rv.start, end: rv.end, sections });
    });
    bad.forEach(x => x && x.classList.add('invalid'));
    if (problems.length) return { problems, first: bad[0] };
    return { reviews: out };
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
    try { await api({ action: 'save', name: me, pw, data: state }); setMsg('임시저장했어요 💾', true); }
    catch (e) { setMsg(e.message); }
    b.disabled = false;
  });

  $('#submitBtn').addEventListener('click', async () => {
    setMsg('');
    const v = validate();
    if (v.problems) {
      await dialog({
        icon: '🙏', title: '아직 제출할 수 없어요',
        body: '<p>아래 항목을 확인해 주세요. 빨간 칸으로 표시해 두었어요.</p><ul>' + v.problems.map(p => '<li>' + escHtml(p) + '</li>').join('') + '</ul>'
      });
      if (v.first) v.first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!state.stamp) {
      const go = await dialog({ icon: '🖋️', title: '인장이 없어요', body: '<p>인장 없이 제출할까요?<br>나중에 인장을 등록하고 다시 제출할 수도 있어요.</p>', ok: '그냥 제출', cancel: '인장 등록하기' });
      if (!go) { $('#stampBox').classList.add('invalid'); $('#stampBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }
    const yes = await dialog({ icon: '📮', title: '자문의견서를 제출할까요?', body: '<p>구글 드라이브에<br><b>' + escHtml(fileName()) + '</b> 로 저장돼요.</p>', ok: '제출하기', cancel: '조금 더 볼게요' });
    if (!yes) return;
    const b = $('#submitBtn'); b.disabled = true; setMsg('한글 파일을 만들고 있어요…', true);
    try {
      const bytes = await HWPX.build({ name: me, sosok: state.sosok.trim(), jikwi: state.jikwi.trim(), stamp: state.stamp, reviews: v.reviews });
      setMsg('드라이브에 저장 중…', true);
      const res = await api({ action: 'submit', name: me, pw, data: state, fileName: fileName(), file: toBase64(bytes) });
      const localUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }));
      showStatus(res.submittedAt, res.fileUrl, localUrl);
      setMsg('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await dialog({ icon: '🎉', title: '제출 완료!', body: '<p>' + escHtml(me) + ' 선생님, 꼼꼼한 검토 정말 감사합니다.<br>수정할 내용이 생기면 언제든 다시 제출하시면 돼요.</p>', ok: '닫기' });
    } catch (e) {
      setMsg('');
      await dialog({ icon: '⚠️', title: '제출하지 못했어요', body: '<p>' + escHtml(e.message) + '</p><p>잠시 후 다시 시도해 주세요.</p>' });
    }
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
