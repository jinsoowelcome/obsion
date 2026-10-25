import { Marked } from 'marked';
import { escapeHTML } from './lib.ts';

const parser = new Marked({
  gfm: true,
  extensions: [{
    name: 'wikilink',
    level: 'inline',
    start(source: string) { return source.indexOf('[['); },
    tokenizer(source: string) {
      const match = /^\[\[([^\]\n]+)\]\]/.exec(source);
      if (!match) return;
      const [target, alias] = match[1].split('|');
      return { type: 'wikilink', raw: match[0], target, label: alias || target };
    },
    renderer(token) {
      return `<a href="#" data-note="${escapeHTML(String(token.target))}" class="internal-link">${escapeHTML(String(token.label))}</a>`;
    },
  }],
});

export const renderMarkdown = (source: string) => parser.parse(source, { async: false });
