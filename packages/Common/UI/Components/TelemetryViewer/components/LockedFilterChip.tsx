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
import {
  LockedFilterDetail,
  LockedFilterScopeMatch,
} from "../../../../Types/Telemetry/LockedFilterDetail";
import {
  TELEMETRY_EXPLORER_LABELS,
  TelemetrySignal,
} from "../../../../Utils/Telemetry/LockedFilterSearch";
import {
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translatePlural,
  translateTemplate,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

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

export const COPIED_SEARCH_SYNTAX_ANNOUNCEMENT: string = translationKey(
  "Copied search syntax",
);
export const COPY_FAILED_ANNOUNCEMENT: string = translationKey("Copy failed");

/** Shown in the tooltip when a detail names neither a token nor a reason. */
export const NO_SEARCH_SYNTAX_REASON: string = translationKey(
  "This filter has no search syntax.",
);

/** A scope chip's opening line when its builder gave none. */
export const DEFAULT_SCOPE_SUMMARY: string = translationKey(
  "This page only shows telemetry that matches any of these:",
);

/*
 * The chip's accessible name, one whole sentence per case: with or without
 * the scope's value count, and with the Enter hint when there is syntax to
 * copy.
 */
const LOCKED_FILTER_LABEL: string = translationKey(
  "{{key}}: {{value}}, locked filter",
);
const LOCKED_FILTER_LABEL_WITH_COPY_HINT: string = translationKey(
  "{{key}}: {{value}}, locked filter. Press Enter to copy its search syntax.",
);
const SCOPED_LOCKED_FILTER_LABEL: PluralTemplate = {
  one: "{{key}}: {{value}}, locked filter matching any of {{count}} value",
  other: "{{key}}: {{value}}, locked filter matching any of {{count}} values",
};
const SCOPED_LOCKED_FILTER_LABEL_WITH_COPY_HINT: PluralTemplate = {
  one: "{{key}}: {{value}}, locked filter matching any of {{count}} value. Press Enter to copy its search syntax.",
  other:
    "{{key}}: {{value}}, locked filter matching any of {{count}} values. Press Enter to copy its search syntax.",
};

type GetScopeMatchesFunction = (
  detail: LockedFilterDetail | undefined,
) => Array<LockedFilterScopeMatch>;

/**
 * The scope breakdown a detail carries: entries with a label and at least
 * one non-blank value, values trimmed. Anything else is dropped rather than
 * drawn as an empty heading.
 */
export const getLockedFilterScopeMatches: GetScopeMatchesFunction = (
  detail: LockedFilterDetail | undefined,
): Array<LockedFilterScopeMatch> => {
  const matches: unknown = detail?.scopeMatches;

  if (!Array.isArray(matches)) {
    return [];
  }

  const result: Array<LockedFilterScopeMatch> = [];

  for (const candidate of matches as Array<unknown>) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const match: LockedFilterScopeMatch = candidate as LockedFilterScopeMatch;
    const label: string =
      typeof match.label === "string" ? match.label.trim() : "";
    const values: Array<string> = (
      Array.isArray(match.values) ? match.values : []
    )
      .map((value: unknown): string => {
        return typeof value === "string" ? value.trim() : "";
      })
      .filter((value: string): boolean => {
        return value.length > 0;
      });

    if (!label || values.length === 0) {
      continue;
    }

    const description: string =
      typeof match.description === "string" ? match.description.trim() : "";

    result.push(
      description
        ? { label: label, description: description, values: values }
        : { label: label, values: values },
    );
  }

  return result;
};

type CountScopeMatchValuesFunction = (
  matches: ReadonlyArray<LockedFilterScopeMatch>,
) => number;

/** How many values a scope breakdown lists across all its headings. */
export const countLockedFilterScopeValues: CountScopeMatchValuesFunction = (
  matches: ReadonlyArray<LockedFilterScopeMatch>,
): number => {
  return matches.reduce((total: number, match: LockedFilterScopeMatch) => {
    return total + match.values.length;
  }, 0);
};

type GetLockedFilterChipAriaLabelFunction = (
  displayKey: string,
  displayValue: string,
  hasSearchToken?: boolean | undefined,
  scopeValueCount?: number | undefined,
) => string;

/**
 * The accessible name of a chip that carries a detail. It names the filter,
 * says it is locked, says how many things a scope chip matches (its tooltip
 * lists them), and — when there is syntax to copy — tells a keyboard user
 * what Enter does, since the tooltip's own Copy button is out of reach.
 */
export const getLockedFilterChipAriaLabel: GetLockedFilterChipAriaLabelFunction =
  (
    displayKey: string,
    displayValue: string,
    hasSearchToken?: boolean | undefined,
    scopeValueCount?: number | undefined,
  ): string => {
    const values: TemplateValues = {
      key: translatableTerm(displayKey),
      value: displayValue,
    };

    if (scopeValueCount && scopeValueCount > 0) {
      return translatePlural(
        hasSearchToken
          ? SCOPED_LOCKED_FILTER_LABEL_WITH_COPY_HINT
          : SCOPED_LOCKED_FILTER_LABEL,
        scopeValueCount,
        values,
      );
    }

    return translateTemplate(
      hasSearchToken ? LOCKED_FILTER_LABEL_WITH_COPY_HINT : LOCKED_FILTER_LABEL,
      values,
    );
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

// English, looked up where the button shows it.
const copyButtonText: CopyButtonLabelFunction = (
  feedback: CopiedFeedback,
): string => {
  if (feedback.copied) {
    return translationKey("Copied!");
  }

  if (feedback.failed) {
    return translationKey("Copy failed");
  }

  return translationKey("Copy");
};

const SearchSyntaxRow: FunctionComponent<SearchSyntaxRowProps> = (
  props: SearchSyntaxRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
          aria-label={translator.translateText(
            feedback.copied
              ? "Copied"
              : feedback.failed
                ? "Copy failed"
                : "Copy search syntax",
          )}
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
          <span>{translator.translateText(copyButtonText(feedback))}</span>
        </button>
      </div>
      <p className="text-[11px] text-gray-400">
        {explorerLabel
          ? translator.translateTemplate(
              "Paste into the {{explorer}} explorer search bar.",
              { explorer: translatableTerm(explorerLabel) },
            )
          : translator.translateText("Paste into the explorer search bar.")}
      </p>
    </div>
  );
};

interface ScopeMatchesSectionProps {
  summary?: string | undefined;
  matches: ReadonlyArray<LockedFilterScopeMatch>;
}

/*
 * What a scope chip matches, heading by heading: "Endpoints · 24", the
 * sentence on how telemetry reaches the scope through them, then each value.
 * The list scrolls inside the tooltip, so a database with dozens of
 * endpoints still gets a tooltip that fits on screen.
 */
const ScopeMatchesSection: FunctionComponent<ScopeMatchesSectionProps> = (
  props: ScopeMatchesSectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-2" data-testid="locked-filter-scope">
      <p
        className="text-[11px] text-gray-600"
        data-testid="locked-filter-scope-summary"
      >
        {translator.translateText(props.summary || DEFAULT_SCOPE_SUMMARY)}
      </p>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {props.matches.map((match: LockedFilterScopeMatch) => {
          return (
            <div
              key={match.label}
              className="space-y-0.5"
              data-testid="locked-filter-scope-match"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {translator.translateText(match.label)}
                </span>
                <span
                  className="text-[10px] tabular-nums text-gray-400"
                  data-testid="locked-filter-scope-match-count"
                >
                  {match.values.length}
                </span>
              </div>
              {match.description ? (
                <p className="text-[11px] text-gray-400">
                  {translator.translateText(match.description)}
                </p>
              ) : (
                <></>
              )}
              <ul className="space-y-0.5">
                {match.values.map((value: string) => {
                  return (
                    <li
                      key={value}
                      className="break-all rounded bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] text-gray-700"
                      data-testid="locked-filter-scope-value"
                    >
                      {value}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * The body of the locked chip's tooltip: the search syntax that reproduces
 * the filter on the explorer, with a Copy button — or, when the grammar
 * cannot spell the filter, the reason why. A chip that stands for a whole
 * scope (a database: its id, endpoints and instances) leads with what it
 * matches instead, and adds the syntax only when there is some to copy — a
 * reason nobody can act on is noise under a list that already says what the
 * filter does. Exported so tests can render it without going through
 * Tippy's hover timers.
 */
export const LockedFilterTooltipContent: FunctionComponent<
  LockedFilterTooltipContentProps
> = (props: LockedFilterTooltipContentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const detail: LockedFilterDetail = props.lockedDetail;
  const scopeMatches: Array<LockedFilterScopeMatch> =
    getLockedFilterScopeMatches(detail);

  if (scopeMatches.length > 0) {
    return (
      <div
        className="w-96 max-w-full space-y-2 p-1 text-left text-xs"
        data-testid="locked-filter-tooltip"
      >
        <ScopeMatchesSection
          summary={detail.scopeSummary?.trim() || undefined}
          matches={scopeMatches}
        />
        {detail.searchToken ? (
          <div className="space-y-1 border-t border-gray-100 pt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {translator.translateText("Search syntax")}
            </div>
            <SearchSyntaxRow
              searchToken={detail.searchToken}
              signal={props.signal}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-80 max-w-full space-y-1 p-1 text-left text-xs"
      data-testid="locked-filter-tooltip"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {translator.translateText("Search syntax")}
      </div>
      {detail.searchToken ? (
        <SearchSyntaxRow
          searchToken={detail.searchToken}
          signal={props.signal}
        />
      ) : (
        <p className="text-[11px] text-gray-400">
          {translator.translateText(
            detail.searchTokenUnavailableReason || NO_SEARCH_SYNTAX_REASON,
          )}
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
  /*
   * Set for a chip that stands for a whole scope: an info mark after the
   * value says there is more behind it — the list of what it matches.
   */
  hasScopeMatches?: boolean | undefined;
}

const LockedFilterChipBody: FunctionComponent<LockedFilterChipBodyProps> = (
  props: LockedFilterChipBodyProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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
      <span className="font-medium text-gray-500">
        {translator.translateText(props.displayKey)}:
      </span>
      <span>{props.displayValue}</span>
      {props.hasScopeMatches ? (
        <span
          className="inline-flex items-center"
          data-testid="locked-filter-chip-scope-mark"
          aria-hidden="true"
        >
          <Icon
            icon={IconProp.InformationCircle}
            className="h-3 w-3 text-gray-400"
          />
        </span>
      ) : (
        <></>
      )}
    </>
  );
};

interface DetailedLockedFilterChipProps {
  displayKey: string;
  displayValue: string;
  lockedDetail: LockedFilterDetail;
  signal?: TelemetrySignal | undefined;
  trailing?: ReactNode;
}

/*
 * The chip that has something to say. The control is a native button so it
 * is focusable with a role that permits a name; Tippy attaches the search
 * syntax tooltip to it (focus and hover open it; aria-describedby reads it).
 */
const DetailedLockedFilterChip: FunctionComponent<
  DetailedLockedFilterChipProps
> = (props: DetailedLockedFilterChipProps): ReactElement => {
  const translator: Translator = useTranslator();
  const feedback: CopiedFeedback = useCopiedFeedback();
  const searchToken: string | undefined = props.lockedDetail.searchToken;
  const scopeValueCount: number = countLockedFilterScopeValues(
    getLockedFilterScopeMatches(props.lockedDetail),
  );

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
        scopeValueCount,
      )}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        /*
         * Enter and Space arrive here as clicks on a native button. A chip
         * without syntax has nothing to copy; its button exists so the
         * reason in its tooltip is reachable from the keyboard at all.
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
        hasScopeMatches={scopeValueCount > 0}
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
        {translator.translateText(announcement)}
      </span>
    </span>
  );
};

const LockedFilterChip: FunctionComponent<LockedFilterChipProps> = (
  props: LockedFilterChipProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.lockedDetail) {
    /*
     * Exactly the pill from before the tooltip: not focusable, no name of
     * its own, the plain title. Nothing would open on focus, so a tab stop
     * here would be a dead one.
     */
    return (
      <span
        className={LOCKED_FILTER_CHIP_CLASS_NAME}
        title={translator.translateTemplate(
          "{{key}}: {{value}} (applied filter)",
          {
            key: translatableTerm(props.displayKey),
            value: props.displayValue,
          },
        )}
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
    <DetailedLockedFilterChip
      displayKey={props.displayKey}
      displayValue={props.displayValue}
      lockedDetail={props.lockedDetail}
      signal={props.signal}
      trailing={props.trailing}
    />
  );
};

export default LockedFilterChip;
