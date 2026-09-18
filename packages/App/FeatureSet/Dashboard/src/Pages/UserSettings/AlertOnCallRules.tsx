import OnCallRulesTable from "../../Components/NotificationRule/OnCallRulesTable";
import PageComponentProps from "../PageComponentProps";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Alert on-call rules for the signed-in user.
 *
 * The severity model and the foreign key column are passed separately on
 * purpose - see OnCallRulesTable for why one cannot be derived from the other.
 * Alerts read AlertSeverity and write `alertSeverityId`.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <OnCallRulesTable
      severityModelType={AlertSeverity}
      severityForeignKeyColumn="alertSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_ALERT}
      userPreferencesKeyPrefix="user-notification-rules-table"
      getTitle={(severityName: string): string => {
        return (
          severityName +
          " Severity Alert: " +
          " When I am on call and " +
          severityName +
          " severity alert" +
          " is assigned to me..."
        );
      }}
      getDescription={(severityName: string): string => {
        return (
          "Here are the rules when you are on call and " +
          severityName +
          " Severity alert" +
          " is assigned to you."
        );
      }}
    />
  );
};

export default Settings;
