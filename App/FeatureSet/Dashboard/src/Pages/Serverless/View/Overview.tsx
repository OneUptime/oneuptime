import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionInstance from "Common/Models/DatabaseModels/ServerlessFunctionInstance";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import {
  fetchSpanMetrics,
  formatCompact,
  formatDurationMs,
  formatPercent,
  SpanMetrics,
} from "../../../Components/TelemetryResource/telemetryMetrics";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const ServerlessFunctionOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [serverlessFunction, setServerlessFunction] =
    useState<ServerlessFunction | null>(null);
  const [instanceCount, setInstanceCount] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<SpanMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchModel: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: ServerlessFunction | null = await ModelAPI.getItem({
        modelType: ServerlessFunction,
        id: modelId,
        select: {
          name: true,
          description: true,
          functionIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          functionVersion: true,
          runtimeName: true,
          runtimeVersion: true,
          agentVersion: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.functionIdentifier) {
        setError("Serverless function not found.");
        setIsLoading(false);
        return;
      }

      setServerlessFunction(item);
      setIsLoading(false);

      ModelAPI.count({
        modelType: ServerlessFunctionInstance,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { serverlessFunctionId: modelId } as any,
      })
        .then(setInstanceCount)
        .catch(() => {
          return setInstanceCount(0);
        });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchModel().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    const fn: ServerlessFunction | null = serverlessFunction;
    if (!fn?.functionIdentifier) {
      return;
    }
    setMetricsLoading(true);
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });
    fetchSpanMetrics({
      attributes: { "resource.faas.name": fn.functionIdentifier as string },
      start,
      end,
    })
      .then((m: SpanMetrics) => {
        setMetrics(m);
        setMetricsLoading(false);
      })
      .catch(() => {
        setMetricsLoading(false);
      });
  }, [serverlessFunction, timeRange]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!serverlessFunction) {
    return <ErrorMessage message="Serverless function not found." />;
  }

  const fn: ServerlessFunction = serverlessFunction;
  const m: SpanMetrics | null = metrics;
  const runtime: string = [fn.runtimeName, fn.runtimeVersion]
    .filter((s: string | undefined): boolean => {
      return Boolean(s);
    })
    .join(" ");

  const chips: Array<ResourceOverviewChip> = [];
  if (fn.cloudPlatform) {
    chips.push({ icon: IconProp.Cloud, label: String(fn.cloudPlatform) });
  }
  if (fn.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(fn.cloudRegion) });
  }
  if (runtime) {
    chips.push({ icon: IconProp.Code, label: runtime });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Invocations",
      value: m ? formatCompact(m.total) : "…",
      icon: IconProp.Bolt,
      iconColor: "blue",
      sublabel: "selected range",
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "…",
      icon: IconProp.Alert,
      iconColor: "rose",
      sublabel: m ? `${formatCompact(m.errors)} errored` : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
    },
    {
      title: "p95 duration",
      value: m ? formatDurationMs(m.p95DurationMs) : "…",
      icon: IconProp.Clock,
      iconColor: "violet",
      sublabel: "selected range",
    },
    {
      title: "Instances",
      value: instanceCount === null ? "…" : formatCompact(instanceCount),
      icon: IconProp.Cube,
      iconColor: "amber",
      sublabel: "active",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES),
    },
  ];

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Invocations"
        icon={IconProp.Bolt}
        iconColor="blue"
        series={
          [
            { seriesName: "Invocations", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`serverless-${modelId.toString()}`}
        showLegend={true}
        loading={metricsLoading && !m}
      />
      <ChartCard
        title="p95 duration"
        icon={IconProp.Clock}
        iconColor="violet"
        series={
          [
            { seriesName: "p95", data: m?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`serverless-${modelId.toString()}`}
        yLegend="ms"
        yFormatter={(n: number): string => {
          return formatDurationMs(n);
        }}
        loading={metricsLoading && !m}
      />
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Invocation traces and spans",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Function logs",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Function metrics",
      to: populate(PageMap.SERVERLESS_FUNCTION_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Function Identifier (faas.name)", value: fn.functionIdentifier },
    { label: "Cloud Platform", value: fn.cloudPlatform },
    { label: "Cloud Provider", value: fn.cloudProvider },
    { label: "Cloud Region", value: fn.cloudRegion },
    { label: "Cloud Account ID", value: fn.cloudAccountId },
    { label: "Function Version (faas.version)", value: fn.functionVersion },
    { label: "Runtime", value: runtime },
    { label: "Agent Version", value: fn.agentVersion },
  ];

  return (
    <ResourceOverview
      icon={IconProp.Bolt}
      title={(fn.name as string) || "Serverless Function"}
      identifier={(fn.functionIdentifier as string) || ""}
      identifierLabel="faas.name"
      status={fn.otelCollectorStatus}
      lastSeenAt={fn.lastSeenAt}
      description={fn.description as string}
      chips={chips}
      tiles={tiles}
      charts={charts}
      controls={
        <TelemetryTimeRangePicker
          value={timeRange}
          onChange={(value: RangeStartAndEndDateTime): void => {
            setTimeRange(value);
          }}
        />
      }
      quickLinks={quickLinks}
      detailRows={detailRows}
      labels={fn.labels}
    />
  );
};

export default ServerlessFunctionOverview;
