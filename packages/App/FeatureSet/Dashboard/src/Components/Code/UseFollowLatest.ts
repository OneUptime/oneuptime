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
 * Takes the page to its end at once: where a reply just sent is drawn,
 * however far up the reader sent it from. The reply box is held at the
 * bottom of the window, so it is in view - and used - anywhere on the
 * page: scrolling the box itself into view moved nothing, and a reply sent
 * from a long task's first turn was drawn out of sight (issue #6529).
 */
export const scrollPageToEnd: () => void = (): void => {
  const scroller: Element | null = getScroller();

  if (!scroller) {
    return;
  }

  scroller.scrollTop = Math.max(
    0,
    scroller.scrollHeight - scroller.clientHeight,
  );
};

/*
 * The page to its end now, and once more on the next frame - unless the
 * reader went back up meanwhile. What lays out a moment after the reply
 * is drawn moves the end down below the window: the styles the page
 * writes for elements it has not drawn before (its Tailwind runs in the
 * browser, after each change), and the replies' Markdown when it comes in
 * with the reply - a reply sent as a long task opened was drawn some 1,100
 * pixels under the window. Returns what cancels the second.
 */
export const goToPageEnd: () => () => void = (): (() => void) => {
  scrollPageToEnd();

  const scroller: Element | null = getScroller();

  if (
    !scroller ||
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return (): void => {};
  }

  const scrolledTo: number = scroller.scrollTop;

  const frame: number = window.requestAnimationFrame((): void => {
    if (scroller.scrollTop >= scrolledTo) {
      scrollPageToEnd();
    }
  });

  return (): void => {
    window.cancelAnimationFrame(frame);
  };
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

/*
 * Whether the reader is at the end of the page as they last saw it: where
 * they are now, against how tall the page was when they were last seen,
 * before what grew since. Where they are is read from the page, not taken
 * from its scroll events: the browser sends a scroll's event with the next
 * frame, and a step drawn before that was judged by where the reader had
 * been - one who had just come to the end was left short of the newest
 * step, and one who had just scrolled up would have been pulled back down.
 */
const isAtEndAsLastSeen: (
  scroller: Element,
  seenHeight: number | null,
) => boolean = (scroller: Element, seenHeight: number | null): boolean => {
  return (
    isScrolledToEnd({
      scrollTop: scroller.scrollTop,
      scrollHeight: seenHeight ?? scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    }) ||
    /*
     * A page that got shorter brings its end up to the reader: the browser
     * keeps them within it, at its very end.
     */
    isScrolledToEnd(scroller, 1)
  );
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
  /*
   * The conversation, watched for what lays out after the follow's second
   * look (#7644): a reply's Markdown, whose viewer loads on its own
   * (LazyMarkdownViewer) and draws the reply from a two-line placeholder,
   * changes no growth key and sends no scroll or resize. While the reader
   * is followed and still at the end, the page follows that too. Without
   * one, only the second look follows late layout.
   */
  container?: Element | null | undefined;
}

// What a page that follows its reader can be asked to do.
export interface FollowLatest {
  /*
   * The reader was just taken to the end (goToPageEnd, after a reply):
   * follow them from there, as one who came to the end themselves.
   */
  followFromHere: () => void;
  /*
   * Jump to newest: the page to the newest turn - its end, or once its
   * turn has ended no further than its reply's first line - now and once
   * more on the next frame, unless the reader goes back up meanwhile; then
   * followed from there. Returns what cancels the second look.
   */
  jumpToNewest: () => () => void;
}

const useFollowLatest: (data: UseFollowLatestOptions) => FollowLatest = (
  data: UseFollowLatestOptions,
): FollowLatest => {
  /*
   * How tall the page was when the reader was last seen: at each scroll and
   * resize the browser sends, and after each growth.
   */
  const seenHeightRef: MutableRefObject<number | null> = useRef<number | null>(
    null,
  );
  // The conversation as last drawn: its first drawing moves nothing.
  const drawnKeyRef: MutableRefObject<string> = useRef<string>("");
  // AI was working when the conversation was last drawn.
  const wasLiveRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const getLatestStartRef: MutableRefObject<
    (() => Element | null) | undefined
  > = useRef<(() => Element | null) | undefined>(data.getLatestStart);
  getLatestStartRef.current = data.getLatestStart;

  // AI works on the latest turn now, as last drawn.
  const isLiveRef: MutableRefObject<boolean> = useRef<boolean>(data.isLive);
  isLiveRef.current = data.isLive;

  /*
   * The page follows the reader now: it took them to the newest step (or
   * they were taken to the end, or jumped there), and they have not
   * scrolled away since. Only then does late layout move the page: opening
   * a task never does.
   */
  const isFollowingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * The page to where it follows its reader: its end - and, once the turn
   * has ended, no further than its reply's first line.
   */
  const scrollToTarget: (scroller: Element) => void = (
    scroller: Element,
  ): void => {
    const start: Element | null =
      !isLiveRef.current && getLatestStartRef.current
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onScroll: () => void = (): void => {
      const scroller: Element | null = getScroller();

      seenHeightRef.current = scroller ? scroller.scrollHeight : null;

      // A reader who scrolled away from the end is not followed any more.
      if (scroller && !isScrolledToEnd(scroller)) {
        isFollowingRef.current = false;
      }
    };

    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return (): void => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /*
   * What lays out after the second look (#7644): the conversation grew,
   * and the page follows a reader it follows who is still at the end as
   * last seen - and stops following one who is not. Never a reader it
   * does not follow, so opening a task, or scrolling up, moves nothing.
   */
  useEffect(() => {
    const container: Element | null | undefined = data.container;

    if (
      !container ||
      typeof window === "undefined" ||
      typeof window.ResizeObserver !== "function"
    ) {
      return undefined;
    }

    const observer: ResizeObserver = new window.ResizeObserver((): void => {
      const scroller: Element | null = getScroller();

      if (!scroller || !isFollowingRef.current) {
        return;
      }

      if (!isAtEndAsLastSeen(scroller, seenHeightRef.current)) {
        isFollowingRef.current = false;
        return;
      }

      scrollToTarget(scroller);
      seenHeightRef.current = scroller.scrollHeight;
    });

    observer.observe(container);

    return (): void => {
      observer.disconnect();
    };
  }, [data.container]);

  useLayoutEffect(() => {
    const scroller: Element | null = getScroller();
    const previousKey: string = drawnKeyRef.current;
    const wasLive: boolean = wasLiveRef.current;

    drawnKeyRef.current = data.growthKey;
    wasLiveRef.current = data.isLive;

    if (!scroller) {
      return undefined;
    }

    // Where the reader was before this growth: at the end, or not.
    const wasAtEnd: boolean = isAtEndAsLastSeen(
      scroller,
      seenHeightRef.current,
    );

    const hasGrown: boolean =
      Boolean(previousKey) && previousKey !== data.growthKey;

    const isFollowing: boolean =
      hasGrown && (data.isLive || wasLive) && wasAtEnd;

    if (isFollowing) {
      // At once: a step that slides in smoothly is behind by the next one.
      scrollToTarget(scroller);
      isFollowingRef.current = true;
    } else if (hasGrown && !wasAtEnd) {
      isFollowingRef.current = false;
    }

    // The page as the reader sees it now, for the next growth.
    seenHeightRef.current = scroller.scrollHeight;

    if (!isFollowing || typeof window === "undefined") {
      return undefined;
    }

    /*
     * What lays out a frame later (a reply's Markdown) still ends in view,
     * unless the reader scrolled away meanwhile. What lays out later still
     * is followed as it comes (the container's observer above).
     */
    const frame: number = window.requestAnimationFrame((): void => {
      if (isAtEndAsLastSeen(scroller, seenHeightRef.current)) {
        scrollToTarget(scroller);
        seenHeightRef.current = scroller.scrollHeight;
      }
    });

    return (): void => {
      window.cancelAnimationFrame(frame);
    };
  }, [data.growthKey, data.isLive]);

  const followFromHere: () => void = (): void => {
    const scroller: Element | null = getScroller();

    isFollowingRef.current = true;
    seenHeightRef.current = scroller ? scroller.scrollHeight : null;
  };

  const jumpToNewest: () => () => void = (): (() => void) => {
    const scroller: Element | null = getScroller();

    if (!scroller) {
      return (): void => {};
    }

    scrollToTarget(scroller);
    followFromHere();

    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return (): void => {};
    }

    const scrolledTo: number = scroller.scrollTop;

    // Once more on the next frame, for what laid out meanwhile.
    const frame: number = window.requestAnimationFrame((): void => {
      if (scroller.scrollTop >= scrolledTo) {
        scrollToTarget(scroller);
        seenHeightRef.current = scroller.scrollHeight;
      }
    });

    return (): void => {
      window.cancelAnimationFrame(frame);
    };
  };

  return { followFromHere, jumpToNewest };
};

export default useFollowLatest;
