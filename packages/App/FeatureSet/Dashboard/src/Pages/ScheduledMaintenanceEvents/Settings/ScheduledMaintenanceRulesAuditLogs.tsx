import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import { RULE_AUDIT_LOGS_WORDS } from "../../../Components/AuditLogs/RuleAuditLogTypes";
import { getScheduledMaintenanceRuleResourceTypes } from "./ScheduledMaintenanceRuleAuditLogTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO CHANGED THE PROJECT'S SCHEDULED MAINTENANCE RULES, WHAT THEY CHANGED AND
 * WHEN (#10462).
 *
 * A rule's own page, where it has one, links its history from its line; this
 * page is every one of them at once, deleted ones included, at the end of
 * Scheduled Maintenance > Rules (ScheduledMaintenanceRuleAuditLogTypes says
 * which kinds). Each entry is held to what its reader may read of the rule, as
 * every audit log is (#10658).
 */
const ScheduledMaintenanceRulesAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AuditLogsTable
      title="Scheduled Maintenance Rule Audit Logs"
      description={RULE_AUDIT_LOGS_WORDS.descriptionWithRunbookRules}
      resourceTypes={getScheduledMaintenanceRuleResourceTypes()}
    />
  );
};

export default ScheduledMaintenanceRulesAuditLogs;
