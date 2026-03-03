import AlertsTable from "../../../Components/Alert/AlertsTable";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";

const MonitorAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.monitor = modelId;
  }

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <AlertsTable
        query={query}
        createInitialValues={{
          monitor: modelId,
        }}
      />
    </Fragment>
  );
};

export default MonitorAlerts;
