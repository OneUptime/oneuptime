import Includes from "Common/Types/BaseDatabase/Includes";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import { CreateFromRecordKind } from "../../../Components/CreateFromRecord/CreateFromRecord";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * A cloud resource's alerts: the ones linked to it, by a person or by the
 * monitor that watches it, with Create Alert keeping the resource picked.
 */
const CloudResourceAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.cloudResources = new Includes([modelId]);
  }

  return (
    <Fragment>
      <AlertsTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.CloudResource, id: modelId }}
      />
    </Fragment>
  );
};

export default CloudResourceAlerts;
