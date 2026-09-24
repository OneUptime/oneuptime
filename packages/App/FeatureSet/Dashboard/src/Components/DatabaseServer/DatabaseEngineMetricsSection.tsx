import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import ChartCard from "../TelemetryResource/ChartCard";
import {
  DatabaseEngineMetricResult,
  hasEngineMetricData,
} from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DatabaseEngineMetricsStatus,
  formatDatabaseMetricValue,
  getDatabaseEngineMetricsStatusLabel,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import { getDatabaseServerMetricId } from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Section 3 of a database's Overview: the engine's own metrics, from the
 * curated per-engine catalog (Types/DatabaseServer/DatabaseServerMetricCatalog).
 * Gauges show their latest value, counters a per-second rate computed
 * client-side. A database whose engine metrics never arrived gets a
 * "not connected" card pointing at its prefilled Documentation tab instead
 * of a wall of empty charts; a connected one with nothing to chart (a quiet
 * range, or an engine without a curated set) points at its Metrics tab.
 *
 * "Not connected" (no agent ever reported — gray, with the install guide)
 * and "Disconnected" (an agent reported, then stopped — red, with when it
 * last did) are different situations and read differently: a database found
 * from traces or containers is never told its agent "stopped reporting".
 */

export interface ComponentProps {
  modelId: ObjectID;
  engineLabel: string;
  status: DatabaseEngineMetricsStatus;
  // Whether the engine has a curated metric set at all.
  hasCatalog: boolean;
  // Whether an OpenTelemetry Collector receiver exists for the engine.
  hasCollectorReceiver: boolean;
  // When engine metrics last arrived (collectorLastSeenAt), if ever.
  lastReceivedAt?: Date | null | undefined;
  results: Array<DatabaseEngineMetricResult>;
  isLoading: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export const ENGINE_METRICS_NOT_CONNECTED_TITLE: string =
  "Engine metrics not connected";

// An agent reported once and has gone quiet.
export const ENGINE_METRICS_DISCONNECTED_TITLE: string =
  "Engine metrics disconnected";

/*
 * Connected, yet nothing to chart: no curated metric arrived in the range,
 * or the engine has no curated set at all. The agent is fine, so the card
 * points at the full Metrics tab rather than at the install guide.
 */
export const ENGINE_METRICS_NO_DATA_TITLE: string =
  "No engine metrics in this range";

const STATUS_PILL_CLASSES: Record<DatabaseEngineMetricsStatus, string> = {
  [DatabaseEngineMetricsStatus.Connected]: "bg-emerald-50 text-emerald-700",
  [DatabaseEngineMetricsStatus.Disconnected]: "bg-red-50 text-red-700",
  [DatabaseEngineMetricsStatus.NotConnected]: "bg-gray-100 text-gray-700",
};

/** The status chip every card of this section shows. */
export const EngineMetricsStatusPill: FunctionComponent<{
  status: DatabaseEngineMetricsStatus;
}> = (props: { status: DatabaseEngineMetricsStatus }): ReactElement => {
  return (
    <span
      data-testid="database-engine-metrics-status"
      data-status={props.status}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_PILL_CLASSES[props.status]
      }`}
    >
      <Icon icon={IconProp.Database} className="h-3 w-3" />
      {getDatabaseEngineMetricsStatusLabel(props.status)}
    </span>
  );
};

/**
 * What the "no engine metrics" card says for a database whose metrics are
 * not arriving: why, and what to do about it.
 */
export function getEngineMetricsMissingDescription(data: {
  status: DatabaseEngineMetricsStatus;
  engineLabel: string;
  hasCollectorReceiver: boolean;
  lastReceivedAt?: Date | null | undefined;
}): string {
  if (data.status === DatabaseEngineMetricsStatus.Disconnected) {
    const since: string = data.lastReceivedAt
      ? ` The last engine metrics arrived ${OneUptimeDate.getDateAsLocalFormattedString(
          data.lastReceivedAt,
        )}.`
      : "";
    return `The Database Agent (or OpenTelemetry Collector) that sent engine metrics for this ${data.engineLabel} database has stopped reporting.${since} Check that the agent is running, then its connection to the database.`;
  }

  if (data.hasCollectorReceiver) {
    return `Connections, throughput, cache hit ratio, locks and replication come from the ${data.engineLabel} engine itself, and no Database Agent or OpenTelemetry Collector has sent them for this database yet. Install the OneUptime Database Agent (or point your own OpenTelemetry Collector at it) to see them here.`;
  }

  return `There is no OpenTelemetry Collector receiver for ${data.engineLabel}, so this page shows what your applications report about it: the queries they send and the services that call it.`;
}

const DatabaseEngineMetricsSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION] as Route,
    { modelId: props.modelId },
  );
  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DATABASE_SERVER_VIEW_METRICS] as Route,
    { modelId: props.modelId },
  );

  if (props.isLoading) {
    return (
      <Card title="Engine metrics" description={props.engineLabel}>
        <ComponentLoader />
      </Card>
    );
  }

  const hasData: boolean = hasEngineMetricData(props.results);

  if (!hasData && props.status === DatabaseEngineMetricsStatus.Connected) {
    const description: string = props.hasCatalog
      ? `The Database Agent for this ${props.engineLabel} database is connected, but none of its overview metrics arrived in the selected range. Widen the range, or open Metrics to see everything it reports.`
      : `Engine metrics for this ${props.engineLabel} database are connected, but there is no curated overview for ${props.engineLabel} yet. Open Metrics to see everything it reports.`;

    return (
      <Card title={ENGINE_METRICS_NO_DATA_TITLE} description={description}>
        <div
          data-testid="database-engine-metrics-no-data"
          className="flex flex-wrap items-center gap-4"
        >
          <EngineMetricsStatusPill status={props.status} />
          <AppLink
            to={metricsRoute}
            className="text-sm font-medium text-indigo-600 hover:underline"
          >
            All metrics →
          </AppLink>
        </div>
      </Card>
    );
  }

  if (!hasData) {
    const isDisconnected: boolean =
      props.status === DatabaseEngineMetricsStatus.Disconnected;

    return (
      <Card
        title={
          isDisconnected
            ? ENGINE_METRICS_DISCONNECTED_TITLE
            : ENGINE_METRICS_NOT_CONNECTED_TITLE
        }
        description={getEngineMetricsMissingDescription({
          status: props.status,
          engineLabel: props.engineLabel,
          hasCollectorReceiver: props.hasCollectorReceiver,
          lastReceivedAt: props.lastReceivedAt,
        })}
      >
        <div
          data-testid={
            isDisconnected
              ? "database-engine-metrics-disconnected"
              : "database-engine-metrics-not-connected"
          }
          className="flex flex-wrap items-center gap-4"
        >
          <EngineMetricsStatusPill status={props.status} />
          {props.hasCollectorReceiver ? (
            <AppLink
              to={documentationRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              {isDisconnected
                ? "Check the agent setup →"
                : "Install the Database Agent →"}
            </AppLink>
          ) : (
            <></>
          )}
        </div>
      </Card>
    );
  }

  const charted: Array<DatabaseEngineMetricResult> = props.results.filter(
    (result: DatabaseEngineMetricResult): boolean => {
      return result.series.length > 0;
    },
  );

  return (
    <div data-testid="database-engine-metrics">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-900">
            Engine metrics
          </h2>
          {/*
           * Charts from an agent that has since stopped are history: say so.
           * (Data with no collector sighting at all is not an agent's to
           * judge, so it gets no pill.)
           */}
          {props.status === DatabaseEngineMetricsStatus.Disconnected ? (
            <EngineMetricsStatusPill status={props.status} />
          ) : (
            <></>
          )}
        </div>
        <AppLink
          to={metricsRoute}
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          All metrics →
        </AppLink>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {props.results.map(
          (result: DatabaseEngineMetricResult): ReactElement => {
            return (
              <div
                key={`tile-${getDatabaseServerMetricId(result.definition)}`}
                data-testid="database-engine-metric-tile"
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-xs font-medium uppercase tracking-wider text-gray-500">
                    {result.definition.title}
                  </span>
                  <InfoTooltip
                    label={result.definition.title}
                    text={result.definition.description}
                  />
                </div>
                <div className="mt-2 text-xl font-semibold text-gray-900">
                  {formatDatabaseMetricValue(
                    result.value,
                    result.definition.unit,
                    result.definition.kind,
                  )}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-gray-400">
                  {result.definition.metricName}
                </div>
              </div>
            );
          },
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {charted.map((result: DatabaseEngineMetricResult): ReactElement => {
          return (
            <ChartCard
              key={`chart-${getDatabaseServerMetricId(result.definition)}`}
              title={
                result.definition.kind === "counter"
                  ? `${result.definition.title} (per second)`
                  : result.definition.title
              }
              description={result.definition.description}
              icon={IconProp.ChartBar}
              iconColor="violet"
              series={
                [
                  {
                    seriesName: result.definition.title,
                    data: result.series,
                  },
                ] as Array<SeriesPoint>
              }
              windowStart={props.windowStart}
              windowEnd={props.windowEnd}
              syncId={`database-${props.modelId.toString()}`}
              yFormatter={(value: number): string => {
                return formatDatabaseMetricValue(
                  value,
                  result.definition.unit,
                  result.definition.kind,
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default DatabaseEngineMetricsSection;
