import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DocViewer from './components/DocViewer';
import TableOfContents from './components/TableOfContents';
import ReadingProgressBar from './components/ReadingProgressBar';
import MobileNavBar from './components/MobileNavBar';
import InstallPrompt from './components/InstallPrompt';
import BookmarksPanel from './components/BookmarksPanel';
import { loadAllDocs } from './utils/docLoader';
import { updateStreak, getStreak } from './utils/streakTracker';
import { useModuleCompletion } from './hooks/useModuleCompletion';

export default function App() {
  const [{ docs, categoryTree, moduleTree }] = useState(() => loadAllDocs());
  const [activeDoc, setActiveDoc] = useState(() => {
    try {
      const lastId = localStorage.getItem('k8s_last_doc');
      const found = lastId ? docs.find(d => d.id === lastId) : null;
      return found || docs[0] || null;
    } catch {
      return docs[0] || null;
    }
  });
  const [theme, setTheme] = useState('light');
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  });
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    try { return parseInt(localStorage.getItem('font_size') || '16', 10); } catch { return 16; }
  });
  const [streak, setStreak] = useState(() => getStreak().streak);

  // Set default data-theme on initial mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  // Update font size CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--doc-font-size', `${fontSize}px`);
    try { localStorage.setItem('font_size', String(fontSize)); } catch {}
  }, [fontSize]);

  // Update streak on mount
  useEffect(() => {
    const { streak: s } = updateStreak();
    setStreak(s);
  }, []);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }, []);

  // Reading progress state with localStorage persistence
  const [completedDocs, setCompletedDocs] = useState(() => {
    try {
      const saved = localStorage.getItem('k8s_completed_docs');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Bookmarks state
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem('k8s_bookmarks');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleBookmark = (docId) => {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(docId)) { next.delete(docId); } else { next.add(docId); }
      try { localStorage.setItem('k8s_bookmarks', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  // Module completion celebration
  useModuleCompletion({ categoryTree, moduleTree, completedDocs });

  const toggleComplete = (docId) => {
    setCompletedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) { next.delete(docId); } else { next.add(docId); }
      try { localStorage.setItem('k8s_completed_docs', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleSelectDoc = (doc) => {
    setActiveDoc(doc);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
    try { localStorage.setItem('k8s_last_doc', doc.id); } catch {}
  };

  // Keyboard navigation: Alt+← previous chapter, Alt+→ next chapter
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const idx = docs.findIndex(d => d.id === activeDoc?.id);
        if (idx >= 0 && idx < docs.length - 1) handleSelectDoc(docs[idx + 1]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const idx = docs.findIndex(d => d.id === activeDoc?.id);
        if (idx > 0) handleSelectDoc(docs[idx - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDoc, docs]);

  return (
    <div className="app-container" data-theme={theme}>
      <ReadingProgressBar />

      <Header
        docs={docs}
        onSelectDoc={handleSelectDoc}
        totalDocs={docs.length}
        completedDocsCount={completedDocs.size}
        activeDoc={activeDoc}
        theme={theme}
        onToggleTheme={toggleTheme}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        streak={streak}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        onOpenBookmarks={() => setBookmarksOpen(true)}
        bookmarkCount={bookmarks.size}
      />

      <div className="main-layout">
        <Sidebar
          categoryTree={categoryTree}
          moduleTree={moduleTree}
          activeDoc={activeDoc}
          completedDocs={completedDocs}
          onSelectDoc={handleSelectDoc}
          isOpen={sidebarOpen}
        />

        {sidebarOpen && (
          <div
            className="sidebar-backdrop-mobile"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className={`doc-layout-container ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
          <DocViewer
            doc={activeDoc}
            allDocs={docs}
            onSelectDoc={handleSelectDoc}
            isCompleted={activeDoc ? completedDocs.has(activeDoc.id) : false}
            onToggleComplete={toggleComplete}
            theme={theme}
            isBookmarked={activeDoc ? bookmarks.has(activeDoc.id) : false}
            onToggleBookmark={toggleBookmark}
          />
        </div>

        <TableOfContents markdownText={activeDoc?.body} />
      </div>

      <MobileNavBar docs={docs} activeDoc={activeDoc} onSelectDoc={handleSelectDoc} />

      <BookmarksPanel
        bookmarks={bookmarks}
        docs={docs}
        onSelectDoc={handleSelectDoc}
        onClose={() => setBookmarksOpen(false)}
        isOpen={bookmarksOpen}
      />

      <InstallPrompt />
    </div>
  );
}
