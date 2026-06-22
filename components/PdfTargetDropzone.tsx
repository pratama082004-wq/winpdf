"use client";

import { useRef, useState } from "react";
import { formatBytes, type WatermarkJob } from "@/lib/client-utils";

type Props = {
  jobs: WatermarkJob[];
  onFilesAdded: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
};

function StatusDot({ job }: { job: WatermarkJob }) {
  switch (job.status) {
    case "processing":
      return (
        <span
          aria-label="Memproses"
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid var(--pdf-zone-border)",
            borderTopColor: "var(--pdf-zone-text)",
            display: "inline-block",
            animation: "spin 0.7s linear infinite",
            flexShrink: 0,
          }}
        />
      );
    case "done":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1f9d55" strokeWidth="2.5" style={{ flexShrink: 0 }}>
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "error":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d9362f" strokeWidth="2.5" style={{ flexShrink: 0 }}>
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function PdfTargetDropzone({ jobs, onFilesAdded, onRemove, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || disabled) return;
    const pdfs = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length > 0) onFilesAdded(pdfs);
  }

  return (
    <div>
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
          border: `1.5px dashed ${isDragging ? "var(--pdf-zone-text)" : "var(--pdf-zone-border)"}`,
          borderRadius: "12px",
          background: "var(--pdf-zone-bg)",
          padding: "1.75rem 1.5rem",
          textAlign: "center",
          transition: "border-color 120ms ease",
          opacity: disabled ? 0.7 : 1,
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
        <p style={{ fontWeight: 700, fontSize: "1rem", color: "var(--pdf-zone-text)", marginBottom: "0.3rem" }}>
          Drag & drop atau klik
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--pdf-zone-subtext)" }}>
          PDF, bisa lebih dari 1
        </p>
      </div>

      {jobs.length > 0 && (
        <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {jobs.map((job) => (
            <div
              key={job.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.55rem 0.75rem",
                background: "var(--card-bg)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.6" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {job.file.name}
                </p>
                <p style={{ fontSize: "0.7rem", color: "var(--ink-faint)" }}>
                  {formatBytes(job.file.size)}
                  {job.status === "error" && job.errorMessage ? (
                    <span style={{ color: "#d9362f" }}> — {job.errorMessage}</span>
                  ) : null}
                </p>
              </div>
              <StatusDot job={job} />
              {job.status === "queued" && !disabled && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(job.id);
                  }}
                  aria-label="Hapus berkas"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0.2rem",
                    color: "var(--ink-faint)",
                    flexShrink: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
