/**
 * Normalizes raw MDX diagram text for clean rendering in the architecture diagram block.
 *
 * Steps applied (in order):
 *  1. Normalize Windows CRLF and old Mac CR to LF
 *  2. Collapse consecutive blank lines into a single line
 *  3. Replace standalone ASCII 'v' arrow lines with the real ↓ character
 *  4. Merge lone '|' pipe stems immediately followed by ↓ or ▼ into just the arrow
 */
export function normalizeDiagram(text) {
  return text
    .replace(/\r\n/g, '\n')                              // normalize Windows CRLF
    .replace(/\r/g, '\n')                                // normalize old Mac CR
    .replace(/\n{2,}/g, '\n')                            // collapse consecutive blank lines
    .replace(/^[ \t]*v[ \t]*$/gm, '↓')                  // replace ASCII v arrows
    .replace(/\n[ \t]*\|[ \t]*\n([ \t]*[↓▼])/g, '\n$1'); // merge | stem + arrow → just arrow
}
