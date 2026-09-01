import { ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      return ImageSegmenter.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    })();
  }
  return segmenterPromise;
}

// 0 background, 1 hair, 2 body-skin (includes neck), 3 face-skin, 4 clothes, 5 others (accessories)
const CATEGORY_HAIR = 1;
const CATEGORY_NECK_SKIN = 2;
const CATEGORY_FACE_SKIN = 3;
const CATEGORY_ACCESSORIES = 5;

export async function cutOutHead(img: HTMLImageElement): Promise<HTMLCanvasElement> {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(img);
  const categoryMask = result.categoryMask;
  if (!categoryMask) throw new Error("segmentation returned no mask");

  const maskData = categoryMask.getAsUint8Array();
  const maskW = categoryMask.width;
  const maskH = categoryMask.height;

  const out = document.createElement("canvas");
  out.width = img.naturalWidth;
  out.height = img.naturalHeight;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(img, 0, 0, out.width, out.height);

  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const px = imageData.data;

  const sx = maskW / out.width;
  const sy = maskH / out.height;

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const mx = Math.min(maskW - 1, Math.floor(x * sx));
      const my = Math.min(maskH - 1, Math.floor(y * sy));
      const category = maskData[my * maskW + mx];
      const keep =
        category === CATEGORY_HAIR ||
        category === CATEGORY_NECK_SKIN ||
        category === CATEGORY_FACE_SKIN ||
        category === CATEGORY_ACCESSORIES;
      if (!keep) {
        px[(y * out.width + x) * 4 + 3] = 0;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  categoryMask.close();
  return out;
}
