import React, { useState, useEffect } from 'react';
import { Bookmark, X, ChevronRight } from 'lucide-react';

export default function BookmarksPanel({ bookmarks, docs, onSelectDoc, onClose, isOpen }) {
  const bookmarkedDocs = docs.filter(d => bookmarks.has(d.id));

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(4px)',
            zIndex: 110
          }}
        />
      )}

      {/* Panel */}
      <aside style={{
        position: 'fixed',
        top: 0,
        right: isOpen ? 0 : '-360px',
        width: '340px',
        height: '100vh',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        transition: 'right 0.3s ease',
        boxShadow: isOpen ? '-8px 0 32px rgba(0,0,0,0.3)' : 'none'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Bookmark size={16} color="var(--accent-cyan)" />
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Bookmarks
            </span>
            <span style={{
              fontSize: '0.72rem', padding: '0.1rem 0.4rem',
              borderRadius: '4px', background: 'var(--inline-code-bg)',
              color: 'var(--accent-cyan)'
            }}>
              {bookmarkedDocs.length}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: '4px', borderRadius: '4px'
          }}>
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.5rem' }}>
          {bookmarkedDocs.length === 0 ? (
            <div style={{
              padding: '3rem 1rem', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: '0.88rem'
            }}>
              <Bookmark size={32} color="var(--border-color)" style={{ marginBottom: '0.75rem' }} />
              <div>No bookmarks yet.</div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>
                Click 🔖 on any chapter to bookmark it.
              </div>
            </div>
          ) : (
            bookmarkedDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => { onSelectDoc(doc); onClose(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.65rem 0.75rem', border: 'none', borderRadius: '8px',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  color: 'var(--text-primary)', transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Bookmark size={13} color="var(--accent-amber)" fill="var(--accent-amber)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.85rem', fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {doc.title}
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                    {doc.module}
                  </div>
                </div>
                <ChevronRight size={14} color="var(--text-muted)" />
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
