import { AlertTriangle, CheckCircle2, Clock, Download, Loader2, RotateCcw, Table2, ShieldCheck } from "lucide-react";
import type { ResultRow } from "../lib/types";

interface Props {
  rows: ResultRow[];
  onDownload: () => void;
  onRetry: (id: string) => void;
  onCreateIdPhoto?: (row: ResultRow) => void;
  canRetry: boolean;
}

function StatusBadge({ status }: { status: ResultRow["status"] }) {
  switch (status) {
    case "done":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="h-3 w-3" /> สำเร็จ
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          <Loader2 className="h-3 w-3 animate-spin" /> กำลังทำ
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
          <AlertTriangle className="h-3 w-3" /> ไม่สำเร็จ
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          <Clock className="h-3 w-3" /> รอคิว
        </span>
      );
  }
}

export default function ResultsTable({ rows, onDownload, onRetry, onCreateIdPhoto, canRetry }: Props) {
  if (rows.length === 0) return null;

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const verifiedCount = rows.filter((r) => r.verifyStatus?.passed).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Table2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">ผลลัพธ์ (CSV)</h2>
            <p className="text-xs text-slate-500">
              สำเร็จ {doneCount} · ไม่สำเร็จ {errorCount}
              {verifiedCount > 0 && ` · ผ่านเกณฑ์รูปบัตร ${verifiedCount}`} · ทั้งหมด {rows.length} แถว
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Download className="h-4 w-4" />
          ดาวน์โหลด CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">#</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">ภาพ</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                คอลัมน์ 1: ชื่อ (NAME)
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                คอลัมน์ 2: วันที่ (DATE)
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">สถานะ</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className={row.status === "error" ? "bg-red-50/40" : undefined}>
                <td className="px-3 py-2 align-top text-xs font-semibold text-slate-500">{row.order}</td>
                <td className="px-3 py-2 align-top">
                  <div className="relative">
                    <img
                      src={row.compositeUrl || row.previewUrl}
                      alt={row.fileName}
                      className="h-10 w-10 rounded-lg object-cover ring-1 ring-black/5"
                      title={row.fileName}
                    />
                    {row.verifyStatus?.passed && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="max-w-[220px] px-3 py-2 align-top text-slate-800">
                  {row.status === "done" ? (
                    <span className="font-medium">{row.name}</span>
                  ) : row.status === "error" ? (
                    <span className="text-xs text-red-600">
                      ไม่สามารถประมวลผลได้: {row.reason}
                      <span className="block text-[10px] text-red-400">({row.fileName})</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-slate-800">
                  {row.status === "done" ? row.date : <span className="text-xs text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <StatusBadge status={row.status} />
                    {row.verifyStatus && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          row.verifyStatus.passed
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        <ShieldCheck className="h-2.5 w-2.5" />
                        {row.verifyStatus.passed ? `ผ่าน (${row.verifyStatus.score})` : `ยังไม่ผ่าน (${row.verifyStatus.score})`}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    {row.status === "error" && (
                      <button
                        type="button"
                        disabled={!canRetry}
                        onClick={() => onRetry(row.id)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <RotateCcw className="h-3 w-3" />
                        ลองใหม่
                      </button>
                    )}
                    {row.status === "done" && row.geometry?.head_bbox && onCreateIdPhoto && (
                      <button
                        type="button"
                        onClick={() => onCreateIdPhoto(row)}
                        className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        {row.compositeUrl ? "แก้ไขรูปบัตร" : "สร้างรูปบัตร"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
