import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/src/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/src/Utils/Navigation";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallScheduleDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={OnCallDutySchedule}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.ON_CALL_DUTY] as Route);
        }}
      />
    </Fragment>
  );
};

export default OnCallScheduleDelete;
