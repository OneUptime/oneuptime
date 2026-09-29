import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Deleting a DISCOVERED database does not make it go away: the next time a
 * trace, a workload scan or the Database Agent sees its endpoint, discovery
 * creates it again. The copy says so and points at archiving, which is what
 * actually dismisses it (and what the auto-archive sweep undoes only for
 * rows it archived itself).
 */
export const DATABASE_DELETE_WARNING: string =
  "A database discovered from application traces, Kubernetes, Docker, Podman or the Database Agent comes back the next time it is seen, with a new id and without its labels, owners and history. To hide a database you no longer care about, archive it instead (Settings → Archive).";

const DatabaseServerDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <Alert
        type={AlertType.WARNING}
        strongTitle="Discovered databases come back."
        title={DATABASE_DELETE_WARNING}
        className="mb-5"
        dataTestId="database-delete-warning"
      />
      <ModelDelete
        modelType={DatabaseServer}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATABASE_SERVERS] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default DatabaseServerDelete;
