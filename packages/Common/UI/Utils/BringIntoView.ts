/*
 * Scrolls an element into view by as little as it takes - a form field that
 * a fold just showed, or the first field in error after the form's action
 * was pressed - in whatever scrolls around it: a dialog's body, the page,
 * or both.
 *
 * Only as much as needed (block "nearest"): an element already in view does
 * not move; one below the view comes up until its end is in view; one
 * taller than the view brings its start to the top, so a fold's header
 * stays in sight over the fields it opened. Smoothly, unless the reader
 * asks for less motion (prefers-reduced-motion), when it jumps.
 *
 * Nothing happens where there is nothing to scroll with: no element, or a
 * DOM without scrollIntoView (jsdom).
 */

export const prefersReducedMotion: () => boolean = (): boolean => {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
};

const bringIntoView: (element: Element | null | undefined) => void = (
  element: Element | null | undefined,
): void => {
  if (!element || typeof element.scrollIntoView !== "function") {
    return;
  }

  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
};

export default bringIntoView;
