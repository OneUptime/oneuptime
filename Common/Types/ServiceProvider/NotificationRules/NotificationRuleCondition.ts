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
    conditionType: ConditionType;
    value: string | number | boolean | Array<string> | Array<ObjectID>;
}


export class NotificationRuleConditionUtil {


    public static getCheckOnByEventType(eventType: NotificationRuleEventType): Array<NotificationRuleConditionCheckOn> {

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

    public static getConditionTypeByCheckOn(checkOn: NotificationRuleConditionCheckOn): Array<ConditionType> {
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
                return [
                    ConditionType.Contains,
                    ConditionType.NotContains
                ];
            case NotificationRuleConditionCheckOn.IncidentState:
            case NotificationRuleConditionCheckOn.AlertState:
            case NotificationRuleConditionCheckOn.MonitorStatus:
            case NotificationRuleConditionCheckOn.ScheduledMaintenanceState:
                return [
                    ConditionType.Contains,
                    ConditionType.NotContains,
                ];
            case NotificationRuleConditionCheckOn.MonitorType:

                return [
                    ConditionType.Contains,
                    ConditionType.NotContains,
                ];
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


