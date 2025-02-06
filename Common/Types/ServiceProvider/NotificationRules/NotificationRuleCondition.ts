import ObjectID from "../../ObjectID";

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
    ContainsAny = "Contains Any",
}

export default interface NotificationRuleCondition {
    checkOn: NotificationRuleConditionCheckOn;
    conditionType: ConditionType;
    value: string | number | boolean | Array<string> | Array<ObjectID>;
}


