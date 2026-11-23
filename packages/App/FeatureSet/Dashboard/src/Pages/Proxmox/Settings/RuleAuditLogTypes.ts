import ProxmoxClusterLabelRule from "Common/Models/DatabaseModels/ProxmoxClusterLabelRule";
import ProxmoxClusterOwnerRule from "Common/Models/DatabaseModels/ProxmoxClusterOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY PROXMOX > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its clusters' owner and label rules.
 */
export const PROXMOX_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  ProxmoxClusterOwnerRule,
  ProxmoxClusterLabelRule,
];

// The resource types their entries are stored under.
export const getProxmoxRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(PROXMOX_RULE_MODEL_TYPES);
  };
