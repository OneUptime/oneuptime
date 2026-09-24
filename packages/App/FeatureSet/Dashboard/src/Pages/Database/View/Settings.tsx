import PageComponentProps from "../../PageComponentProps";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { useParams } from "react-router-dom";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A database's retention governs only what is stored AS this database: the
 * engine metrics and logs its collector / Database Agent sends (ingest makes
 * the database their primary entity). The query spans applications send it
 * belong to the calling service and keep that service's retention, so the
 * page says which telemetry the setting covers before offering it.
 */
export const DATABASE_RETENTION_SCOPE_NOTE: string =
  "These settings apply to the engine metrics and logs collected from this database by the Database Agent or your OpenTelemetry Collector. The traces of the queries your applications send it belong to the calling services and follow their retention.";

const DatabaseServerSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <Fragment>
      <Alert
        type={AlertType.INFO}
        strongTitle="Which telemetry this covers."
        title={DATABASE_RETENTION_SCOPE_NOTE}
        className="mb-5"
        dataTestId="database-retention-scope-note"
      />
      <TelemetryResourceRetentionSettings<DatabaseServer>
        modelType={DatabaseServer}
        modelId={modelId}
        resourceName="database"
        modelDetailIdPrefix="database-server"
      />
      <ArchiveResourceCard<DatabaseServer>
        modelType={DatabaseServer}
        modelId={modelId}
        singularName="database"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DATABASE_SERVERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default DatabaseServerSettings;
