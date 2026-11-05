// Notes workspace: link parsing, tags, frontmatter, backlinks, renames, search (pure logic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLinks, parseTags, parseFrontmatter, composeNote, setFrontmatter, buildIndex, applyMoves, linkTextFor,
  normalizePath, invalidNameReason, uniquePath, trashPathFor, restorePathFor, searchNotes, notesMentioning,
  appendLink, fillTemplate, TEMPLATES, isTrashed,
} from '../site/assets/js/notes/model.js';

const N = (path, body, updated = 0) => ({ path, body, updated });

test('parseLinks: names, aliases, headings, embeds; not inside code', () => {
  const links = parseLinks('See [[Aave]] and [[Research/Ondo|Ondo note]] or [[Pendle#Risks]], ![[Chart]].\n`[[not a link]]`\n```\n[[nor this]]\n```');
  assert.deepEqual(links.map((l) => [l.target, l.alias, l.heading, l.embed]), [
    ['Aave', null, null, false], ['Research/Ondo', 'Ondo note', null, false], ['Pendle', null, '#Risks', false], ['Chart', null, null, true],
  ]);
});

test('parseTags: inline and frontmatter tags; not headings, numbers, code or link text', () => {
  const body = '---\ntags: [defi, Lending]\n---\n# Heading\nA #thesis on #rwa/ondo, not #123 or `#code` or [[#x]] or http://a.com/#frag\n';
  assert.deepEqual(parseTags(body), ['defi', 'lending', 'rwa/ondo', 'thesis']);
  assert.deepEqual(parseTags('---\ntags:\n  - one\n  - two\n---\nbody'), ['one', 'two']);
});

test('frontmatter round-trips and keeps keys it does not manage', () => {
  const body = '---\ntitle: My note\ncustom: [1, 2]\ntags: [a]\n---\nHello';
  const fm = parseFrontmatter(body);
  assert.equal(fm.data.title, 'My note');
  assert.equal(fm.content, 'Hello');
  const out = setFrontmatter(body, { tags: ['a', 'b'], pinned: true });
  assert.equal(out, '---\ntitle: My note\ncustom: [1, 2]\ntags: [a, b]\npinned: true\n---\nHello');
  assert.equal(setFrontmatter(out, { pinned: null, tags: null, title: undefined }).includes('pinned'), false);
  assert.equal(composeNote('Just text', {}, {}), 'Just text', 'no frontmatter is added when nothing is set');
  assert.equal(parseFrontmatter('No frontmatter here').hasFrontmatter, false);
});

test('buildIndex: Obsidian resolution, backlinks and unresolved links', () => {
  const notes = [
    N('Aave.md', 'Links to [[Ondo]] and [[Missing note]].'),
    N('Research/Ondo.md', 'Back to [[aave]] (case-insensitive).'),
    N('Archive/Ondo.md', 'An older Ondo note.'),
    N('Research/Plan.md', '[[Ondo]] here means the one in my folder; [[Archive/Ondo]] is explicit.'),
    N('Alias.md', '---\naliases: [Sky Dollar]\n---\nUSDS'),
    N('Uses alias.md', 'About [[Sky Dollar]].'),
    N('.trash/Old.md', '[[Aave]] from the trash does not count.'),
  ];
  const idx = buildIndex(notes);
  assert.equal(idx.resolve('Ondo', 'Aave.md').path, 'Archive/Ondo.md', 'no folder match: the shortest path wins (ties by name)');
  assert.equal(idx.resolve('Ondo', 'Research/Plan.md').path, 'Research/Ondo.md', 'same folder wins');
  assert.equal(idx.resolve('Archive/Ondo').path, 'Archive/Ondo.md');
  assert.equal(idx.resolve('Sky Dollar').path, 'Alias.md', 'aliases resolve');
  assert.deepEqual(idx.backlinks.get('Aave.md').map((b) => b.from), ['Research/Ondo.md'], 'trash is ignored');
  assert.deepEqual(idx.unresolved.get('Missing note'), ['Aave.md']);
  assert.ok(!idx.outgoing.has('.trash/Old.md'));
});

test('applyMoves: renaming updates every link to the note, keeping alias, heading and embeds', () => {
  const notes = [
    N('Ideas/Aave.md', 'Self.'),
    N('Notes.md', 'Read [[Aave]], [[Aave|the lender]], [[Aave#Risks]] and ![[Ideas/Aave]]. Not [[Aavegotchi]].'),
    N('Other.md', '---\ntags: [x]\n---\n[[aave]] lower case too'),
  ];
  const { changed, notes: next } = applyMoves(notes, new Map([['Ideas/Aave.md', 'Ideas/Aave V4.md']]));
  assert.equal(changed.get('Notes.md'), 'Read [[Aave V4]], [[Aave V4|the lender]], [[Aave V4#Risks]] and ![[Aave V4]]. Not [[Aavegotchi]].');
  assert.equal(changed.get('Other.md'), '---\ntags: [x]\n---\n[[Aave V4]] lower case too', 'frontmatter kept');
  assert.ok(next.some((n) => n.path === 'Ideas/Aave V4.md'));
});

test('applyMoves: a name that becomes ambiguous is written as a path', () => {
  const notes = [N('A/Note.md', 'a'), N('B/Note.md', 'b'), N('C/Solo.md', 'c'), N('Ref.md', '[[Solo]] and [[A/Note]]')];
  assert.equal(linkTextFor('A/Note.md', notes), 'A/Note', 'two notes called Note: use the path');
  assert.equal(linkTextFor('C/Solo.md', notes), 'Solo');
  // Solo is renamed to Note too, so the link must now say which Note
  const r = applyMoves(notes, new Map([['C/Solo.md', 'C/Note.md']]));
  assert.equal(r.changed.get('Ref.md'), '[[C/Note]] and [[A/Note]]');
});

test('trash: links to a trashed note are left as written; restore finds a free name', () => {
  const notes = [N('Aave.md', 'x'), N('Index.md', '[[Aave]]')];
  const { changed } = applyMoves(notes, new Map([['Aave.md', trashPathFor('Aave.md')]]));
  assert.equal(changed.size, 0);
  assert.ok(isTrashed('.trash/Aave.md'));
  assert.equal(restorePathFor('.trash/Folder/Aave.md', ['Folder/Aave.md']), 'Folder/Aave (2).md');
  assert.equal(uniquePath('A.md', ['a.md', 'A (2).md']), 'A (3).md');
});

test('paths and names', () => {
  assert.equal(normalizePath(' Folder//Sub/ ../Name '), 'Folder/Sub/Name.md');
  assert.equal(invalidNameReason('Good name'), null);
  assert.ok(invalidNameReason('Bad [name]'));
  assert.ok(invalidNameReason('a/b'));
  assert.ok(invalidNameReason(''));
});

test('searchNotes: all words, name first, tag and folder filters, trash excluded', () => {
  const notes = [
    N('Research/Aave thesis.md', '#thesis Lending rates are rising.', 2),
    N('Daily/Mon.md', 'Looked at aave rates today. #daily', 3),
    N('.trash/Aave old.md', 'aave rates', 4),
  ];
  assert.deepEqual(searchNotes(notes, 'aave rates').map((r) => r.note.path), ['Research/Aave thesis.md', 'Daily/Mon.md']);
  assert.deepEqual(searchNotes(notes, 'rates', { tag: 'daily' }).map((r) => r.note.path), ['Daily/Mon.md']);
  assert.deepEqual(searchNotes(notes, '', { folder: 'Research' }).map((r) => r.note.path), ['Research/Aave thesis.md']);
});

test('notesMentioning: page links, names, capital tickers and tags; not lookalikes', () => {
  const notes = [
    N('a.md', 'Compare with [Aave page](#/protocol/aave).'),
    N('b.md', 'Watching ENA unlocks.'),
    N('c.md', 'Hype is everywhere, ena lowercase.'),
    N('d.md', '#ethena tag only'),
    N('e.md', 'Ethena basis trade'),
  ];
  assert.deepEqual(notesMentioning(notes, { hrefs: ['#/protocol/aave'] }).map((n) => n.path), ['a.md']);
  assert.deepEqual(notesMentioning(notes, { names: ['Ethena'], symbols: ['ENA'], slugs: ['ethena'] }).map((n) => n.path).sort(), ['b.md', 'd.md', 'e.md']);
});

test('appendLink and templates', () => {
  assert.equal(appendLink('Hello', 'Aave'), 'Hello\n\n[[Aave]]\n');
  assert.equal(appendLink('See [[Aave]]', 'aave'), 'See [[Aave]]', 'no duplicate link');
  const t = TEMPLATES.find((x) => x.id === 'protocol');
  const out = fillTemplate(t.body, { link: '[Aave](#/protocol/aave)', tag: '#aave' });
  assert.ok(out.startsWith('#protocol #aave\n\nDashboard: [Aave](#/protocol/aave)'));
  assert.ok(!out.includes('{{'));
});
