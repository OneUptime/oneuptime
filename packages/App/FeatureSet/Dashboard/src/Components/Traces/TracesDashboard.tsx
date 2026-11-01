import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil, {
  UNKNOWN_RESOURCE_LABEL,
  UNKNOWN_SERVICE_NAME,
} from "Common/UI/Utils/TelemetryService";
import {
  TranslatableTerm,
  Translator,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { CARD_ROW_COLUMN_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceElement from "../Service/ServiceElement";
import SpanStatusElement from "../Span/SpanStatusElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Includes from "Common/Types/BaseDatabase/Includes";
import Navigation from "Common/UI/Utils/Navigation";
import Query from "Common/Types/BaseDatabase/Query";
import TraceSavedView from "Common/Models/DatabaseModels/TraceSavedView";
import HintChip from "../Metrics/HintChip";
import {
  ServiceScopedInsightsUrlScope,
  TelemetryFilterTuple,
  buildServiceScopedInsightsUrlParams,
  describeUnappliedScopeFilters,
  readServiceScopedInsightsUrlScope,
  toPresentParams,
  withTelemetryTabScopeParams,
} from "../../Utils/TelemetryTabScope";
import { TraceSpanType } from "Common/Types/Telemetry/TraceSpanType";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
import { getTraceEntityOptionLabel } from "./TracesEntityDisplay";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import {
  TraceInsightsSpanInput,
  TraceInsightsTrace,
  TraceInsightsTraces,
  getSlowestTraces,
  summarizeRecentTraces,
} from "../../Utils/TraceInsightsTraces";
import { ERROR_COUNT } from "../../Utils/TraceDetailPresentation";

interface ServiceTraceSummary {
  service: Service;
  totalTraces: number;
  errorTraces: number;
  latestTraceTime: Date | null;
  p50Nanos: number;
  p95Nanos: number;
  durations: Array<number>;
}

type RecentTrace = TraceInsightsTrace;

// A number as the reader's language writes it, to `digits` decimal places.
const formatFixed: (
  value: number,
  digits: number,
  translator: Translator,
) => string = (
  value: number,
  digits: number,
  translator: Translator,
): string => {
  return value.toLocaleString(translator.language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
};

const formatDuration: (nanos: number, translator: Translator) => string = (
  nanos: number,
  translator: Translator,
): string => {
  if (nanos >= 1_000_000_000) {
    return `${formatFixed(nanos / 1_000_000_000, 2, translator)}s`;
  }
  if (nanos >= 1_000_000) {
    return `${formatFixed(nanos / 1_000_000, 1, translator)}ms`;
  }
  if (nanos >= 1_000) {
    return `${formatFixed(nanos / 1_000, 0, translator)}us`;
  }
  return `${formatFixed(nanos, 0, translator)}ns`;
};

const getPercentile: (arr: Array<number>, p: number) => number = (
  arr: Array<number>,
  p: number,
): number => {
  if (arr.length === 0) {
    return 0;
  }
  const sorted: Array<number> = [...arr].sort((a: number, b: number) => {
    return a - b;
  });
  const idx: number = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] || 0;
};

const TracesDashboard: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The services' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a service's name gives way to 10rem, a count, a
   * rate or a duration never.
   */
  const serviceColumns: ResizableColumns = useResizableColumns({
    tableKey: "traces-dashboard-services-table",
    columns: [
      { id: "service", cellNumber: 1 },
      { id: "requests", cellNumber: 2 },
      { id: "errorRate", cellNumber: 3 },
      { id: "p50", cellNumber: 4 },
      { id: "p95", cellNumber: 5 },
      { id: "status", cellNumber: 6 },
    ],
  });
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceTraceSummary>
  >([]);
  const [recentErrorTraces, setRecentErrorTraces] = useState<
    Array<RecentTrace>
  >([]);
  const [recentSlowTraces, setRecentSlowTraces] = useState<Array<RecentTrace>>(
    [],
  );
  const [services, setServices] = useState<Array<Service>>([]);
  const [totalRequests, setTotalRequests] = useState<number>(0);
  const [totalErrors, setTotalErrors] = useState<number>(0);
  const [globalP50, setGlobalP50] = useState<number>(0);
  const [globalP95, setGlobalP95] = useState<number>(0);
  const [globalP99, setGlobalP99] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * Generation token for the in-flight batch. Both the scope picker and the
   * time picker commit immediately — no apply step, no debounce — and the
   * loading state still renders both, so two quick changes leave two capped
   * 5000-span fetches racing. Without this the batch that RESOLVES last
   * wins rather than the one the user asked for last, and 30-day percentiles
   * paint under a "past one hour" label and stay there. Same guard the Logs
   * Insights page has carried since it was written.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const [error, setError] = useState<string>("");

  /*
   * The slice the Viewer tab handed over, read once on mount. Without this
   * the Insights tab silently widened back out to the whole project every
   * time the user switched lens on a scoped view.
   */
  const [initialUrlScope] = useState<ServiceScopedInsightsUrlScope>(() => {
    return readServiceScopedInsightsUrlScope(Navigation.getQueryString());
  });

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return initialUrlScope.timeRange || { range: TimeRange.PAST_ONE_DAY };
  });
  const [selectedServiceIds, setSelectedServiceIds] = useState<Array<string>>(
    initialUrlScope.serviceIds,
  );
  /*
   * Viewer chips with no counterpart here — a span-name search, an attribute
   * filter, a host selection. Carried so the trip back does not drop them,
   * and announced so the numbers on this page are not mistaken for having
   * honoured them.
   */
  const [unappliedFilters] = useState<Array<TelemetryFilterTuple>>(
    initialUrlScope.unappliedFilters,
  );
  const [savedViewId, setSavedViewId] = useState<string | null>(
    initialUrlScope.savedViewId,
  );
  const [savedViewName, setSavedViewName] = useState<string>("");
  /*
   * The Viewer's own search text and root-spans-only toggle. Both are real
   * predicates — search compiles through the traces grammar, rootOnly drives
   * isRootSpan — and this page can apply neither, so they are carried and
   * announced exactly like an unapplicable chip. Not carrying them silently
   * widened the slice on the way here and destroyed the user's search on the
   * way back.
   */
  const [carriedSearch] = useState<string | null>(initialUrlScope.search);
  const [carriedRootOnly] = useState<boolean | null>(initialUrlScope.rootOnly);
  /*
   * The Viewer's Span Type (entry / root / all spans), carried the same way:
   * this page counts every span, whichever the Viewer lists.
   */
  const [carriedSpanType] = useState<TraceSpanType | null>(
    initialUrlScope.spanType,
  );

  const loadDashboard: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const generation: number = ++loadGenerationRef.current;

      try {
        setIsLoading(true);
        setError("");

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
        const startDate: Date = dateRange.startValue;
        const endDate: Date = dateRange.endValue;

        const [servicesResult, spansResult] = await Promise.all([
          ModelAPI.getList({
            modelType: Service,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            select: {
              serviceColor: true,
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              name: SortOrder.Ascending,
            },
          }),
          AnalyticsModelAPI.getList({
            modelType: Span,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              startTime: new InBetween(startDate, endDate),
              /*
               * The service scope carried from the Viewer tab. Applied to
               * the span fetch rather than filtered client-side: the fetch
               * is capped, so filtering after it would leave the numbers
               * describing whichever 5000 spans came back rather than the
               * services the user selected.
               */
              ...(selectedServiceIds.length > 0
                ? { primaryEntityId: new Includes(selectedServiceIds) }
                : {}),
            } as Query<Span>,
            select: {
              traceId: true,
              spanId: true,
              parentSpanId: true,
              primaryEntityId: true,
              name: true,
              startTime: true,
              statusCode: true,
              durationUnixNano: true,
            },
            limit: 5000,
            skip: 0,
            sort: {
              startTime: SortOrder.Descending,
            },
          }),
        ]);

        const allSpans: Array<Span> = spansResult.data || [];

        /*
         * Telemetry without a service.name is tagged with the projectId
         * (ServiceType.Unknown) and has no Service row. Surface it under
         * a synthetic "Unknown Service" so it still shows in the service
         * health table — but only when some span actually references it.
         */
        const referencedServiceIds: Set<string> = new Set(
          allSpans
            .map((span: Span) => {
              return span.primaryEntityId?.toString() || "";
            })
            .filter((id: string) => {
              return Boolean(id);
            }),
        );
        const loadedServices: Array<Service> =
          TelemetryServiceUtil.withUnknownServiceIfReferenced({
            services: servicesResult.data || [],
            referencedServiceIds,
            projectId: ProjectUtil.getCurrentProjectId()!,
          });
        // A batch the user has already moved on from must not commit.
        if (loadGenerationRef.current !== generation) {
          return;
        }

        setServices(loadedServices);

        // Build per-service summaries
        const summaryMap: Map<string, ServiceTraceSummary> = new Map();

        for (const service of loadedServices) {
          const primaryEntityId: string = service.id?.toString() || "";
          summaryMap.set(primaryEntityId, {
            service,
            totalTraces: 0,
            errorTraces: 0,
            latestTraceTime: null,
            p50Nanos: 0,
            p95Nanos: 0,
            durations: [],
          });
        }

        const serviceTraceIds: Map<string, Set<string>> = new Map();
        const serviceErrorTraceIds: Map<string, Set<string>> = new Map();
        const allDurations: Array<number> = [];
        const sampledSpans: Array<TraceInsightsSpanInput> = [];

        for (const span of allSpans) {
          const primaryEntityId: string =
            span.primaryEntityId?.toString() || "";
          const traceId: string = span.traceId?.toString() || "";
          const duration: number = (span.durationUnixNano as number) || 0;
          const summary: ServiceTraceSummary | undefined =
            summaryMap.get(primaryEntityId);

          if (duration > 0) {
            allDurations.push(duration);
          }

          if (summary) {
            if (!serviceTraceIds.has(primaryEntityId)) {
              serviceTraceIds.set(primaryEntityId, new Set());
            }
            if (!serviceErrorTraceIds.has(primaryEntityId)) {
              serviceErrorTraceIds.set(primaryEntityId, new Set());
            }

            const traceSet: Set<string> = serviceTraceIds.get(primaryEntityId)!;
            if (!traceSet.has(traceId)) {
              traceSet.add(traceId);
              summary.totalTraces += 1;
            }

            if (duration > 0) {
              summary.durations.push(duration);
            }

            if (span.statusCode === SpanStatus.Error) {
              const errorSet: Set<string> =
                serviceErrorTraceIds.get(primaryEntityId)!;
              if (!errorSet.has(traceId)) {
                errorSet.add(traceId);
                summary.errorTraces += 1;
              }
            }

            const spanTime: Date | undefined = span.startTime
              ? OneUptimeDate.fromString(span.startTime)
              : undefined;
            if (
              spanTime &&
              (!summary.latestTraceTime || spanTime > summary.latestTraceTime)
            ) {
              summary.latestTraceTime = spanTime;
            }
          }

          sampledSpans.push({
            traceId,
            spanId: span.spanId?.toString() || "",
            parentSpanId: span.parentSpanId?.toString() || "",
            name: span.name?.toString() || "",
            primaryEntityId,
            startTime: span.startTime
              ? OneUptimeDate.fromString(span.startTime)
              : undefined,
            durationNano: duration,
            statusCode: span.statusCode || SpanStatus.Unset,
          });
        }

        /*
         * Name and time each trace by its root span, not by whichever of its
         * spans is newest in the sample — see TraceInsightsTraces.
         */
        const recentTraces: TraceInsightsTraces =
          summarizeRecentTraces(sampledSpans);
        const allTraces: Array<RecentTrace> = recentTraces.allTraces;
        const errorTraces: Array<RecentTrace> = recentTraces.errorTraces;

        // Compute global percentiles
        setGlobalP50(getPercentile(allDurations, 50));
        setGlobalP95(getPercentile(allDurations, 95));
        setGlobalP99(getPercentile(allDurations, 99));

        // Compute per-service percentiles and filter
        const summariesWithData: Array<ServiceTraceSummary> = Array.from(
          summaryMap.values(),
        )
          .filter((s: ServiceTraceSummary) => {
            return s.totalTraces > 0;
          })
          .map((s: ServiceTraceSummary) => {
            return {
              ...s,
              p50Nanos: getPercentile(s.durations, 50),
              p95Nanos: getPercentile(s.durations, 95),
            };
          });

        // Sort: highest error rate first, then by total traces
        summariesWithData.sort(
          (a: ServiceTraceSummary, b: ServiceTraceSummary) => {
            const aErrorRate: number =
              a.totalTraces > 0 ? a.errorTraces / a.totalTraces : 0;
            const bErrorRate: number =
              b.totalTraces > 0 ? b.errorTraces / b.totalTraces : 0;
            if (bErrorRate !== aErrorRate) {
              return bErrorRate - aErrorRate;
            }
            return b.totalTraces - a.totalTraces;
          },
        );

        let totalReqs: number = 0;
        let totalErrs: number = 0;
        for (const s of summariesWithData) {
          totalReqs += s.totalTraces;
          totalErrs += s.errorTraces;
        }
        setTotalRequests(totalReqs);
        setTotalErrors(totalErrs);

        setServiceSummaries(summariesWithData);
        setRecentErrorTraces(errorTraces.slice(0, 8));

        setRecentSlowTraces(getSlowestTraces(allTraces, 8));
      } catch (err) {
        if (loadGenerationRef.current !== generation) {
          return;
        }

        setError(API.getFriendlyErrorMessage(err as Error));
      } finally {
        if (loadGenerationRef.current === generation) {
          setIsLoading(false);
        }
      }
    }, [timeRange, selectedServiceIds]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  /*
   * Mirror this page's scope into the URL, in the Traces Viewer's own
   * grammar — so the tab link back needs no translation, and a refresh or a
   * shared link restores what the user was looking at.
   */
  useEffect(() => {
    writeTelemetryViewerUrlState(
      buildServiceScopedInsightsUrlParams({
        timeRange,
        serviceIds: selectedServiceIds,
        unappliedFilters,
        savedViewId,
        grammar: "pairs",
        search: carriedSearch,
        rootOnly: carriedRootOnly,
        spanType: carriedSpanType,
      }),
    );
  }, [
    timeRange,
    selectedServiceIds,
    unappliedFilters,
    savedViewId,
    carriedSearch,
    carriedRootOnly,
    carriedSpanType,
  ]);

  /*
   * The name behind the carried saved-view id, so the page can say where its
   * scope came from. Best-effort: a deleted view drops the reference rather
   * than surfacing an error, since the scope itself arrived in the URL and
   * is still usable.
   */
  useEffect(() => {
    if (!savedViewId) {
      setSavedViewName("");
      return;
    }

    let isCancelled: boolean = false;

    ModelAPI.getItem({
      modelType: TraceSavedView,
      id: new ObjectID(savedViewId),
      select: { name: true },
    })
      .then((savedView: TraceSavedView | null): void => {
        if (isCancelled) {
          return;
        }

        const name: string = savedView?.name?.toString() || "";

        if (name) {
          setSavedViewName(name);
          return;
        }

        setSavedViewName("");
        setSavedViewId(null);
      })
      .catch((): void => {
        if (isCancelled) {
          return;
        }

        setSavedViewName("");
        setSavedViewId(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [savedViewId]);

  /*
   * Built from the same state the URL write above is, not by reading the
   * query string: that write happens in an effect, so during this render the
   * URL is still one change behind.
   */
  const viewerRoute: Route = useMemo(() => {
    return withTelemetryTabScopeParams(
      RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
      toPresentParams(
        buildServiceScopedInsightsUrlParams({
          timeRange,
          serviceIds: selectedServiceIds,
          unappliedFilters,
          savedViewId,
          grammar: "pairs",
          search: carriedSearch,
          rootOnly: carriedRootOnly,
          spanType: carriedSpanType,
        }),
      ),
    );
  }, [
    timeRange,
    selectedServiceIds,
    unappliedFilters,
    savedViewId,
    carriedSearch,
    carriedRootOnly,
    carriedSpanType,
  ]);

  const unappliedFiltersHint: string = useMemo(() => {
    return describeUnappliedScopeFilters(
      unappliedFilters,
      {
        search: carriedSearch,
        rootOnly: carriedRootOnly,
        spanType: carriedSpanType,
      },
      translator,
    );
  }, [
    unappliedFilters,
    carriedSearch,
    carriedRootOnly,
    carriedSpanType,
    translator.language,
  ]);

  const serviceOptions: Array<DropdownOption> = useMemo(() => {
    return services.map((service: Service): DropdownOption => {
      return {
        value: service.id?.toString() || "",
        label: TelemetryServiceUtil.getServiceDisplayName(
          service.name?.toString() || UNKNOWN_SERVICE_NAME,
          translator,
        ) as string,
        // What a person's telemetry calls a service stays as written.
        isUserContent: true,
      };
    });
  }, [services, translator.language]);

  /*
   * Entity ids on this page the Service list does not name: a carried scope
   * id (a RUM application or host id handed over from its own traces tab, or
   * a service not in the list yet) and the entity behind a recent trace row.
   * Resolved so the scope pill and the rows read as names, not UUIDs.
   */
  const unnamedEntityIds: Array<string> = useMemo(() => {
    const knownIds: Set<string> = new Set<string>(
      services.map((service: Service): string => {
        return service.id?.toString() || "";
      }),
    );

    return Array.from(
      new Set<string>([
        ...selectedServiceIds,
        ...recentErrorTraces.map((trace: RecentTrace): string => {
          return trace.primaryEntityId;
        }),
        ...recentSlowTraces.map((trace: RecentTrace): string => {
          return trace.primaryEntityId;
        }),
      ]),
    ).filter((id: string): boolean => {
      return Boolean(id) && ObjectID.isValidUUID(id) && !knownIds.has(id);
    });
  }, [services, selectedServiceIds, recentErrorTraces, recentSlowTraces]);

  const entityNames: TelemetryEntityNameMap =
    useTelemetryEntityNames(unnamedEntityIds);

  const selectedServiceOptions: Array<DropdownOption> = useMemo(() => {
    return selectedServiceIds.map((serviceId: string): DropdownOption => {
      /*
       * A carried selection has to render even before the service list has
       * loaded — and even for a service that stopped reporting — or the user
       * would have a filter they can see the effect of but not remove. The
       * entity lookup names it meanwhile (and names a non-Service entity at
       * all); the id is the last resort.
       */
      return (
        serviceOptions.find((option: DropdownOption): boolean => {
          return option.value === serviceId;
        }) || {
          value: serviceId,
          label: getTraceEntityOptionLabel({
            id: serviceId,
            entityNames,
          }),
          isUserContent: true,
        }
      );
    });
  }, [selectedServiceIds, serviceOptions, entityNames]);

  /*
   * Editing the scope by hand means it is no longer the saved view's scope,
   * so the provenance chip goes and the id stops travelling.
   */
  const applyServiceSelection: (serviceIds: Array<string>) => void = (
    serviceIds: Array<string>,
  ): void => {
    setSelectedServiceIds(serviceIds);
    setSavedViewId(null);
  };

  const getServiceName: (primaryEntityId: string) => string = (
    primaryEntityId: string,
  ): string => {
    const service: Service | undefined = services.find((s: Service) => {
      return s.id?.toString() === primaryEntityId;
    });
    return getTraceEntityOptionLabel({
      id: primaryEntityId,
      knownLabel: TelemetryServiceUtil.getServiceDisplayName(
        service?.name?.toString(),
        translator,
      ),
      entityNames,
      fallback: translator.translateTerm(UNKNOWN_RESOURCE_LABEL),
    });
  };

  // What a person's telemetry calls a trace stays as written.
  const getTraceName: (trace: RecentTrace) => string = (
    trace: RecentTrace,
  ): string => {
    return trace.isNameless ? translator.translateTerm(trace.name) : trace.name;
  };

  /*
   * The time range in a sentence: the picker's own name for a preset ("the
   * past 1 day"), and each sentence a wording of its own for a custom range,
   * as the Metrics tab's do.
   */
  const isCustomRange: boolean = timeRange.range === TimeRange.CUSTOM;
  const rangeTerm: TranslatableTerm = translatableTerm(
    timeRange.range as string,
    { inSentence: true },
  );
  const noTracesInRange: string = isCustomRange
    ? translator.translateTemplate("No traces in the selected time range")
    : translator.translateTemplate("No traces in the {{range}}", {
        range: rangeTerm,
      });

  const headerBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText("Insights")}
        </h2>
        <p className="text-xs text-gray-500">
          {isCustomRange
            ? translator.translateTemplate(
                "Request health, error rates, and latency in the selected time range.",
              )
            : translator.translateTemplate(
                "Request health, error rates, and latency in the {{range}}.",
                { range: rangeTerm },
              )}
        </p>
        {(savedViewName || unappliedFiltersHint) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {savedViewName && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
                <span>
                  <TranslatedSentence
                    template="Scoped by saved view {{name}}"
                    slots={{
                      name: (
                        <span className="font-medium">{savedViewName}</span>
                      ),
                    }}
                  />
                </span>
                <button
                  type="button"
                  className="ml-0.5 rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700"
                  title={translator.translateText(
                    "Stop scoping by this saved view",
                  )}
                  aria-label={translator.translateText(
                    "Stop scoping by this saved view",
                  )}
                  onClick={() => {
                    applyServiceSelection([]);
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </span>
            )}
            {unappliedFiltersHint && (
              <HintChip>{unappliedFiltersHint}</HintChip>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem]">
          <Dropdown
            options={serviceOptions}
            value={selectedServiceOptions}
            isMultiSelect={true}
            placeholder="All services"
            ariaLabel="Scope insights to a service"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (!value) {
                applyServiceSelection([]);
                return;
              }

              const values: Array<DropdownValue> = Array.isArray(value)
                ? value
                : [value];

              applyServiceSelection(
                values
                  .map((item: DropdownValue): string => {
                    return String(item);
                  })
                  .filter((item: string): boolean => {
                    return item.length > 0;
                  }),
              );
            }}
          />
        </div>
        <TelemetryTimeRangePicker
          value={timeRange}
          onChange={(value: RangeStartAndEndDateTime): void => {
            setTimeRange(value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            void loadDashboard();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          title={translator.translateText("Refresh")}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          <span>{translator.translateText("Refresh")}</span>
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-xl border border-gray-200 bg-white p-12">
          <ComponentLoader />
        </div>
      </Fragment>
    );
  }

  if (error) {
    return (
      <Fragment>
        {headerBar}
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void loadDashboard();
          }}
        />
      </Fragment>
    );
  }

  if (serviceSummaries.length === 0) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon
              icon={IconProp.ChartBarSquare}
              className="h-7 w-7 text-indigo-500"
            />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            {noTracesInRange}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            {translator.translateText(
              "Once your services start sending distributed tracing data, you'll see request rates, error rates, latency percentiles, and more. Try widening the time range or check your collectors.",
            )}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <AppLink
              to={viewerRoute}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>{translator.translateText("Open Viewer")}</span>
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              <Icon icon={IconProp.Book} className="h-3.5 w-3.5" />
              <span>{translator.translateText("Setup Guide")}</span>
            </AppLink>
          </div>
        </div>
      </Fragment>
    );
  }

  const overallErrorRate: number =
    totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return (
    <Fragment>
      {headerBar}
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText("Requests")}
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {translator.formatNumber(totalRequests)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {isCustomRange
              ? translator.translateTemplate("the selected time range")
              : translator.translateTemplate("the {{range}}", {
                  range: rangeTerm,
                })}
          </p>
        </div>

        <div
          className={`rounded-xl border p-5 ${overallErrorRate > 5 ? "border-red-200 bg-red-50" : overallErrorRate > 1 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText("Error Rate")}
          </p>
          <p
            className={`text-3xl font-bold mt-1 ${overallErrorRate > 5 ? "text-red-600" : overallErrorRate > 1 ? "text-amber-600" : "text-green-600"}`}
          >
            {formatFixed(overallErrorRate, 1, translator)}%
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {translator.translatePlural(ERROR_COUNT, totalErrors)}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText("P50 Latency")}
          </p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {formatDuration(globalP50, translator)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {translator.translateText("median")}
          </p>
        </div>

        <div
          className={`rounded-xl border p-5 ${globalP95 > 1_000_000_000 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText("P95 Latency")}
          </p>
          <p
            className={`text-3xl font-bold mt-1 ${globalP95 > 1_000_000_000 ? "text-amber-600" : "text-gray-900"}`}
          >
            {formatDuration(globalP95, translator)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {translator.translateText("95th percentile")}
          </p>
        </div>

        <div
          className={`rounded-xl border p-5 ${globalP99 > 2_000_000_000 ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText("P99 Latency")}
          </p>
          <p
            className={`text-3xl font-bold mt-1 ${globalP99 > 2_000_000_000 ? "text-red-600" : "text-gray-900"}`}
          >
            {formatDuration(globalP99, translator)}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {translator.translateText("99th percentile")}
          </p>
        </div>
      </div>

      {/* Service Health Table */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {translator.translateText("Service Health")}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {translator.translateText(
                "Sorted by error rate — services needing attention first",
              )}
            </p>
          </div>
          <AppLink
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            to={viewerRoute}
          >
            {translator.translateText("Open Viewer")}
          </AppLink>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {serviceColumns.styles}
          <table
            className={serviceColumns.getTableWidthClassName("w-full")}
            {...serviceColumns.tableAttributes}
          >
            <thead>
              <tr className="border-b border-gray-100">
                <ResizableHeaderCell
                  scope="col"
                  className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "service",
                    translator.translateTerm("Service"),
                    ColumnWidthKind.Name,
                  )}
                >
                  <span>{translator.translateText("Service")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "requests",
                    translator.translateTerm("Requests"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Requests")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "errorRate",
                    translator.translateTerm("Error Rate"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Error Rate")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "p50",
                    translator.translateTerm("P50"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("P50")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "p95",
                    translator.translateTerm("P95"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("P95")}</span>
                </ResizableHeaderCell>
                <ResizableHeaderCell
                  scope="col"
                  className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3"
                  resize={serviceColumns.getResize(
                    "status",
                    translator.translateTerm("Status"),
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span>{translator.translateText("Status")}</span>
                </ResizableHeaderCell>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {serviceSummaries.map((summary: ServiceTraceSummary) => {
                const errorRate: number =
                  summary.totalTraces > 0
                    ? (summary.errorTraces / summary.totalTraces) * 100
                    : 0;

                let healthColor: string = "bg-green-500";
                let healthLabel: string = translationKey("Healthy");
                let healthBg: string = "bg-green-50 text-green-700";
                if (errorRate > 10) {
                  healthColor = "bg-red-500";
                  healthLabel = translationKey("Critical");
                  healthBg = "bg-red-50 text-red-700";
                } else if (errorRate > 5) {
                  healthColor = "bg-amber-500";
                  healthLabel = translationKey("Degraded");
                  healthBg = "bg-amber-50 text-amber-700";
                } else if (errorRate > 1) {
                  healthColor = "bg-yellow-400";
                  healthLabel = translationKey("Warning");
                  healthBg = "bg-yellow-50 text-yellow-700";
                }

                return (
                  <tr
                    key={summary.service.id?.toString()}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <ServiceElement service={summary.service} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-medium text-gray-900">
                        {translator.formatNumber(summary.totalTraces)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${errorRate > 10 ? "bg-red-500" : errorRate > 5 ? "bg-amber-400" : errorRate > 0 ? "bg-yellow-400" : "bg-green-400"}`}
                            style={{
                              width: `${Math.max(errorRate, errorRate > 0 ? 3 : 0)}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`text-sm font-medium ${errorRate > 5 ? "text-red-600" : "text-gray-900"}`}
                        >
                          {formatFixed(errorRate, 1, translator)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-gray-700">
                        {formatDuration(summary.p50Nanos, translator)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-gray-700">
                        {formatDuration(summary.p95Nanos, translator)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${healthBg}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${healthColor}`}
                        />
                        {translator.translateText(healthLabel)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <AppLink
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        to={
                          TelemetryServiceUtil.isUnknownServiceId(
                            summary.service._id as string | undefined,
                            ProjectUtil.getCurrentProjectId(),
                          )
                            ? (RouteUtil.populateRouteParams(
                                RouteMap[PageMap.TRACES] as Route,
                              ) as Route)
                            : RouteUtil.populateRouteParams(
                                RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                                {
                                  modelId: new ObjectID(
                                    summary.service._id as string,
                                  ),
                                },
                              )
                        }
                      >
                        {translator.translateText("View")}
                      </AppLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/*
       * Two-column: Errors + Slow Requests. Each column is a column of a
       * card row (CARD_ROW_COLUMN_CLASS_NAME): its box runs to the row's
       * bottom, so a short list beside a long one leaves no bare page
       * under it.
       */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Errors */}
        <div className={CARD_ROW_COLUMN_CLASS_NAME}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <h3 className="text-base font-semibold text-gray-900">
                {translator.translateText("Recent Errors")}
              </h3>
              {recentErrorTraces.length > 0 && (
                <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
                  {translator.formatNumber(recentErrorTraces.length)}
                </span>
              )}
            </div>
          </div>
          {recentErrorTraces.length === 0 ? (
            <div className="flex flex-col justify-center rounded-xl border border-gray-200 bg-white p-10 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <svg
                  className="h-5 w-5 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">
                {isCustomRange
                  ? translator.translateTemplate(
                      "No errors in the selected time range",
                    )
                  : translator.translateTemplate("No errors in the {{range}}", {
                      range: rangeTerm,
                    })}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {translator.translateText("Looking good!")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-50">
                {recentErrorTraces.map((trace: RecentTrace, index: number) => {
                  return (
                    <AppLink
                      key={`${trace.traceId}-${index}`}
                      className="block px-4 py-3 hover:bg-red-50/30 transition-colors"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW]!,
                        { modelId: trace.traceId },
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 min-w-0">
                          <SpanStatusElement
                            spanStatusCode={trace.statusCode}
                            title=""
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {getTraceName(trace)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {getServiceName(trace.primaryEntityId)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-xs font-mono text-gray-600">
                            {formatDuration(trace.durationNano, translator)}
                          </p>
                          <p className="text-xs text-gray-400">
                            {OneUptimeDate.fromNow(trace.startTime)}
                          </p>
                        </div>
                      </div>
                    </AppLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Slowest Requests */}
        <div className={CARD_ROW_COLUMN_CLASS_NAME}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">
              {translator.translateText("Slowest Requests")}
            </h3>
          </div>
          {recentSlowTraces.length === 0 ? (
            <div className="flex flex-col justify-center rounded-xl border border-gray-200 bg-white p-10 text-center">
              <p className="text-sm text-gray-500">{noTracesInRange}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-50">
                {recentSlowTraces.map((trace: RecentTrace, index: number) => {
                  const maxDuration: number =
                    recentSlowTraces[0]?.durationNano || 1;
                  const barWidth: number =
                    (trace.durationNano / maxDuration) * 100;

                  return (
                    <AppLink
                      key={`${trace.traceId}-slow-${index}`}
                      className="block px-4 py-3 hover:bg-amber-50/30 transition-colors"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW]!,
                        { modelId: trace.traceId },
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-3 min-w-0">
                          <SpanStatusElement
                            spanStatusCode={trace.statusCode}
                            title=""
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {getTraceName(trace)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {getServiceName(trace.primaryEntityId)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-sm font-mono font-semibold text-gray-900">
                            {formatDuration(trace.durationNano, translator)}
                          </p>
                        </div>
                      </div>
                      <div className="ml-8">
                        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-400"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </AppLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default TracesDashboard;
