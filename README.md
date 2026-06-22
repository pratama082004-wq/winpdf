# Lock Watermark — Watermark + Rasterize PDF

Aplikasi web untuk membubuhkan watermark ke banyak file PDF sekaligus, di mana watermark **menyatu permanen** dengan isi dokumen (bukan layer/anotasi terpisah) — sehingga saat PDF dikonversi ke Word atau dibuka di editor lain, watermark tidak bisa terlepas dari kontennya. 100% anti-convert.

## Cara kerja

1. Setiap halaman PDF asli dirender ulang menjadi gambar resolusi tinggi (300 DPI) menggunakan `pdfjs-dist` + `@napi-rs/canvas`.
2. Jika ada berkas watermark (PDF satu halaman, atau gambar PNG/JPG), watermark tersebut otomatis di-*crop* dulu ke area kontennya saja (membuang margin transparan di sekitarnya), lalu **selalu di-skalakan agar mengisi (fit) halaman semaksimal mungkin** sambil menjaga rasio aspeknya — sama seperti cara `pdftk` menempelkan watermark ke dokumen. Ini berlaku konsisten baik dokumen berukuran A4 maupun A3.
3. Watermark yang opacity aslinya rendah (umum pada watermark hasil ekspor software CAD/PLM) dipertajam sedikit (gamma boost) supaya keterbacaannya mendekati hasil pdftk, tanpa mengubah bentuk atau warnanya.
4. Gambar gabungan (halaman + watermark) disatukan kembali menjadi PDF baru menggunakan `pdf-lib`. Karena seluruh halaman sekarang berupa satu gambar utuh, watermark tidak bisa dipisahkan dari isi dokumen.
5. Jika tidak ada berkas watermark yang diunggah, dokumen tetap diproses ulang (dirasterisasi) tanpa watermark — berguna untuk "mengunci" dokumen yang sudah memiliki watermark sebelumnya.

Halaman-halaman dalam satu dokumen dirender secara paralel (3 halaman sekaligus secara default) untuk mempercepat proses pada dokumen berhalaman banyak.

## Menggunakan aplikasi

1. **PDF Gambar Teknik** — taruh satu atau beberapa berkas PDF yang ingin diberi watermark/dikunci.
2. **PDF Watermark** — opsional. Bisa berupa PDF satu halaman, atau gambar PNG/JPG. Kosongkan jika hanya ingin mengunci dokumen yang sudah memiliki watermark.
3. **Opsi Unduhan** — pilih apakah hasil diunduh satu per satu (Unduh Terpisah) atau digabung jadi satu berkas `.zip` (Jadikan 1 ZIP).
4. Klik **Kunci & Download** — semua berkas diproses lalu otomatis diunduh sesuai opsi yang dipilih.

## Menjalankan secara lokal

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

## Deploy ke Vercel

Push repository ini ke GitHub/GitLab/Bitbucket lalu import di [vercel.com/new](https://vercel.com/new). Tidak ada environment variable yang dibutuhkan.

Catatan teknis:
- Route `/api/watermark` berjalan sebagai Node.js serverless function (`runtime = "nodejs"`) dengan `maxDuration = 300` detik, karena rasterisasi 300 DPI untuk dokumen berhalaman banyak bisa memakan waktu. Sesuaikan dengan limit plan Vercel Anda.
- Setiap berkas dalam antrian diproses satu per satu dari sisi client (request terpisah ke server) untuk menghindari banyak request berat secara paralel; di dalam satu berkas, halaman-halamannya sendiri dirender paralel di server.
- Berkas tidak disimpan permanen di server — seluruh pemrosesan terjadi dalam satu siklus request/response.

## Struktur proyek

- `app/page.tsx` — UI utama (drop zone PDF & watermark, opsi unduhan, tombol proses)
- `app/api/watermark/route.ts` — endpoint pemrosesan PDF
- `lib/pdf-watermark.ts` — logic inti: rasterisasi halaman, kompositing watermark (fit-scale + clarity boost), penyusunan ulang PDF
- `lib/client-utils.ts` — tipe data dan util kecil sisi client
- `components/PdfTargetDropzone.tsx` — drop zone untuk PDF yang akan diwatermark, menampilkan daftar berkas di dalamnya
- `components/WatermarkDropzone.tsx` — drop zone untuk berkas watermark (PDF/PNG/JPG, opsional)
- `components/DownloadModePicker.tsx` — pilihan unduh terpisah vs ZIP
