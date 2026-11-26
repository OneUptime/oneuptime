import MonitorLabelRule from "Common/Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "Common/Models/DatabaseModels/MonitorOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY MONITORS > RULES > AUDIT LOGS LISTS (#10462):
 * its owner and label rules.
 */
export const MONITOR_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  MonitorOwnerRule,
  MonitorLabelRule,
];

// The resource types their entries are stored under.
export const getMonitorRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(MONITOR_RULE_MODEL_TYPES);
  };
