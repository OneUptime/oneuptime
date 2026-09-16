import AIRunStatus from "Common/Types/AI/AIRunStatus";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AI_INVESTIGATION_PANEL_ID,
  isActiveAIInvestigationStatus,
  isCompletedAIInvestigationWithSummary,
} from "./AIInvestigationStatus";

export interface ComponentProps {
  status: AIRunStatus;
  onViewProgress: () => void;
  /*
   * The completed report's TL;DR (or its summary as plain text). Only used
   * once the run is Completed; it is model-authored, so it is only ever
   * rendered as text.
   */
  summary?: string | null | undefined;
}

export interface LiveRegionProps {
  status: AIRunStatus | null | undefined;
  summary?: string | null | undefined;
}

export const AI_INVESTIGATION_READY_ANNOUNCEMENT: string =
  "AI root cause analysis ready.";

export const getAIInvestigationStatusCopy: (status: AIRunStatus) => {
  title: string;
  description: string;
} = (
  status: AIRunStatus,
): {
  title: string;
  description: string;
} => {
  if (status === AIRunStatus.Running) {
    return {
      title: "AI is investigating",
      description: "Reviewing telemetry and tracing the likely root cause.",
    };
  }

  return {
    title: "AI investigation queued",
    description:
      "Waiting for an AI worker. Telemetry review will begin automatically.",
  };
};

export const AIInvestigationStatusLiveRegion: FunctionComponent<
  LiveRegionProps
> = (props: LiveRegionProps): ReactElement => {
  const isReady: boolean = isCompletedAIInvestigationWithSummary(
    props.status,
    props.summary,
  );

  /*
   * Latched for as long as the run stays Completed. The summary can briefly
   * drop out and come back (a refetch, a TL;DR replacing the summary) and
   * each empty -> text change would make a screen reader say "ready" again.
   * A new run (or no run) clears the latch, so the next report is announced.
   */
  const [isReadyLatched, setIsReadyLatched] = useState<boolean>(isReady);

  if (isReady && !isReadyLatched) {
    setIsReadyLatched(true);
  } else if (props.status !== AIRunStatus.Completed && isReadyLatched) {
    setIsReadyLatched(false);
  }

  let announcement: string = "";

  if (isActiveAIInvestigationStatus(props.status)) {
    const copy: { title: string; description: string } =
      getAIInvestigationStatusCopy(props.status!);
    announcement = `${copy.title}. ${copy.description}`;
  } else if (
    props.status === AIRunStatus.Completed &&
    (isReady || isReadyLatched)
  ) {
    announcement = AI_INVESTIGATION_READY_ANNOUNCEMENT;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </span>
  );
};

interface CompletedSummaryNoticeProps {
  summary: string;
  onViewReport: () => void;
}

/*
 * A completed investigation's headline, lifted into the event header so the
 * most useful read on the page is visible without scrolling, and "View full
 * report" jumps to the panel. The summary is model-authored, so it is only
 * ever rendered as text.
 *
 * The label and the report button share the top row so the summary gets the
 * card's full width below them, capped at a readable measure for wide
 * screens. On a phone that row has no room for the button, so it drops to
 * the bottom row beside Show more; the DOM order stays header, button,
 * summary, the same as a Card's header actions.
 */
const CompletedSummaryNotice: FunctionComponent<CompletedSummaryNoticeProps> = (
  props: CompletedSummaryNoticeProps,
): ReactElement => {
  const summaryId: string = useId();
  const summaryRef: React.RefObject<HTMLParagraphElement> =
    useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isClamped, setIsClamped] = useState<boolean>(false);
  const [shownSummary, setShownSummary] = useState<string>(props.summary);

  // A different summary is a different read: start it collapsed.
  if (shownSummary !== props.summary) {
    setShownSummary(props.summary);
    setIsExpanded(false);
  }

  /*
   * Whether the clamp hides anything is measured, not guessed from the
   * length: the header runs from a phone's width to a wide monitor's, so
   * the same summary is three lines on one and seven on the other. While
   * the summary is expanded the last measurement stands, which keeps Show
   * less on screen for the reader who opened it.
   */
  useLayoutEffect(() => {
    const element: HTMLParagraphElement | null = summaryRef.current;

    if (!element || isExpanded) {
      return undefined;
    }

    const measure: () => void = (): void => {
      // The extra pixel absorbs sub-pixel rounding between the two heights.
      setIsClamped(element.scrollHeight > element.clientHeight + 1);
    };

    measure();

    // ResizeObserver is missing in jsdom and in older browsers.
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
  }, [isExpanded, props.summary]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-white py-3 pl-4 pr-3 shadow-sm">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-indigo-500"
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
        {/*
          The button's column is as wide as the button even on a phone,
          where the button sits in the bottom row, so the label spans both
          columns there instead of truncating beside an empty cell.
        */}
        <div className="col-span-2 row-start-1 flex min-w-0 items-center gap-2 sm:col-span-1">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white shadow-sm"
          >
            <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
          </span>
          <h3 className="truncate text-xs font-semibold uppercase tracking-wider text-indigo-600">
            AI root cause analysis
          </h3>
        </div>
        <button
          type="button"
          onClick={props.onViewReport}
          aria-controls={AI_INVESTIGATION_PANEL_ID}
          className="group col-start-2 row-start-3 -my-1 inline-flex items-center justify-center gap-1.5 justify-self-end whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:row-start-1"
        >
          View full report
          <Icon
            icon={IconProp.ArrowDown}
            className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-y-0.5"
          />
        </button>
        <p
          ref={summaryRef}
          id={summaryId}
          className={`col-span-2 row-start-2 max-w-4xl break-words text-sm leading-6 text-gray-900 ${
            isExpanded ? "" : "line-clamp-3"
          }`}
        >
          {props.summary}
        </p>
        {isClamped ? (
          <button
            type="button"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            aria-expanded={isExpanded}
            aria-controls={summaryId}
            className="col-start-1 row-start-3 -my-1 -ml-1.5 inline-flex items-center gap-1 justify-self-start rounded-md px-1.5 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {isExpanded ? "Show less" : "Show more"}
            <Icon
              icon={IconProp.ChevronDown}
              className={`h-3.5 w-3.5 motion-safe:transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

/*
 * A deliberately prominent, but compact, live status for an incident header.
 * The full event trail remains in InvestigationPanel; this tells responders
 * that work is happening without making them hunt for that card.
 */
const AIInvestigationHeaderStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (isCompletedAIInvestigationWithSummary(props.status, props.summary)) {
    return (
      <CompletedSummaryNotice
        summary={(props.summary || "").trim()}
        onViewReport={props.onViewProgress}
      />
    );
  }

  if (!isActiveAIInvestigationStatus(props.status)) {
    return <></>;
  }

  const isRunning: boolean = props.status === AIRunStatus.Running;
  const copy: { title: string; description: string } =
    getAIInvestigationStatusCopy(props.status);

  return (
    <div className="relative overflow-hidden rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-violet-50 px-3.5 py-3 shadow-sm">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-indigo-500"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm"
          >
            <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              {isRunning ? (
                <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-indigo-400 opacity-75" />
              ) : (
                <></>
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-indigo-950">
              {copy.title}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-indigo-700">
              {copy.description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onViewProgress}
          aria-controls={AI_INVESTIGATION_PANEL_ID}
          aria-label="View live AI investigation progress"
          className="group inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:self-auto"
        >
          View live progress
          <Icon
            icon={IconProp.ArrowDown}
            className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-y-0.5"
          />
        </button>
      </div>
    </div>
  );
};

export default AIInvestigationHeaderStatus;
