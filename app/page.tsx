"use client";

import Link from "next/link";

type ToolCard = {
  href: string;
  title: string;
  description: string;
  zoneBg: string;
  zoneBorder: string;
  zoneText: string;
  icon: React.ReactNode;
};

const tools: ToolCard[] = [
  {
    href: "/watermark",
    title: "Lock Watermark",
    description:
      "Bubuhkan watermark yang menyatu permanen dengan PDF gambar teknik. 100% anti-convert.",
    zoneBg: "var(--pdf-zone-bg)",
    zoneBorder: "var(--pdf-zone-border)",
    zoneText: "var(--pdf-zone-text)",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z" />
        <path d="M9.5 12.2 11 13.7l3.5-3.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/protect",
    title: "Protect PDF",
    description: "Tambahkan password agar PDF hanya bisa dibuka oleh yang berhak.",
    zoneBg: "var(--wm-zone-bg)",
    zoneBorder: "var(--wm-zone-border)",
    zoneText: "var(--wm-zone-text)",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/pdf-to-word",
    title: "PDF to Word",
    description:
      "Ubah PDF jadi dokumen Word yang rapi, lengkap dengan dukungan OCR untuk halaman hasil scan.",
    zoneBg: "var(--doc-zone-bg)",
    zoneBorder: "var(--doc-zone-border)",
    zoneText: "var(--doc-zone-text)",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 13.5h7M8.5 16.5h4.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center" style={{ background: "var(--page-bg)", padding: "3.5rem 1.25rem" }}>
      <div style={{ width: "100%", maxWidth: "880px" }}>
        <div style={{ textAlign: "center", marginBottom: "2.75rem" }}>
          <h1
            style={{
              fontSize: "clamp(1.8rem, 4vw, 2.4rem)",
              fontWeight: 700,
              color: "var(--ink)",
              marginBottom: "0.6rem",
              letterSpacing: "-0.01em",
            }}
          >
            Tools PDF untuk WINTEQ
          </h1>
          <p style={{ fontSize: "1rem", color: "var(--ink-faint)", maxWidth: "480px", margin: "0 auto" }}>
            Watermark, kunci password, dan konversi PDF ke Word — semuanya diproses di server,
            tanpa berkas tersimpan permanen.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1.1rem",
          }}
        >
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              style={{
                display: "block",
                textDecoration: "none",
                background: "var(--card-bg)",
                border: "1px solid var(--line)",
                borderRadius: "16px",
                padding: "1.5rem",
                transition: "border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease",
              }}
              className="tool-card"
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: "12px",
                  background: tool.zoneBg,
                  border: `1px solid ${tool.zoneBorder}`,
                  color: tool.zoneText,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1rem",
                }}
              >
                {tool.icon}
              </div>
              <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--ink)", marginBottom: "0.4rem" }}>
                {tool.title}
              </h2>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-faint)", lineHeight: 1.5 }}>
                {tool.description}
              </p>
            </Link>
          ))}
        </div>
      </div>

      <style jsx>{`
        .tool-card:hover {
          border-color: var(--accent);
          box-shadow: 0 4px 16px rgba(20, 30, 50, 0.08);
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  );
}
