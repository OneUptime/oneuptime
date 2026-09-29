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
import LabelElement from "Common/UI/Components/Label/Label";
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
    const checkOn: NotificationRuleConditionCheckOn | undefined =
      props.notificationRuleCondition?.checkOn;

    /*
     * Every dropdown-backed check-on stores its value as an array of ids, but
     * a row saved before the check-on became a dropdown - or one saved with
     * no value at all - can still hold a bare string or nothing. Normalise
     * once: a bad row then renders as "nothing selected" instead of throwing
     * and taking the whole rule view down with it.
     */
    const selectedIds: Array<string> = Array.isArray(
      props.notificationRuleCondition?.value,
    )
      ? props.notificationRuleCondition.value.map((value: string) => {
          return value?.toString();
        })
      : props.notificationRuleCondition?.value
        ? [props.notificationRuleCondition.value.toString()]
        : [];

    let valueElement: ReactElement | undefined = Array.isArray(
      props.notificationRuleCondition?.value,
    ) ? (
      <span>{props.notificationRuleCondition?.value.join(", ")}</span>
    ) : (
      <span>{props.notificationRuleCondition?.value}</span>
    );

    if (
      checkOn === NotificationRuleConditionCheckOn.AlertSeverity ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeSeverity
    ) {
      const selectedAlertSeverities: Array<AlertSeverity> =
        props.alertSeverities.filter((alertSeverity: AlertSeverity) => {
          return selectedIds.includes(alertSeverity.id!.toString());
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
      checkOn === NotificationRuleConditionCheckOn.AlertState ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeState
    ) {
      const selectedAlertStates: Array<AlertState> = props.alertStates.filter(
        (alertState: AlertState) => {
          return selectedIds.includes(alertState.id!.toString());
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
      checkOn === NotificationRuleConditionCheckOn.IncidentSeverity ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeSeverity
    ) {
      const selectedIncidentSeverities: Array<IncidentSeverity> =
        props.incidentSeverities.filter(
          (incidentSeverity: IncidentSeverity) => {
            return selectedIds.includes(incidentSeverity.id!.toString());
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
      checkOn === NotificationRuleConditionCheckOn.IncidentState ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeState
    ) {
      const selectedIncidentStates: Array<IncidentState> =
        props.incidentStates.filter((incidentState: IncidentState) => {
          return selectedIds.includes(incidentState.id!.toString());
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
      checkOn === NotificationRuleConditionCheckOn.ScheduledMaintenanceState
    ) {
      const selectedScheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
        props.scheduledMaintenanceStates.filter(
          (scheduledMaintenanceState: ScheduledMaintenanceState) => {
            return selectedIds.includes(
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

    if (checkOn === NotificationRuleConditionCheckOn.MonitorStatus) {
      const selectedMonitorStatuses: Array<MonitorStatus> =
        props.monitorStatus.filter((monitorStatus: MonitorStatus) => {
          return selectedIds.includes(monitorStatus.id!.toString());
        });

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedMonitorStatuses.map(
            (monitorStatus: MonitorStatus, index: number) => {
              return (
                <MonitorStatusElement
                  shouldAnimate={false}
                  monitorStatus={monitorStatus}
                  key={index}
                />
              );
            },
          )}
        </div>
      );
    }

    /*
     * Every label-backed check-on renders the same way. They are listed one
     * by one rather than matched on a "Labels" suffix so a new check-on has
     * to be added here deliberately.
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.AlertLabels ||
      checkOn === NotificationRuleConditionCheckOn.AlertEpisodeLabels ||
      checkOn === NotificationRuleConditionCheckOn.IncidentLabels ||
      checkOn === NotificationRuleConditionCheckOn.IncidentEpisodeLabels ||
      checkOn === NotificationRuleConditionCheckOn.MonitorLabels ||
      checkOn === NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels ||
      checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels
    ) {
      const selectedLabels: Array<Label> = props.labels.filter(
        (label: Label) => {
          return selectedIds.includes(label.id!.toString());
        },
      );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedLabels.map((label: Label, index: number) => {
            return <LabelElement label={label} key={index} />;
          })}
        </div>
      );
    }

    if (checkOn === NotificationRuleConditionCheckOn.Monitors) {
      const selectedMonitors: Array<Monitor> = props.monitors.filter(
        (monitor: Monitor) => {
          return selectedIds.includes(monitor.id!.toString());
        },
      );

      valueElement = (
        <div className="flex space-x-2 py-1">
          {selectedMonitors.map((monitor: Monitor, index: number) => {
            return <MonitorElement monitor={monitor} key={index} />;
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
