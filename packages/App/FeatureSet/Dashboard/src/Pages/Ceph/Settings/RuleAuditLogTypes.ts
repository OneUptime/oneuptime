import CephClusterLabelRule from "Common/Models/DatabaseModels/CephClusterLabelRule";
import CephClusterOwnerRule from "Common/Models/DatabaseModels/CephClusterOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY CEPH > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its clusters' owner and label rules.
 */
export const CEPH_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  CephClusterOwnerRule,
  CephClusterLabelRule,
];

// The resource types their entries are stored under.
export const getCephRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(CEPH_RULE_MODEL_TYPES);
  };
