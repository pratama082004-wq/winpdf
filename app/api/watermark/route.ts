import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_RASTER_DPI, loadWatermarkAsset, watermarkPdf } from "@/lib/pdf-watermark";
import { stampDateOnWatermark } from "@/lib/watermark-date-stamp";
import { parseAdjustmentParamsFromFormData } from "@/lib/adjustment-params";

// Allow this route to run as long as Vercel's plan permits, since
// rasterizing many pages can take a while.
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const watermarkFile = formData.get("watermark");
    const params = parseAdjustmentParamsFromFormData(formData);

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "File PDF tidak ditemukan." },
        { status: 400 }
      );
    }

    const sourceBytes = new Uint8Array(await file.arrayBuffer());

    let watermarkAsset = null;
    if (watermarkFile && watermarkFile instanceof File && watermarkFile.size > 0) {
      let wmBytes = new Uint8Array(await watermarkFile.arrayBuffer());

      // Auto-stamp today's date onto known WINTEQ watermark templates
      // (User / Controlled / Uncontrolled) before it gets rasterized and
      // composited onto the drawing — mirrors what the customer otherwise
      // does by hand every day in iLovePDF. Only applies to PDF watermarks;
      // PNG/JPG watermarks pass through untouched since the stamp
      // detection and coordinates are specific to the customer's PDF
      // templates.
      const isPdfWatermark =
        watermarkFile.type === "application/pdf" ||
        watermarkFile.name.toLowerCase().endsWith(".pdf");
      if (isPdfWatermark) {
        const stamped = await stampDateOnWatermark(wmBytes, watermarkFile.name);
        wmBytes = stamped.bytes;
      }

      watermarkAsset = await loadWatermarkAsset(wmBytes, watermarkFile.name, DEFAULT_RASTER_DPI, {
        clarityGamma: params.clarityGamma,
      });
    }

    const resultBytes = await watermarkPdf(sourceBytes, watermarkAsset, {
      dpi: DEFAULT_RASTER_DPI,
      opacity: params.opacity / 100,
      lineSharpenIntensity: params.lineSharpenIntensity / 100,
      jpegQuality: params.jpegQuality,
    });

    const outName = file.name.replace(/\.pdf$/i, "") + "-watermarked.pdf";

    return new NextResponse(Buffer.from(resultBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    console.error("Watermark processing error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Gagal memproses PDF: ${message}` },
      { status: 500 }
    );
  }
}
