import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleConditionElement from "./NotificationRuleViewCondition";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";

export interface ComponentProps {
  criteriaFilters: Array<NotificationRuleCondition>;
  filterCondition: FilterCondition;
  eventType: NotificationRuleEventType;
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  monitorStatus: Array<MonitorStatus>;
}

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      <div className="text-gray-700 text-sm py-2">
        This rule will be executed if
        <span className="font-semibold">
          &nbsp;{props.filterCondition?.toLowerCase() || "any"} &nbsp;
        </span>
        of the following conditions are met:
      </div>

      <div className="ml-3 mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
        <ul role="list" className="space-y-6">
          {(props.criteriaFilters || []).map(
            (i: NotificationRuleCondition, index: number) => {
              const isLastItem: boolean =
                index === props.criteriaFilters.length - 1;
              return (
                <li className="relative flex gap-x-4" key={index}>
                  {!isLastItem && (
                    <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                      <div className="w-px bg-gray-200"></div>
                    </div>
                  )}
                  <div className="relative flex h-6 w-6  flex-none items-center justify-center bg-gray-50">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300"></div>
                  </div>
                  <NotificationRuleConditionElement
                    {...props}
                    key={index}
                    notificationRuleCondition={i}
                  />{" "}
                </li>
              );
            },
          )}
        </ul>
      </div>
    </div>
  );
};

export default NotificationRuleConditions;
