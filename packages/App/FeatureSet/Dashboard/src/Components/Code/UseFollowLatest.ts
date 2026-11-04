import { MutableRefObject, useEffect, useLayoutEffect, useRef } from "react";

/*
 * KEEPS THE LATEST STEP IN VIEW WHILE THE READER WATCHES IT COME.
 *
 * As AI works, its steps arrive one after the other at the end of the
 * conversation. A reader at the end - watching - keeps seeing the newest
 * step, the way a chat keeps its latest message in view; a reader who has
 * scrolled up to read something is left where they are. Only growth while
 * AI works (or its last reply arriving) moves the page; opening a task
 * never does.
 *
 * When the turn ends, its reply comes in at once, and a long one - a few
 * paragraphs, the files it changed, its pull request - runs past the
 * window. The page then follows the reader to its end but never past the
 * reply's first line (getFollowTarget): the reply is read from its start,
 * not found by scrolling back up to it.
 */

// How close to its end the page must be for the reader to count as watching.
export const FOLLOW_LATEST_SLACK_PX: number = 96;

/*
 * How far under the page's sticky header a reply's first line stays: the
 * room a place a link lands on keeps (PageAnchor's 1.5rem).
 */
export const FOLLOW_LATEST_START_GAP_PX: number = 24;

export interface ScrollPosition {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

// Whether the page is scrolled to its end, or near enough.
export const isScrolledToEnd: (
  position: ScrollPosition,
  slackPx?: number | undefined,
) => boolean = (
  position: ScrollPosition,
  slackPx?: number | undefined,
): boolean => {
  return (
    position.scrollHeight - position.scrollTop - position.clientHeight <=
    (slackPx ?? FOLLOW_LATEST_SLACK_PX)
  );
};

/*
 * Where a page that follows its reader scrolls to: its end - and, once
 * the turn has ended, no further than the latest reply's first line just
 * under the sticky header. `latestStartTop` is how far down the page the
 * reply starts (its top in the window plus the page's scroll); null while
 * AI works, when the newest step is what the reader watches.
 */
export const getFollowTarget: (data: {
  scrollHeight: number;
  clientHeight: number;
  latestStartTop: number | null;
  headerHeight?: number | undefined;
}) => number = (data: {
  scrollHeight: number;
  clientHeight: number;
  latestStartTop: number | null;
  headerHeight?: number | undefined;
}): number => {
  const end: number = Math.max(0, data.scrollHeight - data.clientHeight);

  if (data.latestStartTop === null) {
    return end;
  }

  return Math.min(
    end,
    Math.max(
      0,
      data.latestStartTop -
        (data.headerHeight || 0) -
        FOLLOW_LATEST_START_GAP_PX,
    ),
  );
};

// What the page scrolls with: the document.
const getScroller: () => Element | null = (): Element | null => {
  if (typeof document === "undefined") {
    return null;
  }

  return document.scrollingElement || document.documentElement;
};

/*
 * The page's sticky header, as tall as MasterPage measures it
 * (--app-header-height): what covers the top of the window.
 */
const getHeaderHeight: () => number = (): number => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return 0;
  }

  const height: number = parseFloat(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--app-header-height"),
  );

  return Number.isFinite(height) && height > 0 ? height : 0;
};

export interface UseFollowLatestOptions {
  // Changes whenever the conversation grows (getConversationGrowthKey).
  growthKey: string;
  // AI works on the latest turn now.
  isLive: boolean;
  /*
   * The latest turn's reply, whose first line a page that follows its
   * reader never scrolls past once the turn has ended. Without one, the
   * page follows to its end.
   */
  getLatestStart?: (() => Element | null) | undefined;
}

const useFollowLatest: (data: UseFollowLatestOptions) => void = (
  data: UseFollowLatestOptions,
): void => {
  // The reader is at the end of the page, as they last left it.
  const isAtEndRef: MutableRefObject<boolean> = useRef<boolean>(false);
  // The conversation as last drawn: its first drawing moves nothing.
  const drawnKeyRef: MutableRefObject<string> = useRef<string>("");
  // AI was working when the conversation was last drawn.
  const wasLiveRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const getLatestStartRef: MutableRefObject<
    (() => Element | null) | undefined
  > = useRef<(() => Element | null) | undefined>(data.getLatestStart);
  getLatestStartRef.current = data.getLatestStart;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onScroll: () => void = (): void => {
      const scroller: Element | null = getScroller();

      isAtEndRef.current = scroller ? isScrolledToEnd(scroller) : false;
    };

    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return (): void => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const scroller: Element | null = getScroller();
    const previousKey: string = drawnKeyRef.current;
    const wasLive: boolean = wasLiveRef.current;
    // Where the reader was before this growth: at the end, or not.
    const wasAtEnd: boolean = isAtEndRef.current;

    drawnKeyRef.current = data.growthKey;
    wasLiveRef.current = data.isLive;

    if (!scroller) {
      return undefined;
    }

    const isFollowing: boolean =
      Boolean(previousKey) &&
      previousKey !== data.growthKey &&
      (data.isLive || wasLive) &&
      wasAtEnd;

    // The turn has ended: its reply is read from its first line.
    const hasEnded: boolean = !data.isLive;

    const scrollToTarget: () => void = (): void => {
      const start: Element | null =
        hasEnded && getLatestStartRef.current
          ? getLatestStartRef.current()
          : null;

      scroller.scrollTop = getFollowTarget({
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        latestStartTop: start
          ? start.getBoundingClientRect().top + scroller.scrollTop
          : null,
        headerHeight: getHeaderHeight(),
      });
    };

    if (isFollowing) {
      // At once: a step that slides in smoothly is behind by the next one.
      scrollToTarget();
    }

    // Where the reader is now, for the next growth.
    isAtEndRef.current = isScrolledToEnd(scroller);

    if (!isFollowing || typeof window === "undefined") {
      return undefined;
    }

    /*
     * What lays out a frame later (a reply's Markdown) still ends in view,
     * unless the reader scrolled away meanwhile.
     */
    const frame: number = window.requestAnimationFrame((): void => {
      if (isAtEndRef.current) {
        scrollToTarget();
        isAtEndRef.current = isScrolledToEnd(scroller);
      }
    });

    return (): void => {
      window.cancelAnimationFrame(frame);
    };
  }, [data.growthKey, data.isLive]);
};

export default useFollowLatest;
