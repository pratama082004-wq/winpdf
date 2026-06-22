import { NextRequest, NextResponse } from "next/server";
import { loadWatermarkAsset, watermarkPdf } from "@/lib/pdf-watermark";

// Allow this route to run as long as Vercel's plan permits, since
// rasterizing at 300 DPI for many pages can take a while.
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const watermarkFile = formData.get("watermark");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "File PDF tidak ditemukan." },
        { status: 400 }
      );
    }

    const sourceBytes = new Uint8Array(await file.arrayBuffer());

    let watermarkAsset = null;
    if (watermarkFile && watermarkFile instanceof File && watermarkFile.size > 0) {
      const wmBytes = new Uint8Array(await watermarkFile.arrayBuffer());
      watermarkAsset = await loadWatermarkAsset(wmBytes, watermarkFile.name, 300);
    }

    const resultBytes = await watermarkPdf(sourceBytes, watermarkAsset, {
      dpi: 300,
      marginRatio: 0.08,
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
