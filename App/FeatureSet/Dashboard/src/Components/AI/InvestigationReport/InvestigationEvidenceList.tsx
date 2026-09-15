import {
  getRouteForCitationTarget,
  targetTypeToIcon,
} from "../../AIChat/CitationTargetNav";
import WidgetRenderer from "../../AIChat/Widgets/WidgetRenderer";
import {
  EvidenceToolDescription,
  FormattedEvidenceArgument,
  describeCitationTargetPage,
  describeEvidenceTool,
  formatEvidenceArguments,
  formatEvidenceDateTime,
  formatEvidenceDuration,
  formatEvidenceLabel,
  formatQueryCount,
  formatRowCount,
  getEvidenceEmptyRowsMessage,
} from "../../../Utils/InvestigationEvidenceFormat";
import {
  InvestigationReportSubjectType,
  parseInvestigationEvidenceRows,
} from "./InvestigationReportData";
import {
  InvestigationEvidenceItem,
  InvestigationEvidenceRowsResponse,
} from "Common/Types/AI/InvestigationEvidence";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { InvestigationEvidenceCheckedEntry } from "Common/Utils/AI/InvestigationReport";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/*
 * Asks the list to reveal one citation: expand it (loading its rows when it
 * can), scroll it into view and highlight it briefly. A new `requestId`
 * repeats the request for the same citation.
 */
export interface EvidenceFocusRequest {
  citationId: string;
  requestId: number;
}

export interface ComponentProps {
  // Structured evidence from the API. When present it is the whole list.
  items: Array<InvestigationEvidenceItem>;
  // The report's own "Evidence checked" block, for runs that predate `items`.
  legacyEntries: Array<InvestigationEvidenceCheckedEntry>;
  subjectType: InvestigationReportSubjectType;
  subjectId: string;
  runId: string | null;
  focusRequest?: EvidenceFocusRequest | null | undefined;
}

export const EVIDENCE_HIGHLIGHT_DURATION_MS: number = 2000;

type EvidenceRowsState =
  | { status: "loading" }
  | { status: "loaded"; response: InvestigationEvidenceRowsResponse }
  | { status: "error"; message: string };

const CITATION_BADGE_CLASS_NAME: string =
  "inline-flex h-5 min-w-[1.75rem] flex-shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums";

function getRowsKey(runId: string | null, citationId: string): string {
  return `${runId || ""}:${citationId}`;
}

function getCitationBadgeClassName(rowCount: number): string {
  return `${CITATION_BADGE_CLASS_NAME} ${
    rowCount > 0 ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-600"
  }`;
}

function getRowCountPillClassName(rowCount: number): string {
  return `inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${
    rowCount > 0 ? "bg-gray-100 text-gray-600" : "bg-gray-50 text-gray-400"
  }`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/*
 * "Evidence checked" for an AI investigation: every read-only query the AI
 * ran, what it asked, and — on demand — the rows it returned, re-run with the
 * viewer's own permissions. Everything shown comes from the run's recorded
 * tool calls; the report's prose never decides what a row queries or links to.
 */
const InvestigationEvidenceList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idPrefix: string = useId();
  const contextKey: string = `${props.subjectType}:${props.subjectId}:${props.runId || ""}`;
  const [expandedCitationIds, setExpandedCitationIds] = useState<Array<string>>(
    [],
  );
  const [rowsByKey, setRowsByKey] = useState<Record<string, EvidenceRowsState>>(
    {},
  );
  const [highlightedCitationId, setHighlightedCitationId] = useState<
    string | null
  >(null);
  const contextKeyRef: React.MutableRefObject<string> =
    useRef<string>(contextKey);
  const previousContextKeyRef: React.MutableRefObject<string> =
    useRef<string>(contextKey);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const rowsByKeyRef: React.MutableRefObject<
    Record<string, EvidenceRowsState>
  > = useRef<Record<string, EvidenceRowsState>>({});
  const highlightTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowElementsRef: React.MutableRefObject<Map<string, HTMLElement>> =
    useRef<Map<string, HTMLElement>>(new Map<string, HTMLElement>());
  const toggleElementsRef: React.MutableRefObject<
    Map<string, HTMLButtonElement>
  > = useRef<Map<string, HTMLButtonElement>>(
    new Map<string, HTMLButtonElement>(),
  );
  // A revealed row waiting for its details to render before it is scrolled to.
  const pendingScrollCitationIdRef: React.MutableRefObject<string | null> =
    useRef<string | null>(null);

  // Updated during render so a late response is compared with what is shown.
  contextKeyRef.current = contextKey;
  rowsByKeyRef.current = rowsByKey;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
    };
  }, []);

  /*
   * A different subject or run is a different evidence list: nothing
   * expanded, loaded or highlighted for the previous one carries over.
   */
  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }

    previousContextKeyRef.current = contextKey;
    setExpandedCitationIds([]);
    setRowsByKey({});
    setHighlightedCitationId(null);

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
  }, [contextKey]);

  const loadRows: (citationId: string) => Promise<void> = useCallback(
    async (citationId: string): Promise<void> => {
      const requestedContextKey: string = contextKeyRef.current;
      const rowsKey: string = getRowsKey(props.runId, citationId);
      const isCurrent: () => boolean = (): boolean => {
        return (
          isMountedRef.current && contextKeyRef.current === requestedContextKey
        );
      };
      const setRowsState: (state: EvidenceRowsState) => void = (
        state: EvidenceRowsState,
      ): void => {
        setRowsByKey(
          (
            previous: Record<string, EvidenceRowsState>,
          ): Record<string, EvidenceRowsState> => {
            return { ...previous, [rowsKey]: state };
          },
        );
      };

      if (!props.runId) {
        setRowsState({
          status: "error",
          message: "The investigation run could not be identified.",
        });
        return;
      }

      setRowsState({ status: "loading" });

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-investigation/evidence",
            ),
            data: {
              subjectType: props.subjectType,
              subjectId: props.subjectId,
              investigationRunId: props.runId,
              citationId: citationId,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent()) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const rows: InvestigationEvidenceRowsResponse | null =
          parseInvestigationEvidenceRows(response.data);

        if (!rows) {
          setRowsState({
            status: "error",
            message: "The rows for this query could not be read.",
          });
          return;
        }

        setRowsState({ status: "loaded", response: rows });
      } catch (err) {
        if (!isCurrent()) {
          return;
        }

        setRowsState({
          status: "error",
          message: API.getFriendlyMessage(err),
        });
      }
    },
    [props.runId, props.subjectId, props.subjectType],
  );

  const findItem: (
    citationId: string,
  ) => InvestigationEvidenceItem | undefined = useCallback(
    (citationId: string): InvestigationEvidenceItem | undefined => {
      return props.items.find((item: InvestigationEvidenceItem): boolean => {
        return item.citationId === citationId;
      });
    },
    [props.items],
  );

  // First expand of a re-runnable query fetches its rows exactly once.
  const expand: (citationId: string) => void = useCallback(
    (citationId: string): void => {
      const item: InvestigationEvidenceItem | undefined = findItem(citationId);

      if (!item) {
        return;
      }

      setExpandedCitationIds((previous: Array<string>): Array<string> => {
        return previous.includes(citationId)
          ? previous
          : [...previous, citationId];
      });

      if (
        item.canLoadRows &&
        !rowsByKeyRef.current[getRowsKey(props.runId, citationId)]
      ) {
        /*
         * Mark it loading synchronously so a second expand in the same tick
         * cannot start a duplicate request.
         */
        rowsByKeyRef.current = {
          ...rowsByKeyRef.current,
          [getRowsKey(props.runId, citationId)]: { status: "loading" },
        };
        loadRows(citationId).catch(() => {
          // handled inside loadRows
        });
      }
    },
    [findItem, loadRows, props.runId],
  );

  const collapse: (citationId: string) => void = (citationId: string): void => {
    setExpandedCitationIds((previous: Array<string>): Array<string> => {
      return previous.filter((id: string): boolean => {
        return id !== citationId;
      });
    });
  };

  const focusRequestId: number | null = props.focusRequest
    ? props.focusRequest.requestId
    : null;
  const focusCitationId: string | null = props.focusRequest
    ? props.focusRequest.citationId
    : null;

  const scrollToRow: (citationId: string) => void = (
    citationId: string,
  ): void => {
    const rowElement: HTMLElement | undefined =
      rowElementsRef.current.get(citationId);

    if (rowElement && typeof rowElement.scrollIntoView === "function") {
      rowElement.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  };

  /*
   * Declared before the focus effect on purpose: a row that a request is
   * expanding scrolls on the render that shows its details, so "nearest"
   * brings the whole query and its rows into view, not just its header.
   */
  useEffect(() => {
    const citationId: string | null = pendingScrollCitationIdRef.current;

    if (!citationId) {
      return;
    }

    pendingScrollCitationIdRef.current = null;
    scrollToRow(citationId);
  });

  useEffect(() => {
    if (focusRequestId === null || !focusCitationId) {
      return;
    }

    const rowElement: HTMLElement | undefined =
      rowElementsRef.current.get(focusCitationId);

    if (!rowElement) {
      return;
    }

    const willExpand: boolean =
      Boolean(findItem(focusCitationId)) &&
      !expandedCitationIds.includes(focusCitationId);

    expand(focusCitationId);
    setHighlightedCitationId(focusCitationId);

    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = setTimeout(() => {
      highlightTimeoutRef.current = null;

      if (isMountedRef.current) {
        setHighlightedCitationId(null);
      }
    }, EVIDENCE_HIGHLIGHT_DURATION_MS);

    if (willExpand) {
      pendingScrollCitationIdRef.current = focusCitationId;
    } else {
      scrollToRow(focusCitationId);
    }

    /*
     * Keyboard users land on the query they asked about, so Enter collapses
     * it and Tab continues into its details.
     */
    const toggle: HTMLButtonElement | undefined =
      toggleElementsRef.current.get(focusCitationId);

    toggle?.focus({ preventScroll: true });
    /*
     * Keyed on the request id alone: only a new request should reveal a row
     * again, never an ordinary re-render of the list.
     */
  }, [focusRequestId]);

  const hasItems: boolean = props.items.length > 0;
  const rowCount: number = hasItems
    ? props.items.length
    : props.legacyEntries.length;

  if (rowCount === 0) {
    return <></>;
  }

  const registerRowElement: (
    citationId: string,
    element: HTMLElement | null,
  ) => void = (citationId: string, element: HTMLElement | null): void => {
    if (element) {
      rowElementsRef.current.set(citationId, element);
    } else {
      rowElementsRef.current.delete(citationId);
    }
  };

  const getRowClassName: (citationId: string) => string = (
    citationId: string,
  ): string => {
    return `scroll-mt-32 transition-colors duration-300 ${
      highlightedCitationId === citationId
        ? "bg-indigo-50/70 ring-2 ring-inset ring-indigo-400"
        : ""
    }`;
  };

  return (
    <section
      aria-label="Evidence checked"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-gray-50/80 px-5 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
            <Icon icon={IconProp.Database} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Evidence checked
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">
              {hasItems
                ? "Every query OneUptime AI ran while investigating. Expand one to see what it asked and the rows it returned."
                : "Every query OneUptime AI ran while investigating."}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
          {formatQueryCount(rowCount)}
        </span>
      </div>

      <ul className="divide-y divide-gray-100">
        {hasItems
          ? props.items.map((item: InvestigationEvidenceItem): ReactElement => {
              const isExpanded: boolean = expandedCitationIds.includes(
                item.citationId,
              );
              const detailsId: string = `${idPrefix}-evidence-${item.citationId}`;
              const tool: EvidenceToolDescription = describeEvidenceTool(
                item.toolName,
              );
              const icon: IconProp = item.target
                ? targetTypeToIcon[item.target.type] || tool.icon
                : tool.icon;
              const executedAt: string | null = formatEvidenceDateTime(
                item.executedAt,
              );
              // Local times for reading; the raw label stays in the tooltip.
              const displayLabel: string = formatEvidenceLabel(item.label);

              return (
                <li
                  key={item.citationId}
                  ref={(element: HTMLLIElement | null) => {
                    registerRowElement(item.citationId, element);
                  }}
                  data-citation-id={item.citationId}
                  data-highlighted={
                    highlightedCitationId === item.citationId
                      ? "true"
                      : undefined
                  }
                  className={getRowClassName(item.citationId)}
                >
                  <button
                    type="button"
                    ref={(element: HTMLButtonElement | null) => {
                      if (element) {
                        toggleElementsRef.current.set(item.citationId, element);
                      } else {
                        toggleElementsRef.current.delete(item.citationId);
                      }
                    }}
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
                    onClick={() => {
                      if (isExpanded) {
                        collapse(item.citationId);
                      } else {
                        expand(item.citationId);
                      }
                    }}
                  >
                    <span className={getCitationBadgeClassName(item.rowCount)}>
                      {item.citationId}
                    </span>
                    <span className="hidden h-5 w-5 flex-shrink-0 items-center justify-center text-gray-400 sm:flex">
                      <Icon icon={icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="line-clamp-2 text-sm font-medium text-gray-900 [overflow-wrap:anywhere] sm:line-clamp-1"
                        title={item.label}
                      >
                        {displayLabel}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {tool.description}
                        {executedAt ? ` · ${executedAt}` : ""}
                      </span>
                    </span>
                    <span className={getRowCountPillClassName(item.rowCount)}>
                      {formatRowCount(item.rowCount)}
                    </span>
                    <Icon
                      icon={IconProp.ChevronDown}
                      className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div
                    id={detailsId}
                    role="region"
                    aria-label={`${displayLabel} details`}
                    hidden={!isExpanded}
                    className="border-t border-gray-100 bg-gray-50/60 px-4 py-4 sm:px-5"
                  >
                    {isExpanded ? (
                      <EvidenceDetails
                        item={item}
                        rowsState={
                          rowsByKey[getRowsKey(props.runId, item.citationId)]
                        }
                        onRetry={() => {
                          loadRows(item.citationId).catch(() => {
                            // handled inside loadRows
                          });
                        }}
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                </li>
              );
            })
          : props.legacyEntries.map(
              (entry: InvestigationEvidenceCheckedEntry): ReactElement => {
                return (
                  <li
                    key={entry.citationId}
                    ref={(element: HTMLLIElement | null) => {
                      registerRowElement(entry.citationId, element);
                    }}
                    data-citation-id={entry.citationId}
                    data-highlighted={
                      highlightedCitationId === entry.citationId
                        ? "true"
                        : undefined
                    }
                    className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${getRowClassName(entry.citationId)}`}
                  >
                    <span className={getCitationBadgeClassName(entry.rowCount)}>
                      {entry.citationId}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900"
                      title={entry.label}
                    >
                      {formatEvidenceLabel(entry.label)}
                    </span>
                    <span className={getRowCountPillClassName(entry.rowCount)}>
                      {formatRowCount(entry.rowCount)}
                    </span>
                  </li>
                );
              },
            )}
      </ul>
    </section>
  );
};

interface EvidenceDetailsProps {
  item: InvestigationEvidenceItem;
  rowsState: EvidenceRowsState | undefined;
  onRetry: () => void;
}

const EvidenceDetails: FunctionComponent<EvidenceDetailsProps> = (
  props: EvidenceDetailsProps,
): ReactElement => {
  const item: InvestigationEvidenceItem = props.item;
  const argumentsRows: Array<FormattedEvidenceArgument> =
    formatEvidenceArguments(item.toolName, item.queryArguments);
  const ranAt: string | null = formatEvidenceDateTime(item.executedAt);
  const took: string | undefined = formatEvidenceDuration(item.durationInMs);
  const targetRoute: Route | undefined = getRouteForCitationTarget(item.target);
  const detailRows: Array<FormattedEvidenceArgument> = [...argumentsRows];

  if (ranAt) {
    detailRows.push({ key: "ranAt", label: "Ran at", value: ranAt });
  }

  if (took) {
    detailRows.push({ key: "took", label: "Took", value: took });
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          What was queried
        </h4>
        {argumentsRows.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            No filters — the query ran with its defaults.
          </p>
        ) : (
          <></>
        )}
        <dl className="mt-2 divide-y divide-gray-100 rounded-lg bg-white px-3 ring-1 ring-inset ring-gray-200">
          {detailRows.map((row: FormattedEvidenceArgument): ReactElement => {
            return (
              <div
                key={row.key}
                className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-3 sm:gap-3"
              >
                <dt className="text-xs font-medium text-gray-500">
                  {row.label}
                </dt>
                <dd className="min-w-0 break-words text-sm text-gray-900 sm:col-span-2">
                  {row.value}
                </dd>
              </div>
            );
          })}
          <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-3 sm:gap-3">
            <dt className="text-xs font-medium text-gray-500">Tool</dt>
            <dd className="min-w-0 break-all font-mono text-xs leading-5 text-gray-700 sm:col-span-2">
              {item.toolName}
            </dd>
          </div>
        </dl>
      </div>

      {targetRoute && item.target ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={targetRoute}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 hover:text-gray-900"
          >
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
            <span>Open in {describeCitationTargetPage(item.target.type)}</span>
          </Link>
        </div>
      ) : (
        <></>
      )}

      {item.canLoadRows ? (
        <EvidenceRows
          item={item}
          rowsState={props.rowsState}
          onRetry={props.onRetry}
        />
      ) : (
        <p className="text-xs leading-5 text-gray-500">
          This query can&apos;t be re-run from the dashboard, so its rows
          aren&apos;t available here.
        </p>
      )}
    </div>
  );
};

interface EvidenceRowsProps {
  item: InvestigationEvidenceItem;
  rowsState: EvidenceRowsState | undefined;
  onRetry: () => void;
}

const EvidenceRows: FunctionComponent<EvidenceRowsProps> = (
  props: EvidenceRowsProps,
): ReactElement => {
  const state: EvidenceRowsState | undefined = props.rowsState;
  const headingId: string = useId();
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  let body: ReactElement;

  if (!state || state.status === "loading") {
    body = (
      <div
        role="status"
        aria-live="polite"
        className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-inset ring-gray-200"
      >
        <span className="block h-3 w-2/3 rounded bg-gray-100 motion-safe:animate-pulse" />
        <span className="block h-3 w-1/2 rounded bg-gray-100 motion-safe:animate-pulse" />
        <span className="block h-3 w-3/4 rounded bg-gray-100 motion-safe:animate-pulse" />
        <span className="sr-only">Loading rows</span>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="space-y-2">
        <Alert
          type={AlertType.DANGER}
          strongTitle="Could not load these rows"
          title={state.message}
        />
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            /*
             * Retrying swaps this button for the loading placeholder, which
             * would drop keyboard focus to the page. Hold it on the Rows
             * block instead, which outlives every state.
             */
            containerRef.current?.focus({ preventScroll: true });
            props.onRetry();
          }}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  } else {
    body = <LoadedEvidenceRows item={props.item} response={state.response} />;
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="focus:outline-none"
    >
      <h4
        id={headingId}
        className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500"
      >
        Rows
      </h4>
      {body}
    </div>
  );
};

interface LoadedEvidenceRowsProps {
  item: InvestigationEvidenceItem;
  response: InvestigationEvidenceRowsResponse;
}

const LoadedEvidenceRows: FunctionComponent<LoadedEvidenceRowsProps> = (
  props: LoadedEvidenceRowsProps,
): ReactElement => {
  const response: InvestigationEvidenceRowsResponse = props.response;
  const investigatedAt: string | null = formatEvidenceDateTime(
    response.investigatedAt || props.item.executedAt,
  );
  const notice: string = response.isPinnedToInvestigationTime
    ? "Re-run with your permissions over the same time window the AI used."
    : `Shows current data with your permissions — it may differ from what the AI saw${
        investigatedAt ? ` at ${investigatedAt}` : ""
      }.`;
  let content: ReactElement;

  if (response.rowCount === 0) {
    /*
     * A query can come back empty because nothing matches now or because it
     * no longer works (a status that was renamed, a record that is gone).
     * The server says which, so its message stays next to the empty state.
     */
    const emptyRowsMessage: string | null = getEvidenceEmptyRowsMessage(
      response.text,
    );

    content = emptyRowsMessage ? (
      <div className="rounded-lg bg-white px-3 py-3 ring-1 ring-inset ring-gray-200">
        <p className="text-sm font-medium text-gray-700">No rows returned.</p>
        <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line break-words text-xs leading-5 text-gray-500">
          {emptyRowsMessage}
        </p>
      </div>
    ) : (
      <p className="rounded-lg bg-white px-3 py-4 text-center text-sm text-gray-500 ring-1 ring-inset ring-gray-200">
        No rows returned.
      </p>
    );
  } else if (response.widget) {
    content = <WidgetRenderer widgets={[response.widget]} />;
  } else if (response.text) {
    content = (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-900 p-3 font-mono text-xs leading-5 text-gray-100">
        {response.text}
      </pre>
    );
  } else {
    content = (
      <p className="rounded-lg bg-white px-3 py-4 text-center text-sm text-gray-500 ring-1 ring-inset ring-gray-200">
        No rows returned.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-1.5 text-xs leading-5 text-gray-500">
        <Icon
          icon={
            response.isPinnedToInvestigationTime
              ? IconProp.Clock
              : IconProp.Info
          }
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        <span>{notice}</span>
      </div>
      {response.isTruncated && response.rowCount > 0 ? (
        <p className="text-xs text-gray-500">
          The result was long, so only part of it is shown.
        </p>
      ) : (
        <></>
      )}
      {content}
    </div>
  );
};

export default InvestigationEvidenceList;
