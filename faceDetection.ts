import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { loadCalibration, CalibrationRef } from "./calibration";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

async function createLandmarker(delegate: "GPU" | "CPU"): Promise<FaceLandmarker> {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  return FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate,
    },
    runningMode: "IMAGE",
    numFaces: 1,
  });
}

async function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker("GPU").catch(() => createLandmarker("CPU"));
  }
  return landmarkerPromise;
}

export interface FaceGeometry {
  has_clear_face: boolean;
  head_bbox: [number, number, number, number] | null;
  face_center: [number, number] | null;
  rotation_angle: number;
  neck_point: [number, number] | null;
  pose_notes: string;
  calibrationRef: CalibrationRef | null;
}

const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const CHIN = 152;
const FOREHEAD_TOP = 10;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;

export async function detectFaceGeometry(file: File): Promise<FaceGeometry> {
  const img = await loadImageFromFile(file);
  try {
    const landmarker = await getLandmarker();
    const result = landmarker.detect(img);

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return emptyGeometry("no face detected");
    }

    const lm = result.faceLandmarks[0];
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const px = (i: number) => lm[i].x * W;
    const py = (i: number) => lm[i].y * H;

    const leftEye: [number, number] = [px(LEFT_EYE_OUTER), py(LEFT_EYE_OUTER)];
    const rightEye: [number, number] = [px(RIGHT_EYE_OUTER), py(RIGHT_EYE_OUTER)];
    const chin: [number, number] = [px(CHIN), py(CHIN)];
    const forehead: [number, number] = [px(FOREHEAD_TOP), py(FOREHEAD_TOP)];
    const leftCheek: [number, number] = [px(LEFT_CHEEK), py(LEFT_CHEEK)];
    const rightCheek: [number, number] = [px(RIGHT_CHEEK), py(RIGHT_CHEEK)];

    const dx = rightEye[0] - leftEye[0];
    const dy = rightEye[1] - leftEye[1];
    const rotation_angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    const faceWidth = Math.hypot(rightCheek[0] - leftCheek[0], rightCheek[1] - leftCheek[1]);
    const faceHeight = Math.hypot(chin[1] - forehead[1], chin[0] - forehead[0]);

    const cal = loadCalibration();
    const x1 = Math.min(leftCheek[0], rightCheek[0]) - faceWidth * cal.xPad;
    const x2 = Math.max(leftCheek[0], rightCheek[0]) + faceWidth * cal.xPad;
    const y1 = forehead[1] - faceHeight * cal.yTop;
    const y2 = chin[1] + faceHeight * cal.yBottom;

    const face_center: [number, number] = [
      (leftEye[0] + rightEye[0]) / 2,
      (forehead[1] + chin[1]) / 2,
    ];
    const neck_point: [number, number] = [chin[0], chin[1] + faceHeight * cal.neckOffset];
    const calibrationRef: CalibrationRef = { faceWidth, faceHeight, forehead, chin, leftCheek, rightCheek };

    const pose_notes =
      Math.abs(rotation_angle) > 8
        ? rotation_angle > 0
          ? "tilted right"
          : "tilted left"
        : "frontal";

    return {
      has_clear_face: true,
      head_bbox: [Math.max(0, x1), Math.max(0, y1), Math.min(W, x2), Math.min(H, y2)],
      face_center,
      rotation_angle,
      neck_point,
      pose_notes,
      calibrationRef,
    };
  } catch (err) {
    return emptyGeometry(`detection failed: ${(err as Error)?.message || "unknown error"}`);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function emptyGeometry(note: string): FaceGeometry {
  return {
    has_clear_face: false,
    head_bbox: null,
    face_center: null,
    rotation_angle: 0,
    neck_point: null,
    pose_notes: note,
    calibrationRef: null,
  };
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
