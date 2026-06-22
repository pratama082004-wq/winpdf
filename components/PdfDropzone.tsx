"use client";

import { useCallback, useRef, useState } from "react";

type Props = {
  onFilesAdded: (files: File[]) => void;
};

export default function PdfDropzone({ onFilesAdded }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const pdfs = Array.from(fileList).filter(
        (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfs.length > 0) onFilesAdded(pdfs);
    },
    [onFilesAdded]
  );

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
      className="group relative cursor-pointer select-none"
      style={{
        border: `1.5px dashed ${isDragging ? "var(--stamp)" : "var(--line)"}`,
        borderRadius: "2px",
        background: isDragging ? "var(--stamp-soft)" : "var(--paper-raised)",
        padding: "3.5rem 2rem",
        textAlign: "center",
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        style={{ margin: "0 auto 1rem", color: "var(--ink-faint)" }}
      >
        <path
          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <p
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.15rem",
          fontWeight: 600,
          color: "var(--ink)",
          marginBottom: "0.35rem",
        }}
      >
        Letakkan berkas PDF di sini
      </p>
      <p style={{ fontSize: "0.875rem", color: "var(--ink-soft)" }}>
        atau klik untuk memilih — bisa lebih dari satu berkas
      </p>
    </div>
  );
}
