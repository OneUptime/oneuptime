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
  formatDatabaseMetricAxisValue,
  formatDatabaseMetricValue,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseMetricAxisUnitLabel,
  getDatabaseUnitSingular,
} from "../../Pages/Database/Utils/DatabaseServerPresentation";
import { DatabaseAgentEngine } from "../../Pages/Database/Utils/DatabaseAgentConfigs";
import {
  getDatabaseAgentCollectedMetricsText,
  getDatabaseAgentEngine,
} from "../../Pages/Database/Utils/DocumentationMarkdown";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetricId,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import {
  DatabaseEngineMetricsSource,
  getDatabaseEngineMetricsSource,
} from "Common/Types/DatabaseServer/DatabaseSystem";
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
 *
 * What "not connected" suggests follows where the engine's metrics come
 * from (DatabaseSystem's getDatabaseEngineMetricsSource), the same source
 * the Documentation tab builds its guide from: the Database Agent for an
 * engine it ships a config for, a ready-made collector config for any other
 * receiver, Prometheus endpoint, cloud monitoring API or custom exporter —
 * and nothing to connect only for an engine that runs inside the
 * application's own process.
 */

export interface ComponentProps {
  modelId: ObjectID;
  engineLabel: string;
  status: DatabaseEngineMetricsStatus;
  // Whether the engine has a curated metric set at all.
  hasCatalog: boolean;
  // The row's engine: decides how its engine metrics are connected.
  dbSystem?: string | null | undefined;
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

/*
 * Connected, and the engine has no curated overview at all (Memcached,
 * Elasticsearch / OpenSearch while their catalogs are missing): its metrics
 * DO arrive — "no engine metrics in this range" said the opposite.
 */
export const ENGINE_METRICS_NO_CURATED_OVERVIEW_TITLE: string =
  "Engine metrics connected";

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

// The Documentation-tab link for an engine connected by a collector config.
export const ENGINE_METRICS_CONNECT_LINK_LABEL: string =
  "Connect engine metrics →";

export const ENGINE_METRICS_INSTALL_AGENT_LINK_LABEL: string =
  "Install the Database Agent →";

export const ENGINE_METRICS_CHECK_AGENT_LINK_LABEL: string =
  "Check the agent setup →";

/**
 * An engine chart's title. The axis ticks of a metric counted in a unit
 * word carry the number alone (formatDatabaseMetricAxisValue), so the title
 * says the unit, once: a counter's "(per second)", and a gauge's unit word
 * in brackets unless its title already names it — "Connections" stays
 * "Connections", "Buffer pool size" in pages reads "Buffer pool size
 * (pages)".
 */
export function getDatabaseEngineMetricChartTitle(
  definition: Pick<DatabaseServerMetricDefinition, "title" | "unit" | "kind">,
): string {
  if (definition.kind === "counter") {
    return `${definition.title} (per second)`;
  }
  const unitLabel: string = getDatabaseMetricAxisUnitLabel(definition.unit);
  const title: string = definition.title.toLowerCase();
  if (
    !unitLabel ||
    title.includes(unitLabel.toLowerCase()) ||
    title.includes(getDatabaseUnitSingular(unitLabel).toLowerCase())
  ) {
    return definition.title;
  }
  return `${definition.title} (${unitLabel})`;
}

export interface EngineMetricsGuidance {
  // Why the metrics are missing, and what to do about it.
  description: string;
  // The Documentation-tab link, or null when there is nothing to set up.
  linkLabel: string | null;
}

/*
 * What the engine's own metrics are. For an engine the Database Agent ships
 * a config for, the per-engine list its Documentation tab opens with:
 * Memcached has no locks or replication, Elasticsearch no replication lag.
 * Any other engine gets the generic words.
 */
function whatEngineMetricsAre(
  engine: string,
  dbSystem: string | null | undefined,
): string {
  const agentEngine: DatabaseAgentEngine | null =
    getDatabaseAgentEngine(dbSystem);
  if (agentEngine) {
    return `Engine metrics — ${getDatabaseAgentCollectedMetricsText(
      agentEngine,
    )} — come from the ${engine} engine itself`;
  }
  return `Connections, throughput, cache hit ratio, locks and replication come from the ${engine} engine itself`;
}

/**
 * What the "no engine metrics" card says for a database whose metrics are
 * not arriving — why, and what to do about it — and which link it offers.
 */
export function getEngineMetricsGuidance(data: {
  status: DatabaseEngineMetricsStatus;
  engineLabel: string;
  dbSystem?: string | null | undefined;
  lastReceivedAt?: Date | null | undefined;
}): EngineMetricsGuidance {
  const engine: string = data.engineLabel;

  if (data.status === DatabaseEngineMetricsStatus.Disconnected) {
    const since: string = data.lastReceivedAt
      ? ` The last engine metrics arrived ${OneUptimeDate.getDateAsLocalFormattedString(
          data.lastReceivedAt,
        )}.`
      : "";
    return {
      description: `The Database Agent (or OpenTelemetry Collector) that sent engine metrics for this ${engine} database has stopped reporting.${since} Check that the agent is running, then its connection to the database.`,
      linkLabel: ENGINE_METRICS_CHECK_AGENT_LINK_LABEL,
    };
  }

  const source: DatabaseEngineMetricsSource = getDatabaseEngineMetricsSource(
    data.dbSystem,
  );

  switch (source.kind) {
    case "embedded":
      return {
        description: `${engine} runs inside your application's process, so there is no database server to collect engine metrics from. This page shows what your applications report about it: the queries they send and the services that call it.`,
        linkLabel: null,
      };
    case "receiver":
      if (getDatabaseAgentEngine(data.dbSystem)) {
        return {
          description: `${whatEngineMetricsAre(engine, data.dbSystem)}, and no Database Agent or OpenTelemetry Collector has sent them for this database yet. Install the OneUptime Database Agent (or point your own OpenTelemetry Collector at it) to see them here.`,
          linkLabel: ENGINE_METRICS_INSTALL_AGENT_LINK_LABEL,
        };
      }
      return {
        description: `${whatEngineMetricsAre(engine, data.dbSystem)}, and no OpenTelemetry Collector has sent them for this database yet. The collector has a receiver for ${engine}: the Documentation tab has a ready-made collector config that sends its metrics here.`,
        linkLabel: ENGINE_METRICS_CONNECT_LINK_LABEL,
      };
    case "prometheus":
      return {
        description: `The OpenTelemetry Collector has no dedicated receiver for ${engine}, but ${engine} serves Prometheus metrics itself, so its engine metrics can still be collected: the Documentation tab has a ready-made collector config that scrapes them and sends them here.`,
        linkLabel: ENGINE_METRICS_CONNECT_LINK_LABEL,
      };
    case "cloud-monitoring":
      return {
        description: `${engine} is a managed service: its engine metrics come from the provider's monitoring API, not from a connection to the database. The Documentation tab shows how to bring them into a collector and attach them to this database.`,
        linkLabel: ENGINE_METRICS_CONNECT_LINK_LABEL,
      };
    default:
      return {
        description: `The OpenTelemetry Collector has no ready-made receiver for ${engine}, but its metrics can still be collected: the Documentation tab explains the options and has the collector config that attaches them to this database.`,
        linkLabel: ENGINE_METRICS_CONNECT_LINK_LABEL,
      };
  }
}

/**
 * The description half of getEngineMetricsGuidance, for callers that only
 * need the words.
 */
export function getEngineMetricsMissingDescription(data: {
  status: DatabaseEngineMetricsStatus;
  engineLabel: string;
  dbSystem?: string | null | undefined;
  lastReceivedAt?: Date | null | undefined;
}): string {
  return getEngineMetricsGuidance(data).description;
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
      <Card
        title={
          props.hasCatalog
            ? ENGINE_METRICS_NO_DATA_TITLE
            : ENGINE_METRICS_NO_CURATED_OVERVIEW_TITLE
        }
        description={description}
      >
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
    const guidance: EngineMetricsGuidance = getEngineMetricsGuidance({
      status: props.status,
      engineLabel: props.engineLabel,
      dbSystem: props.dbSystem,
      lastReceivedAt: props.lastReceivedAt,
    });

    return (
      <Card
        title={
          isDisconnected
            ? ENGINE_METRICS_DISCONNECTED_TITLE
            : ENGINE_METRICS_NOT_CONNECTED_TITLE
        }
        description={guidance.description}
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
          {guidance.linkLabel ? (
            <AppLink
              to={documentationRoute}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              {guidance.linkLabel}
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
              title={getDatabaseEngineMetricChartTitle(result.definition)}
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
                return formatDatabaseMetricAxisValue(
                  value,
                  result.definition.unit,
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
