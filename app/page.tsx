"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";
import PdfTargetDropzone from "@/components/PdfTargetDropzone";
import WatermarkDropzone from "@/components/WatermarkDropzone";
import DownloadModePicker, { type DownloadMode } from "@/components/DownloadModePicker";
import type { WatermarkJob } from "@/lib/client-utils";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `job-${idCounter}-${Date.now()}`;
}

export default function Home() {
  const [jobs, setJobs] = useState<WatermarkJob[]>([]);
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);
  const [downloadMode, setDownloadMode] = useState<DownloadMode>("separate");
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const addFiles = useCallback((files: File[]) => {
    setJobs((prev) => [
      ...prev,
      ...files.map((file) => ({ id: nextId(), file, status: "queued" as const })),
    ]);
  }, []);

  function removeJob(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  function clearAllJobs() {
    setJobs([]);
  }

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadAsZip(doneJobs: WatermarkJob[]) {
    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const job of doneJobs) {
      if (!job.resultBlob) continue;
      let name = job.resultName ?? `${job.file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`;
      if (usedNames.has(name)) {
        const base = name.replace(/\.pdf$/i, "");
        let suffix = 2;
        while (usedNames.has(`${base} (${suffix}).pdf`)) suffix += 1;
        name = `${base} (${suffix}).pdf`;
      }
      usedNames.add(name);
      zip.file(name, job.resultBlob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerDownload(zipBlob, "lock-watermark-hasil.zip");
  }

  async function downloadSeparately(doneJobs: WatermarkJob[]) {
    for (const job of doneJobs) {
      if (!job.resultBlob) continue;
      const name = job.resultName ?? `${job.file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`;
      triggerDownload(job.resultBlob, name);
      // small delay so the browser doesn't block multiple simultaneous downloads
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function processAndDownload() {
    if (runningRef.current || jobs.length === 0) return;
    runningRef.current = true;
    setIsRunning(true);

    const targetIds = jobs.filter((j) => j.status === "queued" || j.status === "error").map((j) => j.id);

    const finishedJobs: WatermarkJob[] = [];

    for (const id of targetIds) {
      const job = jobs.find((j) => j.id === id);
      if (!job) continue;

      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "processing" } : j)));

      try {
        const formData = new FormData();
        formData.append("file", job.file);
        if (watermarkFile) formData.append("watermark", watermarkFile);

        const res = await fetch("/api/watermark", { method: "POST", body: formData });

        if (!res.ok) {
          let message = "Terjadi kesalahan pada server.";
          try {
            const data = await res.json();
            message = data.error ?? message;
          } catch {
            // ignore parse error, keep default message
          }
          throw new Error(message);
        }

        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const match = disposition.match(/filename="(.+)"/);
        const resultName = match?.[1] ?? `${job.file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`;

        const updatedJob: WatermarkJob = { ...job, status: "done", resultBlob: blob, resultName };
        finishedJobs.push(updatedJob);
        setJobs((prev) => prev.map((j) => (j.id === id ? updatedJob : j)));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal memproses berkas.";
        setJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, status: "error", errorMessage: message } : j))
        );
      }
    }

    // Also include any jobs that were already done from a previous run.
    const alreadyDone = jobs.filter((j) => j.status === "done" && j.resultBlob);
    const allDone = [...alreadyDone, ...finishedJobs];

    if (allDone.length > 0) {
      if (downloadMode === "zip") {
        await downloadAsZip(allDone);
      } else {
        await downloadSeparately(allDone);
      }
    }

    runningRef.current = false;
    setIsRunning(false);
  }

  const hasJobs = jobs.length > 0;
  const allJobsHandled = jobs.length > 0 && jobs.every((j) => j.status === "done");
  const canSubmit = hasJobs && !isRunning;

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
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.4rem" }}>
          Lock Watermark
        </h1>
        <p style={{ fontSize: "0.95rem", color: "var(--ink-faint)", marginBottom: "1.75rem" }}>
          Watermark + rasterize PDF. 100% Anti-Convert.
        </p>

        <section style={{ marginBottom: "1.75rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.7rem",
            }}
          >
            <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)" }}>
              1. PDF Gambar Teknik
            </p>
            {hasJobs && !isRunning && (
              <button
                onClick={clearAllJobs}
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "var(--ink-faint)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0.2rem 0.3rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 2.64-6.36" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Kosongkan
              </button>
            )}
          </div>
          <PdfTargetDropzone
            jobs={jobs}
            onFilesAdded={addFiles}
            onRemove={removeJob}
            disabled={isRunning}
          />
        </section>

        <section style={{ marginBottom: "1.75rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)", marginBottom: "0.7rem" }}>
            2. PDF Watermark
          </p>
          <WatermarkDropzone watermarkFile={watermarkFile} onChange={setWatermarkFile} disabled={isRunning} />
        </section>

        <section style={{ marginBottom: "1.75rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)", marginBottom: "0.7rem" }}>
            3. Opsi Unduhan
          </p>
          <DownloadModePicker value={downloadMode} onChange={setDownloadMode} disabled={isRunning} />
        </section>

        <button
          onClick={processAndDownload}
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
          {isRunning
            ? "Memproses…"
            : allJobsHandled
              ? "Unduh Lagi"
              : "Kunci & Download"}
        </button>
      </div>

      <p style={{ marginTop: "1.5rem", fontSize: "0.78rem", color: "var(--ink-faint)", textAlign: "center" }}>
        Proses dilakukan di server saat permintaan; berkas tidak disimpan permanen.
      </p>
    </div>
  );
}
