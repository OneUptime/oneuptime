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
import NotificationRuleCondition, { NotificationRuleConditionCheckOn } from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import React, { FunctionComponent, ReactElement } from "react";
import AlertSeverityElement from "../../AlertSeverity/AlertSeverityElement";
import AlertStateElement from "../../AlertState/AlertStateElement";
import IncidentSeverityElement from "../../IncidentSeverity/IncidentSeverityElement";
import IncidentStateElement from "../../IncidentState/IncidentStateElement";
import ScheduledMaintenanceStateElement from "../../ScheduledMaintenanceState/ScheduledMaintenanceStateElement";
import MonitorStatusElement from "../../MonitorStatus/MonitorStatusElement";
import LabelElement from "../../Label/Label";
import MonitorElement from "../../Monitor/Monitor";

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


    


    const getValueElement = () => {

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


        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.IncidentSeverity) {
            const selectedIncidentSeverities: Array<IncidentSeverity> = props.incidentSeverities.filter((incidentSeverity: IncidentSeverity) => {
                const selectedIncidentSeverities = props.notificationRuleCondition?.value as Array<string>;

                return selectedIncidentSeverities.includes(incidentSeverity.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedIncidentSeverities.map((incidentSeverity: IncidentSeverity) => {
                    return <IncidentSeverityElement incidentSeverity={incidentSeverity} />;
                })}
            </div>
        }

        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.IncidentState) { 
            const selectedIncidentStates: Array<IncidentState> = props.incidentStates.filter((incidentState: IncidentState) => {
                const selectedIncidentStates = props.notificationRuleCondition?.value as Array<string>;

                return selectedIncidentStates.includes(incidentState.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedIncidentStates.map((incidentState: IncidentState) => {
                    return <IncidentStateElement incidentState={incidentState} />;
                })}
            </div>
        }


        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.ScheduledMaintenanceState) {
            const selectedScheduledMaintenanceStates: Array<ScheduledMaintenanceState> = props.scheduledMaintenanceStates.filter((scheduledMaintenanceState: ScheduledMaintenanceState) => {
                const selectedScheduledMaintenanceStates = props.notificationRuleCondition?.value as Array<string>;

                return selectedScheduledMaintenanceStates.includes(scheduledMaintenanceState.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedScheduledMaintenanceStates.map((scheduledMaintenanceState: ScheduledMaintenanceState) => {
                    return <ScheduledMaintenanceStateElement scheduledMaintenanceState={scheduledMaintenanceState} />;
                })}
            </div>

        }

        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.MonitorStatus) {
            const selectedMonitorStatuses: Array<MonitorStatus> = props.monitorStatus.filter((monitorStatus: MonitorStatus) => {
                const selectedMonitorStatuses = props.notificationRuleCondition?.value as Array<string>;

                return selectedMonitorStatuses.includes(monitorStatus.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedMonitorStatuses.map((monitorStatus: MonitorStatus) => {
                    return <MonitorStatusElement shouldAnimate={false} monitorStatus={monitorStatus} />;
                })}
            </div>
        }


        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.Labels) {
            const selectedLabels: Array<Label> = props.labels.filter((label: Label) => {
                const selectedLabels = props.notificationRuleCondition?.value as Array<string>;

                return selectedLabels.includes(label.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedLabels.map((label: Label) => {
                    return <LabelElement label={label} />;
                })}
            </div>
        }

        if(props.notificationRuleCondition?.checkOn === NotificationRuleConditionCheckOn.Monitors) {
            const selectedMonitors: Array<Monitor> = props.monitors.filter((monitor: Monitor) => {
                const selectedMonitors = props.notificationRuleCondition?.value as Array<string>;

                return selectedMonitors.includes(monitor.id!.toString());
            });

            valueElement = <div className="flex space-x-2"> 
                {selectedMonitors.map((monitor: Monitor) => {
                    return <MonitorElement monitor={monitor} />;
                })}
            </div>
        }


        return <div>{
            valueElement
          }</div>; 

    }

  return (
    <div className="flex w-full -ml-3">
      <div className="flex">
        <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
          <span className="font-medium text-gray-900">{props.notificationRuleCondition?.checkOn || ""}</span>
          <span className="ml-1 font-medium text-gray-900">{props.notificationRuleCondition?.conditionType || ""}</span>
          <span className="ml-1 font-medium text-gray-900">{getValueElement()}</span>
        </div>
      </div>
    </div>
  );
};

export default NotificationRuleConditionElement;
