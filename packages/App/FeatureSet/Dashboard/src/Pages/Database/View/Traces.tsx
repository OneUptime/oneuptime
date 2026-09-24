import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import DatabaseServerUnscopedBanner from "../../../Components/DatabaseServer/DatabaseServerUnscopedBanner";
import useDatabaseServerTelemetryScope, {
  UseDatabaseServerTelemetryScopeResult,
} from "../../../Components/DatabaseServer/useDatabaseServerTelemetryScope";
import { isDatabaseServerScoped } from "../Utils/DatabaseTelemetryScope";

/*
 * The database's traces: the query spans your applications send it (each
 * CLIENT span that names one of its endpoints carries that endpoint's key)
 * plus any spans from the pods / containers it runs as.
 */
const DatabaseServerTraces: FunctionComponent<
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
   * No keys means no scope, and the viewer would fall back to every trace
   * in the project. Show what is actually true instead.
   */
  if (!isDatabaseServerScoped(keys)) {
    return <DatabaseServerUnscopedBanner modelId={modelId} signal="traces" />;
  }

  return (
    <Fragment>
      <TracesViewer
        entityKeysFilter={keys}
        entityKeyDisplays={entityKeyDisplays}
      />
    </Fragment>
  );
};

export default DatabaseServerTraces;
