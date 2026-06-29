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
  /**
   * Watermark clarity/sharpness, 0-100. Higher = more solid/visible,
   * lower = softer/fainter — same "higher number, more effect" direction
   * as every other slider here. This is NOT the raw gamma value the
   * server's boostWatermarkAlpha actually uses (gamma works the opposite
   * way: gamma>1 *softens*, gamma<1 *boosts* — mathematically correct but
   * backwards from what a slider moving right should feel like). Convert
   * with {@link clarityToGamma} at the point where a real gamma number is
   * needed, rather than storing gamma directly here — see that function's
   * comment for the full story of why this distinction exists.
   */
  clarity: number;
  /** CAD line-darkening intensity, 0-100 (%). 0 = off (default, safest for barcodes). */
  lineSharpenIntensity: number;
  /** Final JPEG quality, 0-100. */
  jpegQuality: number;
};

// The actual gamma range the clarity slider maps to. Chosen (same values
// as before this was a 0-100 slider) to stay well clear of values that
// would make the watermark either fully invisible (very high gamma) or
// fully opaque/blown out (very low gamma) — within this range the
// watermark stays visually recognizable as a watermark at every point on
// the slider. Declared before DEFAULT_ADJUSTMENT_PARAMS below since that
// object's `clarity` field is derived from these via gammaToClarity —
// module-level `const`s aren't hoisted the way function declarations are,
// so the order here matters (this was the source of a real
// ReferenceError caught while testing this change, not just a style
// preference).
const MIN_GAMMA = 0.5; // clarity = 100 (sharpest)
const MAX_GAMMA = 2.5; // clarity = 0 (softest)

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a user-facing clarity value (0-100, higher = sharper) to the
 * actual gamma value lib/pdf-watermark.ts's boostWatermarkAlpha expects.
 *
 * Why this conversion exists: a customer reported that dragging the
 * "Ketajaman / Kontras Watermark" slider to the right made the watermark
 * *fade out* instead of getting sharper — backwards from the hint text
 * next to it ("Ke kanan = lebih solid/tajam") and from every other
 * slider on the panel, where higher = more effect. The root cause was
 * that the slider's value WAS the raw gamma (0.5-2.5) being sent straight
 * to boostWatermarkAlpha, where the math runs the other way: gamma>1
 * raises a power >1 on an already-fractional alpha, which shrinks it
 * (more gamma = fainter), while gamma<1 does the reverse. That's correct
 * for the function's own purpose (it can boost OR soften depending on
 * which side of 1.0 gamma lands on) but is the opposite of "drag right
 * for more" once exposed directly as a slider value. This function is
 * the single place that flips the direction, so every other piece of
 * code that means "gamma" still gets a real gamma, while the slider/state
 * everywhere else only ever deals in the user-facing 0-100 "clarity"
 * scale, consistent with opacity/sharpen/quality.
 */
export function clarityToGamma(clarity: number): number {
  const t = clamp01(clarity / 100);
  return MAX_GAMMA + (MIN_GAMMA - MAX_GAMMA) * t;
}

/** Inverse of {@link clarityToGamma}, used only to derive the default. */
function gammaToClarity(gamma: number): number {
  const t = (gamma - MAX_GAMMA) / (MIN_GAMMA - MAX_GAMMA);
  return Math.round(clamp01(t) * 100);
}

export const DEFAULT_ADJUSTMENT_PARAMS: AdjustmentParams = {
  opacity: 100,
  // Corresponds to gamma 1.15 (the library's own previous flat default)
  // by construction — derived via gammaToClarity rather than picking a
  // round number like 50 and hoping it happens to line up.
  clarity: gammaToClarity(1.15),
  lineSharpenIntensity: 0,
  jpegQuality: 90,
};

export const ADJUSTMENT_RANGES = {
  opacity: { min: 0, max: 100, step: 1 },
  clarity: { min: 0, max: 100, step: 1 },
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
    clarity: clamp(
      num("clarity", DEFAULT_ADJUSTMENT_PARAMS.clarity),
      ADJUSTMENT_RANGES.clarity.min,
      ADJUSTMENT_RANGES.clarity.max
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
