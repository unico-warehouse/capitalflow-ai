"use client";

import { useEffect, useMemo, useState } from "react";
import { xlsxToCsv } from "./xlsx";

type Tx = { id: string; date: string; desc: string; amount: number; cat: string };
type Holding = { id: string; name: string; invested: number; value: number };
type Goal = { id: string; name: string; target: number; saved: number };
type Data = { txs: Tx[]; inv: Holding[]; crypto: Holding[]; goals: Goal[] };
type Month = [string, { inc: number; exp: number }];
type Totals = {
  income: number; expenses: number; cats: [string, number][]; months: Month[];
  inv: number; crypto: number; saved: number; total: number;
};

const EMPTY: Data = { txs: [], inv: [], crypto: [], goals: [] };
const KEY = "capitalflow-v1";
const TABS = [
  ["dash", "Обзор"], ["stmt", "Выписки"], ["exp", "Расходы"], ["inv", "Инвестиции"],
  ["crypto", "Крипта"], ["goals", "Цели"], ["ai", "Аналитик"],
] as const;
type TabId = (typeof TABS)[number][0];

const money = (n: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const uid = () => Math.random().toString(36).slice(2, 10);

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

function parseStatement(text: string): { txs: Tx[]; cols: string } | string {
  const rows = parseCSV(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return "Файл пустой.";
  const has = (c: string, keys: string[]) => keys.some((k) => c.toLowerCase().includes(k));
  let hi = rows.findIndex((r) => r.some((c) => has(c, AMOUNT)) && r.some((c) => has(c, DATEK)));
  if (hi < 0) hi = rows.findIndex((r) => r.some((c) => has(c, AMOUNT)));
  if (hi < 0) {
    return "Не нашёл в файле таблицу операций: нужны колонки с датой и суммой (например «Дата» и «Сумма» или «Data» и «Kwota»). Проверьте заголовки.";
  }
  const headers = rows[hi];
  const h = headers.map((c) => c.toLowerCase());
  const col = (keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  const a = col(AMOUNT);
  const d = col([...DESC, "коммент", "comment"]);
  const dt = col(DATEK);
  const cc = col(["категор", "kategori", "category"]);
  const txs: Tx[] = [];
  for (const r of rows.slice(hi + 1)) {
    const amount = toNumber(r[a] ?? "");
    if (amount === null || amount === 0) continue;
    const desc = (d >= 0 ? r[d] ?? "" : "").trim().slice(0, 90);
    const own = cc >= 0 ? (r[cc] ?? "").trim() : "";
    txs.push({ id: uid(), date: dt >= 0 ? (r[dt] ?? "").trim() : "", desc, amount, cat: own || categorize(desc) });
  }
  if (!txs.length) return "Колонку суммы нашёл, но ни одной операции не распознал.";
  const cols = `сумма: «${headers[a]}», описание: «${d >= 0 ? headers[d] : "не найдено"}», дата: «${dt >= 0 ? headers[dt] : "не найдена"}», категория: «${cc >= 0 ? headers[cc] : "определена автоматически"}»`;
  return { txs, cols };
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

function buildSummary(data: Data, t: Totals) {
  const L = [
    "Мои финансы (суммы в zł, без названий операций):",
    `Капитал: ${money(t.total)} (инвестиции ${money(t.inv)}, крипта ${money(t.crypto)}, накопления ${money(t.saved)})`,
  ];
  if (t.months.length) L.push("По месяцам: " + t.months.map(([m, v]) => `${m}: доход ${money(v.inc)}, расходы ${money(v.exp)}`).join("; "));
  if (t.cats.length) L.push("Расходы по категориям: " + t.cats.map(([n, s]) => `${n} ${money(s)}`).join("; "));
  if (data.goals.length) L.push("Цели: " + data.goals.map((g) => `${g.name} ${money(g.saved)} из ${money(g.target)}`).join("; "));
  const hold = [...data.inv, ...data.crypto];
  if (hold.length) L.push("Активы: " + hold.map((x) => `${x.name} вложено ${money(x.invested)}, сейчас ${money(x.value)}`).join("; "));
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

export default function Home() {
  const [tab, setTab] = useState<TabId>("dash");
  const [data, setData] = useState<Data>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setData({ ...EMPTY, ...JSON.parse(raw) });
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
    const inv = data.inv.reduce((s, x) => s + x.value, 0);
    const crypto = data.crypto.reduce((s, x) => s + x.value, 0);
    const saved = data.goals.reduce((s, x) => s + x.saved, 0);
    return {
      income, expenses, inv, crypto, saved, total: inv + crypto + saved,
      cats: Object.entries(byCat).sort((p, q) => q[1] - p[1]),
      months: Object.entries(byMonth).sort((p, q) => p[0].localeCompare(q[0])),
    };
  }, [data]);

  return (
    <main className="min-h-screen md:flex">
      <aside className="bg-ink text-paper p-4 md:p-6 md:w-60 md:h-screen md:sticky md:top-0 md:shrink-0">
        <h1 className="font-display text-2xl font-semibold mb-4 md:mb-10">CapitalFlow</h1>
        <nav className="flex md:flex-col gap-1 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-left whitespace-nowrap px-3 py-2 border-l-4 ${
                tab === id ? "border-gold bg-white/10 font-bold" : "border-transparent hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex-1 min-w-0 p-5 md:p-12 max-w-5xl space-y-8">
        {tab === "dash" && <Dash t={t} empty={!data.txs.length && !data.inv.length && !data.crypto.length && !data.goals.length} go={setTab} />}
        {tab === "stmt" && <Statements data={data} setData={setData} />}
        {tab === "exp" && <Expenses t={t} />}
        {tab === "inv" && <Holdings title="Инвестиции" items={data.inv} onChange={(inv) => setData({ ...data, inv })} namePh="Например: ETF S&P 500" />}
        {tab === "crypto" && <Holdings title="Крипта" items={data.crypto} onChange={(crypto) => setData({ ...data, crypto })} namePh="Например: BTC" note="Цены вводятся вручную: актуальная стоимость в zł." />}
        {tab === "goals" && <Goals goals={data.goals} onChange={(goals) => setData({ ...data, goals })} />}
        {tab === "ai" && <Analyst data={data} t={t} />}
      </section>
    </main>
  );
}

function Dash({ t, empty, go }: { t: Totals; empty: boolean; go: (t: TabId) => void }) {
  const parts = [
    ["Инвестиции", t.inv, "bg-ink"],
    ["Крипта", t.crypto, "bg-gold"],
    ["Накопления", t.saved, "bg-pos"],
  ] as const;
  return (
    <>
      <div>
        <p className="text-ink/70">Общий капитал</p>
        <p className="font-display text-6xl md:text-8xl font-semibold tracking-tight">{money(t.total)}</p>
      </div>

      <div>
        <div className="flex h-3 rounded-full overflow-hidden bg-line grow">
          {parts.map(([n, v, c]) => t.total > 0 && v > 0 && (
            <div key={n} className={c} style={{ width: `${(v / t.total) * 100}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3">
          {parts.map(([n, v, c]) => (
            <span key={n} className="flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-sm ${c}`} />
              {n} {money(v)}
            </span>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-3 border-y border-line divide-y sm:divide-y-0 sm:divide-x divide-line">
        {[
          ["Доходы по выпискам", t.income, "text-pos"],
          ["Расходы по выпискам", t.expenses, "text-neg"],
          ["Баланс", t.income - t.expenses, ""],
        ].map(([l, v, c]) => (
          <div key={l as string} className="py-5 sm:px-6 first:pl-0">
            <p className="text-ink/70">{l}</p>
            <p className={`font-display text-3xl font-semibold ${c}`}>{money(v as number)}</p>
          </div>
        ))}
      </div>

      {empty && (
        <div className="bg-white border border-line rounded-lg p-6">
          <p className="mb-4">Здесь пока пусто. Загрузите выписку или добавьте первые активы и цели.</p>
          <div className="flex flex-wrap gap-3">
            <button className={btn} onClick={() => go("stmt")}>Загрузить выписку</button>
            <button className={btn} onClick={() => go("inv")}>Добавить инвестиции</button>
            <button className={btn} onClick={() => go("goals")}>Создать цель</button>
          </div>
        </div>
      )}
    </>
  );
}

function Statements({ data, setData }: { data: Data; setData: (d: Data) => void }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(`Читаю файл «${file.name}»…`);
    try {
      const name = file.name.toLowerCase();
      const isXlsx = name.endsWith(".xlsx");
      const isCsv = name.endsWith(".csv") || file.type.includes("csv");
      if (!isCsv && !isXlsx) {
        setMsg(`Файл «${file.name}» не подходит. Поддерживаются CSV и XLSX (старый .xls сохраните как .xlsx).`);
        return;
      }
      const buf = await file.arrayBuffer();
      const res = parseStatement(isXlsx ? await xlsxToCsv(buf) : decode(buf));
      if (typeof res === "string") return setMsg(res);
      const key = (x: Tx) => `${x.date}|${x.desc}|${x.amount}`;
      const seen = new Set(data.txs.map(key));
      const fresh = res.txs.filter((x) => !seen.has(key(x)));
      setData({ ...data, txs: [...data.txs, ...fresh] });
      setMsg(`Добавлено операций: ${fresh.length}, пропущено дублей: ${res.txs.length - fresh.length}. Колонки → ${res.cols}`);
    } catch (err) {
      setMsg("Ошибка при чтении файла: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <>
      <H>Выписки</H>
      <div>
        <label htmlFor="f" className="block mb-2">Загрузите выписку банка (CSV или XLSX). Файл читается в браузере и никуда не отправляется.</label>
        <input id="f" type="file" accept=".csv,.xlsx,text/csv" onChange={onFile} className={field + " max-w-md"} />
        {msg && <p className="mt-3 break-words text-ink/80">{msg}</p>}
      </div>
      {data.txs.length === 0 ? (
        <Empty text="Операций пока нет. Выберите файл выше." />
      ) : (
        <>
          <div className="overflow-x-auto bg-white border border-line rounded-lg">
            <table className="w-full text-sm">
              <thead className="text-left text-ink/60">
                <tr><th className="p-3">Дата</th><th className="p-3">Описание</th><th className="p-3">Категория</th><th className="p-3 text-right">Сумма</th></tr>
              </thead>
              <tbody>
                {data.txs.slice(-100).reverse().map((x) => (
                  <tr key={x.id} className="border-t border-line">
                    <td className="p-3 whitespace-nowrap">{x.date}</td>
                    <td className="p-3">{x.desc}</td>
                    <td className="p-3">{x.cat}</td>
                    <td className={`p-3 text-right whitespace-nowrap ${x.amount < 0 ? "text-neg" : "text-pos"}`}>{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-ink/60">Показаны последние 100 из {data.txs.length}.</p>
          <button className="text-neg font-semibold" onClick={() => confirm("Удалить все операции?") && setData({ ...data, txs: [] })}>
            Удалить все операции
          </button>
        </>
      )}
    </>
  );
}

function Expenses({ t }: { t: Totals }) {
  const max = t.cats[0]?.[1] ?? 1;
  return (
    <>
      <H>Расходы</H>
      {t.cats.length === 0 ? (
        <Empty text="Загрузите выписку, и здесь появится разбивка по категориям." />
      ) : (
        <div>
          <p className="text-ink/70 mb-4">Всего потрачено: {money(t.expenses)}</p>
          {t.cats.map(([name, sum]) => (
            <div key={name} className="py-3 border-b border-line">
              <div className="flex justify-between mb-2">
                <span className="font-semibold">{name}</span>
                <span>{money(sum)} · {Math.round((sum / t.expenses) * 100)}%</span>
              </div>
              <div className="h-2 bg-line rounded-full"><div className="h-2 bg-ink rounded-full grow" style={{ width: `${(sum / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Holdings({ title, items, onChange, namePh, note }: {
  title: string; items: Holding[]; onChange: (h: Holding[]) => void; namePh: string; note?: string;
}) {
  const [name, setName] = useState("");
  const [invested, setInvested] = useState("");
  const [value, setValue] = useState("");

  function add() {
    const i = toNumber(invested), v = toNumber(value);
    if (!name.trim() || i === null || v === null) return;
    onChange([...items, { id: uid(), name: name.trim(), invested: i, value: v }]);
    setName(""); setInvested(""); setValue("");
  }

  const totalI = items.reduce((s, x) => s + x.invested, 0);
  const totalV = items.reduce((s, x) => s + x.value, 0);

  return (
    <>
      <H>{title}</H>
      {note && <p className="text-ink/70">{note}</p>}
      <div className="grid md:grid-cols-4 gap-3">
        <input className={field} placeholder={namePh} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} placeholder="Вложено, zł" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} />
        <input className={field} placeholder="Сейчас стоит, zł" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className={btn} onClick={add}>Добавить</button>
      </div>
      {items.length === 0 ? (
        <Empty text="Пока ничего не добавлено. Заполните поля выше." />
      ) : (
        <div>
          {items.map((x) => {
            const pl = x.value - x.invested;
            return (
              <div key={x.id} className="py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{x.name}</p>
                  <p className="text-sm text-ink/60">Вложено {money(x.invested)}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-semibold">{money(x.value)}</p>
                  <p className={`text-sm ${pl >= 0 ? "text-pos" : "text-neg"}`}>{pl >= 0 ? "+" : ""}{money(pl)}</p>
                </div>
                <button className="text-neg" onClick={() => onChange(items.filter((y) => y.id !== x.id))}>Удалить</button>
              </div>
            );
          })}
          <p className="pt-4">Итого {money(totalV)}, вложено {money(totalI)}, результат {money(totalV - totalI)}</p>
        </div>
      )}
    </>
  );
}

function Goals({ goals, onChange }: { goals: Goal[]; onChange: (g: Goal[]) => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  function add() {
    const n = toNumber(target);
    if (!name.trim() || n === null || n <= 0) return;
    onChange([...goals, { id: uid(), name: name.trim(), target: n, saved: 0 }]);
    setName(""); setTarget("");
  }

  function topUp(g: Goal) {
    const n = toNumber(prompt("Сколько добавить, zł? (отрицательное число уменьшит сумму)") ?? "");
    if (n === null) return;
    onChange(goals.map((x) => (x.id === g.id ? { ...x, saved: Math.max(0, x.saved + n) } : x)));
  }

  return (
    <>
      <H>Цели</H>
      <div className="grid md:grid-cols-3 gap-3">
        <input className={field} placeholder="Например: Отпуск" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} placeholder="Цель, zł" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className={btn} onClick={add}>Создать цель</button>
      </div>
      {goals.length === 0 ? (
        <Empty text="Целей пока нет. Назовите первую и задайте сумму." />
      ) : (
        goals.map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
          return (
            <div key={g.id} className="py-4 border-b border-line space-y-3">
              <div className="flex justify-between flex-wrap gap-2">
                <p className="font-display text-2xl font-semibold">{g.name}</p>
                <p>{money(g.saved)} из {money(g.target)} · {pct}%</p>
              </div>
              <div className="h-3 bg-line rounded-full"><div className="h-3 bg-pos rounded-full grow" style={{ width: `${pct}%` }} /></div>
              <div className="flex gap-5">
                <button className="font-semibold" onClick={() => topUp(g)}>Пополнить</button>
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
    <button
      className={btn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 2000);
        } catch {
          alert("Не удалось скопировать. Выделите текст вручную.");
        }
      }}
    >
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
      tips.push(`Расходы в ${lm} ${ch >= 0 ? "выросли" : "снизились"} на ${Math.abs(ch)}% по сравнению с ${pm} (${money(l.exp)} против ${money(p.exp)}).`);
    }
  }
  if (t.cats[0]) tips.push(`Больше всего уходит на «${t.cats[0][0]}»: ${money(t.cats[0][1])} (${Math.round((t.cats[0][1] / t.expenses) * 100)}% расходов).`);
  const big = data.txs.filter((x) => x.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  if (big) tips.push(`Самая крупная трата: ${money(-big.amount)}${big.desc ? ` («${big.desc}»)` : ""}.`);
  if (t.total > 0 && t.crypto / t.total > 0.3) tips.push(`Крипта составляет ${Math.round((t.crypto / t.total) * 100)}% капитала. Доля высокая, стоит оценить риск.`);
  const subs = data.txs.filter((x) => x.cat === "Подписки" && x.amount < 0).reduce((s, x) => s - x.amount, 0);
  if (subs > 0) tips.push(`На подписки ушло ${money(subs)}. Проверьте, всеми ли вы пользуетесь.`);

  const avgNet = t.months.length ? t.months.reduce((s, [, v]) => s + v.inc - v.exp, 0) / t.months.length : null;
  data.goals.forEach((g) => {
    const rest = g.target - g.saved;
    if (rest <= 0) return;
    if (avgNet === null) tips.push(`Цель «${g.name}»: осталось ${money(rest)}.`);
    else if (avgNet > 0) tips.push(`Цель «${g.name}»: осталось ${money(rest)}. При текущем темпе (+${money(avgNet)} в месяц) это примерно ${Math.ceil(rest / avgNet)} мес.`);
    else tips.push(`Цель «${g.name}»: осталось ${money(rest)}, но расходы по выпискам превышают доходы, поэтому накопить при таком темпе не получится.`);
  });

  const summary = buildSummary(data, t);

  return (
    <>
      <H>Аналитик</H>
      <p className="text-ink/70">Выводы считаются по правилам прямо в браузере. Это не нейросеть.</p>
      {tips.length === 0 ? (
        <Empty text="Добавьте данные (выписку, активы, цели), и здесь появятся выводы." />
      ) : (
        <ul>{tips.map((s, i) => <li key={i} className="py-3 border-b border-line">{s}</li>)}</ul>
      )}

      {t.months.length > 0 && (
        <div>
          <h3 className="font-display text-2xl font-semibold mb-2">По месяцам</h3>
          <div className="overflow-x-auto bg-white border border-line rounded-lg">
            <table className="w-full text-sm">
              <thead className="text-left text-ink/60"><tr><th className="p-3">Месяц</th><th className="p-3 text-right">Доход</th><th className="p-3 text-right">Расходы</th><th className="p-3 text-right">Разница</th></tr></thead>
              <tbody>
                {t.months.map(([m, v]) => (
                  <tr key={m} className="border-t border-line">
                    <td className="p-3">{m}</td>
                    <td className="p-3 text-right text-pos">{money(v.inc)}</td>
                    <td className="p-3 text-right text-neg">{money(v.exp)}</td>
                    <td className="p-3 text-right">{money(v.inc - v.exp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white border border-line rounded-lg p-5 space-y-3">
        <h3 className="font-display text-2xl font-semibold">Спросить ИИ</h3>
        <p className="text-ink/70">Скопируйте сводку и вставьте её в чат с ИИ, затем задайте вопрос. В сводке только итоговые суммы, без названий магазинов и описаний операций.</p>
        <pre className="whitespace-pre-wrap text-sm bg-paper rounded-md p-3 max-h-60 overflow-auto">{summary}</pre>
        <CopyBtn text={summary} />
      </div>
    </>
  );
}