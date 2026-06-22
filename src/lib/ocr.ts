// Browser-only OCR using Tesseract.js
export interface OcrResult {
  barcode: string;
  productCode: string;
  model: string;
  rawText: string;
  confidence: number;
}

let workerPromise: Promise<any> | null = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await import("tesseract.js");
      const w = await Tesseract.createWorker("eng");
      return w;
    })();
  }
  return workerPromise;
}

export async function runOcr(file: File): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(file);
  const text: string = data.text || "";
  const confidence: number = data.confidence ?? 0;

  // Barcode: longest alphanumeric string > 25 chars
  let barcode = "";
  const tokens = text.match(/[A-Z0-9]{20,}/gi) || [];
  for (const t of tokens) {
    const clean = t.replace(/[^A-Z0-9]/gi, "");
    if (clean.length > 25 && clean.length > barcode.length) barcode = clean.toUpperCase();
  }

  // Product code: same template as scan.ts — anchor on the constant
  // "DZ87" supplier marker rather than a hardcoded "LJ" prefix, so any
  // material code format (LJ, Q31A, ...) is recognized. The text right
  // after "DZ87" (e.g. "A1N0Q6...") is a date/run code that changes over
  // time and must NOT be used as an anchor.
  const anchored = text.match(/([A-Z0-9]{10})DZ87/i);
  let productCode = "";
  if (anchored) {
    const code = anchored[1].toUpperCase();
    productCode = `${code.slice(0, 4)}-${code.slice(4)}`;
  } else {
    const pc = text.match(/LJ\d{2}-\d+[A-Z]/);
    productCode = pc ? pc[0] : "";
  }

  // Model: value after "SDV Product" or "Model"
  let model = "";
  const modelMatch = text.match(/(?:SDV\s*Product|Model)\s*[:\-]?\s*([A-Z0-9]{4,})/i);
  if (modelMatch) model = modelMatch[1].toUpperCase();

  return { barcode, productCode, model, rawText: text, confidence };
}
