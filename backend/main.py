"""
FastAPI backend for Lock Watermark's Python-only features (currently:
PDF to Word with optional OCR). Deployed as a Vercel Service alongside
the Next.js frontend -- see vercel.json's experimentalServices config.

Entrypoint convention: Vercel's Python runtime looks for a top-level
ASGI/WSGI app named `app` in app.py/main.py/etc. This file is named
main.py to match that.

Route paths here are relative to this service's root (e.g. "/health"),
NOT the full URL path. Vercel's routePrefix ("/api/python", set in
vercel.json's experimentalServices.api.routePrefix) is prepended at the
routing layer, so from the browser/Next.js side the actual endpoints
are GET /api/python/health and POST /api/python/pdf-to-word. Defining
the prefix again here would double it up into /api/python/api/python/....
"""
import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from pdf_to_word import ConversionError, convert_pdf_to_docx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB -- generous for a manual book PDF


@app.get("/health")
def health():
    """Cheap liveness check, also useful for confirming the Python
    service is reachable at all when wiring up the frontend during
    development."""
    return {"status": "ok"}


@app.post("/pdf-to-word")
async def pdf_to_word(file: UploadFile = File(...), ocr_mode: str = Form("auto")):
    if file.content_type not in ("application/pdf",) and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File harus berupa PDF.")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="File PDF kosong atau tidak terbaca.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File terlalu besar (maksimal {MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
        )

    if ocr_mode not in ("auto", "force", "off"):
        raise HTTPException(status_code=400, detail="ocr_mode harus auto, force, atau off.")

    try:
        docx_bytes = convert_pdf_to_docx(pdf_bytes, ocr_mode=ocr_mode)
    except ConversionError as exc:
        logger.warning("Conversion failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during PDF to Word conversion")
        raise HTTPException(
            status_code=500, detail=f"Terjadi kesalahan tak terduga: {exc}"
        ) from exc

    out_name = file.filename.rsplit(".", 1)[0] + ".docx" if file.filename else "converted.docx"

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )
