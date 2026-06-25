import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import Span, {
  SpanEvent,
  SpanEventType,
  SpanKind,
  SpanStatus,
} from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import SpanUtil from "../../Utils/SpanUtil";

export interface SpanDetailsPanelProps {
  span: Span;
  service?: Service | undefined;
  // Base route to the span's full trace (without the spanId highlight query).
  traceRoute?: Route | undefined;
  // Adds an `attributes.<key>:<value>` chip to the parent explorer's filters.
  onFilterByAttribute?: ((key: string, value: string) => void) | undefined;
}

interface AttributeEntry {
  key: string;
  value: string;
}

function getStatusLabel(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "Error";
  }
  if (status === SpanStatus.Ok) {
    return "Ok";
  }
  return "Unset";
}

function getStatusColor(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "#ef4444";
  }
  if (status === SpanStatus.Ok) {
    return "#10b981";
  }
  return "#9ca3af";
}

// Flatten (possibly nested) span attributes into sorted dotted key/value pairs.
function flattenAttributes(
  obj: JSONObject | undefined,
  prefix: string = "",
): Array<AttributeEntry> {
  if (!obj) {
    return [];
  }
  const out: Array<AttributeEntry> = [];
  for (const key of Object.keys(obj)) {
    const value: unknown = (obj as Record<string, unknown>)[key];
    const full: string = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenAttributes(value as JSONObject, full));
    } else {
      out.push({
        key: full,
        value: Array.isArray(value) ? JSON.stringify(value) : String(value),
      });
    }
  }
  return out.sort((left: AttributeEntry, right: AttributeEntry): number => {
    return left.key.localeCompare(right.key);
  });
}

const SpanDetailsPanel: FunctionComponent<SpanDetailsPanelProps> = (
  props: SpanDetailsPanelProps,
): ReactElement => {
  const { span, service } = props;

  // The list row carries a light span; attributes/events come from a lazy fetch.
  const [fullSpan, setFullSpan] = useState<Span | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const spanIdStr: string = span.spanId?.toString() || "";
  const traceIdStr: string = span.traceId?.toString() || "";

  useEffect(() => {
    let cancelled: boolean = false;

    const loadDetail: () => Promise<void> = async (): Promise<void> => {
      if (!spanIdStr) {
        return;
      }
      setDetailLoading(true);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: {
            ...(projectId ? { projectId } : {}),
            spanId: spanIdStr,
          },
          limit: 1,
          skip: 0,
          select: {
            attributes: true,
            events: true,
            statusMessage: true,
          } as Select<Span>,
          sort: {},
          requestOptions: {},
        });
        if (!cancelled) {
          setFullSpan(result.data[0] || null);
        }
      } catch {
        if (!cancelled) {
          setFullSpan(null);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [spanIdStr]);

  const durationNano: number = Number(span.durationUnixNano || 0);
  const divisibilityFactor: ReturnType<typeof SpanUtil.getDivisibilityFactor> =
    SpanUtil.getDivisibilityFactor(durationNano);
  const durationLabel: string = SpanUtil.getSpanDurationAsString({
    divisibilityFactor,
    spanDurationInUnixNano: durationNano,
  });

  const serviceName: string = service?.name || "unknown service";
  const serviceColor: string = service?.serviceColor?.toString() || "#64748b";

  const statusColor: string = getStatusColor(span.statusCode);
  const statusLabel: string = getStatusLabel(span.statusCode);

  const startTimeDate: Date | null = span.startTime
    ? OneUptimeDate.fromString(span.startTime as unknown as string)
    : null;
  const endTimeDate: Date | null = span.endTime
    ? OneUptimeDate.fromString(span.endTime as unknown as string)
    : null;

  const kindLabel: string = SpanUtil.getSpanKindFriendlyName(
    (span.kind as SpanKind) ?? SpanKind.Internal,
  );

  const statusMessage: string =
    (fullSpan?.statusMessage as unknown as string) ||
    (span.statusMessage as unknown as string) ||
    "";

  const attributeEntries: Array<AttributeEntry> = useMemo(() => {
    return flattenAttributes(fullSpan?.attributes as JSONObject | undefined);
  }, [fullSpan]);

  const attributesAsJson: string | null = useMemo(() => {
    if (attributeEntries.length === 0) {
      return null;
    }
    const flat: Record<string, string> = {};
    for (const entry of attributeEntries) {
      flat[entry.key] = entry.value;
    }
    return JSON.stringify(flat, null, 2);
  }, [attributeEntries]);

  // Exception events surfaced inline so error spans explain themselves.
  const exceptionMessages: Array<string> = useMemo(() => {
    const events: Array<SpanEvent> | undefined = fullSpan?.events;
    if (!events || events.length === 0) {
      return [];
    }
    return events
      .filter((event: SpanEvent): boolean => {
        return event.name === SpanEventType.Exception.toLowerCase();
      })
      .map((event: SpanEvent): string => {
        const attrs: JSONObject = (event.attributes as JSONObject) || {};
        return (
          attrs["exception.message"]?.toString() ||
          attrs["exception.type"]?.toString() ||
          "Exception"
        );
      });
  }, [fullSpan]);

  // Route to the full trace, highlighting this span via `?spanId=`.
  const fullTraceRoute: Route | undefined = useMemo(() => {
    if (!props.traceRoute) {
      return undefined;
    }
    const route: Route = new Route(props.traceRoute.toString());
    if (spanIdStr) {
      route.addQueryParams({ spanId: spanIdStr });
    }
    return route;
  }, [props.traceRoute, spanIdStr]);

  const surfaceCardClass: string = "border-gray-200 bg-gray-50";
  const sectionHeaderClass: string =
    "text-[11px] uppercase tracking-wide text-gray-400";

  const overviewRows: Array<{ label: string; value: ReactElement | string }> = [
    { label: "Service", value: serviceName },
    { label: "Status", value: statusLabel },
    { label: "Duration", value: durationLabel },
    { label: "Span Kind", value: kindLabel },
    ...(startTimeDate
      ? [
          {
            label: "Start Time",
            value:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(startTimeDate),
          },
        ]
      : []),
    ...(endTimeDate
      ? [
          {
            label: "End Time",
            value:
              OneUptimeDate.getDateAsUserFriendlyFormattedString(endTimeDate),
          },
        ]
      : []),
  ];

  return (
    <div className="border-b border-gray-100 bg-gray-50/60 px-5 py-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 items-start gap-3">
            <span
              className="mt-1 h-3 w-3 flex-none rounded-full border border-gray-200"
              style={{ backgroundColor: serviceColor }}
              aria-hidden="true"
            />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="truncate font-mono text-base font-semibold text-gray-900">
                  {span.name || "(unnamed span)"}
                </h3>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: `${statusColor}1a`,
                    color: statusColor,
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: statusColor }}
                  />
                  {statusLabel}
                </span>
              </div>
              <div className="font-mono text-xs text-gray-500">
                {serviceName} · {durationLabel}
              </div>
            </div>
          </div>

          {fullTraceRoute && (
            <Link
              to={fullTraceRoute}
              openInNewTab={false}
              className="inline-flex flex-none items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100"
              title="Open this span in the full trace viewer"
            >
              See full trace
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="mt-4 space-y-5 text-sm text-gray-700">
          {/* Overview */}
          <section className="space-y-3">
            <header className={sectionHeaderClass}>Overview</header>
            <dl
              className={`divide-y divide-gray-200 rounded-lg border ${surfaceCardClass} text-xs`}
            >
              {overviewRows.map(
                (row: {
                  label: string;
                  value: ReactElement | string;
                }): ReactElement => {
                  return (
                    <div
                      key={row.label}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <dt className="text-gray-500">{row.label}</dt>
                      <dd className="truncate text-right font-medium text-gray-800">
                        {row.value}
                      </dd>
                    </div>
                  );
                },
              )}
            </dl>
          </section>

          {/* IDs */}
          <section className="grid gap-4 md:grid-cols-2">
            {traceIdStr && (
              <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className={sectionHeaderClass}>Trace ID</span>
                  <CopyTextButton
                    textToBeCopied={traceIdStr}
                    size="xs"
                    variant="ghost"
                    iconOnly={true}
                    title="Copy trace id"
                  />
                </div>
                <span
                  className="block max-w-full truncate font-mono text-xs text-gray-700"
                  title={traceIdStr}
                >
                  {traceIdStr}
                </span>
              </div>
            )}

            {spanIdStr && (
              <div className={`rounded-lg border ${surfaceCardClass} p-4`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className={sectionHeaderClass}>Span ID</span>
                  <CopyTextButton
                    textToBeCopied={spanIdStr}
                    size="xs"
                    variant="ghost"
                    iconOnly={true}
                    title="Copy span id"
                  />
                </div>
                <span
                  className="block max-w-full truncate font-mono text-xs text-gray-700"
                  title={spanIdStr}
                >
                  {spanIdStr}
                </span>
              </div>
            )}
          </section>

          {/* Status message (errors) */}
          {statusMessage && (
            <section className="space-y-3">
              <header className={sectionHeaderClass}>Status Message</header>
              <div className="rounded-lg border border-red-100 bg-red-50 p-4 font-mono text-[13px] leading-6 text-red-700">
                {statusMessage}
              </div>
            </section>
          )}

          {/* Exceptions */}
          {exceptionMessages.length > 0 && (
            <section className="space-y-3">
              <header className={sectionHeaderClass}>
                Exceptions ({exceptionMessages.length})
              </header>
              <ul className="space-y-2">
                {exceptionMessages.map(
                  (message: string, index: number): ReactElement => {
                    return (
                      <li
                        key={index}
                        className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-mono text-[12px] text-red-700"
                      >
                        {message}
                      </li>
                    );
                  },
                )}
              </ul>
            </section>
          )}

          {/* Attributes */}
          <section className="space-y-3">
            <header className="flex items-center justify-between">
              <span className={sectionHeaderClass}>Attributes</span>
              {attributesAsJson && (
                <CopyTextButton
                  textToBeCopied={attributesAsJson}
                  size="xs"
                  variant="ghost"
                  iconOnly={false}
                  title="Copy attributes as JSON"
                />
              )}
            </header>

            {detailLoading && attributeEntries.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                Loading attributes…
              </div>
            ) : attributeEntries.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
                No attributes on this span.
              </div>
            ) : (
              <div
                className={`max-h-80 overflow-auto rounded-lg border ${surfaceCardClass}`}
              >
                <ul className="divide-y divide-gray-200">
                  {attributeEntries.map(
                    (entry: AttributeEntry): ReactElement => {
                      return (
                        <li
                          key={entry.key}
                          className="group flex items-start gap-3 px-3 py-2 hover:bg-white"
                        >
                          <span
                            className="w-56 flex-none truncate font-mono text-[12px] text-gray-500"
                            title={entry.key}
                          >
                            {entry.key}
                          </span>
                          <span
                            className="min-w-0 flex-1 break-all font-mono text-[12px] text-gray-800"
                            title={entry.value}
                          >
                            {entry.value || (
                              <span className="italic text-gray-400">
                                empty
                              </span>
                            )}
                          </span>
                          <div className="flex flex-none items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            {props.onFilterByAttribute && entry.value && (
                              <button
                                type="button"
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                                title={`Filter by ${entry.key}: ${entry.value}`}
                                onClick={() => {
                                  props.onFilterByAttribute!(
                                    entry.key,
                                    entry.value,
                                  );
                                }}
                              >
                                <Icon
                                  icon={IconProp.Filter}
                                  className="h-3.5 w-3.5"
                                />
                              </button>
                            )}
                            <CopyTextButton
                              textToBeCopied={entry.value}
                              size="xs"
                              variant="ghost"
                              iconOnly={true}
                              title={`Copy ${entry.key}`}
                            />
                          </div>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SpanDetailsPanel;
