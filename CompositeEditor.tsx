import { useEffect, useRef, useState, useCallback } from "react";
import {
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
  AlertTriangle,
  Wand2,
} from "lucide-react";
import type { GeometryData, CompositePreset, VerifyStatus } from "../lib/types";
import { cutOutHead } from "../lib/segmentation";
import { verifyComposite } from "../lib/verify";

interface Props {
  sourcePreviewUrl: string;
  geometry: GeometryData;
  apiKey: string;
  onClose: () => void;
  onSaveImage: (dataUrl: string, verifyStatus?: VerifyStatus) => void;
  onSavePreset: (preset: Omit<CompositePreset, "id" | "createdAt">) => void;
  existingPresets: CompositePreset[];
}

const TEMPLATE_URLS = {
  tie: "/templates/suit_tie.png",
  notie: "/templates/suit_notie.png",
};

const REFERENCE_URLS = {
  tie: "/templates/ref_tie.jpg",
  notie: "/templates/ref_notie.jpg",
};

const BG_COLOR = "#F2EDE6";
const OUTPUT_W = 300;
const OUTPUT_H = 400;
const MAX_AUTO_ROUNDS = 6;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type VerifySuccessLike = {
  passed: boolean;
  score: number;
  summary_th: string;
  issues: string[];
  suggestions: string[];
  deltas?: {
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    rotation?: number;
    template?: "tie" | "notie";
  };
  status: VerifyStatus;
};

type RoundLog = {
  round: number;
  score: number;
  passed: boolean;
  summary: string;
  changeText: string;
  previewUrl: string;
  values: { offsetX: number; offsetY: number; scale: number; rotation: number };
};

function describeDeltas(d: NonNullable<VerifySuccessLike["deltas"]>): string {
  const parts: string[] = [];
  if (typeof d.offsetX === "number" && Math.abs(d.offsetX) >= 1) {
    parts.push(d.offsetX > 0 ? `ขวา ${d.offsetX.toFixed(0)}` : `ซ้าย ${Math.abs(d.offsetX).toFixed(0)}`);
  }
  if (typeof d.offsetY === "number" && Math.abs(d.offsetY) >= 1) {
    parts.push(d.offsetY > 0 ? `ลง ${d.offsetY.toFixed(0)}` : `ขึ้น ${Math.abs(d.offsetY).toFixed(0)}`);
  }
  if (typeof d.scale === "number" && Math.abs(d.scale - 1) >= 0.02) {
    parts.push(d.scale > 1 ? `ขยาย ×${d.scale.toFixed(2)}` : `ย่อ ×${d.scale.toFixed(2)}`);
  }
  if (typeof d.rotation === "number" && Math.abs(d.rotation) >= 0.5) {
    parts.push(d.rotation > 0 ? `หมุนขวา ${d.rotation.toFixed(1)}°` : `หมุนซ้าย ${Math.abs(d.rotation).toFixed(1)}°`);
  }
  if (d.template) {
    parts.push(d.template === "tie" ? "เปลี่ยนเป็นมีเนคไท" : "เปลี่ยนเป็นไม่มีเนคไท");
  }
  return parts.length ? parts.join(" · ") : "ไม่มีการปรับ";
}

export default function CompositeEditor({
  sourcePreviewUrl,
  geometry,
  apiKey,
  onClose,
  onSaveImage,
  onSavePreset,
  existingPresets,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [template, setTemplate] = useState<"tie" | "notie">(
    geometry.recommended_template === "notie" ? "notie" : "tie"
  );
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(-28);
  const [scale, setScale] = useState(1.12);
  const [rotation, setRotation] = useState(geometry.rotation_angle || 0);
  const [presetName, setPresetName] = useState("มาตรฐานบัตรพนักงาน");

  const [templateImg, setTemplateImg] = useState<HTMLImageElement | null>(null);
  const [headCanvas, setHeadCanvas] = useState<HTMLCanvasElement | null>(null);
  const [refDataUrl, setRefDataUrl] = useState<string | null>(null);
  const [isProcessingHead, setIsProcessingHead] = useState(false);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isAutoAdjusting, setIsAutoAdjusting] = useState(false);
  const [autoRound, setAutoRound] = useState(0);
  const [lastVerify, setLastVerify] = useState<VerifyStatus | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [roundLogs, setRoundLogs] = useState<RoundLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextDebounce = useRef(false);

  const stateRef = useRef({ offsetX, offsetY, scale, rotation, template });
  stateRef.current = { offsetX, offsetY, scale, rotation, template };

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) setTemplateImg(img);
    };
    img.src = TEMPLATE_URLS[template];
    return () => {
      cancelled = true;
    };
  }, [template]);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setRefDataUrl(c.toDataURL("image/jpeg", 0.9));
      }
    };
    img.onerror = () => {
      if (!cancelled) setRefDataUrl(null);
    };
    img.src = REFERENCE_URLS[template];
    return () => {
      cancelled = true;
    };
  }, [template]);

  useEffect(() => {
    let cancelled = false;
    setIsProcessingHead(true);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      try {
        const cut = await cutOutHead(img);
        if (!cancelled) setHeadCanvas(cut);
      } finally {
        if (!cancelled) setIsProcessingHead(false);
      }
    };
    img.src = sourcePreviewUrl;
    return () => {
      cancelled = true;
    };
  }, [sourcePreviewUrl]);

  const getCurrentDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  const paintCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !templateImg || !headCanvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const bbox = geometry.head_bbox;
    if (!bbox) return false;
    const [x1, y1, x2, y2] = bbox;
    const headW = x2 - x1;
    const headH = y2 - y1;
    if (headW <= 0 || headH <= 0) return false;

    const { offsetX: ox, offsetY: oy, scale: sc, rotation: rot } = stateRef.current;

    const targetHeadH = OUTPUT_H * 0.62 * sc;
    const targetHeadW = (headW / headH) * targetHeadH;
    const cx = OUTPUT_W / 2 + ox;
    const cy = OUTPUT_H * 0.32 + oy;

    // --- Layer 1: cream background ---
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

    // --- Layer 2: head cutout (base placement) ---
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(
      headCanvas,
      x1, y1, headW, headH,
      -targetHeadW / 2, -targetHeadH / 2,
      targetHeadW, targetHeadH
    );
    ctx.restore();

    // --- Layer 3: suit template on top (transparent face hole) ---
    ctx.drawImage(templateImg, 0, 0, OUTPUT_W, OUTPUT_H);

    // --- Layer 4: soft-blend ORIGINAL face back on top of the hole ---
    // Keeps identity sharp and softens the harsh cut edge around cheeks/jaw.
    // We only re-draw the inner face region (slightly shrunk bbox) with a radial-ish
    // soft edge so the neck/collar junction from the suit still shows.
    try {
      const facePadX = headW * 0.08;
      const facePadTop = headH * 0.06;
      // Keep more of the lower face but stop before heavy neck so collar stays from suit
      const facePadBottom = headH * 0.22;
      const fx1 = x1 + facePadX;
      const fy1 = y1 + facePadTop;
      const fx2 = x2 - facePadX;
      const fy2 = y2 - facePadBottom;
      const fW = fx2 - fx1;
      const fH = fy2 - fy1;
      if (fW > 4 && fH > 4) {
        // Map original face crop into the same transformed space as the head
        const scaleX = targetHeadW / headW;
        const scaleY = targetHeadH / headH;
        const destW = fW * scaleX;
        const destH = fH * scaleY;
        const destX = -targetHeadW / 2 + (fx1 - x1) * scaleX;
        const destY = -targetHeadH / 2 + (fy1 - y1) * scaleY;

        // Offscreen soft-masked face patch
        const patch = document.createElement("canvas");
        patch.width = Math.max(1, Math.round(destW));
        patch.height = Math.max(1, Math.round(destH));
        const pctx = patch.getContext("2d");
        if (pctx) {
          pctx.drawImage(
            headCanvas,
            fx1, fy1, fW, fH,
            0, 0, patch.width, patch.height
          );
          // Feather edges: erase border with soft gradient mask
          pctx.globalCompositeOperation = "destination-in";
          const g = pctx.createRadialGradient(
            patch.width / 2,
            patch.height * 0.45,
            Math.min(patch.width, patch.height) * 0.25,
            patch.width / 2,
            patch.height * 0.5,
            Math.max(patch.width, patch.height) * 0.55
          );
          g.addColorStop(0, "rgba(0,0,0,1)");
          g.addColorStop(0.7, "rgba(0,0,0,0.85)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          pctx.fillStyle = g;
          pctx.fillRect(0, 0, patch.width, patch.height);

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.globalAlpha = 0.92;
          ctx.drawImage(patch, destX, destY, destW, destH);
          ctx.restore();
        }
      }
    } catch {
      // face re-blend is best-effort; base composite still valid
    }

    return true;
  }, [templateImg, headCanvas, geometry]);

  const runSingleVerify = useCallback(async (): Promise<VerifySuccessLike | null> => {
    if (!apiKey.trim()) {
      setVerifyError("กรุณากรอก API Key (แนะนำให้ปิด Auto-clear ขณะปรับรูปบัตร)");
      return null;
    }
    paintCanvas();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return null;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsVerifying(true);
    setVerifyError(null);

    try {
      const result = await verifyComposite(
        dataUrl,
        apiKey.trim(),
        controller.signal,
        refDataUrl
      );
      if (!result.ok) {
        setVerifyError(result.reason);
        return null;
      }
      const status: VerifyStatus = {
        passed: result.passed,
        score: result.score,
        summary_th: result.summary_th,
        issues: result.issues,
        suggestions: result.suggestions,
        checkedAt: Date.now(),
      };
      setLastVerify(status);
      return { ...result, status };
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setVerifyError(err?.message || "เกิดข้อผิดพลาดระหว่างตรวจสอบ");
      }
      return null;
    } finally {
      setIsVerifying(false);
      abortRef.current = null;
    }
  }, [apiKey, getCurrentDataUrl, paintCanvas, refDataUrl]);

  useEffect(() => {
    paintCanvas();

    if (skipNextDebounce.current || isAutoAdjusting) {
      skipNextDebounce.current = false;
      return;
    }

    setLastVerify(null);
    setVerifyError(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (apiKey.trim() && headCanvas && templateImg) {
        void runSingleVerify();
      }
    }, 1400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [templateImg, headCanvas, offsetX, offsetY, scale, rotation, geometry, apiKey, isAutoAdjusting, paintCanvas, runSingleVerify]);

  const applyDeltas = (deltas: NonNullable<VerifySuccessLike["deltas"]>) => {
    skipNextDebounce.current = true;
    // Amplify small model steps slightly so progress is visible within few rounds
    const boost = 1.35;
    if (typeof deltas.offsetX === "number") {
      const dx = Math.round(deltas.offsetX * boost);
      setOffsetX((v) => clamp(v + dx, -80, 80));
      stateRef.current.offsetX = clamp(stateRef.current.offsetX + dx, -80, 80);
    }
    if (typeof deltas.offsetY === "number") {
      const dy = Math.round(deltas.offsetY * boost);
      setOffsetY((v) => clamp(v + dy, -100, 60));
      stateRef.current.offsetY = clamp(stateRef.current.offsetY + dy, -100, 60);
    }
    if (typeof deltas.scale === "number" && deltas.scale > 0) {
      // Pull scale change a bit stronger toward the model's intent
      const s = 1 + (deltas.scale - 1) * boost;
      setScale((v) => clamp(Number((v * s).toFixed(2)), 0.5, 1.8));
      stateRef.current.scale = clamp(Number((stateRef.current.scale * s).toFixed(2)), 0.5, 1.8);
    }
    if (typeof deltas.rotation === "number") {
      const dr = Number((deltas.rotation * boost).toFixed(1));
      setRotation((v) => clamp(Number((v + dr).toFixed(1)), -25, 25));
      stateRef.current.rotation = clamp(Number((stateRef.current.rotation + dr).toFixed(1)), -25, 25);
    }
    if (deltas.template === "tie" || deltas.template === "notie") {
      setTemplate(deltas.template);
      stateRef.current.template = deltas.template;
    }
  };

  const handleAutoAdjust = async () => {
    if (!apiKey.trim() || isProcessingHead || !headCanvas || !templateImg) return;
    if (isAutoAdjusting) return;

    setIsAutoAdjusting(true);
    setVerifyError(null);
    setAutoRound(0);
    setRoundLogs([]);
    setSelectedLog(null);

    try {
      for (let round = 1; round <= MAX_AUTO_ROUNDS; round++) {
        setAutoRound(round);

        // Let React paint current values so user sees the live preview
        await new Promise((r) => setTimeout(r, round === 1 ? 200 : 400));
        paintCanvas();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        // Snapshot preview BEFORE verify (current state of this round)
        const previewBefore = getCurrentDataUrl() || "";

        const result = await runSingleVerify();
        if (!result) break;

        const cur = stateRef.current;
        const log: RoundLog = {
          round,
          score: result.score,
          passed: result.passed,
          summary: result.summary_th,
          changeText: result.passed
            ? "ผ่านแล้ว — ไม่ต้องปรับเพิ่ม"
            : describeDeltas(result.deltas || {}),
          previewUrl: previewBefore,
          values: {
            offsetX: cur.offsetX,
            offsetY: cur.offsetY,
            scale: cur.scale,
            rotation: cur.rotation,
          },
        };
        setRoundLogs((prev) => [...prev, log]);
        setSelectedLog(round);

        if (result.passed) {
          setAutoRound(0);
          break;
        }

        const d = result.deltas;
        if (!d) break;

        const hasUseful =
          (typeof d.offsetX === "number" && Math.abs(d.offsetX) >= 1) ||
          (typeof d.offsetY === "number" && Math.abs(d.offsetY) >= 1) ||
          (typeof d.scale === "number" && Math.abs(d.scale - 1) >= 0.02) ||
          (typeof d.rotation === "number" && Math.abs(d.rotation) >= 0.5) ||
          !!d.template;

        if (!hasUseful) break;

        // Apply deltas → user will see canvas update on next loop iteration
        applyDeltas(d);

        // Wait for state flush + template reload if needed
        await new Promise((r) => setTimeout(r, 600));
        paintCanvas();
        // Brief pause so the user can actually see the new pose
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setIsAutoAdjusting(false);
      setAutoRound(0);
    }
  };

  const restoreRound = (log: RoundLog) => {
    if (isAutoAdjusting) return;
    skipNextDebounce.current = true;
    setOffsetX(log.values.offsetX);
    setOffsetY(log.values.offsetY);
    setScale(log.values.scale);
    setRotation(log.values.rotation);
    setSelectedLog(log.round);
    setLastVerify({
      passed: log.passed,
      score: log.score,
      summary_th: log.summary,
      issues: [],
      suggestions: [],
      checkedAt: Date.now(),
    });
  };

  useEffect(() => {
    if (headCanvas && templateImg && apiKey.trim() && !isProcessingHead && !isAutoAdjusting) {
      const t = setTimeout(() => {
        void runSingleVerify();
      }, 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headCanvas, templateImg, isProcessingHead, refDataUrl]);

  const handleDownload = () => {
    if (!lastVerify?.passed) return;
    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return;
    onSaveImage(dataUrl, lastVerify);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `idphoto_${Date.now()}.jpg`;
    a.click();
  };

  const handleSavePreset = () => {
    onSavePreset({
      name: presetName || "มาตรฐาน",
      template,
      offsetX,
      offsetY,
      scale,
      rotation,
    });
  };

  const applyPreset = (p: CompositePreset) => {
    setTemplate(p.template);
    setOffsetX(p.offsetX);
    setOffsetY(p.offsetY);
    setScale(p.scale);
    setRotation(p.rotation);
  };

  const canSave = !!lastVerify?.passed && !isVerifying && !isAutoAdjusting && !isProcessingHead;
  const canAuto = !!apiKey.trim() && !isProcessingHead && !!headCanvas && !!templateImg && !isAutoAdjusting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">ปรับแต่งรูปบัตรพนักงาน</h3>
            <p className="text-[11px] text-slate-500">
              ขั้นสุดท้ายซ้อนใบหน้าเดิมกลับแบบเกลี่ยขอบ · พรีวิวเรียลไทม์ขณะ AI ปรับ
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 sm:flex-row">
          {/* Preview column */}
          <div className="flex flex-col items-center gap-2">
            <canvas
              ref={canvasRef}
              width={OUTPUT_W}
              height={OUTPUT_H}
              className="rounded-lg border border-slate-200 shadow-sm"
              style={{ width: 240, height: 320 }}
            />
            <p className="text-[11px] text-slate-400">300 × 400 px · พื้นหลังตามตัวอย่าง</p>

            {isProcessingHead && (
              <p className="text-[11px] text-indigo-500">กำลังตัดขอบหัว...</p>
            )}
            {(isVerifying || isAutoAdjusting) && (
              <p className="flex items-center gap-1 text-[11px] text-indigo-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                {isAutoAdjusting
                  ? `กำลังปรับรอบ ${autoRound}/${MAX_AUTO_ROUNDS} — ดูพรีวิวด้านบน`
                  : "กำลังเปรียบเทียบกับตัวอย่าง..."}
              </p>
            )}

            {/* Live values while adjusting */}
            {isAutoAdjusting && (
              <div className="w-full max-w-[240px] rounded-lg border border-indigo-100 bg-indigo-50/80 px-2.5 py-1.5 text-[10px] text-indigo-800">
                <div className="font-medium">ค่าปัจจุบัน (รอบ {autoRound})</div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-2">
                  <span>X: {offsetX}</span>
                  <span>Y: {offsetY}</span>
                  <span>ขนาด: {scale.toFixed(2)}</span>
                  <span>หมุน: {rotation.toFixed(1)}°</span>
                </div>
              </div>
            )}

            {lastVerify && !isVerifying && (
              <div
                className={`mt-1 w-full max-w-[240px] rounded-xl border p-3 text-left ${
                  lastVerify.passed
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {lastVerify.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  <span className={lastVerify.passed ? "text-emerald-800" : "text-amber-800"}>
                    {lastVerify.passed ? "ใกล้เคียงตัวอย่างแล้ว" : "ยังไม่ใกล้ตัวอย่างพอ"}
                  </span>
                  <span className="ml-auto text-[11px] font-normal text-slate-500">
                    {lastVerify.score}/100
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-700">
                  {lastVerify.summary_th}
                </p>
              </div>
            )}

            {verifyError && (
              <p className="mt-1 max-w-[240px] text-center text-[11px] text-red-600">{verifyError}</p>
            )}

            {/* Round history — clickable to restore / review */}
            {roundLogs.length > 0 && (
              <div className="mt-2 w-full max-w-[240px]">
                <p className="mb-1 text-[10px] font-medium text-slate-500">
                  ประวัติการปรับ (กดเพื่อดู/ย้อนกลับ)
                </p>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {roundLogs.map((log) => (
                    <button
                      key={log.round}
                      type="button"
                      disabled={isAutoAdjusting}
                      onClick={() => restoreRound(log)}
                      className={`flex-shrink-0 rounded-lg border p-1 transition ${
                        selectedLog === log.round
                          ? "border-indigo-400 ring-1 ring-indigo-300"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                      title={`รอบ ${log.round}: ${log.changeText}`}
                    >
                      <img
                        src={log.previewUrl}
                        alt={`รอบ ${log.round}`}
                        className="h-14 w-[42px] rounded object-cover"
                      />
                      <div className="mt-0.5 text-center text-[9px] text-slate-600">
                        R{log.round}
                        <span className={log.passed ? " text-emerald-600" : " text-amber-600"}>
                          {" "}
                          {log.score}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {selectedLog != null && (
                  <p className="mt-1 text-[10px] leading-snug text-slate-600">
                    รอบ {selectedLog}:{" "}
                    {roundLogs.find((l) => l.round === selectedLog)?.changeText}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-1 flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">เทมเพลตสูท</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTemplate("tie")}
                  disabled={isAutoAdjusting}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    template === "tie" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"
                  }`}
                >
                  มีเนคไท
                </button>
                <button
                  type="button"
                  onClick={() => setTemplate("notie")}
                  disabled={isAutoAdjusting}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    template === "notie" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200"
                  }`}
                >
                  ไม่มีเนคไท
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>เลื่อนซ้าย-ขวา</span>
                  <span>{offsetX}</span>
                </label>
                <input
                  type="range"
                  min={-80}
                  max={80}
                  value={offsetX}
                  disabled={isAutoAdjusting}
                  onChange={(e) => setOffsetX(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>เลื่อนขึ้น-ลง</span>
                  <span>{offsetY}</span>
                </label>
                <input
                  type="range"
                  min={-100}
                  max={60}
                  value={offsetY}
                  disabled={isAutoAdjusting}
                  onChange={(e) => setOffsetY(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>ขนาด</span>
                  <span>{scale.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1.8}
                  step={0.01}
                  value={scale}
                  disabled={isAutoAdjusting}
                  onChange={(e) => setScale(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>หมุน (องศา)</span>
                  <span>{rotation.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min={-25}
                  max={25}
                  step={0.5}
                  value={rotation}
                  disabled={isAutoAdjusting}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">บันทึกเป็นมาตรฐาน</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  placeholder="ชื่อพรีเซ็ต"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <Save className="h-3.5 w-3.5" /> บันทึก
                </button>
              </div>
              {existingPresets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {existingPresets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p)}
                      disabled={isAutoAdjusting}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-indigo-300"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-800">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  พรีวิวระหว่างปรับ
                </div>
                <p className="mt-0.5 text-violet-700">
                  ภาพด้านซ้ายจะอัปเดตทุกครั้งที่โมเดลขยับค่า · ประวัติรอบด้านล่างช่วยให้เห็นว่า
                  ขยาย/ย่อ หรือเลื่อนเกิน–ขาดตรงไหน แล้วกดย้อนกลับไปรอบนั้นได้
                </p>
              </div>

              <button
                type="button"
                onClick={handleAutoAdjust}
                disabled={!canAuto}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 bg-violet-50 py-2.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAutoAdjusting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    กำลังปรับรอบ {autoRound}/{MAX_AUTO_ROUNDS}...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    AI ปรับให้ใกล้ตัวอย่างอัตโนมัติ
                  </>
                )}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!canSave}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download className="h-4 w-4" />
                  {canSave ? "บันทึกภาพ (ใกล้ตัวอย่างแล้ว)" : "บันทึกภาพ (รอผ่านเกณฑ์)"}
                </button>
                <button
                  type="button"
                  disabled={isAutoAdjusting}
                  onClick={() => {
                    setOffsetX(0);
                    setOffsetY(-28);
                    setScale(1.12);
                    setRotation(geometry.rotation_angle || 0);
                    setRoundLogs([]);
                    setSelectedLog(null);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
