import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MonitorIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <IncidentsTable
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
          monitors: [modelId.toString()],
        }}
        createInitialValues={{
          monitors: [modelId.toString()],
        }}
      />
    </Fragment>
  );
};

export default MonitorIncidents;
