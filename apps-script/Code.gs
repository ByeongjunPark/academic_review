/**
 * 학술분과 자문의견서 — 백엔드 (Google Apps Script 웹 앱)
 * 내용은 모두 구글시트에서 읽는다 (공개 저장소의 코드에는 이름·키워드·비밀번호를 두지 않음)
 *   - '위원' 탭: A열에 위원 이름 (로그인 허용 명단)
 *   - '집필진 명단' 탭: 1행 제목, A 발간월(예: 7월) / B 제목 / C 핵심 키워드 / D 담당자("홍길동, 김철수")
 *   - 'Password' 탭: A1 셀에 비밀번호
 *   - '제출현황' 탭: 자동 생성 (제출 현황·임시저장 데이터)
 * 구글드라이브 폴더: 제출된 자문의견서(이름).hwpx 저장
 */
const SHEET_ID = '1s5Fd3uCrn7eAKGsN5je2mvLzdtGAkAScyDQcQjJuQkw';
const FOLDER_ID = '1hJLt-wGSf1TCtn3JJB1G-aIW-laZCisA';
const SHEET_NAME = '제출현황';
const MEMBER_SHEET = '위원';
const ROSTER_SHEET = '집필진 명단';
const HEADER = ['이름', '집필월', '소속', '직위', '상태', '최종저장', '제출시각', '파일', '데이터(JSON)', '인장'];
const COL = { name: 1, month: 2, sosok: 3, jikwi: 4, state: 5, saved: 6, submitted: 7, file: 8, data: 9, stamp: 10 };

function doGet() {
  return out({ ok: true, service: 'academic_review' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const name = clean_(req.name || '');
    const roster = roster_();
    const me = roster.members.find(m => m.name === name);
    if (!me || !req.pw || String(req.pw) !== password_()) {
      return out({ ok: false, error: '이름 또는 비밀번호가 올바르지 않습니다.' });
    }
    if (req.action === 'login') return out(login(me, roster.issues));
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (req.action === 'save') return out(save(me, req.data));
      if (req.action === 'submit') return out(submit(me, req));
    } finally { lock.releaseLock(); }
    return out({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return out({ ok: false, error: '서버 오류: ' + err.message });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }
function clean_(s) { return String(s).replace(/\s+/g, ''); }

/** '집필진 명단' + '위원' 탭 → { issues:[{month,title,kw,writers}], members:[{name,month}] } */
function roster_() {
  const ss = ss_();
  const rs = ss.getSheetByName(ROSTER_SHEET);
  if (!rs) throw new Error("시트에 '" + ROSTER_SHEET + "' 탭이 없습니다.");
  const rows = rs.getLastRow() > 1 ? rs.getRange(2, 1, rs.getLastRow() - 1, 4).getDisplayValues() : [];
  const issues = rows
    .map(r => ({
      month: clean_(r[0]).replace(/호$/, ''),
      title: String(r[1]).trim(),
      kw: String(r[2]).replace(/\s+/g, ' ').trim(),
      writers: String(r[3]).split(/[,，、·\/\n]+/).map(clean_).filter(Boolean)
    }))
    .filter(i => /^\d{1,2}월$/.test(i.month));
  const monthOf = {};
  issues.forEach(i => i.writers.forEach(w => { monthOf[w] = i.month; }));
  const ms = ss.getSheetByName(MEMBER_SHEET);
  let names = ms && ms.getLastRow() > 0
    ? ms.getRange(1, 1, ms.getLastRow(), 1).getDisplayValues().map(r => clean_(r[0])).filter(Boolean)
    : [];
  if (!names.length) names = Object.keys(monthOf);
  return { issues, members: names.map(n => ({ name: n, month: monthOf[n] || '' })) };
}

function password_() {
  const sh = ss_().getSheetByName('Password');
  if (!sh) throw new Error("시트에 'Password' 탭이 없습니다.");
  const pw = String(sh.getRange('A1').getDisplayValue()).trim();
  if (!pw) throw new Error("'Password' 탭 A1 셀이 비어 있습니다.");
  return pw;
}

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    const ms = roster_().members;
    if (ms.length) sh.getRange(2, 1, ms.length, 5).setValues(ms.map(m => [m.name, m.month, '', '', '미제출']));
    sh.setFrozenRows(1);
    sh.setColumnWidth(COL.data, 120);
  }
  if (sh.getRange(1, COL.stamp).getValue() !== '인장') sh.getRange(1, COL.stamp).setValue('인장').setFontWeight('bold');
  return sh;
}

function row_(sh, me) {
  const last = sh.getLastRow();
  const names = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => clean_(r[0])) : [];
  const i = names.indexOf(me.name);
  if (i >= 0) return i + 2;
  sh.appendRow([me.name, me.month, '', '', '미제출']);
  return sh.getLastRow();
}

function login(me, issues) {
  const sh = sheet_();
  const r = row_(sh, me);
  const v = sh.getRange(r, 1, 1, HEADER.length).getValues()[0];
  let data = null;
  try { data = v[COL.data - 1] ? JSON.parse(v[COL.data - 1]) : null; } catch (e) { }
  if (data) data.stamp = v[COL.stamp - 1] || '';
  const t = d => (d instanceof Date ? d.getTime() : 0);
  return {
    ok: true, name: me.name, month: me.month, issues,
    data, savedAt: t(v[COL.saved - 1]), submittedAt: t(v[COL.submitted - 1]), fileUrl: v[COL.file - 1] || ''
  };
}

function save(me, data) {
  const sh = sheet_();
  const r = row_(sh, me);
  const now = new Date();
  sh.getRange(r, COL.sosok, 1, 2).setValues([[data.sosok || '', data.jikwi || '']]);
  sh.getRange(r, COL.saved).setValue(now);
  const stamp = String(data.stamp || '');
  if (stamp.length > 49000) throw new Error('인장 이미지가 너무 큽니다.');
  const rest = Object.assign({}, data); delete rest.stamp;
  sh.getRange(r, COL.data).setValue(JSON.stringify(rest));
  sh.getRange(r, COL.stamp).setValue(stamp);
  if (sh.getRange(r, COL.state).getValue() !== '제출') sh.getRange(r, COL.state).setValue('작성중');
  return { ok: true, savedAt: now.getTime() };
}

function submit(me, req) {
  const fileName = '자문의견서(' + me.name + ').hwpx';
  const bytes = Utilities.base64Decode(req.file);
  if (bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) throw new Error('파일 크기가 올바르지 않습니다.');
  const folder = DriveApp.getFolderById(FOLDER_ID);
  // 다시 제출하면 기존 파일을 휴지통으로 보내고 새로 저장
  const old = folder.getFilesByName(fileName);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = folder.createFile(Utilities.newBlob(bytes, 'application/hwp+zip', fileName));
  save(me, req.data);
  const sh = sheet_();
  const r = row_(sh, me);
  const now = new Date();
  sh.getRange(r, COL.state).setValue('제출');
  sh.getRange(r, COL.submitted).setValue(now);
  sh.getRange(r, COL.file).setValue(file.getUrl());
  return { ok: true, submittedAt: now.getTime(), fileUrl: file.getUrl() };
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 탭 확인 + '제출현황' 탭 생성 */
function setup() {
  const r = roster_();
  if (!r.issues.length) throw new Error("'" + ROSTER_SHEET + "' 탭에서 발간월을 읽지 못했습니다.");
  password_();
  sheet_();
  DriveApp.getFolderById(FOLDER_ID).getName();
  Logger.log('호 %s개, 위원 %s명 확인', r.issues.length, r.members.length);
}
