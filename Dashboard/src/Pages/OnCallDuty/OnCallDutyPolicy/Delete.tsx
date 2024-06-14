import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import OnCallDutyPolicy from "Model/Models/OnCallDutyPolicy";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const OnCallPolicyDelete: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelDelete
        modelType={OnCallDutyPolicy}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.ON_CALL_DUTY] as Route);
        }}
      />
    </Fragment>
  );
};

export default OnCallPolicyDelete;
