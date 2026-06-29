"use client";

import { useState } from "react";
import Link from "next/link";
import PdfTargetDropzone from "@/components/PdfTargetDropzone";
import type { WatermarkJob } from "@/lib/client-utils";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `protect-job-${idCounter}-${Date.now()}`;
}

export default function ProtectPdfPage() {
  const [jobs, setJobs] = useState<WatermarkJob[]>([]);
  const [userPassword, setUserPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOwnerPassword, setShowOwnerPassword] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function addFiles(files: File[]) {
    // Single-purpose tool: protecting a batch with one shared password
    // doesn't need the multi-job queue UI Lock Watermark uses — keep it
    // to the most recently dropped file so the form below stays simple.
    const file = files[files.length - 1];
    setJobs([{ id: nextId(), file, status: "queued" }]);
  }

  function removeJob(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  const job = jobs[0] ?? null;
  const passwordsMatch = userPassword === confirmPassword;
  const canSubmit =
    !!job &&
    !isRunning &&
    userPassword.length >= 4 &&
    passwordsMatch &&
    job.status !== "processing";

  async function handleProtect() {
    if (!job || !canSubmit) return;
    setFormError(null);
    setIsRunning(true);
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "processing" } : j)));

    try {
      const formData = new FormData();
      formData.append("file", job.file);
      formData.append("userPassword", userPassword);
      if (showOwnerPassword && ownerPassword) {
        formData.append("ownerPassword", ownerPassword);
      }

      const res = await fetch("/api/protect-pdf", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Gagal memproses PDF.");
      }

      const blob = await res.blob();
      const outName = job.file.name.replace(/\.pdf$/i, "") + "-protected.pdf";

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id ? { ...j, status: "done", resultBlob: blob, resultName: outName } : j
        )
      );
      triggerDownload(blob, outName);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memproses PDF.";
      setFormError(message);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "error", errorMessage: message } : j))
      );
    } finally {
      setIsRunning(false);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isDone = job?.status === "done";

  // Once a file has already been protected, the button re-downloads the
  // blob already held in state — no point re-encrypting unchanged input
  // with an unchanged password just because the person clicked again
  // (e.g. their browser blocked the first automatic download).
  function handleButtonClick() {
    if (isDone && job?.resultBlob && job.resultName) {
      triggerDownload(job.resultBlob, job.resultName);
    } else {
      handleProtect();
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
          Lock Watermark
        </Link>

        <h1 style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.4rem" }}>
          Protect PDF
        </h1>
        <p style={{ fontSize: "0.95rem", color: "var(--ink-faint)", marginBottom: "1.75rem" }}>
          Tambahkan password agar PDF hanya bisa dibuka oleh yang berhak.
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
            2. Buat Password
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            <div>
              <label style={{ fontSize: "0.82rem", color: "var(--ink-soft)", display: "block", marginBottom: "0.3rem" }}>
                Password (minimal 4 karakter)
              </label>
              <input
                type="password"
                value={userPassword}
                disabled={isRunning}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="Masukkan password"
                style={{
                  width: "100%",
                  padding: "0.6rem 0.75rem",
                  fontSize: "0.9rem",
                  border: "1px solid var(--line)",
                  borderRadius: "8px",
                  background: "var(--card-bg)",
                  color: "var(--ink)",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.82rem", color: "var(--ink-soft)", display: "block", marginBottom: "0.3rem" }}>
                Ulangi password
              </label>
              <input
                type="password"
                value={confirmPassword}
                disabled={isRunning}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ulangi password yang sama"
                style={{
                  width: "100%",
                  padding: "0.6rem 0.75rem",
                  fontSize: "0.9rem",
                  border: `1px solid ${!passwordsMatch && confirmPassword ? "#d9362f" : "var(--line)"}`,
                  borderRadius: "8px",
                  background: "var(--card-bg)",
                  color: "var(--ink)",
                }}
              />
              {!passwordsMatch && confirmPassword && (
                <p style={{ fontSize: "0.78rem", color: "#d9362f", marginTop: "0.3rem" }}>
                  Password tidak sama.
                </p>
              )}
            </div>

            <button
              onClick={() => setShowOwnerPassword((v) => !v)}
              disabled={isRunning}
              style={{
                alignSelf: "flex-start",
                fontSize: "0.8rem",
                color: "var(--accent)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0.2rem 0",
              }}
            >
              {showOwnerPassword ? "Sembunyikan opsi lanjutan" : "+ Password pemilik (opsional)"}
            </button>

            {showOwnerPassword && (
              <div>
                <label style={{ fontSize: "0.82rem", color: "var(--ink-soft)", display: "block", marginBottom: "0.3rem" }}>
                  Password pemilik
                </label>
                <input
                  type="password"
                  value={ownerPassword}
                  disabled={isRunning}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="Kosongkan jika tidak perlu berbeda"
                  style={{
                    width: "100%",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.9rem",
                    border: "1px solid var(--line)",
                    borderRadius: "8px",
                    background: "var(--card-bg)",
                    color: "var(--ink)",
                  }}
                />
                <p style={{ fontSize: "0.78rem", color: "var(--ink-faint)", marginTop: "0.3rem" }}>
                  Password ini terpisah dari password pembuka di atas — biasanya untuk kebutuhan administratif. Boleh dikosongkan.
                </p>
              </div>
            )}
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
          {isRunning ? "Memproses…" : isDone ? "Unduh Lagi" : "Lindungi & Download"}
        </button>
      </div>

      <p style={{ marginTop: "1.5rem", fontSize: "0.78rem", color: "var(--ink-faint)", textAlign: "center" }}>
        Proses dilakukan di server saat permintaan; berkas tidak disimpan permanen.
      </p>
    </div>
  );
}
