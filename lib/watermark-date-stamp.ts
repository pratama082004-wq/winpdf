import { PDFDict, PDFDocument, PDFName, PDFPage, StandardFonts, rgb } from "pdf-lib";

/**
 * Auto-stamps today's date onto a blank WINTEQ watermark template, mimicking
 * what the customer currently does by hand every day in iLovePDF.
 *
 * Background (see project context): the customer has exactly 3 watermark
 * templates — "User" (purple stamp only) and "Controlled" / "Uncontrolled"
 * (purple stamp + an additional orange stamp with a "DATE :" field). Every
 * day they manually type today's date next to "K&DM WINTEQ" on the purple
 * stamp, and — for Controlled/Uncontrolled only — also next to "DATE :" on
 * the orange stamp. This module does that automatically.
 *
 * Coordinates below were measured directly off the 3 reference PDFs
 * (page size 841 x 595pt, i.e. A3 landscape) supplied by the customer:
 *  - The purple stamp's "K&DM WINTEQ" text sits at the same spot in all 3
 *    templates, so one coordinate pair covers all of them.
 *  - The orange stamp is a *raster image* (not text), and its placement
 *    rect differs slightly between Controlled and Uncontrolled, so each
 *    needed its own calibration (done by sampling pixel positions of the
 *    "DATE :" text inside the embedded image, then mapping pixel -> PDF
 *    point coordinates via the image's placement rect).
 */

// ---- Geometry, calibrated against the 3 reference templates ----
// All Y coordinates are in pdf-lib's bottom-left-origin space.
const TEMPLATE_PAGE_WIDTH_PT = 841;
const TEMPLATE_PAGE_HEIGHT_PT = 595;

// Purple stamp: position is identical across all 3 templates.
// Measured top-based y of the "K&DM WINTEQ" text baseline: 488.96
// (top-based, from page top) -> convert to bottom-based: pageHeight - y
const PURPLE_DATE_X = 174.43 + 2; // a couple points right of "WINTEQ"
// Nudged up 3pt from the raw "K&DM WINTEQ" baseline (488.96): at 14pt,
// Helvetica numerals extend visibly below their own baseline (descender
// space numerals don't normally use, but font metrics still reserve it),
// which was enough to make the date clip into the stamp box's bottom
// border / the table row directly below it on real drawings. Verified
// against an actual flagged PDF that this 3pt margin clears the border.
const PURPLE_DATE_BASELINE_Y = TEMPLATE_PAGE_HEIGHT_PT - (488.96 - 3);
// Calibrated against a real customer example: the date text reads as
// roughly 1.5x the cap-height of the "K&DM WINTEQ" line next to it
// (which has a measured bbox height of ~9pt), not a flat 36pt — 36pt
// was based on a misreading of the customer's "font size 36" as PDF
// points, but it's ~4x too large relative to the surrounding stamp text
// and overflows badly once stamped on a real drawing (where dense
// content sits right next to/below the stamp, unlike an empty test page).
const PURPLE_FONT_SIZE = 14;

// Orange stamp: differs between Controlled and Uncontrolled because the
// embedded raster image's placement rect (and thus its internal scale)
// differs slightly between the two files.
type OrangeCoord = { x: number; baselineYTopBased: number };
const ORANGE_DATE_BY_KIND: Record<"controlled" | "uncontrolled", OrangeCoord> = {
  controlled: { x: 72.99 + 1, baselineYTopBased: 553.45 + 1.5 },
  uncontrolled: { x: 64.35 + 3, baselineYTopBased: 561.27 + 1 },
};
// Same calibration approach as the purple stamp: measured the "DATE :"
// label's own text height inside the embedded raster image (in PDF pt,
// via the image's placement scale), then applied the same ~1.5x ratio
// used for the purple stamp. This works out to roughly 5pt — much
// smaller than the originally-assumed 14pt, which was sized to almost
// exactly fill the DATE row's full height with no margin, causing the
// text to bleed into the row above/below once on a real (non-blank) page.
const ORANGE_FONT_SIZE = 5;

// Stamped text color: sampled directly from a customer-provided example of
// the finished result. The date reads as a neutral mid-gray (not tinted
// purple or orange), which matches black text rendered at low opacity
// rather than a tinted color — this is what "saturasi 25%" turned out to
// mean in practice once compared against a real example.
const DATE_TEXT_COLOR = rgb(0, 0, 0);
const DATE_TEXT_OPACITY = 0.25;

export type WatermarkKind = "user" | "controlled" | "uncontrolled" | "unknown";

/**
 * Formats a Date as DD.MM.YYYY, matching the customer's manual convention
 * (e.g. 22.06.2026).
 */
export function formatStampDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Detects which of the 3 watermark templates a file is, using the file
 * name first (fast, usually reliable) and falling back to inspecting the
 * PDF's actual structure if the name is ambiguous.
 *
 * Structural fallback rationale: in all 3 customer templates the page is
 * ~A3 landscape (841x595pt) and the only structural difference is image
 * count — the purple stamp is always 1 image, and Controlled/Uncontrolled
 * each add a 2nd image for the orange stamp. This is a deliberately loose
 * heuristic (count-based, not pixel-matching) so it still works if the
 * customer's template changes slightly later; if the page doesn't even
 * look like one of these templates, we report "unknown" and the caller
 * leaves the watermark untouched.
 */
export async function detectWatermarkKind(
  pdfBytes: Uint8Array<ArrayBuffer>,
  fileName: string
): Promise<WatermarkKind> {
  const lower = fileName.toLowerCase();
  if (lower.includes("uncontrolled")) return "uncontrolled";
  if (lower.includes("controlled")) return "controlled";
  if (lower.includes("user")) return "user";

  // Fallback: inspect the PDF itself.
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const page = doc.getPage(0);
    const { width, height } = page.getSize();

    // Loose tolerance: must look roughly like the A3-landscape template.
    const looksLikeTemplate =
      Math.abs(width - TEMPLATE_PAGE_WIDTH_PT) < 60 &&
      Math.abs(height - TEMPLATE_PAGE_HEIGHT_PT) < 60;
    if (!looksLikeTemplate) return "unknown";

    const imageCount = countPageImages(page);
    if (imageCount >= 2) {
      // Can't tell controlled vs uncontrolled from structure alone, but
      // it doesn't matter — both are stamped identically (purple + orange
      // date), so defaulting to "controlled" here is functionally correct
      // either way.
      return "controlled";
    }
    if (imageCount === 1) return "user";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Counts XObject entries directly referenced by a page's /Resources dict.
 * Both reference templates only ever put Image XObjects there (no
 * Form XObjects), so a simple key count is a reliable enough proxy for
 * "how many images are on this page" without needing to walk into each
 * XObject's /Subtype.
 */
function countPageImages(page: PDFPage): number {
  try {
    const resources = page.node.Resources();
    const xobjectRef = resources?.get(PDFName.of("XObject"));
    if (!xobjectRef) return 0;
    const xobjectDict = page.node.context.lookup(xobjectRef, PDFDict);
    return xobjectDict.keys().length;
  } catch {
    return 0;
  }
}

/**
 * Stamps today's date onto a blank watermark PDF, choosing where (and how
 * many places) to stamp based on the detected template kind.
 *
 * Returns the original bytes unchanged if the file doesn't look like one
 * of the 3 known templates ("unknown") — better to leave a watermark the
 * system doesn't recognize alone than to guess and stamp it somewhere wrong.
 */
export async function stampDateOnWatermark(
  pdfBytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  opts: { date?: Date } = {}
): Promise<{ bytes: Uint8Array<ArrayBuffer>; kind: WatermarkKind; dateText: string }> {
  const kind = await detectWatermarkKind(pdfBytes, fileName);
  const dateText = formatStampDate(opts.date ?? new Date());

  if (kind === "unknown") {
    return { bytes: pdfBytes, kind, dateText };
  }

  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPage(0);
  const { height: pageHeight } = page.getSize();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Purple stamp date — present on every known template kind.
  // Scale the calibrated coordinates if this page isn't exactly the
  // reference 841x595pt size (keeps things working for minor template
  // resizes without needing new calibration).
  const scaleX = page.getWidth() / TEMPLATE_PAGE_WIDTH_PT;
  const scaleY = pageHeight / TEMPLATE_PAGE_HEIGHT_PT;

  page.drawText(dateText, {
    x: PURPLE_DATE_X * scaleX,
    y: PURPLE_DATE_BASELINE_Y * scaleY,
    size: PURPLE_FONT_SIZE * Math.min(scaleX, scaleY),
    font,
    color: DATE_TEXT_COLOR,
    opacity: DATE_TEXT_OPACITY,
  });

  // Orange stamp date — Controlled and Uncontrolled only.
  if (kind === "controlled" || kind === "uncontrolled") {
    const coord = ORANGE_DATE_BY_KIND[kind];
    const baselineYBottomBased = (TEMPLATE_PAGE_HEIGHT_PT - coord.baselineYTopBased) * scaleY;
    page.drawText(dateText, {
      x: coord.x * scaleX,
      y: baselineYBottomBased,
      size: ORANGE_FONT_SIZE * Math.min(scaleX, scaleY),
      font,
      color: DATE_TEXT_COLOR,
      opacity: DATE_TEXT_OPACITY,
    });
  }

  // pdf-lib's save() returns Uint8Array<ArrayBufferLike> (it can't rule out
  // a SharedArrayBuffer-backed view at the type level), but in practice
  // it always allocates a plain ArrayBuffer here. Re-wrapping keeps the
  // return type as plain Uint8Array<ArrayBuffer>, matching pdfBytes'
  // type above and avoiding a type mismatch for callers.
  const saved = await doc.save();
  const bytes = new Uint8Array(saved);
  return { bytes, kind, dateText };
}
