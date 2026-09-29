import OnCallRulesTable from "../../Components/NotificationRule/OnCallRulesTable";
import PageComponentProps from "../PageComponentProps";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Alert EPISODE on-call rules for the signed-in user.
 *
 * This page is the reason the severity model and the foreign key column are two
 * independent props rather than one "is this an episode?" switch: an alert
 * episode is banded by AlertSeverity and writes `alertSeverityId`, while the
 * incident episode page next door is banded by IncidentSeverity. The word
 * "episode" carries no information about either axis.
 */
const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <OnCallRulesTable
      severityModelType={AlertSeverity}
      severityForeignKeyColumn="alertSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE}
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
