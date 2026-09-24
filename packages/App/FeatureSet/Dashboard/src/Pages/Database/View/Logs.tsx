import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import DatabaseServerUnscopedBanner from "../../../Components/DatabaseServer/DatabaseServerUnscopedBanner";
import useDatabaseServerTelemetryScope, {
  UseDatabaseServerTelemetryScopeResult,
} from "../../../Components/DatabaseServer/useDatabaseServerTelemetryScope";
import {
  getDatabaseServerEntityKeysQueryValue,
  isDatabaseServerScoped,
} from "../Utils/DatabaseTelemetryScope";

/*
 * The database's logs: every log row stamped with one of its entity keys —
 * the engine's own logs and query samples from the Database Agent (endpoint
 * key) and the logs of the pods / containers it runs as (member keys).
 */
const DatabaseServerLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const {
    keys,
    entityKeyDisplays,
    isIdOnly,
    isLoading,
    error,
    databaseServer,
  }: UseDatabaseServerTelemetryScopeResult =
    useDatabaseServerTelemetryScope(modelId);

  /*
   * Null for an empty key set: an empty Includes drops the predicate and
   * would show the whole project's logs as this database's. (A loaded row
   * always has its row key, so the banner below is a defensive guard; a row
   * with ONLY its row key gets the viewer plus an "id only" hint.)
   */
  const logQuery: Query<Log> | null = useMemo(() => {
    const entityKeys: Includes | null =
      getDatabaseServerEntityKeysQueryValue(keys);
    if (!entityKeys) {
      return null;
    }
    return { entityKeys: entityKeys } as Query<Log>;
  }, [keys]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!databaseServer) {
    return <ErrorMessage message="Database not found." />;
  }

  if (!isDatabaseServerScoped(keys) || !logQuery) {
    return <DatabaseServerUnscopedBanner modelId={modelId} signal="logs" />;
  }

  return (
    <Fragment>
      {isIdOnly ? (
        <div className="mb-4">
          <DatabaseServerUnscopedBanner
            modelId={modelId}
            signal="logs"
            variant="id-only"
          />
        </div>
      ) : (
        <></>
      )}
      <DashboardLogsViewer
        id={`database-server-logs-${modelId.toString()}`}
        logQuery={logQuery}
        entityKeyDisplays={entityKeyDisplays}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this database."
      />
    </Fragment>
  );
};

export default DatabaseServerLogs;
