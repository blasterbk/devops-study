import React, { useState, useEffect, useRef } from 'react';
import { Search, Sun, Moon, Menu, CheckCircle2, Terminal, X, ArrowRight, Layers } from 'lucide-react';

export default function Header({ 
  docs = [],
  onSelectDoc,
  theme, 
  onToggleTheme, 
  onToggleSidebar, 
  totalDocs, 
  completedDocsCount 
}) {
  const percent = totalDocs > 0 ? Math.round((completedDocsCount / totalDocs) * 100) : 0;
  
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const searchInputRef = useRef(null);
  const containerRef = useRef(null);

  // Global Ctrl+K shortcut listener to focus search input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter docs matching query
  const results = query.trim() === '' ? [] : docs.filter(doc => {
    const q = query.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.module.toLowerCase().includes(q) ||
      doc.body.toLowerCase().includes(q)
    );
  }).slice(0, 10);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      searchInputRef.current?.blur();
    }
  };

  const handleSelect = (doc) => {
    onSelectDoc(doc);
    setIsOpen(false);
    setQuery('');
    searchInputRef.current?.blur();
  };

  return (
    <header className="glass-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button 
          className="btn" 
          onClick={onToggleSidebar}
          style={{ padding: '0.4rem 0.6rem', display: 'flex' }}
          title="Toggle Navigation Menu"
        >
          <Menu size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: 'var(--gradient-brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 12px rgba(56, 189, 248, 0.4)'
          }}>
            <Terminal size={20} color="#ffffff" />
          </div>
          <div>
            <span style={{ 
              fontFamily: 'var(--font-heading)', 
              fontWeight: 800, 
              fontSize: '1.15rem',
              letterSpacing: '-0.02em',
              background: 'var(--gradient-brand)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              DevOps Study
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '-2px' }}>
              Internals & Architecture
            </span>
          </div>
        </div>
      </div>

      {/* Live Inline Header Search Input Container */}
      <div ref={containerRef} className="header-search-container" style={{ position: 'relative' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.45rem 0.9rem',
          borderRadius: '20px',
          border: isOpen ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          transition: 'all 0.2s ease',
          boxShadow: isOpen ? '0 0 12px rgba(56, 189, 248, 0.2)' : 'none'
        }}>
          <Search size={16} color="var(--accent-cyan)" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search modules & chapters..."
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              outline: 'none'
            }}
          />
          {query ? (
            <button 
              onClick={() => {
                setQuery('');
                setIsOpen(false);
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={14} />
            </button>
          ) : (
            <kbd style={{
              fontSize: '0.68rem',
              padding: '0.12rem 0.35rem',
              borderRadius: '4px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)'
            }}>
              Ctrl K
            </kbd>
          )}
        </div>

        {/* Floating Auto-complete Results Dropdown Attached to Search Bar */}
        {isOpen && query.trim() !== '' && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            width: 'min(460px, calc(100vw - 2rem))',
            maxHeight: '420px',
            overflowY: 'auto',
            background: 'var(--bg-secondary)',
            border: '2px solid var(--card-border)',
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.2)',
            zIndex: 100,
            padding: '0.5rem 0'
          }}>
            <div style={{
              padding: '0.4rem 1rem 0.6rem 1rem',
              borderBottom: '1px solid var(--border-color)',
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span>Search Results ({results.length})</span>
              <span style={{ fontSize: '0.7rem', textTransform: 'none', fontWeight: 400 }}>
                Use ↑ ↓ to navigate, Enter to open
              </span>
            </div>

            {results.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No matching chapters found for "{query}".
              </div>
            ) : (
              results.map((doc, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={doc.id}
                    onClick={() => handleSelect(doc)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    style={{
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                      borderLeft: isSelected ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <div style={{ overflow: 'hidden', flex: 1, paddingRight: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>
                        <Layers size={12} color="var(--accent-cyan)" />
                        <span>{doc.module}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {doc.title}
                      </div>
                    </div>
                    <ArrowRight size={14} color={isSelected ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Right Progress Tracker & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
        {/* Progress bar container */}
        <div className="header-progress-container" style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '0.2rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            <CheckCircle2 size={13} color="var(--accent-emerald)" />
            <span>{completedDocsCount} / {totalDocs} ({percent}%)</span>
          </div>
          <div style={{
            width: '120px',
            height: '6px',
            borderRadius: '3px',
            background: 'var(--bg-surface)',
            overflow: 'hidden',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              width: `${percent}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #10b981 0%, #38bdf8 100%)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>

        <button 
          className="btn" 
          onClick={onToggleTheme}
          style={{ padding: '0.4rem 0.6rem' }}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? <Sun size={18} color="#f59e0b" /> : <Moon size={18} color="#6366f1" />}
        </button>
      </div>
    </header>
  );
}
