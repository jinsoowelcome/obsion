import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus, Settings2, Sparkles } from 'lucide-react';
import { createGraph } from './lib';
import type { NoteFile } from './types';

export default function Graph({ notes, active, onOpen }: { notes: NoteFile[]; active: string; onOpen(id: string): void }) {
  const graph = useMemo(() => createGraph(notes), [notes.map(n => n.path + n.content).join('\0')]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 500, height: 600 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [settings, setSettings] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [labels, setLabels] = useState(true);
  const [rerun, setRerun] = useState(0);
  const drag = useRef<{ x: number; y: number; originalX: number; originalY: number; moved: boolean } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const nodes = graph.nodes.map((node, i) => ({ id: node.id, x: size.width / 2 + Math.cos(i * 2.39996 + .8) * (graph.nodes.length < 3 ? 76 : 110), y: size.height * .46 + Math.sin(i * 2.39996 + .8) * (graph.nodes.length < 3 ? 76 : 110), vx: 0, vy: 0 }));
    if (nodes.length === 1) { nodes[0].x = size.width / 2; nodes[0].y = size.height * .46; }
    let frame = 0; let tick = 0;
    function step() {
      for (const n of nodes) { n.vx += (size.width / 2 - n.x) * .001; n.vy += (size.height * .46 - n.y) * .001; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x || .1, dy = a.y - b.y || .1;
        const d = Math.max(30, Math.hypot(dx, dy)); const force = 1800 / (d * d);
        a.vx += dx / d * force; a.vy += dy / d * force; b.vx -= dx / d * force; b.vy -= dy / d * force;
      }
      for (const edge of graph.edges) {
        const a = nodes.find(n => n.id === edge.source), b = nodes.find(n => n.id === edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy)); const force = (d - 125) * .004;
        a.vx += dx / d * force; a.vy += dy / d * force; b.vx -= dx / d * force; b.vy -= dy / d * force;
      }
      for (const n of nodes) { n.vx *= .82; n.vy *= .82; n.x += n.vx; n.y += n.vy; }
      setPositions(Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y }])));
      if (++tick < 100) frame = requestAnimationFrame(step);
    }
    step();
    return () => cancelAnimationFrame(frame);
  }, [graph, size, rerun]);
  const connected = new Set(graph.edges.flatMap(edge => [edge.source, edge.target]));
  const visibleNodes = graph.nodes.filter(node => orphans || connected.has(node.id));
  const reset = () => setTransform({ x: 0, y: 0, scale: 1 });
  return <div className="graph-space" ref={host}>
    <div className="graph-tools">
      <button className={settings ? 'icon-button active' : 'icon-button'} title="그래프 설정" aria-label="그래프 설정" onClick={() => setSettings(!settings)}><Settings2 size={18} /></button>
      <button className="icon-button" title="그래프 다시 배치" aria-label="그래프 다시 배치" onClick={() => { setRerun(rerun + 1); reset(); }}><Sparkles size={18} /></button>
    </div>
    {settings && <div className="graph-settings floating-panel"><strong>그래프 표시</strong><label><input type="checkbox" checked={orphans} onChange={e => setOrphans(e.target.checked)} /> 연결되지 않은 노트</label><label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} /> 노트 이름</label><span className="muted">노드를 클릭하면 노트가 열립니다.</span></div>}
    <svg aria-label="노트 연결 그래프" width="100%" height="100%" onWheel={event => { event.preventDefault(); const scale = Math.max(.3, Math.min(3, transform.scale * (event.deltaY < 0 ? 1.08 : .92))); setTransform(t => ({ ...t, scale })); }} onPointerDown={event => { if ((event.target as Element).closest('[data-node]')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, originalX: transform.x, originalY: transform.y, moved: false }; }} onPointerMove={event => { if (!drag.current) return; drag.current.moved = true; setTransform(t => ({ ...t, x: drag.current!.originalX + event.clientX - drag.current!.x, y: drag.current!.originalY + event.clientY - drag.current!.y })); }} onPointerUp={() => { drag.current = null; }}>
      <g transform={`translate(${transform.x + size.width / 2} ${transform.y + size.height / 2}) scale(${transform.scale}) translate(${-size.width / 2} ${-size.height / 2})`}>
        {graph.edges.map(edge => { const a = positions[edge.source], b = positions[edge.target]; return a && b ? <line key={edge.source + edge.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--graph-line)" strokeWidth={1} /> : null; })}
        {visibleNodes.map(node => { const p = positions[node.id]; return p ? <g key={node.id} data-node={node.id} role="button" tabIndex={0} aria-label={`노트 열기: ${node.label}`} className="graph-node" transform={`translate(${p.x},${p.y})`} onClick={() => onOpen(node.id)} onKeyDown={e => { if (e.key === 'Enter') onOpen(node.id); }}><circle r={node.id === active ? 5.5 : 4.5} fill={node.id === active ? 'var(--accent)' : node.missing ? 'var(--graph-missing)' : 'var(--graph-node)'} />{labels && <text textAnchor="middle" y={20} fill="var(--text)" fontSize={11}>{node.label}</text>}</g> : null; })}
      </g>
    </svg>
    {!graph.nodes.length && <div className="graph-empty muted">노트를 만들면 연결이 여기에 표시됩니다.</div>}
    <div className="graph-zoom"><button className="icon-button" title="축소" aria-label="그래프 축소" onClick={() => setTransform(t => ({ ...t, scale: Math.max(.3, t.scale - .15) }))}><Minus size={15} /></button><button className="icon-button" title="화면에 맞추기" aria-label="그래프 화면에 맞추기" onClick={reset}><Maximize size={14} /></button><button className="icon-button" title="확대" aria-label="그래프 확대" onClick={() => setTransform(t => ({ ...t, scale: Math.min(3, t.scale + .15) }))}><Plus size={15} /></button></div>
  </div>;
}
