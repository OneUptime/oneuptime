import {
  getSideMenuHiddenEdges,
  NO_HIDDEN_EDGES,
  SideMenuHiddenEdges,
} from "./SideMenuScroll";
import { RefObject, useCallback, useEffect, useState } from "react";

/*
 * Which edges of a side menu's list have entries behind them (SideMenuScroll),
 * read again as the list scrolls - the reader's wheel, or the menu bringing
 * its lit entry into sight - and whenever the list or its entries change
 * size: a section opened or folded, the card fitted to the window, the
 * window resized. The list fades out at those edges.
 *
 * `isShown` is whether the list is drawn: the desktop menu's always, the
 * phone menu's only while it is open.
 */
export default function useSideMenuHiddenEdges(
  listRef: RefObject<HTMLElement>,
  isShown: boolean,
): { hiddenEdges: SideMenuHiddenEdges; onScroll: () => void } {
  const [hiddenEdges, setHiddenEdges] =
    useState<SideMenuHiddenEdges>(NO_HIDDEN_EDGES);

  const measure: () => void = useCallback((): void => {
    const list: HTMLElement | null = listRef.current;
    const next: SideMenuHiddenEdges = list
      ? getSideMenuHiddenEdges({
          scrollTop: list.scrollTop,
          scrollHeight: list.scrollHeight,
          clientHeight: list.clientHeight,
        })
      : NO_HIDDEN_EDGES;

    // The same edges again re-render nothing.
    setHiddenEdges((previous: SideMenuHiddenEdges): SideMenuHiddenEdges => {
      return previous.top === next.top && previous.bottom === next.bottom
        ? previous
        : next;
    });
  }, [listRef]);

  useEffect(() => {
    if (!isShown) {
      return;
    }

    const list: HTMLElement | null = listRef.current;

    measure();

    if (!list) {
      return;
    }

    window.addEventListener("resize", measure);

    /*
     * ResizeObserver is missing in jsdom and in older browsers: the resize
     * event and the list's own scroll keep the fades roughly right there.
     */
    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(list);

      for (const child of Array.from(list.children)) {
        observer.observe(child);
      }
    }

    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [isShown, measure]);

  return { hiddenEdges, onScroll: measure };
}
