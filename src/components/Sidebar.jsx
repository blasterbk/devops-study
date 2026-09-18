import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, Search, Server } from 'lucide-react';

// Inline progress bar component
function ProgressBar({ completed, total }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const isDone = completed === total && total > 0;
  return (
    <div style={{
      height: '3px',
      background: 'var(--border-color)',
      borderRadius: '2px',
      margin: '0.2rem 0.6rem 0.35rem',
      overflow: 'hidden'
    }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        borderRadius: '2px',
        background: isDone
          ? 'var(--accent-emerald)'
          : 'linear-gradient(90deg, var(--accent-cyan), #7c3aed)',
        transition: 'width 0.4s ease'
      }} />
    </div>
  );
}

export default function Sidebar({ categoryTree, moduleTree, activeDoc, completedDocs, onSelectDoc, isOpen }) {
  const [openCategories, setOpenCategories] = useState({});
  const [openMainModules, setOpenMainModules] = useState({});
  const [openSubModules, setOpenSubModules] = useState({});
  const [filterText, setFilterText] = useState('');
  const activeChapterRef = useRef(null);

  // Auto-expand the tree path to the active doc and scroll it into view
  useEffect(() => {
    if (!activeDoc) return;

    const categories = categoryTree || [{ name: 'Kubernetes', modules: moduleTree }];

    for (const cat of categories) {
      for (const mainMod of cat.modules) {
        for (const sub of mainMod.submodules) {
          const found = sub.chapters.find(ch => ch.id === activeDoc.id);
          if (found) {
            setOpenCategories(prev => ({ ...prev, [cat.name]: true }));
            setOpenMainModules(prev => ({ ...prev, [mainMod.name]: true }));
            setOpenSubModules(prev => ({ ...prev, [sub.label]: true }));
            return;
          }
        }
      }
    }
  }, [activeDoc?.id]);

  // Scroll active chapter into view once tree is expanded
  useEffect(() => {
    if (activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeDoc?.id]);

  const toggleCategory = (name) => {
    setOpenCategories(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleMainModule = (name) => {
    setOpenMainModules(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleSubModule = (label) => {
    setOpenSubModules(prev => ({ ...prev, [label]: !prev[label] }));
  };

  if (!isOpen) return null;

  const categories = categoryTree || [{ name: 'Kubernetes', modules: moduleTree }];

  return (
    <aside className="glass-sidebar">
      {/* Search Filter */}
      <div style={{ marginBottom: '1.25rem', position: 'relative' }}>
        <input
          type="text"
          placeholder="Filter modules & topics..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem 0.5rem 2.2rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            fontSize: '0.82rem',
            outline: 'none'
          }}
        />
        <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
      </div>

      {/* Root Category Tree List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {categories.map((cat) => {
          const isCatOpen = openCategories[cat.name] || Boolean(filterText);
          const catTotalChapters = cat.modules.reduce((mAcc, m) => {
            return mAcc + m.submodules.reduce((sAcc, sub) => sAcc + sub.chapters.length, 0);
          }, 0);
          const catCompletedCount = cat.modules.reduce((mAcc, m) => {
            return mAcc + m.submodules.reduce((sAcc, sub) => {
              return sAcc + sub.chapters.filter(ch => completedDocs.has(ch.id)).length;
            }, 0);
          }, 0);

          return (
            <div key={cat.name} style={{ marginBottom: '0.5rem' }}>
              {/* Level 0: Root Category */}
              <button
                onClick={() => toggleCategory(cat.name)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.6rem 0.7rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-heading)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', overflow: 'hidden' }}>
                  {isCatOpen ? (
                    <ChevronDown size={17} color="var(--accent-cyan)" />
                  ) : (
                    <ChevronRight size={17} color="var(--accent-cyan)" />
                  )}
                  <Server size={18} color="var(--accent-cyan)" />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--accent-cyan)' }}>
                    {cat.name}
                  </span>
                </div>
                {catTotalChapters > 0 && (
                  <span className="badge" style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.45rem',
                    background: catCompletedCount === catTotalChapters ? 'rgba(16, 185, 129, 0.15)' : undefined,
                    color: catCompletedCount === catTotalChapters ? 'var(--accent-emerald)' : undefined,
                    borderColor: catCompletedCount === catTotalChapters ? 'rgba(16, 185, 129, 0.3)' : undefined
                  }}>
                    {catCompletedCount}/{catTotalChapters}
                  </span>
                )}
              </button>

              {/* Inside Root Category: Modules list */}
              {isCatOpen && (
                <div style={{ paddingLeft: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.4rem' }}>
                  {cat.modules.map((mainMod) => {
                    const isMainOpen = openMainModules[mainMod.name] || Boolean(filterText);
                    const totalChapters = mainMod.submodules.reduce((acc, sub) => acc + sub.chapters.length, 0);
                    const completedMainCount = mainMod.submodules.reduce((acc, sub) => {
                      return acc + sub.chapters.filter(ch => completedDocs.has(ch.id)).length;
                    }, 0);

                    return (
                      <div key={mainMod.name} style={{ marginBottom: '0.15rem' }}>
                        {/* Level 1: Main Module */}
                        <button
                          onClick={() => toggleMainModule(mainMod.name)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.45rem 0.6rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            fontSize: '0.86rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'var(--font-heading)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden' }}>
                            {isMainOpen ? (
                              <ChevronDown size={15} color="var(--text-secondary)" />
                            ) : (
                              <ChevronRight size={15} color="var(--text-secondary)" />
                            )}
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {mainMod.name}
                            </span>
                          </div>
                          {totalChapters > 0 && (
                            <span className="badge" style={{
                              fontSize: '0.65rem',
                              padding: '0.1rem 0.35rem',
                              background: completedMainCount === totalChapters ? 'rgba(16, 185, 129, 0.15)' : undefined,
                              color: completedMainCount === totalChapters ? 'var(--accent-emerald)' : undefined,
                              borderColor: completedMainCount === totalChapters ? 'rgba(16, 185, 129, 0.3)' : undefined
                            }}>
                              {completedMainCount}/{totalChapters}
                            </span>
                          )}
                        </button>

                        {/* Progress bar for this module */}
                        {totalChapters > 0 && (
                          <ProgressBar completed={completedMainCount} total={totalChapters} />
                        )}

                        {/* Level 2: Submodules */}
                        {isMainOpen && (
                          <div style={{ paddingLeft: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.15rem' }}>
                            {mainMod.submodules.map((sub) => {
                              const isSubOpen = openSubModules[sub.label] || Boolean(filterText);
                              const completedSubCount = sub.chapters.filter(ch => completedDocs.has(ch.id)).length;

                              const filteredChapters = sub.chapters.filter(ch =>
                                ch.title.toLowerCase().includes(filterText.toLowerCase()) ||
                                sub.label.toLowerCase().includes(filterText.toLowerCase())
                              );

                              if (filterText && filteredChapters.length === 0) return null;

                              return (
                                <div key={sub.label}>
                                  <button
                                    onClick={() => toggleSubModule(sub.label)}
                                    style={{
                                      width: '100%',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '0.4rem 0.5rem',
                                      borderRadius: '5px',
                                      border: 'none',
                                      background: 'transparent',
                                      color: 'var(--text-secondary)',
                                      fontSize: '0.82rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      textAlign: 'left'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                                      {sub.chapters.length > 0 ? (
                                        isSubOpen ? (
                                          <ChevronDown size={14} color="var(--text-muted)" />
                                        ) : (
                                          <ChevronRight size={14} color="var(--text-muted)" />
                                        )
                                      ) : (
                                        <span style={{ width: 14 }} />
                                      )}
                                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {sub.label}
                                      </span>
                                    </div>
                                    {sub.chapters.length > 0 && (
                                      <span style={{
                                        fontSize: '0.7rem',
                                        color: completedSubCount === sub.chapters.length ? 'var(--accent-emerald)' : 'var(--text-muted)',
                                        fontWeight: completedSubCount === sub.chapters.length ? 700 : 400
                                      }}>
                                        {completedSubCount}/{sub.chapters.length}
                                      </span>
                                    )}
                                  </button>

                                  {/* Level 3: Chapters */}
                                  {isSubOpen && (
                                    <div style={{ paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.1rem' }}>
                                      {filteredChapters.map((ch) => {
                                        const isActive = activeDoc && activeDoc.id === ch.id;
                                        const isCompleted = completedDocs.has(ch.id);

                                        return (
                                          <button
                                            key={ch.id}
                                            ref={isActive ? activeChapterRef : null}
                                            onClick={() => onSelectDoc(ch)}
                                            style={{
                                              width: '100%',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '0.45rem',
                                              padding: '0.38rem 0.55rem',
                                              borderRadius: '5px',
                                              border: isActive ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                                              background: isActive ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                                              color: isActive ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                                              fontSize: '0.8rem',
                                              fontWeight: isActive ? 600 : 400,
                                              cursor: 'pointer',
                                              textAlign: 'left',
                                              transition: 'all 0.15s ease'
                                            }}
                                          >
                                            {isCompleted ? (
                                              <CheckCircle size={13} color="var(--accent-emerald)" style={{ shrink: 0 }} />
                                            ) : (
                                              <span style={{
                                                width: '4px',
                                                height: '4px',
                                                borderRadius: '50%',
                                                background: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                                                shrink: 0
                                              }} />
                                            )}
                                            <span style={{
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              flex: 1,
                                              textDecoration: isCompleted && !isActive ? 'line-through' : 'none',
                                              opacity: isCompleted && !isActive ? 0.75 : 1
                                            }}>
                                              {ch.title}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
