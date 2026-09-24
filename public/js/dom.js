// Tiny element builder. Strings are always inserted as text nodes, never as
// markup, so nothing from a model or an alert can inject HTML. The one escape
// hatch, the `html` prop, is only ever fed output that was escaped upstream.

export function h(tag, props, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      element.className = value;
    } else if (key === "html") {
      element.innerHTML = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, value === true ? "" : String(value));
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Replaces a container's content only when `key` changed, so scroll position
 * and focus inside untouched regions survive a stream of events. */
export function mount(container, key, build) {
  if (container.dataset.key === key) return false;
  container.dataset.key = key;
  container.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
  return true;
}

/** Runs `render`, then puts keyboard focus back on the element that had it. */
export function preservingFocus(root, render) {
  const active = document.activeElement;
  const marker = active instanceof HTMLElement && root.contains(active) ? active.dataset.focusId : undefined;
  render();
  if (marker) {
    root.querySelector(`[data-focus-id="${CSS.escape(marker)}"]`)?.focus({ preventScroll: true });
  }
}
