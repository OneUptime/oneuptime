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
 *
 * A surface that is no dialog - a dashboard shown full screen over the
 * page's header, menus and breadcrumbs (#10409), which stays up while the
 * person works - covers the page around it, not the app's own layers: the
 * command palette, Ask AI and the dialogs the app opens from any page sit
 * beside the page in its <main>, and its notes (ToastRegion) beside the app
 * in its root. It says so with a scope (PageInertScope): the walk stops at
 * a boundary (the app's root), and passes the children of the elements that
 * hold those layers by.
 */

import { MutableRefObject, RefObject, useLayoutEffect, useRef } from "react";

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
 * How far a surface's inert reaches. Left out, everything off its path to
 * <body> is inert, as a dialog needs.
 */
export interface PageInertScope {
  /*
   * Where the walk stops: neither this element's other children nor
   * anything above it is made inert. An app's root (#root), whose other
   * children are the layers it draws over every page.
   */
  boundary?: Element | null | undefined;
  /*
   * Elements on the path whose other children are left as they are: they
   * hold layers that work over the surface (an app's <main>, which holds
   * the command palette and the dialogs opened from any page). The walk
   * goes on above them.
   */
  keepChildrenOf?: ReadonlyArray<Element | null | undefined> | undefined;
}

/*
 * Makes everything outside `surface` inert, and returns what puts it back.
 * Elements already inert before (and not by this module) are left alone, so
 * the release never wakes something another part of the page put to sleep.
 * A scope keeps the walk inside the page around the surface (PageInertScope).
 */
export function makeOthersInert(
  surface: Element,
  scope?: PageInertScope | undefined,
): ReleasePageInertFunction {
  const held: Array<Element> = [];

  if (typeof document === "undefined") {
    return () => {};
  }

  const boundary: Element | null = scope?.boundary || null;
  const keptParents: Set<Element> = new Set<Element>();

  for (const element of scope?.keepChildrenOf || []) {
    if (element) {
      keptParents.add(element);
    }
  }

  let node: Element | null = surface;

  while (node && node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;

    // The boundary's other children are the app's own layers: the walk ends.
    if (boundary && parent === boundary) {
      break;
    }

    // Layers that work over the surface: passed by, and the walk goes on above.
    if (keptParents.has(parent)) {
      node = parent;
      continue;
    }

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
 * take a click or the focus in between. A scope, when one is given, is read
 * as the surface becomes active (getScope), from the page then on screen.
 */
export function usePageInert(
  isActive: boolean,
  surfaceRef: RefObject<Element>,
  getScope?: (() => PageInertScope) | undefined,
): void {
  /*
   * The latest getScope, read when the effect runs: a caller that hands a
   * new function on every render does not wake the page and put it to
   * sleep again with each one.
   */
  const getScopeRef: MutableRefObject<(() => PageInertScope) | undefined> =
    useRef<(() => PageInertScope) | undefined>(getScope);
  getScopeRef.current = getScope;

  useLayoutEffect(() => {
    const surface: Element | null = surfaceRef.current;

    if (!isActive || !surface) {
      return undefined;
    }

    return makeOthersInert(surface, getScopeRef.current?.());
  }, [isActive, surfaceRef]);
}
