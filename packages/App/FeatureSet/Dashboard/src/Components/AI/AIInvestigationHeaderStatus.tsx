import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
import { atContainerWidth } from "../EventView/EventHeaderLayout";

/*
 * The band is drawn inside the event header, which is a size container: its
 * rows follow the header's own width. From this width the label and the
 * report button share the top row; below it the button moves to the bottom
 * row, beside Show more.
 */
export const AI_HEADER_WIDE_WIDTH_REM: number = 36;

// The summary's grid: label and button, summary, then Show more (and the button on a narrow header).
export const AI_HEADER_SUMMARY_GRID_CLASS_NAME: string =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5";

// The label and the verdict: the whole top row on a narrow header, the first column on a wide one.
export const AI_HEADER_SUMMARY_HEADING_ROW_CLASS_NAME: string = `col-span-2 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 ${atContainerWidth(
  AI_HEADER_WIDE_WIDTH_REM,
  "col-span-1",
)}`;

// View full report: the bottom row's end on a narrow header, the top row's on a wide one.
export const AI_HEADER_VIEW_REPORT_CLASS_NAME: string = `group col-start-2 row-start-3 -my-1 inline-flex items-center justify-center gap-1.5 self-start justify-self-end whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${atContainerWidth(
  AI_HEADER_WIDE_WIDTH_REM,
  "row-start-1",
)}`;

// While it works: what it is doing, then View live progress - beside it on a wide header.
export const AI_HEADER_PROGRESS_ROW_CLASS_NAME: string = `flex flex-col gap-2 ${atContainerWidth(
  AI_HEADER_WIDE_WIDTH_REM,
  "flex-row items-center justify-between gap-4",
)}`;

export const AI_HEADER_VIEW_PROGRESS_CLASS_NAME: string = `group inline-flex shrink-0 items-center justify-center gap-1.5 self-end whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${atContainerWidth(
  AI_HEADER_WIDE_WIDTH_REM,
  "self-auto",
)}`;

export interface ComponentProps {
  status: AIRunStatus;
  onViewProgress: () => void;
  /*
   * The completed report's TL;DR (or its summary as plain text). Only used
   * once the run is Completed; it is model-authored, so it is only ever
   * rendered as text.
   */
  summary?: string | null | undefined;
  /*
   * A responder's verdict on that report. Shown only with the summary; a
   * rejected report stays readable but no longer reads as the root cause.
   */
  verdict?: AIRunHumanVerdict | null | undefined;
}

export interface LiveRegionProps {
  status: AIRunStatus | null | undefined;
  summary?: string | null | undefined;
}

export const AI_INVESTIGATION_READY_ANNOUNCEMENT: string = translationKey(
  "AI root cause analysis ready.",
);

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
  const translator: Translator = useTranslator();
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
    // Two whole sentences, each in the reader's language.
    announcement = `${translator.translateText(copy.title)}. ${translator.translateText(copy.description)}`;
  } else if (
    props.status === AIRunStatus.Completed &&
    (isReady || isReadyLatched)
  ) {
    announcement = translator.translateText(
      AI_INVESTIGATION_READY_ANNOUNCEMENT,
    ) as string;
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

interface VerdictBadgeCopy {
  text: string;
  icon: IconProp;
  className: string;
}

/*
 * Worded for the other responders reading the header, not for the one who
 * rated it (the panel says "You confirmed this analysis"), in the panel's
 * pill colours.
 */
export const AI_INVESTIGATION_VERDICT_BADGES: Record<
  AIRunHumanVerdict,
  VerdictBadgeCopy
> = {
  [AIRunHumanVerdict.Confirmed]: {
    text: "Confirmed by a responder",
    icon: IconProp.Check,
    className: "bg-green-50 text-green-700 ring-green-200",
  },
  [AIRunHumanVerdict.Rejected]: {
    text: "Rejected by a responder",
    icon: IconProp.Close,
    className: "bg-rose-50 text-rose-700 ring-rose-200",
  },
};

interface CompletedSummaryNoticeProps {
  summary: string;
  verdict: AIRunHumanVerdict | null;
  onViewReport: () => void;
}

/*
 * OneUptime AI's mark in the band: the sparkles on an indigo tile, with a
 * dot that pings while a run is under way. Decoration - the words beside it
 * say what it is.
 */
const AiMark: FunctionComponent<{ isLive?: boolean | undefined }> = (props: {
  isLive?: boolean | undefined;
}): ReactElement => {
  return (
    <span
      aria-hidden="true"
      data-testid="ai-header-mark"
      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-600 text-white"
    >
      <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
      {props.isLive ? (
        <span className="absolute -end-1 -top-1 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

/*
 * The header's AI band, as a completed investigation's headline: lifted into
 * the event header so the most useful read on the page is visible without
 * scrolling, and "View full report" jumps to the panel. The summary is
 * model-authored, so it is only ever rendered as text. Once a responder has
 * rated the report, a badge next to the label says so, because a rejected
 * report must not keep presenting itself as the root cause.
 *
 * The band is a section of the header, not a box inside it: the header
 * paints its tint and its hairline (EventStatusPanel's "ai" notice), so
 * nothing here draws a border, a frame or a shadow. The label and the report
 * button share the top row, so the summary gets the band's whole width under
 * them, capped at a readable measure on a wide header. On a narrow header -
 * a phone's, or beside a tablet's side menu - that row has no room for the
 * button, which would cut the label short: there it drops to the bottom row
 * beside Show more. The DOM order stays label, button, summary, the same as
 * a Card's header actions. Both are read off the header's own width (it is a
 * size container), never the window's.
 */
const CompletedSummaryNotice: FunctionComponent<CompletedSummaryNoticeProps> = (
  props: CompletedSummaryNoticeProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summaryId: string = useId();
  const summaryRef: React.RefObject<HTMLParagraphElement> =
    useRef<HTMLParagraphElement>(null);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isClamped, setIsClamped] = useState<boolean>(false);
  const [shownSummary, setShownSummary] = useState<string>(props.summary);
  const verdictBadge: VerdictBadgeCopy | null = props.verdict
    ? AI_INVESTIGATION_VERDICT_BADGES[props.verdict] || null
    : null;
  /*
   * A rejected report is still worth reading, but as a claim a responder
   * has ruled out, so it drops to secondary text. gray-600 keeps about
   * 6.8:1 on the band's indigo tint, where gray-500 would fall below 4.5:1.
   */
  const isRejected: boolean = props.verdict === AIRunHumanVerdict.Rejected;

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
    <div
      data-testid="ai-header-summary"
      className={AI_HEADER_SUMMARY_GRID_CLASS_NAME}
    >
      {/*
        The button's column is as wide as the button even where the
        button sits in the bottom row, so the label spans both columns
        there instead of truncating beside an empty cell. A verdict badge
        wraps under the label when the row is too narrow for both.
      */}
      <div className={AI_HEADER_SUMMARY_HEADING_ROW_CLASS_NAME}>
        <div className="flex min-w-0 items-center gap-2">
          <AiMark />
          <h3 className="truncate text-sm font-semibold text-indigo-900">
            {translator.translateText("AI root cause analysis")}
          </h3>
        </div>
        {verdictBadge ? (
          <span
            data-verdict={props.verdict}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${verdictBadge.className}`}
          >
            <Icon icon={verdictBadge.icon} className="h-3 w-3" />
            {translator.translateText(verdictBadge.text)}
          </span>
        ) : (
          <></>
        )}
      </div>
      <button
        type="button"
        onClick={props.onViewReport}
        aria-controls={AI_INVESTIGATION_PANEL_ID}
        className={AI_HEADER_VIEW_REPORT_CLASS_NAME}
      >
        {translator.translateText("View full report")}
        <Icon
          icon={IconProp.ArrowDown}
          className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-y-0.5"
        />
      </button>
      <p
        ref={summaryRef}
        id={summaryId}
        className={`col-span-2 row-start-2 max-w-4xl break-words text-sm leading-6 ${
          isRejected ? "text-gray-600" : "text-gray-900"
        } ${isExpanded ? "" : "line-clamp-3"}`}
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
          className="col-start-1 row-start-3 -my-1 -ms-1.5 inline-flex items-center gap-1 justify-self-start rounded-md px-1.5 py-1 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {isExpanded
            ? translator.translateText("Show less")
            : translator.translateText("Show more")}
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
  );
};

/*
 * The band while OneUptime AI works: what it is doing, in a sentence, and
 * View live progress, which jumps to the panel where the steps are. The mark
 * pings while the run is under way.
 */
const ActiveInvestigationNotice: FunctionComponent<{
  status: AIRunStatus;
  onViewProgress: () => void;
}> = (props: {
  status: AIRunStatus;
  onViewProgress: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isRunning: boolean = props.status === AIRunStatus.Running;
  const copy: { title: string; description: string } =
    getAIInvestigationStatusCopy(props.status);

  return (
    <div
      data-testid="ai-header-progress"
      className={AI_HEADER_PROGRESS_ROW_CLASS_NAME}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <AiMark isLive={isRunning} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-900">
            {translator.translateText(copy.title)}
          </p>
          <p className="mt-0.5 text-sm text-gray-700">
            {translator.translateText(copy.description)}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={props.onViewProgress}
        aria-controls={AI_INVESTIGATION_PANEL_ID}
        aria-label={translator.translateText(
          "View live AI investigation progress",
        )}
        className={AI_HEADER_VIEW_PROGRESS_CLASS_NAME}
      >
        {translator.translateText("View live progress")}
        <Icon
          icon={IconProp.ArrowDown}
          className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-y-0.5"
        />
      </button>
    </div>
  );
};

/*
 * The header's AI band: while the run is queued or running, that OneUptime
 * AI is on it; once it completed with a summary, the summary. The full event
 * trail stays in InvestigationPanel; this tells responders that work is
 * happening, or what it found, without making them hunt for that card.
 */
const AIInvestigationHeaderStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (isCompletedAIInvestigationWithSummary(props.status, props.summary)) {
    return (
      <CompletedSummaryNotice
        summary={(props.summary || "").trim()}
        verdict={props.verdict || null}
        onViewReport={props.onViewProgress}
      />
    );
  }

  if (!isActiveAIInvestigationStatus(props.status)) {
    return <></>;
  }

  return (
    <ActiveInvestigationNotice
      status={props.status}
      onViewProgress={props.onViewProgress}
    />
  );
};

export default AIInvestigationHeaderStatus;
