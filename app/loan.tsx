import { xlsxSheet } from "./xlsx";

export type Loan = {
  balance: number;
  payment: number;
  day: number | null;
  rate: number;
  left: number | null;
  last: string | null;
};

const money = (n: number) =>
  new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(n);
const num = (s?: string) => {
  const t = (s ?? "").trim().replace(",", ".");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
};
const serial = (s?: string) => {
  const n = num(s);
  if (n !== null && n > 20000 && n < 80000) {
    return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return s?.trim() || null;
};
const fmt = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};

// Читает лист «Кредит» из книги Excel. Если листа нет, возвращает null.
export async function loanFromXlsx(buf: ArrayBuffer): Promise<Loan | null> {
  try {
    const rows = await xlsxSheet(buf, /кредит|kredyt|loan/i);
    if (!rows) return null;
    const get = (re: RegExp) => rows.find((r) => re.test(r[0] ?? ""))?.[1];
    const balance = num(get(/остаток долга|balance/i));
    if (balance === null) return null;
    return {
      balance,
      payment: num(get(/ежемесячный платёж|ежемесячный платеж|monthly/i)) ?? 0,
      day: num(get(/день платежа/i)),
      rate: num(get(/ставка/i)) ?? 0,
      left: num(get(/платежей осталось/i)),
      last: serial(get(/дата последнего/i)),
    };
  } catch {
    return null;
  }
}

export function loanTips(loan: Loan | null, avgInc: number | null): string[] {
  if (!loan) return [];
  const tips = [
    `Кредит: осталось ${money(loan.balance)}${loan.left ? `, ${loan.left} платежей по ${money(loan.payment)}` : ""}${loan.last ? `, последний платёж ${fmt(loan.last)}` : ""}.`,
  ];
  if (avgInc && loan.payment) {
    tips.push(`Платёж по кредиту составляет ${Math.round((loan.payment / avgInc) * 100)}% вашего среднего месячного дохода по выпискам (${money(avgInc)}).`);
  }
  if (loan.rate === 0) {
    tips.push("В расчёте кредита ставка 0%. Если по договору есть проценты, реальная переплата выше: впишите ставку на листе «Кредит», сохраните файл в Excel и загрузите заново.");
  }
  return tips;
}

export function withLoan(summary: string, loan: Loan | null): string {
  if (!loan) return summary;
  const line = `Кредит: остаток ${money(loan.balance)}, платёж ${money(loan.payment)} в месяц${loan.left ? `, платежей осталось ${loan.left}` : ""}, ставка ${loan.rate}%.`;
  return summary.replace("\n\nМой вопрос", `\n${line}\n\nМой вопрос`);
}

export function LoanBlock({ loan, capital, onClear }: { loan: Loan | null; capital: number; onClear: () => void }) {
  if (!loan) return null;
  const items: [string, string, string][] = [
    ["Остаток долга", money(loan.balance), "text-neg"],
    ["Платёж в месяц", money(loan.payment), ""],
    ["Осталось платежей", loan.left ? `${loan.left}${loan.last ? ` (до ${fmt(loan.last)})` : ""}` : "—", ""],
    ["Капитал минус долг", money(capital - loan.balance), capital - loan.balance < 0 ? "text-neg" : "text-pos"],
  ];
  return (
    <div className="bg-white border border-line rounded-lg p-5 space-y-4">
      <h3 className="font-display text-2xl font-semibold">Кредит</h3>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map(([l, v, c]) => (
          <div key={l}>
            <p className="text-ink/70">{l}</p>
            <p className={`font-display text-2xl font-semibold ${c}`}>{v}</p>
          </div>
        ))}
      </div>
      <button className="text-neg" onClick={onClear}>Убрать кредит</button>
    </div>
  );
}