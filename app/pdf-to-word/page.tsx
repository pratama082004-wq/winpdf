"use client";

import { useState } from "react";
import Link from "next/link";
import PdfTargetDropzone from "@/components/PdfTargetDropzone";
import type { WatermarkJob } from "@/lib/client-utils";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `pdf2word-job-${idCounter}-${Date.now()}`;
}

type OcrMode = "auto" | "force" | "off";

// The Python backend service is reached through NEXT_PUBLIC_BACKEND_URL,
// which Vercel injects automatically for Services-based projects (see
// vercel.json's experimentalServices) so preview deployments always
// point at their own matching backend instead of a hardcoded URL. In
// local dev without that env var, fall back to same-origin — `vercel
// dev -L` proxies /api/python/* to the local Python service.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export default function PdfToWordPage() {
  const [jobs, setJobs] = useState<WatermarkJob[]>([]);
  const [ocrMode, setOcrMode] = useState<OcrMode>("auto");
  const [isRunning, setIsRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function addFiles(files: File[]) {
    // One conversion at a time, same reasoning as Protect PDF: the
    // form below (OCR mode choice) applies to a single file, so a
    // multi-file queue would need its own per-file OCR mode UI that
    // isn't worth the complexity for this feature yet.
    const file = files[files.length - 1];
    setJobs([{ id: nextId(), file, status: "queued" }]);
  }

  function removeJob(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const job = jobs[0] ?? null;
  const isDone = job?.status === "done";
  const canSubmit = !!job && !isRunning && job.status !== "processing";

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConvert() {
    if (!job || !canSubmit) return;
    setFormError(null);
    setIsRunning(true);
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "processing" } : j)));

    try {
      const formData = new FormData();
      formData.append("file", job.file);
      formData.append("ocr_mode", ocrMode);

      const res = await fetch(`${BACKEND_URL}/api/python/pdf-to-word`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail ?? "Gagal mengonversi PDF.");
      }

      const blob = await res.blob();
      const outName = job.file.name.replace(/\.pdf$/i, "") + ".docx";

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "done", resultBlob: blob, resultName: outName } : j
        )
      );
      triggerDownload(blob, outName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal mengonversi PDF.";
      setFormError(message);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "error", errorMessage: message } : j))
      );
    } finally {
      setIsRunning(false);
    }
  }

  function handleButtonClick() {
    if (isDone && job?.resultBlob && job.resultName) {
      triggerDownload(job.resultBlob, job.resultName);
    } else {
      handleConvert();
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center" style={{ background: "var(--page-bg)", padding: "2.5rem 1.25rem" }}>
      <div
        style={{
          width: "100%",
          maxWidth: "640px",
          background: "var(--card-bg)",
          borderRadius: "20px",
          padding: "2rem",
          boxShadow: "0 1px 3px rgba(20, 30, 50, 0.06), 0 12px 32px rgba(20, 30, 50, 0.05)",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.8rem",
            color: "var(--ink-faint)",
            textDecoration: "none",
            marginBottom: "1rem",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Semua tools
        </Link>

        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.4rem" }}>
          PDF to Word
        </h1>
        <p style={{ fontSize: "0.95rem", color: "var(--ink-faint)", marginBottom: "1.75rem" }}>
          Ubah PDF jadi dokumen Word yang rapi, lengkap dengan dukungan OCR untuk halaman hasil scan.
        </p>

        <section style={{ marginBottom: "1.75rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)", marginBottom: "0.7rem" }}>
            1. Pilih PDF
          </p>
          <PdfTargetDropzone
            jobs={jobs}
            onFilesAdded={addFiles}
            onRemove={removeJob}
            disabled={isRunning}
          />
        </section>

        <section style={{ marginBottom: "1.75rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)", marginBottom: "0.7rem" }}>
            2. Mode OCR
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <OcrOption
              value="auto"
              selected={ocrMode === "auto"}
              disabled={isRunning}
              onSelect={setOcrMode}
              title="Otomatis (disarankan)"
              description="Halaman yang sudah punya teks dikonversi langsung. Halaman hasil scan dideteksi otomatis dan diproses dengan OCR."
            />
            <OcrOption
              value="force"
              selected={ocrMode === "force"}
              disabled={isRunning}
              onSelect={setOcrMode}
              title="Selalu pakai OCR"
              description="Semua halaman diproses ulang dengan OCR, walaupun sudah punya teks asli. Gunakan jika hasil mode otomatis kurang akurat."
            />
            <OcrOption
              value="off"
              selected={ocrMode === "off"}
              disabled={isRunning}
              onSelect={setOcrMode}
              title="Tanpa OCR"
              description="Hanya mengandalkan teks asli PDF. Halaman hasil scan tidak akan menghasilkan teks yang bisa diedit."
            />
          </div>
        </section>

        {formError && (
          <p style={{ fontSize: "0.85rem", color: "#d9362f", marginBottom: "1rem" }}>{formError}</p>
        )}

        <button
          onClick={handleButtonClick}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "0.85rem",
            borderRadius: "12px",
            border: "none",
            fontSize: "1rem",
            fontWeight: 700,
            color: "#ffffff",
            background: canSubmit ? "var(--accent)" : "var(--disabled-bg)",
            cursor: canSubmit ? "pointer" : "default",
            transition: "background 120ms ease",
          }}
        >
          {isRunning ? "Mengonversi…" : isDone ? "Unduh Lagi" : "Konversi & Download"}
        </button>
      </div>

      <p style={{ marginTop: "1.5rem", fontSize: "0.78rem", color: "var(--ink-faint)", textAlign: "center" }}>
        Proses dilakukan di server saat permintaan; berkas tidak disimpan permanen. Dokumen dengan banyak halaman scan bisa memerlukan waktu lebih lama karena OCR.
      </p>
    </div>
  );
}

function OcrOption({
  value,
  selected,
  disabled,
  onSelect,
  title,
  description,
}: {
  value: OcrMode;
  selected: boolean;
  disabled?: boolean;
  onSelect: (mode: OcrMode) => void;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={() => !disabled && onSelect(value)}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "0.75rem 0.9rem",
        borderRadius: "10px",
        border: `1.5px solid ${selected ? "var(--accent)" : "var(--line)"}`,
        background: selected ? "var(--pdf-zone-bg)" : "var(--card-bg)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: `2px solid ${selected ? "var(--accent)" : "var(--ink-faint)"}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {selected && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
          )}
        </span>
        <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--ink)" }}>{title}</span>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--ink-faint)", margin: "0.35rem 0 0 1.55rem" }}>
        {description}
      </p>
    </button>
  );
}
