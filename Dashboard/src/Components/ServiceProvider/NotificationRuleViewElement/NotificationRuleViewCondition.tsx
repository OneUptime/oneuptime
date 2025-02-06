import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import NotificationRuleCondition, { NotificationRuleConditionCheckOn, NotificationRuleConditionUtil } from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import React, { FunctionComponent, ReactElement } from "react";
import AlertSeverityElement from "../../AlertSeverity/AlertSeverityElement";

export interface ComponentProps {
  notificationRuleCondition: NotificationRuleCondition | undefined;
  filterCondition?: FilterCondition | undefined;
  value?: string | Array<string>;
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

const NotificationRuleConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {


    const getReactTextElementByNotificationCondition = () => {

        let valueElement: ReactElement | undefined = undefined;
        
        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.AlertSeverity) {
            const selectedAlertSeverities: Array<AlertSeverity> = props.alertSeverities.filter((alertSeverity: AlertSeverity) => {
                const selectedAlertSeveritiies = props.notificationRuleCondition?.value as Array<string>;

                return selectedAlertSeveritiies.includes(alertSeverity.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedAlertSeverities.map((alertSeverity: AlertSeverity) => {
                    return <AlertSeverityElement alertSeverity={alertSeverity} />;
                })}
            </div>
        }


        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.AlertState) {
            const selectedAlertStates: Array<AlertState> = props.alertStates.filter((alertState: AlertState) => {
                const selectedAlertStates = props.notificationRuleCondition?.value as Array<string>;

                return selectedAlertStates.includes(alertState.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedAlertStates.map((alertState: AlertState) => {
                    return <AlertStateElement alertState={alertState} />;
                })}
            </div>
        }
    }

  let text: string = "";

  if (props.notificationRuleCondition) {
    text = NotificationRuleConditionUtil.translateFilterToText(
      props.notificationRuleCondition,
      props.filterCondition,
    );
  }

  return (
    <div className="flex w-full -ml-3">
      <div className="flex">
        <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
          <span className="font-medium text-gray-900">{text}</span>{" "}
        </div>
      </div>
    </div>
  );
};

export default NotificationRuleConditionElement;
