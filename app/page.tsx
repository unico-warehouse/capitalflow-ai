"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import { xlsxToCsv } from "./xlsx";
import { LoanBlock, loanFromXlsx, loanTips, withLoan, type Loan } from "./loan";

type Tx = { id: string; date: string; desc: string; amount: number; cat: string };
type Contrib = { id: string; date: string; name: string; amount: number };
type Goal = {
  id: string; name: string; target: number; start: string; deadline: string;
  contribs: { id: string; date: string; amount: number }[];
};
type Data = { txs: Tx[]; inv: Contrib[]; crypto: Contrib[]; goals: Goal[]; loan: Loan | null; file: string | null };
type Totals = {
  income: number; expenses: number; cats: [string, number][];
  months: [string, { inc: number; exp: number }][];
  inv: number; crypto: number; saved: number; total: number;
};

const EMPTY: Data = { txs: [], inv: [], crypto: [], goals: [], loan: null, file: null };
const KEY = "capitalflow-v1";
const TABS = [
  ["dash", "Обзор"], ["exp", "Расходы"], ["inv", "Инвестиции"], ["crypto", "Крипта"],
  ["goals", "Цели"], ["ai", "Аналитик"], ["stmt", "Загрузка данных"],
] as const;
type TabId = (typeof TABS)[number][0];
const C = { ink: "#17234d", gold: "#c9a227", pos: "#1e7a4f", neg: "#b3321f" };
const MN = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAY = 86400000;

const money = (n: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const mLabel = (k: string) => `${MN[+k.slice(5, 7) - 1] ?? k} ${k.slice(2, 4)}`;
const toMs = (d: string) => new Date(d + "T00:00:00").getTime();
const fmtDate = (iso: string) => iso.split("-").reverse().join(".");

const CATS: [string, RegExp][] = [
  ["Продукты", /biedronka|lidl|żabka|zabka|carrefour|auchan|kaufland|dino|stokrotka|lewiatan|spar\b/i],
  ["Транспорт", /uber|bolt|orlen|\bbp\b|shell|mpk|pkp|jakdojade|parking|paliw/i],
  ["Рестораны", /restaur|kfc|mcdonald|burger|pizza|cafe|kawiarn|starbucks|glovo|pyszne|wolt/i],
  ["Подписки", /netflix|spotify|youtube|apple|google|openai|anthropic|icloud|disney|hbo/i],
  ["Жильё и связь", /czynsz|rent|prąd|prad|gaz|energa|tauron|pge|internet|orange|play|t-mobile|vectra/i],
  ["Здоровье", /apteka|medicover|luxmed|lekarz|klinika/i],
];
const categorize = (s: string) => CATS.find(([, re]) => re.test(s))?.[0] ?? "Прочее";

const AMOUNT = ["kwota", "amount", "сумма", "wartość", "wartosc"];
const DESC = ["opis", "tytu", "description", "описание", "назначение", "kontrahent", "nazwa"];
const DATEK = ["data", "date", "дата"];

function parseCSV(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", ",", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function toNumber(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0]/g, "").replace(/[^\d,.\-+]/g, "");
  if (!s) return null;
  const n = Number(
    s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "")
  );
  return Number.isFinite(n) ? n : null;
}

function parseStatement(text: string): Tx[] | string {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return "Файл пустой.";
  const has = (c: string, keys: string[]) => keys.some((k) => c.toLowerCase().includes(k));
  let hi = rows.findIndex((r) => r.some((c) => has(c, AMOUNT)) && r.some((c) => has(c, DATEK)));
  if (hi < 0) hi = rows.findIndex((r) => r.some((c) => has(c, AMOUNT)));
  if (hi < 0) return "Не нашёл в файле таблицу операций: нужны колонки с датой и суммой (например «Дата» и «Сумма» или «Data» и «Kwota»).";
  const h = rows[hi].map((c) => c.toLowerCase());
  const col = (keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  const a = col(AMOUNT), d = col([...DESC, "коммент", "comment"]), dt = col(DATEK), cc = col(["категор", "kategori", "category"]);
  const txs: Tx[] = [];
  for (const r of rows.slice(hi + 1)) {
    const amount = toNumber(r[a] ?? "");
    if (amount === null || amount === 0) continue;
    const desc = (d >= 0 ? r[d] ?? "" : "").trim().slice(0, 90);
    const own = cc >= 0 ? (r[cc] ?? "").trim() : "";
    txs.push({ id: uid(), date: dt >= 0 ? (r[dt] ?? "").trim() : "", desc, amount, cat: own || categorize(desc) });
  }
  return txs.length ? txs : "Колонку суммы нашёл, но ни одной операции не распознал.";
}

function decode(buf: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1250").decode(buf); }
}

const monthKey = (d: string) => {
  let m = /(\d{4})[-./](\d{2})/.exec(d);
  if (m) return `${m[1]}-${m[2]}`;
  m = /(\d{2})[-./](\d{2})[-./](\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2]}` : null;
};
const cumAt = (items: { date: string; amount: number }[], m: string) =>
  items.reduce((s, c) => ((monthKey(c.date) ?? "") <= m ? s + c.amount : s), 0);
const sumOf = (items: { amount: number }[]) => items.reduce((s, c) => s + c.amount, 0);
const monthsOf = (items: { date: string }[]) =>
  [...new Set(items.map((x) => monthKey(x.date)).filter((k): k is string => !!k))].sort();

function monthsBetween(a: string, b: string) {
  const out: string[] = [];
  let y = +a.slice(0, 4), m = +a.slice(5, 7);
  const y2 = +b.slice(0, 4), m2 = +b.slice(5, 7);
  while ((y < y2 || (y === y2 && m <= m2)) && out.length < 36) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function normalize(raw: any): Data {
  const d: any = { ...EMPTY, ...raw };
  const c = (x: any): Contrib => ({ id: x.id ?? uid(), date: x.date ?? today(), name: x.name ?? "", amount: Number(x.amount ?? x.invested ?? 0) });
  d.inv = (d.inv ?? []).map(c);
  d.crypto = (d.crypto ?? []).map(c);
  d.goals = (d.goals ?? []).map((g: any) => ({
    id: g.id ?? uid(), name: g.name ?? "", target: Number(g.target) || 0, start: g.start ?? today(), deadline: g.deadline ?? "",
    contribs: g.contribs ?? (g.saved > 0 ? [{ id: uid(), date: today(), amount: g.saved }] : []),
  }));
  return d as Data;
}

function goalStats(g: Goal) {
  const saved = sumOf(g.contribs);
  const rest = Math.max(0, g.target - saved);
  const now = Date.now();
  const start = toMs(g.start);
  const avg = saved / Math.max((now - start) / (30.44 * DAY), 1);
  const pct = g.target > 0 ? Math.min(100, Math.round((saved / g.target) * 100)) : 0;
  const hasDl = !!g.deadline;
  const end = hasDl ? toMs(g.deadline) : 0;
  const frac = hasDl ? Math.min(1, Math.max(0, (now - start) / Math.max(end - start, DAY))) : 0;
  const planned = g.target * frac;
  const monthsLeft = hasDl ? Math.max((end - now) / (30.44 * DAY), 0) : 0;
  const forecast = avg > 0 && rest > 0 ? new Date(now + (rest / avg) * 30.44 * DAY).toISOString().slice(0, 10) : null;
  return {
    saved, rest, avg, pct, hasDl, planned, frac, forecast,
    diff: saved - planned,
    daysLeft: hasDl ? Math.ceil((end - now) / DAY) : 0,
    need: hasDl ? (monthsLeft > 0 ? rest / monthsLeft : rest) : 0,
  };
}

function buildSummary(data: Data, t: Totals) {
  const L = [
    "Мои финансы (суммы в zł, без названий операций):",
    `Капитал: ${money(t.total)} (инвестиции ${money(t.inv)}, крипта ${money(t.crypto)}, накопления по целям ${money(t.saved)})`,
  ];
  if (t.months.length) L.push("По месяцам: " + t.months.map(([m, v]) => `${m}: доход ${money(v.inc)}, расходы ${money(v.exp)}`).join("; "));
  if (t.cats.length) L.push("Расходы по категориям: " + t.cats.map(([n, s]) => `${n} ${money(s)}`).join("; "));
  if (data.goals.length) {
    L.push("Цели: " + data.goals.map((g) => `${g.name} ${money(sumOf(g.contribs))} из ${money(g.target)}${g.deadline ? `, срок ${g.deadline}` : ""}`).join("; "));
  }
  L.push("", "Мой вопрос: ");
  return L.join("\n");
}

const field = "bg-white border border-line rounded-md p-3 w-full";
const btn = "bg-ink text-paper rounded-md px-4 py-3 font-semibold hover:opacity-90";
const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-display text-4xl md:text-5xl font-semibold tracking-tight">{children}</h2>
);
const Empty = ({ text }: { text: string }) => (
  <p className="border border-dashed border-line rounded-lg p-6 text-ink/70">{text}</p>
);
const P = ({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) => (
  <div className={`bg-white border border-line rounded-lg p-4 md:p-5 ${className}`}>
    <h3 className="font-display text-xl font-semibold mb-3">{title}</h3>
    {children}
  </div>
);

type Series = { name: string; color: string; values: number[]; neg?: string };
function Chart({ labels, series, kind }: { labels: string[]; series: Series[]; kind: "bar" | "line" }) {
  if (!labels.length) return <Empty text="Для графика пока недостаточно данных." />;
  const W = 600, Hh = 220, L = 46, T = 10, B = 26;
  let max = Math.max(0, ...series.flatMap((s) => s.values));
  const min = Math.min(0, ...series.flatMap((s) => s.values));
  if (max === min) max = min + 1;
  const y = (v: number) => T + (Hh - T - B) * (1 - (v - min) / (max - min));
  const step = (W - L - 6) / labels.length;
  const cx = (i: number) => L + step * (i + 0.5);
  const short = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  const skip = Math.ceil(labels.length / 8);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" role="img">
        {[0, 1, 2, 3].map((i) => {
          const v = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#d5dae5" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C.ink} opacity=".6">{short(v)}</text>
            </g>
          );
        })}
        {labels.map((l, i) => i % skip === 0 && (
          <text key={i} x={cx(i)} y={Hh - 8} textAnchor="middle" fontSize="11" fill={C.ink} opacity=".6">{l}</text>
        ))}
        {kind === "bar"
          ? series.map((s, j) => s.values.map((v, i) => {
              const bw = (step * 0.7) / series.length;
              return (
                <rect key={`${j}-${i}`} x={L + step * i + step * 0.15 + j * bw} y={y(Math.max(v, 0))} width={bw - 1}
                  height={Math.max(Math.abs(y(v) - y(0)), 1)} rx="2" fill={v < 0 && s.neg ? s.neg : s.color} />
              );
            }))
          : series.map((s, j) => (
              <g key={j}>
                <polyline fill="none" stroke={s.color} strokeWidth="2.5" points={s.values.map((v, i) => `${cx(i)},${y(v)}`).join(" ")} />
                {s.values.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r="3" fill={s.color} />)}
              </g>
            ))}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm mt-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: s.color }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<TabId>("dash");
  const [data, setData] = useState<Data>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setData(normalize(JSON.parse(raw)));
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }, [data, ready]);

  const t = useMemo<Totals>(() => {
    const income = data.txs.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
    const expenses = data.txs.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
    const byCat: Record<string, number> = {};
    const byMonth: Record<string, { inc: number; exp: number }> = {};
    for (const x of data.txs) {
      if (x.amount < 0) byCat[x.cat] = (byCat[x.cat] ?? 0) - x.amount;
      const k = monthKey(x.date);
      if (k) {
        const m = (byMonth[k] ??= { inc: 0, exp: 0 });
        if (x.amount > 0) m.inc += x.amount; else m.exp -= x.amount;
      }
    }
    const inv = sumOf(data.inv), crypto = sumOf(data.crypto);
    const saved = sumOf(data.goals.flatMap((g) => g.contribs));
    return {
      income, expenses, inv, crypto, saved, total: inv + crypto + saved,
      cats: Object.entries(byCat).sort((p, q) => q[1] - p[1]),
      months: Object.entries(byMonth).sort((p, q) => p[0].localeCompare(q[0])),
    };
  }, [data]);

  return (
    <main className="min-h-screen md:flex">
      <aside className="bg-ink text-paper p-4 md:p-6 md:w-60 md:h-screen md:sticky md:top-0 md:shrink-0 md:flex md:flex-col">
        <h1 className="font-display text-2xl font-semibold mb-4 md:mb-10">CapitalFlow</h1>
        <nav className="flex md:flex-col md:flex-1 gap-1 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-left whitespace-nowrap px-3 py-2 border-l-4 ${id === "stmt" ? "md:mt-auto" : ""} ${
                tab === id ? "border-gold bg-white/10 font-bold" : "border-transparent hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex-1 min-w-0 p-5 md:p-12 max-w-5xl space-y-8">
        {tab === "dash" && (
          <>
            <Dash data={data} t={t} go={setTab} />
            <LoanBlock loan={data.loan} capital={t.total} onClear={() => setData({ ...data, loan: null })} />
          </>
        )}
        {tab === "exp" && <Expenses data={data} />}
        {tab === "inv" && <Savings title="Инвестиции" items={data.inv} onChange={(inv) => setData({ ...data, inv })} namePh="Например: ETF S&P 500" />}
        {tab === "crypto" && <Savings title="Крипта" items={data.crypto} onChange={(crypto) => setData({ ...data, crypto })} namePh="Например: BTC" />}
        {tab === "goals" && <Goals goals={data.goals} onChange={(goals) => setData({ ...data, goals })} />}
        {tab === "ai" && <Analyst data={data} t={t} />}
        {tab === "stmt" && <Statements data={data} t={t} setData={setData} />}
      </section>
    </main>
  );
}

function Dash({ data, t, go }: { data: Data; t: Totals; go: (t: TabId) => void }) {
  const empty = !data.txs.length && !data.inv.length && !data.crypto.length && !data.goals.length && !data.loan;
  const parts = [["Инвестиции", t.inv, "bg-ink"], ["Крипта", t.crypto, "bg-gold"], ["Цели", t.saved, "bg-pos"]] as const;
  const goalC = data.goals.flatMap((g) => g.contribs);
  const axis = monthsOf([...data.txs, ...data.inv, ...data.crypto, ...goalC]);
  const mm = Object.fromEntries(t.months) as Record<string, { inc: number; exp: number }>;
  const inc = axis.map((m) => mm[m]?.inc ?? 0);
  const exp = axis.map((m) => mm[m]?.exp ?? 0);
  const labels = axis.map(mLabel);
  return (
    <>
      <div>
        <p className="text-ink/70">Общий капитал (инвестиции, крипта, цели)</p>
        <p className="font-display text-6xl md:text-8xl font-semibold tracking-tight">{money(t.total)}</p>
      </div>

      <div>
        <div className="flex h-3 rounded-full overflow-hidden bg-line grow">
          {parts.map(([n, v, c]) => t.total > 0 && v > 0 && <div key={n} className={c} style={{ width: `${(v / t.total) * 100}%` }} />)}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
          {parts.map(([n, v, c]) => (
            <span key={n} className="flex items-center gap-2"><span className={`inline-block w-3 h-3 rounded-sm ${c}`} />{n} {money(v)}</span>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 border-y border-line divide-y sm:divide-y-0 sm:divide-x divide-line">
        {[["Доходы по выпискам", t.income, "text-pos"], ["Расходы по выпискам", t.expenses, "text-neg"], ["Баланс", t.income - t.expenses, ""]].map(([l, v, c]) => (
          <div key={l as string} className="py-5 sm:px-6 first:pl-0">
            <p className="text-ink/70">{l}</p>
            <p className={`font-display text-3xl font-semibold ${c}`}>{money(v as number)}</p>
          </div>
        ))}
      </div>

      {empty ? (
        <div className="bg-white border border-line rounded-lg p-6">
          <p className="mb-4">Здесь пока пусто. Загрузите файл с операциями или добавьте первые взносы и цели.</p>
          <div className="flex flex-wrap gap-3">
            <button className={btn} onClick={() => go("stmt")}>Загрузить данные</button>
            <button className={btn} onClick={() => go("inv")}>Добавить взнос</button>
            <button className={btn} onClick={() => go("goals")}>Создать цель</button>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          <P title="Доходы и расходы по месяцам">
            <Chart kind="bar" labels={labels} series={[{ name: "Доходы", color: C.pos, values: inc }, { name: "Расходы", color: C.neg, values: exp }]} />
          </P>
          <P title="Сбережения за месяц (доход − расход)">
            <Chart kind="bar" labels={labels} series={[{ name: "Сбережения", color: C.pos, neg: C.neg, values: inc.map((v, i) => v - exp[i]) }]} />
          </P>
          <P title="Накопления нарастающим итогом" className="md:col-span-2">
            <Chart kind="line" labels={labels} series={[
              { name: "Инвестиции", color: C.ink, values: axis.map((m) => cumAt(data.inv, m)) },
              { name: "Крипта", color: C.gold, values: axis.map((m) => cumAt(data.crypto, m)) },
              { name: "Цели", color: C.pos, values: axis.map((m) => cumAt(goalC, m)) },
            ]} />
          </P>
        </div>
      )}
    </>
  );
}

function Statements({ data, t, setData }: { data: Data; t: Totals; setData: (d: Data) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const period = t.months.length ? `${mLabel(t.months[0][0])} – ${mLabel(t.months[t.months.length - 1][0])}` : null;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(`Читаю файл «${file.name}»…`);
    try {
      const name = file.name.toLowerCase();
      const isXlsx = name.endsWith(".xlsx");
      if (!isXlsx && !name.endsWith(".csv") && !file.type.includes("csv")) {
        setMsg(`Файл «${file.name}» не подходит. Поддерживаются CSV и XLSX (старый .xls сохраните как .xlsx).`);
        return;
      }
      const buf = await file.arrayBuffer();
      const res = parseStatement(isXlsx ? await xlsxToCsv(buf) : decode(buf));
      if (typeof res === "string") return setMsg(res);
      const key = (x: Tx) => `${x.date}|${x.desc}|${x.amount}`;
      const seen = new Set(data.txs.map(key));
      const fresh = res.filter((x) => !seen.has(key(x)));
      const loan = isXlsx ? await loanFromXlsx(buf) : null;
      setData({ ...data, txs: [...data.txs, ...fresh], loan: loan ?? data.loan, file: file.name });
      setMsg(`Готово: новых операций ${fresh.length}, повторов пропущено ${res.length - fresh.length}.${loan ? " Кредит импортирован." : ""}`);
    } catch (err) {
      setMsg("Ошибка при чтении файла: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <>
      <H>Загрузка данных</H>
      <div>
        <label htmlFor="f" className="block mb-2">Загрузите выписку или бюджет (CSV, XLSX). Файл читается в браузере и никуда не отправляется.</label>
        <input id="f" type="file" accept=".csv,.xlsx,text/csv" onChange={onFile} className={field + " max-w-md"} />
        {msg && <p className="mt-3 break-words text-ink/80">{msg}</p>}
      </div>
      {data.txs.length === 0 ? (
        <Empty text="Файл ещё не загружен." />
      ) : (
        <div className="bg-white border border-line rounded-lg p-5 space-y-2">
          <p className="font-semibold text-pos">Файл загружен{data.file ? `: ${data.file}` : ""}</p>
          <p>Операций: {data.txs.length}{period ? `, период ${period}` : ""}.</p>
          <p className="text-ink/70 text-sm">Новый файл можно загрузить поверх: повторы пропускаются.</p>
          <button className="text-neg font-semibold" onClick={() => confirm("Удалить все операции?") && setData({ ...data, txs: [], file: null })}>
            Удалить все операции
          </button>
        </div>
      )}
    </>
  );
}

function Expenses({ data }: { data: Data }) {
  const out = data.txs.filter((x) => x.amount < 0);
  const months = monthsOf(out);
  const [sel, setSel] = useState<string | null>(null);
  if (!months.length) return <><H>Расходы</H><Empty text="Загрузите данные, и здесь появятся расходы по месяцам." /></>;
  const cur = sel && months.includes(sel) ? sel : months[months.length - 1];
  const sum = (m: string) => out.filter((x) => monthKey(x.date) === m).reduce((s, x) => s - x.amount, 0);
  const list = out.filter((x) => monthKey(x.date) === cur);
  const total = sum(cur);
  const i = months.indexOf(cur);
  const prev = i > 0 ? sum(months[i - 1]) : null;
  const byCat: Record<string, number> = {};
  list.forEach((x) => (byCat[x.cat] = (byCat[x.cat] ?? 0) - x.amount));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const ch = prev ? Math.round(((total - prev) / prev) * 100) : null;
  return (
    <>
      <H>Расходы</H>
      <P title="По месяцам">
        <Chart kind="bar" labels={months.map(mLabel)} series={[{ name: "Расходы", color: C.neg, values: months.map(sum) }]} />
      </P>
      <div className="flex gap-2 overflow-x-auto">
        {months.map((m) => (
          <button key={m} onClick={() => setSel(m)} className={`px-4 py-2 rounded-full border whitespace-nowrap ${m === cur ? "bg-ink text-paper border-ink" : "bg-white border-line"}`}>
            {mLabel(m)}
          </button>
        ))}
      </div>
      <div>
        <p className="text-ink/70">Потрачено в {mLabel(cur)}</p>
        <p className="font-display text-5xl font-semibold">{money(total)}</p>
        {ch !== null && (
          <p className={ch > 0 ? "text-neg" : "text-pos"}>{ch > 0 ? "+" : ""}{ch}% к прошлому месяцу ({money(prev as number)})</p>
        )}
      </div>
      <div>
        {cats.map(([name, s]) => (
          <div key={name} className="py-3 border-b border-line">
            <div className="flex justify-between mb-2"><span className="font-semibold">{name}</span><span>{money(s)} · {Math.round((s / total) * 100)}%</span></div>
            <div className="h-2 bg-line rounded-full"><div className="h-2 bg-ink rounded-full grow" style={{ width: `${(s / cats[0][1]) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <P title="Крупнейшие траты месяца">
        {[...list].sort((a, b) => a.amount - b.amount).slice(0, 5).map((x) => (
          <div key={x.id} className="flex justify-between gap-3 py-2 border-b border-line last:border-0 text-sm">
            <span className="min-w-0 truncate">{x.date} · {x.desc || x.cat}</span><span className="text-neg whitespace-nowrap">{money(-x.amount)}</span>
          </div>
        ))}
      </P>
    </>
  );
}

function Savings({ title, items, onChange, namePh }: { title: string; items: Contrib[]; onChange: (c: Contrib[]) => void; namePh: string }) {
  const [date, setDate] = useState(today());
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  function add() {
    const a = toNumber(amount);
    if (!name.trim() || !a || !date) return;
    onChange([...items, { id: uid(), date, name: name.trim(), amount: a }]);
    setName(""); setAmount("");
  }

  const total = sumOf(items);
  const axis = monthsOf(items);
  const byName: Record<string, number> = {};
  items.forEach((x) => (byName[x.name] = (byName[x.name] ?? 0) + x.amount));
  const names = Object.entries(byName).sort((a, b) => b[1] - a[1]);
  const dl = "dl-" + title;

  return (
    <>
      <H>{title}</H>
      <div>
        <p className="text-ink/70">Накоплено</p>
        <p className="font-display text-6xl font-semibold">{money(total)}</p>
      </div>
      {items.length > 0 && (
        <P title="Рост накоплений">
          <Chart kind="line" labels={axis.map(mLabel)} series={[{ name: "Накоплено", color: C.ink, values: axis.map((m) => cumAt(items, m)) }]} />
        </P>
      )}
      <div className="grid md:grid-cols-4 gap-3">
        <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        <input className={field} list={dl} placeholder={namePh} value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id={dl}>{names.map(([n]) => <option key={n} value={n} />)}</datalist>
        <input className={field} placeholder="Сумма взноса, zł" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className={btn} onClick={add}>Добавить взнос</button>
      </div>
      {items.length === 0 ? (
        <Empty text="Взносов пока нет. Укажите дату, название и сумму." />
      ) : (
        <>
          <div>
            {names.map(([n, s]) => (
              <div key={n} className="py-3 border-b border-line">
                <div className="flex justify-between mb-2"><span className="font-semibold">{n}</span><span>{money(s)} · {Math.round((s / total) * 100)}%</span></div>
                <div className="h-2 bg-line rounded-full"><div className="h-2 bg-ink rounded-full grow" style={{ width: `${(s / names[0][1]) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <P title="Последние взносы">
            {[...items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((x) => (
              <div key={x.id} className="flex justify-between items-center gap-3 py-2 border-b border-line last:border-0 text-sm">
                <span>{fmtDate(x.date)} · {x.name}</span>
                <span className="flex items-center gap-4"><b>{money(x.amount)}</b><button className="text-neg" onClick={() => onChange(items.filter((y) => y.id !== x.id))}>Удалить</button></span>
              </div>
            ))}
          </P>
        </>
      )}
    </>
  );
}

function Goals({ goals, onChange }: { goals: Goal[]; onChange: (g: Goal[]) => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [deadline, setDeadline] = useState("");
  const upd = (id: string, p: Partial<Goal>) => onChange(goals.map((g) => (g.id === id ? { ...g, ...p } : g)));

  function add() {
    const n = toNumber(target);
    if (!name.trim() || !n || n <= 0) return;
    onChange([...goals, { id: uid(), name: name.trim(), target: n, start: today(), deadline, contribs: [] }]);
    setName(""); setTarget(""); setDeadline("");
  }

  function topUp(g: Goal) {
    const n = toNumber(prompt("Сколько внести, zł? (отрицательное число уменьшит сумму)") ?? "");
    if (n) upd(g.id, { contribs: [...g.contribs, { id: uid(), date: today(), amount: n }] });
  }

  return (
    <>
      <H>Цели</H>
      <div className="grid md:grid-cols-4 gap-3">
        <input className={field} placeholder="Например: Отпуск" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} placeholder="Цель, zł" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        <input type="date" className={field} value={deadline} onChange={(e) => setDeadline(e.target.value)} title="Срок" />
        <button className={btn} onClick={add}>Создать цель</button>
      </div>
      {goals.length === 0 ? (
        <Empty text="Целей пока нет. Назовите цель, задайте сумму и срок." />
      ) : (
        goals.map((g) => {
          const s = goalStats(g);
          const tol = g.target * 0.02;
          const status = s.rest === 0
            ? ["Цель достигнута", "text-pos"]
            : !s.hasDl ? ["", ""]
            : s.diff > tol ? [`Опережаете график на ${money(s.diff)}`, "text-pos"]
            : s.diff < -tol ? [`Отстаёте от графика на ${money(-s.diff)}`, "text-neg"]
            : ["Идёте по графику", "text-gold"];
          const nowKey = today().slice(0, 7);
          const lbl = s.hasDl ? monthsBetween(g.start.slice(0, 7), g.deadline.slice(0, 7)) : [];
          return (
            <div key={g.id} className="bg-white border border-line rounded-lg p-5 space-y-4">
              <div className="flex justify-between flex-wrap gap-2">
                <p className="font-display text-2xl font-semibold">{g.name}</p>
                <p>{money(s.saved)} из {money(g.target)} · {s.pct}%</p>
              </div>
              <div className="relative h-3 bg-line rounded-full">
                <div className="h-3 bg-pos rounded-full grow" style={{ width: `${s.pct}%` }} />
                {s.hasDl && <div className="absolute -top-1 h-5 w-0.5 bg-gold" style={{ left: `${Math.min(100, s.frac * 100)}%` }} title="Где вы должны быть по плану" />}
              </div>
              {status[0] && <p className={`font-semibold ${status[1]}`}>{status[0]}</p>}
              {s.hasDl && s.rest > 0 && (
                <div className="grid sm:grid-cols-3 gap-4">
                  <div><p className="text-ink/70 text-sm">До {fmtDate(g.deadline)}</p><p className="font-display text-xl font-semibold">{s.daysLeft > 0 ? `${s.daysLeft} дн.` : "срок вышел"}</p></div>
                  <div><p className="text-ink/70 text-sm">Нужно вносить в месяц</p><p className="font-display text-xl font-semibold">{money(s.need)}</p></div>
                  <div><p className="text-ink/70 text-sm">Вносите сейчас в месяц</p><p className={`font-display text-xl font-semibold ${s.avg >= s.need ? "text-pos" : "text-neg"}`}>{money(s.avg)}</p></div>
                </div>
              )}
              {s.hasDl && s.rest > 0 && s.forecast && (
                <p className="text-sm text-ink/80">
                  При текущем темпе цель будет достигнута около {fmtDate(s.forecast)}
                  {s.forecast <= g.deadline ? ", то есть в срок." : ", то есть позже срока."}
                </p>
              )}
              {!s.hasDl && (
                <label className="text-sm block">Срок цели:{" "}
                  <input type="date" className="bg-white border border-line rounded-md p-2 ml-2" onChange={(e) => upd(g.id, { deadline: e.target.value })} />
                </label>
              )}
              {lbl.length > 1 && (
                <Chart kind="line" labels={lbl.map(mLabel)} series={[
                  { name: "План", color: C.gold, values: lbl.map((_, i) => (g.target * (i + 1)) / lbl.length) },
                  { name: "Факт", color: C.pos, values: lbl.filter((l) => l <= nowKey).map((l) => cumAt(g.contribs, l)) },
                ]} />
              )}
              <div className="flex gap-5">
                <button className="font-semibold" onClick={() => topUp(g)}>Внести</button>
                <button className="text-neg" onClick={() => onChange(goals.filter((x) => x.id !== g.id))}>Удалить</button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className={btn} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); }
      catch { alert("Не удалось скопировать. Выделите текст вручную."); }
    }}>
      {ok ? "Скопировано" : "Скопировать сводку"}
    </button>
  );
}

function Analyst({ data, t }: { data: Data; t: Totals }) {
  const tips: string[] = [];
  if (t.income > 0) {
    const rate = Math.round(((t.income - t.expenses) / t.income) * 100);
    tips.push(`Норма сбережений по выпискам: ${rate}%. ${rate < 10 ? "Это низко, ориентир обычно 10–20%." : "Хороший уровень."}`);
  }
  if (t.months.length >= 2) {
    const [[pm, p], [lm, l]] = t.months.slice(-2);
    if (p.exp > 0) {
      const ch = Math.round(((l.exp - p.exp) / p.exp) * 100);
      tips.push(`Расходы в ${mLabel(lm)} ${ch >= 0 ? "выросли" : "снизились"} на ${Math.abs(ch)}% по сравнению с ${mLabel(pm)} (${money(l.exp)} против ${money(p.exp)}).`);
    }
  }
  if (t.cats[0]) tips.push(`Больше всего уходит на «${t.cats[0][0]}»: ${money(t.cats[0][1])} (${Math.round((t.cats[0][1] / t.expenses) * 100)}% расходов).`);
  if (t.total > 0 && t.crypto / t.total > 0.3) tips.push(`Крипта составляет ${Math.round((t.crypto / t.total) * 100)}% накоплений. Доля высокая, стоит оценить риск.`);
  const subs = data.txs.filter((x) => x.cat === "Подписки" && x.amount < 0).reduce((s, x) => s - x.amount, 0);
  if (subs > 0) tips.push(`На подписки ушло ${money(subs)}. Проверьте, всеми ли вы пользуетесь.`);
  data.goals.forEach((g) => {
    const s = goalStats(g);
    if (s.rest <= 0) return;
    tips.push(s.hasDl
      ? `Цель «${g.name}»: осталось ${money(s.rest)}, нужно ${money(s.need)} в месяц, вы вносите ${money(s.avg)}. ${s.diff < 0 ? "Вы отстаёте от графика." : "Вы не отстаёте от графика."}`
      : `Цель «${g.name}»: осталось ${money(s.rest)}. Задайте срок, и я посчитаю нужный темп.`);
  });
  const now = today().slice(0, 7);
  const done = t.months.filter(([m]) => m !== now);
  const avgInc = done.length ? done.reduce((s, [, v]) => s + v.inc, 0) / done.length : null;
  tips.push(...loanTips(data.loan, avgInc));
  const summary = withLoan(buildSummary(data, t), data.loan);

  return (
    <>
      <H>Аналитик</H>
      <p className="text-ink/70">Выводы считаются по правилам прямо в браузере. Это не нейросеть.</p>
      {tips.length === 0 ? (
        <Empty text="Добавьте данные (выписку, взносы, цели), и здесь появятся выводы." />
      ) : (
        <ul>{tips.map((s, i) => <li key={i} className="py-3 border-b border-line">{s}</li>)}</ul>
      )}
      <P title="Спросить ИИ">
        <p className="text-ink/70 mb-3">Скопируйте сводку и вставьте её в чат с ИИ, затем задайте вопрос. В сводке только итоговые суммы, без описаний операций.</p>
        <pre className="whitespace-pre-wrap text-sm bg-paper rounded-md p-3 max-h-60 overflow-auto mb-3">{summary}</pre>
        <CopyBtn text={summary} />
      </P>
    </>
  );
}