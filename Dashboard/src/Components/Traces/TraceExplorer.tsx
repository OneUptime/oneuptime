import DashboardLogsViewer from "../Logs/LogsViewer";
import SpanStatusElement from "../Span/SpanStatusElement";
import SpanViewer from "../Span/SpanViewer";
import TelemetryServiceElement from "..//TelemetryService/TelemetryServiceElement";
import ProjectUtil from "Common/UI/Utils/Project";
import SpanUtil, {
  DivisibilityFactor,
  IntervalUnit,
} from "../../Utils/SpanUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { GanttChartBar } from "Common/UI/Components/GanttChart/Bar/Index";
import GanttChart, {
  GanttChartProps,
} from "Common/UI/Components/GanttChart/Index";
import { GanttChartRow } from "Common/UI/Components/GanttChart/Row/Row";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  traceId: string;
}

type BarTooltipFunctionProps = {
  span: Span;
  timelineStartTimeUnixNano: number;
  divisibilityFactor: DivisibilityFactor;
};

type GetBarTooltipFunction = (data: BarTooltipFunctionProps) => ReactElement;

const TraceExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [telemetryServices, setTelemetryServices] = React.useState<
    TelemetryService[]
  >([]);

  const [selectedSpans, setSelectedSpans] = React.useState<string[]>([]);

  const traceIdFromUrl: string = props.traceId;

  const [error, setError] = React.useState<string | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [spans, setSpans] = React.useState<Span[]>([]);

  // UI State Enhancements
  const [showErrorsOnly, setShowErrorsOnly] = React.useState<boolean>(false);

  const [traceId, setTraceId] = React.useState<string | null>(null);

  const [ganttChart, setGanttChart] = React.useState<GanttChartProps | null>(
    null,
  );

  const [divisibilityFactor, setDivisibilityFactor] =
    React.useState<DivisibilityFactor>({
      divisibilityFactorNumber: 1000,
      intervalUnit: IntervalUnit.Milliseconds,
    });

  // Service Filter State
  const [selectedServiceIds, setSelectedServiceIds] = React.useState<string[]>(
    [],
  );

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      // get trace with this id and then get all the parentSpanId with this traceid.

      const telemetryServices: ListResult<TelemetryService> =
        await ModelAPI.getList<TelemetryService>({
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          modelType: TelemetryService,
          sort: {
            name: SortOrder.Ascending,
          },
          select: {
            name: true,
            _id: true,
            serviceColor: true,
          },
        });

      setTelemetryServices(telemetryServices.data);

      const select: Select<Span> = {
        startTime: true,
        endTime: true,
        startTimeUnixNano: true,
        endTimeUnixNano: true,
        name: true,
        traceId: true,
        parentSpanId: true,
        spanId: true,
        kind: true,
        serviceId: true,
        durationUnixNano: true,
        statusCode: true,
      };

      // now get all the spans with the traceId

      const traceId: string = traceIdFromUrl;

      setTraceId(traceId);

      const allSpans: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        select: select,
        query: {
          traceId: traceId,
        },
        sort: {
          startTimeUnixNano: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      const spans: Span[] = [...allSpans.data];

      setSpans(spans);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  const getBarTooltip: GetBarTooltipFunction = (
    data: BarTooltipFunctionProps,
  ): ReactElement => {
    const { span, timelineStartTimeUnixNano, divisibilityFactor } = data;

    return (
      <div className="px-3 py-2 min-w-60 cursor-default rounded-md border border-gray-200 bg-white/90 backdrop-blur-sm shadow-lg">
        <div className="bar-tooltip-title text-sm text-gray-800 font-semibold mb-3 leading-snug">
          {span.name}
        </div>
        <div className="bar-tooltip-description text-gray-600 text-[11px] space-y-2">
          <div className="flex justify-between">
            <div className="font-medium text-gray-700">Span ID</div>
            <div className="ml-2 font-mono text-gray-800 truncate max-w-40">
              {span.spanId?.toString()}
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="font-medium text-gray-700">Status</div>
            <div className="ml-2">
              <SpanStatusElement
                spanStatusCode={span.statusCode!}
                traceId={span.traceId?.toString()}
                title={
                  "Status: " +
                  SpanUtil.getSpanStatusCodeFriendlyName(span.statusCode!)
                }
                titleClassName="mt-0.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <div className="font-medium text-gray-700">Seen</div>
              <div className="text-gray-800">
                {OneUptimeDate.getDateAsUserFriendlyFormattedString(
                  span.startTime!,
                )}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-700">Kind</div>
              <div className="text-gray-800">
                {SpanUtil.getSpanKindFriendlyName(span.kind!)}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-700">Start</div>
              <div className="text-gray-800">
                {SpanUtil.getSpanStartsAtAsString({
                  timelineStartTimeUnixNano,
                  divisibilityFactor: divisibilityFactor,
                  spanStartTimeUnixNano: span.startTimeUnixNano!,
                })}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-700">End</div>
              <div className="text-gray-800">
                {SpanUtil.getSpanEndsAtAsString({
                  timelineStartTimeUnixNano,
                  divisibilityFactor: divisibilityFactor,
                  spanEndTimeUnixNano: span.endTimeUnixNano!,
                })}
              </div>
            </div>
            <div className="col-span-2">
              <div className="font-medium text-gray-700">Duration</div>
              <div className="text-gray-800">
                {SpanUtil.getSpanDurationAsString({
                  spanDurationInUnixNano: span.durationUnixNano!,
                  divisibilityFactor: divisibilityFactor,
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  type SpanToBarFunctionProps = {
    span: Span;
    timelineStartTimeUnixNano: number;
    divisibilityFactor: DivisibilityFactor;
  };

  type SpanToBarFunction = (data: SpanToBarFunctionProps) => GanttChartBar;

  const spanToBar: SpanToBarFunction = (
    data: SpanToBarFunctionProps,
  ): GanttChartBar => {
    const { span, timelineStartTimeUnixNano, divisibilityFactor } = data;

    const spanColor: {
      barColor: Color;
    } = SpanUtil.getGanttChartBarColor({
      span: span,
      telemetryServices: telemetryServices,
    });

    return {
      id: span.spanId!,
      label:
        span.statusCode === SpanStatus.Error ? (
          <div className="mt-0.5">
            <SpanStatusElement
              spanStatusCode={span.statusCode!}
              traceId={span.traceId?.toString()}
              title={
                "Status: " +
                SpanUtil.getSpanStatusCodeFriendlyName(span.statusCode!)
              }
            />
          </div>
        ) : (
          <></>
        ),
      barColor: spanColor.barColor,
      barTimelineStart:
        (span.startTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
      barTimelineEnd:
        (span.endTimeUnixNano! - timelineStartTimeUnixNano) /
        divisibilityFactor.divisibilityFactorNumber,
      rowId: span.spanId!,
      tooltip: getBarTooltip({
        span,
        timelineStartTimeUnixNano,
        divisibilityFactor: divisibilityFactor,
      }),
    };
  };

  type GetBarsFunctionProps = {
    rootSpan: Span;
    allSpans: Span[];
    timelineStartTimeUnixNano: number;
    divisibilityFactor: DivisibilityFactor;
  };

  type GetRowDescriptionFunction = (data: {
    telemetryService: TelemetryService;
    span: Span;
  }) => ReactElement;

  const getRowDescription: GetRowDescriptionFunction = (data: {
    telemetryService: TelemetryService;
    span: Span;
  }): ReactElement => {
    const { telemetryService } = data;

    return (
      <div className="flex space-x-5">
        <TelemetryServiceElement
          telemetryService={telemetryService}
          telemetryServiceNameClassName="mt-0.5"
        />
      </div>
    );
  };

  type GetRowsFunction = (data: GetBarsFunctionProps) => Array<GanttChartRow>;

  const getRows: GetRowsFunction = (
    data: GetBarsFunctionProps,
  ): Array<GanttChartRow> => {
    const {
      rootSpan,
      allSpans,
      timelineStartTimeUnixNano,
      divisibilityFactor,
    } = data;

    if (!rootSpan) {
      return [];
    }

    const telemetryService: TelemetryService | undefined =
      telemetryServices.find((service: TelemetryService) => {
        return service._id?.toString() === rootSpan.serviceId?.toString();
      });

    const rootRow: GanttChartRow = {
      rowInfo: {
        title: <div className="truncate">{rootSpan.name!}</div>,
        description: telemetryService ? (
          getRowDescription({
            telemetryService,
            span: rootSpan,
          })
        ) : (
          <></>
        ),
        id: ObjectID.generate().toString(),
      },
      bars: [
        spanToBar({
          span: rootSpan,
          timelineStartTimeUnixNano,
          divisibilityFactor,
        }),
      ],
      childRows: [],
    };

    const currentSpan: Span = rootSpan;

    const currentSpanId: string | undefined = currentSpan.spanId;

    const childSpans: Array<Span> = allSpans.filter((span: Span) => {
      return span.parentSpanId?.toString() === currentSpanId?.toString();
    });

    for (const span of childSpans) {
      const childRows: Array<GanttChartRow> | null = getRows({
        rootSpan: span,
        allSpans,
        timelineStartTimeUnixNano,
        divisibilityFactor,
      });

      for (const row of childRows) {
        rootRow.childRows.push(row);
      }
    }

    return [rootRow];
  };

  React.useEffect(() => {
    fetchItems().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  // Derived values for summary / filtering
  // Services involved in this trace only
  const servicesInTrace: TelemetryService[] = React.useMemo(() => {
    if (spans.length === 0) {
      return [];
    }
    const serviceIdsInTrace: Set<string> = new Set(
      spans
        .filter((s: Span) => {
          return Boolean(s.serviceId);
        })
        .map((s: Span) => {
          return s.serviceId!.toString();
        }),
    );
    return telemetryServices.filter((svc: TelemetryService) => {
      return serviceIdsInTrace.has(svc._id!.toString());
    });
  }, [telemetryServices, spans]);

  // Map serviceId -> { total, error }
  const serviceSpanStats: Record<string, { total: number; error: number }> =
    React.useMemo(() => {
      const stats: Record<string, { total: number; error: number }> = {};
      for (const span of spans) {
        const id: string | undefined = span.serviceId?.toString();
        if (!id) {
          continue;
        }
        const serviceStats: { total: number; error: number } =
          stats[id] ?? (stats[id] = { total: 0, error: 0 });
        serviceStats.total += 1;
        if (span.statusCode === SpanStatus.Error) {
          serviceStats.error += 1;
        }
      }
      return stats;
    }, [spans]);

  // Prune selected services if they disappear (new fetch)
  React.useEffect(() => {
    if (selectedServiceIds.length === 0) {
      return;
    }
    const validIds: Set<string> = new Set(
      servicesInTrace.map((s: TelemetryService) => {
        return s._id!.toString();
      }),
    );
    const stillValid: string[] = selectedServiceIds.filter((id: string) => {
      return validIds.has(id);
    });
    if (stillValid.length !== selectedServiceIds.length) {
      setSelectedServiceIds(stillValid);
    }
  }, [servicesInTrace, selectedServiceIds]);

  // Final spans after applying filters
  const displaySpans: Span[] = React.useMemo(() => {
    let filtered: Span[] = spans;
    if (showErrorsOnly) {
      filtered = filtered.filter((s: Span): boolean => {
        return s.statusCode === SpanStatus.Error;
      });
    }
    if (selectedServiceIds.length > 0) {
      filtered = filtered.filter((s: Span): boolean => {
        return s.serviceId
          ? selectedServiceIds.includes(s.serviceId.toString())
          : false;
      });
    }
    return filtered;
  }, [spans, showErrorsOnly, selectedServiceIds]);

  const spanStats: {
    totalSpans: number;
    errorSpans: number;
    servicesCount: number;
    durationString: string;
  } = React.useMemo(() => {
    if (spans.length === 0) {
      return {
        totalSpans: 0,
        errorSpans: 0,
        servicesCount: 0,
        durationString: "-",
      };
    }

    let minStart: number = spans[0]!.startTimeUnixNano!;
    let maxEnd: number = spans[0]!.endTimeUnixNano!;
    let errorCount: number = 0;
    const serviceIds: Set<string> = new Set();

    for (const span of spans) {
      if (span.startTimeUnixNano! < minStart) {
        minStart = span.startTimeUnixNano!;
      }
      if (span.endTimeUnixNano! > maxEnd) {
        maxEnd = span.endTimeUnixNano!;
      }
      if (span.statusCode === SpanStatus.Error) {
        errorCount++;
      }
      if (span.serviceId) {
        serviceIds.add(span.serviceId.toString());
      }
    }

    const durationString: string = SpanUtil.getSpanDurationAsString({
      spanDurationInUnixNano: maxEnd - minStart,
      divisibilityFactor,
    });

    return {
      totalSpans: spans.length,
      errorSpans: errorCount,
      servicesCount: serviceIds.size,
      durationString,
    };
  }, [spans, divisibilityFactor]);

  React.useEffect(() => {
    // convert spans to gantt chart

    if (displaySpans.length === 0) {
      setGanttChart(null);
      return;
    }

    let timelineStartTimeUnixNano: number = displaySpans[0]!.startTimeUnixNano!;
    let timelineEndTimeUnixNano: number =
      displaySpans[displaySpans.length - 1]!.endTimeUnixNano!;

    for (const span of displaySpans) {
      if (span.startTimeUnixNano! < timelineStartTimeUnixNano) {
        timelineStartTimeUnixNano = span.startTimeUnixNano!;
      }
      if (span.endTimeUnixNano! > timelineEndTimeUnixNano) {
        timelineEndTimeUnixNano = span.endTimeUnixNano!;
      }
    }

    const startTimeline: number = 0;

    const newDivisibilityFactor: DivisibilityFactor =
      SpanUtil.getDivisibilityFactor(
        timelineEndTimeUnixNano - timelineStartTimeUnixNano,
      );

    setDivisibilityFactor(newDivisibilityFactor);

    const divisibilityFactorNumber: number =
      newDivisibilityFactor.divisibilityFactorNumber;

    const endTimeline: number =
      (timelineEndTimeUnixNano - timelineStartTimeUnixNano) /
      divisibilityFactorNumber;

    const intervalTemp: number = Math.round(endTimeline / 100) * 10;
    const numberOfDigitsInIntervalTemp: number = intervalTemp.toString().length;
    const interval: number = Math.pow(10, numberOfDigitsInIntervalTemp);

    // Improved root span detection:
    // 1. Root if parentSpanId is null/undefined/empty string.
    // 2. Root if parentSpanId does not exist among spanIds (orphan) – common when trace is truncated.
    const allSpanIds: Set<string> = new Set(
      displaySpans
        .map((s: Span) => {
          return s.spanId?.toString();
        })
        .filter((id: string | undefined): id is string => {
          return Boolean(id);
        }),
    );

    const rootSpans: Span[] = displaySpans.filter((span: Span) => {
      const p: string | undefined = span.parentSpanId?.toString();
      if (!p || p.trim() === "") {
        return true; // explicit root
      }
      if (!allSpanIds.has(p)) {
        return true; // orphan -> treat as root
      }
      return false;
    });

    // If still no roots (edge case), just treat first as root to avoid empty array.
    const effectiveRootSpans: Span[] =
      rootSpans.length > 0 ? rootSpans : [displaySpans[0]!];

    let allRows: GanttChartRow[] = effectiveRootSpans.flatMap(
      (rootSpan: Span) => {
        return getRows({
          rootSpan,
          allSpans: displaySpans,
          timelineStartTimeUnixNano,
          divisibilityFactor: newDivisibilityFactor,
        });
      },
    );

    // Fallback: If after building hierarchy we only have 1 row but many spans, the
    // hierarchy likely failed (e.g., every span references a missing parent in a chain)
    // or produced an unhelpful single path. Display a flat list so user can still see all.
    if (allRows.length === 1 && displaySpans.length > 10) {
      allRows = displaySpans.map((span: Span) => {
        const telemetryService: TelemetryService | undefined =
          telemetryServices.find((service: TelemetryService) => {
            return service._id?.toString() === span.serviceId?.toString();
          });
        return {
          rowInfo: {
            id: ObjectID.generate().toString(),
            title: <div className="truncate">{span.name || span.spanId}</div>,
            description: telemetryService ? (
              getRowDescription({ telemetryService, span })
            ) : (
              <></>
            ),
          },
          bars: [
            spanToBar({
              span,
              timelineStartTimeUnixNano,
              divisibilityFactor: newDivisibilityFactor,
            }),
          ],
          childRows: [],
        } as GanttChartRow;
      });
    }

    const ganttChart: GanttChartProps = {
      id: "chart",
      selectedBarIds: selectedSpans,
      rows: allRows,
      onBarSelectChange(barIds: Array<string>) {
        setSelectedSpans(barIds);
      },
      timeline: {
        start: startTimeline,
        end: Math.ceil(endTimeline / interval) * interval,
        interval: interval,
        intervalUnit: newDivisibilityFactor.intervalUnit,
      },
    };

    setGanttChart(ganttChart);
  }, [displaySpans, selectedSpans]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const serviceLegend: ReactElement = (
    <div className="flex flex-wrap gap-2">
      {servicesInTrace.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            return setSelectedServiceIds([]);
          }}
          className={`group relative flex items-center space-x-1 rounded-md border text-[11px] font-medium px-2 py-1 transition-all backdrop-blur ${
            selectedServiceIds.length === 0
              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
              : "bg-white/60 text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-white"
          }`}
        >
          <span>All</span>
          {selectedServiceIds.length > 0 ? (
            <span className="inline-block rounded bg-black/10 px-1 text-[10px] font-semibold">
              {servicesInTrace.length}
            </span>
          ) : (
            <></>
          )}
        </button>
      ) : (
        <></>
      )}
      {servicesInTrace.map((service: TelemetryService) => {
        const id: string = service._id!.toString();
        const isSelected: boolean = selectedServiceIds.includes(id);
        const counts: { total: number; error: number } | undefined =
          serviceSpanStats[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setSelectedServiceIds((prev: string[]): string[] => {
                if (prev.includes(id)) {
                  return prev.filter((p: string) => {
                    return p !== id;
                  });
                }
                return [...prev, id];
              });
            }}
            title={
              service.name +
              (counts
                ? ` – ${counts.total} span${counts.total !== 1 ? "s" : ""}`
                : "")
            }
            className={`group relative flex items-center space-x-2 rounded-md border px-2 py-1 text-[11px] font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 ${
              isSelected
                ? "bg-indigo-50 border-indigo-400 text-indigo-700 shadow-sm"
                : "bg-white/60 border-gray-200 text-gray-700 hover:bg-white hover:border-gray-300"
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10"
              style={{
                backgroundColor: String(
                  (service.serviceColor as unknown as string) || "#6366f1",
                ),
              }}
            />
            <span className="truncate max-w-28">{service.name}</span>
            {counts ? (
              <span className="flex items-center space-x-1 text-[10px] font-semibold">
                <span
                  className={`px-1 rounded ${
                    counts.error > 0
                      ? "bg-red-100 text-red-600"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {counts.total}
                </span>
                {counts.error > 0 ? (
                  <span className="px-1 rounded bg-rose-500/20 text-rose-600">
                    {counts.error}
                  </span>
                ) : (
                  <></>
                )}
              </span>
            ) : (
              <></>
            )}
            {isSelected ? (
              <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[9px] shadow ring-1 ring-white">
                ✓
              </span>
            ) : (
              <></>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <Fragment>
      <div className="mb-8 space-y-6">
        <Card
          title={"Trace Explorer"}
          description={
            traceId ? (
              <div className="inline-flex items-center flex-wrap gap-2">
                <span className="font-medium text-gray-600">Trace ID:</span>
                <code className="text-xs font-mono px-2 py-1 rounded bg-gray-100 text-gray-800 border border-gray-200">
                  {traceId}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(traceId)
                      .then(() => {
                        // Optional: could add a toast mechanism if available.
                      })
                      .catch(() => {
                        // Silently fail; could add error toast.
                      });
                  }}
                  className="group relative inline-flex items-center space-x-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 shadow-sm transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
                  aria-label="Copy trace id"
                >
                  <span className="inline-block h-3 w-3 text-gray-500 group-hover:text-gray-700">
                    📋
                  </span>
                  <span>Copy</span>
                </button>
              </div>
            ) : (
              "Traces for the request operation."
            )
          }
          buttons={[
            {
              ...getRefreshButton(),
              className: "py-0 pr-0 pl-1 mt-1",
              onClick: async () => {
                await fetchItems();
              },
              disabled: isLoading,
            },
          ]}
        >
          {/* Summary Stats */}
          <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                Spans
              </div>
              <div className="mt-1 text-lg font-semibold text-gray-800">
                {spanStats.totalSpans}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                Errors
              </div>
              <div className="mt-1 text-lg font-semibold text-red-600 flex items-center space-x-1">
                <span>{spanStats.errorSpans}</span>
                {spanStats.errorSpans > 0 ? (
                  <span className="text-[10px] font-medium bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                    {(
                      (spanStats.errorSpans / (spanStats.totalSpans || 1)) *
                      100
                    ).toFixed(0)}
                    %
                  </span>
                ) : (
                  <></>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                Services
              </div>
              <div className="mt-1 text-lg font-semibold text-gray-800">
                {spanStats.servicesCount}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                Duration
              </div>
              <div className="mt-1 text-lg font-semibold text-gray-800">
                {spanStats.durationString}
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => {
                  return setShowErrorsOnly(false);
                }}
                className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-all ${
                  !showErrorsOnly
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                }`}
              >
                All Spans
              </button>
              <button
                type="button"
                onClick={() => {
                  return setShowErrorsOnly(true);
                }}
                className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-all flex items-center space-x-1 ${
                  showErrorsOnly
                    ? "bg-red-600 text-white border-red-600 shadow-sm"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                }`}
              >
                <span>Errors Only</span>
                {spanStats.errorSpans > 0 ? (
                  <span className="text-[10px] bg-white/20 rounded px-1">
                    {spanStats.errorSpans}
                  </span>
                ) : (
                  <></>
                )}
              </button>
            </div>

            <div className="flex items-center space-x-3 text-xs text-gray-500">
              <div className="flex items-center space-x-1">
                <div className="h-2 w-2 rounded-full bg-rose-500" />
                <span>Error</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>OK</span>
              </div>
              <div className="flex items-center space-x-1">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span>Other</span>
              </div>
            </div>
          </div>

          {/* Service Legend */}
          {servicesInTrace.length > 0 ? (
            <div className="mb-4 border border-gray-100 rounded-lg p-3 bg-gradient-to-br from-gray-50/60 to-white">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                  Services
                </div>
                {selectedServiceIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      return setSelectedServiceIds([]);
                    }}
                    className="text-[10px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    Clear Filters
                  </button>
                ) : (
                  <></>
                )}
              </div>
              {serviceLegend}
              {selectedServiceIds.length > 0 ? (
                <div className="mt-3 text-[11px] text-gray-500 flex items-center space-x-2">
                  <span>
                    {selectedServiceIds.length} filter
                    {selectedServiceIds.length > 1 ? "s" : ""} active
                  </span>
                  <span className="inline-block h-1 w-1 rounded-full bg-gray-300" />
                  <span>
                    {displaySpans.length} span
                    {displaySpans.length !== 1 ? "s" : ""} shown
                  </span>
                </div>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            {ganttChart ? (
              <GanttChart chart={ganttChart} />
            ) : (
              <div className="p-8">
                <ErrorMessage message={"No spans found"} />
              </div>
            )}
          </div>
        </Card>

        {traceId ? (
          <div className="mt-2 md:mt-5">
            <DashboardLogsViewer
              id={"traces-logs-viewer"}
              noLogsMessage="No logs found for this trace."
              traceIds={[traceId]}
              limit={LIMIT_PER_PROJECT}
              enableRealtime={false}
            />
          </div>
        ) : (
          <></>
        )}

        {selectedSpans.length > 0 ? (
          <SideOver
            title="View Span"
            description="View the span details."
            onClose={() => {
              setSelectedSpans([]);
            }}
            size={SideOverSize.Large}
          >
            <SpanViewer
              id={"span-viewer"}
              openTelemetrySpanId={selectedSpans[0] as string}
              traceStartTimeInUnixNano={spans[0]!.startTimeUnixNano!}
              onClose={() => {
                setSelectedSpans([]);
              }}
              telemetryService={
                telemetryServices.find((service: TelemetryService) => {
                  const selectedSpan: Span | undefined = spans.find(
                    (span: Span) => {
                      return span.spanId?.toString() === selectedSpans[0]!;
                    },
                  );

                  if (!selectedSpan) {
                    throw new BadDataException("Selected span not found");
                  }

                  return (
                    service._id?.toString() ===
                    selectedSpan.serviceId?.toString()
                  );
                })!
              }
              divisibilityFactor={divisibilityFactor}
            />
          </SideOver>
        ) : (
          <></>
        )}
      </div>
    </Fragment>
  );
};

export default TraceExplorer;
