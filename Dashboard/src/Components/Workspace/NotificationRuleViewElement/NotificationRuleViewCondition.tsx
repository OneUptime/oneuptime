import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import React, { FunctionComponent, ReactElement } from "react";
import AlertSeverityElement from "../../AlertSeverity/AlertSeverityElement";
import AlertStateElement from "../../AlertState/AlertStateElement";
import IncidentSeverityElement from "../../IncidentSeverity/IncidentSeverityElement";
import IncidentStateElement from "../../IncidentState/IncidentStateElement";
import ScheduledMaintenanceStateElement from "../../ScheduledMaintenanceState/ScheduledMaintenanceStateElement";
import MonitorStatusElement from "../../MonitorStatus/MonitorStatusElement";
import LabelElement from "../../Label/Label";
import MonitorElement from "../../Monitor/Monitor";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";

export interface ComponentProps {
  notificationRuleCondition: NotificationRuleCondition | undefined;
  value?: string | Array<string>;
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
  const getValueElement: GetReactElementFunction = (): ReactElement => {
    let valueElement: ReactElement | undefined = Array.isArray(
      props.notificationRuleCondition?.value,
    ) ? (
      <span>{props.notificationRuleCondition?.value.join(", ")}</span>
    ) : (
      <span>{props.notificationRuleCondition?.value}</span>
    );

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.AlertSeverity
    ) {
      const selectedAlertSeverities: Array<AlertSeverity> =
        props.alertSeverities.filter((alertSeverity: AlertSeverity) => {
          const selectedAlertSeveritiies: Array<string> = props
            .notificationRuleCondition?.value as Array<string>;

          return selectedAlertSeveritiies.includes(
            alertSeverity.id!.toString(),
          );
        });

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedAlertSeverities.map(
            (alertSeverity: AlertSeverity, index: number) => {
              return (
                <AlertSeverityElement
                  alertSeverity={alertSeverity}
                  key={index}
                />
              );
            },
          )}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.AlertState
    ) {
      const selectedAlertStates: Array<AlertState> = props.alertStates.filter(
        (alertState: AlertState) => {
          const selectedAlertStates: Array<string> = props
            .notificationRuleCondition?.value as Array<string>;

          return selectedAlertStates.includes(alertState.id!.toString());
        },
      );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedAlertStates.map((alertState: AlertState, index: number) => {
            return <AlertStateElement alertState={alertState} key={index} />;
          })}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.IncidentSeverity
    ) {
      const selectedIncidentSeverities: Array<IncidentSeverity> =
        props.incidentSeverities.filter(
          (incidentSeverity: IncidentSeverity) => {
            const selectedIncidentSeverities: Array<string> = props
              .notificationRuleCondition?.value as Array<string>;

            return selectedIncidentSeverities.includes(
              incidentSeverity.id!.toString(),
            );
          },
        );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedIncidentSeverities.map(
            (incidentSeverity: IncidentSeverity, index: number) => {
              return (
                <IncidentSeverityElement
                  incidentSeverity={incidentSeverity}
                  key={index}
                />
              );
            },
          )}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.IncidentState
    ) {
      const selectedIncidentStates: Array<IncidentState> =
        props.incidentStates.filter((incidentState: IncidentState) => {
          const selectedIncidentStates: Array<string> = props
            .notificationRuleCondition?.value as Array<string>;

          return selectedIncidentStates.includes(incidentState.id!.toString());
        });

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedIncidentStates.map(
            (incidentState: IncidentState, index: number) => {
              return (
                <IncidentStateElement
                  incidentState={incidentState}
                  key={index}
                />
              );
            },
          )}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.ScheduledMaintenanceState
    ) {
      const selectedScheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
        props.scheduledMaintenanceStates.filter(
          (scheduledMaintenanceState: ScheduledMaintenanceState) => {
            const selectedScheduledMaintenanceStates: Array<string> = props
              .notificationRuleCondition?.value as Array<string>;

            return selectedScheduledMaintenanceStates.includes(
              scheduledMaintenanceState.id!.toString(),
            );
          },
        );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedScheduledMaintenanceStates.map(
            (
              scheduledMaintenanceState: ScheduledMaintenanceState,
              index: number,
            ) => {
              return (
                <ScheduledMaintenanceStateElement
                  scheduledMaintenanceState={scheduledMaintenanceState}
                  key={index}
                />
              );
            },
          )}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.MonitorStatus
    ) {
      const selectedMonitorStatuses: Array<MonitorStatus> =
        props.monitorStatus.filter((monitorStatus: MonitorStatus) => {
          const selectedMonitorStatuses: Array<string> = props
            .notificationRuleCondition?.value as Array<string>;

          return selectedMonitorStatuses.includes(monitorStatus.id!.toString());
        });

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedMonitorStatuses.map((monitorStatus: MonitorStatus) => {
            return (
              <MonitorStatusElement
                shouldAnimate={false}
                monitorStatus={monitorStatus}
              />
            );
          })}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
        NotificationRuleConditionCheckOn.AlertLabels ||
      props.notificationRuleCondition?.checkOn ===
        NotificationRuleConditionCheckOn.IncidentLabels ||
      props.notificationRuleCondition?.checkOn ===
        NotificationRuleConditionCheckOn.MonitorLabels ||
      props.notificationRuleCondition?.checkOn ===
        NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels
    ) {
      const selectedLabels: Array<Label> = props.labels.filter(
        (label: Label) => {
          const selectedLabels: Array<string> = props.notificationRuleCondition
            ?.value as Array<string>;

          return selectedLabels.includes(label.id!.toString());
        },
      );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedLabels.map((label: Label) => {
            return <LabelElement label={label} />;
          })}
        </div>
      );
    }

    if (
      props.notificationRuleCondition?.checkOn ===
      NotificationRuleConditionCheckOn.Monitors
    ) {
      const selectedMonitors: Array<Monitor> = props.monitors.filter(
        (monitor: Monitor) => {
          const selectedMonitors: Array<string> = props
            .notificationRuleCondition?.value as Array<string>;

          return selectedMonitors.includes(monitor.id!.toString());
        },
      );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedMonitors.map((monitor: Monitor) => {
            return <MonitorElement monitor={monitor} />;
          })}
        </div>
      );
    }

    return valueElement;
  };

  return (
    <div className="flex w-full -ml-3">
      <div className="flex">
        <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
          <span className="font-medium text-gray-900">
            {props.notificationRuleCondition?.checkOn || ""}
          </span>
          <span className="ml-1 font-medium text-gray-900">
            {props.notificationRuleCondition?.conditionType || ""}
          </span>
          <span className="ml-1 font-medium text-gray-900">
            {getValueElement()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default NotificationRuleConditionElement;
