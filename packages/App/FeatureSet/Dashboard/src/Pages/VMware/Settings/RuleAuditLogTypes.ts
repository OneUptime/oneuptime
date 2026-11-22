import VMwareVCenterLabelRule from "Common/Models/DatabaseModels/VMwareVCenterLabelRule";
import VMwareVCenterOwnerRule from "Common/Models/DatabaseModels/VMwareVCenterOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY VMWARE > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its vCenters' owner and label rules.
 */
export const VMWARE_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  VMwareVCenterOwnerRule,
  VMwareVCenterLabelRule,
];

// The resource types their entries are stored under.
export const getVMwareRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(VMWARE_RULE_MODEL_TYPES);
  };
