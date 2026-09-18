import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function MobileNavBar({ docs, activeDoc, onSelectDoc }) {
  if (!activeDoc || !docs?.length) return null;

  const currentIdx = docs.findIndex(d => d.id === activeDoc.id);
  const prevDoc = currentIdx > 0 ? docs[currentIdx - 1] : null;
  const nextDoc = currentIdx < docs.length - 1 ? docs[currentIdx + 1] : null;

  return (
    <nav className="mobile-nav-bar">
      <button
        className="mobile-nav-btn"
        onClick={() => prevDoc && onSelectDoc(prevDoc)}
        disabled={!prevDoc}
        title={prevDoc?.title}
      >
        <ChevronLeft size={16} />
        <span className="mobile-nav-label">
          {prevDoc ? prevDoc.title : 'First Chapter'}
        </span>
      </button>

      <div className="mobile-nav-counter">
        {currentIdx + 1} / {docs.length}
      </div>

      <button
        className="mobile-nav-btn mobile-nav-btn-next"
        onClick={() => nextDoc && onSelectDoc(nextDoc)}
        disabled={!nextDoc}
        title={nextDoc?.title}
      >
        <span className="mobile-nav-label">
          {nextDoc ? nextDoc.title : 'Last Chapter'}
        </span>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
