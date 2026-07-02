import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import TechStack from "Common/Types/Service/TechStack";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Label from "Common/Models/DatabaseModels/Label";
import Service from "Common/Models/DatabaseModels/Service";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TechStackView from "../../../Components/TechStack/TechStackView";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import OneUptimeDate from "Common/Types/Date";
import {
  fetchSpanMetrics,
  formatCompact,
  formatDurationMs,
  formatPercent,
  SpanMetrics,
  TimePoint,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import {
  detectServiceLanguage,
  formatRuntimeValue,
  probeRuntimeCharts,
  ProbedRuntimeChart,
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
} from "../../../Components/TelemetryResource/serviceGoldenMetrics";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

// A service is "connected" if telemetry arrived in the last 30 minutes.
const CONNECTED_WINDOW_MS: number = 30 * 60 * 1000;

const meanOf: (series: Array<TimePoint>) => number | null = (
  series: Array<TimePoint>,
): number | null => {
  if (series.length === 0) {
    return null;
  }
  const sum: number = series.reduce((acc: number, p: TimePoint): number => {
    return acc + p.y;
  }, 0);
  return sum / series.length;
};

const ServiceView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [service, setService] = useState<Service | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [spanMetrics, setSpanMetrics] = useState<SpanMetrics | null>(null);
  const [runtimeCharts, setRuntimeCharts] = useState<Array<ProbedRuntimeChart>>(
    [],
  );
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);

  /*
   * showLoader=false refetches in place (used after an inline edit) so the
   * page doesn't flash back to the full-page loader.
   */
  const loadModel: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }
    try {
      const item: Service | null = await ModelAPI.getItem({
        modelType: Service,
        id: modelId,
        select: {
          name: true,
          description: true,
          techStack: true,
          lastSeenAt: true,
          serviceVersion: true,
          deploymentEnvironment: true,
          serviceNamespace: true,
          runtimeName: true,
          runtimeVersion: true,
          telemetrySdkLanguage: true,
          cloudProvider: true,
          cloudPlatform: true,
          cloudRegion: true,
          cloudAccountId: true,
        },
      });

      if (!item) {
        if (showLoader) {
          setError("Service not found.");
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setService(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setIsLoading(false);
      setIsRefreshing(false);
    } catch (err) {
      /*
       * Keep stale data visible on a background refresh; only the initial
       * load surfaces a page-level error.
       */
      if (showLoader) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadModel(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    if (!service) {
      return;
    }

    const language: ServiceLanguage | null = detectServiceLanguage({
      telemetrySdkLanguage: service.telemetrySdkLanguage,
      runtimeName: service.runtimeName,
      techStack: service.techStack,
    });

    setMetricsLoading(true);
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });

    /*
     * Staleness guard: a wide-range fetch fans out many aggregate queries
     * and can resolve after a subsequently selected narrower range —
     * without the guard the older response would clobber the newer one.
     */
    let ignore: boolean = false;
    Promise.all([
      fetchSpanMetrics({ primaryEntityId: modelId, start, end }),
      probeRuntimeCharts({ language, primaryEntityId: modelId, start, end }),
    ])
      .then(([m, runtime]: [SpanMetrics, Array<ProbedRuntimeChart>]) => {
        if (ignore) {
          return;
        }
        setSpanMetrics(m);
        setRuntimeCharts(runtime);
        setMetricsLoading(false);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setMetricsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [service, timeRange]);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "service-overview-auto-refresh-interval",
    onRefresh: (): void => {
      loadModel(false).catch(() => {
        // loadModel surfaces its own errors; a refresh tick stays silent.
      });
    },
  });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!service) {
    return <ErrorMessage message="Service not found." />;
  }

  const r: Service = service;
  const m: SpanMetrics | null = spanMetrics;

  const language: ServiceLanguage | null = detectServiceLanguage({
    telemetrySdkLanguage: r.telemetrySdkLanguage,
    runtimeName: r.runtimeName,
    techStack: r.techStack,
  });
  const languageDisplay: string | undefined = language
    ? SERVICE_LANGUAGE_DISPLAY_NAMES[language]
    : undefined;

  const lastSeen: Date | undefined = r.lastSeenAt
    ? new Date(r.lastSeenAt as unknown as string)
    : undefined;
  const status: string =
    lastSeen && Date.now() - lastSeen.getTime() < CONNECTED_WINDOW_MS
      ? "connected"
      : "disconnected";

  const chips: Array<ResourceOverviewChip> = [];
  if (languageDisplay) {
    chips.push({ icon: IconProp.Code, label: languageDisplay });
  }
  if (r.runtimeName) {
    chips.push({
      icon: IconProp.CPUChip,
      label: [r.runtimeName, r.runtimeVersion].filter(Boolean).join(" "),
    });
  }
  if (r.serviceVersion) {
    chips.push({ icon: IconProp.Tag, label: String(r.serviceVersion) });
  }
  if (r.deploymentEnvironment) {
    chips.push({
      icon: IconProp.Globe,
      label: String(r.deploymentEnvironment),
    });
  }
  if (r.cloudProvider) {
    chips.push({
      icon: IconProp.Cloud,
      label: [r.cloudProvider, r.cloudRegion].filter(Boolean).join(" "),
    });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Requests",
      value: m ? formatCompact(m.total) : "…",
      icon: IconProp.Workflow,
      iconColor: "sky",
      sublabel: "spans, selected range",
      to: populate(PageMap.SERVICE_VIEW_TRACES),
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "…",
      icon: IconProp.Alert,
      iconColor: "rose",
      sublabel: "of spans errored",
      percent: m?.errorRatePercent,
      thresholds: { warn: 1, danger: 5 },
    },
    {
      title: "Latency (p95)",
      value: m ? formatDurationMs(m.p95DurationMs) : "…",
      icon: IconProp.Clock,
      iconColor: "amber",
      sublabel: "span duration",
    },
  ];

  const firstRuntime: ProbedRuntimeChart | undefined = runtimeCharts[0];
  if (firstRuntime) {
    /*
     * Counter-style charts (per-bucket deltas) total over the range;
     * gauge-style charts average.
     */
    const isRangeTotal: boolean =
      firstRuntime.def.aggregationType === AggregationType.Sum ||
      firstRuntime.def.cumulativeCounter === true;
    const tileValue: number | null = isRangeTotal
      ? firstRuntime.series.reduce((acc: number, p: TimePoint): number => {
          return acc + p.y;
        }, 0)
      : meanOf(firstRuntime.series);
    tiles.push({
      title: firstRuntime.def.title,
      value: formatRuntimeValue(tileValue, firstRuntime.def.unit),
      icon: firstRuntime.def.icon,
      iconColor: firstRuntime.def.iconColor,
      sublabel: firstRuntime.def.sublabel,
      percent: firstRuntime.def.unit === "percent" ? tileValue : undefined,
    });
  } else {
    tiles.push({
      title: "Technology",
      value: languageDisplay || "Unknown",
      icon: IconProp.Code,
      iconColor: "slate",
      sublabel: "detected from telemetry",
    });
  }

  const syncId: string = `service-${modelId.toString()}`;

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Requests"
        icon={IconProp.Workflow}
        iconColor="sky"
        sublabel="spans and errored spans"
        series={
          [
            { seriesName: "Requests", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={metricsLoading}
      />
      <ChartCard
        title="Latency (p95)"
        icon={IconProp.Clock}
        iconColor="amber"
        sublabel="span duration"
        series={
          [
            { seriesName: "p95", data: m?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        yFormatter={(n: number): string => {
          return formatDurationMs(n);
        }}
        loading={metricsLoading}
      />
      {runtimeCharts.map((chart: ProbedRuntimeChart): ReactElement => {
        return (
          <ChartCard
            key={chart.def.key}
            title={chart.def.title}
            icon={chart.def.icon}
            iconColor={chart.def.iconColor}
            sublabel={chart.def.sublabel}
            tooltip={chart.def.tooltip}
            footerLink={
              chart.def.relatedLink
                ? {
                    title: chart.def.relatedLink.title,
                    to: populate(chart.def.relatedLink.page),
                  }
                : undefined
            }
            series={
              [
                { seriesName: chart.def.title, data: chart.series },
              ] as Array<SeriesPoint>
            }
            windowStart={chartWindow?.start ?? null}
            windowEnd={chartWindow?.end ?? null}
            syncId={syncId}
            yMax={chart.def.unit === "percent" ? 100 : "auto"}
            yFormatter={(n: number): string => {
              return formatRuntimeValue(n, chart.def.unit);
            }}
            loading={metricsLoading}
          />
        );
      })}
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Distributed traces from this service",
      to: populate(PageMap.SERVICE_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Logs emitted by this service",
      to: populate(PageMap.SERVICE_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "All metrics emitted by this service",
      to: populate(PageMap.SERVICE_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
    {
      title: "Exceptions",
      description:
        "Exceptions recorded on spans and logs, grouped by fingerprint",
      to: populate(PageMap.SERVICE_VIEW_EXCEPTIONS),
      icon: IconProp.Alert,
    },
    {
      title: "Performance profiles",
      description: "CPU and memory profiles for this service",
      to: populate(PageMap.SERVICE_VIEW_PROFILES),
      icon: IconProp.Gauge,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Technology", value: languageDisplay, mono: false },
    {
      label: "SDK Language (telemetry.sdk.language)",
      value: r.telemetrySdkLanguage,
    },
    {
      label: "Runtime",
      value:
        [r.runtimeName, r.runtimeVersion].filter(Boolean).join(" ") ||
        undefined,
    },
    { label: "Service Version", value: r.serviceVersion },
    { label: "Deployment Environment", value: r.deploymentEnvironment },
    { label: "Service Namespace", value: r.serviceNamespace },
    { label: "Cloud Provider", value: r.cloudProvider },
    { label: "Cloud Platform", value: r.cloudPlatform },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
  ];

  return (
    <Fragment>
      <ResourceOverview
        icon={IconProp.SquareStack}
        title={(r.name as string) || "Service"}
        identifier={(r.name as string) || ""}
        identifierLabel="service.name"
        status={status}
        lastSeenAt={lastSeen}
        description={r.description as string}
        chips={chips}
        tiles={tiles}
        tilesLoading={metricsLoading && !m}
        charts={charts}
        controls={
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={(): void => {
              loadModel(false).catch(() => {});
            }}
            isRefreshing={isRefreshing}
            lastRefreshedAt={lastRefreshedAt}
            timeRangePicker={
              <TelemetryTimeRangePicker
                value={timeRange}
                onChange={(value: RangeStartAndEndDateTime): void => {
                  setTimeRange(value);
                }}
              />
            }
          />
        }
        quickLinks={quickLinks}
        detailRows={detailRows}
      />

      <div className="mt-6">
        <ResourceActivityCards
          modelId={modelId}
          resourceQueryKey="services"
          refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
          incidentsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_INCIDENTS] as Route,
            { modelId: modelId },
          )}
          alertsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route,
            { modelId: modelId },
          )}
          scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE] as Route,
            { modelId: modelId },
          )}
        />
      </div>

      {/* Service View  */}
      <CardModelDetail<Service>
        name="Service > Service Details"
        cardProps={{
          title: "Service Details",
          description: "Here are more details for this service.",
        }}
        onSaveSuccess={(): void => {
          // Refresh the hero (name, tech stack → detected technology).
          loadModel(false).catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
        formSteps={[
          {
            title: "Service Info",
            id: "service-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "service-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Service Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "service-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              techStack: true,
            },
            stepId: "service-info",
            title: "Tech Stack",
            description:
              "The language or framework used to build this service.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: true,
            placeholder: "Tech Stack",
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(TechStack),
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: Service,
          id: "model-detail-service",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Service ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Service Name",
            },
            {
              field: {
                techStack: true,
              },
              title: "Tech Stack",
              fieldType: FieldType.Element,
              getElement: (item: Service): ReactElement => {
                return (
                  <Fragment>
                    <TechStackView techStack={item["techStack"] || []} />
                  </Fragment>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: Service): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default ServiceView;
