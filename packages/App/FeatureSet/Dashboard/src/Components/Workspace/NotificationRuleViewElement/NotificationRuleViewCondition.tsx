import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
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
import { sortLabels } from "Common/Utils/LabelOrder";
import MonitorElement from "../../Monitor/Monitor";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
} from "../../SecurityCase/SecurityCasePills";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

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
  // A security case rule's: the project's own case priorities and statuses.
  securityCasePriorities?: Array<SecurityCasePriority> | undefined;
  securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
  monitorStatus: Array<MonitorStatus>;
}

const NotificationRuleConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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
      <span className="font-medium text-gray-900">
        {props.notificationRuleCondition?.value.join(", ")}
      </span>
    ) : (
      <span className="font-medium text-gray-900">
        {props.notificationRuleCondition?.value}
      </span>
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
      checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels ||
      checkOn === NotificationRuleConditionCheckOn.SecurityCaseLabels
    ) {
      // In natural order, as labels are listed everywhere (Utils/LabelOrder).
      const selectedLabels: Array<Label> = sortLabels<Label>(
        props.labels.filter((label: Label) => {
          return selectedIds.includes(label.id!.toString());
        }),
      );

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
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
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {selectedMonitors.map((monitor: Monitor, index: number) => {
            return <MonitorElement monitor={monitor} key={index} />;
          })}
        </div>
      );
    }

    /*
     * A security case's priority and status are the project's own, matched
     * by id: each drawn as the pill the case pages draw it with, in its name
     * and colour, in the project's order.
     */
    if (
      checkOn === NotificationRuleConditionCheckOn.SecurityCasePriority ||
      checkOn === NotificationRuleConditionCheckOn.SecurityCaseStatus
    ) {
      const isPriority: boolean =
        checkOn === NotificationRuleConditionCheckOn.SecurityCasePriority;
      const values: Array<SecurityCasePriority | SecurityCaseStatus> = (
        (isPriority
          ? props.securityCasePriorities
          : props.securityCaseStatuses) || []
      ).filter((value: SecurityCasePriority | SecurityCaseStatus) => {
        return selectedIds.includes(value.id?.toString() || "");
      });

      valueElement = (
        <div className="inline-flex flex-wrap items-center gap-1.5">
          {values.map((value: SecurityCasePriority | SecurityCaseStatus) => {
            return isPriority ? (
              <SecurityCasePriorityPill
                key={value.id?.toString()}
                value={value}
                isMinimal={true}
              />
            ) : (
              <SecurityCaseStatusPill
                key={value.id?.toString()}
                value={value}
                isMinimal={true}
              />
            );
          })}
        </div>
      );
    }

    // What raised the case: words of a fixed list, in the reader's language.
    if (checkOn === NotificationRuleConditionCheckOn.SecurityCaseSource) {
      valueElement = (
        <span className="font-medium text-gray-900">
          {selectedIds
            .map((value: string): string => {
              return translator.translateText(value) || value;
            })
            .join(", ")}
        </span>
      );
    }

    return valueElement;
  };

  /*
   * One line: what is checked, how, and the values - chips for states,
   * severities, labels and monitors - wrapping onto the next line when
   * they do not fit. What is checked and how are named as the Conditions
   * step's dropdowns name them, in the reader's language.
   */
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-6">
      <span className="font-medium text-gray-900">
        {translator.translateText(
          props.notificationRuleCondition?.checkOn || "",
        )}
      </span>
      <span className="text-gray-500">
        {translator.translateText(
          props.notificationRuleCondition?.conditionType || "",
        )}
      </span>
      {getValueElement()}
    </div>
  );
};

export default NotificationRuleConditionElement;
