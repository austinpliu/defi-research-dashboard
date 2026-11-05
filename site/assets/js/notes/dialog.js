// Small accessible dialogs and pop-up menus for the notes workspace (no window.prompt).
import { h } from '../ui.js';

function modal(title, body, actions) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { dlg.remove(); prev?.focus?.(); resolve(v); };
    const dlg = h('div', { class: 'nd-backdrop', onclick: (e) => { if (e.target === dlg) close(null); } },
      h('div', { class: 'nd card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', { class: 'nd-title' }, title),
        body,
        h('div', { class: 'nd-actions' }, actions(close))));
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } });
    document.body.append(dlg);
    (dlg.querySelector('input, select, textarea') || dlg.querySelector('button.primary') || dlg.querySelector('button'))?.focus();
  });
}

/** Ask for a line of text. Resolves to the text, or null if cancelled. `validate` returns an error or null. */
export function askText({ title, label, value = '', ok = 'OK', validate = () => null, hint = '' }) {
  const input = h('input', { type: 'text', value, 'aria-label': label, class: 'nd-input' });
  const err = h('div', { class: 'nd-err', role: 'alert' });
  return modal(title, h('div', {}, h('label', { class: 'nd-label' }, label), input, hint ? h('div', { class: 'nd-hint' }, hint) : null, err), (close) => {
    const submit = () => { const v = input.value.trim(); const e = validate(v); if (e) { err.textContent = e; input.focus(); return; } close(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    setTimeout(() => input.select(), 0);
    return [h('button', { type: 'button', class: 'tool', onclick: () => close(null) }, 'Cancel'), h('button', { type: 'button', class: 'tool primary', onclick: submit }, ok)];
  });
}

export function confirmBox({ title, text, ok = 'OK', danger = false }) {
  return modal(title, h('p', { class: 'nd-text' }, text), (close) => [
    h('button', { type: 'button', class: 'tool', onclick: () => close(false) }, 'Cancel'),
    h('button', { type: 'button', class: `tool primary${danger ? ' danger' : ''}`, onclick: () => close(true) }, ok),
  ]);
}

/** Pick one option. options: [{ value, label }]. */
export function choose({ title, label, options, value = null, ok = 'OK' }) {
  const sel = h('select', { class: 'nd-input', 'aria-label': label }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  return modal(title, h('div', {}, h('label', { class: 'nd-label' }, label), sel), (close) => [
    h('button', { type: 'button', class: 'tool', onclick: () => close(null) }, 'Cancel'),
    h('button', { type: 'button', class: 'tool primary', onclick: () => close(sel.value) }, ok),
  ]);
}

/** A pop-up menu next to `anchor`. items: [{ label, onClick, danger }] (null = separator). */
export function popMenu(anchor, items) {
  document.querySelectorAll('.nm').forEach((m) => m.remove());
  const menu = h('div', { class: 'nm card', role: 'menu' }, items.map((it) => (it
    ? h('button', { type: 'button', role: 'menuitem', class: `nm-item${it.danger ? ' danger' : ''}`, onclick: () => { menu.remove(); it.onClick(); } }, it.label)
    : h('div', { class: 'nm-sep', role: 'separator' }))));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + scrollX}px`;
  menu.style.top = `${r.bottom + 4 + scrollY}px`;
  menu.querySelector('button')?.focus();
  const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  menu.addEventListener('keydown', (e) => {
    const btns = [...menu.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { menu.remove(); anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  });
  return menu;
}

/** A short message at the bottom of the screen. */
export function toast(text, { error = false } = {}) {
  const t = h('div', { class: `nt${error ? ' error' : ''}`, role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}
