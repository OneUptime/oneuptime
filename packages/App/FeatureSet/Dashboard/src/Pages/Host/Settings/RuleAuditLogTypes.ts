import HostLabelRule from "Common/Models/DatabaseModels/HostLabelRule";
import HostOwnerRule from "Common/Models/DatabaseModels/HostOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY HOSTS > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its owner and label rules.
 */
export const HOST_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  HostOwnerRule,
  HostLabelRule,
];

// The resource types their entries are stored under.
export const getHostRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(HOST_RULE_MODEL_TYPES);
  };
