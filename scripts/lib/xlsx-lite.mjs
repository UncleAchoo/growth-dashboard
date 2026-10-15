// Minimal, dependency-free .xlsx reader — just enough to read the GA4
// "master feed" workbook (data/master-feed.xlsx) that the Apps Script fills.
// Returns { [sheetName]: rows[][] } with numbers as numbers and text as strings.
// Handles: zip (stored / deflate), shared strings (incl. rich text), inline
// strings, formula string results, booleans. Ignores styles, dates-as-serials
// (the feed writes dates as yyyymmdd numbers or ISO text, never Excel dates).
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  // Find the End Of Central Directory record (scan back from the end).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // Local header has its own name/extra lengths.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) files[name] = raw;
    else if (method === 8) files[name] = inflateRawSync(raw);
    else throw new Error(`unsupported zip compression method ${method} for ${name}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
// Text of every <t> inside a fragment (rich text = several runs).
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decode(m[1] || '')).join('');

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(path) {
  const files = unzip(readFileSync(path));
  const str = (name) => (files[name] ? files[name].toString('utf8') : null);

  const shared = [];
  const sst = str('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] || ''));

  // Sheet name → part path, via workbook.xml + its rels.
  const rels = {};
  for (const m of (str('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    let target = attr(m[0], 'Target') || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    rels[id] = target;
  }
  const out = {};
  for (const m of (str('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    const xml = str(rels[rid]);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
      const rAttr = rm[1] ?? rm[3] ?? '';
      const rNum = +(attr(`<x ${rAttr}>`, 'r') || rows.length + 1);
      const row = [];
      for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c ${cm[1]}>`;
        const ref = attr(tag, 'r');
        const t = attr(tag, 't');
        const body = cm[2] || '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        let val = null;
        if (t === 's') val = v ? shared[+v[1]] : null;
        else if (t === 'inlineStr') val = textOf(body);
        else if (t === 'str' || t === 'e') val = v ? decode(v[1]) : null;
        else if (t === 'b') val = v ? v[1] === '1' : null;
        else val = v ? Number(v[1]) : null;
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[rNum - 1] = row;
    }
    out[name] = Array.from(rows, (r) => (r ? Array.from(r, (c) => (c === undefined ? null : c)) : []));
  }
  return out;
}
