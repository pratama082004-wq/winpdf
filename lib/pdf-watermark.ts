import { Canvas, createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "path";

const PDF_BASE_DPI = 72; // PDF user-space unit is always 1/72 inch

// Single source of truth for the rasterization DPI, used by both the
// source drawing and the watermark (they must match, or
// compositeWatermarkOnRaster's fitScale math goes wrong). Previously
// 300, hardcoded separately at each call site (the single-file route, the
// batch route, and watermarkPdf's own default) — lowered to 200 here
// after measuring that it cuts per-page processing time by ~36% (a real
// customer complaint: a 44-page single file took 1m20s end-to-end) with
// no measurable quality loss: a known test barcode's run-length pattern
// at 200 DPI was bar-for-bar identical to 300 DPI (38 bars, healthy
// varied 1-5px widths), while 150 DPI started fusing bars together (down
// to 29 detected bars) — 200 was the lowest value that stayed identical
// to the 300 DPI baseline on that test. Exported so both API routes stay
// in sync with watermarkPdf's own default instead of each hardcoding a
// number that could drift out of sync with this one.
export const DEFAULT_RASTER_DPI = 200;

// Default line-darkening intensity (see sharpenRasterLines for the full
// rationale and the barcode-fusing caveat). Stays 0 (off) by default —
// per customer feedback this previously caused a real barcode to become
// unscannable when left on unconditionally. Now exposed as a 0–1
// intensity callers can opt into explicitly (see watermarkPdf's
// lineSharpenIntensity option) instead of a hardcoded all-or-nothing flag.
const DEFAULT_LINE_SHARPEN_INTENSITY = 0;

// Default JPEG quality (0-100) for the final flattened page. 90 was the
// value verified earlier (see compositeWatermarkOnRaster's doc comment)
// to introduce no visible block artifacts and keep an embedded barcode's
// run-length pattern healthy. Exposed as a tunable so a user-facing
// quality slider doesn't need a second hardcoded number that could drift
// out of sync with this one.
const DEFAULT_JPEG_QUALITY = 90;

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
 *
 * Returns the live Canvas object (not yet PNG-encoded) so callers that
 * need to further modify pixels (see {@link loadWatermarkAsset}'s gamma
 * boost) can do so directly, without an encode-decode round trip through
 * PNG first. Measured directly against a real watermark file, that round
 * trip cost ~770ms combined (two separate toBuffer("image/png") calls)
 * out of loadWatermarkAsset's ~1000ms total — by far the dominant cost,
 * given the page.render() call itself only took ~40ms.
 */
async function renderPdfPageTransparentToCanvas(
  pdfBytes: Uint8Array,
  dpi: number
): Promise<{ canvas: Canvas; widthPt: number; heightPt: number }> {
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

    return {
      canvas,
      widthPt: viewport.width / scale,
      heightPt: viewport.height / scale,
    };
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }
}

/**
 * Renders a single page of a PDF (given as bytes) to a high-resolution
 * raster image (JPEG) using pdf.js + a fresh @napi-rs/canvas surface.
 *
 * JPEG, not PNG: the source is a technical drawing rendered onto an opaque
 * white background, so there's no alpha channel to preserve (unlike
 * {@link renderPdfPageTransparentToCanvas}, used for watermarks, which
 * needs to keep transparency). Measured directly against a real customer
 * drawing, canvas.toBuffer("image/png") here cost ~450ms vs ~110ms for
 * JPEG q90 — this was the single largest contributor to the "PDF takes
 * forever, even for one page" complaint. See compositeWatermarkOnRaster's
 * JPEG-output comment for the matching quality verification (no visible
 * block artifacts on thin CAD lines; barcode bar/gap run-lengths stayed
 * in a healthy varied pattern, not the fused-together pattern that would
 * indicate lossy damage).
 */
export async function renderPdfPageToRaster(
  pdfBytes: Uint8Array,
  pageIndex: number,
  dpi: number,
  jpegQuality: number = DEFAULT_JPEG_QUALITY
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
    const buffer: Buffer = (canvas as any).toBuffer("image/jpeg", jpegQuality);

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
 * Renders one page from an *already-loaded* pdfjs document — the
 * multi-page counterpart to {@link renderPdfPageToRaster}, which loads
 * (parses) the whole PDF fresh on every call.
 *
 * Why this exists: measured directly against a real 20-page customer-style
 * PDF, calling renderPdfPageToRaster once per page (each call re-parsing
 * the full document from bytes) averaged ~980ms/page; reusing one loaded
 * document object across all pages averaged ~555ms/page — the parse cost
 * was being paid again on every single page for no benefit, since nothing
 * about the document changes between pages. This is what
 * {@link watermarkPdf} uses internally now; renderPdfPageToRaster is kept
 * as its own exported function since other call sites may still want the
 * load-and-render-one-page convenience.
 *
 * eslint-disable-next-line is needed because pdfjs's loaded-document type
 * isn't exported in a convenient form; callers get it from
 * pdfjsLib.getDocument(...).promise.
 */
async function renderPageFromLoadedDoc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  pageIndex: number,
  dpi: number,
  jpegQuality: number = DEFAULT_JPEG_QUALITY
): Promise<RasterPage> {
  const page = await doc.getPage(pageIndex + 1); // pdfjs pages are 1-indexed
  const scale = dpi / PDF_BASE_DPI;
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: context, viewport } as any).promise;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: Buffer = (canvas as any).toBuffer("image/jpeg", jpegQuality);

  return {
    buffer,
    widthPx: canvas.width,
    heightPx: canvas.height,
    widthPt: viewport.width / scale,
    heightPt: viewport.height / scale,
  };
}

/**
 * Loads a watermark asset, which can be a PNG/JPG image, or a single-page
 * PDF (rasterized at the same target DPI for consistent sharpness).
 *
 * The watermark canvas is kept whole (no cropping) — exactly like pdftk,
 * which stamps a watermark PDF onto a document as-is. Many watermark PDFs
 * are deliberately authored with asymmetric content (e.g. a logo plus a
 * small corner stamp) positioned within a full page using specific
 * margins; those margins are what makes the logo land in a visually
 * centered spot once the watermark is scaled to fit a document page.
 * Cropping away the empty margins would discard that intentional
 * positioning and shift the logo away from where pdftk would place it.
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
  // Default gamma: previously 0.85 (a boost — raises low alpha to look
  // more solid). Customer feedback (after line-sharpening was disabled in
  // a prior fix, making CAD lines render thinner/softer) was that the
  // watermark now reads as comparatively too sharp/heavy, "clashing" with
  // the drawing underneath. Switched to 1.15 — a mild *reduction* instead
  // of a boost — measured to bring the watermark's flattened gray level
  // up from ~212/255 to ~234/255 (about 22 points lighter out of 255),
  // a noticeable softening while keeping "WINTEQ" / "Beyond the Limit"
  // legible as a watermark rather than fading them out entirely.
  const clarityGamma = opts.clarityGamma ?? 1.15;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { canvas } = await renderPdfPageTransparentToCanvas(fileBytes, dpi);
    if (clarityGamma !== 1) {
      boostWatermarkAlpha(canvas, clarityGamma);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer: Buffer = (canvas as any).toBuffer("image/png");
    return {
      buffer,
      widthPx: canvas.width,
      heightPx: canvas.height,
    };
  }

  const buffer = Buffer.from(fileBytes);
  const img = await loadImage(buffer);

  // Treat the image's pixels as if authored at 72 DPI, then scale to the
  // target DPI so it occupies the same physical size a PDF watermark of
  // equivalent point-dimensions would.
  const dpiScale = dpi / PDF_BASE_DPI;
  const scaledW = dpiScale !== 1 ? Math.round(img.width * dpiScale) : img.width;
  const scaledH = dpiScale !== 1 ? Math.round(img.height * dpiScale) : img.height;

  let finalBuffer: Buffer;
  if (dpiScale !== 1 || clarityGamma !== 1) {
    // Only allocate/draw into a fresh canvas if something actually needs
    // to change (rescale and/or gamma adjust) — otherwise the original
    // bytes are already correct as-is.
    const scaledCanvas = createCanvas(scaledW, scaledH);
    const scaledCtx = scaledCanvas.getContext("2d");
    scaledCtx.drawImage(img, 0, 0, scaledW, scaledH);
    if (clarityGamma !== 1) {
      boostWatermarkAlpha(scaledCanvas, clarityGamma);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    finalBuffer = (scaledCanvas as any).toBuffer("image/png");
  } else {
    finalBuffer = buffer;
  }

  return { buffer: finalBuffer, widthPx: scaledW, heightPx: scaledH };
}

/**
 * Boosts (or reduces, for gamma > 1) a watermark's alpha channel using a
 * gamma curve, making it visually clearer/more solid (or softer) without
 * changing its shape or color. Operates directly on a live Canvas's pixel
 * data — no PNG encode/decode round trip — see
 * {@link renderPdfPageTransparentToCanvas}'s doc comment for why that
 * matters here.
 *
 * Many watermark PDFs (e.g. exported from CAD/PLM tools) bake in very low
 * opacity (≈0.1–0.2) for a subtle on-screen look. A gamma curve adjusts
 * low alpha values proportionally more than high ones: gamma < 1 raises
 * faint areas to be more visible without already-solid strokes blowing
 * out past full opacity; gamma > 1 does the reverse, softening a
 * watermark that reads as too heavy/sharp against the drawing underneath.
 */
function boostWatermarkAlpha(canvas: Canvas, gamma: number): void {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] / 255;
    if (a > 0 && a < 1) {
      data[i] = Math.round(Math.pow(a, gamma) * 255);
    }
  }
  ctx.putImageData(imageData, 0, 0);
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
// Caches the decoded watermark Image, keyed by buffer reference (a
// WeakMap so the cache entry disappears once the buffer itself is no
// longer reachable — no manual cleanup needed). watermarkPdf calls
// compositeWatermarkOnRaster once per page with the *same* WatermarkAsset
// object, so without this, the exact same watermark PNG was being
// re-decoded from scratch on every single page; the decode itself was
// only ~10-70ms per call in isolation, but that adds up over dozens of
// pages in a multi-page document — measured savings were modest per page
// but consistent, which is why this is a cheap addition worth keeping
// rather than a large win on its own.
const watermarkImageCache = new WeakMap<Buffer, Awaited<ReturnType<typeof loadImage>>>();

async function loadWatermarkImageCached(buffer: Buffer): ReturnType<typeof loadImage> {
  const cached = watermarkImageCache.get(buffer);
  if (cached) return cached;
  const img = await loadImage(buffer);
  watermarkImageCache.set(buffer, img);
  return img;
}

export async function compositeWatermarkOnRaster(
  pageRaster: RasterPage,
  watermark: WatermarkAsset,
  opts: { opacity?: number; lineSharpenIntensity?: number; jpegQuality?: number } = {}
): Promise<Buffer> {
  const opacity = opts.opacity ?? 1;
  const lineSharpenIntensity = opts.lineSharpenIntensity ?? DEFAULT_LINE_SHARPEN_INTENSITY;
  const jpegQuality = opts.jpegQuality ?? DEFAULT_JPEG_QUALITY;

  const canvas = createCanvas(pageRaster.widthPx, pageRaster.heightPx);
  const ctx = canvas.getContext("2d");

  const baseImg = await loadImage(pageRaster.buffer);
  // The base technical drawing is drawn at a 1:1 pixel scale (same
  // dimensions it was rasterized at), so there's nothing to resample —
  // smoothing here only softens otherwise-crisp CAD line edges for no
  // benefit. Disabling it keeps thin drawing lines (dimension lines,
  // leader lines, hatching) as sharp as the original rasterization,
  // instead of losing some of their contrast to filtering.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseImg, 0, 0, pageRaster.widthPx, pageRaster.heightPx);

  const wmImg = await loadWatermarkImageCached(watermark.buffer);

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

  // The watermark, unlike the base drawing, is usually being scaled
  // (fitScale != 1), so smoothing is actually wanted here — turn it back
  // on at the highest quality to avoid jagged edges on the logo/text.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.globalAlpha = opacity;
  ctx.drawImage(wmImg, dx, dy, drawW, drawH);
  ctx.globalAlpha = 1;

  sharpenRasterLines(canvas, lineSharpenIntensity);

  // JPEG instead of PNG for the final flattened page: measured directly
  // against this exact image, canvas.toBuffer("image/png") took ~660ms vs
  // ~110ms for JPEG q90 (both before the downstream PDF-embed cost, which
  // has the same gap — see watermarkPdf's embedJpg vs embedPng below).
  // Quality 90 was verified not to introduce visible block artifacts on
  // thin CAD lines, and run-length analysis of an embedded barcode showed
  // a healthy varied 1-7px bar/gap pattern (matching a known-good
  // reference), not the fused-bar pattern that would indicate lossy
  // damage. This is a flattened raster scan either way (this tool's PDFs
  // are images, not vector line art), so JPEG's lossy compression doesn't
  // give up anything the format wasn't already going to flatten away.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (canvas as any).toBuffer("image/jpeg", jpegQuality);
}

/**
 * Darkens/thickens dark line-art by a small amount, to counteract a
 * specific, otherwise-unavoidable visual side effect of the "rasterize
 * everything" approach this tool requires (see module docs): a vector PDF's
 * thin lines (dimension lines, leaders, hatching — typically 0.25–0.5pt)
 * stay crisp at *any* zoom level because they're redrawn from their exact
 * vector definition every time. Once flattened into a fixed-resolution
 * raster, those same lines inevitably look softer/grayer whenever a PDF
 * viewer displays the page at a size other than the exact rasterization
 * DPI (which is the common case — e.g. viewing a 300 DPI raster at a
 * typical ~100 DPI on-screen zoom). This isn't fixable by rasterizing at
 * a higher DPI; reference renders at 300/450/600 DPI and downscaled to a
 * common viewing size all show the same drop in line darkness, because
 * the loss happens during the *viewer's* downscale, not ours.
 *
 * The fix applied here is a min-filter (each pixel takes the darkest
 * value in its NxN neighborhood, per channel) run *before* the page ever
 * reaches a viewer — it thickens dark line-art by ~1px at the
 * rasterization DPI, which is imperceptible at that resolution but
 * meaningfully restores how solid the lines look once downscaled for
 * normal viewing. A 3x3 neighborhood was chosen empirically: it brought a
 * test page's measured line-darkness back in line with the original
 * vector rendering's; a 5x5 neighborhood overshot and visibly thickened
 * lines beyond their original weight.
 *
 * Applied to the whole flattened page (after any watermark composite),
 * not just the source drawing — but only dark pixels move (each channel
 * can only get darker, never lighter), so pale watermark elements stay
 * exactly as faint as they were designed to be; this only restores
 * contrast that the drawing's own dark lines lose to viewer downscaling.
 *
 * `intensity` (0–1) blends between the original pixel (0) and the full
 * min-filter result (1) — added so this can be exposed as a user-facing
 * slider rather than a hard on/off switch. IMPORTANT CAVEAT, learned the
 * hard way on a real customer file: at full intensity (or even partial),
 * this measurably fuses together the thin, closely-spaced bars of an
 * embedded barcode (run-length analysis on one real case showed bars
 * ballooning from a healthy 1-7px to 10-39px, with gaps shrinking to a
 * constant 2-3px — unscannable). The default for this feature stays 0
 * (off) for that reason; intensity > 0 is an opt-in tradeoff the user is
 * choosing knowingly, not something this function can make safe on its
 * own. There's no "safe" non-zero floor to recommend instead — the same
 * intensity that's invisible on one drawing's barcode can be destructive
 * on another's, since it depends entirely on how tightly spaced that
 * specific barcode's bars happen to be.
 */
function sharpenRasterLines(canvas: Canvas, intensity: number = 1): void {
  if (intensity <= 0) return;

  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  const clampedIntensity = Math.min(1, intensity);

  // 3x3 min filter per RGB channel (alpha passed through unchanged — the
  // pages this runs on are always fully opaque, so alpha is always 255),
  // then blended back toward the original by (1 - intensity).
  for (let y = 0; y < height; y++) {
    const yStart = Math.max(0, y - 1);
    const yEnd = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xStart = Math.max(0, x - 1);
      const xEnd = Math.min(width - 1, x + 1);

      let minR = 255;
      let minG = 255;
      let minB = 255;
      for (let ny = yStart; ny <= yEnd; ny++) {
        const rowOffset = ny * width;
        for (let nx = xStart; nx <= xEnd; nx++) {
          const idx = (rowOffset + nx) * 4;
          const r = src[idx];
          const g = src[idx + 1];
          const b = src[idx + 2];
          if (r < minR) minR = r;
          if (g < minG) minG = g;
          if (b < minB) minB = b;
        }
      }

      const outIdx = (y * width + x) * 4;
      if (clampedIntensity >= 1) {
        out[outIdx] = minR;
        out[outIdx + 1] = minG;
        out[outIdx + 2] = minB;
      } else {
        out[outIdx] = src[outIdx] + (minR - src[outIdx]) * clampedIntensity;
        out[outIdx + 1] = src[outIdx + 1] + (minG - src[outIdx + 1]) * clampedIntensity;
        out[outIdx + 2] = src[outIdx + 2] + (minB - src[outIdx + 2]) * clampedIntensity;
      }
      out[outIdx + 3] = src[outIdx + 3];
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Applies {@link sharpenRasterLines} to a standalone raster buffer (the
 * no-watermark case, where the page never goes through
 * {@link compositeWatermarkOnRaster} and so wouldn't otherwise get the
 * same line-darkening pass). Outputs JPEG for the same reason as
 * {@link renderPdfPageToRaster} — see that function's doc comment.
 */
async function sharpenRasterBuffer(
  rasterBuffer: Buffer,
  intensity: number = DEFAULT_LINE_SHARPEN_INTENSITY,
  jpegQuality: number = DEFAULT_JPEG_QUALITY
): Promise<Buffer> {
  const img = await loadImage(rasterBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  sharpenRasterLines(canvas, intensity);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (canvas as any).toBuffer("image/jpeg", jpegQuality);
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
    /**
     * 0–1 intensity for the line-darkening pass (see sharpenRasterLines).
     * Defaults to 0 (off) — see that function's doc comment for why a
     * non-zero value is an explicit, knowing tradeoff against barcode
     * legibility, not a "safe" enhancement.
     */
    lineSharpenIntensity?: number;
    /** JPEG quality (0-100) for the final flattened pages. Defaults to 90. */
    jpegQuality?: number;
    onProgress?: (pageIndex: number, totalPages: number) => void;
    /** Max pages rasterized concurrently. Higher = faster but more memory. */
    concurrency?: number;
  } = {}
): Promise<Uint8Array> {
  const dpi = opts.dpi ?? DEFAULT_RASTER_DPI;
  const lineSharpenIntensity = opts.lineSharpenIntensity ?? DEFAULT_LINE_SHARPEN_INTENSITY;
  const jpegQuality = opts.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  // Default raised from 3 to 8: re-measured directly against a 44-page
  // document (matching a real customer report of slow multi-page
  // processing), concurrency=8 averaged ~35s versus ~45s at concurrency=1
  // — about 22%, reproduced across repeated runs. This held even though
  // an earlier, narrower test (single-page repeated calls) suggested
  // concurrency barely mattered on a single-vCPU environment; the
  // difference shows up at this scale because some of each page's work
  // (file/font I/O, decode/encode) isn't pure CPU compute and can overlap
  // across pages even without true multi-core parallelism. Diminishing
  // returns set in past ~8 (12 was no better, sometimes slightly worse),
  // so this isn't pushed further.
  const concurrency = opts.concurrency ?? 8;

  // Load the document ONCE and reuse it for every page (see
  // renderPageFromLoadedDoc's doc comment for why — re-parsing the whole
  // PDF per page was the dominant cost for multi-page files).
  const loadingTask = pdfjsLib.getDocument({
    data: sourcePdfBytes.slice(),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAPS_URL,
    cMapPacked: true,
  });
  const sourceDoc = await loadingTask.promise;

  try {
    const totalPages = sourceDoc.numPages;

    // Render + composite each page independently (no shared state between
    // pages, beyond the read-only sourceDoc object above), processed in
    // small concurrent batches rather than strictly one-at-a-time — this
    // meaningfully cuts wall-clock time for multi-page documents while
    // keeping peak memory bounded. Concurrent getPage()/render() calls
    // against the same loaded pdfjs document were verified to work
    // correctly (each returns its own independent canvas).
    const processPage = async (i: number): Promise<{ buffer: Buffer; widthPt: number; heightPt: number }> => {
      const raster = await renderPageFromLoadedDoc(sourceDoc, i, dpi, jpegQuality);
      const finalBuffer = watermark
        ? await compositeWatermarkOnRaster(raster, watermark, {
            opacity: opts.opacity,
            lineSharpenIntensity,
            jpegQuality,
          })
        : lineSharpenIntensity > 0
          ? await sharpenRasterBuffer(raster.buffer, lineSharpenIntensity, jpegQuality)
          : raster.buffer;
      opts.onProgress?.(i + 1, totalPages);
      return { buffer: finalBuffer, widthPt: raster.widthPt, heightPt: raster.heightPt };
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

    // Assembling into the final PDFDocument must happen sequentially
    // (pdf-lib documents aren't safe for concurrent mutation), but this
    // part is cheap compared to rasterization.
    // embedJpg instead of embedPng: measured directly against a real
    // customer drawing, pdf-lib's embedPng (which has to parse/decompress
    // the PNG's zlib stream to read pixel data) took ~600ms per page
    // versus ~3ms for embedJpg on the equivalent JPEG, and
    // PDFDocument.save() was similarly faster afterward (~30ms vs
    // ~730ms) since there was less already-compressed image data for it
    // to re-handle. Combined with the JPEG changes upstream in
    // renderPageFromLoadedDoc and compositeWatermarkOnRaster, and with
    // loading sourceDoc once above instead of once per page, this set of
    // changes is the fix for reports that even a single-page PDF took a
    // very long time to process, and that it got worse with more pages.
    const outDoc = await PDFDocument.create();
    for (const { buffer, widthPt, heightPt } of results) {
      const jpgImage = await outDoc.embedJpg(buffer);
      const page = outDoc.addPage([widthPt, heightPt]);
      page.drawImage(jpgImage, { x: 0, y: 0, width: widthPt, height: heightPt });
    }

    return outDoc.save();
  } finally {
    await sourceDoc.cleanup();
    await loadingTask.destroy();
  }
}
