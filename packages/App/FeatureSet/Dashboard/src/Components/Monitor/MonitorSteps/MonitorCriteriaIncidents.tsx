import MonitorCriteriaIncident from "./MonitorCriteriaIncident";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incidents: Array<CriteriaIncident>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

const MonitorCriteriaIncidentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-4 ml-5">
      {props.incidents.map((i: CriteriaIncident, index: number) => {
        return (
          <MonitorCriteriaIncident
            key={index}
            onCallPolicyOptions={props.onCallPolicyOptions}
            incidentSeverityOptions={props.incidentSeverityOptions}
            labelOptions={props.labelOptions}
            teamOptions={props.teamOptions}
            userOptions={props.userOptions}
            incidentRoleOptions={props.incidentRoleOptions}
            incident={i}
          />
        );
      })}
    </div>
  );
};

export default MonitorCriteriaIncidentsForm;
