// Minimal RSS 2.0 / Atom parser (no dependencies). Good enough for news,
// Medium and Discourse feeds: we only need title, link, date and a summary.
import { stripHtml, decodeEntities } from './util.mjs';

function tag(block, name) {
  // <name ...>value</name>, tolerant of namespaces like dc:creator
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function atomLink(block) {
  // prefer rel="alternate" (or no rel), fall back to the first href
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick =
    links.find((a) => /rel=["']alternate["']/i.test(a)) ||
    links.find((a) => !/rel=/i.test(a)) ||
    links[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : '';
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Parse feed XML into { title, items: [{title, link, date, summary, categories, author}] } */
export function parseFeed(xml) {
  if (typeof xml !== 'string' || !/<(rss|feed|rdf:RDF)\b/i.test(xml)) {
    throw new Error('Not an RSS or Atom feed');
  }
  const isAtom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml);
  const channelTitle = stripHtml(tag(xml.split(/<(item|entry)\b/i)[0], 'title'));
  const blocks = isAtom
    ? [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0])
    : [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);

  const items = blocks.map((b) => {
    const title = stripHtml(tag(b, 'title'));
    let link = isAtom ? atomLink(b) : decodeEntities(stripHtml(tag(b, 'link')));
    if (!link) link = stripHtml(tag(b, 'guid'));
    const date =
      parseDate(tag(b, 'pubDate')) ||
      parseDate(tag(b, 'published')) ||
      parseDate(tag(b, 'updated')) ||
      parseDate(tag(b, 'dc:date'));
    const summary = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || tag(b, 'content:encoded'));
    const categories = [...b.matchAll(/<category\b[^>]*?(?:term=["']([^"']+)["'][^>]*)?(?:\/>|>([\s\S]*?)<\/category>)/gi)]
      .map((m) => stripHtml(m[1] || m[2] || ''))
      .filter(Boolean);
    const author = stripHtml(tag(b, 'dc:creator') || tag(b, 'author'));
    return { title, link: link.trim(), date, summary, categories, author };
  });

  return { title: channelTitle, items: items.filter((i) => i.title && i.link) };
}
