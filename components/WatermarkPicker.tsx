"use client";

import { useRef, useState } from "react";
import { formatBytes } from "@/lib/client-utils";

type Props = {
  watermarkFile: File | null;
  onChange: (file: File | null) => void;
};

export default function WatermarkPicker({ watermarkFile, onChange }: Props) {
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
    if (!fileList || fileList.length === 0) return;
    const f = fileList[0];
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isImage = f.type.startsWith("image/");
    if (isPdf || isImage) setFile(f);
  }

  if (watermarkFile) {
    return (
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: "2px",
          background: "var(--paper-raised)",
          padding: "0.85rem 1rem",
          display: "flex",
          alignItems: "center",
          gap: "0.85rem",
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Pratinjau watermark"
            style={{
              width: 44,
              height: 44,
              objectFit: "contain",
              background: "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 10px 10px",
              border: "1px solid var(--line)",
              borderRadius: "2px",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--line)",
              borderRadius: "2px",
              color: "var(--ink-faint)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: "var(--font-tech)",
              fontSize: "0.8rem",
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
        <button
          onClick={() => setFile(null)}
          style={{
            fontSize: "0.8rem",
            color: "var(--stamp)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0.35rem 0.5rem",
            fontFamily: "var(--font-body)",
          }}
        >
          Hapus
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      className="cursor-pointer select-none"
      style={{
        border: `1.5px dashed ${isDragging ? "var(--stamp)" : "var(--line)"}`,
        borderRadius: "2px",
        background: isDragging ? "var(--stamp-soft)" : "transparent",
        padding: "1.1rem 1rem",
        textAlign: "center",
        transition: "border-color 120ms ease, background 120ms ease",
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
      <p style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
        Tempel gambar (PNG/JPG) atau PDF watermark di sini — opsional
      </p>
    </div>
  );
}
