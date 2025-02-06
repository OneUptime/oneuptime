import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import ObjectID from "../../ObjectID";
import NotificationRuleEventType from "./EventType";

export enum NotificationRuleConditionCheckOn {
  MonitorName = "Monitor Name",
  IncidentName = "Incident Name",
  IncidentDescription = "Incident Description",
  IncidentSeverity = "Incident Severity",
  IncidentState = "Incident State",
  MonitorType = "Monitor Type",
  MonitorStatus = "Monitor Status",
  AlertName = "Alert Name",
  AlertDescription = "Alert Description",
  AlertSeverity = "Alert Severity",
  AlertState = "Alert State",
  ScheduledMaintenanceName = "Scheduled Maintenance Name",
  ScheduledMaintenanceDescription = "Scheduled Maintenance Description",
  ScheduledMaintenanceState = "Scheduled Maintenance State",
  Labels = "Labels",
  Monitors = "Monitors", // like monitor contains in the incident or scheduled event.
}

export enum ConditionType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  GreaterThan = "Greater Than",
  LessThan = "Less Than",
  GreaterThanOrEqualTo = "Greater Than Or Equal To",
  LessThanOrEqualTo = "Less Than Or Equal To",
  Contains = "Contains",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
  True = "True",
  False = "False",

  // could be used for labels.
  ContainsAll = "Contains All",
}

export default interface NotificationRuleCondition {
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType | undefined;
  value:
    | string
    | number
    | boolean
    | Array<string>
    | Array<ObjectID>
    | undefined;
}

export class NotificationRuleConditionUtil {
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
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
      case NotificationRuleConditionCheckOn.IncidentSeverity:
      case NotificationRuleConditionCheckOn.AlertSeverity:
      case NotificationRuleConditionCheckOn.Labels:
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
    if (data.checkOn === NotificationRuleConditionCheckOn.AlertSeverity) {
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

    if (data.checkOn === NotificationRuleConditionCheckOn.Labels) {
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

    // alert states
    if (data.checkOn === NotificationRuleConditionCheckOn.AlertState) {
      return data.alertStates.map((state: AlertState) => {
        return {
          value: state.id!.toString(),
          label: state.name || "",
        };
      });
    }

    return [];
  }

  public static getCheckOnByEventType(
    eventType: NotificationRuleEventType,
  ): Array<NotificationRuleConditionCheckOn> {
    switch (eventType) {
      case NotificationRuleEventType.IncidentCreatedOrUpdated:
        return [
          NotificationRuleConditionCheckOn.IncidentName,
          NotificationRuleConditionCheckOn.IncidentDescription,
          NotificationRuleConditionCheckOn.IncidentSeverity,
          NotificationRuleConditionCheckOn.IncidentState,
          NotificationRuleConditionCheckOn.Labels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.AlertCreatedOrUpdated:
        return [
          NotificationRuleConditionCheckOn.AlertName,
          NotificationRuleConditionCheckOn.AlertDescription,
          NotificationRuleConditionCheckOn.AlertSeverity,
          NotificationRuleConditionCheckOn.AlertState,
          NotificationRuleConditionCheckOn.Labels,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.MonitorStatusChanged:
        return [
          NotificationRuleConditionCheckOn.MonitorName,
          NotificationRuleConditionCheckOn.MonitorStatus,
          NotificationRuleConditionCheckOn.MonitorType,
          NotificationRuleConditionCheckOn.Monitors,
        ];
      case NotificationRuleEventType.ScheduledMaintenanceCreatedOrUpdated:
        return [
          NotificationRuleConditionCheckOn.ScheduledMaintenanceName,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceDescription,
          NotificationRuleConditionCheckOn.ScheduledMaintenanceState,
          NotificationRuleConditionCheckOn.Labels,
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
      case NotificationRuleConditionCheckOn.IncidentName:
      case NotificationRuleConditionCheckOn.IncidentDescription:
      case NotificationRuleConditionCheckOn.AlertName:
      case NotificationRuleConditionCheckOn.AlertDescription:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceName:
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
        return [ConditionType.Contains, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.IncidentState:
      case NotificationRuleConditionCheckOn.AlertState:
      case NotificationRuleConditionCheckOn.MonitorStatus:
      case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
        return [ConditionType.Contains, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.MonitorType:
        return [ConditionType.Contains, ConditionType.NotContains];
      case NotificationRuleConditionCheckOn.Labels:
        return [
          ConditionType.Contains,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      case NotificationRuleConditionCheckOn.Monitors:
        return [
          ConditionType.Contains,
          ConditionType.NotContains,
          ConditionType.ContainsAll,
        ];
      default:
        return [];
    }
  }
}
