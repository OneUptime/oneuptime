import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import AppLink from "../AppLink/AppLink";
import CloudConnectionLogo from "../Cloud/Connect/CloudConnectionLogo";
import ChartCard from "../TelemetryResource/ChartCard";
import {
  RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME,
  ResourceOverviewTile,
  ResourceOverviewTileCard,
} from "../TelemetryResource/ResourceOverview";
import {
  TimePoint,
  fetchMetricSeries,
} from "../TelemetryResource/telemetryMetrics";
import {
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "../TelemetryResource/telemetryFormat";
import { CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS } from "../MetricDescriptions/CloudMetricDescriptions";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getCloudMonitoredResourceAttributeFilters } from "../../Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  AppServiceMetric,
  AppServiceSeries,
  AppServiceSummary,
  formatAppServiceCpuTime,
  getAppServiceStoredMetricName,
  summarizeAppServiceSeries,
} from "../../Pages/AppPlatforms/Utils/CloudAppPlatformResource";

/*
 * An Azure App Service app's site, as Azure Monitor measures it (issue
 * #6770): its requests, server errors, response time, CPU time and memory
 * over the range picked above, whatever the app itself sends - the numbers
 * an app that sends no traces has no other way to show, and the CPU and
 * memory App Service gives no app of its own. Drawn under the app's own
 * numbers when its subscription is connected and the site is found
 * (CloudAppPlatformResource), with the way to the site's own page, which
 * lists every metric it reports.
 *
 * A section of the Overview rather than a card around the tiles: the tiles
 * are cards themselves, and the app's own sit bare above it. Its heading -
 * the Azure logo, "Azure Monitor", what it is - tells its numbers from the
 * app's.
 */

export const AZURE_MONITOR_SECTION_TITLE: string =
  translationKey("Azure Monitor");
export const AZURE_MONITOR_SECTION_DESCRIPTION: string = translationKey(
  "What Azure measures for this app's site, whatever the app sends.",
);
export const AZURE_MONITOR_OPEN_RESOURCE: string =
  translationKey("Open resource");
export const AZURE_MONITOR_AVERAGE_SUBLABEL: string = translationKey(
  "average, selected range",
);

// The tiles: two to a row, three once the section is 40rem wide, five from 64rem.
const TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 [@container(min-width:40rem)]:grid-cols-3 [@container(min-width:64rem)]:grid-cols-5";

const EMPTY_SERIES: AppServiceSeries = {
  requests: [],
  serverErrors: [],
  responseTimeSeconds: [],
  cpuTimeSeconds: [],
  memoryBytes: [],
};

export interface ComponentProps {
  // The site's Cloud Resource (fetchCloudAppPlatformResource).
  resource: CloudResource;
  start: Date;
  end: Date;
  // Bumped by a refresh: the numbers are read again.
  refreshToken: number;
  // The app's charts' sync id, so a hover lines both sets up.
  syncId: string;
  // The app's deploys, marked as on its own charts.
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
}

const CloudAppAzureMonitorCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [series, setSeries] = useState<AppServiceSeries | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const attributes: Record<string, string> =
    getCloudMonitoredResourceAttributeFilters(props.resource);
  const scopeKey: string = JSON.stringify(attributes);
  const readingsKey: string = JSON.stringify(
    props.resource.cloudReadings || {},
  );

  useEffect(() => {
    if (Object.keys(attributes).length === 0) {
      setSeries(EMPTY_SERIES);
      setIsLoading(false);
      return;
    }

    let ignore: boolean = false;
    setIsLoading(true);

    const read: (
      metric: AppServiceMetric,
      aggregationType: AggregationType,
    ) => Promise<Array<TimePoint>> = (
      metric: AppServiceMetric,
      aggregationType: AggregationType,
    ): Promise<Array<TimePoint>> => {
      return fetchMetricSeries({
        name: getAppServiceStoredMetricName({
          metric,
          readings: props.resource.cloudReadings,
        }),
        attributes,
        aggregationType,
        start: props.start,
        end: props.end,
      });
    };

    Promise.all([
      read(AppServiceMetric.Requests, AggregationType.Sum),
      read(AppServiceMetric.ServerErrors, AggregationType.Sum),
      read(AppServiceMetric.ResponseTime, AggregationType.Avg),
      read(AppServiceMetric.CpuTime, AggregationType.Sum),
      read(AppServiceMetric.MemoryWorkingSet, AggregationType.Avg),
    ])
      .then(
        ([requests, serverErrors, responseTime, cpuTime, memory]: Array<
          Array<TimePoint>
        >): void => {
          if (ignore) {
            return;
          }

          setSeries({
            requests: requests || [],
            serverErrors: serverErrors || [],
            responseTimeSeconds: responseTime || [],
            cpuTimeSeconds: cpuTime || [],
            memoryBytes: memory || [],
          });
          setIsLoading(false);
        },
      )
      .catch((): void => {
        if (!ignore) {
          setSeries(EMPTY_SERIES);
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    scopeKey,
    readingsKey,
    props.start.getTime(),
    props.end.getTime(),
    props.refreshToken,
  ]);

  const summary: AppServiceSummary | null = series
    ? summarizeAppServiceSeries(series)
    : null;

  const resourceRoute: Route | null = props.resource._id
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
        { modelId: new ObjectID(props.resource._id.toString()) },
      )
    : null;

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Requests",
      value: formatCompact(summary ? summary.requests : null),
      icon: IconProp.Workflow,
      iconColor: "sky",
      loading: isLoading,
      sublabel: "selected range",
      description: CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.requests,
    },
    {
      title: "Server errors",
      value: formatPercent(summary ? summary.serverErrorRatePercent : null),
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: isLoading,
      sublabel:
        summary && summary.serverErrors !== null
          ? translator.translateTemplate("{{errors}} errored", {
              errors: formatCompact(summary.serverErrors),
            })
          : undefined,
      percent: summary ? summary.serverErrorRatePercent : null,
      higherIsBetter: false,
      thresholds: { warn: 1, danger: 5 },
      description: CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.serverErrors,
    },
    {
      title: "Response time",
      value: formatDurationMs(summary ? summary.responseTimeMs : null),
      icon: IconProp.Clock,
      iconColor: "emerald",
      loading: isLoading,
      sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
      description: CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.responseTime,
    },
    {
      title: "CPU time",
      value: formatAppServiceCpuTime(
        summary ? summary.cpuTimeSeconds : null,
        translator.language,
      ),
      icon: IconProp.ChartBar,
      iconColor: "blue",
      loading: isLoading,
      sublabel: "selected range",
      description: CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.cpuTime,
    },
    {
      title: "Memory",
      value: formatBytes(summary ? summary.memoryBytes : null),
      icon: IconProp.SquareStack,
      iconColor: "violet",
      loading: isLoading,
      sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
      description: CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.memory,
    },
  ];

  const chartsLoading: boolean = isLoading && !series;

  return (
    <section
      className="mb-6"
      aria-labelledby="cloud-app-azure-monitor-title"
      data-testid="cloud-app-azure-monitor"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-gray-200">
            <CloudConnectionLogo provider={CloudProvider.Azure} size="sm" />
          </div>
          <div className="min-w-0">
            <h2
              id="cloud-app-azure-monitor-title"
              className="text-base font-semibold text-gray-900"
            >
              {translator.translateText(AZURE_MONITOR_SECTION_TITLE) ||
                AZURE_MONITOR_SECTION_TITLE}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {translator.translateText(AZURE_MONITOR_SECTION_DESCRIPTION) ||
                AZURE_MONITOR_SECTION_DESCRIPTION}
            </p>
          </div>
        </div>
        {resourceRoute ? (
          <AppLink
            to={resourceRoute}
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            dataTestId="cloud-app-azure-monitor-open"
          >
            <span>
              {translator.translateText(AZURE_MONITOR_OPEN_RESOURCE) ||
                AZURE_MONITOR_OPEN_RESOURCE}
            </span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </AppLink>
        ) : (
          <></>
        )}
      </div>

      <div className={RESOURCE_OVERVIEW_TILES_FRAME_CLASS_NAME}>
        <div
          className={TILES_GRID_CLASS_NAME}
          data-testid="cloud-app-azure-monitor-tiles"
        >
          {tiles.map((tile: ResourceOverviewTile): ReactElement => {
            return <ResourceOverviewTileCard key={tile.title} {...tile} />;
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Requests"
          icon={IconProp.Workflow}
          iconColor="sky"
          series={
            [
              { seriesName: "Requests", data: series?.requests ?? [] },
              {
                seriesName: "Server errors",
                data: series?.serverErrors ?? [],
              },
            ] as Array<SeriesPoint>
          }
          windowStart={props.start}
          windowEnd={props.end}
          syncId={props.syncId}
          showLegend={true}
          loading={chartsLoading}
          description={CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.requestsChart}
          timeReferenceLines={props.timeReferenceLines}
        />
        <ChartCard
          title="Response time"
          icon={IconProp.Clock}
          iconColor="emerald"
          series={
            [
              {
                seriesName: "Response time",
                data: (series?.responseTimeSeconds ?? []).map(
                  (point: TimePoint): TimePoint => {
                    return { x: point.x, y: point.y * 1000 };
                  },
                ),
              },
            ] as Array<SeriesPoint>
          }
          windowStart={props.start}
          windowEnd={props.end}
          syncId={props.syncId}
          yFormatter={(value: number): string => {
            return formatDurationMs(value);
          }}
          loading={chartsLoading}
          description={CLOUD_APP_AZURE_MONITOR_DESCRIPTIONS.responseTimeChart}
          timeReferenceLines={props.timeReferenceLines}
        />
      </div>
    </section>
  );
};

export default CloudAppAzureMonitorCard;
