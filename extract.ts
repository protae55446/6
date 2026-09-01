import { fileToCompressedDataUrl } from "./image";
import { detectFaceGeometry, FaceGeometry } from "./faceDetection";
import { CalibrationRef } from "./calibration";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash-vision-exp";

export interface ExtractSuccess {
  ok: true;
  name: string; // formatted, e.g. MR. JOHN SMITH
  date: string; // dd/mm/yyyy
  head_bbox: [number, number, number, number] | null;
  face_center: [number, number] | null;
  rotation_angle: number;
  neck_point: [number, number] | null;
  recommended_template: "tie" | "notie" | "unknown";
  pose_notes: string;
  // Pass straight into recordCorrection() (calibration.ts) if the user adjusts head_bbox by hand.
  calibrationRef: CalibrationRef | null;
}

export interface ExtractFailure {
  ok: false;
  reason: string;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

// Geometry removed from this prompt on purpose — LLMs guess pixel coordinates poorly.
// That part is now handled locally by faceDetection.ts (MediaPipe), no API cost, more accurate.
const SYSTEM_PROMPT = `You are a meticulous document/photo data-extraction engine.
You will be shown ONE image that may contain a person (portrait, ID photo, chat screenshot, form, document, etc.).

Answer strictly as one JSON object (no markdown fences, no extra commentary):

{
  "found_name": boolean,
  "full_name_latin": string,   // Latin letters only, NO title. Empty string if not found.
  "gender_title": string,      // "MR.", "MRS.", "MISS" or ""
  "found_date": boolean,
  "date_day": number,          // 1-31 or 0
  "date_month": number,        // 1-12 or 0
  "date_year": number,         // 4-digit CE year (convert พ.ศ. by -543) or 0
  "is_buddhist_era_source": boolean,
  "notes_th": string,          // Thai explanation only when name or date is missing
  "recommended_template": string // "tie" | "notie" | "unknown" - prefer "tie" for formal look unless clearly female or image suggests otherwise
}

Rules:
- Respond with ONLY the raw JSON object.
- Do not invent data.
`;

function stripCodeFence(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "");
  return t.trim();
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

async function extractNameDate(
  file: File,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ ok: true; parsed: any } | ExtractFailure> {
  let dataUrl: string;
  try {
    dataUrl = await fileToCompressedDataUrl(file);
  } catch {
    return { ok: false, reason: "ไม่สามารถอ่านไฟล์ภาพนี้ได้ (ไฟล์อาจเสียหายหรือไม่ใช่รูปภาพ)" };
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
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the person's name and the date from this image, following the JSON schema exactly.",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
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
    return { ok: false, reason: "โมเดลไม่ส่งข้อมูลกลับมา (คำตอบว่างเปล่า)" };
  }

  try {
    return { ok: true, parsed: JSON.parse(stripCodeFence(content)) };
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return { ok: true, parsed: JSON.parse(match[0]) };
      } catch {
        return { ok: false, reason: "โมเดลตอบกลับในรูปแบบที่ไม่สามารถแปลผลได้ (JSON ไม่ถูกต้อง)" };
      }
    }
    return { ok: false, reason: "โมเดลตอบกลับในรูปแบบที่ไม่สามารถแปลผลได้ (JSON ไม่ถูกต้อง)" };
  }
}

export async function extractFromImage(
  file: File,
  apiKey: string,
  signal?: AbortSignal
): Promise<ExtractResult> {
  // Run text extraction (DeepSeek, costs API credit) and face geometry
  // (MediaPipe, local/free) in parallel — independent of each other.
  const [textResult, geometry] = await Promise.all([
    extractNameDate(file, apiKey, signal),
    detectFaceGeometry(file).catch(
      (): FaceGeometry => ({
        has_clear_face: false,
        head_bbox: null,
        face_center: null,
        rotation_angle: 0,
        neck_point: null,
        pose_notes: "detection threw",
      })
    ),
  ]);

  if (!textResult.ok) {
    // Text extraction failed outright. Still allow success if we at least got a usable face,
    // since downstream compositing may only need geometry.
    if (!geometry.has_clear_face) return textResult;
    return {
      ok: true,
      name: "",
      date: "",
      head_bbox: geometry.head_bbox,
      face_center: geometry.face_center,
      rotation_angle: geometry.rotation_angle,
      neck_point: geometry.neck_point,
      recommended_template: "unknown",
      pose_notes: geometry.pose_notes,
      calibrationRef: geometry.calibrationRef,
    };
  }

  const parsed = textResult.parsed;
  const foundName =
    !!parsed.found_name && typeof parsed.full_name_latin === "string" && parsed.full_name_latin.trim().length > 0;
  const foundDate =
    !!parsed.found_date &&
    Number(parsed.date_day) > 0 &&
    Number(parsed.date_month) > 0 &&
    Number(parsed.date_month) <= 12 &&
    Number(parsed.date_year) > 0;

  if (!foundName && !foundDate && !geometry.has_clear_face) {
    return { ok: false, reason: parsed.notes_th || "ไม่พบชื่อ วันที่ หรือใบหน้าที่ชัดเจนในภาพนี้" };
  }

  let fullName = "";
  if (foundName) {
    const titleRaw = (parsed.gender_title || "").toString().trim().toUpperCase();
    let title = "MR.";
    if (titleRaw === "MRS." || titleRaw === "MRS") title = "MRS.";
    else if (titleRaw === "MISS" || titleRaw === "MISS.") title = "MISS";
    else if (titleRaw === "MR." || titleRaw === "MR") title = "MR.";

    const cleanName = String(parsed.full_name_latin).trim().toUpperCase().replace(/\s+/g, " ");
    const alreadyHasTitle = /^(MR\.|MRS\.|MISS)\s/.test(cleanName);
    fullName = alreadyHasTitle ? cleanName : `${title} ${cleanName}`;
  }

  let date = "";
  if (foundDate) {
    date = `${pad2(Number(parsed.date_day))}/${pad2(Number(parsed.date_month))}/${Number(parsed.date_year)}`;
  }

  const recommended_template =
    parsed.recommended_template === "tie" || parsed.recommended_template === "notie"
      ? parsed.recommended_template
      : "unknown";

  return {
    ok: true,
    name: fullName,
    date,
    head_bbox: geometry.head_bbox,
    face_center: geometry.face_center,
    rotation_angle: geometry.rotation_angle,
    neck_point: geometry.neck_point,
    recommended_template,
    pose_notes: geometry.pose_notes,
    calibrationRef: geometry.calibrationRef,
  };
}
