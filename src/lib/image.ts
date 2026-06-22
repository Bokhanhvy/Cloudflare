import imageCompression from "browser-image-compression";

export async function compressImage(file: File): Promise<File> {
  try {
    const out = await imageCompression(file, {
      maxSizeMB: 0.6,
      maxWidthOrHeight: 1800,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.82,
    });
    return new File([out], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
