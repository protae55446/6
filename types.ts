export type RowStatus = "pending" | "processing" | "done" | "error";

export interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
}

export interface GeometryData {
  head_bbox: [number, number, number, number] | null;
  face_center: [number, number] | null;
  rotation_angle: number;
  neck_point: [number, number] | null;
  recommended_template: "tie" | "notie" | "unknown";
  pose_notes: string;
}

export interface VerifyStatus {
  passed: boolean;
  score: number;
  summary_th: string;
  issues: string[];
  suggestions: string[];
  checkedAt: number;
}

export interface ResultRow {
  id: string;
  order: number;
  fileName: string;
  previewUrl: string;
  status: RowStatus;
  name: string;
  date: string;
  reason: string;
  geometry?: GeometryData;
  // For compositing
  compositeUrl?: string; // final composited image data URL
  presetId?: string;
  verifyStatus?: VerifyStatus;
}

export interface CompositePreset {
  id: string;
  name: string;
  template: "tie" | "notie";
  offsetX: number;   // relative to template center
  offsetY: number;
  scale: number;
  rotation: number;  // degrees
  createdAt: number;
}
