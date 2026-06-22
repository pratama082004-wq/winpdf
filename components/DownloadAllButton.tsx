"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onDownloadZip: () => void;
  onDownloadSeparate: () => void;
  disabled?: boolean;
};

export default function DownloadAllButton({
  onDownloadZip,
  onDownloadSeparate,
  disabled,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        disabled={disabled}
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--ink)",
          background: "transparent",
          border: "1px solid var(--line)",
          borderRadius: "2px",
          padding: "0.45rem 0.75rem",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        Unduh semua
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 100ms" }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            background: "var(--paper-raised)",
            border: "1px solid var(--line)",
            borderRadius: "2px",
            minWidth: "200px",
            zIndex: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <button
            onClick={() => {
              setIsOpen(false);
              onDownloadZip();
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "0.6rem 0.85rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              color: "var(--ink)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontWeight: 600 }}>Sebagai ZIP</span>
            <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-faint)" }}>
              Satu berkas .zip berisi semuanya
            </span>
          </button>
          <div style={{ borderTop: "1px solid var(--line)" }} />
          <button
            onClick={() => {
              setIsOpen(false);
              onDownloadSeparate();
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "0.6rem 0.85rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              color: "var(--ink)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--paper)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontWeight: 600 }}>Berkas terpisah</span>
            <span style={{ display: "block", fontSize: "0.72rem", color: "var(--ink-faint)" }}>
              Unduh satu per satu langsung
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
