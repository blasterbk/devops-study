import React, { useState, useEffect } from 'react';
import { StickyNote, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

export default function ChapterNotes({ docId }) {
  const storageKey = `note_${docId}`;
  const [note, setNote] = useState(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const [open, setOpen] = useState(false);

  // Reset when chapter changes
  useEffect(() => {
    try { setNote(localStorage.getItem(storageKey) || ''); } catch {}
    setOpen(false);
  }, [docId]);

  const handleChange = (e) => {
    setNote(e.target.value);
    try { localStorage.setItem(storageKey, e.target.value); } catch {}
  };

  const handleDelete = () => {
    setNote('');
    try { localStorage.removeItem(storageKey); } catch {}
  };

  return (
    <div style={{
      margin: '2.5rem 0 1rem',
      border: '1px solid var(--border-color)',
      borderRadius: '10px',
      overflow: 'hidden',
      background: 'var(--bg-secondary)'
    }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0.7rem 1rem',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: '0.83rem', fontWeight: 600
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <StickyNote size={14} color="var(--accent-amber)" />
          <span>My Notes</span>
          {note && (
            <span style={{
              fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '3px',
              background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)'
            }}>saved</span>
          )}
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.75rem' }}>
          <textarea
            value={note}
            onChange={handleChange}
            placeholder="Write your notes, key takeaways, or questions here... (auto-saved)"
            rows={6}
            style={{
              width: '100%', resize: 'vertical', background: 'var(--bg-primary)',
              color: 'var(--text-primary)', border: '1px solid var(--border-color)',
              borderRadius: '8px', padding: '0.75rem', fontSize: '0.85rem',
              fontFamily: 'var(--font-sans)', lineHeight: 1.6, outline: 'none',
              transition: 'border-color 0.2s'
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent-cyan)'}
            onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
          />
          {note && (
            <button
              onClick={handleDelete}
              style={{
                marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem',
                background: 'none', border: 'none', color: 'var(--accent-rose)',
                fontSize: '0.78rem', cursor: 'pointer', padding: '4px'
              }}
            >
              <Trash2 size={12} /> Clear notes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
