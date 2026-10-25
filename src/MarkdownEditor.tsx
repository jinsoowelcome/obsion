import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import DOMPurify from 'dompurify';
import { renderMarkdown } from './render-markdown';

export type EditorMode = 'live' | 'source' | 'reading';
function liveDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  const activeLine = view.hasFocus ? view.state.doc.lineAt(view.state.selection.main.head).number : -1;
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i);
    const heading = /^(#{1,6})\s/.exec(line.text);
    if (heading) builder.add(line.from, line.from, Decoration.line({ class: `live-h live-h${heading[1].length}` }));
    if (i === activeLine) continue;
    const ranges: { from: number; to: number; decoration: Decoration }[] = [];
    if (heading) ranges.push({ from: line.from, to: line.from + heading[0].length, decoration: Decoration.replace({}) });
    for (const match of line.text.matchAll(/\[\[([^\]\n]+)\]\]|(\*\*|__)(.+?)\2|(?<!\*)\*([^*]+)\*(?!\*)|`([^`]+)`/g)) {
      const start = line.from + match.index!;
      if (match[1]) {
        ranges.push({ from: start, to: start + 2, decoration: Decoration.replace({}) });
        ranges.push({ from: start + 2, to: start + match[0].length - 2, decoration: Decoration.mark({ class: 'live-link', attributes: { 'data-wiki': match[1].split('|')[0], title: '⌘+클릭하여 노트 열기' } }) });
        ranges.push({ from: start + match[0].length - 2, to: start + match[0].length, decoration: Decoration.replace({}) });
      } else {
        const count = match[2] ? 2 : 1;
        ranges.push({ from: start, to: start + count, decoration: Decoration.replace({}) });
        ranges.push({ from: start + count, to: start + match[0].length - count, decoration: Decoration.mark({ class: match[2] ? 'live-bold' : match[4] ? 'live-em' : 'live-code' }) });
        ranges.push({ from: start + match[0].length - count, to: start + match[0].length, decoration: Decoration.replace({}) });
      }
    }
    ranges.sort((a, b) => a.from - b.from || a.to - b.to).forEach(r => builder.add(r.from, r.to, r.decoration));
  }
  return builder.finish();
}
const livePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = liveDecorations(view); }
  update(update: ViewUpdate) { if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = liveDecorations(update.view); }
}, { decorations: plugin => plugin.decorations });

export function MarkdownEditor({ value, onChange, mode, dark, lineNumbers, onLink, disabled = false }: { value: string; onChange(value: string): void; mode: EditorMode; dark: boolean; lineNumbers: boolean; onLink(target: string): void; disabled?: boolean }) {
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping, EditorView.theme({ '&': { backgroundColor: 'transparent', color: 'var(--text)' }, '.cm-content': { fontFamily: 'inherit', padding: '0 0 140px', caretColor: 'var(--text)' }, '.cm-scroller': { fontFamily: 'inherit', overflow: 'visible', lineHeight: '1.8' }, '.cm-line': { padding: '0', minHeight: '1.8em' }, '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' }, '.cm-activeLine, .cm-activeLineGutter': { background: 'transparent' }, '&.cm-focused': { outline: 'none' }, '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { background: 'var(--selection)' } }), ...(mode === 'live' ? [livePlugin] : []), EditorView.domEventHandlers({ click(event) { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-wiki]'); if (target && (event.metaKey || event.ctrlKey)) { onLink(target.dataset.wiki!); return true; } return false; } })], [mode, onLink]);
  const html = useMemo(() => {
    return DOMPurify.sanitize(renderMarkdown(value), { ADD_ATTR: ['data-note'], FORBID_TAGS: ['img', 'iframe', 'form', 'button'], FORBID_ATTR: ['style'] });
  }, [value]);
  if (mode === 'reading') return <div className="markdown-preview" onClick={event => { const link = (event.target as HTMLElement).closest('a'); if (!link) return; event.preventDefault(); const target = link.getAttribute('data-note'); if (target) onLink(target); }} dangerouslySetInnerHTML={{ __html: html }} />;
  return <CodeMirror aria-label="노트 편집기" editable={!disabled} readOnly={disabled} value={value} theme={dark ? 'dark' : 'light'} extensions={extensions} onChange={onChange} placeholder="생각을 적어 보세요. [[노트 이름]]으로 연결할 수 있습니다." basicSetup={{ lineNumbers, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }} />;
}
