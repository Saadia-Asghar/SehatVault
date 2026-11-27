"use client";

const MAX_EDGE_PX = 2000;
const JPEG_QUALITY = 0.85;
/** Photos smaller than this are sent as they are. */
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

/**
 * Downscales large phone photos in the browser so uploads stay under the server limit
 * and Gemini reads them faster. PDFs and files the browser cannot decode are returned unchanged.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it: the server decides
  }
}
