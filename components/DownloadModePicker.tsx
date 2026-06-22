"use client";

export type DownloadMode = "separate" | "zip";

type Props = {
  value: DownloadMode;
  onChange: (mode: DownloadMode) => void;
  disabled?: boolean;
};

export default function DownloadModePicker({ value, onChange, disabled }: Props) {
  return (
    <div style={{ display: "flex", gap: "1.5rem" }}>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: disabled ? "default" : "pointer",
          fontSize: "0.9rem",
          color: "var(--ink)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          type="radio"
          name="downloadMode"
          checked={value === "separate"}
          onChange={() => onChange("separate")}
          disabled={disabled}
          style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
        />
        Unduh Terpisah
      </label>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: disabled ? "default" : "pointer",
          fontSize: "0.9rem",
          color: "var(--ink)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          type="radio"
          name="downloadMode"
          checked={value === "zip"}
          onChange={() => onChange("zip")}
          disabled={disabled}
          style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
        />
        Jadikan 1 ZIP
      </label>
    </div>
  );
}
