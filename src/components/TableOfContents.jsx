import React, { useMemo, useState, useEffect, useRef } from 'react';
import { List } from 'lucide-react';

export default function TableOfContents({ markdownText }) {
  const [activeId, setActiveId] = useState('');
  const observerRef = useRef(null);

  const headings = useMemo(() => {
    if (!markdownText) return [];
    // Normalize Windows CRLF so heading regex works reliably on all MDX files
    const normalized = markdownText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const result = [];
    lines.forEach((line) => {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim().replace(/\*+/g, '').replace(/`+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        result.push({ level, text, id });
      }
    });
    return result;
  }, [markdownText]);

  // Scroll-spy: observe heading elements and track which is in view
  useEffect(() => {
    if (headings.length === 0) return;

    if (observerRef.current) observerRef.current.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the topmost visible heading
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-60px 0px -70% 0px',
        threshold: 0
      }
    );

    // Observe all heading elements on the page
    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    observerRef.current = observer;
    return () => observer.disconnect();
  }, [headings, markdownText]);

  if (headings.length === 0) return null;

  const scrollToHeading = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
    }
  };

  return (
    <aside className="toc-sidebar" style={{
      width: 'var(--toc-width)',
      position: 'fixed',
      top: 'calc(var(--header-height) + 1.5rem)',
      right: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.6rem',
      maxHeight: 'calc(100vh - 100px)',
      overflowY: 'auto',
      paddingLeft: '1rem',
      borderLeft: '2px solid var(--border-color)',
      scrollbarWidth: 'thin'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: 'var(--text-primary)',
        fontSize: '0.78rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: '0.25rem'
      }}>
        <List size={13} color="var(--accent-cyan)" />
        <span>On This Page</span>
      </div>

      {/* Heading list */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
        {headings.map((h, i) => {
          const isActive = activeId === h.id;
          // Indent: h1=0, h2=0.65rem, h3=1.3rem, h4=1.95rem
          const indent = Math.max(0, h.level - 1) * 0.7;
          const isTopLevel = h.level <= 2;

          return (
            <button
              key={i}
              onClick={() => scrollToHeading(h.id)}
              title={h.text}
              style={{
                background: isActive ? 'rgba(56, 189, 248, 0.08)' : 'none',
                border: 'none',
                borderRadius: '4px',
                color: isActive
                  ? 'var(--accent-cyan)'
                  : isTopLevel
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                fontSize: h.level >= 3 ? '0.72rem' : '0.78rem',
                fontWeight: isActive ? 600 : (isTopLevel ? 500 : 400),
                paddingTop: '0.22rem',
                paddingBottom: '0.22rem',
                paddingRight: '0.4rem',
                textAlign: 'left',
                cursor: 'pointer',
                lineHeight: 1.4,
                transition: 'all 0.15s ease',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                borderLeft: isActive
                  ? '2px solid var(--accent-cyan)'
                  : '2px solid transparent',
                marginLeft: '-1rem',
                paddingLeft: `calc(${indent}rem + 0.85rem)`
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--accent-cyan)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = isTopLevel ? 'var(--text-primary)' : 'var(--text-secondary)';
              }}
            >
              {h.text}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
