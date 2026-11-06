/*
 * A surface docked to the end of the window - Ask AI, working beside the page
 * rather than over it - takes its width from the page instead of covering it.
 *
 * The page is what makes room: <html> is padded on the side the surface sits
 * on (the end of the line, so the left on a page read right to left), and
 * everything in the page's flow, its sticky header and side menu included,
 * lays itself out in what is left. Nothing is behind the surface and nothing
 * is out of reach: the page keeps its scrollbar, its links and its keys.
 *
 * What is not in the page's flow does not move by itself. A surface pinned to
 * the end of the window - a side panel, a detail drawer - reads the same width
 * and stops short of the dock (PAGE_DOCK_END_CLASS_NAME), or it would open
 * behind the very panel it was asked about. A full-window dialog stays as it
 * is: it asks for the whole window for as long as it is up.
 *
 * On <html>, not <body>: PageScrollLock writes the body's padding to hold the
 * page still while it hides the scrollbar, and the two must not take turns
 * over one value.
 *
 * Only one surface docks at a time, and React is only in the hook.
 */

import { useLayoutEffect } from "react";

// How wide the docked surface is, or unset while nothing is docked.
export const PAGE_DOCK_WIDTH_VARIABLE: string = "--page-dock-width";

/*
 * For a surface pinned to the end of the window: it ends where the dock
 * starts, and at the window's edge when nothing is docked. Written out for
 * Tailwind to find, which is why it does not read the constant above.
 */
export const PAGE_DOCK_END_CLASS_NAME: string =
  "end-[var(--page-dock-width,0px)]";

const PAGE_END_PADDING_PROPERTY: string = "padding-inline-end";

// The width the page was last told about, so it is told once for each.
let announcedWidth: string = "";

/*
 * Tells whatever measures itself on a window resize that its room changed: a
 * dashboard's grid or a side menu that fits itself to the page. A window that
 * stays the same size would otherwise leave them drawn as wide as before,
 * running on under the dock.
 */
function announcePageWidthChanged(width: string): void {
  if (width === announcedWidth || typeof window === "undefined") {
    return;
  }

  announcedWidth = width;
  window.dispatchEvent(new Event("resize"));
}

function writePageDockWidth(value: string): void {
  const style: CSSStyleDeclaration = document.documentElement.style;

  style.setProperty(PAGE_DOCK_WIDTH_VARIABLE, value);
  style.setProperty(
    PAGE_END_PADDING_PROPERTY,
    `var(${PAGE_DOCK_WIDTH_VARIABLE})`,
  );
}

/*
 * While the surface's edge is being dragged: the page follows, and what lays
 * itself out by the browser's own means (a flexbox, a ResizeObserver) with it.
 * Nothing is announced until the edge stops (setPageDockWidth), so a heavy
 * page does not redraw itself in full for every pixel of the drag.
 */
export function movePageDock(width: number): void {
  if (typeof document === "undefined") {
    return;
  }

  writePageDockWidth(`${width}px`);
}

// Makes the page leave this many pixels free at its end.
export function setPageDockWidth(width: number): void {
  if (typeof document === "undefined") {
    return;
  }

  const value: string = `${width}px`;

  writePageDockWidth(value);
  announcePageWidthChanged(value);
}

// Gives the page its whole width back.
export function clearPageDock(): void {
  if (typeof document === "undefined") {
    return;
  }

  const style: CSSStyleDeclaration = document.documentElement.style;

  style.removeProperty(PAGE_DOCK_WIDTH_VARIABLE);
  style.removeProperty(PAGE_END_PADDING_PROPERTY);
  announcePageWidthChanged("");
}

/*
 * The declarative form: the page leaves `width` pixels free while it is a
 * number, and has its whole width back at null and when the surface goes.
 *
 * A layout effect, so the page has made room before the surface is first
 * painted: for no frame does the surface sit over the page.
 */
export function usePageDock(width: number | null): void {
  const isDocked: boolean = width !== null;

  useLayoutEffect(() => {
    if (width !== null) {
      setPageDockWidth(width);
    }
  }, [width]);

  useLayoutEffect(() => {
    if (!isDocked) {
      return undefined;
    }

    return () => {
      clearPageDock();
    };
  }, [isDocked]);
}
