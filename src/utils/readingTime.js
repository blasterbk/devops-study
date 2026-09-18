/**
 * Estimates reading time for a markdown string.
 * Average reading speed: 200 words per minute.
 * @param {string} text
 * @returns {{ minutes: number, text: string }}
 */
export function getReadingTime(text) {
  if (!text) return { minutes: 0, text: '< 1 min read' };
  const words = text.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  if (minutes < 1) return { minutes: 1, text: '< 1 min read' };
  return { minutes, text: `~${minutes} min read` };
}
