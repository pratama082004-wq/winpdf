import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_RASTER_DPI,
  loadWatermarkAsset,
  renderPdfPageToRaster,
} from "@/lib/pdf-watermark";
import { stampDateOnWatermark } from "@/lib/watermark-date-stamp";
import { clarityToGamma } from "@/lib/adjustment-params";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Returns the raw, un-composited materials for live-previewing the
 * adjustment sliders (opacity, clarity, line-sharpen intensity, JPEG
 * quality): the first page of the target PDF rasterized once, and the
 * watermark rasterized once (with clarity already baked in, since that
 * one has to happen server-side — see below). Both come back as base64
 * data URLs.
 *
 * Why composite client-side instead of re-rendering server-side on every
 * slider tick: re-running the full rasterize pipeline per adjustment
 * would mean a network round-trip plus the same page.render() cost
 * (hundreds of ms, see pdf-watermark.ts's perf comments) for every single
 * slider movement — unusable for a live preview. Once the two raw images
 * are on the client, opacity/line-sharpen/JPEG-quality can all be
 * re-applied instantly with <canvas> (globalAlpha for opacity, a min-filter
 * pass for line-sharpen, canvas.toBlob's quality param for JPEG) without
 * touching the network again.
 *
 * clarity is the one exception baked in here rather than client-side:
 * it's converted to a gamma value (see clarityToGamma) and applied to the
 * watermark's alpha channel before rasterization settles (see
 * boostWatermarkAlpha), and re-deriving that cheaply in the browser would
 * mean either shipping that pixel-loop logic twice (server + client) or
 * sending an unprocessed watermark and asking the client to redo gamma
 * math on every tick — simpler to let the slider's clarity value trigger
 * a fresh (but still cheap, watermark-only) server call, debounced on the
 * client side, while opacity/sharpen/quality — true per-frame sliders —
 * stay fully client-side.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const watermarkFile = formData.get("watermark");
    const clarityRaw = formData.get("clarity");
    const clarity =
      typeof clarityRaw === "string" && clarityRaw.trim() !== "" ? Number(clarityRaw) : undefined;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "File PDF tidak ditemukan." }, { status: 400 });
    }

    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    // Always page 1 — this is a preview, not the real batch job.
    const raster = await renderPdfPageToRaster(sourceBytes, 0, DEFAULT_RASTER_DPI, 90);

    let watermarkDataUrl: string | null = null;
    if (watermarkFile && watermarkFile instanceof File && watermarkFile.size > 0) {
      let wmBytes = new Uint8Array(await watermarkFile.arrayBuffer());

      const isPdfWatermark =
        watermarkFile.type === "application/pdf" ||
        watermarkFile.name.toLowerCase().endsWith(".pdf");
      if (isPdfWatermark) {
        const stamped = await stampDateOnWatermark(wmBytes, watermarkFile.name);
        wmBytes = stamped.bytes;
      }

      const watermarkAsset = await loadWatermarkAsset(
        wmBytes,
        watermarkFile.name,
        DEFAULT_RASTER_DPI,
        clarity !== undefined && Number.isFinite(clarity) ? { clarityGamma: clarityToGamma(clarity) } : {}
      );
      watermarkDataUrl = `data:image/png;base64,${watermarkAsset.buffer.toString("base64")}`;
    }

    return NextResponse.json({
      baseImage: `data:image/jpeg;base64,${raster.buffer.toString("base64")}`,
      baseWidthPx: raster.widthPx,
      baseHeightPx: raster.heightPx,
      watermarkImage: watermarkDataUrl,
    });
  } catch (err) {
    console.error("Preview generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Gagal membuat preview: ${message}` }, { status: 500 });
  }
}
