# winpdf — Tools PDF untuk WINTEQ

Aplikasi web Next.js berisi 3 tools PDF:

1. **Lock Watermark** (`/watermark`) — watermark yang menyatu permanen dengan PDF gambar teknik, anti-convert.
2. **Protect PDF** (`/protect`) — tambah password ke PDF.
3. **PDF to Word** (`/pdf-to-word`) — konversi PDF ke Word, dengan dukungan OCR untuk halaman hasil scan.

Homepage (`/`) berupa landing page dengan kartu untuk masing-masing tool.

## Arsitektur

Project ini (Next.js) menangani tool #1 dan #2 sepenuhnya sendiri lewat API
route (`app/api/...`). Tool #3 (PDF to Word) butuh library Python (`pdf2docx`,
OCR) yang tidak tersedia di Node.js, jadi logic-nya berjalan di **project
Vercel terpisah** (lihat folder `pdf-to-word-backend/` di sebelah project ini,
atau repo terpisah jika sudah dipindah) dan dipanggil lewat HTTP biasa dari
`app/pdf-to-word/page.tsx`.

Kenapa terpisah, bukan satu project pakai fitur Vercel "Services": opsi
"Services" di Framework Preset tidak muncul di akun Vercel yang dipakai
(kemungkinan butuh permission/plan tertentu). Dua project terpisah yang
berkomunikasi lewat API call adalah pendekatan yang pasti didukung di semua
plan Vercel, jadi itu yang dipakai.

**Konsekuensi praktis**: agar fitur PDF to Word berfungsi setelah deploy,
project backend Python (`pdf-to-word-backend/`) harus di-deploy sebagai
project Vercel-nya sendiri, lalu URL-nya dimasukkan ke environment variable
`NEXT_PUBLIC_BACKEND_URL` di project Next.js ini. Lihat
`pdf-to-word-backend/README.md` untuk langkah lengkapnya.

## Cara kerja Lock Watermark

1. Setiap halaman PDF asli dirender ulang menjadi gambar resolusi tinggi (200 DPI, diturunkan dari 300 DPI tanpa penurunan kualitas barcode yang terukur) menggunakan `pdfjs-dist` + `@napi-rs/canvas`.
2. Jika ada berkas watermark (PDF satu halaman, atau gambar PNG/JPG), watermark tersebut ditempel **utuh apa adanya** dan **di-skalakan agar mengisi (fit) halaman semaksimal mungkin** sambil menjaga rasio aspeknya — sama seperti cara `pdftk` menempelkan watermark.
3. Watermark yang opacity aslinya rendah dipertajam (clarity boost, bisa diatur lewat panel pengaturan) supaya keterbacaannya lebih baik.
4. Gambar gabungan disatukan kembali menjadi PDF baru menggunakan `pdf-lib`. Karena seluruh halaman berupa satu gambar utuh, watermark tidak bisa dipisahkan dari isi dokumen.

## Cara kerja Protect PDF

Menambahkan password (RC4 128-bit, lewat `@pdfsmaller/pdf-encrypt-lite`, pure JS tanpa native binary) ke PDF apa adanya tanpa rasterisasi ulang — file asli tetap dipakai byte-for-byte, hanya ditambah layer enkripsi.

## Cara kerja PDF to Word

Lihat `pdf-to-word-backend/README.md` untuk detail lengkap. Singkatnya: deteksi
otomatis halaman mana yang sudah punya teks (born-digital) vs yang murni
gambar (perlu OCR), jalankan OCR (RapidOCR) hanya pada halaman yang perlu,
lalu konversi tiap halaman secara terpisah ke DOCX dengan `pdf2docx` sebelum
digabung kembali dengan `docxcompose`.

## Menjalankan secara lokal

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Untuk fitur PDF to Word
juga berfungsi secara lokal, jalankan backend Python di `pdf-to-word-backend/`
secara terpisah (lihat README di folder itu) — defaultnya frontend mengarah ke
`http://localhost:8000`.

## Deploy ke Vercel

Push repository ini ke GitHub/GitLab/Bitbucket lalu import di [vercel.com/new](https://vercel.com/new).
Tidak ada environment variable yang dibutuhkan untuk Lock Watermark dan Protect PDF.

Untuk PDF to Word, set `NEXT_PUBLIC_BACKEND_URL` (lihat bagian Arsitektur di atas).

Catatan teknis:
- Route `/api/watermark` berjalan sebagai Node.js serverless function (`runtime = "nodejs"`) dengan `maxDuration = 300` detik.
- Route `/api/protect-pdf` berjalan dengan `maxDuration = 60` detik (enkripsi tidak butuh rasterisasi, jauh lebih cepat).
- Berkas tidak disimpan permanen di server — seluruh pemrosesan terjadi dalam satu siklus request/response.

## Struktur proyek

- `app/page.tsx` — landing page (grid kartu 3 tools)
- `app/watermark/page.tsx` — UI Lock Watermark
- `app/protect/page.tsx` — UI Protect PDF
- `app/pdf-to-word/page.tsx` — UI PDF to Word
- `app/api/watermark/`, `app/api/watermark-batch/`, `app/api/watermark-preview/` — endpoint Lock Watermark
- `app/api/protect-pdf/` — endpoint Protect PDF
- `lib/pdf-watermark.ts` — logic inti watermark: rasterisasi, kompositing, penyusunan ulang PDF
- `lib/pdf-protect.ts` — logic inti Protect PDF
- `lib/adjustment-params.ts` — parameter slider panel pengaturan watermark
- `lib/client-utils.ts` — tipe data dan util kecil sisi client
- `components/PdfTargetDropzone.tsx` — drop zone PDF (dipakai semua tools)
- `components/WatermarkDropzone.tsx`, `components/AdjustmentPanel.tsx`, `components/PreviewCanvas.tsx`, `components/DownloadModePicker.tsx` — komponen khusus Lock Watermark
- `pdf-to-word-backend/` — backend Python untuk fitur PDF to Word (project Vercel terpisah, lihat README di dalamnya)

