import DockerHostLabelRule from "Common/Models/DatabaseModels/DockerHostLabelRule";
import DockerHostOwnerRule from "Common/Models/DatabaseModels/DockerHostOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY DOCKER > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its hosts' owner and label rules.
 */
export const DOCKER_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  DockerHostOwnerRule,
  DockerHostLabelRule,
];

// The resource types their entries are stored under.
export const getDockerRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(DOCKER_RULE_MODEL_TYPES);
  };
