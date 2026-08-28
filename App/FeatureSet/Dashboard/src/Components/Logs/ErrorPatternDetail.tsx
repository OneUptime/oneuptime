import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import Route from "Common/Types/API/Route";
import Service from "Common/Models/DatabaseModels/Service";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { getSeverityTheme } from "Common/UI/Components/LogsViewer/components/severityTheme";
import { truncateErrorPattern } from "Common/Utils/Telemetry/LogErrorPattern";
import AppLink from "../AppLink/AppLink";
import {
  ErrorPatternCoOccurrenceRow,
  ErrorPatternCorrelation,
  ErrorPatternResourceRow,
  ErrorPatternSampleRow,
  ErrorPatternTimelinePoint,
  ErrorPatternTraceRow,
  ErrorPatternTrend,
  LogsInsightsScope,
  SharedAttribute,
  TopErrorPatternRow,
  buildErrorPatternLogsRoute,
  buildErrorPatternTraceRoute,
  computeErrorPatternTrend,
  describeOccurrenceCount,
  describeTimeRange,
  getCorrelationOccurrenceTotal,
  summarizeSharedAttributes,
} from "../../Utils/LogsInsights";
import { fetchErrorPatternCorrelation } from "./LogsInsightsApi";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import EventName from "../../Utils/EventName";
import useEventTimeReferenceLines, {
  EventTimeReferenceLines,
} from "../Metrics/Utils/UseEventTimeReferenceLines";
import {
  ErrorPatternClassification,
  ErrorPatternEvent,
  ErrorPatternEvidence,
  ErrorPatternFinding,
  buildErrorPatternFindings,
  buildErrorPatternPrompt,
  classifyErrorPattern,
  readEventKindFromLabel,
} from "../../Utils/ErrorPatternInsights";

/*
 * The drill-down the issue asked for: pick one error out of the Top Errors
 * list and see what surrounds it — when it fired, whether it is getting
 * worse, what its occurrences have in common, which sources and traces
 * carry it, what else was failing at the same moments, and the raw lines.
 *
 * Every section is scoped to the same slice the list was, so nothing here
 * correlates against logs the user is not looking at.
 */

export interface ComponentProps {
  pattern: TopErrorPatternRow;
  scope: LogsInsightsScope;
  serviceNameById: Map<string, Service>;
  onClose: () => void;
}

/** How many rows each correlation section asks for. */
const CORRELATION_LIMIT: number = 10;

const TREND_PRESENTATION: Record<
  ErrorPatternTrend["direction"],
  { label: string; className: string; icon: IconProp }
> = {
  rising: {
    label: "Rising",
    className: "bg-red-50 text-red-700",
    icon: IconProp.ArrowUp,
  },
  falling: {
    label: "Falling",
    className: "bg-emerald-50 text-emerald-700",
    icon: IconProp.ArrowDown,
  },
  steady: {
    label: "Steady",
    className: "bg-gray-100 text-gray-600",
    icon: IconProp.Minus,
  },
  unknown: {
    label: "Not enough data",
    className: "bg-gray-100 text-gray-500",
    icon: IconProp.Help,
  },
};

function formatTimestamp(date: Date | null): string {
  if (!date) {
    return "unknown";
  }

  return OneUptimeDate.getDateAsLocalFormattedString(date);
}

const SectionHeading: FunctionComponent<{
  title: string;
  subtitle?: string | undefined;
}> = (props: {
  title: string;
  subtitle?: string | undefined;
}): ReactElement => {
  return (
    <div className="mb-2">
      <h4 className="text-sm font-semibold text-gray-900">{props.title}</h4>
      {props.subtitle && (
        <p className="text-xs text-gray-500">{props.subtitle}</p>
      )}
    </div>
  );
};

/*
 * A hand-rolled bar chart rather than a charting component: the timeline is
 * a single series of counts with no axes, legend or interaction, and the
 * panel it lives in is narrow. Bars carry a title attribute so the exact
 * bucket and count are still reachable on hover.
 */
const Timeline: FunctionComponent<{
  points: Array<ErrorPatternTimelinePoint>;
}> = (props: { points: Array<ErrorPatternTimelinePoint> }): ReactElement => {
  if (props.points.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No bucketed occurrences to chart in this window.
      </p>
    );
  }

  const peak: number = Math.max(
    ...props.points.map((point: ErrorPatternTimelinePoint): number => {
      return point.count;
    }),
    1,
  );

  return (
    <div className="flex h-24 items-end gap-0.5">
      {props.points.map(
        (point: ErrorPatternTimelinePoint, index: number): ReactElement => {
          const heightPercent: number = Math.max(
            2,
            Math.round((point.count / peak) * 100),
          );

          return (
            <div
              key={`${point.time?.toISOString() || "bucket"}-${index}`}
              className="flex-1 rounded-sm bg-red-400"
              style={{ height: `${heightPercent}%` }}
              title={`${formatTimestamp(point.time)} — ${point.count}`}
            />
          );
        },
      )}
    </div>
  );
};

const ErrorPatternDetail: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [correlation, setCorrelation] =
    useState<ErrorPatternCorrelation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const patternText: string = props.pattern.pattern;

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const result: ErrorPatternCorrelation =
        await fetchErrorPatternCorrelation(
          props.scope,
          patternText,
          CORRELATION_LIMIT,
        );

      setCorrelation(result);
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
    } finally {
      setIsLoading(false);
    }
    /*
     * Safe to depend on the scope object itself: the host page memoizes it
     * on the time range and the selected resources, so it is referentially
     * stable between renders — and when it does change the host closes this
     * panel rather than leaving it describing a window that moved.
     */
  }, [patternText, props.scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const logsRoute: Route | null = buildErrorPatternLogsRoute(
    patternText,
    props.scope,
    props.pattern.sampleBody,
  );

  const resourceLabel: (resourceId: string) => string = useCallback(
    (resourceId: string): string => {
      return (
        props.serviceNameById.get(resourceId)?.name?.toString() || resourceId
      );
    },
    [props.serviceNameById],
  );

  /*
   * The window the user picked, resolved once for the whole panel. A preset
   * range resolves against "now" on every call, so resolving it in two
   * places would let the trend and the event overlay describe two slightly
   * different windows.
   */
  const patternWindow: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.scope.timeRange,
    );
  }, [props.scope.timeRange]);

  /*
   * Deploys, config changes, incidents and alerts inside the window — the
   * "what else happened around when this spiked" the issue behind this panel
   * asked for. Reuses the same overlay the metric charts draw, so a deploy
   * marked on a chart and a deploy named here are the same record.
   */
  const { lines: eventLines }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: true,
      window: patternWindow,
    });

  const events: Array<ErrorPatternEvent> = useMemo(() => {
    return eventLines
      .map((line: ChartTimeReferenceLineProps): ErrorPatternEvent => {
        const label: string = line.label || "Event";

        return {
          kind: readEventKindFromLabel(label),
          label,
          timeMs: line.date.getTime(),
        };
      })
      .sort((left: ErrorPatternEvent, right: ErrorPatternEvent): number => {
        return left.timeMs - right.timeMs;
      });
  }, [eventLines]);

  /*
   * Classified off the message alone, so it is available even while the
   * correlation is still loading and even when the correlation fails.
   */
  const classification: ErrorPatternClassification = useMemo(() => {
    return classifyErrorPattern(patternText, props.pattern.sampleBody);
  }, [patternText, props.pattern.sampleBody]);

  const body: ReactElement = ((): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void load();
          }}
        />
      );
    }

    if (!correlation) {
      return (
        <ErrorMessage message="No correlation data is available for this error." />
      );
    }

    /*
     * Measured against the window the user picked, so a pattern whose
     * occurrences all sit at the start of it is compared with the silence
     * that followed rather than with itself.
     */
    const trend: ErrorPatternTrend = computeErrorPatternTrend(
      correlation.timeline,
      patternWindow.startValue,
      patternWindow.endValue,
    );
    const trendStyle: {
      label: string;
      className: string;
      icon: IconProp;
    } = TREND_PRESENTATION[trend.direction];

    /*
     * Denominator from the SAME response as the numerators. props.pattern
     * .count came from the earlier list request, which resolved its own
     * window against its own `now`.
     */
    const occurrenceTotal: number =
      getCorrelationOccurrenceTotal(correlation.timeline) ||
      props.pattern.count;

    const sharedAttributes: Array<SharedAttribute> = summarizeSharedAttributes(
      correlation.attributes,
      occurrenceTotal,
    );

    const evidence: ErrorPatternEvidence = {
      pattern: props.pattern,
      correlation,
      trend,
      sharedAttributes,
      occurrenceTotal,
      windowStartMs: patternWindow.startValue.getTime(),
      windowEndMs: patternWindow.endValue.getTime(),
      events,
      resourceLabel,
    };

    const findings: Array<ErrorPatternFinding> =
      buildErrorPatternFindings(evidence);

    const explainWithAi: VoidFunction = (): void => {
      /*
       * Opens Ask AI (never toggles it closed) with the whole evidence pack
       * as an editable prompt — the issue behind this panel asked for
       * exactly this: an AI answer about the selected error and window
       * "without needing to separately open Ask AI and re-describe the
       * problem". It pre-fills rather than sends, so the user reads the
       * question before anything is asked on their behalf.
       */
      GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
        prompt: buildErrorPatternPrompt(evidence, findings, classification),
      });
    };

    return (
      <Fragment>
        {/* What the error is */}
        <div className="pb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {props.pattern.severities.map((severity: string): ReactElement => {
              return (
                <span
                  key={severity}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    getSeverityTheme(severity).badgeClass
                  }`}
                >
                  {severity}
                </span>
              );
            })}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${trendStyle.className}`}
            >
              <Icon icon={trendStyle.icon} className="h-3 w-3" />
              {trendStyle.label}
              {trend.direction !== "unknown" && (
                <span className="opacity-70">
                  {trend.changePercent > 0 ? "+" : ""}
                  {trend.changePercent}%
                </span>
              )}
            </span>
          </div>

          <p className="break-words rounded-md bg-gray-50 p-3 font-mono text-sm text-gray-800">
            {props.pattern.sampleBody || patternText}
          </p>

          <p className="mt-2 text-sm text-gray-600">
            {describeOccurrenceCount(
              props.pattern.count,
              props.scope.timeRange,
            )}
            , across {props.pattern.resourceCount}{" "}
            {props.pattern.resourceCount === 1 ? "source" : "sources"}. First
            seen {formatTimestamp(props.pattern.firstSeenAt)}, last seen{" "}
            {formatTimestamp(props.pattern.lastSeenAt)}.
          </p>

          {logsRoute && (
            <AppLink
              to={logsRoute}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>Open matching logs</span>
            </AppLink>
          )}
        </div>

        {/* What this looks like, and what to do about it */}
        <div className="py-5">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">
                Likely cause and what to check
              </h4>
              <p className="text-xs text-gray-500">
                Read from this error&apos;s message and the evidence below — no
                guesswork you cannot trace back.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              title="Open Ask AI with this error and all of its evidence as an editable prompt"
              onClick={explainWithAi}
            >
              <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
              Explain with AI
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
                {classification.title}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-700">
              {classification.summary}
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Usually caused by
                </p>
                <ul className="space-y-1">
                  {classification.likelyCauses.map(
                    (cause: string): ReactElement => {
                      return (
                        <li
                          key={cause}
                          className="flex items-start gap-2 text-sm text-gray-700"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300"
                          />
                          <span>{cause}</span>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  What to check
                </p>
                <ol className="space-y-1">
                  {classification.whatToCheck.map(
                    (step: string, index: number): ReactElement => {
                      return (
                        <li
                          key={step}
                          className="flex items-start gap-2 text-sm text-gray-700"
                        >
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-semibold text-indigo-600">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      );
                    },
                  )}
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* What stands out about this particular error, right now */}
        <div className="py-5">
          <SectionHeading
            title="What stands out"
            subtitle="Read from this error's own timeline, sources and surroundings in the selected window."
          />
          <ul className="space-y-1.5">
            {findings.map(
              (finding: ErrorPatternFinding, index: number): ReactElement => {
                return (
                  <li
                    key={`${index}-${finding.severity}`}
                    className="flex items-start gap-2 text-sm text-gray-700"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        finding.severity === "critical"
                          ? "bg-red-500"
                          : finding.severity === "warning"
                            ? "bg-amber-500"
                            : "bg-sky-400"
                      }`}
                    />
                    <span>{finding.text}</span>
                  </li>
                );
              },
            )}
          </ul>
        </div>

        {/* Deploys, incidents and alerts around the same moments */}
        <div className="py-5">
          <SectionHeading
            title="What else happened in this window"
            subtitle="Deployments, config changes, incidents and alerts recorded over the same range."
          />
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">
              No deployments, incidents or alerts were recorded in this window.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {events.map(
                (event: ErrorPatternEvent, index: number): ReactElement => {
                  return (
                    <li
                      key={`${event.timeMs}-${index}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            event.kind === "incident"
                              ? "bg-red-400"
                              : event.kind === "alert"
                                ? "bg-amber-400"
                                : "bg-indigo-500"
                          }`}
                        />
                        <span className="min-w-0 break-words text-sm text-gray-800">
                          {event.label}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-xs text-gray-500">
                        {formatTimestamp(new Date(event.timeMs))}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>

        {/* When it happened */}
        <div className="py-5">
          <SectionHeading
            title="When it happened"
            subtitle={`Occurrences per ${correlation.bucketSizeInMinutes} min bucket over ${describeTimeRange(props.scope.timeRange)}.`}
          />
          <Timeline points={correlation.timeline} />
        </div>

        {/* What the occurrences have in common */}
        <div className="py-5">
          <SectionHeading
            title="What these occurrences share"
            subtitle="Attributes carried by the matching logs, most widespread first."
          />
          {sharedAttributes.length === 0 ? (
            <p className="text-sm text-gray-500">
              These logs carry no attributes in common.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {sharedAttributes.map(
                (attribute: SharedAttribute): ReactElement => {
                  return (
                    <li
                      key={`${attribute.key}=${attribute.value}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2"
                    >
                      <span className="min-w-0 break-words font-mono text-xs text-gray-700">
                        <span className="text-gray-500">{attribute.key}</span>
                        {" = "}
                        <span className="font-medium text-gray-900">
                          {attribute.value}
                        </span>
                      </span>
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          attribute.isUniversal
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {attribute.isUniversal
                          ? "every occurrence"
                          : `${attribute.coveragePercent}%`}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>

        {/* Where it happens */}
        <div className="py-5">
          <SectionHeading
            title="Where it happens"
            subtitle="Services, hosts and clusters reporting this error."
          />
          {correlation.resources.length === 0 ? (
            <p className="text-sm text-gray-500">No sources to report.</p>
          ) : (
            <ul className="space-y-1.5">
              {correlation.resources.map(
                (resource: ErrorPatternResourceRow): ReactElement => {
                  return (
                    <li
                      key={resource.resourceId}
                      className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2"
                    >
                      <span className="min-w-0 break-words text-sm text-gray-800">
                        {resourceLabel(resource.resourceId)}
                        {resource.resourceType && (
                          <span className="ml-2 text-xs text-gray-400">
                            {resource.resourceType}
                          </span>
                        )}
                      </span>
                      <span className="flex-shrink-0 text-xs font-medium text-gray-600">
                        {resource.count}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>

        {/* What else was failing at the same time */}
        <div className="py-5">
          <SectionHeading
            title="What else was failing at the same time"
            subtitle={`Other errors that fired in the same ${correlation.bucketSizeInMinutes} min buckets as this one.`}
          />
          {correlation.coOccurringPatterns.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing else was failing in the same buckets.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {correlation.coOccurringPatterns.map(
                (row: ErrorPatternCoOccurrenceRow): ReactElement => {
                  return (
                    <li
                      key={row.pattern}
                      className="rounded-md border border-gray-100 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 break-words font-mono text-xs text-gray-800">
                          {truncateErrorPattern(
                            row.sampleBody || row.pattern,
                            140,
                          )}
                        </span>
                        <span className="flex-shrink-0 text-xs font-medium text-gray-600">
                          {row.count}
                        </span>
                      </div>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>

        {/* Traces */}
        <div className="py-5">
          <SectionHeading
            title="Traces carrying this error"
            subtitle="Open a trace to see the request the error happened inside."
          />
          {correlation.traces.length === 0 ? (
            <p className="text-sm text-gray-500">
              None of these logs carry a trace id.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {correlation.traces.map(
                (trace: ErrorPatternTraceRow): ReactElement => {
                  const traceRoute: Route | null = buildErrorPatternTraceRoute(
                    trace.traceId,
                  );

                  return (
                    <li
                      key={trace.traceId}
                      className="flex items-center justify-between gap-3 rounded-md border border-gray-100 px-3 py-2"
                    >
                      {traceRoute ? (
                        <AppLink
                          to={traceRoute}
                          className="min-w-0 truncate font-mono text-xs text-indigo-600 hover:underline"
                        >
                          {trace.traceId}
                        </AppLink>
                      ) : (
                        <span className="min-w-0 truncate font-mono text-xs text-gray-700">
                          {trace.traceId}
                        </span>
                      )}
                      <span className="flex-shrink-0 text-xs text-gray-500">
                        {trace.count}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>

        {/* Raw lines */}
        <div className="py-5">
          <SectionHeading
            title="Recent occurrences"
            subtitle="The most recent raw log lines behind this error."
          />
          {correlation.samples.length === 0 ? (
            <p className="text-sm text-gray-500">No sample lines available.</p>
          ) : (
            <ul className="space-y-2">
              {correlation.samples.map(
                (
                  sample: ErrorPatternSampleRow,
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={sample.logId || `sample-${index}`}
                      className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span>{formatTimestamp(sample.time)}</span>
                        {sample.severityText && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset ${
                              getSeverityTheme(sample.severityText).badgeClass
                            }`}
                          >
                            {sample.severityText}
                          </span>
                        )}
                        <span>{resourceLabel(sample.resourceId)}</span>
                      </div>
                      <p className="mt-1 break-words font-mono text-xs text-gray-800">
                        {sample.body}
                      </p>
                    </li>
                  );
                },
              )}
            </ul>
          )}
        </div>
      </Fragment>
    );
  })();

  return (
    <SideOver
      title="Error details"
      description={truncateErrorPattern(patternText, 120)}
      size={SideOverSize.Large}
      onClose={props.onClose}
    >
      {body}
    </SideOver>
  );
};

export default ErrorPatternDetail;
