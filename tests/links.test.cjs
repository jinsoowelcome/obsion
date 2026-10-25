const { test } = require('node:test');
const assert = require('node:assert/strict');

test('wiki links resolve folder-local notes and keep ambiguous basenames unresolved', async () => {
  const { resolveLink } = await import('../src/lib.ts');
  const notes = ['A/기록.md', 'B/기록.md', '홈.md'].map(path => ({ path, content: '', modified: 0 }));
  assert.equal(resolveLink('기록', 'A/오늘.md', notes), 'A/기록.md');
  assert.equal(resolveLink('A/기록', '홈.md', notes), 'A/기록.md');
  assert.equal(resolveLink('기록', '홈.md', notes), null);
});

test('code examples do not create backlinks and duplicate links create one graph edge', async () => {
  const { wikiLinks, createGraph } = await import('../src/lib.ts');
  const content = '[[홈|돌아가기]] [[홈]]\n\n`[[예시]]`\n\n```md\n[[코드]]\n```\n';
  assert.deepEqual(wikiLinks(content).map(link => link.target), ['홈', '홈']);
  const graph = createGraph([{ path: '노트.md', content, modified: 0 }, { path: '홈.md', content: '', modified: 0 }]);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.nodes.length, 2);
});

test('Markdown preview renders functional wiki anchors and leaves code examples literal', async () => {
  const { renderMarkdown } = await import('../src/render-markdown.ts');
  const html = renderMarkdown('[[홈|돌아가기]]\n\n`[[예시]]`\n\n```md\n[[코드]]\n```\n');
  assert.match(html, /data-note="홈"[^>]*>돌아가기<\/a>/);
  assert.doesNotMatch(html, /data-note="예시"|data-note="코드"/);
  assert.match(html, /<code>\[\[예시\]\]<\/code>/);
  assert.match(renderMarkdown('[[홈|<script>]]'), /&lt;script&gt;/);
});
