import React, { useEffect, useRef, useState } from 'react';

export default function MermaidDiagram({ chart, theme }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    let cancelled = false;
    setLoading(true);

    const isDark = theme === 'dark';
    const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;

    import('mermaid').then(({ default: mermaid }) => {
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'neutral',
        fontFamily: 'Inter, system-ui, sans-serif',
        suppressErrorRendering: true
      });

      mermaid.render(uniqueId, chart)
        .then(({ svg }) => {
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg;
            setLoading(false);
          }
        })
        .catch((err) => {
          console.warn('Mermaid rendering fallback:', err);
          const errEl = document.getElementById(`d${uniqueId}`);
          if (errEl) errEl.remove();
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = `
              <div style="width:100%; padding:1.25rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-tertiary); font-family:var(--font-mono); font-size:0.82rem; color:var(--text-secondary);">
                <div style="color:var(--accent-cyan); font-weight:700; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.04em;">
                  Architecture Flow Diagram
                </div>
                <pre style="margin:0; overflow-x:auto; font-family:var(--font-mono); line-height:1.5;">${chart}</pre>
              </div>
            `;
            setLoading(false);
          }
        });
    });

    return () => { cancelled = true; };
  }, [chart, theme]);

  return (
    <div
      className="mermaid-wrapper"
      style={{
        margin: '1.75rem 0',
        padding: loading ? '2rem' : '1.25rem',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: loading ? 'center' : undefined,
        overflowX: 'auto',
        minHeight: loading ? '120px' : undefined,
        transition: 'min-height 0.3s ease'
      }}
    >
      {loading && (
        <div style={{
          display: 'flex', gap: '6px', alignItems: 'center',
          color: 'var(--text-muted)', fontSize: '0.82rem'
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: 'var(--accent-cyan)',
            animation: 'pulse 1.2s ease-in-out infinite'
          }} />
          Loading diagram...
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', display: loading ? 'none' : undefined }} />
    </div>
  );
}
