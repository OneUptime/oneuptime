import AlertsTable from "../../../Components/Alert/AlertsTable";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Alert from "Common/Models/DatabaseModels/Alert";
import Query from "Common/Types/BaseDatabase/Query";

const MonitorAlerts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<Alert> = {
    projectId: DashboardNavigation.getProjectId()!,
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
