// 프린세스(독서 모임 페이지)의 책을 이 책장으로 가져온다.
//   - 프린세스 READ에 있는데 여기 READ에 없는 책 → 같은 모임 날짜로 READ에 넣고, WISH에 있으면 뺀다.
//   - ‘모임에서 읽을 책’ 분류 → 프린세스 UPCOMING과 같은 책·같은 순서로 맞춘다.
//   - 여기 없는 책·작가 정보는 프린세스의 BOOKS·AUTHORS 줄을 그대로 옮기고, 표지는 다음 b 번호로 복사한다.
// 쓰는 법: 이 저장소 맨 위 폴더에서 node .github/sync-princess.mjs <프린세스 폴더>
// 바뀐 게 있으면 index.html을 고치고 바뀐 내용을 한 줄로 찍는다. 없으면 아무것도 찍지 않는다.
import fs from 'node:fs';
import path from 'node:path';

const MEETING = '모임에서 읽을 책';
const princessDir = process.argv[2];
if (!princessDir) throw new Error('프린세스 폴더를 알려 주세요');
const bookFile = 'index.html';
const princessFile = path.join(princessDir, 'index.html');

const key = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, '');

// 맨 위 책 데이터 <script>(두 번째 <script>)의 줄 범위와 값
function load(file, names) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const open = lines.findIndex((l, i) => l === '<script>' && i > lines.indexOf('<script>'));
  const close = lines.indexOf('</script>', open);
  const data = new Function(lines.slice(open + 1, close).join('\n') + `; return { ${names} };`)();
  return { lines, data, open, close };
}
// const NAME = [ ... ]; 또는 { ... }; 의 여는 줄과 닫는 줄 번호
function range(lines, name, from, to) {
  const s = lines.findIndex((l, i) => i > from && i < to && l.startsWith(`const ${name} = `));
  const e = lines.findIndex((l, i) => i > s && /^[\]}];$/.test(l));
  if (s < 0 || e < 0) throw new Error(`${name}를 찾지 못함`);
  return [s, e];
}
// BOOKS·AUTHORS에서 한 항목의 줄들 ('  \'제목\': {' ~ '  },')
function block(lines, [s, e], name) {
  for (let i = s + 1; i < e; i++) {
    const m = /^  '(.*)': \{$/.exec(lines[i]);
    if (m && key(m[1]) === key(name)) {
      const end = lines.indexOf('  },', i);
      return lines.slice(i, end + 1);
    }
  }
  return null;
}

const P = load(princessFile, 'UPCOMING, READ, BOOKS, AUTHORS');
const B = load(bookFile, 'WISH, READ, BOOKS, AUTHORS');
const pl = P.lines;
let bl = B.lines;

const pRead = range(pl, 'READ', P.open, P.close);
const pUp = range(pl, 'UPCOMING', P.open, P.close);
const pBooks = range(pl, 'BOOKS', P.open, P.close);
const pAuthors = range(pl, 'AUTHORS', P.open, P.close);

const changes = [];
const needInfo = new Set();   // 책 정보·표지를 챙겨야 하는 제목

// 1. 읽은 책: 프린세스에만 있는 책을 날짜 순서 자리에 넣는다
const have = new Set(B.data.READ.map(([, t]) => key(t)));
for (let i = pRead[0] + 1; i < pRead[1]; i++) {
  const m = /^  \['(\d{4}-\d{2}-\d{2})', (.*)\],$/.exec(pl[i]);
  if (!m) continue;
  const title = new Function(`return ${m[2]}`)();
  if (have.has(key(title))) continue;
  const [s, e] = range(bl, 'READ', 0, bl.length);
  let at = e;
  while (at - 1 > s && (/'(\d{4}-\d{2}-\d{2})'/.exec(bl[at - 1]) || [])[1] > m[1]) at--;
  bl.splice(at, 0, pl[i]);
  have.add(key(title));
  needInfo.add(title);
  changes.push(`${title} 읽음(${Number(m[1].slice(5, 7))}.${Number(m[1].slice(8))})`);
}

// 2. 읽고 싶은 책: 다 읽은 책은 빼고, ‘모임에서 읽을 책’은 프린세스 UPCOMING과 같게
{
  const [s, e] = range(bl, 'WISH', 0, bl.length);
  const wish = bl.slice(s + 1, e).map((line) => {
    const m = /^  \[('(?:[^'\\]|\\.)*'), (.*)\],$/.exec(line);
    return m ? { line, group: new Function(`return ${m[1]}`)(), title: new Function(`return ${m[2]}`)() } : { line };
  });
  const others = new Set(wish.filter((w) => w.group !== MEETING && w.title).map((w) => key(w.title)));
  const upcoming = [], now = [];
  for (let i = pUp[0] + 1; i < pUp[1]; i++) {
    if (!/^  ['"].*,$/.test(pl[i])) continue;
    const lit = pl[i].trim().slice(0, -1);   // '제목' 글자 그대로
    const title = new Function(`return ${lit}`)();
    if (have.has(key(title)) || others.has(key(title))) continue;
    upcoming.push(`  ['${MEETING}', ${lit}],`);
    now.push(key(title));
    needInfo.add(title);
  }
  const firstMeeting = wish.findIndex((w) => w.group === MEETING);
  const kept = wish.filter((w) => !(w.title && (have.has(key(w.title)) || w.group === MEETING)));
  const at = firstMeeting < 0 ? kept.length : wish.slice(0, firstMeeting).filter((w) => kept.includes(w)).length;
  const next = [...kept.slice(0, at).map((w) => w.line), ...upcoming, ...kept.slice(at).map((w) => w.line)];
  const before = bl.slice(s + 1, e);
  if (next.join('\n') !== before.join('\n')) {
    bl.splice(s + 1, e - s - 1, ...next);
    const was = new Set(wish.filter((w) => w.group === MEETING && !have.has(key(w.title))).map((w) => key(w.title)));
    if (was.size !== now.length || now.some((t) => !was.has(t))) changes.push('모임에서 읽을 책 맞춤');
    else if (!changes.length) changes.push('모임에서 읽을 책 순서 맞춤');
  }
}

// 3. 책·작가 정보: 여기 없으면 프린세스 줄을 그대로 맨 아래에 붙인다
for (const title of needInfo) {
  const books = range(bl, 'BOOKS', 0, bl.length);
  if (!block(bl, books, title)) {
    const b = block(pl, pBooks, title);
    if (b) { bl.splice(books[1], 0, ...b); changes.push(`${title} 책 정보`); }
  }
  const pb = Object.entries(P.data.BOOKS).find(([t]) => key(t) === key(title));
  const author = pb && pb[1].author;
  if (!author) continue;
  const authors = range(bl, 'AUTHORS', 0, bl.length);
  if (!block(bl, authors, author)) {
    const a = block(pl, pAuthors, author);
    if (a) { bl.splice(authors[1], 0, ...a); changes.push(`${author} 작가 정보`); }
  }
}

// 4. 표지: 여기 없으면 프린세스 표지를 다음 b 번호로 복사한다
{
  const idsAt = bl.findIndex((l) => /^ *const COVER_IDS = new Set\('/.test(l));
  const mapAt = bl.findIndex((l) => /^ *const COVER_MAP = \{ /.test(l));
  const pIds = pl.find((l) => /^ *const COVER_IDS = new Set\('/.test(l));
  const pMap = new Function(`return ${/= (\{.*\});\s*$/.exec(pl.find((l) => /^ *const COVER_MAP = \{ /.test(l)))[1]}`)();
  const bMap = new Function(`return ${/= (\{.*\});\s*$/.exec(bl[mapAt])[1]}`)();
  for (const title of needInfo) {
    const k = key(title);
    if (bMap[k]) continue;
    const from = pMap[k];
    const file = from && path.join(princessDir, 'assets/covers', `${from}.jpg`);
    if (!from || !new RegExp(`\\b${from}\\b`).test(pIds) || !fs.existsSync(file)) continue;
    const last = Math.max(...[...bl[idsAt].matchAll(/\bb(\d{3})\b/g)].map((m) => Number(m[1])));
    const id = 'b' + String(last + 1).padStart(3, '0');
    fs.copyFileSync(file, path.join('assets/covers', `${id}.jpg`));
    bl[idsAt] = bl[idsAt].replace(/'\.split\(' '\)\);$/, ` ${id}'.split(' '));`);
    bl[mapAt] = bl[mapAt].replace(/ \};$/, `, '${k.replace(/'/g, "\\'")}': '${id}' };`);
    bMap[k] = id;
    changes.push(`${title} 표지 ${id}`);
  }
}

if (changes.length) {
  // 고친 파일이 그대로 읽히는지 확인한 뒤 저장
  new Function(bl.slice(B.open + 1, bl.indexOf('</script>', B.open + 1)).join('\n') + '; return [WISH, READ, BOOKS, AUTHORS];')();
  fs.writeFileSync(bookFile, bl.join('\n'));
  console.log(changes.join(', '));
}
