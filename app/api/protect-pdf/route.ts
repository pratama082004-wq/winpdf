import { NextRequest, NextResponse } from "next/server";
import { protectPdf, ProtectPdfError } from "@/lib/pdf-protect";

// Encryption itself is fast (no rasterization involved), but keep the
// same generous duration as the other PDF routes in case someone
// uploads an unusually large file.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const userPassword = formData.get("userPassword");
    const ownerPassword = formData.get("ownerPassword");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "File PDF tidak ditemukan." },
        { status: 400 }
      );
    }
    if (typeof userPassword !== "string") {
      return NextResponse.json(
        { error: "Password tidak ditemukan." },
        { status: 400 }
      );
    }

    const sourceBytes = new Uint8Array(await file.arrayBuffer());

    const resultBytes = await protectPdf(sourceBytes, {
      userPassword,
      ownerPassword: typeof ownerPassword === "string" ? ownerPassword : undefined,
    });

    const outName = file.name.replace(/\.pdf$/i, "") + "-protected.pdf";

    return new NextResponse(Buffer.from(resultBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    console.error("Protect PDF processing error:", err);
    if (err instanceof ProtectPdfError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Gagal memproses PDF: ${message}` },
      { status: 500 }
    );
  }
}
