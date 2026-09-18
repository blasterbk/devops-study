import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'dark',
  fontFamily: 'Inter, system-ui, sans-serif'
});

export default function MermaidDiagram({ chart, theme }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    const isDark = theme === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'neutral',
      fontFamily: 'Inter, system-ui, sans-serif',
      suppressErrorRendering: true
    });

    const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;

    try {
      mermaid.render(uniqueId, chart)
        .then(({ svg }) => {
          if (containerRef.current) {
            containerRef.current.innerHTML = svg;
          }
        })
        .catch((err) => {
          console.warn('Mermaid rendering fallback:', err);
          // Remove default mermaid error element if appended to body
          const errEl = document.getElementById(`d${uniqueId}`);
          if (errEl) errEl.remove();
          
          if (containerRef.current) {
            containerRef.current.innerHTML = `
              <div style="width:100%; padding:1.25rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-tertiary); font-family:var(--font-mono); font-size:0.82rem; color:var(--text-secondary);">
                <div style="color:var(--accent-cyan); font-weight:700; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.04em;">
                  Architecture Flow Diagram
                </div>
                <pre style="margin:0; overflow-x:auto; font-family:var(--font-mono); line-height:1.5;">${chart}</pre>
              </div>
            `;
          }
        });
    } catch (err) {
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div style="width:100%; padding:1.25rem; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-tertiary); font-family:var(--font-mono); font-size:0.82rem; color:var(--text-secondary);">
            <div style="color:var(--accent-cyan); font-weight:700; margin-bottom:0.5rem; text-transform:uppercase; letter-spacing:0.04em;">
              Architecture Flow Diagram
            </div>
            <pre style="margin:0; overflow-x:auto; font-family:var(--font-mono); line-height:1.5;">${chart}</pre>
          </div>
        `;
      }
    }
  }, [chart, theme]);

  return (
    <div 
      className="mermaid-wrapper" 
      ref={containerRef}
      style={{
        margin: '1.75rem 0',
        padding: '1.25rem',
        borderRadius: '10px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        justifyContent: 'center',
        overflowX: 'auto'
      }}
    />
  );
}
