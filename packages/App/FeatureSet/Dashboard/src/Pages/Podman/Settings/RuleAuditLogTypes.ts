import PodmanHostLabelRule from "Common/Models/DatabaseModels/PodmanHostLabelRule";
import PodmanHostOwnerRule from "Common/Models/DatabaseModels/PodmanHostOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY PODMAN > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its hosts' owner and label rules.
 */
export const PODMAN_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  PodmanHostOwnerRule,
  PodmanHostLabelRule,
];

// The resource types their entries are stored under.
export const getPodmanRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(PODMAN_RULE_MODEL_TYPES);
  };
