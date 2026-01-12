import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallPolicyDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={OnCallDutyPolicy}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.ON_CALL_DUTY] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default OnCallPolicyDelete;
