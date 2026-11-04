// Читает .xlsx без сторонних пакетов, находит лист с операциями и отдаёт его как CSV-текст.

const dec = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

type Entry = { method: number; size: number; offset: number };

function readZip(buf: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(buf);
  let e = buf.byteLength - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Это не файл .xlsx (старый .xls не поддерживается, сохраните как .xlsx или .csv)");
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = new Map<string, Entry>();
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = v.getUint16(p + 28, true);
    out.set(td.decode(new Uint8Array(buf, p + 46, nameLen)), {
      method: v.getUint16(p + 10, true),
      size: v.getUint32(p + 20, true),
      offset: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

async function readText(buf: ArrayBuffer, en: Entry): Promise<string> {
  const v = new DataView(buf);
  const start = en.offset + 30 + v.getUint16(en.offset + 26, true) + v.getUint16(en.offset + 28, true);
  const raw = new Uint8Array(buf, start, en.size);
  if (en.method === 0) return new TextDecoder().decode(raw);
  if (en.method !== 8) throw new Error("Неподдерживаемое сжатие в файле");
  const stream = new Blob([raw as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

const colIndex = (letters: string) => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

const textOf = (xml: string) =>
  dec([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));

const attr = (s: string, n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(s)?.[1];

function sheetRows(xml: string, shared: string[]): string[][] {
  const dateCols = new Set<number>();
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Za-z]+)\d+"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      const t = attr(attrs, "t");

      let val = "";
      let isText = true;
      if (t === "inlineStr") {
        val = textOf(body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (t === "s") val = shared[Number(raw)] ?? "";
        else if (t === "str") val = dec(raw);
        else if (t === "b") val = raw === "1" ? "TRUE" : "FALSE";
        else if (t === "e") val = "";
        else {
          val = raw;
          isText = false;
        }
      }

      if (isText && /data|date|дата/i.test(val)) dateCols.add(idx);
      if (!isText && dateCols.has(idx)) {
        const n = Number(val);
        if (n > 20000 && n < 80000) {
          val = new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
        }
      }
      cells[idx] = val;
    }
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}

const hasAmount = (c: string) => /kwota|amount|сумма|wartość|wartosc/i.test(c);
const hasDate = (c: string) => /data|date|дата/i.test(c);

export async function xlsxToCsv(buf: ArrayBuffer): Promise<string> {
  const zip = readZip(buf);
  const get = async (name: string) => {
    const en = zip.get(name);
    return en ? readText(buf, en) : "";
  };

  const shared: string[] = [];
  for (const m of (await get("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(textOf(m[1]));
  }

  // Список листов в порядке книги: имя -> путь к файлу
  const targets = new Map<string, string>();
  for (const m of (await get("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const tg = attr(m[0], "Target");
    if (id && tg) targets.set(id, "xl/" + tg.replace(/^\/?(xl\/)?/, ""));
  }
  let sheets = [...(await get("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: dec(attr(m[0], "name") ?? ""),
    path: targets.get(attr(m[0], "r:id") ?? "") ?? "",
  }));
  sheets = sheets.filter((s) => zip.has(s.path));
  if (!sheets.length) {
    sheets = [...zip.keys()]
      .filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k))
      .sort()
      .map((path, i) => ({ name: `Лист ${i + 1}`, path }));
  }
  if (!sheets.length) throw new Error("В файле нет листов");

  // Ищем лист с таблицей операций: в одной строке заголовков есть и дата, и сумма
  const found: { name: string; rows: string[][] }[] = [];
  for (const s of sheets) {
    const rows = sheetRows(await get(s.path), shared);
    if (rows.some((r) => r.some(hasAmount) && r.some(hasDate))) found.push({ name: s.name, rows });
  }
  if (!found.length) {
    throw new Error(
      `Не нашёл лист с операциями: нужна таблица с колонками «Дата» и «Сумма». Листы в файле: ${sheets.map((s) => s.name).join(", ")}.`
    );
  }
  const pick =
    found.find((f) => /журнал|операц|транзакц|выписк|operacj|transakcj|history|historia/i.test(f.name)) ??
    found.sort((a, b) => b.rows.length - a.rows.length)[0];

  // Первая «пустая» строка с множеством ; нужна, чтобы парсер выбрал разделитель ;
  const lines = [";".repeat(60)];
  for (const r of pick.rows) {
    lines.push(r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";"));
  }
  return lines.join("\n");
}
// Возвращает строки листа, имя которого подходит под шаблон (или null, если такого листа нет).
export async function xlsxSheet(buf: ArrayBuffer, nameRe: RegExp): Promise<string[][] | null> {
  const zip = readZip(buf);
  const get = async (name: string) => {
    const en = zip.get(name);
    return en ? readText(buf, en) : "";
  };
  const shared: string[] = [];
  for (const m of (await get("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(textOf(m[1]));
  }
  const targets = new Map<string, string>();
  for (const m of (await get("xl/_rels/workbook.xml.rels")).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const tg = attr(m[0], "Target");
    if (id && tg) targets.set(id, "xl/" + tg.replace(/^\/?(xl\/)?/, ""));
  }
  for (const m of (await get("xl/workbook.xml")).matchAll(/<sheet\b[^>]*>/g)) {
    const name = dec(attr(m[0], "name") ?? "");
    const path = targets.get(attr(m[0], "r:id") ?? "") ?? "";
    if (nameRe.test(name) && zip.has(path)) return sheetRows(await get(path), shared);
  }
  return null;
}