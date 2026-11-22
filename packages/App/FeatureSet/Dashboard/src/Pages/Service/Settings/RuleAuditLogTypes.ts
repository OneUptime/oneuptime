import ServiceLabelRule from "Common/Models/DatabaseModels/ServiceLabelRule";
import ServiceOwnerRule from "Common/Models/DatabaseModels/ServiceOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY SERVICES > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its owner and label rules.
 */
export const SERVICE_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  ServiceOwnerRule,
  ServiceLabelRule,
];

// The resource types their entries are stored under.
export const getServiceRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(SERVICE_RULE_MODEL_TYPES);
  };
