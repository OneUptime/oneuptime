import StatusPageLabelRule from "Common/Models/DatabaseModels/StatusPageLabelRule";
import StatusPageOwnerRule from "Common/Models/DatabaseModels/StatusPageOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY STATUS PAGES > RULES > AUDIT LOGS LISTS
 * (#10462): its owner and label rules (a status page's own monitor rules are
 * its own, on its Audit Logs page).
 */
export const STATUS_PAGE_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  StatusPageOwnerRule,
  StatusPageLabelRule,
];

// The resource types their entries are stored under.
export const getStatusPageRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(STATUS_PAGE_RULE_MODEL_TYPES);
  };
