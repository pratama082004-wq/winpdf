"use client";

import { ADJUSTMENT_RANGES, AdjustmentParams, DEFAULT_ADJUSTMENT_PARAMS } from "@/lib/adjustment-params";

type Props = {
  value: AdjustmentParams;
  onChange: (value: AdjustmentParams) => void;
  disabled?: boolean;
};

type SliderRowProps = {
  label: string;
  hint?: string;
  warning?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function SliderRow({ label, hint, warning, value, min, max, step, unit, disabled, onChange }: SliderRowProps) {
  return (
    <div style={{ marginBottom: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem" }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)" }}>{label}</label>
        <span style={{ fontSize: "0.82rem", color: "var(--ink-faint)", fontFamily: "monospace" }}>
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: "var(--accent)",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      />
      {hint && (
        <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", marginTop: "0.2rem" }}>{hint}</p>
      )}
      {warning && value !== 0 && (
        <p style={{ fontSize: "0.75rem", color: "#b45309", marginTop: "0.2rem", display: "flex", gap: "0.3rem" }}>
          <span>⚠️</span>
          <span>{warning}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Slider panel for the adjustment params (opacity, watermark clarity,
 * line-sharpen intensity, JPEG quality). Defaults always match
 * DEFAULT_ADJUSTMENT_PARAMS (from lib/adjustment-params.ts, the same
 * source of truth the server falls back to), so a fresh session — or
 * hitting "Kembalikan ke Default" — reproduces exactly the settings
 * that were already tuned and approved, with no drift between what the
 * UI shows as default and what the server actually does when a param is
 * omitted.
 */
export default function AdjustmentPanel({ value, onChange, disabled }: Props) {
  const isDefault =
    value.opacity === DEFAULT_ADJUSTMENT_PARAMS.opacity &&
    value.clarityGamma === DEFAULT_ADJUSTMENT_PARAMS.clarityGamma &&
    value.lineSharpenIntensity === DEFAULT_ADJUSTMENT_PARAMS.lineSharpenIntensity &&
    value.jpegQuality === DEFAULT_ADJUSTMENT_PARAMS.jpegQuality;

  function set<K extends keyof AdjustmentParams>(key: K, v: number) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-faint)" }}>
          Setelan default sudah dioptimalkan — ubah hanya jika perlu.
        </p>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_ADJUSTMENT_PARAMS)}
          disabled={disabled || isDefault}
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: isDefault ? "var(--ink-faint)" : "var(--accent)",
            background: "none",
            border: "none",
            cursor: disabled || isDefault ? "default" : "pointer",
            whiteSpace: "nowrap",
            padding: "0.2rem 0.3rem",
          }}
        >
          Kembalikan ke Default
        </button>
      </div>

      <SliderRow
        label="Opacity Watermark"
        hint="Seberapa terlihat watermark WINTEQ di atas gambar."
        value={value.opacity}
        min={ADJUSTMENT_RANGES.opacity.min}
        max={ADJUSTMENT_RANGES.opacity.max}
        step={ADJUSTMENT_RANGES.opacity.step}
        unit="%"
        disabled={disabled}
        onChange={(v) => set("opacity", v)}
      />

      <SliderRow
        label="Ketajaman / Kontras Watermark"
        hint="Geser ke kiri = watermark lebih pudar/halus. Ke kanan = lebih solid/tajam."
        value={value.clarityGamma}
        min={ADJUSTMENT_RANGES.clarityGamma.min}
        max={ADJUSTMENT_RANGES.clarityGamma.max}
        step={ADJUSTMENT_RANGES.clarityGamma.step}
        disabled={disabled}
        onChange={(v) => set("clarityGamma", v)}
      />

      <SliderRow
        label="Ketebalan Garis CAD"
        hint="Menebalkan garis gambar teknik agar lebih jelas saat di-zoom out."
        warning="Bisa membuat barcode pada drawing jadi tidak terbaca jika di atas ~30%. Naikkan dengan hati-hati dan cek hasil scan barcode-nya."
        value={value.lineSharpenIntensity}
        min={ADJUSTMENT_RANGES.lineSharpenIntensity.min}
        max={ADJUSTMENT_RANGES.lineSharpenIntensity.max}
        step={ADJUSTMENT_RANGES.lineSharpenIntensity.step}
        unit="%"
        disabled={disabled}
        onChange={(v) => set("lineSharpenIntensity", v)}
      />

      <SliderRow
        label="Kualitas Kompresi (JPEG)"
        hint="Lebih tinggi = lebih jernih tapi file lebih besar dan proses lebih lambat."
        value={value.jpegQuality}
        min={ADJUSTMENT_RANGES.jpegQuality.min}
        max={ADJUSTMENT_RANGES.jpegQuality.max}
        step={ADJUSTMENT_RANGES.jpegQuality.step}
        disabled={disabled}
        onChange={(v) => set("jpegQuality", v)}
      />
    </div>
  );
}
