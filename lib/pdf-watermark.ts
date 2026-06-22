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
 */
export async function loadWatermarkAsset(
  fileBytes: Uint8Array,
  fileName: string,
  dpi: number
): Promise<WatermarkAsset> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const raster = await renderPdfPageToRaster(fileBytes, 0, dpi);
    return {
      buffer: raster.buffer,
      widthPx: raster.widthPx,
      heightPx: raster.heightPx,
    };
  }
  const buffer = Buffer.from(fileBytes);
  const img = await loadImage(buffer);
  return { buffer, widthPx: img.width, heightPx: img.height };
}

/**
 * Composites a watermark onto a rasterized page. The watermark is always
 * scaled to "fit" (contain) within the page bounds, preserving its own
 * aspect ratio (a landscape watermark stays landscape, just scaled down to
 * fit a portrait page), and centered with a margin.
 */
export async function compositeWatermarkOnRaster(
  pageRaster: RasterPage,
  watermark: WatermarkAsset,
  opts: { marginRatio?: number; opacity?: number } = {}
): Promise<Buffer> {
  const marginRatio = opts.marginRatio ?? 0.08;
  const opacity = opts.opacity ?? 1;

  const canvas = createCanvas(pageRaster.widthPx, pageRaster.heightPx);
  const ctx = canvas.getContext("2d");

  const baseImg = await loadImage(pageRaster.buffer);
  ctx.drawImage(baseImg, 0, 0, pageRaster.widthPx, pageRaster.heightPx);

  const wmImg = await loadImage(watermark.buffer);

  const maxW = pageRaster.widthPx * (1 - marginRatio * 2);
  const maxH = pageRaster.heightPx * (1 - marginRatio * 2);
  const scale = Math.min(maxW / watermark.widthPx, maxH / watermark.heightPx);
  const drawW = watermark.widthPx * scale;
  const drawH = watermark.heightPx * scale;
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
    marginRatio?: number;
    opacity?: number;
    onProgress?: (pageIndex: number, totalPages: number) => void;
  } = {}
): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300;

  const totalPages = await getPdfPageCount(sourcePdfBytes);
  const outDoc = await PDFDocument.create();

  for (let i = 0; i < totalPages; i++) {
    const raster = await renderPdfPageToRaster(sourcePdfBytes, i, dpi);

    const finalPngBuffer = watermark
      ? await compositeWatermarkOnRaster(raster, watermark, {
          marginRatio: opts.marginRatio,
          opacity: opts.opacity,
        })
      : raster.buffer;

    const pngImage = await outDoc.embedPng(finalPngBuffer);
    const page = outDoc.addPage([raster.widthPt, raster.heightPt]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: raster.widthPt,
      height: raster.heightPt,
    });

    opts.onProgress?.(i + 1, totalPages);
  }

  return outDoc.save();
}
