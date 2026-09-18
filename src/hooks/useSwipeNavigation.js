import { useEffect, useRef } from 'react';

export function useSwipeNavigation({ onNext, onPrev, threshold = 60 }) {
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  useEffect(() => {
    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = (e) => {
      if (touchStartX.current === null) return;

      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;

      // Only trigger if horizontal swipe is dominant
      if (Math.abs(deltaX) < threshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) {
        touchStartX.current = null;
        return;
      }

      if (deltaX < -threshold) onNext?.();
      else if (deltaX > threshold) onPrev?.();

      touchStartX.current = null;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onNext, onPrev, threshold]);
}
