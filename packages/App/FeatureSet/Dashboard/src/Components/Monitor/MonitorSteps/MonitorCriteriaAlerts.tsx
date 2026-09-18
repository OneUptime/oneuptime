import MonitorCriteriaAlert from "./MonitorCriteriaAlert";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  alerts: Array<CriteriaAlert>;
  alertSeverityOptions: Array<AlertSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
}

const MonitorCriteriaAlertsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-4 ml-5">
      {props.alerts.map((i: CriteriaAlert, index: number) => {
        return (
          <MonitorCriteriaAlert
            key={index}
            onCallPolicyOptions={props.onCallPolicyOptions}
            alertSeverityOptions={props.alertSeverityOptions}
            labelOptions={props.labelOptions}
            teamOptions={props.teamOptions}
            userOptions={props.userOptions}
            alert={i}
          />
        );
      })}
    </div>
  );
};

export default MonitorCriteriaAlertsForm;
