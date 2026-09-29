import OnCallRulesTable from "../../Components/NotificationRule/OnCallRulesTable";
import PageComponentProps from "../PageComponentProps";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incident on-call rules for the signed-in user.
 *
 * The severity model and the foreign key column are passed separately on
 * purpose - see OnCallRulesTable for why one cannot be derived from the other.
 * Incidents read IncidentSeverity and write `incidentSeverityId`.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
      userPreferencesKeyPrefix="user-notification-rules-table"
      getTitle={(severityName: string): string => {
        return (
          severityName +
          " Severity: " +
          " When I am on call and " +
          severityName +
          " is assigned to me..."
        );
      }}
      getDescription={(severityName: string): string => {
        return (
          "Here are the rules when you are on call and " +
          severityName +
          " is assigned to you."
        );
      }}
    />
  );
};

export default Settings;
