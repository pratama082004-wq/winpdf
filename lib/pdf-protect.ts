import { encryptPDF } from "@pdfsmaller/pdf-encrypt-lite";

/**
 * "Protect PDF" adds a password to an existing PDF, independent of the
 * watermarking feature — the source PDF is used as-is, byte for byte,
 * nothing is rasterized or re-rendered here.
 *
 * Encryption is RC4 128-bit (via @pdfsmaller/pdf-encrypt-lite), not
 * AES-256. This is a deliberate trade-off for this project, not an
 * oversight:
 *   - It's pure JS with zero native binaries/WASM, so it runs as-is on
 *     Vercel's Node.js serverless functions (same constraint that ruled
 *     out qpdf/qpdf-wasm-based alternatives for this stack).
 *   - RC4 128-bit is what every major browser and Adobe Reader can open
 *     without a plugin, and it's sufficient for "don't let a casual
 *     recipient open this without the password" — the customer's actual
 *     requirement here, not bank-grade document security.
 * If a customer ever needs AES-256 specifically, that's a signal to
 * revisit this — it isn't a small follow-up since AES requires Node's
 * webcrypto and may need a different package.
 */

export type ProtectPdfOptions = {
  userPassword: string;
  ownerPassword?: string;
};

const MIN_PASSWORD_LENGTH = 4;

export class ProtectPdfError extends Error {}

/**
 * Validates and applies password protection to a PDF.
 * Throws ProtectPdfError with a message safe to show directly to the
 * end user (already in Indonesian, matching the rest of this project's
 * user-facing error strings).
 */
export async function protectPdf(
  pdfBytes: Uint8Array,
  options: ProtectPdfOptions
): Promise<Uint8Array> {
  const { userPassword, ownerPassword } = options;

  if (!userPassword || userPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ProtectPdfError(
      `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`
    );
  }

  // An empty string and undefined mean different things to the
  // underlying encryptPDF signature (explicit "no owner password" vs
  // "use default") — normalize blank input from a form field to
  // undefined so it falls through to the library's own default
  // (mirroring the user password) rather than locking the file with a
  // literal empty owner password.
  const normalizedOwnerPassword =
    ownerPassword && ownerPassword.length > 0 ? ownerPassword : undefined;

  try {
    return await encryptPDF(pdfBytes, userPassword, normalizedOwnerPassword);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new ProtectPdfError(`Gagal mengenkripsi PDF: ${message}`);
  }
}
