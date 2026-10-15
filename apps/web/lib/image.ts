/** Shrinks a photo in the browser before it is sent: at most `maxSide` pixels on the long edge, as JPEG. Drawing it on a canvas also drops the camera's metadata (location, device). */
export async function resizeToJpeg(file: Blob, maxSide = 1280, quality = 0.82): Promise<{ b64: string; dataUrl: string; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { b64: dataUrl.slice(dataUrl.indexOf(",") + 1), dataUrl, width, height };
}
