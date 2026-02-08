/**
 * Shared DOM utilities for the sprites tab.
 */

/** Create a DOM element with an optional class name. */
export function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Create a titled sidebar section and append it to a parent. */
export function sidebarSection(parent, title) {
  const section = el('div', 'sidebar-section');
  const h2 = el('h2');
  h2.textContent = title;
  section.appendChild(h2);
  parent.appendChild(section);
  return section;
}
