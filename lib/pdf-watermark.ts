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
  dpi: number
): Promise<WatermarkAsset> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const raster = await renderPdfPageTransparent(fileBytes, dpi);
    const cropped = await autoCropToContent(raster.buffer);
    return {
      buffer: cropped.buffer,
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
  if (dpiScale === 1) {
    return { buffer: cropped.buffer, widthPx: cropped.widthPx, heightPx: cropped.heightPx };
  }

  const scaledW = Math.round(cropped.widthPx * dpiScale);
  const scaledH = Math.round(cropped.heightPx * dpiScale);
  const img = await loadImage(cropped.buffer);
  const scaledCanvas = createCanvas(scaledW, scaledH);
  const scaledCtx = scaledCanvas.getContext("2d");
  scaledCtx.drawImage(img, 0, 0, scaledW, scaledH);

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buffer: (scaledCanvas as any).toBuffer("image/png"),
    widthPx: scaledW,
    heightPx: scaledH,
  };
}

/**
 * Composites a watermark onto a rasterized page.
 *
 * Since both the page and the watermark are rasterized at the same DPI,
 * 1 watermark pixel already represents the same physical size as 1 page
 * pixel. So the watermark is stamped at its native size (no scaling),
 * centered on the page — exactly how a tool like pdftk stamps a
 * same-sized watermark PDF onto a document: the watermark's own design
 * (e.g. sized for an A4 sheet) is trusted as-is, rather than being
 * stretched or shrunk to "fit" an arbitrary content box.
 *
 * The only exception is when the page is physically *smaller* than the
 * watermark (e.g. a watermark designed for A4 stamped onto an A5 page) —
 * in that case the watermark is scaled down just enough to fit within
 * the page, so nothing gets clipped.
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

  // Native 1:1 size by default (both rasterized at the same DPI already).
  // Only scale down if the watermark would otherwise overflow the page.
  const overflowScale = Math.min(
    pageRaster.widthPx / watermark.widthPx,
    pageRaster.heightPx / watermark.heightPx,
    1 // never scale UP — only ever shrink to fit, never enlarge
  );

  const drawW = watermark.widthPx * overflowScale;
  const drawH = watermark.heightPx * overflowScale;
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
  } = {}
): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300;

  const totalPages = await getPdfPageCount(sourcePdfBytes);
  const outDoc = await PDFDocument.create();

  for (let i = 0; i < totalPages; i++) {
    const raster = await renderPdfPageToRaster(sourcePdfBytes, i, dpi);

    const finalPngBuffer = watermark
      ? await compositeWatermarkOnRaster(raster, watermark, {
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
