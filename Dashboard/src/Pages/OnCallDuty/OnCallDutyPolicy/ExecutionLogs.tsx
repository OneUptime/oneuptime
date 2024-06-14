import ExecutionLogsTable from "../../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import RouteParams from "../../../Utils/RouteParams";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = new ObjectID(
    Navigation.getParamByName(
      RouteParams.ModelID,
      RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]! as Route,
    ) as string,
  );

  return <ExecutionLogsTable onCallDutyPolicyId={modelId} />;
};

export default Settings;
