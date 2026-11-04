"use client";

import { useState } from "react";

export default function Home() {
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileName(file ? file.name : null);
    // здесь позже можно отправлять файл на сервер/API
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex">
      <aside className="w-64 bg-slate-900 p-6">
        <h1 className="text-2xl font-bold mb-8">CapitalFlow 🚀</h1>

        <nav className="space-y-4">
          <div>🏠 Dashboard</div>
          <div>📄 Выписки</div>
          <div>💸 Расходы</div>
          <div>📈 Инвестиции</div>
          <div>₿ Крипта</div>
          <div>🎯 Цели</div>
          <div>🤖 AI Аналитик</div>
        </nav>
      </aside>

      <section className="flex-1 p-10">
        <h2 className="text-4xl font-bold mb-8">Добро пожаловать 👋</h2>

        <div className="mb-8">
          <label htmlFor="statement" className="block mb-2 text-lg">
            Загрузить выписку банка
          </label>

          <input
            id="statement"
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            onChange={handleFileChange}
            className="bg-slate-800 p-3 rounded-lg"
          />

          {fileName && (
            <p className="mt-2 text-slate-400">Выбран файл: {fileName}</p>
          )}
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          <div className="bg-slate-800 p-6 rounded-xl">
            <p className="text-slate-400">Общий капитал</p>
            <p className="text-3xl font-bold">52 000 zł</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-xl">
            <p className="text-slate-400">Инвестиции</p>
            <p className="text-3xl font-bold">18 000 zł</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-xl">
            <p className="text-slate-400">Крипта</p>
            <p className="text-3xl font-bold">8 500 zł</p>
          </div>

          <div className="bg-slate-800 p-6 rounded-xl">
            <p className="text-slate-400">Накопления</p>
            <p className="text-3xl font-bold">25 500 zł</p>
          </div>
        </div>
      </section>
    </main>
  );
}