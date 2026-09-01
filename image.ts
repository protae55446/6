/**
 * Downscale an image file and convert it to a JPEG data URL to keep
 * upload payloads small and fast on mobile data connections.
 */
export async function fileToCompressedDataUrl(
  file: File,
  maxSize = 1600,
  quality = 0.85
): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);

  // If it's not a raster image type we can draw to canvas, just return as-is.
  if (!/^image\/(png|jpeg|jpg|webp|gif|bmp)/i.test(file.type)) {
    return dataUrl;
  }

  try {
    const img = await loadImage(dataUrl);
    const { width, height } = img;
    let targetW = width;
    let targetH = height;

    if (width > maxSize || height > maxSize) {
      if (width >= height) {
        targetW = maxSize;
        targetH = Math.round((height / width) * maxSize);
      } else {
        targetH = maxSize;
        targetW = Math.round((width / height) * maxSize);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
