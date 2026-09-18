import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DocViewer from './components/DocViewer';
import TableOfContents from './components/TableOfContents';
import { loadAllDocs } from './utils/docLoader';

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
  const [theme, setTheme] = useState('light'); // Set Light Theme as default
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return typeof window !== 'undefined' ? window.innerWidth >= 1024 : true;
  });

  // Set default data-theme on initial mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
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

  const toggleComplete = (docId) => {
    setCompletedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      try {
        localStorage.setItem('k8s_completed_docs', JSON.stringify([...next]));
      } catch (err) {
        console.error('Failed to save progress to localStorage:', err);
      }
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
    try {
      localStorage.setItem('k8s_last_doc', doc.id);
    } catch (err) {
      console.error('Failed to save last doc to localStorage:', err);
    }
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
          />
        </div>

        <TableOfContents
          markdownText={activeDoc?.body}
        />
      </div>
    </div>
  );
}
