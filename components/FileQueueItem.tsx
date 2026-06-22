"use client";

import { formatBytes, type WatermarkJob } from "@/lib/client-utils";

type Props = {
  job: WatermarkJob;
  onRemove: (id: string) => void;
  onDownload: (job: WatermarkJob) => void;
};

function StatusBadge({ job }: { job: WatermarkJob }) {
  switch (job.status) {
    case "queued":
      return (
        <span
          style={{
            fontFamily: "var(--font-tech)",
            fontSize: "0.7rem",
            color: "var(--ink-faint)",
            border: "1px solid var(--line)",
            borderRadius: "2px",
            padding: "0.2rem 0.5rem",
            letterSpacing: "0.02em",
          }}
        >
          menunggu
        </span>
      );
    case "processing":
      return (
        <span
          style={{
            fontFamily: "var(--font-tech)",
            fontSize: "0.7rem",
            color: "var(--stamp)",
            border: "1px solid var(--stamp)",
            borderRadius: "2px",
            padding: "0.2rem 0.5rem",
            letterSpacing: "0.02em",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--stamp)",
              display: "inline-block",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
          memproses
        </span>
      );
    case "done":
      return (
        <span
          style={{
            fontFamily: "var(--font-tech)",
            fontSize: "0.7rem",
            color: "var(--ok)",
            border: "1px solid var(--ok)",
            background: "var(--ok-soft)",
            borderRadius: "2px",
            padding: "0.2rem 0.5rem",
            letterSpacing: "0.02em",
          }}
        >
          selesai
        </span>
      );
    case "error":
      return (
        <span
          style={{
            fontFamily: "var(--font-tech)",
            fontSize: "0.7rem",
            color: "var(--stamp)",
            border: "1px solid var(--stamp)",
            background: "var(--stamp-soft)",
            borderRadius: "2px",
            padding: "0.2rem 0.5rem",
            letterSpacing: "0.02em",
          }}
        >
          gagal
        </span>
      );
  }
}

export default function FileQueueItem({ job, onRemove, onDownload }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.9rem",
        padding: "0.85rem 1rem",
        background: "var(--paper-raised)",
        border: "1px solid var(--line)",
        borderRadius: "2px",
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        style={{ color: "var(--ink-faint)", flexShrink: 0 }}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontFamily: "var(--font-tech)",
            fontSize: "0.825rem",
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {job.file.name}
        </p>
        <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", marginTop: "0.15rem" }}>
          {formatBytes(job.file.size)}
          {job.status === "error" && job.errorMessage ? (
            <span style={{ color: "var(--stamp)" }}> — {job.errorMessage}</span>
          ) : null}
        </p>
      </div>

      <StatusBadge job={job} />

      {job.status === "done" ? (
        <button
          onClick={() => onDownload(job)}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--paper-raised)",
            background: "var(--ink)",
            border: "none",
            borderRadius: "2px",
            padding: "0.45rem 0.75rem",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Unduh
        </button>
      ) : (
        <button
          onClick={() => onRemove(job.id)}
          aria-label="Hapus berkas"
          disabled={job.status === "processing"}
          style={{
            fontSize: "0.8rem",
            color: "var(--ink-faint)",
            background: "none",
            border: "none",
            cursor: job.status === "processing" ? "default" : "pointer",
            padding: "0.35rem",
            flexShrink: 0,
            opacity: job.status === "processing" ? 0.4 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
