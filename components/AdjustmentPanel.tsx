"use client";

import { useEffect, useRef, useState } from "react";
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

function clampToRange(raw: number, min: number, max: number, step: number): number {
  if (Number.isNaN(raw)) return min;
  const clamped = Math.min(max, Math.max(min, raw));
  // Snap to the same step granularity the slider uses, so a typed value
  // and a dragged value can never disagree on what's a "valid" number.
  const snapped = Math.round(clamped / step) * step;
  // Round-trip through a fixed precision to avoid float artifacts like
  // 0.1 + 0.2 = 0.30000000000000004 showing up in the input box.
  return Math.round(snapped * 100) / 100;
}

function SliderRow({ label, hint, warning, value, min, max, step, unit, disabled, onChange }: SliderRowProps) {
  // The text box needs its own draft string, separate from the committed
  // numeric `value` — otherwise every keystroke would immediately re-clamp
  // mid-typing (e.g. typing "90" would clamp the intermediate "9" against
  // a min of 60 and snap it to 60 before the second digit ever lands).
  // Committing (clamp + propagate via onChange) only happens on blur or
  // Enter, matching how a typical numeric input field behaves elsewhere.
  const [draft, setDraft] = useState(String(value));

  // The number starts as plain text (matching the slider's read-only
  // feel) and only becomes an editable box after a single click —
  // customer-requested, since an always-visible input box read as a
  // form field competing with the slider rather than a value label.
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when `value` changes from outside this input
  // (slider drag, "Kembalikan ke Default", or another field's change
  // triggering a parent re-render) — but only while not actively
  // editing, so an external update never clobbers what's being typed.
  // This follows React's documented "adjust state during render"
  // pattern (storing the last-seen value alongside the derived state,
  // compared during render) rather than an effect-based setState, which
  // would cost an extra cascading render — and rather than a ref, which
  // React's stricter lint rules now flag as unsafe to read during render.
  const [syncedValue, setSyncedValue] = useState(value);
  if (!isEditing && syncedValue !== value) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  // Autofocus + select-all the moment the box appears, so the very next
  // keystroke replaces the whole number instead of editing one digit in
  // place (clicking "68" and typing "90" should overwrite, not append).
  // This one stays an effect on purpose — focusing a DOM node is exactly
  // the "synchronize with an external system" case effects are for.
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function commit() {
    const parsed = Number(draft);
    const next = clampToRange(parsed, min, max, step);
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div style={{ marginBottom: "1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem" }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)" }}>{label}</label>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          {isEditing ? (
            <input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              min={min}
              max={max}
              step={step}
              value={draft}
              disabled={disabled}
              className="adjustment-value-input"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                commit();
                setIsEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setDraft(String(value));
                  setIsEditing(false);
                }
              }}
              style={{
                width: "3.6rem",
                fontSize: "0.82rem",
                color: "var(--accent)",
                fontWeight: 600,
                fontFamily: "monospace",
                textAlign: "right",
                background: "var(--card-bg)",
                border: "1px solid var(--accent)",
                boxShadow: "0 0 0 3px rgba(37, 84, 199, 0.15)",
                borderRadius: "0.4rem",
                padding: "0.1rem 0.35rem",
                opacity: disabled ? 0.5 : 1,
                transition: "box-shadow 0.15s ease",
              }}
            />
          ) : (
            <span
              role="button"
              tabIndex={disabled ? -1 : 0}
              title="Klik untuk ketik angka langsung"
              onClick={() => {
                if (!disabled) setIsEditing(true);
              }}
              onKeyDown={(e) => {
                if (!disabled && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  setIsEditing(true);
                }
              }}
              style={{
                width: "3.6rem",
                fontSize: "0.82rem",
                color: "var(--ink-faint)",
                fontFamily: "monospace",
                textAlign: "right",
                padding: "0.1rem 0.35rem",
                borderRadius: "0.4rem",
                border: "1px solid transparent",
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? "default" : "text",
                userSelect: "none",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!disabled) e.currentTarget.style.background = "var(--page-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {draft}
            </span>
          )}
          {unit && (
            <span style={{ fontSize: "0.82rem", color: "var(--ink-faint)", fontFamily: "monospace" }}>{unit}</span>
          )}
        </div>
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
    value.clarity === DEFAULT_ADJUSTMENT_PARAMS.clarity &&
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
        value={value.clarity}
        min={ADJUSTMENT_RANGES.clarity.min}
        max={ADJUSTMENT_RANGES.clarity.max}
        step={ADJUSTMENT_RANGES.clarity.step}
        unit="%"
        disabled={disabled}
        onChange={(v) => set("clarity", v)}
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
