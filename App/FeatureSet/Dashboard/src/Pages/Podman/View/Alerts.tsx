import Includes from "Common/Types/BaseDatabase/Includes";
import AlertsTable from "../../../Components/Alert/AlertsTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

const PodmanHostAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.podmanHosts = new Includes([modelId]);
  }

  return (
    <Fragment>
      <AlertsTable query={query} />
    </Fragment>
  );
};

export default PodmanHostAlerts;
