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
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Section 3 of a database's Overview: the engine's own metrics, from the
 * curated per-engine catalog (Types/DatabaseServer/DatabaseServerMetricCatalog).
 * Gauges show their latest value, counters a per-second rate computed
 * client-side. A database whose engine metrics never arrived gets a
 * "not connected" card pointing at its prefilled Documentation tab instead
 * of a wall of empty charts.
 */

export interface ComponentProps {
  modelId: ObjectID;
  engineLabel: string;
  status: DatabaseEngineMetricsStatus;
  // Whether the engine has a curated metric set at all.
  hasCatalog: boolean;
  // Whether an OpenTelemetry Collector receiver exists for the engine.
  hasCollectorReceiver: boolean;
  results: Array<DatabaseEngineMetricResult>;
  isLoading: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export const ENGINE_METRICS_NOT_CONNECTED_TITLE: string =
  "Engine metrics not connected";

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

  if (!hasData) {
    const description: string =
      props.status === DatabaseEngineMetricsStatus.Disconnected
        ? `The Database Agent for this ${props.engineLabel} database stopped reporting. Check the agent, then its connection to the database.`
        : props.hasCollectorReceiver
          ? `Connections, throughput, cache hit ratio, locks and replication come from the ${props.engineLabel} engine itself. Install the OneUptime Database Agent (or point your own OpenTelemetry Collector at it) to see them here.`
          : `There is no OpenTelemetry Collector receiver for ${props.engineLabel}, so this page shows what your applications report about it: the queries they send and the services that call it.`;

    return (
      <Card
        title={ENGINE_METRICS_NOT_CONNECTED_TITLE}
        description={description}
      >
        <div
          data-testid="database-engine-metrics-not-connected"
          className="flex flex-wrap items-center gap-4"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            <Icon icon={IconProp.Database} className="h-3 w-3" />
            {getDatabaseEngineMetricsStatusLabel(props.status)}
          </span>
          {props.hasCollectorReceiver ? (
            <AppLink
              to={documentationRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              Connect engine metrics →
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
        <h2 className="text-base font-semibold text-gray-900">
          Engine metrics
        </h2>
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
                key={`tile-${result.definition.metricName}`}
                data-testid="database-engine-metric-tile"
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                title={result.definition.description}
              >
                <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  {result.definition.title}
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
              key={`chart-${result.definition.metricName}`}
              title={
                result.definition.kind === "counter"
                  ? `${result.definition.title} (per second)`
                  : result.definition.title
              }
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
