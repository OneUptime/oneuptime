import UserOverrideTable from "../../../Components/OnCallPolicy/UserOverrides/UserOverrideTable";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import RouteParams from "../../../Utils/RouteParams";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = new ObjectID(
    Navigation.getParamByName(
      RouteParams.ModelID,
      RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]! as Route,
    ) as string,
  );

  return <UserOverrideTable onCallDutyPolicyId={modelId} />;
};

export default Settings;
