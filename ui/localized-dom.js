import { t } from '../core/i18n.js';

const translatedAttributes = ['placeholder', 'title', 'aria-label'];
const excludedSelector = 'script, style, [data-i18n-dynamic], [data-i18n-ignore]';

/** Capture only the original document copy, before controls add dynamic content. */
export function initializeStaticLanguage(document) {
  const textEntries = [];
  const attributeEntries = [];
  const walker = document.createTreeWalker(document.documentElement, 4);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest(excludedSelector)) continue;
    const original = node.data;
    if (!original.trim()) continue;
    textEntries.push({ node, original, rendered: original, owned: true });
  }
  for (const element of document.querySelectorAll('*')) {
    if (element.closest(excludedSelector)) continue;
    for (const name of translatedAttributes) {
      if (!element.hasAttribute(name)) continue;
      const original = element.getAttribute(name);
      attributeEntries.push({ element, name, original, rendered: original, owned: true });
    }
  }

  const translate = (original) => {
    const content = original.trim();
    return original.replace(content, () => t(content));
  };

  return {
    refresh() {
      for (const entry of textEntries) {
        if (!entry.owned || !entry.node.isConnected) continue;
        // Once application code edits a node, it owns its future translations.
        if (entry.node.data !== entry.rendered) {
          entry.owned = false;
          continue;
        }
        entry.rendered = translate(entry.original);
        entry.node.data = entry.rendered;
      }
      for (const entry of attributeEntries) {
        if (!entry.owned || !entry.element.isConnected) continue;
        if (entry.element.getAttribute(entry.name) !== entry.rendered) {
          entry.owned = false;
          continue;
        }
        entry.rendered = translate(entry.original);
        entry.element.setAttribute(entry.name, entry.rendered);
      }
    }
  };
}
