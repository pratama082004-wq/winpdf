import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { DEFAULT_RASTER_DPI, loadWatermarkAsset, watermarkPdf } from "@/lib/pdf-watermark";
import { stampDateOnWatermark } from "@/lib/watermark-date-stamp";
import { clarityToGamma, parseAdjustmentParamsFromFormData } from "@/lib/adjustment-params";

// Allow this route to run as long as Vercel's plan permits, since
// rasterizing many files/pages can take a while.
export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Batch counterpart to /api/watermark: accepts MULTIPLE target PDFs (all
 * under the "file" field) plus a single shared watermark, and returns one
 * ZIP containing every watermarked result.
 *
 * Why this exists: when stamping the same watermark onto many files, the
 * single-file endpoint redundantly repeats the watermark-side work
 * (loading the watermark PDF, auto-stamping today's date onto it,
 * rasterizing it, gamma-adjusting it) once per file, even though that
 * work produces an identical result every time for a given watermark +
 * date. Measured directly, that watermark setup cost ~600ms-1.5s by
 * itself — for 10 files that's up to ~15s being spent redoing literally
 * the same thing 10 times. This endpoint does it once and reuses the
 * resulting WatermarkAsset for every file's rasterize-and-composite
 * pass, which is the part that's genuinely different per file and can't
 * be shared.
 *
 * Target PDFs are still rasterized concurrently with each other (bounded
 * by CONCURRENCY below, same rationale as watermarkPdf's own per-page
 * concurrency: enough to use available CPU without unbounded memory use
 * if someone uploads a large batch).
 */

const CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);
    const watermarkFile = formData.get("watermark");
    const params = parseAdjustmentParamsFromFormData(formData);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada file PDF yang ditemukan." },
        { status: 400 }
      );
    }

    let watermarkAsset = null;
    if (watermarkFile && watermarkFile instanceof File && watermarkFile.size > 0) {
      let wmBytes = new Uint8Array(await watermarkFile.arrayBuffer());

      // Auto-stamp today's date once, exactly like the single-file route —
      // see that route's comment for the full rationale. Done once here
      // instead of once per file, since the stamped result is identical
      // for every file in this batch (same watermark, same date).
      const isPdfWatermark =
        watermarkFile.type === "application/pdf" ||
        watermarkFile.name.toLowerCase().endsWith(".pdf");
      if (isPdfWatermark) {
        const stamped = await stampDateOnWatermark(wmBytes, watermarkFile.name);
        wmBytes = stamped.bytes;
      }

      // Loaded ONCE for the whole batch — this is the rasterized,
      // gamma-adjusted watermark asset reused for every file below.
      watermarkAsset = await loadWatermarkAsset(wmBytes, watermarkFile.name, DEFAULT_RASTER_DPI, {
        clarityGamma: clarityToGamma(params.clarity),
      });
    }

    const results: { name: string; bytes: Uint8Array; error?: string }[] = new Array(files.length);

    const processOne = async (index: number) => {
      const file = files[index];
      const outName = file.name.replace(/\.pdf$/i, "") + "-watermarked.pdf";
      try {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const resultBytes = await watermarkPdf(sourceBytes, watermarkAsset, {
          dpi: DEFAULT_RASTER_DPI,
          opacity: params.opacity / 100,
          lineSharpenIntensity: params.lineSharpenIntensity / 100,
          jpegQuality: params.jpegQuality,
        });
        results[index] = { name: outName, bytes: resultBytes };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal memproses berkas.";
        results[index] = { name: outName, bytes: new Uint8Array(), error: message };
      }
    };

    for (let batchStart = 0; batchStart < files.length; batchStart += CONCURRENCY) {
      const batchEnd = Math.min(batchStart + CONCURRENCY, files.length);
      await Promise.all(
        Array.from({ length: batchEnd - batchStart }, (_, k) => processOne(batchStart + k))
      );
    }

    const zip = new JSZip();
    const usedNames = new Set<string>();
    const failures: { name: string; error: string }[] = [];

    for (const result of results) {
      if (result.error) {
        failures.push({ name: result.name, error: result.error });
        continue;
      }
      let name = result.name;
      if (usedNames.has(name)) {
        const base = name.replace(/\.pdf$/i, "");
        let suffix = 2;
        while (usedNames.has(`${base} (${suffix}).pdf`)) suffix += 1;
        name = `${base} (${suffix}).pdf`;
      }
      usedNames.add(name);
      zip.file(name, result.bytes);
    }

    if (failures.length > 0) {
      zip.file(
        "_errors.txt",
        failures.map((f) => `${f.name}: ${f.error}`).join("\n")
      );
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="lock-watermark-hasil.zip"`,
        // Lets the client show a per-batch summary even though the
        // response itself is just a zip blob.
        "X-Batch-Total": String(files.length),
        "X-Batch-Failed": String(failures.length),
      },
    });
  } catch (err) {
    console.error("Batch watermark processing error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Gagal memproses batch PDF: ${message}` },
      { status: 500 }
    );
  }
}
