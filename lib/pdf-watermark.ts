import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "path";

const PDF_BASE_DPI = 72; // PDF user-space unit is always 1/72 inch

// Resolve pdfjs's bundled standard fonts / cmaps so text renders correctly
// when the page uses the 14 standard PDF fonts (Helvetica, Times, etc.)
// NOTE: we deliberately build this path from process.cwd() instead of
// require.resolve(), because bundlers (Turbopack/webpack) statically
// analyze require.resolve() calls and can rewrite them to internal module
// IDs instead of leaving them as real filesystem paths.
const PDFJS_DIST_DIR = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const STANDARD_FONT_DATA_URL = path.join(PDFJS_DIST_DIR, "standard_fonts") + "/";
const CMAPS_URL = path.join(PDFJS_DIST_DIR, "cmaps") + "/";

export type RasterPage = {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
};

export type WatermarkAsset = {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
};

/**
 * Renders the first page of a PDF with a transparent background — used
 * specifically for watermark PDFs, since pdf.js otherwise paints an opaque
 * white background by default.
 */
async function renderPdfPageTransparent(
  pdfBytes: Uint8Array,
  dpi: number
): Promise<RasterPage> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAPS_URL,
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;

  try {
    const page = await doc.getPage(1);
    const scale = dpi / PDF_BASE_DPI;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      viewport,
      background: "rgba(0,0,0,0)",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = (canvas as any).toBuffer("image/png");

    return {
      buffer,
      widthPx: canvas.width,
      heightPx: canvas.height,
      widthPt: viewport.width / scale,
      heightPt: viewport.height / scale,
    };
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }
}

/**
 * Crops a PNG buffer down to the bounding box of its non-transparent
 * content, removing empty margins. If the image has no transparency at
 * all (e.g. a flat opaque image), it's returned unchanged.
 */
async function autoCropToContent(buffer: Buffer): Promise<{
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
}> {
  const img = await loadImage(buffer);
  const probe = createCanvas(img.width, img.height);
  const probeCtx = probe.getContext("2d");
  probeCtx.drawImage(img, 0, 0);
  const { data } = probeCtx.getImageData(0, 0, img.width, img.height);

  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const alpha = data[(y * img.width + x) * 4 + 3];
      if (alpha > 4) {
        // small threshold to ignore near-invisible anti-aliasing fuzz
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // No transparent pixels found at all (fully opaque image) — nothing to crop.
  if (maxX < 0 || maxY < 0) {
    return { buffer, widthPx: img.width, heightPx: img.height };
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  // If the detected content is the entire canvas, skip cropping.
  if (minX === 0 && minY === 0 && cropW === img.width && cropH === img.height) {
    return { buffer, widthPx: img.width, heightPx: img.height };
  }

  const cropped = createCanvas(cropW, cropH);
  const croppedCtx = cropped.getContext("2d");
  croppedCtx.drawImage(img, -minX, -minY);

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buffer: (cropped as any).toBuffer("image/png"),
    widthPx: cropW,
    heightPx: cropH,
  };
}

/**
 * Renders a single page of a PDF (given as bytes) to a high-resolution
 * raster image (PNG) using pdf.js + a fresh @napi-rs/canvas surface.
 */
export async function renderPdfPageToRaster(
  pdfBytes: Uint8Array,
  pageIndex: number,
  dpi: number
): Promise<RasterPage> {
  const loadingTask = pdfjsLib.getDocument({
    // IMPORTANT: pdf.js takes ownership of the buffer it's given and may
    // transfer/detach it internally. Since this function gets called once
    // per page with the *same* source bytes, each call needs its own copy
    // — otherwise later pages see a zero-length (detached) buffer.
    data: pdfBytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAPS_URL,
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;

  try {
    const page = await doc.getPage(pageIndex + 1); // pdfjs pages are 1-indexed
    const scale = dpi / PDF_BASE_DPI;
    const viewport = page.getViewport({ scale });

    // Build our own canvas/context pair directly via @napi-rs/canvas,
    // rather than pulling `doc.canvasFactory` (which carries a reference
    // back into pdf.js's internal transport object).
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: context, viewport } as any).promise;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = (canvas as any).toBuffer("image/png");

    return {
      buffer,
      widthPx: canvas.width,
      heightPx: canvas.height,
      widthPt: viewport.width / scale,
      heightPt: viewport.height / scale,
    };
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }
}

/** Returns how many pages a PDF has, without fully rendering it. */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAPS_URL,
    cMapPacked: true,
  });
  const doc = await loadingTask.promise;
  const count = doc.numPages;
  await doc.cleanup();
  await loadingTask.destroy();
  return count;
}

/**
 * Loads a watermark asset, which can be a PNG/JPG image, or a single-page
 * PDF (rasterized at the same target DPI for consistent sharpness).
 *
 * For PDF watermarks, the page is rendered with a transparent background
 * and then auto-cropped to its actual content — many watermark PDFs are
 * exported on a full page with the logo placed off-center, and without
 * cropping, the surrounding empty margins would get scaled along with it,
 * shrinking the visible logo and throwing off its centering once placed
 * onto a document page.
 *
 * PNG/JPG watermarks are treated the same way for consistency: since a
 * raw image has no inherent physical size, its pixels are assumed to be
 * authored at 72 DPI (the common default in design tools like Photoshop
 * or Figma) and then scaled up to the target DPI — matching how a PDF
 * watermark's point-based page size gets converted to pixels. This keeps
 * both watermark types stamped at a comparable physical scale.
 */
export async function loadWatermarkAsset(
  fileBytes: Uint8Array,
  fileName: string,
  dpi: number,
  opts: { clarityGamma?: number } = {}
): Promise<WatermarkAsset> {
  // Default gamma boost: the source watermark PDF often bakes in fairly
  // low opacity for some elements (e.g. a small corner stamp), which can
  // read as a bit fainter than intended once flattened into a raster.
  // 0.85 is a light touch — it nudges faint elements up without visibly
  // altering elements whose opacity was already accurate. Applied once
  // here (not per-page) since the watermark is identical across pages.
  const clarityGamma = opts.clarityGamma ?? 0.85;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const raster = await renderPdfPageTransparent(fileBytes, dpi);
    const cropped = await autoCropToContent(raster.buffer);
    const finalBuffer =
      clarityGamma !== 1 ? await boostWatermarkAlpha(cropped.buffer, clarityGamma) : cropped.buffer;
    return {
      buffer: finalBuffer,
      widthPx: cropped.widthPx,
      heightPx: cropped.heightPx,
    };
  }

  const buffer = Buffer.from(fileBytes);
  const cropped = await autoCropToContent(buffer);

  // Treat the cropped image's pixels as if authored at 72 DPI, then scale
  // to the target DPI so it occupies the same physical size a PDF
  // watermark of equivalent point-dimensions would.
  const dpiScale = dpi / PDF_BASE_DPI;
  let scaledBuffer = cropped.buffer;
  let scaledW = cropped.widthPx;
  let scaledH = cropped.heightPx;

  if (dpiScale !== 1) {
    scaledW = Math.round(cropped.widthPx * dpiScale);
    scaledH = Math.round(cropped.heightPx * dpiScale);
    const img = await loadImage(cropped.buffer);
    const scaledCanvas = createCanvas(scaledW, scaledH);
    const scaledCtx = scaledCanvas.getContext("2d");
    scaledCtx.drawImage(img, 0, 0, scaledW, scaledH);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scaledBuffer = (scaledCanvas as any).toBuffer("image/png");
  }

  const finalBuffer =
    clarityGamma !== 1 ? await boostWatermarkAlpha(scaledBuffer, clarityGamma) : scaledBuffer;

  return { buffer: finalBuffer, widthPx: scaledW, heightPx: scaledH };
}

/**
 * Boosts a watermark's alpha channel using a gamma curve, making it
 * visually clearer/more solid without changing its shape or color.
 *
 * Many watermark PDFs (e.g. exported from CAD/PLM tools) bake in very low
 * opacity (≈0.1–0.2) for a subtle on-screen look, which becomes hard to
 * see once flattened into a rasterized page. A gamma < 1 raises low alpha
 * values proportionally more than high ones, so faint areas become much
 * more visible while already-solid strokes don't blow out past full
 * opacity.
 */
async function boostWatermarkAlpha(buffer: Buffer, gamma: number): Promise<Buffer> {
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] / 255;
    if (a > 0 && a < 1) {
      data[i] = Math.round(Math.pow(a, gamma) * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (canvas as any).toBuffer("image/png");
}

/**
 * Composites a watermark onto a rasterized page.
 *
 * The watermark is always scaled to "fit" (contain) the page — filling as
 * much of the page as possible while preserving its own aspect ratio —
 * exactly how a tool like pdftk stamps a watermark PDF onto a document of
 * a different size: the watermark scales up or down to the page, rather
 * than only ever being trusted at native size. This is what makes a
 * watermark designed on an A4 canvas still fill an A3 page properly,
 * instead of appearing small and centered.
 */
export async function compositeWatermarkOnRaster(
  pageRaster: RasterPage,
  watermark: WatermarkAsset,
  opts: { opacity?: number } = {}
): Promise<Buffer> {
  const opacity = opts.opacity ?? 1;

  const canvas = createCanvas(pageRaster.widthPx, pageRaster.heightPx);
  const ctx = canvas.getContext("2d");

  const baseImg = await loadImage(pageRaster.buffer);
  ctx.drawImage(baseImg, 0, 0, pageRaster.widthPx, pageRaster.heightPx);

  const wmImg = await loadImage(watermark.buffer);

  // Fit (contain) the watermark to the page: scale up or down so it fills
  // as much of the page as possible without being clipped, preserving its
  // aspect ratio.
  const fitScale = Math.min(
    pageRaster.widthPx / watermark.widthPx,
    pageRaster.heightPx / watermark.heightPx
  );

  const drawW = watermark.widthPx * fitScale;
  const drawH = watermark.heightPx * fitScale;
  const dx = (pageRaster.widthPx - drawW) / 2;
  const dy = (pageRaster.heightPx - drawH) / 2;

  ctx.globalAlpha = opacity;
  ctx.drawImage(wmImg, dx, dy, drawW, drawH);
  ctx.globalAlpha = 1;

  return canvas.toBuffer("image/png");
}

/**
 * Full pipeline: takes a source PDF's bytes, rasterizes every page at the
 * given DPI, optionally stamps a watermark onto each page (flattened,
 * permanent — not a separate overlay), and reassembles everything into a
 * brand new PDF.
 */
export async function watermarkPdf(
  sourcePdfBytes: Uint8Array,
  watermark: WatermarkAsset | null,
  opts: {
    dpi?: number;
    opacity?: number;
    onProgress?: (pageIndex: number, totalPages: number) => void;
    /** Max pages rasterized concurrently. Higher = faster but more memory. */
    concurrency?: number;
  } = {}
): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300;
  const concurrency = opts.concurrency ?? 3;

  const totalPages = await getPdfPageCount(sourcePdfBytes);

  // Render + composite each page independently (no shared state between
  // pages), processed in small concurrent batches rather than strictly
  // one-at-a-time — this meaningfully cuts wall-clock time for
  // multi-page documents while keeping peak memory bounded.
  const processPage = async (i: number): Promise<{ buffer: Buffer; widthPt: number; heightPt: number }> => {
    const raster = await renderPdfPageToRaster(sourcePdfBytes, i, dpi);
    const finalPngBuffer = watermark
      ? await compositeWatermarkOnRaster(raster, watermark, {
          opacity: opts.opacity,
        })
      : raster.buffer;
    opts.onProgress?.(i + 1, totalPages);
    return { buffer: finalPngBuffer, widthPt: raster.widthPt, heightPt: raster.heightPt };
  };

  const results: { buffer: Buffer; widthPt: number; heightPt: number }[] = new Array(totalPages);
  for (let batchStart = 0; batchStart < totalPages; batchStart += concurrency) {
    const batchEnd = Math.min(batchStart + concurrency, totalPages);
    const batchResults = await Promise.all(
      Array.from({ length: batchEnd - batchStart }, (_, k) => processPage(batchStart + k))
    );
    for (let k = 0; k < batchResults.length; k++) {
      results[batchStart + k] = batchResults[k];
    }
  }

  // Assembling into the final PDFDocument must happen sequentially (pdf-lib
  // documents aren't safe for concurrent mutation), but this part is cheap
  // compared to rasterization.
  const outDoc = await PDFDocument.create();
  for (const { buffer, widthPt, heightPt } of results) {
    const pngImage = await outDoc.embedPng(buffer);
    const page = outDoc.addPage([widthPt, heightPt]);
    page.drawImage(pngImage, { x: 0, y: 0, width: widthPt, height: heightPt });
  }

  return outDoc.save();
}
