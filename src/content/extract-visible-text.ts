const NON_CONTENT_ELEMENTS = new Set(["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"]);

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function isElementVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (
      NON_CONTENT_ELEMENTS.has(current.tagName) ||
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden")?.toLowerCase() === "true"
    ) {
      return false;
    }

    const view: Window | null = current.ownerDocument.defaultView;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden") {
      return false;
    }
  }

  return true;
}

export function extractVisibleText(root: Element): string {
  if (!isElementVisible(root)) {
    return "";
  }

  const text: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && isElementVisible(parent)) {
      text.push(node.textContent ?? "");
    }
  }

  return collapseWhitespace(text.join(" "));
}
