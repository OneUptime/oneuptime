import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import DatabaseMetricChartModal from "../../../Components/DatabaseServer/DatabaseMetricChartModal";
import DatabaseServerUnscopedBanner from "../../../Components/DatabaseServer/DatabaseServerUnscopedBanner";
import useDatabaseServerTelemetryScope, {
  UseDatabaseServerTelemetryScopeResult,
} from "../../../Components/DatabaseServer/useDatabaseServerTelemetryScope";
import { isDatabaseServerScoped } from "../Utils/DatabaseTelemetryScope";
import { getDatabaseMetricsRangeFromSearch } from "../Utils/DatabaseServerTelemetryQueries";

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
 * in it.
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
    isLoading,
    error,
    databaseServer,
  }: UseDatabaseServerTelemetryScopeResult =
    useDatabaseServerTelemetryScope(modelId);

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
   * in the project. Show what is actually true instead.
   */
  if (!isDatabaseServerScoped(keys)) {
    return <DatabaseServerUnscopedBanner modelId={modelId} signal="metrics" />;
  }

  return (
    <Fragment>
      <MetricsViewer
        entityKeysFilter={keys}
        entityKeyDisplays={entityKeyDisplays}
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
