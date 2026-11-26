/**
 * 학술분과 자문의견서 — 백엔드 (Google Apps Script 웹 앱)
 * 구글시트: 제출 현황·임시저장 데이터 보관
 * 구글드라이브 폴더: 제출된 자문의견서(이름).hwpx 저장
 */
const SHEET_ID = '1s5Fd3uCrn7eAKGsN5je2mvLzdtGAkAScyDQcQjJuQkw';
const FOLDER_ID = '1hJLt-wGSf1TCtn3JJB1G-aIW-laZCisA';
const PASSWORD = '여기에_비밀번호';  // 실제 비밀번호로 바꿔서 붙여넣기 (저장소에는 올리지 않음)
const SHEET_NAME = '제출현황';
const MEMBERS = [
  ['7월', '박병준'], ['7월', '김순님'], ['8월', '문현우'], ['8월', '한지희'],
  ['9월', '홍성진'], ['9월', '김민중'], ['10월', '김은지'], ['10월', '박수영'],
  ['11월', '최정엽'], ['11월', '구은복'], ['12월', '김수현'], ['12월', '김지의'],
  ['1월', '최시경'], ['1월', '김범준']
];
const HEADER = ['이름', '집필월', '소속', '직위', '상태', '최종저장', '제출시각', '파일', '데이터(JSON)'];
const COL = { name: 1, month: 2, sosok: 3, jikwi: 4, state: 5, saved: 6, submitted: 7, file: 8, data: 9 };

function doGet() {
  return out({ ok: true, service: 'academic_review' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!MEMBERS.some(m => m[1] === req.name)) return out({ ok: false, error: '등록된 위원 이름이 아닙니다.' });
    if (req.pw !== PASSWORD) return out({ ok: false, error: '비밀번호가 올바르지 않습니다.' });
    if (req.action === 'login') return out(login(req.name));
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (req.action === 'save') return out(save(req.name, req.data));
      if (req.action === 'submit') return out(submit(req));
    } finally { lock.releaseLock(); }
    return out({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return out({ ok: false, error: '서버 오류: ' + err.message });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.getRange(2, 1, MEMBERS.length, 5).setValues(MEMBERS.map(m => [m[1], m[0], '', '', '미제출']));
    sh.setFrozenRows(1);
    sh.setColumnWidth(COL.data, 120);
  }
  return sh;
}

function row_(sh, name) {
  const names = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(r => r[0]);
  const i = names.indexOf(name);
  if (i >= 0) return i + 2;
  const m = MEMBERS.find(x => x[1] === name);
  sh.appendRow([name, m[0], '', '', '미제출']);
  return sh.getLastRow();
}

function login(name) {
  const sh = sheet_();
  const r = row_(sh, name);
  const v = sh.getRange(r, 1, 1, HEADER.length).getValues()[0];
  let data = null;
  try { data = v[COL.data - 1] ? JSON.parse(v[COL.data - 1]) : null; } catch (e) { }
  const t = d => (d instanceof Date ? d.getTime() : 0);
  return { ok: true, data, savedAt: t(v[COL.saved - 1]), submittedAt: t(v[COL.submitted - 1]), fileUrl: v[COL.file - 1] || '' };
}

function save(name, data) {
  const sh = sheet_();
  const r = row_(sh, name);
  const now = new Date();
  sh.getRange(r, COL.sosok, 1, 2).setValues([[data.sosok || '', data.jikwi || '']]);
  sh.getRange(r, COL.saved).setValue(now);
  sh.getRange(r, COL.data).setValue(JSON.stringify(data));
  if (sh.getRange(r, COL.state).getValue() !== '제출') sh.getRange(r, COL.state).setValue('작성중');
  return { ok: true, savedAt: now.getTime() };
}

function submit(req) {
  const name = req.name;
  const fileName = '자문의견서(' + name + ').hwpx';
  const bytes = Utilities.base64Decode(req.file);
  if (bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) throw new Error('파일 크기가 올바르지 않습니다.');
  const folder = DriveApp.getFolderById(FOLDER_ID);
  // 다시 제출하면 기존 파일을 휴지통으로 보내고 새로 저장
  const old = folder.getFilesByName(fileName);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = folder.createFile(Utilities.newBlob(bytes, 'application/hwp+zip', fileName));
  save(name, req.data);
  const sh = sheet_();
  const r = row_(sh, name);
  const now = new Date();
  sh.getRange(r, COL.state).setValue('제출');
  sh.getRange(r, COL.submitted).setValue(now);
  sh.getRange(r, COL.file).setValue(file.getUrl());
  return { ok: true, submittedAt: now.getTime(), fileUrl: file.getUrl() };
}

/** 처음 한 번 편집기에서 실행: 권한 승인 + 시트 탭 생성 */
function setup() {
  sheet_();
  DriveApp.getFolderById(FOLDER_ID).getName();
}
