import React, { useState, useEffect, useRef } from 'react';
import { Search, X, FileText, ArrowRight, CornerDownLeft } from 'lucide-react';

/**
 * Extracts a ~120 char excerpt from body text around the first occurrence of query.
 * Returns null if the match is already visible in title/module (no need to show excerpt).
 */
function getBodyExcerpt(body, query) {
  if (!body || !query) return null;
  const lBody = body.toLowerCase();
  const lQuery = query.toLowerCase();
  const idx = lBody.indexOf(lQuery);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 50);
  const end = Math.min(body.length, idx + query.length + 70);
  let excerpt = (start > 0 ? '…' : '') + body.slice(start, end).replace(/#+\s*/g, '').replace(/\*+/g, '') + (end < body.length ? '…' : '');
  // Split on the matched term to bold it
  const parts = excerpt.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
  return parts;
}

export default function SearchModal({ isOpen, onClose, docs, onSelectDoc }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const results = React.useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    
    return docs.filter(doc => 
      doc.title.toLowerCase().includes(q) ||
      doc.module.toLowerCase().includes(q) ||
      doc.body.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [query, docs]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      onSelectDoc(results[selectedIndex]);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh'
      }}
      onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90%',
          maxWidth: '680px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Search Input Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <Search size={20} color="var(--accent-cyan)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documentation (e.g. etcd, Scheduler, Watch, API Server)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '1rem',
              outline: 'none',
              fontFamily: 'var(--font-sans)'
            }}
          />
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Results List */}
        <div style={{ maxHeight: '420px', overflowY: 'auto', padding: '0.75rem' }}>
          {results.length > 0 ? (
            results.map((doc, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    onSelectDoc(doc);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                    border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                    cursor: 'pointer',
                    marginBottom: '0.35rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                    <FileText size={18} color={isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                    <div>
                      <div style={{
                        color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
                        fontWeight: 600,
                        fontSize: '0.92rem'
                      }}>
                        {doc.title}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {doc.module}
                      </div>
                      {/* Body excerpt — shown when match is in body text */}
                      {(() => {
                        const q = query.trim();
                        const inTitle = doc.title.toLowerCase().includes(q.toLowerCase());
                        const inModule = doc.module.toLowerCase().includes(q.toLowerCase());
                        if (inTitle || inModule) return null;
                        const parts = getBodyExcerpt(doc.body, q);
                        if (!parts) return null;
                        return (
                          <div style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-muted)',
                            marginTop: '0.2rem',
                            lineHeight: 1.4,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical'
                          }}>
                            {parts.map((part, i) =>
                              part.toLowerCase() === q.toLowerCase()
                                ? <mark key={i} style={{ background: 'rgba(56,189,248,0.25)', color: 'var(--accent-cyan)', borderRadius: '2px', padding: '0 2px' }}>{part}</mark>
                                : <span key={i}>{part}</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {isSelected && <CornerDownLeft size={16} color="var(--accent-cyan)" />}
                </div>
              );
            })
          ) : query.trim() ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No chapters matching "{query}" found.
            </div>
          ) : (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Type a term to search across all {docs.length} chapters — titles and full content.
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div style={{
          padding: '0.6rem 1.25rem',
          background: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          gap: '1.5rem',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <span><kbd style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>↑↓</kbd> Navigate</span>
          <span><kbd style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Enter</kbd> Select</span>
          <span><kbd style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
