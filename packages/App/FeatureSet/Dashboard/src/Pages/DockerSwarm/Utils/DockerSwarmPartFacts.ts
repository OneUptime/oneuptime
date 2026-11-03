import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  InfrastructureResource,
  ResourceStatusReason,
} from "../../../Components/Infrastructure/ResourceTable";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import {
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
  DockerSwarmAssessment,
  assessDockerSwarmResource,
  getDockerSwarmAttribute,
  getDockerSwarmStatusReasons,
  getDockerSwarmTaskReadings,
  isDockerSwarmJobService,
  isDockerSwarmLeader,
  isDockerSwarmManager,
  toDockerSwarmNumber,
} from "./DockerSwarmHealth";

/*
 * What a Docker Swarm node's, service's and task's page shows about it,
 * beside the rules (DockerSwarmHealth) that say how it is doing: which of
 * the cluster's alerts watch it, its badges, its facts and how a list row
 * reads. React-free, so App tests can read it.
 */

/*
 * The cluster's alerts that watch a part of each kind, in the order its
 * alerts card lists them. Each is one monitor on the cluster that fires for
 * any node, service or task that crosses it: the task templates group by
 * the task's container, so a service's tasks are watched by them too.
 */
export const DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS: Array<string> = [
  "docker-swarm-node-not-ready",
];

export const DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS: Array<string> = [
  "docker-swarm-task-down",
  "docker-swarm-high-memory",
  "docker-swarm-high-cpu",
  "docker-swarm-high-pids",
];

export const DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS: Array<string> = [
  "docker-swarm-service-replicas-mismatch",
  ...DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS,
];

// The lines a task's CPU and memory bars turn amber at: its alerts' lines.
export const DOCKER_SWARM_TASK_METRIC_THRESHOLDS: {
  cpu: { warning: number };
  memory: { warning: number };
} = {
  cpu: { warning: DOCKER_SWARM_TASK_CPU_WARNING_PERCENT },
  memory: { warning: DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT },
};

const BADGE_LEADER: string = translationKey("Leader");
const BADGE_MANAGER: string = translationKey("Manager node");
const BADGE_WORKER: string = translationKey("Worker node");
const BADGE_REPLICATED: string = translationKey("Replicated");
const BADGE_GLOBAL: string = translationKey("Global");
const BADGE_JOB: string = translationKey("Job");
const BADGE_ROLLED_BACK: string = translationKey("Rolled back");

// A node's role, as `docker node ls` marks it.
export function getDockerSwarmRoleBadge(
  row: DockerSwarmResource,
): ResourcePartBadge {
  if (isDockerSwarmManager(row)) {
    return isDockerSwarmLeader(row)
      ? { key: "role", label: BADGE_LEADER, tone: "neutral" }
      : { key: "role", label: BADGE_MANAGER, tone: "neutral" };
  }
  return { key: "role", label: BADGE_WORKER, tone: "neutral" };
}

// A service's mode, as `docker service ls` writes it.
export function getDockerSwarmModeBadge(
  row: DockerSwarmResource,
): ResourcePartBadge | null {
  const mode: string = (row.serviceMode || "").toLowerCase();
  if (isDockerSwarmJobService(row)) {
    return { key: "mode", label: BADGE_JOB, tone: "neutral" };
  }
  if (mode === "replicated") {
    return { key: "mode", label: BADGE_REPLICATED, tone: "neutral" };
  }
  if (mode === "global") {
    return { key: "mode", label: BADGE_GLOBAL, tone: "neutral" };
  }
  return null;
}

/*
 * A rollback older than a day is history, not a problem (DockerSwarmHealth
 * stops listing it): the service's hero still says it was rolled back.
 */
export function getDockerSwarmRollbackBadge(
  row: DockerSwarmResource,
): ResourcePartBadge | null {
  return getDockerSwarmAttribute(row, "updateState").toLowerCase() ===
    "rollback_completed"
    ? { key: "rollback", label: BADGE_ROLLED_BACK, tone: "neutral" }
    : null;
}

// A node's CPUs as Docker counts them: "4", "0.5", "1.25".
export function formatDockerSwarmCpus(cpus: number): string {
  return String(Math.round(cpus * 100) / 100);
}

// Counting a node's or a service's tasks lives with the rules.
export { countDockerSwarmTasks } from "./DockerSwarmHealth";
export type { DockerSwarmTaskCount } from "./DockerSwarmHealth";

// The task's id, short as `docker ps` writes a container's.
export function shortDockerSwarmContainerId(containerId: string): string {
  return containerId.length > 12 ? containerId.substring(0, 12) : containerId;
}

/*
 * A list row's status by the rules: the word, its colour and why, so the
 * Nodes, Services and Tasks lists say what the Overview's Needs attention
 * says about the same part. A task's memory reads against its limit.
 */
export function withDockerSwarmStatus(
  resource: InfrastructureResource,
  row: DockerSwarmResource,
  now: Date,
): InfrastructureResource {
  const assessment: DockerSwarmAssessment | null = assessDockerSwarmResource(
    row,
    now,
  );
  if (!assessment) {
    return resource;
  }

  const reasons: Array<ResourceStatusReason> =
    getDockerSwarmStatusReasons(assessment);

  const result: InfrastructureResource = {
    ...resource,
    status: assessment.status.label,
    statusTone: assessment.status.tone,
    statusText: assessment.status.values
      ? { text: assessment.status.label, values: assessment.status.values }
      : { text: assessment.status.label },
    statusReasons: reasons,
  };

  if (row.kind === "Task") {
    const readings: {
      cpuPercent: number | null;
      memoryBytes: number | null;
      memoryPercent: number | null;
    } = getDockerSwarmTaskReadings(row, now);
    result.cpuUtilization = readings.cpuPercent;
    result.memoryUsageBytes = readings.memoryBytes;
    result.memoryUtilization = readings.memoryPercent;
  }

  return result;
}

// A count the agent reported on the row's attributes, or null.
export function getDockerSwarmCount(
  row: DockerSwarmResource,
  key: string,
): number | null {
  return toDockerSwarmNumber(getDockerSwarmAttribute(row, key));
}
