import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('pwa_dismissed') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    if (dismissed) return;
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show after 30 seconds so it doesn't annoy first-time visitors
      setTimeout(() => setShow(true), 30000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
    try { localStorage.setItem('pwa_dismissed', 'true'); } catch {}
  };

  if (!show || !deferredPrompt) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-active)',
      borderRadius: '16px',
      padding: '1rem 1.25rem',
      boxShadow: '0 8px 32px rgba(56, 189, 248, 0.2)',
      backdropFilter: 'blur(16px)',
      display: 'flex',
      alignItems: 'center',
      gap: '0.85rem',
      zIndex: 200,
      maxWidth: '360px',
      width: 'calc(100vw - 3rem)',
      animation: 'slideUp 0.4s ease'
    }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
        background: 'var(--gradient-brand)', display: 'flex',
        alignItems: 'center', justifyContent: 'center'
      }}>
        <Download size={18} color="#fff" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
          Install DevOps Study
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          Add to home screen for offline access
        </div>
      </div>
      <button
        onClick={handleInstall}
        style={{
          background: 'var(--gradient-brand)', border: 'none', borderRadius: '8px',
          color: '#fff', padding: '0.4rem 0.9rem', fontSize: '0.82rem',
          fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
        }}
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
