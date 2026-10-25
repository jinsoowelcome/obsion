import type { NoteFile } from './types';

export const titleOf = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
export const pathWithoutExtension = (path: string) => path.replace(/\.md$/i, '');
export const canonical = (value: string) => value.normalize('NFC').toLocaleLowerCase();
export function proseOnly(content: string) {
  return content.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)/g, '').replace(/`[^`\n]+`/g, '');
}
export function wikiLinks(content: string): { target: string; label: string }[] {
  return [...proseOnly(content).matchAll(/\[\[([^\]\n]+)\]\]/g)].map(match => {
    const [target, label] = match[1].split('|');
    return { target: target.split('#')[0].trim(), label: label?.trim() || target.trim() };
  }).filter(link => link.target);
}
export function resolveLink(target: string, source: string, notes: NoteFile[]) {
  const name = pathWithoutExtension(target).replace(/^\//, '');
  const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
  const candidates = [folder + name, name];
  for (const candidate of candidates) {
    const exact = notes.find(note => canonical(pathWithoutExtension(note.path)) === canonical(candidate));
    if (exact) return exact.path;
  }
  const matches = notes.filter(note => canonical(titleOf(note.path)) === canonical(name));
  return matches.length === 1 ? matches[0].path : null;
}
export function createGraph(notes: NoteFile[]) {
  const nodes = notes.map(note => ({ id: note.path, label: titleOf(note.path), missing: false }));
  const edges: { source: string; target: string }[] = [];
  for (const note of notes) for (const link of wikiLinks(note.content)) {
    const resolved = resolveLink(link.target, note.path, notes);
    const target = resolved || `?${link.target}`;
    if (!resolved && !nodes.some(node => node.id === target)) nodes.push({ id: target, label: link.target, missing: true });
    if (!edges.some(edge => edge.source === note.path && edge.target === target)) edges.push({ source: note.path, target });
  }
  return { nodes, edges };
}
export function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}
export const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
