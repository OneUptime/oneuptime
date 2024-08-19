import Includes from "Common/Types/BaseDatabase/Includes";
import IncidentsTable from "../../../Components/Incident/IncidentsTable";
import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Incident from "Common/Models/DatabaseModels/Incident";
import Query from "Common/Types/BaseDatabase/Query";

const MonitorIncidents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  let query: Query<Incident> = {
    projectId: DashboardNavigation.getProjectId()!
  };

  if(modelId) {
    query.monitors = new Includes([modelId]);
  }

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      <IncidentsTable
        query={query}
        createInitialValues={{
          monitors: [modelId.toString()],
        }}
      />
    </Fragment>
  );
};

export default MonitorIncidents;
