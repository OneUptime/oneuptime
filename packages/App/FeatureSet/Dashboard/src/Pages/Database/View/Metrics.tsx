import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useState,
} from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import {
  FetchMetricRowValueOverrides,
  MetricRowValueOverride,
  MetricRowValueOverrideMap,
} from "../../../Components/Metrics/Utils/MetricRowScope";
import DatabaseMetricChartModal from "../../../Components/DatabaseServer/DatabaseMetricChartModal";
import DatabaseServerUnscopedBanner from "../../../Components/DatabaseServer/DatabaseServerUnscopedBanner";
import useDatabaseServerTelemetryScope, {
  UseDatabaseServerTelemetryScopeResult,
} from "../../../Components/DatabaseServer/useDatabaseServerTelemetryScope";
import { isDatabaseServerScoped } from "../Utils/DatabaseTelemetryScope";
import {
  DatabaseMetricListValue,
  DatabaseTimePoint,
  fetchDatabaseMetricListValues,
  getDatabaseMetricRowUnit,
  getDatabaseMetricsRangeFromSearch,
} from "../Utils/DatabaseServerTelemetryQueries";

/*
 * The caption under a row the catalog does not know: the list's generic
 * value, the average of every series of the metric per bucket.
 */
export const DATABASE_METRIC_LIST_DEFAULT_CAPTION: string = "average of series";

/** The catalog list values as the metric list's row overrides. */
export function toMetricRowValueOverrides(
  values: Map<string, DatabaseMetricListValue>,
): MetricRowValueOverrideMap {
  const overrides: MetricRowValueOverrideMap = new Map();
  for (const [metricName, listValue] of values) {
    const override: MetricRowValueOverride = {
      points: listValue.points.map(
        (point: DatabaseTimePoint): { time: string; value: number } => {
          return { time: point.x.toISOString(), value: point.y };
        },
      ),
      value: listValue.value,
      valueSuffix: listValue.isRate ? "/s" : undefined,
      caption: listValue.caption,
    };
    overrides.set(metricName, override);
  }
  return overrides;
}

/*
 * The database's metrics: engine metrics from the Database Agent or your
 * collector's receiver (endpoint key), db.client.* metrics your
 * applications report about it (endpoint key) and the CPU / memory of the
 * pods / containers it runs as (member keys).
 *
 * A row click charts the metric in place with the same key set: the metric
 * explorer the viewer opens by default scopes by attributes only, so it
 * would chart the metric across the whole project. The chart opens on the
 * range the list is showing, and gets the metric's unit so its values read
 * in it — and the database's id, which its "Create monitor" scopes the
 * monitor by (the explorer's own create-monitor action is not reachable
 * from here).
 */

interface SelectedMetric {
  name: string;
  unit: string;
}

const DatabaseServerMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [selectedMetric, setSelectedMetric] = useState<SelectedMetric | null>(
    null,
  );

  // What the list shows: its URL range on load, then whatever is picked.
  const [listRange, setListRange] = useState<RangeStartAndEndDateTime>(
    (): RangeStartAndEndDateTime => {
      return getDatabaseMetricsRangeFromSearch(
        typeof window === "undefined" ? "" : window.location.search,
      );
    },
  );

  const {
    keys,
    entityKeyDisplays,
    isIdOnly,
    isLoading,
    error,
    databaseServer,
  }: UseDatabaseServerTelemetryScopeResult =
    useDatabaseServerTelemetryScope(modelId);

  const projectId: ObjectID | null =
    databaseServer?.projectId || ProjectUtil.getCurrentProjectId();
  const dbSystem: string | undefined = databaseServer?.dbSystem;

  /*
   * A catalog metric's row reads as its Overview tile does — combined across
   * its series, a counter as a per-second rate — instead of the list's
   * average of every series (see fetchDatabaseMetricListValues). Stable
   * while the scope is, so the list does not refetch on every render.
   */
  const fetchRowValueOverrides: FetchMetricRowValueOverrides = useCallback(
    async (data: {
      metricNames: Array<string>;
      startAndEndDate: InBetween<Date>;
    }): Promise<MetricRowValueOverrideMap> => {
      const values: Map<string, DatabaseMetricListValue> =
        await fetchDatabaseMetricListValues({
          projectId: projectId,
          keys: keys,
          start: data.startAndEndDate.startValue,
          end: data.startAndEndDate.endValue,
          dbSystem: dbSystem,
          metricNames: data.metricNames,
        });
      return toMetricRowValueOverrides(values);
    },
    [keys, projectId?.toString(), dbSystem],
  );

  /*
   * A row whose engine reports the metric in another unit than it declares
   * (MariaDB's mysql.buffer_pool.limit is a page count) reads in that unit,
   * whether its value is the catalog's or the list's own average.
   */
  const getRowValueUnit: (metricName: string) => string | undefined =
    useCallback(
      (metricName: string): string | undefined => {
        return getDatabaseMetricRowUnit(dbSystem, metricName);
      },
      [dbSystem],
    );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!databaseServer) {
    return <ErrorMessage message="Database not found." />;
  }

  /*
   * No keys means no scope, and the viewer would fall back to every metric
   * in the project. Show what is actually true instead. (A loaded row always
   * has its row key, so this is a defensive guard; a row with ONLY its row
   * key gets the viewer plus an "id only" hint.)
   */
  if (!isDatabaseServerScoped(keys)) {
    return <DatabaseServerUnscopedBanner modelId={modelId} signal="metrics" />;
  }

  return (
    <Fragment>
      {isIdOnly ? (
        <div className="mb-4">
          <DatabaseServerUnscopedBanner
            modelId={modelId}
            signal="metrics"
            variant="id-only"
          />
        </div>
      ) : (
        <></>
      )}
      <MetricsViewer
        entityKeysFilter={keys}
        entityKeyDisplays={entityKeyDisplays}
        fetchRowValueOverrides={fetchRowValueOverrides}
        defaultRowValueCaption={DATABASE_METRIC_LIST_DEFAULT_CAPTION}
        getRowValueUnit={getRowValueUnit}
        onTimeRangeChange={(range: RangeStartAndEndDateTime): void => {
          setListRange(range);
        }}
        onMetricClick={(metric: MetricType): void => {
          const name: string = (metric.name || "").trim();
          setSelectedMetric(
            name ? { name: name, unit: (metric.unit || "").trim() } : null,
          );
        }}
      />
      {selectedMetric ? (
        <DatabaseMetricChartModal
          key={selectedMetric.name}
          metricName={selectedMetric.name}
          unit={selectedMetric.unit}
          keys={keys}
          projectId={
            databaseServer.projectId || ProjectUtil.getCurrentProjectId()
          }
          dbSystem={databaseServer.dbSystem}
          databaseServerId={modelId}
          databaseName={databaseServer.name}
          initialTimeRange={listRange}
          onClose={(): void => {
            setSelectedMetric(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default DatabaseServerMetrics;
