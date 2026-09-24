import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";
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

/*
 * The database's metrics: engine metrics from the Database Agent or your
 * collector's receiver (endpoint key), db.client.* metrics your
 * applications report about it (endpoint key) and the CPU / memory of the
 * pods / containers it runs as (member keys).
 *
 * A row click charts the metric in place with the same key set: the metric
 * explorer the viewer opens by default scopes by attributes only, so it
 * would chart the metric across the whole project.
 */
const DatabaseServerMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [selectedMetricName, setSelectedMetricName] = useState<string>("");

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
        onMetricClick={(metric: MetricType): void => {
          setSelectedMetricName((metric.name || "").trim());
        }}
      />
      {selectedMetricName ? (
        <DatabaseMetricChartModal
          key={selectedMetricName}
          metricName={selectedMetricName}
          keys={keys}
          projectId={
            databaseServer.projectId || ProjectUtil.getCurrentProjectId()
          }
          dbSystem={databaseServer.dbSystem}
          onClose={(): void => {
            setSelectedMetricName("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default DatabaseServerMetrics;
