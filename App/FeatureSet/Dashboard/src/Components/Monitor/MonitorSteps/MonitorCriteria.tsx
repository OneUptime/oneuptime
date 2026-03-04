import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import Text from "Common/Types/Text";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  monitorCriteria: MonitorCriteria;
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<IncidentSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-4">
      <ul role="list" className="space-y-6">
        {props.monitorCriteria.data?.monitorCriteriaInstanceArray.map(
          (i: MonitorCriteriaInstance, index: number) => {
            return (
              <li className="relative flex gap-x-4" key={index}>
                <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                  <div className="w-px bg-slate-200"></div>
                </div>
                <div className="relative flex h-6 w-6 flex-none items-center justify-center bg-white">
                  <div className="h-1.5 w-1.5 rounded-full bg-slate-100 ring-1 ring-slate-300"></div>
                </div>

                <div className="flex-auto py-0.5 text-sm leading-5 text-gray-500">
                  <span className="font-medium text-gray-900">
                    {i.data?.name || "Criteria"}
                  </span>{" "}
                  This criteria will be checked{" "}
                  {Text.convertNumberToWords(index + 1)}.
                  <div className="mt-10 mb-10" key={index}>
                    <MonitorCriteriaInstanceElement
                      monitorStatusOptions={props.monitorStatusOptions}
                      onCallPolicyOptions={props.onCallPolicyOptions}
                      incidentSeverityOptions={props.incidentSeverityOptions}
                      alertSeverityOptions={props.alertSeverityOptions}
                      labelOptions={props.labelOptions}
                      teamOptions={props.teamOptions}
                      userOptions={props.userOptions}
                      incidentRoleOptions={props.incidentRoleOptions}
                      monitorCriteriaInstance={i}
                      isLastCriteria={
                        index ===
                        (props.monitorCriteria.data
                          ?.monitorCriteriaInstanceArray.length || 1) -
                          1
                      }
                    />
                  </div>
                </div>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default MonitorCriteriaElement;
