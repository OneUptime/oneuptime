import KubernetesClusterLabelRule from "Common/Models/DatabaseModels/KubernetesClusterLabelRule";
import KubernetesClusterOwnerRule from "Common/Models/DatabaseModels/KubernetesClusterOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY KUBERNETES > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its clusters' owner and label rules.
 */
export const KUBERNETES_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  KubernetesClusterOwnerRule,
  KubernetesClusterLabelRule,
];

// The resource types their entries are stored under.
export const getKubernetesRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(KUBERNETES_RULE_MODEL_TYPES);
  };
