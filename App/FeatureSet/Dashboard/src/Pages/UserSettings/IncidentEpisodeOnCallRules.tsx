import OnCallRulesTable from "../../Components/NotificationRule/OnCallRulesTable";
import PageComponentProps from "../PageComponentProps";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incident EPISODE on-call rules for the signed-in user.
 *
 * Banded by IncidentSeverity and writing `incidentSeverityId` - the mirror of
 * the alert episode page, which is banded by AlertSeverity. The two differ only
 * in those two props, which is exactly why they are passed rather than derived.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE}
      userPreferencesKeyPrefix="user-notification-rules-table"
      getTitle={(severityName: string): string => {
        return (
          severityName +
          " Severity Episode: " +
          " When I am on call and " +
          severityName +
          " severity episode" +
          " is assigned to me..."
        );
      }}
      getDescription={(severityName: string): string => {
        return (
          "Here are the rules when you are on call and " +
          severityName +
          " Severity episode" +
          " is assigned to you."
        );
      }}
    />
  );
};

export default Settings;
