import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import MonitorType from "../../Monitor/MonitorType";
import WorkspaceType from "../WorkspaceType";
import NotificationRuleEventType from "./EventType";
import IncidentNotificationRule from "./NotificationRuleTypes/IncidentNotificationRule";

export enum NotificationRuleConditionCheckOn {
  MonitorName = "Monitor Name",
  IncidentTitle = "Incident Title",
  IncidentDescription = "Incident Description",
  IncidentSeverity = "Incident Severity",
  IncidentState = "Incident State",
  MonitorType = "Monitor Type",
  MonitorStatus = "Monitor Status",
  AlertTitle = "Alert Title",
  AlertDescription = "Alert Description",
  AlertSeverity = "Alert Severity",
  AlertState = "Alert State",
  AlertEpisodeTitle = "Alert Episode Title",
  AlertEpisodeDescription = "Alert Episode Description",
  AlertEpisodeSeverity = "Alert Episode Severity",
  AlertEpisodeState = "Alert Episode State",
  AlertEpisodeLabels = "Alert Episode Labels",
  ScheduledMaintenanceTitle = "Scheduled Maintenance Title",
  ScheduledMaintenanceDescription = "Scheduled Maintenance Description",
  ScheduledMaintenanceState = "Scheduled Maintenance State",
  IncidentLabels = "Incident Labels",
  AlertLabels = "Alert Labels",
  MonitorLabels = "Monitor Labels",
  ScheduledMaintenanceLabels = "Scheduled Maintenance Labels",
  Monitors = "Monitors", // like monitor contains in the incident or scheduled event.

  // On Call Duty Policy
  OnCallDutyPolicyName = "On Call Duty Policy Name",
  OnCallDutyPolicyDescription = "On Call Duty Policy Description",
  OnCallDutyPolicyLabels = "On Call Duty Policy Labels",
}

export enum ConditionType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  GreaterThan = "Greater Than",
  LessThan = "Less Than",
  GreaterThanOrEqualTo = "Greater Than Or Equal To",
  LessThanOrEqualTo = "Less Than Or Equal To",
  Contains = "Contains",
  ContainsAny = "Contains Any",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
  True = "True",
  False = "False",
  ContainsAll = "Contains All",
}

export default interface NotificationRuleCondition {
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType | undefined;
  value: string | Array<string> | undefined;
}

export class NotificationRuleConditionUtil {
  public static getValidationError(data: {
    notificationRule: IncidentNotificationRule;
    eventType: NotificationRuleEventType;
    workspaceType: WorkspaceType;
  }): string | null {
    const { notificationRule, eventType, workspaceType } = data;

    for (const condition of notificationRule.filters) {
      if (!condition.checkOn) {
        return "Check On is required";
      }

      if (!condition.conditionType) {
        return `Filter Condition is required for ${condition.checkOn}`;
      }

      if (!condition.value) {
        return `Value is required for ${condition.checkOn}`;
      }

      if (Array.isArray(condition.value) && condition.value.length === 0) {
        return `Value is required for ${condition.checkOn}`;
      }
    }

    if (
      eventType === NotificationRuleEventType.Incident ||
      eventType === NotificationRuleEventType.Alert ||
      eventType === NotificationRuleEventType.AlertEpisode ||
      eventType === NotificationRuleEventType.ScheduledMaintenance
    ) {
      // either create slack channel or select existing one should be active.

      if (
        !notificationRule.shouldCreateNewChannel &&
        !notificationRule.shouldPostToExistingChannel
      ) {
        return (
          "Please select either create slack channel or post to existing " +
          workspaceType +
          " channel"
        );
      }

      if (notificationRule.shouldPostToExistingChannel) {
        if (!notificationRule.existingChannelNames?.trim()) {
          return "Existing " + workspaceType + " channel name is required";
        }
      }

      if (notificationRule.shouldCreateNewChannel) {
        if (!notificationRule.newChannelTemplateName?.trim()) {
          return "New " + workspaceType + " channel name is required";
        }
      }
    }

    return null;
  }

  public static hasValueField(data: {
    checkOn: NotificationRuleConditionCheckOn;
    conditionType: ConditionType | undefined;
  }): boolean {
    switch (data.conditionType) {
      case ConditionType.IsEmpty:
      case ConditionType.IsNotEmpty:
      case ConditionType.True:
      case ConditionType.False:
        return false;
      default:
        return true;
    }
  }

  public static isDropdownValueField(data: {
    checkOn: NotificationRuleConditionCheckOn | undefined;
    conditionType: ConditionType | undefined;
  }): boolean {
    // incident state, alert state, monitor status, scheduled maintenance state, severit, labels, monitors are all dropdowns.

    if (!data.checkOn || !data.conditionType) {
      return false;
    }

    switch (data.checkOn) {
      case NotificationRuleConditionCheckOn.MonitorType:
      case NotificationRuleConditionCheckOn.IncidentState:
      case NotificationRuleConditionCheckOn.AlertState:
      case NotificationRuleConditionCheckOn.AlertEpisodeState:
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
      case NotificationRuleConditionCheckOn.IncidentSeverity:
      case NotificationRuleConditionCheckOn.AlertSeverity:
      case NotificationRuleConditionCheckOn.AlertEpisodeSeverity:
      case NotificationRuleConditionCheckOn.MonitorLabels:
      case NotificationRuleConditionCheckOn.IncidentLabels:
      case NotificationRuleConditionCheckOn.AlertLabels:
      case NotificationRuleConditionCheckOn.AlertEpisodeLabels:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels:
      case NotificationRuleConditionCheckOn.Monitors:
        return true;
      default:
        return false;
    }
  }

  public static getDropdownOptionsByCheckOn(data: {
    alertSeverities: Array<AlertSeverity>;
    alertStates: Array<AlertState>;
    incidentSeverities: Array<IncidentSeverity>;
    monitorStatus: Array<MonitorStatus>;
    incidentStates: Array<IncidentState>;
    scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
    labels: Array<Label>;
    monitors: Array<Monitor>;
    checkOn: NotificationRuleConditionCheckOn;
  }): Array<DropdownOption> {
    if (
      data.checkOn === NotificationRuleConditionCheckOn.AlertSeverity ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeSeverity
    ) {
      return data.alertSeverities.map((severity: AlertSeverity) => {
        return {
          value: severity.id!.toString(),
          label: severity.name || "",
        };
      });
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.IncidentSeverity) {
      return data.incidentSeverities.map((severity: IncidentSeverity) => {
        return {
          value: severity.id!.toString(),
          label: severity.name || "",
        };
      });
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.MonitorStatus) {
      return data.monitorStatus.map((status: MonitorStatus) => {
        return {
          value: status.id!.toString(),
          label: status.name || "",
        };
      });
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.IncidentState) {
      return data.incidentStates.map((state: IncidentState) => {
        return {
          value: state.id!.toString(),
          label: state.name || "",
        };
      });
    }

    if (
      data.checkOn ===
      NotificationRuleConditionCheckOn.ScheduledMaintenanceState
    ) {
      return data.scheduledMaintenanceStates.map(
        (state: ScheduledMaintenanceState) => {
          return {
            value: state.id!.toString(),
            label: state.name || "",
          };
        },
      );
    }

    if (
      data.checkOn === NotificationRuleConditionCheckOn.MonitorLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.IncidentLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertLabels ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeLabels ||
      data.checkOn ===
        NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels
    ) {
      return data.labels.map((label: Label) => {
        return {
          value: label.id!.toString(),
          label: label.name || "",
        };
      });
    }

    if (data.checkOn === NotificationRuleConditionCheckOn.Monitors) {
      return data.monitors.map((monitor: Monitor) => {
        return {
          value: monitor.id!.toString(),
          label: monitor.name || "",
        };
      });
    }

    // alert states (also used for alert episodes)
    if (
      data.checkOn === NotificationRuleConditionCheckOn.AlertState ||
      data.checkOn === NotificationRuleConditionCheckOn.AlertEpisodeState
    ) {
      return data.alertStates.map((state: AlertState) => {
        return {
          value: state.id!.toString(),
          label: state.name || "",
        };
      });
    }

    // if monitor type
    if (data.checkOn === NotificationRuleConditionCheckOn.MonitorType) {
      return DropdownUtil.getDropdownOptionsFromEnum(MonitorType);
    }

    return [];
  }

  public static getCheckOnByEventType(
    eventType: NotificationRuleEventType,
  ): Array<NotificationRuleConditionCheckOn> {
    switch (eventType) {
      case NotificationRuleEventType.Incident:
        return [
          NotificationRuleConditionCheckOn.IncidentTitle,
          NotificationRuleConditionCheckOn.IncidentDescription,
          NotificationRuleConditionCheckOn.IncidentSeverity,
          NotificationRuleConditionCheckOn.IncidentState,
          NotificationRuleConditionCheckOn.IncidentLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.Alert:
        return [
          NotificationRuleConditionCheckOn.AlertTitle,
          NotificationRuleConditionCheckOn.AlertDescription,
          NotificationRuleConditionCheckOn.AlertSeverity,
          NotificationRuleConditionCheckOn.AlertState,

          NotificationRuleConditionCheckOn.AlertLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,

          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.AlertEpisode:
        return [
          NotificationRuleConditionCheckOn.AlertEpisodeTitle,
          NotificationRuleConditionCheckOn.AlertEpisodeDescription,
          NotificationRuleConditionCheckOn.AlertEpisodeSeverity,
          NotificationRuleConditionCheckOn.AlertEpisodeState,
          NotificationRuleConditionCheckOn.AlertEpisodeLabels,
        ];
      case NotificationRuleEventType.Monitor:
        return [
          NotificationRuleConditionCheckOn.MonitorName,
          NotificationRuleConditionCheckOn.MonitorStatus,
          NotificationRuleConditionCheckOn.MonitorType,
          NotificationRuleConditionCheckOn.Monitors,
          NotificationRuleConditionCheckOn.MonitorLabels,
        ];
      case NotificationRuleEventType.ScheduledMaintenance:
        return [
          NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceState,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels,
          NotificationRuleConditionCheckOn.MonitorLabels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      default:
        return [];
    }
  }

  public static getConditionTypeByCheckOn(
    checkOn: NotificationRuleConditionCheckOn,
  ): Array<ConditionType> {
    switch (checkOn) {
      case NotificationRuleConditionCheckOn.MonitorName:
      case NotificationRuleConditionCheckOn.IncidentTitle:
      case NotificationRuleConditionCheckOn.IncidentDescription:
      case NotificationRuleConditionCheckOn.AlertTitle:
      case NotificationRuleConditionCheckOn.AlertDescription:
      case NotificationRuleConditionCheckOn.AlertEpisodeTitle:
      case NotificationRuleConditionCheckOn.AlertEpisodeDescription:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceTitle:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription:
        return [
          ConditionType.EqualTo,
          ConditionType.NotEqualTo,
          ConditionType.Contains,
          ConditionType.NotContains,
          ConditionType.StartsWith,
          ConditionType.EndsWith,
        ];
      case NotificationRuleConditionCheckOn.IncidentSeverity:
      case NotificationRuleConditionCheckOn.AlertSeverity:
      case NotificationRuleConditionCheckOn.AlertEpisodeSeverity:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.IncidentState:
      case NotificationRuleConditionCheckOn.AlertState:
      case NotificationRuleConditionCheckOn.AlertEpisodeState:
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.MonitorType:
        return [ConditionType.ContainsAny, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.AlertLabels:
      case NotificationRuleConditionCheckOn.AlertEpisodeLabels:
      case NotificationRuleConditionCheckOn.IncidentLabels:
      case NotificationRuleConditionCheckOn.MonitorLabels:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels:
        return [
          ConditionType.ContainsAny,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      case NotificationRuleConditionCheckOn.Monitors:
        return [
          ConditionType.ContainsAny,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      default:
        return [];
    }
  }
}
