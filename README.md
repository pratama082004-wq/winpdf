# Materai — Watermark PDF Permanen

Aplikasi web untuk membubuhkan watermark ke banyak file PDF sekaligus, di mana watermark **menyatu permanen** dengan isi dokumen (bukan layer/anotasi terpisah) — sehingga saat PDF dikonversi ke Word atau dibuka di editor lain, watermark tidak bisa terlepas dari kontennya.

## Cara kerja

1. Setiap halaman PDF asli dirender ulang menjadi gambar resolusi tinggi (300 DPI) menggunakan `pdfjs-dist` + `@napi-rs/canvas`.
2. Jika ada berkas watermark (gambar PNG/JPG transparan, atau PDF satu halaman), watermark tersebut ditempelkan di atas gambar halaman — selalu dengan orientasi landscape, di-skalakan secara proporsional agar pas di halaman apa pun (portrait maupun landscape).
3. Gambar gabungan (halaman + watermark) disatukan kembali menjadi PDF baru menggunakan `pdf-lib`. Karena seluruh halaman sekarang berupa satu gambar utuh, watermark tidak bisa dipisahkan dari isi dokumen.
4. Jika tidak ada berkas watermark yang diunggah, dokumen tetap diproses ulang (dirasterisasi) tanpa watermark — berguna untuk "mengunci" dokumen yang sudah memiliki watermark sebelumnya.

## Menjalankan secara lokal

```bash
npm install
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

## Deploy ke Vercel

Push repository ini ke GitHub/GitLab/Bitbucket lalu import di [vercel.com/new](https://vercel.com/new). Tidak ada environment variable yang dibutuhkan.

Catatan teknis:
- Route `/api/watermark` berjalan sebagai Node.js serverless function (`runtime = "nodejs"`) dengan `maxDuration = 300` detik, karena rasterisasi 300 DPI untuk dokumen berhalaman banyak bisa memakan waktu. Sesuaikan `maxDuration` dengan limit plan Vercel Anda (Hobby: maks 300s sudah didukung; pastikan plan Anda mengizinkan durasi tersebut).
- Setiap berkas dalam antrian diproses satu per satu dari sisi client untuk menghindari banyak request berat secara paralel ke server.
- Berkas tidak disimpan permanen di server — seluruh pemrosesan terjadi dalam satu siklus request/response.

## Struktur proyek

- `app/page.tsx` — UI utama (drop zone, antrian, unduh hasil)
- `app/api/watermark/route.ts` — endpoint pemrosesan PDF
- `lib/pdf-watermark.ts` — logic inti: rasterisasi halaman, kompositing watermark, penyusunan ulang PDF
- `components/` — komponen UI (dropzone, pemilih watermark, item antrian)
