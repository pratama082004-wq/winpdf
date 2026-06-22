"use client";

import { useCallback, useRef, useState } from "react";
import PdfDropzone from "@/components/PdfDropzone";
import WatermarkPicker from "@/components/WatermarkPicker";
import FileQueueItem from "@/components/FileQueueItem";
import type { WatermarkJob } from "@/lib/client-utils";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `job-${idCounter}-${Date.now()}`;
}

export default function Home() {
  const [jobs, setJobs] = useState<WatermarkJob[]>([]);
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);
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

  function downloadJob(job: WatermarkJob) {
    if (!job.resultBlob) return;
    const url = URL.createObjectURL(job.resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = job.resultName ?? `${job.file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    const doneJobs = jobs.filter((j) => j.status === "done" && j.resultBlob);
    for (const job of doneJobs) {
      downloadJob(job);
      // small delay so the browser doesn't block multiple simultaneous downloads
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function processQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);

    // Snapshot current queued jobs at start; process strictly sequentially
    // so the server isn't hit with many heavy rasterization requests at once.
    const queuedIds = jobs.filter((j) => j.status === "queued").map((j) => j.id);

    for (const id of queuedIds) {
      const job = jobs.find((j) => j.id === id);
      if (!job) continue;

      setJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, status: "processing" } : j))
      );

      try {
        const formData = new FormData();
        formData.append("file", job.file);
        if (watermarkFile) formData.append("watermark", watermarkFile);

        const res = await fetch("/api/watermark", {
          method: "POST",
          body: formData,
        });

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

        setJobs((prev) =>
          prev.map((j) =>
            j.id === id ? { ...j, status: "done", resultBlob: blob, resultName } : j
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal memproses berkas.";
        setJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, status: "error", errorMessage: message } : j))
        );
      }
    }

    runningRef.current = false;
    setIsRunning(false);
  }

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const doneCount = jobs.filter((j) => j.status === "done").length;
  const hasJobs = jobs.length > 0;

  return (
    <div className="flex flex-col flex-1" style={{ background: "var(--paper)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--line)",
          padding: "1.1rem 1.5rem",
        }}
      >
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1.5px solid var(--stamp)",
              color: "var(--stamp)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "0.95rem",
              flexShrink: 0,
            }}
          >
            M
          </div>
          <div>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "1.05rem",
                color: "var(--ink)",
                lineHeight: 1.1,
              }}
            >
              Materai
            </p>
            <p style={{ fontSize: "0.7rem", color: "var(--ink-faint)", letterSpacing: "0.02em" }}>
              watermark pdf permanen
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        <div style={{ marginBottom: "2.25rem" }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: "1.65rem",
              color: "var(--ink)",
              marginBottom: "0.5rem",
              lineHeight: 1.25,
            }}
          >
            Bubuhkan watermark yang tidak bisa lepas dari dokumen
          </h1>
          <p style={{ fontSize: "0.95rem", color: "var(--ink-soft)", maxWidth: "38rem" }}>
            Setiap halaman dirender ulang pada 300 DPI lalu disatukan dengan watermark
            menjadi satu gambar utuh — sehingga saat dikonversi ke Word sekalipun,
            watermark tetap menempel pada dokumen.
          </p>
        </div>

        <div style={{ marginBottom: "1.75rem" }}>
          <PdfDropzone onFilesAdded={addFiles} />
        </div>

        <section style={{ marginBottom: "1.75rem" }}>
          <p
            style={{
              fontFamily: "var(--font-tech)",
              fontSize: "0.72rem",
              color: "var(--ink-faint)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: "0.6rem",
            }}
          >
            Berkas watermark (opsional)
          </p>
          <WatermarkPicker watermarkFile={watermarkFile} onChange={setWatermarkFile} />
          <p style={{ fontSize: "0.8rem", color: "var(--ink-faint)", marginTop: "0.5rem" }}>
            Tanpa berkas watermark, dokumen akan diproses ulang (dirasterisasi) saja —
            cocok untuk dokumen yang sudah ada watermark dan hanya perlu dikunci.
          </p>
        </section>

        {hasJobs && (
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-tech)",
                  fontSize: "0.72rem",
                  color: "var(--ink-faint)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Antrian — {jobs.length} berkas
              </p>

              <div style={{ display: "flex", gap: "0.6rem" }}>
                {doneCount > 1 && (
                  <button
                    onClick={downloadAll}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: "var(--ink)",
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: "2px",
                      padding: "0.45rem 0.75rem",
                      cursor: "pointer",
                    }}
                  >
                    Unduh semua
                  </button>
                )}
                {queuedCount > 0 && (
                  <button
                    onClick={processQueue}
                    disabled={isRunning}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: "var(--paper-raised)",
                      background: isRunning ? "var(--ink-faint)" : "var(--stamp)",
                      border: "none",
                      borderRadius: "2px",
                      padding: "0.45rem 0.9rem",
                      cursor: isRunning ? "default" : "pointer",
                    }}
                  >
                    {isRunning
                      ? "Memproses\u2026"
                      : `Proses ${queuedCount} berkas`}
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {jobs.map((job) => (
                <FileQueueItem
                  key={job.id}
                  job={job}
                  onRemove={removeJob}
                  onDownload={downloadJob}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer
        style={{
          borderTop: "1px solid var(--line)",
          padding: "1.1rem 1.5rem",
        }}
      >
        <p
          style={{
            maxWidth: "48rem",
            margin: "0 auto",
            fontSize: "0.75rem",
            color: "var(--ink-faint)",
            textAlign: "center",
          }}
        >
          Proses dilakukan di server pada saat permintaan; berkas tidak disimpan permanen.
        </p>
      </footer>
    </div>
  );
}
