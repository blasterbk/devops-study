import { useEffect, useRef } from 'react';

/**
 * Fires a CSS confetti celebration when a module reaches 100% completion.
 */
export function useModuleCompletion({ categoryTree, moduleTree, completedDocs }) {
  const celebratedModules = useRef(new Set());

  useEffect(() => {
    if (!completedDocs || completedDocs.size === 0) return;

    const categories = categoryTree || [{ modules: moduleTree }];

    for (const cat of (categories || [])) {
      for (const mainMod of (cat.modules || [])) {
        const allChapters = (mainMod.submodules || []).flatMap(sub => sub.chapters || []);
        if (allChapters.length === 0) continue;

        const allDone = allChapters.every(ch => completedDocs.has(ch.id));
        const key = mainMod.name;

        if (allDone && !celebratedModules.current.has(key)) {
          celebratedModules.current.add(key);
          fireConfetti();
        }
      }
    }
  }, [completedDocs?.size]);
}

function fireConfetti() {
  // Create animated confetti particles using CSS
  const colors = ['#38bdf8', '#6366f1', '#10b981', '#f59e0b', '#f43f5e'];
  const container = document.createElement('div');
  container.style.cssText = `
    position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;
  `;

  for (let i = 0; i < 60; i++) {
    const dot = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const x = Math.random() * 100;
    const delay = Math.random() * 0.8;
    const size = 6 + Math.random() * 8;
    dot.style.cssText = `
      position:absolute;top:-10px;left:${x}%;
      width:${size}px;height:${size}px;
      background:${color};border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation:confettiFall ${1.5 + Math.random()}s ease-in ${delay}s forwards;
    `;
    container.appendChild(dot);
  }

  // Inject keyframes if not already present
  if (!document.getElementById('confetti-keyframes')) {
    const style = document.createElement('style');
    style.id = 'confetti-keyframes';
    style.textContent = `
      @keyframes confettiFall {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3000);
}
