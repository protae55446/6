import { useRef } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2, X } from "lucide-react";
import type { QueueItem } from "../lib/types";

interface Props {
  queue: QueueItem[];
  onAddFiles: (files: FileList | null) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onClear: () => void;
  disabled?: boolean;
}

export default function ImageQueuePanel({ queue, onAddFiles, onRemove, onMove, onClear, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <ImagePlus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">คิวรูปภาพ (รอประมวลผล)</h2>
            <p className="text-xs text-slate-500">
              เพิ่มภาพได้ตลอดเวลา (ยกเว้นตอนกำลังประมวลผล) · หลังประมวลผลคิวจะถูกล้างให้อัตโนมัติ
            </p>
          </div>
        </div>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            ล้างคิว
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onAddFiles(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ImagePlus className="h-7 w-7 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">
          {disabled ? "กำลังประมวลผล... เพิ่มภาพไม่ได้ชั่วคราว" : "แตะเพื่อเพิ่มรูปภาพ (เลือกหลายไฟล์ได้)"}
        </span>
        <span className="text-xs text-slate-400">รองรับ JPG, PNG, WEBP</span>
      </button>

      {queue.length > 0 && (
        <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
          {queue.map((item, idx) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2"
            >
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-slate-200 text-[11px] font-semibold text-slate-600">
                {idx + 1}
              </span>
              <img
                src={item.previewUrl}
                alt={item.file.name}
                className="h-12 w-12 flex-shrink-0 rounded-lg object-cover ring-1 ring-black/5"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={item.file.name}>
                {item.file.name}
              </span>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={disabled || idx === 0}
                  onClick={() => onMove(item.id, -1)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  aria-label="เลื่อนขึ้น"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled || idx === queue.length - 1}
                  onClick={() => onMove(item.id, 1)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  aria-label="เลื่อนลง"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(item.id)}
                  className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  aria-label="ลบ"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
