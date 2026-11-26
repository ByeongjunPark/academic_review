// 검토 일지 HWPX 생성 — template/ 의 원본 양식(자문의견서(이름).hwp → HWPX 변환본)에 내용을 채운다.
(function () {
  const FILES = [
    'mimetype', 'version.xml', 'Contents/header.xml', 'Contents/section0.xml', 'settings.xml',
    'Preview/PrvText.txt', 'META-INF/container.rdf', 'Contents/content.hpf', 'BinData/image1.png',
    'META-INF/container.xml', 'META-INF/manifest.xml', 'Preview/PrvImage.png'
  ];
  const BINARY = /\.png$/;
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const CHAR = 50;         // 검정 12pt (원본 예시 글자모양의 검정 버전)
  const PARA_DATE = 47;    // 가운데 정렬
  const PARA_HEAD = 50;    // ▣ 소제목
  const PARA_ITEM = 51;    // - 활동내용 (내어쓰기)

  let cache = null;
  async function loadTemplate() {
    if (cache) return cache;
    const out = {};
    await Promise.all(FILES.map(async f => {
      const r = await fetch('template/' + f + '?v=2');
      if (!r.ok) throw new Error('양식 파일을 불러오지 못했습니다: ' + f);
      out[f] = BINARY.test(f) ? await r.arrayBuffer() : await r.text();
    }));
    return (cache = out);
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const oneLine = s => String(s || '').replace(/\s*\n\s*/g, ' ').trim();

  const para = (paraPr, text) =>
    `<hp:p id="2147483648" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${CHAR}"><hp:t>${esc(text)}</hp:t></hp:run></hp:p>`;

  const cell = (col, row, bf, w, h, paras) =>
    `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${bf}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
    paras + `</hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/>` +
    `<hp:cellSz width="${w}" height="${h}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const wd = DAYS[new Date(y, m - 1, d).getDay()];
    return `${y}. ${String(m).padStart(2, '0')}. ${String(d).padStart(2, '0')}.(${wd})`;
  }
  const hh = h => String(h).padStart(2, '0') + ':00';
  const fmtTime = start => `(${hh(start)}~${hh(start + 3)})`;

  // reviews: [{label:'8월호', date:'2026-08-12', start:18, sections:[{title, items:[...]}]}]
  function buildRows(reviews) {
    return reviews.map((rv, i) => {
      const row = i + 2;
      const last = i === reviews.length - 1;
      const bf = i === 0 ? [23, 24] : last ? [27, 28] : [25, 26];
      const dateParas = para(PARA_DATE, rv.label) + para(PARA_DATE, fmtDate(rv.date)) + para(PARA_DATE, fmtTime(rv.start));
      let n = 0, body = '';
      rv.sections.forEach(sec => {
        body += para(PARA_HEAD, ' ▣ ' + oneLine(sec.title)); n++;
        sec.items.forEach(it => { const t = oneLine(it); body += para(PARA_ITEM, '  - ' + t); n += Math.max(1, Math.ceil(t.length / 38)); });
      });
      const h = Math.max(7814, n * 1740 + 1400);
      return '<hp:tr>' + cell(0, row, bf[0], 10801, h, dateParas) + cell(1, row, bf[1], 37106, h, body) + '</hp:tr>';
    }).join('');
  }

  async function build(info) {
    const t = await loadTemplate();
    const zip = new JSZip();
    const stamp = info.stamp ? await stampBytes(info.stamp) : null;
    const section = t['Contents/section0.xml']
      .replace('@@SOSOK@@', esc(info.sosok))
      .replace('@@JIKWI@@', esc(info.jikwi))
      .replace('@@STAMP@@', stamp ? stampPic(stamp.px) : '')
      .replace('@@NAME@@', esc(info.name))
      .replace('@@ROWCNT@@', String(info.reviews.length + 2))
      .replace('@@ROWS@@', buildRows(info.reviews));
    let hpf = t['Contents/content.hpf'];
    if (stamp) hpf = hpf.replace('</opf:manifest>',
      '<opf:item id="' + STAMP_ID + '" href="BinData/' + STAMP_ID + '.png" media-type="image/png" isEmbeded="1"/></opf:manifest>');
    for (const f of FILES) {
      const data = f === 'Contents/section0.xml' ? section : f === 'Contents/content.hpf' ? hpf : t[f];
      zip.file(f, data, f === 'mimetype' ? { compression: 'STORE' } : { compression: 'DEFLATE' });
    }
    if (stamp) zip.file('BinData/' + STAMP_ID + '.png', stamp.bytes, { compression: 'DEFLATE' });
    return zip.generateAsync({ type: 'uint8array', mimeType: 'application/hwp+zip' });
  }

  // ---------- 인장 (10mm × 10mm, 성명 칸 "(인)" 위에 겹쳐 놓음) ----------
  const STAMP_ID = 'stamp1';
  const STAMP_SIZE = 2835;          // 10mm (1mm = 283.46 HWPUNIT)
  const STAMP_X = 49293;            // 용지 왼쪽에서 173.9mm (성명 칸 "(인)" 중심 178.9mm - 5mm)
  const STAMP_Y = 15080;            // 용지 위에서 53.2mm (성명 칸 중심 58.2mm - 5mm)
  const u32 = n => (n < 0 ? 4294967296 + n : n);

  async function stampBytes(dataUrl) {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('인장 이미지를 읽지 못했습니다.')); img.src = dataUrl; });
    return { bytes, px: img.naturalWidth || 200 };
  }

  function stampPic(px) {
    const org = px * 75;            // 96dpi 기준 원본 크기
    const sc = (STAMP_SIZE / org).toFixed(6);
    const half = Math.round(STAMP_SIZE / 2);
    return `<hp:pic id="1151999001" zOrder="99" numberingType="PICTURE" textWrap="IN_FRONT_OF_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="78199001" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${org}" height="${org}"/><hp:curSz width="${STAMP_SIZE}" height="${STAMP_SIZE}"/>` +
      `<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${half}" centerY="${half}" rotateimage="1"/>` +
      `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${sc}" e2="0" e3="0" e4="0" e5="${sc}" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${org}" y="0"/><hc:pt2 x="${org}" y="${org}"/><hc:pt3 x="0" y="${org}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="${org}" top="0" bottom="${org}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
      `<hp:imgDim dimwidth="${org}" dimheight="${org}"/><hc:img binaryItemIDRef="${STAMP_ID}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
      `<hp:sz width="${STAMP_SIZE}" widthRelTo="ABSOLUTE" height="${STAMP_SIZE}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="${u32(STAMP_Y)}" horzOffset="${STAMP_X}"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>인장</hp:shapeComment></hp:pic>`;
  }

  window.HWPX = { build, fmtDate, fmtTime };
})();
