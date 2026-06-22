"use client";

import { useRef, useState } from "react";
import { formatBytes } from "@/lib/client-utils";

type Props = {
  watermarkFile: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
};

export default function WatermarkDropzone({ watermarkFile, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function setFile(file: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (file && file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
    onChange(file);
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || disabled) return;
    const f = fileList[0];
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImage = f.type.startsWith("image/");
    if (isPdf || isImage) setFile(f);
  }

  if (watermarkFile) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem",
          background: "var(--card-bg)",
          border: "1px solid var(--line)",
          borderRadius: "12px",
        }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Pratinjau watermark"
            style={{
              width: 48,
              height: 48,
              objectFit: "contain",
              background:
                "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 10px 10px",
              border: "1px solid var(--line)",
              borderRadius: "8px",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--wm-zone-bg)",
              border: "1px solid var(--wm-zone-border)",
              borderRadius: "8px",
              color: "var(--wm-zone-text)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {watermarkFile.name}
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)" }}>
            {formatBytes(watermarkFile.size)}
          </p>
        </div>
        {!disabled && (
          <button
            onClick={() => setFile(null)}
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--wm-zone-text)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.35rem 0.5rem",
              flexShrink: 0,
            }}
          >
            Hapus
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) inputRef.current?.click();
      }}
      className="select-none"
      style={{
        cursor: disabled ? "default" : "pointer",
        border: `1.5px dashed ${isDragging ? "var(--wm-zone-text)" : "var(--wm-zone-border)"}`,
        borderRadius: "12px",
        background: "var(--wm-zone-bg)",
        padding: "1.75rem 1.5rem",
        textAlign: "center",
        transition: "border-color 120ms ease",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p style={{ fontWeight: 700, fontSize: "1rem", color: "var(--wm-zone-text)", marginBottom: "0.3rem" }}>
        Drag & drop atau klik
      </p>
      <p style={{ fontSize: "0.85rem", color: "var(--wm-zone-subtext)" }}>
        PDF, PNG, atau JPG — opsional
      </p>
    </div>
  );
}
