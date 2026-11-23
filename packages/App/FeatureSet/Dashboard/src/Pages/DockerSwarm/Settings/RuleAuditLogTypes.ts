import DockerSwarmClusterLabelRule from "Common/Models/DatabaseModels/DockerSwarmClusterLabelRule";
import DockerSwarmClusterOwnerRule from "Common/Models/DatabaseModels/DockerSwarmClusterOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY DOCKER SWARM > SETTINGS > RULE AUDIT LOGS
 * LISTS (#10462): its clusters' owner and label rules.
 */
export const DOCKER_SWARM_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  DockerSwarmClusterOwnerRule,
  DockerSwarmClusterLabelRule,
];

// The resource types their entries are stored under.
export const getDockerSwarmRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(DOCKER_SWARM_RULE_MODEL_TYPES);
  };
