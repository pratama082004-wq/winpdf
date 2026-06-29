"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import JSZip from "jszip";
import PdfTargetDropzone from "@/components/PdfTargetDropzone";
import WatermarkDropzone from "@/components/WatermarkDropzone";
import DownloadModePicker, { type DownloadMode } from "@/components/DownloadModePicker";
import AdjustmentPanel from "@/components/AdjustmentPanel";
import PreviewCanvas from "@/components/PreviewCanvas";
import type { WatermarkJob } from "@/lib/client-utils";
import { DEFAULT_ADJUSTMENT_PARAMS, type AdjustmentParams } from "@/lib/adjustment-params";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `job-${idCounter}-${Date.now()}`;
}

type PreviewData = {
  baseImage: string;
  baseWidthPx: number;
  baseHeightPx: number;
  watermarkImage: string | null;
};

export default function Home() {
  const [jobs, setJobs] = useState<WatermarkJob[]>([]);
  const [watermarkFile, setWatermarkFile] = useState<File | null>(null);
  const [downloadMode, setDownloadMode] = useState<DownloadMode>("separate");
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const [adjustmentParams, setAdjustmentParams] = useState<AdjustmentParams>(DEFAULT_ADJUSTMENT_PARAMS);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Tracks the clarity value the current `preview` was actually fetched
  // with, so a re-fetch is only triggered when clarity itself changes
  // (see the debounced effect below) — opacity/sharpen/quality changes
  // re-render the existing preview entirely client-side and shouldn't
  // trigger a network call.
  const lastFetchedClarityRef = useRef<number | null>(null);

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

  /**
   * Fetches the raw preview materials (base page 1 raster + watermark
   * raster) once for the current first job + watermark file, baked with
   * the given clarity. Re-fetched only when the source file, watermark
   * file, or clarity actually changes — see lastFetchedClarityRef's
   * comment for why clarity specifically needs a server round-trip while
   * the other sliders don't. The server expects the same 0-100 "clarity"
   * scale the slider uses (not raw gamma) and converts internally via
   * clarityToGamma — see that function's doc comment in
   * lib/adjustment-params.ts for why that conversion exists.
   */
  const fetchPreview = useCallback(async (file: File, wmFile: File | null, clarity: number) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (wmFile) formData.append("watermark", wmFile);
      formData.append("clarity", String(clarity));

      const res = await fetch("/api/watermark-preview", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Gagal memuat pratinjau.");
      }
      const data = (await res.json()) as PreviewData;
      setPreview(data);
      lastFetchedClarityRef.current = clarity;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memuat pratinjau.";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Fetch a fresh preview whenever the panel opens, the target file set
  // changes, the watermark changes, or — debounced — clarity moves.
  // Other sliders (opacity, line-sharpen, jpeg quality) deliberately don't
  // appear in this dependency list: they're applied live in PreviewCanvas
  // without touching the network.
  useEffect(() => {
    if (!showAdjustments || jobs.length === 0) return;
    const firstFile = jobs[0].file;

    const handle = setTimeout(() => {
      fetchPreview(firstFile, watermarkFile, adjustmentParams.clarity);
    }, 350);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdjustments, jobs.length > 0 ? jobs[0].id : null, watermarkFile, adjustmentParams.clarity, fetchPreview]);

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

    const finishedJobs: WatermarkJob[] =
      targetIds.length > 1
        ? await processBatch(targetIds)
        : await processSequentially(targetIds);

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

  /** Appends the current adjustment slider values onto a FormData about
   * to be sent to /api/watermark or /api/watermark-batch — keeps both
   * call sites in sync rather than repeating the same 4 .append() calls
   * twice. */
  function appendAdjustmentParams(formData: FormData) {
    formData.append("opacity", String(adjustmentParams.opacity));
    formData.append("clarity", String(adjustmentParams.clarity));
    formData.append("lineSharpenIntensity", String(adjustmentParams.lineSharpenIntensity));
    formData.append("jpegQuality", String(adjustmentParams.jpegQuality));
  }

  /**
   * Single-file path: one request to /api/watermark, returning the
   * watermarked PDF directly. Kept separate from the batch path (rather
   * than always routing through /api/watermark-batch) so the common
   * single-file case gets a plain PDF response back without the overhead
   * of zipping/unzipping a one-entry archive.
   */
  async function processSequentially(targetIds: string[]): Promise<WatermarkJob[]> {
    const finishedJobs: WatermarkJob[] = [];

    for (const id of targetIds) {
      const job = jobs.find((j) => j.id === id);
      if (!job) continue;

      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "processing" } : j)));

      try {
        const formData = new FormData();
        formData.append("file", job.file);
        if (watermarkFile) formData.append("watermark", watermarkFile);
        appendAdjustmentParams(formData);

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

    return finishedJobs;
  }


  /**
   * Multi-file path: ALL target files + the shared watermark go in ONE
   * request to /api/watermark-batch, which loads/stamps the watermark
   * once server-side and reuses it for every file (see that route's doc
   * comment for the full rationale — the watermark setup work is
   * identical across files in a batch, so doing it N times was pure
   * waste). The response is a single ZIP; it's unzipped here back into
   * per-job blobs so the rest of the UI (status badges, the zip/separate
   * download choice) behaves the same as the single-file path.
   *
   * This also fixes what was actually the larger of two compounding
   * problems: the previous implementation fired one fetch per file and
   * awaited each before starting the next, so N files always took N
   * times as long as one file regardless of backend speed — visible in
   * customer reports as files completing one-by-one with a visible gap
   * between each, rather than together.
   */
  async function processBatch(targetIds: string[]): Promise<WatermarkJob[]> {
    const targetJobs = targetIds
      .map((id) => jobs.find((j) => j.id === id))
      .filter((j): j is WatermarkJob => j !== undefined);

    if (targetJobs.length === 0) return [];

    setJobs((prev) =>
      prev.map((j) => (targetIds.includes(j.id) ? { ...j, status: "processing" } : j))
    );

    try {
      const formData = new FormData();
      for (const job of targetJobs) {
        formData.append("file", job.file);
      }
      if (watermarkFile) formData.append("watermark", watermarkFile);
      appendAdjustmentParams(formData);

      const res = await fetch("/api/watermark-batch", { method: "POST", body: formData });

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

      const zipBlob = await res.blob();
      const zip = await JSZip.loadAsync(zipBlob);

      const failedNames = new Set<string>();
      const errorEntry = zip.file("_errors.txt");
      if (errorEntry) {
        const text = await errorEntry.async("string");
        for (const line of text.split("\n")) {
          const name = line.split(":")[0]?.trim();
          if (name) failedNames.add(name);
        }
      }

      const finishedJobs: WatermarkJob[] = [];

      for (const job of targetJobs) {
        const expectedName = `${job.file.name.replace(/\.pdf$/i, "")}-watermarked.pdf`;
        const entry = zip.file(expectedName);

        if (!entry || failedNames.has(expectedName)) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, status: "error", errorMessage: "Gagal memproses berkas." }
                : j
            )
          );
          continue;
        }

        const blob = await entry.async("blob");
        const updatedJob: WatermarkJob = {
          ...job,
          status: "done",
          resultBlob: blob,
          resultName: expectedName,
        };
        finishedJobs.push(updatedJob);
        setJobs((prev) => prev.map((j) => (j.id === job.id ? updatedJob : j)));
      }

      return finishedJobs;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memproses berkas.";
      setJobs((prev) =>
        prev.map((j) =>
          targetIds.includes(j.id) ? { ...j, status: "error", errorMessage: message } : j
        )
      );
      return [];
    }
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
          <button
            type="button"
            onClick={() => setShowAdjustments((v) => !v)}
            disabled={isRunning}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "none",
              border: "none",
              padding: "0.4rem 0",
              cursor: isRunning ? "default" : "pointer",
            }}
          >
            <span style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)" }}>
              3. Pengaturan Lanjutan{" "}
              <span style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--ink-faint)" }}>
                (opsional)
              </span>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                color: "var(--ink-faint)",
                transform: showAdjustments ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 150ms ease",
              }}
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {showAdjustments && (
            <div style={{ marginTop: "1rem" }}>
              {jobs.length > 0 ? (
                <div style={{ marginBottom: "1.25rem" }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)", marginBottom: "0.5rem" }}>
                    Pratinjau (halaman 1 dari &ldquo;{jobs[0].file.name}&rdquo;)
                  </p>
                  {previewError ? (
                    <p style={{ fontSize: "0.82rem", color: "#b91c1c" }}>{previewError}</p>
                  ) : preview ? (
                    <PreviewCanvas
                      baseImageUrl={preview.baseImage}
                      baseWidthPx={preview.baseWidthPx}
                      baseHeightPx={preview.baseHeightPx}
                      watermarkImageUrl={preview.watermarkImage}
                      params={adjustmentParams}
                    />
                  ) : (
                    <div
                      style={{
                        borderRadius: "10px",
                        border: "1px solid var(--line)",
                        padding: "2rem",
                        textAlign: "center",
                        fontSize: "0.82rem",
                        color: "var(--ink-faint)",
                      }}
                    >
                      {previewLoading ? "Memuat pratinjau…" : "Menyiapkan pratinjau…"}
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: "0.82rem", color: "var(--ink-faint)", marginBottom: "1.25rem" }}>
                  Tambahkan PDF gambar teknik di atas untuk melihat pratinjau.
                </p>
              )}

              <AdjustmentPanel
                value={adjustmentParams}
                onChange={setAdjustmentParams}
                disabled={isRunning}
              />
            </div>
          )}
        </section>

        <section style={{ marginBottom: "1.75rem" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 500, color: "var(--ink)", marginBottom: "0.7rem" }}>
            4. Opsi Unduhan
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
