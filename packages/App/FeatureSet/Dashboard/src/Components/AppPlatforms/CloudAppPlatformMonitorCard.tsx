import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
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
  GroupedTimePoint,
  TimePoint,
  fetchGroupedMetricSeries,
  fetchMetricSeries,
} from "../TelemetryResource/telemetryMetrics";
import {
  formatBytes,
  formatCompact,
  formatDurationMsInLanguage,
  formatPercent,
} from "../TelemetryResource/telemetryFormat";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { getCloudMonitoredResourceAttributeFilters } from "../../Pages/Cloud/Utils/CloudMonitoredResourceScope";
import {
  CLOUD_APP_PLATFORM_DESCRIPTIONS,
  CloudAppPlatformFigure,
  CloudAppPlatformMetricRead,
  CloudAppPlatformPoint,
  CloudAppPlatformProfile,
  CloudAppPlatformSeries,
  CloudAppPlatformSummary,
  CloudAppPlatformTile,
  readCloudAppPlatformSplit,
  summarizeCloudAppPlatformSeries,
} from "../../Pages/AppPlatforms/Utils/CloudAppPlatformMetrics";
import {
  AZURE_MONITOR_AVERAGE_SUBLABEL,
  AZURE_MONITOR_OPEN_RESOURCE,
} from "./CloudAppAzureMonitorCard";

/*
 * THE NUMBERS A MANAGED PLATFORM'S OWN MONITORING MEASURES FOR AN APP
 * (#6794): a Container App's (Azure Monitor), a Cloud Run or App Engine
 * service's (Google Cloud Monitoring), an App Runner or ECS service's
 * (Amazon CloudWatch) - over the range picked above, whatever the app
 * itself sends. Each platform's figures, and how each is read and added up,
 * are its profile's (CloudAppPlatformMetrics); the section reads them with
 * the resource row's own filter, as the resource's own page does, under
 * the names its cloud connection stores them by.
 *
 * Laid out as an App Service app's Azure Monitor section is
 * (CloudAppAzureMonitorCard): the provider's logo and its service's name,
 * what the section is, the way to the resource's own page, its tiles, and
 * its charts with the app's deploys marked.
 */

export const PLATFORM_MONITOR_SECTION_DESCRIPTION: string = translationKey(
  "What {{service}} measures for this app, whatever the app sends.",
);
export const PLATFORM_MONITOR_CPU_AND_MEMORY: string =
  translationKey("CPU and memory");

// The tiles: two to a row, three once the section is 40rem wide, five from 64rem.
const TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-2 gap-4 [@container(min-width:40rem)]:grid-cols-3 [@container(min-width:64rem)]:grid-cols-5";

export interface ComponentProps {
  // The Cloud Resource the app runs as (CloudAppPlatformLink).
  resource: CloudResource;
  profile: CloudAppPlatformProfile;
  start: Date;
  end: Date;
  // Bumped by a refresh: the numbers are read again.
  refreshToken: number;
  // The app's charts' sync id, so a hover lines both sets up.
  syncId: string;
  // The app's deploys, marked as on its own charts.
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
}

/*
 * One read's series, by the figure each gives: a request count read by its
 * response code gives its requests and its server errors. A read that
 * fails gives nothing: unknown, never 0.
 */
export async function readCloudAppPlatformFigures(data: {
  read: CloudAppPlatformMetricRead;
  attributes: Record<string, string>;
  start: Date;
  end: Date;
}): Promise<CloudAppPlatformSeries> {
  const { read } = data;

  if (read.errorLabel) {
    try {
      const points: Array<GroupedTimePoint> = await fetchGroupedMetricSeries({
        name: read.storedName,
        attributes: data.attributes,
        aggregationType: read.aggregationType,
        start: data.start,
        end: data.end,
        groupBy: read.errorLabel.attribute,
      });
      const split: {
        requests: Array<CloudAppPlatformPoint>;
        serverErrors: Array<CloudAppPlatformPoint>;
      } = readCloudAppPlatformSplit({
        points: points.map(
          (point: GroupedTimePoint): { x: Date; label: string; y: number } => {
            return { x: point.x, label: point.group, y: point.y };
          },
        ),
        errorLabel: read.errorLabel,
        scale: read.scale,
      });

      return {
        [CloudAppPlatformFigure.Requests]: split.requests,
        [CloudAppPlatformFigure.ServerErrors]: split.serverErrors,
      };
    } catch {
      return {};
    }
  }

  const points: Array<TimePoint> = await fetchMetricSeries(
    {
      name: read.storedName,
      attributes: data.attributes,
      aggregationType: read.aggregationType,
      start: data.start,
      end: data.end,
    },
    read.scale,
  );

  return { [read.figure]: points };
}

const CloudAppPlatformMonitorCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [series, setSeries] = useState<CloudAppPlatformSeries | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const attributes: Record<string, string> =
    getCloudMonitoredResourceAttributeFilters(props.resource);
  const scopeKey: string = JSON.stringify(attributes);
  const readings: unknown = props.resource.cloudReadings;
  const readingsKey: string = JSON.stringify(readings || {});
  const reads: Array<CloudAppPlatformMetricRead> =
    props.profile.reads(readings);
  const service: string =
    translator.translateText(props.profile.service) || props.profile.service;

  useEffect(() => {
    if (Object.keys(attributes).length === 0) {
      setSeries({});
      setIsLoading(false);
      return;
    }

    let ignore: boolean = false;
    setIsLoading(true);

    Promise.all(
      reads.map(
        (read: CloudAppPlatformMetricRead): Promise<CloudAppPlatformSeries> => {
          return readCloudAppPlatformFigures({
            read,
            attributes,
            start: props.start,
            end: props.end,
          });
        },
      ),
    )
      .then((parts: Array<CloudAppPlatformSeries>): void => {
        if (!ignore) {
          setSeries(Object.assign({}, ...parts) as CloudAppPlatformSeries);
          setIsLoading(false);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setSeries({});
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    scopeKey,
    readingsKey,
    props.profile.type,
    props.start.getTime(),
    props.end.getTime(),
    props.refreshToken,
  ]);

  const summary: CloudAppPlatformSummary | null = series
    ? summarizeCloudAppPlatformSeries(series)
    : null;

  const resourceRoute: Route | null = props.resource._id
    ? RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
        { modelId: new ObjectID(props.resource._id.toString()) },
      )
    : null;

  const described: (description: string) => string = (
    description: string,
  ): string => {
    return translator.translateTemplate(description, { service });
  };

  const tileOf: (tile: CloudAppPlatformTile) => ResourceOverviewTile = (
    tile: CloudAppPlatformTile,
  ): ResourceOverviewTile => {
    const description: string = described(tile.description);

    switch (tile.figure) {
      case CloudAppPlatformFigure.Requests:
        return {
          title: "Requests",
          value: formatCompact(summary ? summary.requests : null, translator),
          icon: IconProp.Workflow,
          iconColor: "sky",
          loading: isLoading,
          sublabel: "selected range",
          description,
        };
      case CloudAppPlatformFigure.ServerErrors:
        return {
          title: "Server errors",
          value: formatPercent(
            summary ? summary.serverErrorRatePercent : null,
            translator,
          ),
          icon: IconProp.Alert,
          iconColor: "rose",
          loading: isLoading,
          sublabel:
            summary && summary.serverErrors !== null
              ? translator.translateTemplate("{{errors}} errored", {
                  errors: formatCompact(summary.serverErrors, translator),
                })
              : undefined,
          percent: summary ? summary.serverErrorRatePercent : null,
          higherIsBetter: false,
          thresholds: { warn: 1, danger: 5 },
          description,
        };
      case CloudAppPlatformFigure.ResponseTime:
        return {
          title: "Response time",
          value: formatDurationMsInLanguage(
            summary ? summary.responseTimeMs : null,
            translator,
          ),
          icon: IconProp.Clock,
          iconColor: "emerald",
          loading: isLoading,
          sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
          description,
        };
      case CloudAppPlatformFigure.Latency:
        return {
          title: "p95 latency",
          value: formatDurationMsInLanguage(
            summary ? summary.latencyMs : null,
            translator,
          ),
          icon: IconProp.Clock,
          iconColor: "emerald",
          loading: isLoading,
          sublabel: "selected range",
          description,
        };
      case CloudAppPlatformFigure.Cpu:
        return {
          title: "CPU",
          value: formatPercent(summary ? summary.cpuPercent : null, translator),
          icon: IconProp.ChartBar,
          iconColor: "blue",
          loading: isLoading,
          sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
          percent: summary ? summary.cpuPercent : null,
          description,
        };
      case CloudAppPlatformFigure.Memory:
        return {
          title: "Memory",
          value: formatBytes(summary ? summary.memoryBytes : null, translator),
          icon: IconProp.SquareStack,
          iconColor: "violet",
          loading: isLoading,
          sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
          description,
        };
      case CloudAppPlatformFigure.MemoryPercent:
        return {
          title: "Memory",
          value: formatPercent(
            summary ? summary.memoryPercent : null,
            translator,
          ),
          icon: IconProp.SquareStack,
          iconColor: "violet",
          loading: isLoading,
          sublabel: AZURE_MONITOR_AVERAGE_SUBLABEL,
          percent: summary ? summary.memoryPercent : null,
          description,
        };
      case CloudAppPlatformFigure.Restarts:
      default:
        return {
          title: "Restarts",
          value: formatCompact(summary ? summary.restarts : null, translator),
          icon: IconProp.Refresh,
          iconColor: "amber",
          loading: isLoading,
          sublabel: "selected range",
          description,
        };
    }
  };

  const tiles: Array<ResourceOverviewTile> = props.profile.tiles.map(tileOf);
  const hasServerErrors: boolean = props.profile.tiles.some(
    (tile: CloudAppPlatformTile): boolean => {
      return tile.figure === CloudAppPlatformFigure.ServerErrors;
    },
  );
  const latencyFigure: CloudAppPlatformFigure = props.profile.tiles.some(
    (tile: CloudAppPlatformTile): boolean => {
      return tile.figure === CloudAppPlatformFigure.Latency;
    },
  )
    ? CloudAppPlatformFigure.Latency
    : CloudAppPlatformFigure.ResponseTime;
  const memoryFigure: CloudAppPlatformFigure = props.profile.tiles.some(
    (tile: CloudAppPlatformTile): boolean => {
      return tile.figure === CloudAppPlatformFigure.MemoryPercent;
    },
  )
    ? CloudAppPlatformFigure.MemoryPercent
    : CloudAppPlatformFigure.Memory;
  const chartsLoading: boolean = isLoading && !series;
  const pointsOf: (figure: CloudAppPlatformFigure) => Array<TimePoint> = (
    figure: CloudAppPlatformFigure,
  ): Array<TimePoint> => {
    return series?.[figure] ?? [];
  };

  const charts: Array<ReactElement> = props.profile.charts.map(
    (chart: string): ReactElement => {
      if (chart === "requests") {
        return (
          <ChartCard
            key={chart}
            title="Requests"
            icon={IconProp.Workflow}
            iconColor="sky"
            series={
              [
                {
                  seriesName: "Requests",
                  data: pointsOf(CloudAppPlatformFigure.Requests),
                },
                ...(hasServerErrors
                  ? [
                      {
                        seriesName: "Server errors",
                        data: pointsOf(CloudAppPlatformFigure.ServerErrors),
                      },
                    ]
                  : []),
              ] as Array<SeriesPoint>
            }
            windowStart={props.start}
            windowEnd={props.end}
            syncId={props.syncId}
            showLegend={true}
            loading={chartsLoading}
            description={described(props.profile.requestsChartDescription)}
            timeReferenceLines={props.timeReferenceLines}
          />
        );
      }

      if (chart === "latency") {
        return (
          <ChartCard
            key={chart}
            title={
              latencyFigure === CloudAppPlatformFigure.Latency
                ? "p95 latency"
                : "Response time"
            }
            icon={IconProp.Clock}
            iconColor="emerald"
            series={
              [
                {
                  seriesName:
                    latencyFigure === CloudAppPlatformFigure.Latency
                      ? "p95 latency"
                      : "Response time",
                  data: pointsOf(latencyFigure),
                },
              ] as Array<SeriesPoint>
            }
            windowStart={props.start}
            windowEnd={props.end}
            syncId={props.syncId}
            yFormatter={(value: number): string => {
              return formatDurationMsInLanguage(value, translator);
            }}
            loading={chartsLoading}
            description={described(props.profile.latencyChartDescription)}
            timeReferenceLines={props.timeReferenceLines}
          />
        );
      }

      return (
        <ChartCard
          key={chart}
          title={PLATFORM_MONITOR_CPU_AND_MEMORY}
          icon={IconProp.ChartBar}
          iconColor="blue"
          series={
            [
              { seriesName: "CPU", data: pointsOf(CloudAppPlatformFigure.Cpu) },
              { seriesName: "Memory", data: pointsOf(memoryFigure) },
            ] as Array<SeriesPoint>
          }
          windowStart={props.start}
          windowEnd={props.end}
          syncId={props.syncId}
          showLegend={true}
          yFormatter={(value: number): string => {
            return formatPercent(value, translator);
          }}
          loading={chartsLoading}
          description={described(
            CLOUD_APP_PLATFORM_DESCRIPTIONS["usageChart"]!,
          )}
          timeReferenceLines={props.timeReferenceLines}
        />
      );
    },
  );

  return (
    <section
      className="mb-6"
      aria-labelledby="cloud-app-platform-monitor-title"
      data-testid="cloud-app-platform-monitor"
      data-type={props.profile.type}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-gray-200">
            <CloudConnectionLogo provider={props.profile.provider} size="sm" />
          </div>
          <div className="min-w-0">
            <h2
              id="cloud-app-platform-monitor-title"
              className="text-base font-semibold text-gray-900"
              data-testid="cloud-app-platform-monitor-title"
            >
              {service}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {translator.translateTemplate(
                PLATFORM_MONITOR_SECTION_DESCRIPTION,
                { service },
              )}
            </p>
          </div>
        </div>
        {resourceRoute ? (
          <AppLink
            to={resourceRoute}
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            dataTestId="cloud-app-platform-monitor-open"
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
          data-testid="cloud-app-platform-monitor-tiles"
        >
          {tiles.map((tile: ResourceOverviewTile): ReactElement => {
            return <ResourceOverviewTileCard key={tile.title} {...tile} />;
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{charts}</div>
    </section>
  );
};

export default CloudAppPlatformMonitorCard;
