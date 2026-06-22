export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}

export type JobStatus = "queued" | "processing" | "done" | "error";

export type WatermarkJob = {
  id: string;
  file: File;
  status: JobStatus;
  errorMessage?: string;
  resultBlob?: Blob;
  resultName?: string;
};
