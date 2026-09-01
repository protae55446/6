import { useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";

interface Props {
  apiKey: string;
  setApiKey: (v: string) => void;
  autoClear: boolean;
  setAutoClear: (v: boolean) => void;
  disabled?: boolean;
}

export default function ApiKeyPanel({ apiKey, setApiKey, autoClear, setAutoClear, disabled }: Props) {
  const [show, setShow] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">DeepSeek API Key</h2>
          <p className="text-xs text-slate-500">ใช้เรียกโมเดล official deepseek-v4-flash-vision-exp</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <input
            type={show ? "text" : "password"}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={disabled}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={show ? "ซ่อนคีย์" : "แสดงคีย์"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setApiKey("")}
          disabled={disabled || !apiKey}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
          ล้างคีย์
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={autoClear}
            onChange={(e) => setAutoClear(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          ล้างคีย์อัตโนมัติทุกครั้งหลังประมวลผลเสร็จ
        </label>
        <p className="text-[11px] leading-snug text-slate-400">
          คีย์จะถูกเก็บไว้ในหน่วยความจำของหน้านี้เท่านั้น ไม่ถูกบันทึกลงเครื่อง และจะหายไปเองเมื่อรีเฟรช/ปิดแท็บ
        </p>
      </div>
    </section>
  );
}
