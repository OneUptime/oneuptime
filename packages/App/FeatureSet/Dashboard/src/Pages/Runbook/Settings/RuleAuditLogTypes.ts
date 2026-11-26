import RunbookLabelRule from "Common/Models/DatabaseModels/RunbookLabelRule";
import RunbookOwnerRule from "Common/Models/DatabaseModels/RunbookOwnerRule";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY RUNBOOKS > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): the runbook rules of Alerts, Incidents and Scheduled Maintenance -
 * one kind of rule for all three, whose entries do not say whose they are, so
 * their history is here, beside the runbooks they attach - and the runbooks'
 * own owner and label rules.
 */
export const RUNBOOK_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  RunbookRule,
  RunbookOwnerRule,
  RunbookLabelRule,
];

// The resource types their entries are stored under.
export const getRunbookRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(RUNBOOK_RULE_MODEL_TYPES);
  };
