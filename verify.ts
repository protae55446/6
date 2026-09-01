import { fileToCompressedDataUrl } from "./image";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash-vision-exp";

export interface VerifySuccess {
  ok: true;
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
}

export interface VerifyFailure {
  ok: false;
  reason: string;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

/**
 * When a reference image is provided, the model must compare the candidate
 * against that visual standard and return deltas that move the candidate
 * toward the reference proportions and alignment.
 */
const SYSTEM_PROMPT = `You are a strict visual matching engine for Thai employee ID photos.
You will receive TWO images:
1) CANDIDATE — the current composited result (real head + suit template)
2) REFERENCE — the ideal target look (professional formal portrait with suit)

Your job is to make the CANDIDATE look as close as possible to the REFERENCE in:
- head size relative to the frame (head should be clearly larger than the suit area; suit must NOT dominate the frame)
- vertical position of the head (head high enough, suit lower; space above hair, collar just under chin)
- horizontal centering
- head tilt / rotation
- how naturally the neck meets the collar

Common failure: suit occupies too much of the image. In that case prefer negative offsetY (move head UP) and/or scale > 1 (enlarge head) so the head fills more of the upper half like the REFERENCE.

Answer ONLY with a raw JSON object (no markdown):

{
  "passed": boolean,
  "score": number,
  "summary_th": string,
  "issues": string[],
  "suggestions": string[],
  "deltas": {
    "offsetX": number,
    "offsetY": number,
    "scale": number,
    "rotation": number,
    "template": "tie" | "notie" | null
  }
}

### deltas (relative to CURRENT candidate)
- offsetX: positive = move head RIGHT, negative = LEFT. Typical step ±5 to ±25
- offsetY: positive = move head DOWN, negative = UP. Typical step ±5 to ±30
- scale: multiply current size. 1.0 = no change. Typical 0.90–1.15
- rotation: degrees to ADD. positive = clockwise. Typical -8 to +8
- template: only if switching tie/no-tie clearly improves match; else null

### passed rules
- passed = true only when the candidate is already very close to the reference
  (head size, position, centering, tilt all look professional and similar)
- Prefer small safe steps. Do not overshoot.
- Always fill deltas (use 0 / null when no change needed).

Write summary_th, issues, suggestions in Thai.`;

function stripCodeFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "");
  return t.trim();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compressDataUrl(dataUrl: string, max = 700, quality = 0.88): Promise<string> {
  if (dataUrl.length < 900_000) return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > max || h > max) {
    if (w >= h) {
      h = Math.round((h / w) * max);
      w = max;
    } else {
      w = Math.round((w / h) * max);
      h = max;
    }
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function parseDeltas(raw: any): VerifySuccess["deltas"] {
  if (!raw || typeof raw !== "object") return undefined;
  const out: NonNullable<VerifySuccess["deltas"]> = {};
  if (typeof raw.offsetX === "number" && Number.isFinite(raw.offsetX)) out.offsetX = raw.offsetX;
  if (typeof raw.offsetY === "number" && Number.isFinite(raw.offsetY)) out.offsetY = raw.offsetY;
  if (typeof raw.scale === "number" && Number.isFinite(raw.scale) && raw.scale > 0) out.scale = raw.scale;
  if (typeof raw.rotation === "number" && Number.isFinite(raw.rotation)) out.rotation = raw.rotation;
  if (raw.template === "tie" || raw.template === "notie") out.template = raw.template;
  return out;
}

/**
 * Verify / auto-adjust a composite.
 * Pass referenceDataUrl (from /templates/ref_tie.jpg or ref_notie.jpg)
 * so the model can visually match the user's ideal examples.
 */
export async function verifyComposite(
  imageSource: string | File,
  apiKey: string,
  signal?: AbortSignal,
  referenceDataUrl?: string | null
): Promise<VerifyResult> {
  let dataUrl: string;
  try {
    if (typeof imageSource === "string") {
      dataUrl = await compressDataUrl(imageSource);
    } else {
      dataUrl = await fileToCompressedDataUrl(imageSource, 700, 0.88);
    }
  } catch {
    return { ok: false, reason: "ไม่สามารถเตรียมภาพสำหรับตรวจสอบได้" };
  }

  let refUrl: string | null = null;
  if (referenceDataUrl) {
    try {
      refUrl = await compressDataUrl(referenceDataUrl, 700, 0.88);
    } catch {
      refUrl = null;
    }
  }

  const userContent: any[] = [
    {
      type: "text",
      text: refUrl
        ? "Image 1 is the CANDIDATE composite. Image 2 is the REFERENCE ideal. Compare them and return JSON with deltas to make the candidate match the reference."
        : "Inspect this composited employee ID photo and return JSON with pass/fail and numeric deltas.",
    },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
  if (refUrl) {
    userContent.push({ type: "image_url", image_url: { url: refUrl } });
  }

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return { ok: false, reason: "เชื่อมต่อ API ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)" };
  }

  if (!response.ok) {
    let msg = `เรียก API ไม่สำเร็จ (HTTP ${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        if (response.status === 401) msg = "API Key ไม่ถูกต้องหรือหมดอายุ";
        else if (response.status === 429) msg = "ถูกจำกัดอัตราการเรียก (Rate limit) กรุณาลองใหม่";
        else msg = `API ผิดพลาด: ${String(errJson.error.message).slice(0, 200)}`;
      }
    } catch {
      /* ignore */
    }
    return { ok: false, reason: msg };
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: "อ่านผลลัพธ์จาก API ไม่สำเร็จ" };
  }

  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, reason: "โมเดลไม่ส่งข้อมูลกลับมา" };
  }

  const tryParse = (text: string): VerifySuccess => {
    const parsed = JSON.parse(text);
    return {
      ok: true,
      passed: !!parsed.passed,
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      summary_th: String(parsed.summary_th || "").trim() || (parsed.passed ? "ผ่านเกณฑ์" : "ยังไม่ผ่านเกณฑ์"),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
      deltas: parseDeltas(parsed.deltas),
    };
  };

  try {
    return tryParse(stripCodeFence(content));
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return tryParse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return { ok: false, reason: "โมเดลตอบกลับในรูปแบบที่ไม่สามารถแปลผลได้" };
  }
}
