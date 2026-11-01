import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import CloudAppRevision from "Common/Models/DatabaseModels/CloudAppRevision";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Pill from "Common/UI/Components/Pill/Pill";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ChartCard from "../TelemetryResource/ChartCard";
import {
  RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME,
  ResourceOverviewTile,
  ResourceOverviewTileCard,
} from "../TelemetryResource/ResourceOverview";
import {
  SpanMetrics,
  fetchSpanMetrics,
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "../TelemetryResource/telemetryMetrics";
import { CLOUD_APP_METRIC_DESCRIPTIONS } from "../MetricDescriptions/CloudMetricDescriptions";
import {
  CLOUD_APP_LIVE_WINDOW_MINUTES,
  CLOUD_APP_REVISION_STATE_LABELS,
  CloudAppChangeMarker,
  CloudAppChangeMarkerKind,
  CloudAppRevisionState,
  countLiveInstancesByRevision,
  getCloudAppAttributeNoun,
  getCloudAppAttributes,
  getCloudAppChangeMarkers,
  getCloudAppDetailAttributeKeys,
  getCloudAppRevisionNoun,
  getCloudAppTelemetryFilters,
  getShortRevision,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import { isCloudInstanceLive } from "../../Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";
import { APP_INSTANCE_COUNT } from "./CloudAppCells";
import {
  CLOUD_APP_REVISION_STATE_COLORS,
  REVISION_REPLACED,
} from "./CloudAppRevisionsTab";

/*
 * An App Platforms app's Overview tab: how it is doing in the range picked
 * above - its requests, error rate and p95 from its own traces, with a
 * dashed line at every deploy - what runs it right now (its live instances,
 * their CPU and memory, and which revisions they run), and the attributes
 * it is told apart by.
 *
 * "Running now" names each revision's state as the Revisions tab does
 * (Current in green, an older or newer one still Running in amber), so the
 * bars' colours say what they mean, and explains two revisions at once only
 * when there are two (#5511's UI review: the card's description said it on
 * every app). Its Details card is laid out as every resource Overview's is
 * (ResourceOverview): each attribute named as the app's telemetry chips
 * name it, its key under it - "Cluster" over "aws.ecs.cluster.arn" - and
 * the revision it runs under the attribute it is read from.
 */

export const DEPLOY_MARKER_LABEL: string = translationKey(
  "Deployed revision {{revision}}",
);
export const ROLLBACK_MARKER_LABEL: string = translationKey(
  "Rolled back to revision {{revision}}",
);
export const RUNNING_NOW_TITLE: string = translationKey("Running now");
export const RUNNING_NOW_EMPTY: string = translationKey(
  "No instance of this app reported in the last 15 minutes.",
);
export const RUNNING_NOW_SPLIT: string = translationKey(
  "More than one revision is running: a deploy in progress, or traffic split between them.",
);
export const APP_DETAILS_DESCRIPTION: string = translationKey(
  "The resource attributes this app's telemetry is matched on, and the revision it runs.",
);

/*
 * An attribute's key, free to break after each of its dots: in the Details
 * card's label column at a tablet's width "(aws.ecs.task.family)" broke at
 * whatever letter filled the line ("aws.ecs.task.fam" over "ily"). A <wbr>
 * adds no character, so a copy reads the key as written.
 */
export const AttributeKey: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  const parts: Array<string> = props.name.split(".");

  return (
    <>
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 ? (
              <>
                .<wbr />
              </>
            ) : (
              <></>
            )}
          </Fragment>
        );
      })}
    </>
  );
};

// One row of the Details card.
interface AppDetailRow {
  key: string;
  // What the value is, in the reader's language.
  label: string;
  // The attribute it is read from, beside the label: "(aws.ecs.task.family)".
  attribute?: string | undefined;
  value: string;
  mono: boolean;
}

// The colours the metric charts draw a change in (UseEventTimeReferenceLines).
const DEPLOY_MARKER_COLOR: string = "#6366f1";
const ROLLBACK_MARKER_COLOR: string = "#f59e0b";

export interface ComponentProps {
  app: CloudApp;
  environment: CloudResource;
  instances: Array<CloudResourceInstance>;
  revisions: Array<CloudAppRevision>;
  start: Date;
  end: Date;
  // Bumped by a refresh: the numbers are read again.
  refreshToken: number;
}

const CloudAppOverviewTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();
  const [metrics, setMetrics] = useState<SpanMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const filters: Record<string, string> = getCloudAppTelemetryFilters({
    environment: props.environment,
    app: props.app,
  });
  const scopeKey: string = JSON.stringify(filters);
  const isScoped: boolean =
    Object.keys(getCloudAppAttributes(props.app)).length > 0;

  useEffect(() => {
    if (!isScoped) {
      setMetrics(null);
      setIsLoading(false);
      return;
    }

    let ignore: boolean = false;
    setIsLoading(true);

    fetchSpanMetrics({
      attributes: filters,
      start: props.start,
      end: props.end,
      entrySpansOnly: true,
    })
      .then((result: SpanMetrics): void => {
        if (!ignore) {
          setMetrics(result);
          setIsLoading(false);
        }
      })
      .catch((): void => {
        if (!ignore) {
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    scopeKey,
    props.start.getTime(),
    props.end.getTime(),
    props.refreshToken,
  ]);

  // One clock reading, so an instance cannot flip halfway through a count.
  const now: Date = OneUptimeDate.getCurrentDate();
  const liveInstances: Array<CloudResourceInstance> = props.instances.filter(
    (instance: CloudResourceInstance): boolean => {
      return isCloudInstanceLive(instance.lastSeenAt, now);
    },
  );
  const cpuValues: Array<number> = liveInstances
    .map((instance: CloudResourceInstance): number | undefined => {
      return instance.latestCpuPercent;
    })
    .filter((value: number | undefined): value is number => {
      return typeof value === "number" && Number.isFinite(value);
    });
  const avgCpu: number | null =
    cpuValues.length > 0
      ? cpuValues.reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0) / cpuValues.length
      : null;
  const totalMemory: number = liveInstances.reduce(
    (sum: number, instance: CloudResourceInstance): number => {
      return sum + (instance.latestMemoryBytes || 0);
    },
    0,
  );
  const hasMemory: boolean = liveInstances.some(
    (instance: CloudResourceInstance): boolean => {
      return typeof instance.latestMemoryBytes === "number";
    },
  );

  const m: SpanMetrics | null = metrics;

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Requests",
      value: m ? formatCompact(m.total) : "—",
      icon: IconProp.Workflow,
      iconColor: "sky",
      loading: isLoading,
      sublabel: "selected range",
      description: CLOUD_APP_METRIC_DESCRIPTIONS.requests,
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "—",
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: isLoading,
      sublabel: m
        ? translator.translateTemplate("{{errors}} errored", {
            errors: formatCompact(m.errors),
          })
        : undefined,
      percent: m ? m.errorRatePercent : null,
      higherIsBetter: false,
      thresholds: { warn: 1, danger: 5 },
      description: CLOUD_APP_METRIC_DESCRIPTIONS.errorRate,
    },
    {
      title: "p95 latency",
      value: m ? formatDurationMs(m.p95DurationMs) : "—",
      icon: IconProp.Clock,
      iconColor: "emerald",
      loading: isLoading,
      sublabel: "selected range",
      description: CLOUD_APP_METRIC_DESCRIPTIONS.p95Latency,
    },
    {
      title: "Instances",
      value: formatCompact(liveInstances.length),
      icon: IconProp.Cube,
      iconColor: "amber",
      sublabel: translator.translateTemplate(
        "live in the last {{minutes}} min",
        { minutes: CLOUD_APP_LIVE_WINDOW_MINUTES },
      ),
      description: CLOUD_APP_METRIC_DESCRIPTIONS.instances,
    },
    {
      title: "CPU",
      value: formatPercent(avgCpu),
      icon: IconProp.ChartBar,
      iconColor: "blue",
      sublabel: "avg across live instances",
      percent: avgCpu,
      description: CLOUD_APP_METRIC_DESCRIPTIONS.cpu,
    },
    {
      title: "Memory",
      value: hasMemory ? formatBytes(totalMemory) : "—",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      sublabel: "total across live instances",
      description: CLOUD_APP_METRIC_DESCRIPTIONS.memory,
    },
  ];

  const markers: Array<CloudAppChangeMarker> = getCloudAppChangeMarkers({
    revisions: props.revisions,
    currentRevision: props.app.currentRevision,
    currentRevisionSince: props.app.currentRevisionSince,
    previousRevision: props.app.previousRevision,
    start: props.start,
    end: props.end,
  });

  const referenceLines: Array<ChartTimeReferenceLineProps> = markers.map(
    (marker: CloudAppChangeMarker): ChartTimeReferenceLineProps => {
      const isRollback: boolean =
        marker.kind === CloudAppChangeMarkerKind.RolledBack;
      const revision: string = getShortRevision({
        revision: marker.revision,
        appName: props.app.name,
      });

      return {
        date: marker.time,
        label: translator.translateTemplate(
          isRollback ? ROLLBACK_MARKER_LABEL : DEPLOY_MARKER_LABEL,
          { revision },
        ),
        subtitle: translator.translateTemplate(REVISION_REPLACED, {
          revision: getShortRevision({
            revision: marker.previousRevision,
            appName: props.app.name,
          }),
        }),
        color: isRollback ? ROLLBACK_MARKER_COLOR : DEPLOY_MARKER_COLOR,
        strokeDasharray: "4 4",
        kind: ChartEventKind.Change,
      };
    },
  );

  const runningByRevision: Map<string, number> = countLiveInstancesByRevision(
    props.instances,
    now,
  );
  const runningRevisions: Array<[string, number]> = Array.from(
    runningByRevision.entries(),
  ).sort((a: [string, number], b: [string, number]): number => {
    // The current revision first, then the busiest.
    if (a[0] === props.app.currentRevision) {
      return -1;
    }
    if (b[0] === props.app.currentRevision) {
      return 1;
    }
    return b[1] - a[1];
  });
  const totalRunning: number = runningRevisions.reduce(
    (sum: number, entry: [string, number]): number => {
      return sum + entry[1];
    },
    0,
  );

  const ownAttributes: Record<string, string> = getCloudAppAttributes(
    props.app,
  );
  const revisionNoun: string = getCloudAppRevisionNoun(props.app.cloudPlatform);

  const detailRows: Array<AppDetailRow> = [
    ...getCloudAppDetailAttributeKeys(props.app).map(
      (key: string): AppDetailRow => {
        const noun: string = getCloudAppAttributeNoun({
          key,
          cloudPlatform: props.app.cloudPlatform,
        });

        return {
          key,
          label: translator.translateText(noun) || noun,
          attribute: key,
          value: ownAttributes[key] || "",
          mono: true,
        };
      },
    ),
  ];

  if (props.app.currentRevision) {
    detailRows.push({
      key: "revision",
      label: translator.translateText(revisionNoun) || revisionNoun,
      attribute: props.app.revisionAttribute || undefined,
      value: props.app.currentRevision,
      mono: true,
    });
  }

  if (props.app.image) {
    detailRows.push({
      key: "image",
      label: translator.translateText("Image") || "Image",
      value: props.app.image,
      mono: true,
    });
  }

  if (props.app.createdAt) {
    detailRows.push({
      key: "first-seen",
      label: translator.translateText("First Seen") || "First Seen",
      value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        OneUptimeDate.fromString(props.app.createdAt),
      ),
      mono: false,
    });
  }

  return (
    <div data-testid="cloud-app-overview">
      <div
        className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3"
        data-testid="cloud-app-tiles"
      >
        {tiles.map((tile: ResourceOverviewTile): ReactElement => {
          return <ResourceOverviewTileCard key={tile.title} {...tile} />;
        })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Requests"
          icon={IconProp.Workflow}
          iconColor="sky"
          series={
            [
              { seriesName: "Requests", data: m?.countSeries ?? [] },
              { seriesName: "Errors", data: m?.errorSeries ?? [] },
            ] as Array<SeriesPoint>
          }
          windowStart={props.start}
          windowEnd={props.end}
          syncId={`cloud-app-${props.app._id?.toString() || ""}`}
          showLegend={true}
          loading={isLoading && !m}
          description={CLOUD_APP_METRIC_DESCRIPTIONS.requestsChart}
          timeReferenceLines={referenceLines}
        />
        <ChartCard
          title="p95 latency"
          icon={IconProp.Clock}
          iconColor="emerald"
          series={
            [
              { seriesName: "p95 latency", data: m?.p95Series ?? [] },
            ] as Array<SeriesPoint>
          }
          windowStart={props.start}
          windowEnd={props.end}
          syncId={`cloud-app-${props.app._id?.toString() || ""}`}
          yFormatter={(value: number): string => {
            return formatDurationMs(value);
          }}
          loading={isLoading && !m}
          description={CLOUD_APP_METRIC_DESCRIPTIONS.latencyChart}
          timeReferenceLines={referenceLines}
        />
      </div>

      <div className="mb-6">
        <Card
          title={RUNNING_NOW_TITLE}
          description={CLOUD_APP_METRIC_DESCRIPTIONS.rollout}
        >
          {runningRevisions.length === 0 ? (
            <p
              className="text-sm text-gray-500"
              data-testid="cloud-app-running-now-empty"
            >
              {translator.translateText(RUNNING_NOW_EMPTY)}
            </p>
          ) : (
            <>
              <ul className="space-y-4" data-testid="cloud-app-running-now">
                {runningRevisions.map(
                  (entry: [string, number]): ReactElement => {
                    const [revision, count] = entry;
                    const share: number =
                      totalRunning > 0 ? (count / totalRunning) * 100 : 0;
                    const isCurrent: boolean =
                      revision === props.app.currentRevision;
                    const state: CloudAppRevisionState = isCurrent
                      ? CloudAppRevisionState.Current
                      : CloudAppRevisionState.Running;

                    return (
                      <li
                        key={revision}
                        data-testid="cloud-app-running-revision"
                        data-current={isCurrent ? "true" : "false"}
                      >
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="min-w-0 truncate font-mono text-gray-900"
                              title={revision}
                            >
                              <bdi>
                                {getShortRevision({
                                  revision,
                                  appName: props.app.name,
                                })}
                              </bdi>
                            </span>
                            <Pill
                              text={CLOUD_APP_REVISION_STATE_LABELS[state]}
                              color={CLOUD_APP_REVISION_STATE_COLORS[state]}
                            />
                          </span>
                          <span className="flex-shrink-0 text-gray-500">
                            {translator.translatePlural(
                              APP_INSTANCE_COUNT,
                              count,
                            )}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                          <div
                            className={`h-1.5 rounded-full ${
                              isCurrent ? "bg-emerald-500" : "bg-amber-400"
                            }`}
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
              {runningRevisions.length > 1 ? (
                <p
                  className="mt-4 text-sm text-gray-500"
                  data-testid="cloud-app-running-now-split"
                >
                  {translator.translateText(RUNNING_NOW_SPLIT)}
                </p>
              ) : (
                <></>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="Details" description={APP_DETAILS_DESCRIPTION}>
        <div className={ruledListClassName}>
          <dl
            className="divide-y divide-gray-200"
            data-testid="cloud-app-details"
          >
            {detailRows.map((row: AppDetailRow): ReactElement => {
              return (
                <div
                  key={row.key}
                  className="px-5 py-3 sm:grid sm:grid-cols-3 sm:gap-4 md:px-6"
                  data-testid="cloud-app-detail-row"
                  data-detail={row.key}
                >
                  {/*
                   * The label, and under it the attribute it is read from,
                   * quieter and on a line of its own: put beside the label
                   * in brackets it wrapped into the label's words ("Task
                   * definition revision (aws.ecs.task." over "revision)"),
                   * and on a Persian page into the label's Persian words.
                   */}
                  <dt className="text-sm font-medium text-gray-500">
                    <span
                      className="block [overflow-wrap:anywhere]"
                      data-testid="cloud-app-detail-label"
                    >
                      {row.label}
                    </span>
                    {row.attribute ? (
                      <span
                        className="mt-0.5 block text-xs font-normal text-gray-500 [overflow-wrap:anywhere]"
                        data-testid="cloud-app-detail-attribute"
                      >
                        {/*
                         * The font on the <bdi> itself: the Dashboard gives
                         * every element its sans font (index.ejs's * rule),
                         * so a bdi inside a font-mono box was drawn sans.
                         */}
                        <bdi className="font-mono">
                          <AttributeKey name={row.attribute} />
                        </bdi>
                      </span>
                    ) : (
                      <></>
                    )}
                  </dt>
                  <dd className={RESOURCE_OVERVIEW_DETAIL_VALUE_CLASS_NAME}>
                    <bdi className={row.mono ? "font-mono" : undefined}>
                      <BreakableName text={row.value} />
                    </bdi>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </Card>
    </div>
  );
};

export default CloudAppOverviewTab;
