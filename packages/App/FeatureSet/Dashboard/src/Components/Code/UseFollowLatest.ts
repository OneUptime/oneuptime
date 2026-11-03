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
 */

// How close to its end the page must be for the reader to count as watching.
export const FOLLOW_LATEST_SLACK_PX: number = 96;

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

// What the page scrolls with: the document.
const getScroller: () => Element | null = (): Element | null => {
  if (typeof document === "undefined") {
    return null;
  }

  return document.scrollingElement || document.documentElement;
};

const useFollowLatest: (data: {
  // Changes whenever the conversation grows (getConversationGrowthKey).
  growthKey: string;
  // AI works on the latest turn now.
  isLive: boolean;
}) => void = (data: { growthKey: string; isLive: boolean }): void => {
  // The reader is at the end of the page, as they last left it.
  const isAtEndRef: MutableRefObject<boolean> = useRef<boolean>(false);
  // The conversation as last drawn: its first drawing moves nothing.
  const drawnKeyRef: MutableRefObject<string> = useRef<string>("");
  // AI was working when the conversation was last drawn.
  const wasLiveRef: MutableRefObject<boolean> = useRef<boolean>(false);

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

    if (isFollowing) {
      // At once: a step that slides in smoothly is behind by the next one.
      scroller.scrollTop = scroller.scrollHeight;
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
        scroller.scrollTop = scroller.scrollHeight;
        isAtEndRef.current = isScrolledToEnd(scroller);
      }
    });

    return (): void => {
      window.cancelAnimationFrame(frame);
    };
  }, [data.growthKey, data.isLive]);
};

export default useFollowLatest;
