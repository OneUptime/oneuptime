import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * The scan's status message, beneath its identity on the Discovery Scans
 * table: a two-line preview with a "Show details" toggle for the rest.
 *
 * The toggle used to be a native <details> whose summary ALWAYS showed the
 * clamped preview and whose body showed the same message again, in full. For
 * any message that fits in two lines — which is most of them: the probe's
 * summary of a healthy sweep is one sentence, e.g. "Swept 15360 hosts: 2906
 * answered ICMP ping, 2888 answered SNMP." — "Show details" and "Hide
 * details" displayed exactly the same text, and the only visible effect of
 * clicking was the link swapping places with it (OneUptime issue #3842).
 *
 * So the toggle now exists only when the preview is really cutting something
 * off, and the message is rendered once: clamped while collapsed, whole while
 * expanded. Whether the clamp cuts anything off depends on the column's
 * width, not on the message alone — the Scan column is a range, and the same
 * 64-character sentence is two lines on a desktop and three on a phone — so it
 * is measured rather than guessed from a character count.
 */

// How many lines the collapsed preview shows. Matches `line-clamp-2` below.
export const COLLAPSED_LINE_COUNT: number = 2;

export interface MessageBoxMetrics {
  // The full height of the message's text, whether or not it is clamped.
  scrollHeight: number;
  // The height the message is actually painted at.
  clientHeight: number;
  // The computed `line-height`, e.g. "20px"; "normal" when it has none.
  lineHeight: string;
}

/**
 * Whether the message needs more than the collapsed preview's lines.
 *
 * Returns undefined when it cannot tell, so the caller keeps what it had.
 *
 * The line-height test answers the same way in BOTH states: scrollHeight is
 * the full text's height whether or not the clamp is applied. That is what lets
 * the toggle stay put while the message is expanded — a test that compared
 * scrollHeight with clientHeight would see an expanded message as "fits",
 * remove the toggle, collapse it, see it overflow, and offer it again.
 *
 * The threshold is half a line past the preview rather than exactly at it:
 * heights arrive rounded to whole pixels, and a message is a whole number of
 * lines, so the next line up is never within half a line of the limit.
 */
export function isMessageTallerThanPreview(
  metrics: MessageBoxMetrics,
  isExpanded: boolean,
  lineCount: number = COLLAPSED_LINE_COUNT,
): boolean | undefined {
  const lineHeight: number = Number.parseFloat(metrics.lineHeight);

  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return metrics.scrollHeight > lineHeight * (lineCount + 0.5);
  }

  /*
   * No usable line-height. Only a clamped box can be read without one: its
   * text is cut off exactly when it is taller than the box it is painted in.
   * An expanded box is always exactly as tall as its text, which says nothing
   * about whether the preview would cut it, so that answer is "unknown".
   */
  if (isExpanded) {
    return undefined;
  }

  return metrics.scrollHeight > metrics.clientHeight + 1;
}

export function readMessageBoxMetrics(element: HTMLElement): MessageBoxMetrics {
  return {
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    lineHeight: window.getComputedStyle(element).lineHeight,
  };
}

export interface ComponentProps {
  message: string;
  /*
   * Names the scan in the toggle's accessible name. Every row has a toggle
   * with the same visible words, and a screen reader listing the page's
   * buttons would otherwise read out a column of identical "Show details".
   */
  scanLabel: string;
}

const DiscoveryScanStatusMessage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const messageId: string = useId();
  const messageRef: React.RefObject<HTMLParagraphElement> =
    useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isTruncatable, setIsTruncatable] = useState<boolean>(false);

  useLayoutEffect(() => {
    const element: HTMLParagraphElement | null = messageRef.current;

    if (!element) {
      return;
    }

    const measure: () => void = (): void => {
      const isTaller: boolean | undefined = isMessageTallerThanPreview(
        readMessageBoxMetrics(element),
        isExpanded,
      );

      if (isTaller === undefined) {
        return;
      }

      setIsTruncatable(isTaller);

      /*
       * A message that now fits (a live update replaced it with a shorter
       * one, or the column got wider) has nothing to hide, so it also has no
       * expanded state to remember — otherwise the next long message would
       * arrive already open, with "Hide details" under it.
       */
      if (!isTaller) {
        setIsExpanded(false);
      }
    };

    measure();

    /*
     * Re-measured whenever the box changes size: the column narrowing or
     * widening with the window, the table switching layouts, and web fonts
     * finishing loading all change how many lines the same text needs.
     */
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [props.message, isExpanded]);

  if (!props.message.trim()) {
    return null;
  }

  return (
    <div className="pt-1">
      {/*
       * Clamped whenever it is collapsed, including before the first
       * measurement: a long message never flashes open, and a clamp cuts
       * nothing from a message that fits inside it.
       */}
      <p
        ref={messageRef}
        id={messageId}
        className={`break-words text-xs leading-5 text-gray-600 ${isExpanded ? "" : "line-clamp-2"}`}
      >
        {props.message}
      </p>
      {isTruncatable && (
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={messageId}
          className="rounded-sm text-xs font-medium leading-5 text-blue-700 hover:text-blue-800 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? "Hide details" : "Show details"}
          <span className="sr-only">{` for ${props.scanLabel}`}</span>
        </button>
      )}
    </div>
  );
};

export default DiscoveryScanStatusMessage;
