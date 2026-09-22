"use client";

/**
 * Catches an error thrown by the root layout itself (fonts, providers,
 * etc.) — the one place error.tsx can't reach. Must define its own
 * <html>/<body> and can't rely on globals.css/the design system (per
 * Next's docs, this replaces the root layout entirely when active), so
 * this is deliberately plain inline-styled HTML rather than Tailwind/shadcn
 * components.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f4f4f5",
          color: "#18181b",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            padding: 24,
            borderRadius: 12,
            background: "#ffffff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.06)",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Algo deu errado</h1>
          <p style={{ fontSize: 14, color: "#71717a", margin: "0 0 16px" }}>
            O app não carregou. Confira os logs do servidor — geralmente é uma variável de
            ambiente do Supabase ausente neste ambiente.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                color: "#71717a",
                background: "#f4f4f5",
                borderRadius: 6,
                padding: "8px 12px",
                margin: "0 0 16px",
              }}
            >
              Digest: {error.digest}
            </p>
          )}
          <button
            onClick={() => retry()}
            style={{
              width: "100%",
              height: 36,
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
