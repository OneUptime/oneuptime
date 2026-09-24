import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
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
 */
const DatabaseServerMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

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
      />
    </Fragment>
  );
};

export default DatabaseServerMetrics;
