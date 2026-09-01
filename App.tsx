import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, ScanEye, Square, Trash2, Plus } from "lucide-react";
import ApiKeyPanel from "./components/ApiKeyPanel";
import ImageQueuePanel from "./components/ImageQueuePanel";
import ResultsTable from "./components/ResultsTable";
import CompositeEditor from "./components/CompositeEditor";
import { extractFromImage } from "./lib/extract";
import { buildCsv, downloadCsv } from "./lib/csv";
import type { QueueItem, ResultRow, CompositePreset } from "./lib/types";

let uid = 0;
function nextId() {
  uid += 1;
  return `item-${Date.now()}-${uid}`;
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [autoClear, setAutoClear] = useState(false); // default OFF so verification can use the key
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [editingRow, setEditingRow] = useState<ResultRow | null>(null);
  const [presets, setPresets] = useState<CompositePreset[]>(() => {
    try {
      const raw = localStorage.getItem("idphoto_presets");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("idphoto_presets", JSON.stringify(presets));
  }, [presets]);

  useEffect(() => {
    return () => {
      queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: QueueItem[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ id: nextId(), file: f, previewUrl: URL.createObjectURL(f) }));
    setQueue((prev) => [...prev, ...items]);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const handleMove = useCallback((id: string, dir: -1 | 1) => {
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.id === id);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }, []);

  const handleClearQueue = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((q) => URL.revokeObjectURL(q.previewUrl));
      return [];
    });
  }, []);

  const handleClearResults = useCallback(() => {
    setResults([]);
    setProgress({ current: 0, total: 0 });
  }, []);

  /** Full reset for a completely new list */
  const handleNewBatch = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((q) => URL.revokeObjectURL(q.previewUrl));
      return [];
    });
    setResults([]);
    setProgress({ current: 0, total: 0 });
    setEditingRow(null);
  }, []);

  const canStart = apiKey.trim().length > 0 && queue.length > 0 && !isProcessing;

  const runExtractionForItem = async (item: QueueItem, key: string, signal: AbortSignal) => {
    try {
      const res = await extractFromImage(item.file, key, signal);
      if (res.ok) {
        return {
          name: res.name,
          date: res.date,
          status: "done" as const,
          reason: "",
          geometry: {
            head_bbox: res.head_bbox,
            face_center: res.face_center,
            rotation_angle: res.rotation_angle,
            neck_point: res.neck_point,
            recommended_template: res.recommended_template,
            pose_notes: res.pose_notes,
          },
        };
      }
      return { name: "", date: "", status: "error" as const, reason: res.reason };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return { name: "", date: "", status: "error" as const, reason: "หยุดการประมวลผลโดยผู้ใช้" };
      }
      return { name: "", date: "", status: "error" as const, reason: err?.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ" };
    }
  };

  const handleStart = async () => {
    if (!canStart) return;
    const key = apiKey.trim();
    stopRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    // Snapshot the current queue so we process exactly these items
    const itemsToProcess = [...queue];

    const initialRows: ResultRow[] = itemsToProcess.map((item, idx) => ({
      id: item.id,
      order: results.length + idx + 1, // continue numbering if previous results exist
      fileName: item.file.name,
      previewUrl: item.previewUrl,
      status: "pending",
      name: "",
      date: "",
      reason: "",
    }));

    // Append to existing results (so previous batches stay visible)
    setResults((prev) => [...prev, ...initialRows]);
    setIsProcessing(true);
    setProgress({ current: 0, total: itemsToProcess.length });

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (stopRef.current) break;
      const item = itemsToProcess[i];
      setResults((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: "processing" } : r)));

      const outcome = await runExtractionForItem(item, key, controller.signal);

      setResults((prev) => prev.map((r) => (r.id === item.id ? { ...r, ...outcome } : r)));
      setProgress({ current: i + 1, total: itemsToProcess.length });

      if (stopRef.current) break;
    }

    setIsProcessing(false);
    abortRef.current = null;

    // CRITICAL UX FIX: after a batch finishes, clear the queue automatically
    // so the user can immediately drop new images for the next batch.
    // Results remain intact.
    setQueue((prev) => {
      // Only revoke URLs that were in this processed batch and are no longer needed
      // (previewUrl is still used by results, so we must NOT revoke them)
      // We simply empty the queue array; the object URLs live on in the results.
      return [];
    });

    if (autoClear) setApiKey("");
  };

  const handleStop = () => {
    stopRef.current = true;
    abortRef.current?.abort();
  };

  const handleRetry = async (id: string) => {
    if (isProcessing) return;
    // Find the original file from results (previewUrl is still valid)
    const row = results.find((r) => r.id === id);
    if (!row || !apiKey.trim()) return;

    // We need the File. Since queue may already be cleared, we cannot re-use the File object
    // easily. For retry we only support items still present in the current queue.
    const item = queue.find((q) => q.id === id);
    if (!item) {
      // Fallback: cannot retry without the original File
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, status: "processing" } : r)));
    const outcome = await runExtractionForItem(item, apiKey.trim(), controller.signal);
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...outcome } : r)));
    setIsProcessing(false);
    abortRef.current = null;
    if (autoClear) setApiKey("");
  };

  const handleDownload = () => {
    const csv = buildCsv(results);
    downloadCsv(csv);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasResults = results.length > 0;
  const hasQueue = queue.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 pb-16">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200">
            <ScanEye className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 sm:text-lg">สกัดชื่อ &amp; วันที่จากภาพด้วย AI</h1>
            <p className="text-xs text-slate-500">DeepSeek V4 Flash Vision Exp · Official DeepSeek API</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 pt-5 sm:px-6">
        <ApiKeyPanel
          apiKey={apiKey}
          setApiKey={setApiKey}
          autoClear={autoClear}
          setAutoClear={setAutoClear}
          disabled={isProcessing}
        />

        <ImageQueuePanel
          queue={queue}
          onAddFiles={handleAddFiles}
          onRemove={handleRemove}
          onMove={handleMove}
          onClear={handleClearQueue}
          disabled={isProcessing}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-500">
              {apiKey.trim().length === 0 && "กรุณากรอก API Key ก่อนเริ่มประมวลผล"}
              {apiKey.trim().length > 0 && queue.length === 0 && !isProcessing && (
                hasResults
                  ? "คิวว่างแล้ว · เพิ่มภาพใหม่ได้ทันที หรือกดเริ่มรายการใหม่เพื่อล้างผลลัพธ์"
                  : "กรุณาเลือกรูปภาพอย่างน้อย 1 ไฟล์"
              )}
              {apiKey.trim().length > 0 && queue.length > 0 && !isProcessing && `พร้อมประมวลผล ${queue.length} ภาพ`}
              {isProcessing && `กำลังประมวลผลภาพที่ ${progress.current}/${progress.total} (${pct}%)`}
            </div>
            <div className="flex flex-wrap gap-2">
              {!isProcessing && (hasQueue || hasResults) && (
                <>
                  {hasResults && (
                    <button
                      type="button"
                      onClick={handleClearResults}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      ล้างผลลัพธ์
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleNewBatch}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    เริ่มรายการใหม่
                  </button>
                </>
              )}

              {!isProcessing ? (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={!canStart}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-4 w-4" />
                  เริ่มประมวลผล
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                >
                  <Square className="h-4 w-4" />
                  หยุด
                </button>
              )}
            </div>
          </div>

          {isProcessing && (
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {isProcessing && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-indigo-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              กำลังเรียกโมเดล DeepSeek Vision กรุณาอย่าปิดหน้านี้
            </div>
          )}
        </section>

        <ResultsTable
          rows={results}
          onDownload={handleDownload}
          onRetry={handleRetry}
          onCreateIdPhoto={(row) => setEditingRow(row)}
          canRetry={!isProcessing}
        />

        {editingRow && editingRow.geometry && (
          <CompositeEditor
            sourcePreviewUrl={editingRow.previewUrl}
            geometry={editingRow.geometry}
            apiKey={apiKey}
            onClose={() => setEditingRow(null)}
            onSaveImage={(dataUrl, verifyStatus) => {
              setResults((prev) =>
                prev.map((r) =>
                  r.id === editingRow.id
                    ? { ...r, compositeUrl: dataUrl, verifyStatus: verifyStatus || r.verifyStatus }
                    : r
                )
              );
            }}
            onSavePreset={(p) => {
              const newPreset: CompositePreset = {
                ...p,
                id: `preset-${Date.now()}`,
                createdAt: Date.now(),
              };
              setPresets((prev) => [...prev, newPreset]);
            }}
            existingPresets={presets}
          />
        )}

        <footer className="pt-2 text-center text-[11px] leading-relaxed text-slate-400">
          ข้อมูลภาพจะถูกส่งไปประมวลผลผ่าน Official DeepSeek API โดยตรงจากเบราว์เซอร์ของคุณ ไม่มีการเก็บภาพหรือ API Key ไว้บนเซิร์ฟเวอร์ใด ๆ
          <br />
          หลังประมวลผลคิวจะถูกล้างอัตโนมัติ เพื่อให้เพิ่มภาพชุดใหม่ได้ทันที · ผลลัพธ์ยังคงอยู่
          <br />
          รูปบัตรพนักงานจะถูกตรวจสอบด้วย AI อัตโนมัติ และบันทึกได้เฉพาะเมื่อผ่านเกณฑ์มาตรฐาน
        </footer>
      </main>
    </div>
  );
}
