export interface BBoxMultipliers {
  xPad: number; // horizontal padding beyond cheeks, as a fraction of faceWidth
  yTop: number; // room above forehead (hair), as a fraction of faceHeight
  yBottom: number; // room below chin (neck), as a fraction of faceHeight
  neckOffset: number; // neck point distance below chin, as a fraction of faceHeight
}

export interface CalibrationRef {
  faceWidth: number;
  faceHeight: number;
  forehead: [number, number];
  chin: [number, number];
  leftCheek: [number, number];
  rightCheek: [number, number];
}

const DEFAULTS: BBoxMultipliers = { xPad: 0.15, yTop: 0.55, yBottom: 0.25, neckOffset: 0.2 };
const STORAGE_KEY = "faceBboxCalibration_v1";
const LEARNING_RATE = 0.3;

export function loadCalibration(): BBoxMultipliers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* localStorage unavailable or corrupted — fall back to defaults */
  }
  return { ...DEFAULTS };
}

export function resetCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function recordCorrection(
  correctedBox: [number, number, number, number],
  ref: CalibrationRef
): BBoxMultipliers {
  const [cx1, cy1, , cy2] = correctedBox;
  const cheekMinX = Math.min(ref.leftCheek[0], ref.rightCheek[0]);

  const observed = {
    xPad: (cheekMinX - cx1) / ref.faceWidth,
    yTop: (ref.forehead[1] - cy1) / ref.faceHeight,
    yBottom: (cy2 - ref.chin[1]) / ref.faceHeight,
  };

  const current = loadCalibration();
  const updated: BBoxMultipliers = {
    xPad: current.xPad + LEARNING_RATE * (observed.xPad - current.xPad),
    yTop: current.yTop + LEARNING_RATE * (observed.yTop - current.yTop),
    yBottom: current.yBottom + LEARNING_RATE * (observed.yBottom - current.yBottom),
    neckOffset: current.neckOffset,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    /* storage full or unavailable — correction just won't persist this time */
  }
  return updated;
}
