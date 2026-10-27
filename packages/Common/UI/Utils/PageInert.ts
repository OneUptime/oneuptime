/*
 * The page behind a modal surface, made inert while the surface is open.
 *
 * aria-modal says "everything else is unavailable" to a screen reader that
 * honours it, and a focus trap keeps Tab inside the dialog - but neither
 * stops a screen reader's virtual cursor reading the page underneath, a
 * click landing on it through a gap, or a find-in-page jumping to text the
 * backdrop covers. `inert` does all of that: an inert element takes no
 * focus, no pointer events and leaves the accessibility tree.
 *
 * Everything that is not on the path from the surface up to <body> is made
 * inert: each ancestor's other children. A surface portalled into <body>
 * makes the app's root inert; one rendered in place makes every sibling
 * along its path inert. What opens later - a menu portalled into <body>, a
 * dialog stacked on top - is a new element, never made inert, so it still
 * works over the surface.
 *
 * Shared and counted, like PageScrollLock: two surfaces open at once (the
 * command palette over Ask AI) never hand the page back while one of them
 * is still up, and an element some other code made inert is left as it
 * was.
 */

import { RefObject, useLayoutEffect } from "react";

// How many open surfaces hold each element this module made inert.
const inertHolds: Map<Element, number> = new Map();

// Elements that are never part of what a person reads or reaches.
const IGNORED_TAGS: Set<string> = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "TEMPLATE",
  "NOSCRIPT",
]);

export type ReleasePageInertFunction = () => void;

/*
 * Makes everything outside `surface` inert, and returns what puts it back.
 * Elements already inert before (and not by this module) are left alone, so
 * the release never wakes something another part of the page put to sleep.
 */
export function makeOthersInert(surface: Element): ReleasePageInertFunction {
  const held: Array<Element> = [];

  if (typeof document === "undefined") {
    return () => {};
  }

  let node: Element | null = surface;

  while (node && node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;

    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || IGNORED_TAGS.has(sibling.tagName)) {
        continue;
      }

      const holds: number = inertHolds.get(sibling) || 0;

      if (holds === 0 && sibling.hasAttribute("inert")) {
        continue;
      }

      inertHolds.set(sibling, holds + 1);
      sibling.setAttribute("inert", "");
      held.push(sibling);
    }

    node = parent;
  }

  let isReleased: boolean = false;

  return (): void => {
    if (isReleased) {
      return;
    }

    isReleased = true;

    for (const element of held) {
      const holds: number = (inertHolds.get(element) || 1) - 1;

      if (holds > 0) {
        inertHolds.set(element, holds);
        continue;
      }

      inertHolds.delete(element);
      element.removeAttribute("inert");
    }
  };
}

/*
 * The declarative form: everything outside the surface is inert while
 * `isActive` holds and the surface is mounted. A layout effect, so the page
 * is inert before the first paint of the surface: nothing behind it can
 * take a click or the focus in between.
 */
export function usePageInert(
  isActive: boolean,
  surfaceRef: RefObject<Element>,
): void {
  useLayoutEffect(() => {
    const surface: Element | null = surfaceRef.current;

    if (!isActive || !surface) {
      return undefined;
    }

    return makeOthersInert(surface);
  }, [isActive, surfaceRef]);
}
