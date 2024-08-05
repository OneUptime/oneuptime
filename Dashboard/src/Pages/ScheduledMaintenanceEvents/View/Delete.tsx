import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={ScheduledMaintenance}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default IncidentDelete;
