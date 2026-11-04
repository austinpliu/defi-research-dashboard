// 07 — Glossary
import { h, band } from '../ui.js';
import { GLOSSARY } from '../glossary.js';

export async function render(root) {
  root.append(band({ n: '07', tag: 'Section 07 · Glossary', title: 'Plain-English glossary', sub: 'Every metric on this site in one sentence. The same explanations appear when you hover or tap a (?) next to a number.' }));
  const search = h('input', { type: 'search', placeholder: 'Filter terms…', 'aria-label': 'Filter glossary terms', style: { width: '260px' } });
  const grid = h('div', { class: 'gloss' });
  const entries = Object.entries(GLOSSARY).sort((a, b) => a[1].term.localeCompare(b[1].term));
  const render2 = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren(...entries.filter(([, g]) => !q || `${g.term} ${g.def}`.toLowerCase().includes(q)).map(([key, g]) => h('section', { class: 'card flat', id: `term-${key}` }, h('h3', {}, g.term), h('p', {}, g.def))));
  };
  search.addEventListener('input', render2);
  render2();
  root.append(h('div', { class: 'filters' }, h('label', { class: 'lbl' }, `${entries.length} terms`), search), grid);
}
