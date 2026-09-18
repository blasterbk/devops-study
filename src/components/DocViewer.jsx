import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check, ArrowLeft, ArrowRight, Layers, CheckCircle2, Circle, GitFork, Terminal, Code2, Workflow, Network, Bookmark } from 'lucide-react';
import MermaidDiagram from './MermaidDiagram';
import ChapterNotes from './ChapterNotes';
import { normalizeDiagram } from '../utils/diagramUtils';
import { getReadingTime } from '../utils/readingTime';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';

function getNodeText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join('');
  if (node && node.props && node.props.children) return getNodeText(node.props.children);
  return '';
}

function TreeDiagramBlock({ codeString }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderTreeLines = (text) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      const parts = line.split(/(├──|└──|│|─|├─|└─|↓|▼|\+--|\+-|\|)/g);

      return (
        <div key={i} style={{ minHeight: '1.25em' }}>
          {parts.map((part, pIdx) => {
            if (['├──', '└──', '│', '─', '├─', '└─', '↓', '▼', '+--', '+-', '|'].includes(part)) {
              return <span key={pIdx} className="tree-line">{part}</span>;
            }
            if (/Module\s+[\d\.]+|Chapter\s+\d+/i.test(part)) {
              return <span key={pIdx} className="tree-keyword">{part}</span>;
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </div>
      );
    });
  };

  return (
    <div className="tree-diagram-wrapper">
      <div className="tree-diagram-header">
        <div className="tree-diagram-title">
          <GitFork size={15} color="var(--accent-cyan)" />
          <span>Architecture & Workflow Roadmap</span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'transparent',
            border: 'none',
            color: copied ? 'var(--accent-emerald)' : '#94a3b8',
            cursor: 'pointer',
            fontSize: '0.78rem'
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <div className="tree-diagram-body">
        {renderTreeLines(codeString)}
      </div>
    </div>
  );
}


function CodeBlock({ codeText, children, className, theme }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : 'text';
  const codeString = codeText ? codeText.replace(/\n$/, '') : getNodeText(children).replace(/\n$/, '');

  // 1. Mermaid diagrams
  if (lang === 'mermaid' || codeString.trim().startsWith('graph ') || codeString.trim().startsWith('sequenceDiagram') || codeString.trim().startsWith('flowchart ')) {
    return <MermaidDiagram chart={codeString} theme={theme} />;
  }

  // 2. Tree / Architecture roadmap text diagrams detection
  const isTreeOrRoadmap = (
    lang === 'tree' ||
    lang === 'roadmap'
  );

  if (isTreeOrRoadmap) {
    return <TreeDiagramBlock codeString={codeString} />;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getHeaderLabelAndIcon = () => {
    if (lang === 'bash' || lang === 'sh') {
      return { label: 'BASH', icon: <Terminal size={14} color="var(--accent-cyan)" /> };
    }
    if (lang === 'text' || lang === 'txt' || !lang) {
      return { label: 'ARCHITECTURE DIAGRAM', icon: <Network size={14} color="var(--accent-cyan)" /> };
    }
    return { label: lang.toUpperCase(), icon: <Code2 size={14} color="var(--accent-cyan)" /> };
  };

  const { label, icon } = getHeaderLabelAndIcon();

  const isDiagram = lang === 'text' || lang === 'txt' || !lang;

  // Normalize diagram text: collapse blanks, fix arrows, merge pipe stems
  const displayCode = isDiagram ? normalizeDiagram(codeString) : codeString;

  const renderContent = () => {
    return <code style={{ whiteSpace: 'pre', display: 'block' }}>{displayCode}</code>;
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          {icon}
          <span>{label}</span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'transparent',
            border: 'none',
            color: copied ? 'var(--accent-emerald)' : '#94a3b8',
            cursor: 'pointer',
            fontSize: '0.78rem'
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <pre style={{ margin: 0, padding: '1.25rem 1.5rem', overflowX: 'auto', background: 'transparent' }}>
        {renderContent()}
      </pre>
    </div>
  );
}

function CalloutBlock({ children, quoteText }) {
  let type = 'note';

  if (quoteText.includes('[!NOTE]')) {
    type = 'note';
  } else if (quoteText.includes('[!TIP]')) {
    type = 'tip';
  } else if (quoteText.includes('[!IMPORTANT]')) {
    type = 'important';
  } else if (quoteText.includes('[!WARNING]')) {
    type = 'warning';
  } else if (quoteText.includes('[!CAUTION]')) {
    type = 'caution';
  }

  return (
    <div className={`callout-box ${type}`}>
      <div className="callout-title">
        {type.toUpperCase()}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function DocViewer({ doc, allDocs, onSelectDoc, isCompleted, onToggleComplete, theme, isBookmarked, onToggleBookmark }) {
  if (!doc) return null;

  const currentIndex = allDocs.findIndex(d => d.id === doc.id);
  const prevDoc = currentIndex > 0 ? allDocs[currentIndex - 1] : null;
  const nextDoc = currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : null;
  const readingTime = getReadingTime(doc.body);

  // Swipe gestures for mobile chapter navigation
  useSwipeNavigation({
    onNext: () => nextDoc && onSelectDoc(nextDoc),
    onPrev: () => prevDoc && onSelectDoc(prevDoc)
  });

  const renderHeading = ({ level, children }) => {
    const text = getNodeText(children).replace(/\r/g, '').trim();
    const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

    if (level === 1) return <h1 id={id}>{children}</h1>;
    if (level === 2) return <h2 id={id}>{children}</h2>;
    if (level === 3) return <h3 id={id}>{children}</h3>;
    return <h4 id={id}>{children}</h4>;
  };

  return (
    <main className="content-wrapper doc-content">
      {/* Module Banner & Mark Completed Button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="badge" style={{ gap: '0.4rem', padding: '0.3rem 0.6rem' }}>
            <Layers size={13} />
            <span>{doc.module}</span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>•</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Chapter {doc.sidebar_position}
          </span>
        </div>

        {/* Mark Completed Toggle Button + Bookmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Reading time badge */}
          <span style={{
            fontSize: '0.73rem', color: 'var(--text-muted)',
            padding: '0.2rem 0.5rem', borderRadius: '4px',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)'
          }}>
            {readingTime.text}
          </span>

          {/* Bookmark toggle */}
          <button
            onClick={() => onToggleBookmark?.(doc.id)}
            className="btn"
            style={{ padding: '0.4rem 0.6rem', borderRadius: '8px' }}
            title={isBookmarked ? 'Remove bookmark' : 'Bookmark this chapter'}
          >
            <Bookmark
              size={15}
              color={isBookmarked ? 'var(--accent-amber)' : 'var(--text-muted)'}
              fill={isBookmarked ? 'var(--accent-amber)' : 'none'}
            />
          </button>

          <button
            onClick={() => onToggleComplete(doc.id)}
            className="btn"
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '20px',
              fontSize: '0.82rem',
              background: isCompleted ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-tertiary)',
              color: isCompleted ? 'var(--accent-emerald)' : 'var(--text-secondary)',
              borderColor: isCompleted ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)',
              fontWeight: 600
            }}
          >
            {isCompleted ? <CheckCircle2 size={16} color="var(--accent-emerald)" /> : <Circle size={16} color="var(--text-muted)" />}
            <span>{isCompleted ? 'Completed' : 'Mark as Complete'}</span>
          </button>
        </div>
      </div>

      {/* Main Markdown Content */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: (props) => renderHeading({ level: 1, ...props }),
          h2: (props) => renderHeading({ level: 2, ...props }),
          h3: (props) => renderHeading({ level: 3, ...props }),
          pre: ({ children }) => <div className="md-pre-wrapper">{children}</div>,
          code: ({ node, inline, className, children, ...props }) => {
            const rawText = getNodeText(children);
            const match = /language-(\w+)/.exec(className || '');
            const isSingleLine = !rawText.includes('\n');
            const isInline = inline || (!match && isSingleLine);

            if (isInline) {
              return (
                <code
                  className="inline-code-badge"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--accent-cyan)',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.85em',
                    fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--border-color)'
                  }}
                  {...props}
                >
                  {rawText}
                </code>
              );
            }

            return (
              <CodeBlock className={className} codeText={rawText} theme={theme}>
                {children}
              </CodeBlock>
            );
          },
          blockquote: ({ children }) => {
            const raw = getNodeText(children);
            return <CalloutBlock quoteText={raw}>{children}</CalloutBlock>;
          }
        }}
      >
        {doc.body}
      </ReactMarkdown>

      {/* Chapter Notes */}
      <ChapterNotes docId={doc.id} />

      {/* Footer Navigation (Previous & Next Chapter) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '3.5rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid var(--border-color)'
      }}>
        {prevDoc ? (
          <button
            onClick={() => onSelectDoc(prevDoc)}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 1rem',
              borderRadius: '8px',
              textAlign: 'left'
            }}
          >
            <ArrowLeft size={16} />
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Previous Chapter</div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{prevDoc.title}</div>
            </div>
          </button>
        ) : <div />}

        {nextDoc ? (
          <button
            onClick={() => onSelectDoc(nextDoc)}
            className="btn"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 1rem',
              borderRadius: '8px',
              textAlign: 'right'
            }}
          >
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Next Chapter</div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{nextDoc.title}</div>
            </div>
            <ArrowRight size={16} />
          </button>
        ) : <div />}
      </div>

      {/* Keyboard navigation hint */}
      <div style={{
        textAlign: 'center',
        marginTop: '1rem',
        fontSize: '0.72rem',
        color: 'var(--text-muted)'
      }}>
        <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: '0.1rem 0.35rem', borderRadius: '3px', fontFamily: 'var(--font-mono)' }}>Alt+←</kbd>
        {' '}Prev{' · '}
        <kbd style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', padding: '0.1rem 0.35rem', borderRadius: '3px', fontFamily: 'var(--font-mono)' }}>Alt+→</kbd>
        {' '}Next · Swipe ↔ on mobile
      </div>
    </main>
  );
}

