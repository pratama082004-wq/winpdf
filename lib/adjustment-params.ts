/**
 * Single source of truth for the user-adjustable watermark/rendering
 * parameters (opacity, clarity/gamma, line-darkening intensity, JPEG
 * quality) — shared between the client (slider defaults + validation
 * before sending a request) and the server routes (parsing + clamping
 * whatever the client sent, since a request body can't be trusted to
 * already be in range).
 *
 * Defaults here MUST match the library's own defaults in
 * lib/pdf-watermark.ts (DEFAULT_RASTER_DPI, DEFAULT_JPEG_QUALITY, etc.)
 * and lib/watermark-date-stamp.ts's clarityGamma default — duplicated
 * here (rather than imported) only because those defaults live inside
 * functions' own `opts.x ?? DEFAULT` fallbacks, not as a single exported
 * object; if you change one, change the other to match.
 */

export type AdjustmentParams = {
  /** Watermark opacity, 0-100 (%). */
  opacity: number;
  /** Watermark clarity/gamma. <1 boosts faint watermarks, >1 softens. */
  clarityGamma: number;
  /** CAD line-darkening intensity, 0-100 (%). 0 = off (default, safest for barcodes). */
  lineSharpenIntensity: number;
  /** Final JPEG quality, 0-100. */
  jpegQuality: number;
};

export const DEFAULT_ADJUSTMENT_PARAMS: AdjustmentParams = {
  opacity: 100,
  clarityGamma: 1.15,
  lineSharpenIntensity: 0,
  jpegQuality: 90,
};

export const ADJUSTMENT_RANGES = {
  opacity: { min: 0, max: 100, step: 1 },
  // Gamma range chosen to stay well clear of values that would make the
  // watermark either fully invisible (very high gamma) or fully opaque/
  // blown out (very low gamma) — within 0.5-2.5 the watermark stays
  // visually recognizable as a watermark at every point on the slider.
  clarityGamma: { min: 0.5, max: 2.5, step: 0.05 },
  lineSharpenIntensity: { min: 0, max: 100, step: 1 },
  // Below ~60 JPEG starts showing visible block artifacts on thin CAD
  // lines; capped there rather than going lower.
  jpegQuality: { min: 60, max: 100, step: 1 },
} as const;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Parses + clamps adjustment params out of a FormData (server-side). Any
 * field that's missing or invalid falls back to the default rather than
 * erroring — adjustments are a nice-to-have, not something a request
 * should fail over.
 */
export function parseAdjustmentParamsFromFormData(formData: FormData): AdjustmentParams {
  const num = (key: string, fallback: number) => {
    const raw = formData.get(key);
    if (typeof raw !== "string" || raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    opacity: clamp(
      num("opacity", DEFAULT_ADJUSTMENT_PARAMS.opacity),
      ADJUSTMENT_RANGES.opacity.min,
      ADJUSTMENT_RANGES.opacity.max
    ),
    clarityGamma: clamp(
      num("clarityGamma", DEFAULT_ADJUSTMENT_PARAMS.clarityGamma),
      ADJUSTMENT_RANGES.clarityGamma.min,
      ADJUSTMENT_RANGES.clarityGamma.max
    ),
    lineSharpenIntensity: clamp(
      num("lineSharpenIntensity", DEFAULT_ADJUSTMENT_PARAMS.lineSharpenIntensity),
      ADJUSTMENT_RANGES.lineSharpenIntensity.min,
      ADJUSTMENT_RANGES.lineSharpenIntensity.max
    ),
    jpegQuality: clamp(
      num("jpegQuality", DEFAULT_ADJUSTMENT_PARAMS.jpegQuality),
      ADJUSTMENT_RANGES.jpegQuality.min,
      ADJUSTMENT_RANGES.jpegQuality.max
    ),
  };
}
