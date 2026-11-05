// #/fundamentals/settings — your thresholds, value-accrual plans and team notes for the checklist.
// Defaults come from the public repo (site/config/*.json); what you change here overrides them for
// you only. Edits save in this browser and, if notes sync is on, sync to your private notes repo.
import { h, band, svgIcon } from '../ui.js';
import { downloadBlob } from '../export.js';
import { CHECKS, effectiveThresholds, evaluateAll } from './rules.js';
import { getUser, onUserChange, normalizeUser } from './settings.js';
import { validateEntry, upsertEntry, removeEntry, entryId, isHttpUrl, parseImport } from './merge.js';
import { startSettings, saveUser, storageStatus, settingsConflicts, dismissConflict, exportText } from './storage.js';
import { loadChecklist, statusBadge, settingsNotice } from './view.js';
import { fmtThreshold } from '../pages/fundamentals.js';
import { confirmBox, toast } from '../notes/dialog.js';
import { openSyncSettings } from '../notes/backup.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function render(root) {
  await startSettings();
  const r = await loadChecklist();
  root.append(band({
    n: '10',
    tag: 'Section 10 · Fundamentals Checklist',
    title: 'Checklist settings',
    sub: 'Change the thresholds, record announced fee switches or buybacks, and add team notes. The defaults come from the public repo; your changes apply only to you.',
    chips: [h('a', { class: 'band-chip', href: '#/fundamentals' }, '← Back to the checklist')],
  }));
  if (r.error) { root.append(h('div', { class: 'notice bad' }, r.error)); return; }
  const config = r.defaults.thresholds;
  const protocols = r.data.protocols.map((p) => ({ slug: p.slug, name: p.name }));
  const nameOf = (slug) => protocols.find((p) => p.slug === slug)?.name || slug;

  const statusEl = h('div');
  const conflictsEl = h('div');
  const noticeEl = h('div');
  const previewEl = h('section', { class: 'card fs-section', 'aria-live': 'polite' });
  root.append(statusEl, conflictsEl, noticeEl);

  // ---------- where it's saved ----------
  const drawStatus = () => {
    const s = storageStatus();
    statusEl.replaceChildren(h('div', { class: `notice ${s.persistent ? '' : 'warn'} fc-notice`, role: 'status' },
      !s.persistent
        ? [h('b', {}, 'Saved for this tab only. '), 'This browser won’t let the dashboard store data (a private window?), so your settings will be lost when you close it. Use Export to keep a copy.']
        : s.synced
          ? [h('b', {}, 'Saved in this browser and synced. '), `Your settings travel with your notes to ${s.repo} (file .dashboard/fundamentals-settings.json), using the same token.`, s.last?.at ? ` Last sync ${new Date(s.last.at).toLocaleString()}${s.last.error ? `: ${s.last.error}` : '.'}` : '']
          : [h('b', {}, 'Saved in this browser only. '), 'To keep your settings on other devices, turn on notes sync: they go to the same private repo as your notes, with no new token. ', h('button', { type: 'button', class: 'tool', onclick: () => openSyncSettings() }, 'Set up sync')]));
  };

  // ---------- conflicts from sync ----------
  const drawConflicts = () => {
    const list = settingsConflicts();
    conflictsEl.replaceChildren(...list.map((c) => h('section', { class: 'card fs-section fs-conflict' },
      h('div', { class: 'kicker' }, 'Sync conflict'),
      h('h3', { class: 'takeaway' }, `Another device changed the same settings (${c.at || 'recently'})`),
      h('p', {}, 'Your version is in use. Choose, for each one, whether to keep yours or use the other device’s. Nothing was overwritten.'),
      c.whole ? h('p', { class: 'muted' }, 'The other device’s file couldn’t be merged automatically. Its full contents are kept in .dashboard/conflicts/ in your notes repo.') : null,
      h('ul', { class: 'fs-entries' }, (c.conflicts || []).map((x) => h('li', {},
        h('div', {}, h('b', {}, x.kind === 'threshold' ? config.thresholds[x.key]?.label || x.key : `${x.kind === 'valueAccrual' ? 'Value-accrual entry' : 'Team note'} ${x.key}`),
          h('div', { class: 'muted' }, `Yours: ${describe(x.kind, x.key, x.mine)} · Theirs: ${describe(x.kind, x.key, x.theirs)}`)),
        h('button', { type: 'button', class: 'tool', onclick: () => useTheirs(x) }, 'Use theirs')))),
      h('div', { class: 'fs-actions' }, h('button', { type: 'button', class: 'tool primary', onclick: async () => { await dismissConflict(c.path); toast('Kept your settings'); drawConflicts(); } }, 'Done (keep the rest of mine)')))));
  };
  const describe = (kind, key, v) => {
    if (v === null || v === undefined) return kind === 'threshold' ? `default (${fmtThreshold(config.thresholds[key]?.default, config.thresholds[key]?.unit)})` : 'not there';
    if (v.deleted) return 'deleted';
    if (kind === 'threshold') return fmtThreshold(Number(v), config.thresholds[key]?.unit);
    return `“${String(v.what || v.text || '').slice(0, 60)}”`;
  };
  async function useTheirs(x) {
    const u = structuredClone(getUser());
    if (x.kind === 'threshold') { if (x.theirs === null) delete u.thresholds[x.key]; else u.thresholds[x.key] = x.theirs; } else {
      const l = u[x.kind];
      l.entries = l.entries.filter((e) => entryId(e) !== x.key);
      l.deleted = l.deleted.filter((d) => d !== x.key);
      if (x.theirs?.deleted) l.deleted.push(x.key); else if (x.theirs) l.entries.push(x.theirs);
    }
    await saveUser(u);
    toast('Using the other device’s value');
  }

  // ---------- thresholds ----------
  let draft = { ...getUser().thresholds };
  const inputs = new Map();
  const errEls = new Map();
  const tagEls = new Map();
  const formStatus = h('span', { class: 'fs-status muted', 'aria-live': 'polite' });
  const thrCard = h('section', { class: 'card fs-section', id: 'thresholds' },
    h('div', { class: 'kicker' }, 'Thresholds'),
    h('h2', { class: 'takeaway' }, 'When does a check count as ✓ strong or ✗ weak?'),
    h('p', { class: 'muted' }, 'Changes apply as you type. Impossible values (negative, out of range, or a ✓ cutoff weaker than the ✗ one) aren’t saved, and the checklist keeps using the last good value.'));
  for (const c of CHECKS) {
    const keys = Object.keys(config.thresholds).filter((k) => config.thresholds[k].check === c.id);
    if (!keys.length) continue;
    thrCard.append(h('h3', { class: 'fs-group' }, `${c.n}. ${c.label}`));
    for (const k of keys) {
      const m = config.thresholds[k];
      const id = `th-${k.replace('.', '-')}`;
      const input = h('input', { id, type: 'number', inputmode: 'decimal', step: 'any', min: m.min, max: m.max, value: draft[k] ?? m.default, 'aria-describedby': `${id}-help` });
      input.addEventListener('input', () => onEdit(k, input.value));
      inputs.set(k, input);
      const err = h('p', { class: 'fs-err', hidden: true, role: 'alert' });
      errEls.set(k, err);
      const tag = h('span', { class: 'fc-tag', hidden: true }, 'changed');
      tagEls.set(k, tag);
      thrCard.append(h('div', { class: 'fs-row' },
        h('label', { for: id }, m.label, ' ', tag),
        h('div', { class: 'fs-input' }, input, h('span', { class: 'fs-unit' }, m.unit === 'usd' ? 'USD' : m.unit)),
        h('div', { class: 'fs-default' }, `Default ${fmtThreshold(m.default, m.unit)} `, h('button', { type: 'button', class: 'tool', 'aria-label': `Reset ${m.label} to the default`, onclick: () => { input.value = m.default; onEdit(k, String(m.default)); } }, 'Reset')),
        h('p', { class: 'fs-help', id: `${id}-help` }, m.help),
        err));
    }
  }
  thrCard.append(h('div', { class: 'fs-actions' },
    h('button', { type: 'button', class: 'tool', onclick: async () => {
      if (!(await confirmBox({ title: 'Reset all thresholds', text: 'Go back to the default for every threshold? Your value-accrual entries and team notes stay.', ok: 'Reset all' }))) return;
      draft = {};
      for (const [k, input] of inputs) input.value = config.thresholds[k].default;
      await saveUser({ ...getUser(), thresholds: {} });
      refreshThresholds();
      toast('All thresholds are back to the defaults');
    } }, 'Reset all thresholds'), formStatus));

  let saveTimer = null;
  function onEdit(k, raw) {
    const m = config.thresholds[k];
    if (raw === '' || Number(raw) === m.default) delete draft[k]; else draft[k] = raw === '' ? raw : Number(raw);
    refreshThresholds();
    clearTimeout(saveTimer);
    const { errors } = effectiveThresholds(config, draft);
    if (errors.length) { formStatus.textContent = 'Not saved: fix the highlighted value first.'; return; }
    formStatus.textContent = 'Saving…';
    saveTimer = setTimeout(async () => { await saveUser({ ...getUser(), thresholds: { ...draft } }); formStatus.textContent = 'Saved.'; }, 350);
  }
  function refreshThresholds() {
    const { errors, values } = effectiveThresholds(config, draft);
    const byKey = new Map();
    for (const e of errors) {
      byKey.set(e.key, e.message);
      const pair = (config.order || []).find((o) => o.strong === e.key && /must be (higher|lower) than/.test(e.message));
      if (pair) byKey.set(pair.weak, e.message);
    }
    for (const [k, input] of inputs) {
      const msg = byKey.get(k);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      errEls.get(k).hidden = !msg;
      errEls.get(k).textContent = msg || '';
      tagEls.get(k).hidden = !(k in draft) || Boolean(msg);
    }
    drawPreview(values, errors.length);
  }

  // ---------- live preview ----------
  const defaultsEval = evaluateAll(r.data.protocols, effectiveThresholds(config, {}).values, { valueAccrual: r.eff.valueAccrual, teamNotes: r.eff.teamNotes, now: r.now });
  function drawPreview(values, nErrors) {
    const eff = { va: currentEntries('valueAccrual'), tn: currentEntries('teamNotes') };
    const rows = evaluateAll(r.data.protocols, values, { valueAccrual: eff.va, teamNotes: eff.tn, now: r.now });
    let diffs = 0;
    const body = rows.map((row, i) => h('tr', {},
      h('th', { scope: 'row' }, h('a', { href: `#/fundamentals/${row.p.slug}` }, row.p.name)),
      CHECKS.map((c) => {
        const now = row.checks[c.id].status;
        const before = defaultsEval[i].checks[c.id].status;
        if (now !== before) diffs += 1;
        return h('td', { class: now !== before ? 'fc-diff' : '', title: now !== before ? `With the defaults: ${before}` : row.checks[c.id].why }, statusBadge(now, { short: true }), now !== before ? h('span', { class: 'sr-only' }, ` (default: ${before})`) : null);
      })));
    previewEl.replaceChildren(...[
      h('div', { class: 'kicker' }, 'Live preview'),
      h('h2', { class: 'takeaway' }, diffs ? `Your settings change ${diffs} status${diffs > 1 ? 'es' : ''} from the defaults` : 'Every status matches the defaults'),
      nErrors ? h('p', { class: 'fs-err' }, 'Values that aren’t valid are shown with their default in this preview.') : null,
      h('p', { class: 'muted' }, 'Outlined cells differ from the defaults (hover for the default).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'fc-preview' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Protocol'), CHECKS.map((c) => h('th', { scope: 'col' }, `${c.n}. ${c.label}`)))),
        h('tbody', {}, body))),
    ].filter(Boolean));
  }
  const currentEntries = (kind) => {
    const defaults = r.defaults[kind]?.entries || [];
    const over = getUser()[kind];
    const deleted = new Set(over.deleted);
    const mine = new Map(over.entries.map((e) => [entryId(e), e]));
    const out = defaults.filter((d) => !deleted.has(entryId(d))).map((d) => mine.get(entryId(d)) || d);
    for (const [id, e] of mine) if (!defaults.some((d) => entryId(d) === id)) out.push(e);
    return out.filter((e) => !validateEntry(kind, e).length);
  };

  // ---------- value-accrual entries and team notes ----------
  const vaCard = listEditor({
    kind: 'valueAccrual',
    id: 'value-accrual',
    kicker: 'Value accrual',
    title: 'Announced fee switches, buybacks and revenue sharing',
    intro: 'For check 3. Record a plan only when you’ve confirmed it from a primary source (a passed vote or an official announcement). A protocol with the “lots of revenue, little to holders” pattern and an entry here shows ✓.',
    fields: [
      { key: 'protocol', label: 'Protocol', type: 'select' },
      { key: 'status', label: 'Status', type: 'select', options: [['proposed', 'Proposed'], ['approved', 'Approved'], ['live', 'Live']] },
      { key: 'what', label: 'What was announced (one sentence)', type: 'text', wide: true },
      { key: 'source', label: 'Source link (http or https)', type: 'url', wide: true },
      { key: 'date', label: 'Announced on', type: 'date' },
      { key: 'lastChecked', label: 'Last checked', type: 'date' },
    ],
    summary: (e) => [h('b', {}, nameOf(e.protocol)), ` · ${e.status || 'status not set'}${e.date ? ` · ${e.date}` : ''}`, h('div', {}, e.what), h('div', { class: 'muted' }, h('a', { href: e.source, target: '_blank', rel: 'noopener noreferrer' }, e.source), ` · last checked ${e.lastChecked}`)],
  });
  const tnCard = listEditor({
    kind: 'teamNotes',
    id: 'team-notes',
    kicker: 'Team notes',
    title: 'Team background, with sources',
    intro: 'For check 6. Shown as context next to the track record, with your links. It never changes a status.',
    fields: [
      { key: 'protocol', label: 'Protocol', type: 'select' },
      { key: 'lastChecked', label: 'Last checked', type: 'date' },
      { key: 'text', label: 'Note (one or two sentences)', type: 'textarea', wide: true },
      { key: 'sources', label: 'Source links, one per line', type: 'lines', wide: true },
    ],
    summary: (e) => [h('b', {}, nameOf(e.protocol)), h('div', {}, e.text), h('div', { class: 'muted' }, (e.sources || []).flatMap((u, i) => [i ? ' · ' : '', h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u)]), ` · last checked ${e.lastChecked}`)],
  });

  function listEditor({ kind, id, kicker, title, intro, fields, summary }) {
    const card = h('section', { class: 'card fs-section', id });
    const draw = (editing = null) => {
      const defaults = r.defaults[kind]?.entries || [];
      const over = getUser()[kind];
      const deleted = new Set(over.deleted);
      const mine = new Map(over.entries.map((e) => [entryId(e), e]));
      const rows = [
        ...defaults.filter((d) => !deleted.has(entryId(d))).map((d) => ({ e: mine.get(entryId(d)) || d, origin: mine.has(entryId(d)) ? 'edited' : 'default' })),
        ...[...mine].filter(([eid]) => !defaults.some((d) => entryId(d) === eid)).map(([, e]) => ({ e, origin: 'yours' })),
      ];
      const items = rows.map(({ e, origin }) => {
        const eid = entryId(e);
        const bad = validateEntry(kind, e);
        return h('li', {},
          h('div', {}, summary(e), h('div', {}, h('span', { class: 'fc-tag' }, origin === 'default' ? 'default' : origin === 'edited' ? 'your edit' : 'yours')), bad.length ? h('p', { class: 'fs-err' }, `Not used: ${bad.join(' ')}`) : null),
          h('div', { class: 'fs-actions' },
            h('button', { type: 'button', class: 'tool', onclick: () => draw({ entry: e, id: eid }) }, 'Edit'),
            h('button', { type: 'button', class: 'tool', onclick: async () => {
              if (!(await confirmBox({ title: 'Delete entry', text: `Delete this ${kind === 'valueAccrual' ? 'entry' : 'note'} for ${nameOf(e.protocol)}?${origin !== 'yours' ? ' It comes from the defaults, so it will be hidden for you only.' : ''}`, ok: 'Delete', danger: true }))) return;
              await saveUser({ ...getUser(), [kind]: removeEntry(getUser()[kind], eid, origin !== 'yours') });
              toast('Deleted');
            } }, 'Delete')));
      });
      card.replaceChildren(
        h('div', { class: 'kicker' }, kicker),
        h('h2', { class: 'takeaway' }, title),
        h('p', { class: 'muted' }, intro),
        rows.length ? h('ul', { class: 'fs-entries' }, items) : h('p', { class: 'muted' }, `None yet. The public file (config/${kind === 'valueAccrual' ? 'value-accrual' : 'team-notes'}.json) is empty until someone adds confirmed entries.`),
        editing ? form(editing) : h('div', { class: 'fs-actions' }, h('button', { type: 'button', class: 'tool primary', onclick: () => draw({ entry: { lastChecked: today() }, id: null }) }, svgIcon('plus'), kind === 'valueAccrual' ? 'Add a plan' : 'Add a team note')));
      if (editing) card.querySelector('.fs-form input, .fs-form select, .fs-form textarea')?.focus();
    };
    const form = ({ entry, id: replacing }) => {
      const els = {};
      const errBox = h('div', { class: 'fs-err', hidden: true, role: 'alert' });
      const f = h('form', { class: 'fs-form', novalidate: true });
      for (const fd of fields) {
        let el;
        if (fd.type === 'select') {
          const opts = fd.options || protocols.map((p) => [p.slug, p.name]);
          el = h('select', { name: fd.key }, fd.key === 'status' ? null : h('option', { value: '' }, 'Choose…'), opts.map(([v, l]) => h('option', { value: v, selected: entry[fd.key] === v }, l)));
        } else if (fd.type === 'textarea' || fd.type === 'lines') {
          el = h('textarea', { name: fd.key });
          el.value = fd.type === 'lines' ? (entry[fd.key] || []).join('\n') : entry[fd.key] || '';
        } else el = h('input', { name: fd.key, type: fd.type === 'url' ? 'url' : fd.type, value: entry[fd.key] || '', placeholder: fd.type === 'url' ? 'https://…' : null });
        els[fd.key] = el;
        f.append(h('label', { class: fd.wide ? 'wide' : '' }, fd.label, el));
      }
      f.append(h('div', { class: 'wide' }, errBox), h('div', { class: 'fs-actions wide' },
        h('button', { type: 'submit', class: 'tool primary' }, 'Save'),
        h('button', { type: 'button', class: 'tool', onclick: () => draw(null) }, 'Cancel')));
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const next = { ...entry };
        delete next.origin;
        for (const fd of fields) {
          const v = els[fd.key].value.trim();
          if (fd.type === 'lines') next[fd.key] = v.split(/\s*\n\s*/).filter(Boolean);
          else if (v) next[fd.key] = v; else delete next[fd.key];
        }
        if (!next.id) next.id = replacing || `mine-${Date.now().toString(36)}`;
        const bad = validateEntry(kind, next);
        const urlField = fields.find((x) => x.type === 'url' || x.type === 'lines');
        if (urlField) els[urlField.key].setAttribute('aria-invalid', String(urlField.type === 'url' ? !isHttpUrl(next[urlField.key]) : (next[urlField.key] || []).some((u) => !isHttpUrl(u)) || !(next[urlField.key] || []).length));
        if (bad.length) { errBox.hidden = false; errBox.textContent = bad.join(' '); return; }
        await saveUser({ ...getUser(), [kind]: upsertEntry(getUser()[kind], next, { replacing }) });
        toast('Saved');
        draw(null);
      });
      return f;
    };
    card.redraw = () => draw(null);
    draw(null);
    return card;
  }

  // ---------- export / import / reset ----------
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const { user, problems } = parseImport(await file.text());
    if (!user) { toast(problems.join(' '), { error: true }); return; }
    const nT = Object.keys(user.thresholds).length;
    const { errors } = effectiveThresholds(config, user.thresholds);
    const ok = await confirmBox({
      title: 'Import settings',
      text: `Replace your current checklist settings with the ones in “${file.name}”? It has ${nT} changed threshold${nT === 1 ? '' : 's'}, ${user.valueAccrual.entries.length} value-accrual entr${user.valueAccrual.entries.length === 1 ? 'y' : 'ies'} and ${user.teamNotes.entries.length} team note${user.teamNotes.entries.length === 1 ? '' : 's'}.${errors.length ? ` ${errors.length} value${errors.length > 1 ? 's' : ''} in it ${errors.length > 1 ? 'aren’t' : 'isn’t'} valid and will use the default.` : ''}${problems.length ? ` ${problems.join(' ')}` : ''} Export your current settings first if you might want them back.`,
      ok: 'Replace',
    });
    if (!ok) return;
    await saveUser(normalizeUser(user));
    toast('Settings imported');
  });
  const ioCard = h('section', { class: 'card fs-section', id: 'backup' },
    h('div', { class: 'kicker' }, 'Export, import, reset'),
    h('h2', { class: 'takeaway' }, 'Keep a copy of your settings'),
    h('p', { class: 'muted' }, 'Export saves only your changes (not the defaults) as a JSON file. Importing replaces your current settings after asking.'),
    h('div', { class: 'fs-actions' },
      h('button', { type: 'button', class: 'tool', onclick: () => downloadBlob(new Blob([exportText()], { type: 'application/json' }), `fundamentals-settings-${today()}.json`) }, svgIcon('csv'), 'Export settings'),
      h('button', { type: 'button', class: 'tool', onclick: () => fileInput.click() }, 'Import settings…'), fileInput,
      h('button', { type: 'button', class: 'tool primary danger', onclick: async () => {
        if (!(await confirmBox({ title: 'Reset everything', text: 'Remove all your checklist changes (thresholds, entries and notes) and go back to the defaults?', ok: 'Reset everything', danger: true }))) return;
        await saveUser(normalizeUser(null));
        toast('Back to the defaults');
      } }, 'Reset everything')));

  root.append(thrCard, previewEl, vaCard, tnCard, ioCard);

  const redrawAll = async () => {
    const fresh = await loadChecklist();
    noticeEl.replaceChildren(...(fresh.eff ? settingsNotice(fresh.eff) : []));
    drawStatus();
    drawConflicts();
    draft = { ...getUser().thresholds };
    for (const [k, input] of inputs) if (document.activeElement !== input) input.value = draft[k] ?? config.thresholds[k].default;
    refreshThresholds();
    vaCard.redraw();
    tnCard.redraw();
  };
  await redrawAll();
  // another tab, an import or a sync changed the settings: show them
  const off = onUserChange(() => { if (!root.isConnected) { off(); return; } redrawAll(); });
}
