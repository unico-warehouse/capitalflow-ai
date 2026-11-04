"use client";

import { useEffect, useMemo, useState } from "react";

type Tx = { id: string; date: string; desc: string; amount: number; cat: string };
type Holding = { id: string; name: string; invested: number; value: number };
type Goal = { id: string; name: string; target: number; saved: number };
type Data = { txs: Tx[]; inv: Holding[]; crypto: Holding[]; goals: Goal[] };

const EMPTY: Data = { txs: [], inv: [], crypto: [], goals: [] };
const KEY = "capitalflow-v1";
const TABS = [
  ["dash", "🏠 Dashboard"],
  ["stmt", "📄 Выписки"],
  ["exp", "💸 Расходы"],
  ["inv", "📈 Инвестиции"],
  ["crypto", "₿ Крипта"],
  ["goals", "🎯 Цели"],
  ["ai", "🤖 Аналитик"],
] as const;
type TabId = (typeof TABS)[number][0];

const money = (n: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n);
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
  const delim = [";", ",", "\t"].sort(
    (a, b) => first.split(b).length - first.split(a).length
  )[0];
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
  const rows = parseCSV(text);
  const hi = rows.findIndex((r) => r.some((c) => AMOUNT.some((k) => c.toLowerCase().includes(k))));
  if (hi < 0) return "Не нашёл колонку с суммой (kwota / amount / сумма) в файле.";
  const h = rows[hi].map((c) => c.toLowerCase());
  const col = (keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  const a = col(AMOUNT), d = col(DESC), dt = col(DATEK);
  const out: Tx[] = [];
  for (const r of rows.slice(hi + 1)) {
    const amount = toNumber(r[a] ?? "");
    if (amount === null || amount === 0) continue;
    const desc = (d >= 0 ? r[d] ?? "" : "").trim().slice(0, 90);
    out.push({ id: uid(), date: dt >= 0 ? (r[dt] ?? "").trim() : "", desc, amount, cat: categorize(desc) });
  }
  return out.length ? out : "Не нашёл ни одной операции в файле.";
}

function decode(buf: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1250").decode(buf); }
}

const inputCls = "bg-slate-800 p-3 rounded-lg w-full";
const btnCls = "bg-blue-600 hover:bg-blue-500 px-4 py-3 rounded-lg font-semibold";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-slate-800 p-6 rounded-xl">
      <p className="text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-slate-400 bg-slate-900 p-6 rounded-xl">{text}</p>;
}

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

  const t = useMemo(() => {
    const income = data.txs.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
    const expenses = data.txs.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
    const byCat: Record<string, number> = {};
    data.txs.filter((x) => x.amount < 0).forEach((x) => (byCat[x.cat] = (byCat[x.cat] ?? 0) - x.amount));
    const cats = Object.entries(byCat).sort((p, q) => q[1] - p[1]);
    const inv = data.inv.reduce((s, x) => s + x.value, 0);
    const crypto = data.crypto.reduce((s, x) => s + x.value, 0);
    const saved = data.goals.reduce((s, x) => s + x.saved, 0);
    return { income, expenses, cats, inv, crypto, saved, total: inv + crypto + saved };
  }, [data]);

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col md:flex-row">
      <aside className="md:w-64 bg-slate-900 p-4 md:p-6">
        <h1 className="text-2xl font-bold mb-4 md:mb-8">CapitalFlow 🚀</h1>
        <nav className="flex md:flex-col gap-2 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-left whitespace-nowrap px-3 py-2 rounded-lg ${
                tab === id ? "bg-slate-700 font-semibold" : "hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex-1 p-4 md:p-10 space-y-6 min-w-0">
        {tab === "dash" && <Dash t={t} empty={!data.txs.length && !data.inv.length && !data.crypto.length && !data.goals.length} go={setTab} />}
        {tab === "stmt" && <Statements data={data} setData={setData} />}
        {tab === "exp" && <Expenses t={t} />}
        {tab === "inv" && (
          <Holdings title="📈 Инвестиции" items={data.inv} onChange={(inv) => setData({ ...data, inv })} namePh="Например: ETF S&P 500" />
        )}
        {tab === "crypto" && (
          <Holdings title="₿ Крипта" items={data.crypto} onChange={(crypto) => setData({ ...data, crypto })} namePh="Например: BTC" note="Цены вводятся вручную: актуальная стоимость в zł." />
        )}
        {tab === "goals" && <Goals goals={data.goals} onChange={(goals) => setData({ ...data, goals })} />}
        {tab === "ai" && <Analyst data={data} t={t} />}
      </section>
    </main>
  );
}

type Totals = { income: number; expenses: number; cats: [string, number][]; inv: number; crypto: number; saved: number; total: number };

function Dash({ t, empty, go }: { t: Totals; empty: boolean; go: (t: TabId) => void }) {
  return (
    <>
      <h2 className="text-3xl md:text-4xl font-bold">Дашборд</h2>
      {empty && (
        <div className="bg-slate-900 p-6 rounded-xl">
          <p className="mb-4">Пока пусто. Начните с загрузки выписки или добавьте активы и цели.</p>
          <div className="flex flex-wrap gap-3">
            <button className={btnCls} onClick={() => go("stmt")}>Загрузить выписку</button>
            <button className={btnCls} onClick={() => go("inv")}>Добавить инвестиции</button>
            <button className={btnCls} onClick={() => go("goals")}>Создать цель</button>
          </div>
        </div>
      )}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Общий капитал" value={money(t.total)} />
        <Stat label="Инвестиции" value={money(t.inv)} />
        <Stat label="Крипта" value={money(t.crypto)} />
        <Stat label="Накопления (цели)" value={money(t.saved)} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Доходы по выпискам" value={money(t.income)} tone="text-green-400" />
        <Stat label="Расходы по выпискам" value={money(t.expenses)} tone="text-red-400" />
        <Stat label="Баланс" value={money(t.income - t.expenses)} />
      </div>
    </>
  );
}

function Statements({ data, setData }: { data: Data; setData: (d: Data) => void }) {
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) return setMsg("Пока поддерживается только CSV.");
    const res = parseStatement(decode(await file.arrayBuffer()));
    if (typeof res === "string") return setMsg(res);
    const key = (x: Tx) => `${x.date}|${x.desc}|${x.amount}`;
    const seen = new Set(data.txs.map(key));
    const fresh = res.filter((x) => !seen.has(key(x)));
    setData({ ...data, txs: [...data.txs, ...fresh] });
    setMsg(`Добавлено операций: ${fresh.length}, пропущено дублей: ${res.length - fresh.length}.`);
  }

  return (
    <>
      <h2 className="text-3xl md:text-4xl font-bold">📄 Выписки</h2>
      <div>
        <label htmlFor="f" className="block mb-2">Загрузить выписку банка (CSV). Файл обрабатывается в браузере и никуда не отправляется.</label>
        <input id="f" type="file" accept=".csv" onChange={onFile} className="bg-slate-800 p-3 rounded-lg" />
        {msg && <p className="mt-3 text-slate-300">{msg}</p>}
      </div>
      {data.txs.length === 0 ? (
        <Empty text="Операций пока нет." />
      ) : (
        <>
          <div className="overflow-x-auto bg-slate-900 rounded-xl">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left">
                <tr><th className="p-3">Дата</th><th className="p-3">Описание</th><th className="p-3">Категория</th><th className="p-3 text-right">Сумма</th></tr>
              </thead>
              <tbody>
                {data.txs.slice(-100).reverse().map((x) => (
                  <tr key={x.id} className="border-t border-slate-800">
                    <td className="p-3 whitespace-nowrap">{x.date}</td>
                    <td className="p-3">{x.desc}</td>
                    <td className="p-3">{x.cat}</td>
                    <td className={`p-3 text-right whitespace-nowrap ${x.amount < 0 ? "text-red-400" : "text-green-400"}`}>{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-400 text-sm">Показаны последние 100 из {data.txs.length}.</p>
          <button className="text-red-400" onClick={() => confirm("Удалить все операции?") && setData({ ...data, txs: [] })}>
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
      <h2 className="text-3xl md:text-4xl font-bold">💸 Расходы</h2>
      {t.cats.length === 0 ? (
        <Empty text="Загрузите выписку, и здесь появится разбивка по категориям." />
      ) : (
        <div className="bg-slate-900 p-6 rounded-xl space-y-4">
          <p className="text-slate-400">Всего: {money(t.expenses)}</p>
          {t.cats.map(([name, sum]) => (
            <div key={name}>
              <div className="flex justify-between mb-1"><span>{name}</span><span>{money(sum)} · {Math.round((sum / t.expenses) * 100)}%</span></div>
              <div className="h-2 bg-slate-800 rounded"><div className="h-2 bg-blue-500 rounded" style={{ width: `${(sum / max) * 100}%` }} /></div>
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
      <h2 className="text-3xl md:text-4xl font-bold">{title}</h2>
      {note && <p className="text-slate-400">{note}</p>}
      <div className="grid md:grid-cols-4 gap-3">
        <input className={inputCls} placeholder={namePh} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Вложено, zł" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} />
        <input className={inputCls} placeholder="Сейчас стоит, zł" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className={btnCls} onClick={add}>Добавить</button>
      </div>
      {items.length === 0 ? (
        <Empty text="Пока ничего не добавлено." />
      ) : (
        <div className="space-y-3">
          {items.map((x) => {
            const pl = x.value - x.invested;
            return (
              <div key={x.id} className="bg-slate-900 p-4 rounded-xl flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{x.name}</p>
                  <p className="text-slate-400 text-sm">Вложено {money(x.invested)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{money(x.value)}</p>
                  <p className={`text-sm ${pl >= 0 ? "text-green-400" : "text-red-400"}`}>{pl >= 0 ? "+" : ""}{money(pl)}</p>
                </div>
                <button className="text-red-400" onClick={() => onChange(items.filter((y) => y.id !== x.id))}>Удалить</button>
              </div>
            );
          })}
          <p className="text-slate-300">Итого: {money(totalV)} (вложено {money(totalI)}, результат {money(totalV - totalI)})</p>
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
      <h2 className="text-3xl md:text-4xl font-bold">🎯 Цели</h2>
      <div className="grid md:grid-cols-3 gap-3">
        <input className={inputCls} placeholder="Например: Отпуск" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Цель, zł" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className={btnCls} onClick={add}>Создать цель</button>
      </div>
      {goals.length === 0 ? (
        <Empty text="Целей пока нет." />
      ) : (
        goals.map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
          return (
            <div key={g.id} className="bg-slate-900 p-4 rounded-xl space-y-3">
              <div className="flex justify-between flex-wrap gap-2">
                <p className="font-semibold">{g.name}</p>
                <p>{money(g.saved)} / {money(g.target)} · {pct}%</p>
              </div>
              <div className="h-3 bg-slate-800 rounded"><div className="h-3 bg-green-500 rounded" style={{ width: `${pct}%` }} /></div>
              <div className="flex gap-4">
                <button className="text-blue-400" onClick={() => topUp(g)}>Пополнить</button>
                <button className="text-red-400" onClick={() => onChange(goals.filter((x) => x.id !== g.id))}>Удалить</button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}

function Analyst({ data, t }: { data: Data; t: Totals }) {
  const tips: string[] = [];
  if (t.income > 0) {
    const rate = Math.round(((t.income - t.expenses) / t.income) * 100);
    tips.push(`Норма сбережений по выпискам: ${rate}%. ${rate < 10 ? "Это низко, ориентир обычно 10–20%." : "Хороший уровень."}`);
  }
  if (t.cats[0]) tips.push(`Больше всего уходит на «${t.cats[0][0]}»: ${money(t.cats[0][1])} (${Math.round((t.cats[0][1] / t.expenses) * 100)}% расходов).`);
  const big = data.txs.filter((x) => x.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  if (big) tips.push(`Самая крупная трата: ${money(-big.amount)}${big.desc ? ` («${big.desc}»)` : ""}.`);
  if (t.total > 0 && t.crypto / t.total > 0.3) tips.push(`Крипта составляет ${Math.round((t.crypto / t.total) * 100)}% капитала. Доля высокая, стоит оценить риск.`);
  const subs = data.txs.filter((x) => x.cat === "Подписки" && x.amount < 0).reduce((s, x) => s - x.amount, 0);
  if (subs > 0) tips.push(`На подписки ушло ${money(subs)}. Проверьте, всеми ли вы пользуетесь.`);
  data.goals.forEach((g) => g.saved < g.target && tips.push(`Цель «${g.name}»: осталось ${money(g.target - g.saved)}.`));

  return (
    <>
      <h2 className="text-3xl md:text-4xl font-bold">🤖 Аналитик</h2>
      <p className="text-slate-400">Простой анализ по правилам, считается локально в браузере. Это не нейросеть.</p>
      {tips.length === 0 ? (
        <Empty text="Добавьте данные (выписку, активы, цели), и здесь появятся выводы." />
      ) : (
        <ul className="space-y-3">
          {tips.map((s, i) => (
            <li key={i} className="bg-slate-900 p-4 rounded-xl">{s}</li>
          ))}
        </ul>
      )}
    </>
  );
}