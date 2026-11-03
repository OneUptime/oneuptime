import { describe, expect, test } from "@jest/globals";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmAlertTemplateById,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import {
  DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS,
  DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS,
  DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS,
  DOCKER_SWARM_TASK_METRIC_THRESHOLDS,
  formatDockerSwarmCpus,
  getDockerSwarmCount,
  getDockerSwarmModeBadge,
  getDockerSwarmRoleBadge,
  getDockerSwarmRollbackBadge,
  shortDockerSwarmContainerId,
  withDockerSwarmStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import {
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmHealth";
import { toInfrastructureResource } from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import { InfrastructureResource } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";

/*
 * What a Docker Swarm node's, service's and task's page shows about it
 * beside the rules (Pages/DockerSwarm/Utils/DockerSwarmPartFacts): the
 * alerts each part's card lists, its badges, its facts, and how a list's
 * row reads by the rules.
 */

function row(init: Record<string, unknown>): DockerSwarmResource {
  const model: DockerSwarmResource = new DockerSwarmResource();
  Object.assign(model, init);
  return model;
}

function templateGroupsBy(id: string): Array<string> {
  const template: DockerSwarmAlertTemplate | undefined =
    getDockerSwarmAlertTemplateById(id);
  expect(template).toBeDefined();
  return MonitorStep.getGroupByAttributeKeys(
    template!.getMonitorStep({
      clusterIdentifier: "swarm-prod",
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "Swarm",
    }),
  );
}

describe("the alerts each part's card lists", () => {
  test("every id is a template the registry has, and each card's alerts watch its kind", () => {
    const registry: Set<string> = new Set(
      getAllDockerSwarmAlertTemplates().map(
        (template: DockerSwarmAlertTemplate): string => {
          return template.id;
        },
      ),
    );
    for (const id of [
      ...DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS,
      ...DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS,
      ...DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS,
    ]) {
      expect(registry.has(id)).toBe(true);
    }

    // A node's alerts are the ones that name a node.
    for (const id of DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS) {
      expect(templateGroupsBy(id)).toEqual(["resource.docker.swarm.node.name"]);
    }
    // A task's alerts name its container.
    for (const id of DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS) {
      expect(templateGroupsBy(id)).toEqual(["resource.container.name"]);
    }
    // A service's: its replicas first, then its tasks'.
    expect(DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS).toEqual([
      "docker-swarm-service-replicas-mismatch",
      ...DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS,
    ]);
    expect(templateGroupsBy("docker-swarm-service-replicas-mismatch")).toEqual([
      "resource.docker.swarm.service.name",
    ]);
  });

  test("the heartbeat watches the whole swarm, so no part's card lists it", () => {
    for (const ids of [
      DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS,
      DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS,
      DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS,
    ]) {
      expect(ids).not.toContain("docker-swarm-cluster-stopped-reporting");
    }
  });

  test("a task's bars turn amber at its alerts' lines", () => {
    expect(DOCKER_SWARM_TASK_METRIC_THRESHOLDS).toEqual({
      cpu: { warning: DOCKER_SWARM_TASK_CPU_WARNING_PERCENT },
      memory: { warning: DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT },
    });
  });
});

describe("badges", () => {
  test("a node's role: the leader, a manager, a worker", () => {
    expect(
      getDockerSwarmRoleBadge(
        row({
          kind: "Node",
          role: "manager",
          attributes: { managerStatus: "Leader" },
        }),
      ).label,
    ).toBe("Leader");
    expect(
      getDockerSwarmRoleBadge(
        row({
          kind: "Node",
          role: "manager",
          attributes: { managerStatus: "Reachable" },
        }),
      ).label,
    ).toBe("Manager node");
    expect(
      getDockerSwarmRoleBadge(row({ kind: "Node", role: "worker" })),
    ).toEqual({ key: "role", label: "Worker node", tone: "neutral" });
  });

  test("a service's mode, and a job as a job", () => {
    expect(
      getDockerSwarmModeBadge(row({ serviceMode: "replicated" }))?.label,
    ).toBe("Replicated");
    expect(getDockerSwarmModeBadge(row({ serviceMode: "global" }))?.label).toBe(
      "Global",
    );
    expect(
      getDockerSwarmModeBadge(row({ serviceMode: "global-job" }))?.label,
    ).toBe("Job");
    expect(getDockerSwarmModeBadge(row({ serviceMode: "" }))).toBeNull();
  });

  test("a service whose update was rolled back says so, however long ago", () => {
    expect(
      getDockerSwarmRollbackBadge(
        row({ attributes: { updateState: "rollback_completed" } }),
      )?.label,
    ).toBe("Rolled back");
    expect(
      getDockerSwarmRollbackBadge(
        row({ attributes: { updateState: "completed" } }),
      ),
    ).toBeNull();
  });
});

describe("facts", () => {
  test("CPUs as Docker counts them, and a container id as docker ps writes it", () => {
    expect(formatDockerSwarmCpus(4)).toBe("4");
    expect(formatDockerSwarmCpus(0.5)).toBe("0.5");
    expect(formatDockerSwarmCpus(1.254)).toBe("1.25");
    expect(formatDockerSwarmCpus(2.004)).toBe("2");
    expect(shortDockerSwarmContainerId("0123456789abcdef0123")).toBe(
      "0123456789ab",
    );
    expect(shortDockerSwarmContainerId("abc")).toBe("abc");
    expect(
      getDockerSwarmCount(
        row({ attributes: { recentFailedTasks: "3" } }),
        "recentFailedTasks",
      ),
    ).toBe(3);
    expect(
      getDockerSwarmCount(row({ attributes: {} }), "recentFailedTasks"),
    ).toBeNull();
  });
});

describe("a list's row reads by the rules", () => {
  const NOW: Date = new Date();

  test("a service short of replicas: its status, amber, and only the reasons its status does not say", () => {
    const service: DockerSwarmResource = row({
      kind: "Service",
      externalId: "service/web",
      name: "shop_web",
      serviceMode: "replicated",
      runningReplicas: 2,
      desiredReplicas: 3,
      attributes: { updateState: "paused" },
    });
    const resource: InfrastructureResource = withDockerSwarmStatus(
      toInfrastructureResource(service),
      service,
      NOW,
    );
    expect(resource.status).toBe("{{running}} of {{desired}} running");
    expect(resource.statusText).toEqual({
      text: "{{running}} of {{desired}} running",
      values: { running: "2", desired: "3" },
    });
    expect(resource.statusTone).toBe("warning");
    expect(resource.statusReasons).toEqual([{ text: "Update paused" }]);
  });

  test("a task's readings are its own, and none once they are stale", () => {
    const fresh: DockerSwarmResource = row({
      kind: "Task",
      externalId: "task/t1",
      name: "shop_web.1",
      state: "running",
      latestCpuPercent: 42,
      latestMemoryBytes: 1024,
      latestMemoryPercent: 12,
      metricsUpdatedAt: new Date(NOW.getTime() - 60 * 1000),
      attributes: { desiredState: "running" },
    });
    const resource: InfrastructureResource = withDockerSwarmStatus(
      toInfrastructureResource(fresh),
      fresh,
      NOW,
    );
    expect(resource.cpuUtilization).toBe(42);
    expect(resource.memoryUsageBytes).toBe(1024);
    expect(resource.memoryUtilization).toBe(12);
    expect(resource.statusTone).toBe("positive");

    const stale: DockerSwarmResource = row({
      ...fresh,
      kind: "Task",
      metricsUpdatedAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    const staleResource: InfrastructureResource = withDockerSwarmStatus(
      toInfrastructureResource(stale),
      stale,
      NOW,
    );
    expect(staleResource.cpuUtilization).toBeNull();
    expect(staleResource.memoryUtilization).toBeNull();
  });

  test("a kind with no rules keeps the row as it was", () => {
    const stack: DockerSwarmResource = row({
      kind: "Stack",
      externalId: "stack/shop",
      name: "shop",
      state: "3 services",
    });
    const resource: InfrastructureResource = toInfrastructureResource(stack);
    expect(withDockerSwarmStatus(resource, stack, NOW)).toBe(resource);
  });
});
