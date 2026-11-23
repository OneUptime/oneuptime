import PageComponentProps from "../../PageComponentProps";
import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";
import { RULE_AUDIT_LOGS_WORDS } from "../../../Components/AuditLogs/RuleAuditLogTypes";
import { getDockerRuleResourceTypes } from "./RuleAuditLogTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHO CHANGED THE PROJECT'S DOCKER HOST RULES, WHAT THEY CHANGED AND WHEN
 * (#10462).
 *
 * A rule's own page, where it has one, links its history from its line; this
 * page is every one of them at once, deleted ones included, at the end of
 * Docker > Settings (RuleAuditLogTypes says which kinds). Each entry is held to
 * what its reader may read of the rule, as every audit log is (#10658).
 */
const DockerRulesAuditLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AuditLogsTable
      title="Docker Host Rule Audit Logs"
      description={RULE_AUDIT_LOGS_WORDS.description}
      resourceTypes={getDockerRuleResourceTypes()}
    />
  );
};

export default DockerRulesAuditLogs;
