"use client";

import { useEffect, useRef, useState } from "react";
import type { AdjustmentParams } from "@/lib/adjustment-params";

type Props = {
  baseImageUrl: string | null;
  baseWidthPx: number;
  baseHeightPx: number;
  watermarkImageUrl: string | null;
  params: AdjustmentParams;
};

/**
 * Live preview of one page with the current adjustment params applied —
 * entirely client-side, no network call per slider tick (see
 * /api/watermark-preview's doc comment for why). The base drawing and the
 * watermark are decoded once (cached in refs); every render just
 * re-composites them onto a canvas with the current opacity/sharpen/quality.
 *
 * Mirrors the server's compositeWatermarkOnRaster as closely as
 * practical (same fit-to-page scaling, same min-filter line-sharpen
 * algorithm) so the preview is a faithful approximation of the real
 * output, not just a rough impression — but it IS still an
 * approximation: canvas's lossy JPEG re-encode step uses
 * canvas.toBlob/toDataURL's own JPEG encoder, not the exact same library
 * (@napi-rs/canvas, server-side) the real job uses, so exact byte-for-byte
 * output will differ slightly. Close enough to judge the sliders by, not
 * meant to replace checking the final downloaded file.
 */
export default function PreviewCanvas({
  baseImageUrl,
  baseWidthPx,
  baseHeightPx,
  watermarkImageUrl,
  params,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);
  const watermarkImgRef = useRef<HTMLImageElement | null>(null);
  const [imagesReady, setImagesReady] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Decode the base + watermark images once whenever their source URLs
  // change (i.e. once per preview session, not per slider tick).
  useEffect(() => {
    let cancelled = false;

    if (!baseImageUrl) {
      // No source yet — reset asynchronously (queued as a microtask)
      // rather than calling setState synchronously in the effect body,
      // which React flags as a cascading-render risk.
      queueMicrotask(() => {
        if (!cancelled) setImagesReady(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const baseImg = new Image();
    const watermarkImg = watermarkImageUrl ? new Image() : null;

    let baseLoaded = false;
    let watermarkLoaded = !watermarkImg;

    function checkDone() {
      if (cancelled) return;
      if (baseLoaded && watermarkLoaded) {
        baseImgRef.current = baseImg;
        watermarkImgRef.current = watermarkImg;
        setImagesReady(true);
      }
    }

    queueMicrotask(() => {
      if (!cancelled) setImagesReady(false);
    });

    baseImg.onload = () => {
      baseLoaded = true;
      checkDone();
    };
    baseImg.src = baseImageUrl;

    if (watermarkImg && watermarkImageUrl) {
      watermarkImg.onload = () => {
        watermarkLoaded = true;
        checkDone();
      };
      watermarkImg.src = watermarkImageUrl;
    }

    return () => {
      cancelled = true;
    };
  }, [baseImageUrl, watermarkImageUrl]);

  // Re-composite whenever params change (or once images first become
  // ready). Debounced by a short delay: the line-sharpen min-filter pass
  // is the expensive part of this (a 3x3 neighborhood scan over every
  // pixel, in plain JS rather than the server's native canvas binding —
  // measured roughly ~100-500ms depending on page size), so re-running it
  // on every single slider tick while dragging would visibly lag. A
  // short debounce keeps the preview feeling responsive while dragging,
  // settling on the final composited result shortly after the user stops.
  useEffect(() => {
    if (!imagesReady) return;
    const canvas = canvasRef.current;
    const baseImg = baseImgRef.current;
    if (!canvas || !baseImg) return;

    setRendering(true);
    const handle = setTimeout(() => {
      renderComposite(canvas, baseImg, watermarkImgRef.current, baseWidthPx, baseHeightPx, params);
      setRendering(false);
    }, 80);

    return () => clearTimeout(handle);
  }, [imagesReady, params, baseWidthPx, baseHeightPx]);

  return (
    <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--line)" }}>
      <canvas
        ref={canvasRef}
        width={baseWidthPx}
        height={baseHeightPx}
        style={{ width: "100%", height: "auto", display: "block", background: "#fff" }}
      />
      {(!imagesReady || rendering) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.55)",
            fontSize: "0.8rem",
            color: "var(--ink-faint)",
          }}
        >
          {imagesReady ? "Memperbarui pratinjau…" : "Memuat pratinjau…"}
        </div>
      )}
    </div>
  );
}

function renderComposite(
  canvas: HTMLCanvasElement,
  baseImg: HTMLImageElement,
  watermarkImg: HTMLImageElement | null,
  widthPx: number,
  heightPx: number,
  params: AdjustmentParams
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.drawImage(baseImg, 0, 0, widthPx, heightPx);

  if (watermarkImg) {
    const fitScale = Math.min(widthPx / watermarkImg.naturalWidth, heightPx / watermarkImg.naturalHeight);
    const drawW = watermarkImg.naturalWidth * fitScale;
    const drawH = watermarkImg.naturalHeight * fitScale;
    const dx = (widthPx - drawW) / 2;
    const dy = (heightPx - drawH) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = params.opacity / 100;
    ctx.drawImage(watermarkImg, dx, dy, drawW, drawH);
    ctx.globalAlpha = 1;
  }

  if (params.lineSharpenIntensity > 0) {
    applyMinFilter(ctx, widthPx, heightPx, params.lineSharpenIntensity / 100);
  }

  // Note: JPEG re-encoding (the jpegQuality slider) isn't visually
  // simulated here — canvas doesn't expose a way to preview lossy
  // artifacts without actually re-encoding+redrawing, which would add
  // real lag to every slider tick for a quality level whose visible
  // effect (block artifacts at low quality) only shows up at the
  // extremes anyway. The quality value is still sent to the server and
  // genuinely applied to the real output.
}

/**
 * Same 3x3 min-filter as the server's sharpenRasterLines (see
 * pdf-watermark.ts), blended by `intensity` (0-1). Operates on whatever
 * is currently painted on the canvas (base + watermark already composited),
 * matching the server's order of operations (sharpen runs after compositing).
 */
function applyMinFilter(ctx: CanvasRenderingContext2D, width: number, height: number, intensity: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  for (let y = 0; y < height; y++) {
    const yStart = Math.max(0, y - 1);
    const yEnd = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xStart = Math.max(0, x - 1);
      const xEnd = Math.min(width - 1, x + 1);

      let minR = 255;
      let minG = 255;
      let minB = 255;
      for (let ny = yStart; ny <= yEnd; ny++) {
        const rowOffset = ny * width;
        for (let nx = xStart; nx <= xEnd; nx++) {
          const idx = (rowOffset + nx) * 4;
          const r = src[idx];
          const g = src[idx + 1];
          const b = src[idx + 2];
          if (r < minR) minR = r;
          if (g < minG) minG = g;
          if (b < minB) minB = b;
        }
      }

      const outIdx = (y * width + x) * 4;
      out[outIdx] = src[outIdx] + (minR - src[outIdx]) * intensity;
      out[outIdx + 1] = src[outIdx + 1] + (minG - src[outIdx + 1]) * intensity;
      out[outIdx + 2] = src[outIdx + 2] + (minB - src[outIdx + 2]) * intensity;
      out[outIdx + 3] = src[outIdx + 3];
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}
