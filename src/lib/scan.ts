import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import jsQR from "jsqr";

export interface ScanResult {
  barcode: string;
  productCode: string;
  model: string;
  rawText: string;
  format: string;
  confidence: number;
  method: "zxing" | "jsqr" | "ocr" | "regex" | "none";
}

export interface Rect { x: number; y: number; w: number; h: number }

let reader: BrowserMultiFormatReader | null = null;
function getReader() {
  if (!reader) {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.ITF,
      BarcodeFormat.PDF_417,
      BarcodeFormat.AZTEC,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    reader = new BrowserMultiFormatReader(hints);
  }
  return reader;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

type Mode = "raw" | "gray" | "threshold" | "sharpen";

function preprocess(source: HTMLImageElement | HTMLCanvasElement, deg: number, mode: Mode, crop?: Rect): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const rad = (deg * Math.PI) / 180;
  const sw0 = (source as any).naturalWidth ?? (source as HTMLCanvasElement).width;
  const sh0 = (source as any).naturalHeight ?? (source as HTMLCanvasElement).height;
  const cx = crop?.x ?? 0, cy = crop?.y ?? 0;
  const cw = crop?.w ?? sw0, ch = crop?.h ?? sh0;
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(cw, ch));
  const sw = Math.round(cw * scale), sh = Math.round(ch * scale);
  if (deg % 180 === 0) { canvas.width = sw; canvas.height = sh; }
  else { canvas.width = sh; canvas.height = sw; }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source as any, cx, cy, cw, ch, -sw / 2, -sh / 2, sw, sh);
  if (mode !== "raw") {
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = d.data;
    let min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) {
      const g = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;
      p[i] = p[i + 1] = p[i + 2] = g;
      if (g < min) min = g; if (g > max) max = g;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < p.length; i += 4) {
      let v = ((p[i] - min) * 255 / range) | 0;
      if (mode === "threshold") v = v > 128 ? 255 : 0;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    if (mode === "sharpen") {
      // Simple unsharp mask via convolution
      const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
      const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = ctx.createImageData(canvas.width, canvas.height);
      const w = canvas.width, h = canvas.height;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let s = 0, ki = 0;
          for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * w + (x + kx)) * 4;
            s += src.data[idx] * k[ki++];
          }
          const i = (y * w + x) * 4;
          const v = Math.max(0, Math.min(255, s));
          out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
          out.data[i + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
    }
  }
  return canvas;
}

async function decodeCanvas(canvas: HTMLCanvasElement, mode: Mode): Promise<{ text: string; format: string; method: "zxing" | "jsqr"; confidence: number } | null> {
  const r = getReader();
  try {
    const res = await r.decodeFromImageUrl(canvas.toDataURL("image/jpeg", 0.92));
    const fmt = res.getBarcodeFormat?.()?.toString?.() || "";
    const conf = mode === "raw" ? 0.98 : mode === "gray" ? 0.92 : mode === "sharpen" ? 0.9 : 0.85;
    return { text: res.getText() || "", format: fmt, method: "zxing", confidence: conf };
  } catch {}
  try {
    const ctx = canvas.getContext("2d")!;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) {
      const conf = mode === "raw" ? 0.95 : 0.88;
      return { text: code.data, format: "QR_CODE", method: "jsqr", confidence: conf };
    }
  } catch {}
  return null;
}

async function decode(source: HTMLImageElement | HTMLCanvasElement, crop?: Rect) {
  const rotations = [0, 90, 180, 270];
  const modes: Mode[] = ["raw", "gray", "threshold", "sharpen"];
  for (const deg of rotations) {
    for (const mode of modes) {
      const canvas = preprocess(source, deg, mode, crop);
      const res = await decodeCanvas(canvas, mode);
      if (res) return res;
    }
  }
  throw new Error("No barcode/QR detected");
}

/**
 * Extract the "Material code" (mã sản phẩm) from the raw QR/barcode text.
 *
 * Labels print a barcode whose raw content concatenates several fields with
 * no separators, in this fixed layout:
 *
 *   xxxx-xxxxxx DZ87 ...
 *   (material code, no dash)  ^^^^ ^^^
 *
 * e.g.:
 *   "LJ6325296QDZ87A1N0Q6K004060500"   -> Material code "LJ63-25296Q"
 *   "Q31A004925DZ87A1N0Q6K018060200"   -> Material code "Q31A-004925"
 *
 * The material code itself can start with any letters/digits (LJ, Q31A, or
 * any other prefix the factory uses) so it can't be matched by hardcoding a
 * specific prefix like "LJ". "DZ87" (the supplier/factory code) is the part
 * that's always constant across every barcode — everything after it (e.g.
 * "A1N0Q6...") is a date/run code that changes over time and must NOT be
 * used as an anchor. The material code is always the 10 characters
 * immediately before "DZ87": 4 characters + dash + 6 characters
 * (e.g. "LJ63-25296Q", "Q31A-004925").
 */
function extractProductCode(text: string): string {
  const anchored = text.match(/([A-Z0-9]{10})DZ87/i);
  if (anchored) {
    const code = anchored[1].toUpperCase();
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  }
  // Legacy fallback: old LJ-only pattern, kept for any barcode that doesn't
  // follow the template above (e.g. partial/garbled scans, or a supplier
  // code other than DZ87).
  const pc = text.match(/LJ\d{2}-?\d+[A-Z]?/i);
  return pc ? pc[0].toUpperCase().replace(/^(LJ\d{2})(\d)/, "$1-$2") : "";
}

function extract(rawText: string, format: string, confidence: number, method: "zxing" | "jsqr"): ScanResult {
  let barcode = rawText.trim();
  const matches = rawText.match(/[A-Z0-9]{20,}/gi);
  if (matches && matches.length) {
    barcode = matches.reduce((a, b) => (b.length > a.length ? b : a)).toUpperCase();
  }
  // Use the cleaned barcode (falls back to rawText when no long alnum run
  // was found) so the anchor match isn't thrown off by stray characters.
  const productCode = extractProductCode(barcode || rawText);
  const mm = rawText.match(/\b([A-Z]{3,5}\d{2,4}[A-Z]?\d{0,3})\b/);
  const model = mm ? mm[1].toUpperCase() : "";
  return { barcode, productCode, model, rawText, format, confidence, method };
}

export async function scanFile(file: File): Promise<ScanResult> {
  const img = await fileToImage(file);
  const d = await decode(img);
  return extract(d.text, d.format, d.confidence, d.method);
}

/**
 * QR/Barcode scan only. No OCR-based fallback, no first-line label fallback.
 * Per product rule: a barcode value may only be created when QR or native
 * barcode decoding succeeds. Otherwise the caller must route the image to
 * Unrecognized Images — never synthesize a barcode from OCR text.
 */
export async function scanFileWithFallback(file: File): Promise<ScanResult> {
  return scanFile(file);
}

/** Scan only a cropped region (image-coordinates) of a file. */
export async function scanRegion(file: File, rect: Rect): Promise<ScanResult> {
  const img = await fileToImage(file);
  const d = await decode(img, rect);
  return extract(d.text, d.format, d.confidence, d.method);
}

/** Scan an already-loaded HTMLImageElement region by URL. */
export async function scanImageUrlRegion(url: string, rect?: Rect): Promise<ScanResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const d = await decode(img, rect);
  return extract(d.text, d.format, d.confidence, d.method);
}

/**
 * Detect multiple QR codes in a single image by iterative masking.
 * Each detected QR's bounding box is painted over so the next pass can find
 * neighboring codes. Falls back to the single-scan path when nothing is found.
 */
export async function scanFileMulti(file: File): Promise<ScanResult[]> {
  const img = await fileToImage(file);
  const results: ScanResult[] = [];
  const seen = new Set<string>();

  // Try a few rotations so QRs facing different orientations are all captured.
  for (const deg of [0, 90, 180, 270]) {
    const canvas = preprocess(img, deg, "raw");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    for (let i = 0; i < 16; i++) {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
      if (!code?.data) break;
      const text = code.data.trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        results.push(extract(text, "QR_CODE", 0.9, "jsqr"));
      }
      const loc: any = code.location;
      const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
      const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
      const pad = 8;
      const minX = Math.max(0, Math.floor(Math.min(...xs)) - pad);
      const minY = Math.max(0, Math.floor(Math.min(...ys)) - pad);
      const maxX = Math.min(canvas.width, Math.ceil(Math.max(...xs)) + pad);
      const maxY = Math.min(canvas.height, Math.ceil(Math.max(...ys)) + pad);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    }
    if (results.length > 0) break;
  }

  // Fallback to the zxing+rotations pipeline for non-QR barcodes or tough QRs.
  if (results.length === 0) {
    try {
      const d = await decode(img);
      const t = (d.text || "").trim();
      if (t) results.push(extract(t, d.format, d.confidence, d.method));
    } catch { /* leave empty → unrecognized */ }
  }

  return results;
}

