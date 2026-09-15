import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import Icon from "../../Icon/Icon";
import Tooltip from "../../Tooltip/Tooltip";
import IconProp from "../../../../Types/Icon/IconProp";
import Clipboard from "../../../Utils/Clipboard";
import { LockedFilterDetail } from "../../../../Types/Telemetry/LockedFilterDetail";
import {
  TELEMETRY_EXPLORER_LABELS,
  TelemetrySignal,
} from "../../../../Utils/Telemetry/LockedFilterSearch";

/*
 * The grey lock chip every telemetry explorer shows for a filter its host
 * page pinned — "Cluster: production" on a Kubernetes cluster's Logs tab.
 *
 * When the builder attaches a LockedFilterDetail the chip carries a tooltip
 * with the search syntax that reproduces the filter on the main explorer, and
 * a button to copy it; without one it keeps the plain, non-focusable pill it
 * always was — a chip with nothing to open must not be a tab stop.
 *
 * Keyboard path: the search syntax lives in a Tippy popover that is appended
 * after the chip row, so Tab from the chip lands on the next chip and never
 * inside the popover. The chip with a detail is therefore a real button —
 * focus opens the tooltip (Tippy's focus trigger, read out through
 * aria-describedby), and Enter / Space copies the search syntax right there,
 * with the result announced through a live region.
 *
 * Shared by the logs chip list and the traces / metrics chip list so the two
 * present a locked filter the same way.
 */

export const COPIED_FEEDBACK_MS: number = 1500;

export const LOCKED_FILTER_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-100 py-0.5 pl-2 pr-2 text-xs text-gray-700";

export const COPIED_SEARCH_SYNTAX_ANNOUNCEMENT: string = "Copied search syntax";
export const COPY_FAILED_ANNOUNCEMENT: string = "Copy failed";

/** Shown in the tooltip when a detail names neither a token nor a reason. */
export const NO_SEARCH_SYNTAX_REASON: string =
  "This filter has no search syntax.";

type GetLockedFilterChipAriaLabelFunction = (
  displayKey: string,
  displayValue: string,
  hasSearchToken?: boolean | undefined,
) => string;

/**
 * The accessible name of a chip that carries a detail. It names the filter,
 * says it is locked, and — when there is syntax to copy — tells a keyboard
 * user what Enter does, since the tooltip's own Copy button is out of reach.
 */
export const getLockedFilterChipAriaLabel: GetLockedFilterChipAriaLabelFunction =
  (
    displayKey: string,
    displayValue: string,
    hasSearchToken?: boolean | undefined,
  ): string => {
    const base: string = `${displayKey}: ${displayValue}, locked filter`;

    if (!hasSearchToken) {
      return base;
    }

    return `${base}. Press Enter to copy its search syntax.`;
  };

export interface CopiedFeedback {
  /** True for COPIED_FEEDBACK_MS after a copy that reached the clipboard. */
  copied: boolean;
  /** True for COPIED_FEEDBACK_MS after a copy that did not. */
  failed: boolean;
  copy: (text: string) => Promise<boolean>;
}

/**
 * A one-shot copy state: `copied` or `failed` for COPIED_FEEDBACK_MS after
 * `copy()`, according to what the clipboard actually did — never both, and
 * never flipped on an unmounted component.
 */
export function useCopiedFeedback(): CopiedFeedback {
  const [copied, setCopied] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;

    return (): void => {
      mountedRef.current = false;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy: (text: string) => Promise<boolean> = async (
    text: string,
  ): Promise<boolean> => {
    const succeeded: boolean = await Clipboard.copyToClipboard(text);

    if (!mountedRef.current) {
      return succeeded;
    }

    setCopied(succeeded);
    setFailed(!succeeded);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout((): void => {
      if (mountedRef.current) {
        setCopied(false);
        setFailed(false);
      }
    }, COPIED_FEEDBACK_MS);

    return succeeded;
  };

  return { copied, failed, copy };
}

export interface LockedFilterTooltipContentProps {
  lockedDetail: LockedFilterDetail;
  signal?: TelemetrySignal | undefined;
}

interface SearchSyntaxRowProps {
  searchToken: string;
  signal?: TelemetrySignal | undefined;
}

type CopyButtonLabelFunction = (feedback: CopiedFeedback) => string;

const copyButtonText: CopyButtonLabelFunction = (
  feedback: CopiedFeedback,
): string => {
  if (feedback.copied) {
    return "Copied!";
  }

  if (feedback.failed) {
    return "Copy failed";
  }

  return "Copy";
};

const SearchSyntaxRow: FunctionComponent<SearchSyntaxRowProps> = (
  props: SearchSyntaxRowProps,
): ReactElement => {
  const feedback: CopiedFeedback = useCopiedFeedback();

  const explorerLabel: string | undefined = props.signal
    ? TELEMETRY_EXPLORER_LABELS[props.signal]
    : undefined;

  const buttonClassName: string = feedback.copied
    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
    : feedback.failed
      ? "border-rose-200 bg-rose-50 text-rose-600"
      : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700";

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <code
          className="min-w-0 flex-1 break-all rounded border border-gray-200 bg-gray-50 px-1.5 py-1 font-mono text-[11px] text-gray-800"
          data-testid="locked-filter-search-token"
        >
          {props.searchToken}
        </code>
        <button
          type="button"
          aria-label={
            feedback.copied
              ? "Copied"
              : feedback.failed
                ? "Copy failed"
                : "Copy search syntax"
          }
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${buttonClassName}`}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            /*
             * The chip's own handlers (and any row the chip list sits in)
             * must not see this click as theirs.
             */
            event.preventDefault();
            event.stopPropagation();
            void feedback.copy(props.searchToken);
          }}
        >
          <Icon
            icon={
              feedback.copied
                ? IconProp.Check
                : feedback.failed
                  ? IconProp.Close
                  : IconProp.Copy
            }
            className="h-3 w-3"
          />
          <span>{copyButtonText(feedback)}</span>
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        {explorerLabel
          ? `Paste into the ${explorerLabel} explorer search bar.`
          : "Paste into the explorer search bar."}
      </p>
    </div>
  );
};

/**
 * The body of the locked chip's tooltip: the search syntax that reproduces
 * the filter on the explorer, with a Copy button — or, when the grammar
 * cannot spell the filter, the reason why. Nothing else: the syntax is what a
 * reader opens the chip for. Exported so tests can render it without going
 * through Tippy's hover timers.
 */
export const LockedFilterTooltipContent: FunctionComponent<
  LockedFilterTooltipContentProps
> = (props: LockedFilterTooltipContentProps): ReactElement => {
  const detail: LockedFilterDetail = props.lockedDetail;

  return (
    <div
      className="w-80 max-w-full space-y-1 p-1 text-left text-xs"
      data-testid="locked-filter-tooltip"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Search syntax
      </div>
      {detail.searchToken ? (
        <SearchSyntaxRow
          searchToken={detail.searchToken}
          signal={props.signal}
        />
      ) : (
        <p className="text-[11px] text-gray-400">
          {detail.searchTokenUnavailableReason || NO_SEARCH_SYNTAX_REASON}
        </p>
      )}
    </div>
  );
};

export interface LockedFilterChipProps {
  displayKey: string;
  displayValue: string;
  lockedDetail?: LockedFilterDetail | undefined;
  signal?: TelemetrySignal | undefined;
  /*
   * Rendered inside the pill after the value — the logs list passes its
   * "open trace / span view" icon-link here. It is a sibling of the chip's
   * own control, never nested inside it: a link inside a button is
   * operable by neither.
   */
  trailing?: ReactNode;
}

interface LockedFilterChipBodyProps {
  displayKey: string;
  displayValue: string;
  /** The lock, or the copy outcome for a moment after Enter. */
  copied: boolean;
  failed: boolean;
}

const LockedFilterChipBody: FunctionComponent<LockedFilterChipBodyProps> = (
  props: LockedFilterChipBodyProps,
): ReactElement => {
  return (
    <>
      <Icon
        icon={
          props.copied
            ? IconProp.Check
            : props.failed
              ? IconProp.Close
              : IconProp.Lock
        }
        className={`h-2.5 w-2.5 ${
          props.copied
            ? "text-emerald-500"
            : props.failed
              ? "text-rose-500"
              : "text-gray-400"
        }`}
      />
      <span className="font-medium text-gray-500">{props.displayKey}:</span>
      <span>{props.displayValue}</span>
    </>
  );
};

interface ExplainedLockedFilterChipProps {
  displayKey: string;
  displayValue: string;
  lockedDetail: LockedFilterDetail;
  signal?: TelemetrySignal | undefined;
  trailing?: ReactNode;
}

/*
 * The chip that has something to say. The control is a native button so it
 * is focusable with a role that permits a name; Tippy attaches its
 * explanation to it (focus and hover open it; aria-describedby reads it).
 */
const ExplainedLockedFilterChip: FunctionComponent<
  ExplainedLockedFilterChipProps
> = (props: ExplainedLockedFilterChipProps): ReactElement => {
  const feedback: CopiedFeedback = useCopiedFeedback();
  const searchToken: string | undefined = props.lockedDetail.searchToken;

  const announcement: string = feedback.copied
    ? COPIED_SEARCH_SYNTAX_ANNOUNCEMENT
    : feedback.failed
      ? COPY_FAILED_ANNOUNCEMENT
      : "";

  const control: ReactElement = (
    <button
      type="button"
      className="inline-flex cursor-help items-center gap-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      aria-label={getLockedFilterChipAriaLabel(
        props.displayKey,
        props.displayValue,
        Boolean(searchToken),
      )}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        /*
         * Enter and Space arrive here as clicks on a native button. A chip
         * without syntax has nothing to copy; its button exists so the
         * explanation is reachable from the keyboard at all.
         */
        event.preventDefault();
        event.stopPropagation();

        if (searchToken) {
          void feedback.copy(searchToken);
        }
      }}
    >
      <LockedFilterChipBody
        displayKey={props.displayKey}
        displayValue={props.displayValue}
        copied={feedback.copied}
        failed={feedback.failed}
      />
    </button>
  );

  return (
    <span
      className={LOCKED_FILTER_CHIP_CLASS_NAME}
      data-testid="locked-filter-chip"
    >
      <Tooltip
        richContent={
          <LockedFilterTooltipContent
            lockedDetail={props.lockedDetail}
            signal={props.signal}
          />
        }
      >
        {control}
      </Tooltip>
      {props.trailing}
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
    </span>
  );
};

const LockedFilterChip: FunctionComponent<LockedFilterChipProps> = (
  props: LockedFilterChipProps,
): ReactElement => {
  if (!props.lockedDetail) {
    /*
     * Exactly the pill from before the explainer: not focusable, no name of
     * its own, the plain title. Nothing would open on focus, so a tab stop
     * here would be a dead one.
     */
    return (
      <span
        className={LOCKED_FILTER_CHIP_CLASS_NAME}
        title={`${props.displayKey}: ${props.displayValue} (applied filter)`}
        data-testid="locked-filter-chip"
      >
        <LockedFilterChipBody
          displayKey={props.displayKey}
          displayValue={props.displayValue}
          copied={false}
          failed={false}
        />
        {props.trailing}
      </span>
    );
  }

  return (
    <ExplainedLockedFilterChip
      displayKey={props.displayKey}
      displayValue={props.displayValue}
      lockedDetail={props.lockedDetail}
      signal={props.signal}
      trailing={props.trailing}
    />
  );
};

export default LockedFilterChip;
