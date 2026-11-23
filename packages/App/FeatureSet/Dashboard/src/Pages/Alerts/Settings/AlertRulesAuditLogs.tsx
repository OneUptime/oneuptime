import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import { RULE_AUDIT_LOGS_WORDS } from "../../../Components/AuditLogs/RuleAuditLogTypes";
import { getAlertRuleResourceTypes } from "./AlertRuleAuditLogTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO CHANGED THE PROJECT'S ALERT RULES, WHAT THEY CHANGED AND WHEN (#10290).
 *
 * An alert rule is a row on its list - most have no page of their own to
 * hang an Audit Logs page off - so the history of every one of them is here,
 * at the end of Alerts > Rules (AlertRuleAuditLogTypes says which kinds).
 * Its runbook rules are the one kind it leaves out, and its description says
 * where they are, as Incidents' and Scheduled Maintenance's do (#10462).
 */
const AlertRulesAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AuditLogsTable
      title="Alert Rule Audit Logs"
      description={RULE_AUDIT_LOGS_WORDS.descriptionWithRunbookRules}
      resourceTypes={getAlertRuleResourceTypes()}
    />
  );
};

export default AlertRulesAuditLogs;
