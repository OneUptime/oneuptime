import { describe, expect, test } from "@jest/globals";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";
import { Translator } from "../../../Types/Translator";
import { withSentenceDigits } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/SentenceDigits";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import {
  DockerSwarmAlertTemplate,
  getDockerSwarmAlertTemplateById,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import {
  DOCKER_SWARM_ATTENTION_KIND_ORDER,
  DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
  DOCKER_SWARM_FAILED_TASKS_WARNING,
  DOCKER_SWARM_READINGS_STALE_MS,
  DOCKER_SWARM_ROLLBACK_RECENT_MS,
  DOCKER_SWARM_SNAPSHOT_SPREAD_MS,
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
  DockerSwarmAssessment,
  DockerSwarmManagerQuorum,
  DockerSwarmNodeLoad,
  DockerSwarmPartKind,
  assessDockerSwarmNode,
  assessDockerSwarmResource,
  assessDockerSwarmService,
  assessDockerSwarmTask,
  countDockerSwarmTasks,
  getDockerSwarmAttentionItems,
  getDockerSwarmAttentionKey,
  getDockerSwarmFailingTaskItems,
  getDockerSwarmHealth,
  getDockerSwarmNodesNotReadyItems,
  getDockerSwarmIssueTarget,
  getDockerSwarmManagerQuorum,
  getDockerSwarmManagersOutOfReachItems,
  getDockerSwarmNodeLoad,
  getDockerSwarmQuorumItem,
  getDockerSwarmNodeRows,
  getDockerSwarmServiceRows,
  getDockerSwarmStatusReasons,
  getDockerSwarmTaskId,
  getDockerSwarmTaskReadings,
  getDockerSwarmTopologyHealth,
  isCurrentDockerSwarmTask,
  isDockerSwarmIssueAbout,
  isDockerSwarmJobService,
  isDockerSwarmManagerOutOfReach,
  keepLatestDockerSwarmSnapshot,
  sortDockerSwarmNodesForGlance,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";

/*
 * What on a Docker Swarm needs someone, and how bad it is: the one set of
 * rules the cluster's health pill and Needs attention card, a node's, a
 * service's and a task's page, the Nodes, Services and Tasks lists and the
 * Topology read (Pages/DockerSwarm/Utils/DockerSwarmHealth). Each rule is
 * Docker's own: `docker node ls`'s STATUS and MANAGER STATUS, `docker
 * service ls`'s REPLICAS 2/3, `docker service ps`'s CURRENT STATE and ERROR.
 * A wrong rule fails quietly - a crash-looping service that reads full, a
 * drained node in red - so each is pinned here.
 */

const NOW: Date = new Date("2026-11-02T12:00:00.000Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

type RowInit = Partial<{
  kind: string;
  externalId: string;
  name: string;
  state: string;
  role: string;
  // Undefined is a node that has not said yet: its own case.
  isReady: boolean | undefined;
  serviceMode: string;
  runningReplicas: number;
  desiredReplicas: number;
  serviceName: string;
  nodeHostname: string;
  stackName: string;
  latestCpuPercent: number;
  latestMemoryBytes: number;
  latestMemoryPercent: number;
  metricsUpdatedAt: Date;
  lastSeenAt: Date;
  attributes: Record<string, unknown>;
}>;

function row(init: RowInit): DockerSwarmResource {
  const model: DockerSwarmResource = new DockerSwarmResource();
  Object.assign(model, init);
  return model;
}

function node(name: string, init: RowInit = {}): DockerSwarmResource {
  return row({
    kind: "Node",
    externalId: `node/${name}-id`,
    name: name,
    state: "ready",
    role: "worker",
    isReady: true,
    lastSeenAt: minutesBefore(1),
    ...init,
    attributes: { availability: "active", ...(init.attributes || {}) },
  });
}

function manager(
  name: string,
  managerStatus: string,
  init: RowInit = {},
): DockerSwarmResource {
  return node(name, {
    role: "manager",
    ...init,
    attributes: {
      managerStatus: managerStatus,
      isLeader: managerStatus === "Leader",
      ...(init.attributes || {}),
    },
  });
}

function service(name: string, init: RowInit = {}): DockerSwarmResource {
  return row({
    kind: "Service",
    externalId: `service/${name}-id`,
    name: name,
    serviceMode: "replicated",
    runningReplicas: 3,
    desiredReplicas: 3,
    lastSeenAt: minutesBefore(1),
    ...init,
  });
}

function task(name: string, init: RowInit = {}): DockerSwarmResource {
  return row({
    kind: "Task",
    externalId: `task/${name}-id`,
    name: name,
    state: "running",
    serviceName: name.split(".")[0] || name,
    nodeHostname: "worker-1",
    lastSeenAt: minutesBefore(1),
    ...init,
    attributes: { desiredState: "running", ...(init.attributes || {}) },
  });
}

function routeFor(kind: DockerSwarmPartKind, externalId: string): Route {
  return new Route(`/swarm/${kind.toLowerCase()}/${externalId}`);
}

function texts(reasons: Array<ResourceAttentionText>): Array<string> {
  return reasons.map((reason: ResourceAttentionText): string => {
    return reason.text;
  });
}

function keys(items: Array<ResourceAttentionItem>): Array<string> {
  return items.map((item: ResourceAttentionItem): string => {
    return item.key;
  });
}

function record(seriesLabels: Record<string, string>): OpenIssueRecord {
  return { seriesLabels: seriesLabels } as unknown as OpenIssueRecord;
}

// The template a rule's line is taken from, read at its firing threshold.
function firingValue(templateId: string): number {
  const template: DockerSwarmAlertTemplate | undefined =
    getDockerSwarmAlertTemplateById(templateId);
  expect(template).toBeDefined();
  const step: MonitorStep = template!.getMonitorStep({
    clusterIdentifier: "swarm-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Swarm",
  });
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  return (instances[0]!.data!.filters[0] as { value: number }).value;
}

describe("the lines the pages colour at are the alerts' lines", () => {
  test("a task's memory turns amber where High Task Memory Usage fires, its CPU where High Task CPU Usage does", () => {
    expect(DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT).toBe(
      firingValue("docker-swarm-high-memory"),
    );
    expect(DOCKER_SWARM_TASK_CPU_WARNING_PERCENT).toBe(
      firingValue("docker-swarm-high-cpu"),
    );
  });

  test("readings go stale when the cleanup would remove the row, and a snapshot's rows sit within two minutes", () => {
    expect(DOCKER_SWARM_READINGS_STALE_MS).toBe(15 * 60 * 1000);
    expect(DOCKER_SWARM_SNAPSHOT_SPREAD_MS).toBe(2 * 60 * 1000);
    expect(DOCKER_SWARM_ROLLBACK_RECENT_MS).toBe(24 * 60 * 60 * 1000);
    expect(DOCKER_SWARM_FAILED_TASKS_WARNING).toBe(3);
  });
});

describe("a node, as docker node ls reads it", () => {
  test("ready and active: Ready in green, nothing to say", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-1"),
    );
    expect(assessment.status).toEqual({ label: "Ready", tone: "positive" });
    expect(assessment.severity).toBeNull();
    expect(assessment.reasons).toEqual([]);
  });

  test("down or disconnected: critical, in red, with Swarm's message", () => {
    const down: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-2", {
        state: "down",
        isReady: false,
        attributes: { message: "heartbeat failure" },
      }),
    );
    expect(down.status).toEqual({ label: "Down", tone: "danger" });
    expect(down.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(down.reasons)).toEqual(["Down"]);
    expect(down.message).toBe("heartbeat failure");

    const disconnected: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-3", { state: "disconnected", isReady: false }),
    );
    expect(disconnected.status).toEqual({
      label: "Disconnected",
      tone: "danger",
    });
    expect(disconnected.severity).toBe(ResourceAttentionSeverity.Critical);
  });

  test("a state Swarm does not know is a warning, not an outage", () => {
    const unknown: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-4", { state: "unknown" }),
    );
    expect(unknown.status).toEqual({ label: "State unknown", tone: "warning" });
    expect(unknown.severity).toBe(ResourceAttentionSeverity.Warning);
  });

  test("drained or paused is routine: grey, never in Needs attention", () => {
    for (const [availability, label] of [
      ["drain", "Drained"],
      ["pause", "Paused"],
    ]) {
      const assessment: DockerSwarmAssessment = assessDockerSwarmNode(
        node("worker-5", { attributes: { availability: availability } }),
      );
      expect(assessment.status).toEqual({ label: label, tone: "neutral" });
      expect(assessment.severity).toBeNull();
    }
  });

  test("a message Swarm keeps for a ready node is not shown as trouble", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-1", { attributes: { message: "all good" } }),
    );
    expect(assessment.message).toBeUndefined();
  });

  test("an older agent's row without a state still reads down when it is not ready", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmNode(
      node("worker-6", { state: "", isReady: false }),
    );
    expect(assessment.status.label).toBe("Down");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(
      assessDockerSwarmNode(row({ kind: "Node", name: "new" })).status,
    ).toEqual({ label: "No data yet", tone: "neutral" });
  });

  test("a manager the others cannot reach is critical even while its node reads ready", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmNode(
      manager("manager-2", "Unreachable"),
    );
    expect(assessment.status).toEqual({ label: "Unreachable", tone: "danger" });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment.reasons)).toEqual(["Manager unreachable"]);
    // A down manager says Down, and why it matters to the managers too.
    const down: DockerSwarmAssessment = assessDockerSwarmNode(
      manager("manager-3", "Unreachable", { state: "down", isReady: false }),
    );
    expect(down.status.label).toBe("Down");
    expect(texts(down.reasons)).toEqual(["Down", "Manager unreachable"]);
  });

  test("a worker never reads unreachable: only managers have a standing", () => {
    expect(
      assessDockerSwarmNode(
        node("worker-1", { attributes: { managerStatus: "Unreachable" } }),
      ).severity,
    ).toBeNull();
  });
});

describe("a service, as docker service ls reads its REPLICAS", () => {
  test("every replica running: 3 of 3 running in green", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web"),
      NOW,
    );
    expect(assessment.status).toEqual({
      label: "{{running}} of {{desired}} running",
      tone: "positive",
      values: { running: "3", desired: "3" },
    });
    expect(assessment.severity).toBeNull();
  });

  test("none running: critical, in red, with the newest failed task's error", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_db", {
        runningReplicas: 0,
        desiredReplicas: 1,
        attributes: { lastTaskError: "task: non-zero exit (1)" },
      }),
      NOW,
    );
    expect(assessment.status.tone).toBe("danger");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      {
        text: "None of its {{desired}} replicas run",
        values: { desired: "1" },
      },
    ]);
    expect(assessment.message).toBe("task: non-zero exit (1)");
  });

  test("short with no rolling update to explain it: a warning, 2 of 3 replicas run", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", { runningReplicas: 2 }),
      NOW,
    );
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      {
        text: "{{running}} of {{desired}} replicas run",
        values: { running: "2", desired: "3" },
      },
    ]);
  });

  test("short during a rolling update: Updating in grey, no warning", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", {
        runningReplicas: 2,
        attributes: { updateState: "updating" },
      }),
      NOW,
    );
    expect(assessment.status).toEqual({ label: "Updating", tone: "neutral" });
    expect(assessment.severity).toBeNull();
  });

  test("a rolling update that paused: a warning with Docker's update message", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", {
        attributes: {
          updateState: "paused",
          updateMessage: "update paused due to failure or early termination",
          lastTaskError: "older task error",
        },
      }),
      NOW,
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(assessment.reasons)).toEqual(["Update paused"]);
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.message).toBe(
      "update paused due to failure or early termination",
    );
  });

  test("rolling back and a paused rollback need a look", () => {
    expect(
      texts(
        assessDockerSwarmService(
          service("shop_web", {
            attributes: { updateState: "rollback_started" },
          }),
          NOW,
        ).reasons,
      ),
    ).toEqual(["Rolling back"]);
    expect(
      texts(
        assessDockerSwarmService(
          service("shop_web", {
            attributes: { updateState: "rollback_paused" },
          }),
          NOW,
        ).reasons,
      ),
    ).toEqual(["Rollback paused"]);
  });

  test("a rollback is worth a look for a day, then it is history", () => {
    const recent: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", {
        attributes: {
          updateState: "rollback_completed",
          updateCompletedAt: minutesBefore(60).toISOString(),
        },
      }),
      NOW,
    );
    expect(texts(recent.reasons)).toEqual(["Update rolled back"]);
    expect(recent.severity).toBe(ResourceAttentionSeverity.Warning);

    const old: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", {
        attributes: {
          updateState: "rollback_completed",
          updateCompletedAt: minutesBefore(25 * 60).toISOString(),
        },
      }),
      NOW,
    );
    expect(old.reasons).toEqual([]);
    expect(old.severity).toBeNull();
  });

  test("a crash loop reads full but needs a look: three failed tasks in the hour", () => {
    const loop: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_worker", {
        attributes: {
          recentFailedTasks: "4",
          lastTaskError: "task: non-zero exit (137)",
        },
      }),
      NOW,
    );
    expect(loop.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(loop.status.tone).toBe("warning");
    expect(loop.reasons).toEqual([
      {
        text: "{{count}} failed tasks in the last hour",
        plural: { one: "{{count}} failed task in the last hour", count: 4 },
      },
    ]);
    expect(loop.message).toBe("task: non-zero exit (137)");

    // Three is a loop; two is a hiccup.
    expect(
      assessDockerSwarmService(
        service("shop_worker", {
          attributes: {
            recentFailedTasks: String(DOCKER_SWARM_FAILED_TASKS_WARNING),
          },
        }),
        NOW,
      ).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessDockerSwarmService(
        service("shop_worker", { attributes: { recentFailedTasks: "2" } }),
        NOW,
      ).severity,
    ).toBeNull();
  });

  test("scaled to zero, or no word yet, is never a problem", () => {
    expect(
      assessDockerSwarmService(
        service("shop_batch", { runningReplicas: 0, desiredReplicas: 0 }),
        NOW,
      ),
    ).toMatchObject({
      status: { label: "Scaled to zero", tone: "neutral" },
      severity: null,
    });
    expect(
      assessDockerSwarmService(
        row({ kind: "Service", name: "fresh", serviceMode: "replicated" }),
        NOW,
      ).status,
    ).toEqual({ label: "No data yet", tone: "neutral" });
  });

  test("a job runs to completion: Running, then Completed, never short of replicas", () => {
    for (const mode of ["replicated-job", "global-job"]) {
      expect(isDockerSwarmJobService({ serviceMode: mode })).toBe(true);
      expect(
        assessDockerSwarmService(
          service("migrate", {
            serviceMode: mode,
            runningReplicas: 0,
            desiredReplicas: 1,
          }),
          NOW,
        ),
      ).toMatchObject({
        status: { label: "Completed", tone: "neutral" },
        severity: null,
      });
      expect(
        assessDockerSwarmService(
          service("migrate", {
            serviceMode: mode,
            runningReplicas: 1,
            desiredReplicas: 1,
          }),
          NOW,
        ).status,
      ).toEqual({ label: "Running", tone: "positive" });
    }
    expect(isDockerSwarmJobService({ serviceMode: "replicated" })).toBe(false);
  });
});

describe("a task, as docker service ps reads it", () => {
  test("running: Running in green", () => {
    expect(assessDockerSwarmTask(task("shop_web.1"), NOW)).toMatchObject({
      status: { label: "Running", tone: "positive" },
      severity: null,
    });
  });

  test("failed, rejected or orphaned: a warning (Swarm replaces it), with Docker's error", () => {
    const failed: DockerSwarmAssessment = assessDockerSwarmTask(
      task("shop_web.2", {
        state: "failed",
        attributes: { error: "task: non-zero exit (1)" },
      }),
      NOW,
    );
    expect(failed.status).toEqual({ label: "Failed", tone: "danger" });
    expect(failed.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(failed.message).toBe("task: non-zero exit (1)");

    expect(
      assessDockerSwarmTask(task("shop_web.3", { state: "rejected" }), NOW)
        .status,
    ).toEqual({ label: "Rejected", tone: "danger" });
    const orphaned: DockerSwarmAssessment = assessDockerSwarmTask(
      task("shop_web.4", { state: "orphaned" }),
      NOW,
    );
    expect(orphaned.status).toEqual({ label: "Orphaned", tone: "warning" });
    expect(texts(orphaned.reasons)).toEqual(["Node lost"]);
  });

  test("pending with an error is a task no node can run; pending without one is Swarm placing it", () => {
    const stuck: DockerSwarmAssessment = assessDockerSwarmTask(
      task("shop_web.5", {
        state: "pending",
        attributes: {
          error: "no suitable node (insufficient resources on 3 nodes)",
        },
      }),
      NOW,
    );
    expect(stuck.status).toEqual({ label: "Pending", tone: "warning" });
    expect(stuck.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(stuck.message).toBe(
      "no suitable node (insufficient resources on 3 nodes)",
    );

    expect(
      assessDockerSwarmTask(task("shop_web.6", { state: "pending" }), NOW),
    ).toMatchObject({
      status: { label: "Pending", tone: "neutral" },
      severity: null,
    });
  });

  test("on its way up, shut down or complete: grey, nothing to say", () => {
    for (const state of [
      "new",
      "allocated",
      "assigned",
      "accepted",
      "ready",
      "preparing",
      "starting",
    ]) {
      expect(
        assessDockerSwarmTask(task("shop_web.7", { state: state }), NOW),
      ).toMatchObject({
        status: { label: "Starting", tone: "neutral" },
        severity: null,
      });
    }
    expect(
      assessDockerSwarmTask(task("shop_web.8", { state: "shutdown" }), NOW)
        .status.label,
    ).toBe("Shut down");
    expect(
      assessDockerSwarmTask(task("shop_web.9", { state: "complete" }), NOW)
        .status.label,
    ).toBe("Complete");
  });

  test("close to its memory limit: a warning past the alert's line, from a fresh reading only", () => {
    const hot: DockerSwarmAssessment = assessDockerSwarmTask(
      task("shop_web.1", {
        latestMemoryPercent: 91.4,
        metricsUpdatedAt: minutesBefore(1),
      }),
      NOW,
    );
    expect(hot.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(hot.status).toEqual({ label: "Running", tone: "warning" });
    expect(hot.reasons).toEqual([
      {
        text: "Memory at {{percent}} of its limit",
        values: { percent: "91%" },
      },
    ]);

    // At the line is not past it.
    expect(
      assessDockerSwarmTask(
        task("shop_web.1", {
          latestMemoryPercent: DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
          metricsUpdatedAt: minutesBefore(1),
        }),
        NOW,
      ).severity,
    ).toBeNull();
    // A reading older than the cleanup keeps a row is no reading.
    expect(
      assessDockerSwarmTask(
        task("shop_web.1", {
          latestMemoryPercent: 99,
          metricsUpdatedAt: minutesBefore(16),
        }),
        NOW,
      ).severity,
    ).toBeNull();
  });

  test("a busy CPU is never a reason by itself: a task may use several cores by design", () => {
    expect(
      assessDockerSwarmTask(
        task("shop_web.1", {
          latestCpuPercent: 350,
          metricsUpdatedAt: minutesBefore(1),
        }),
        NOW,
      ).severity,
    ).toBeNull();
  });

  test("other kinds have no rules", () => {
    expect(
      assessDockerSwarmResource(row({ kind: "Stack", name: "shop" }), NOW),
    ).toBeNull();
  });
});

describe("the readings a page may show", () => {
  test("fresh readings are shown; ones older than 15 minutes are none", () => {
    expect(
      getDockerSwarmTaskReadings(
        task("shop_web.1", {
          latestCpuPercent: 12.5,
          latestMemoryBytes: 1024,
          latestMemoryPercent: 40,
          metricsUpdatedAt: minutesBefore(14),
        }),
        NOW,
      ),
    ).toEqual({ cpuPercent: 12.5, memoryBytes: 1024, memoryPercent: 40 });
    expect(
      getDockerSwarmTaskReadings(
        task("shop_web.1", {
          latestCpuPercent: 12.5,
          metricsUpdatedAt: minutesBefore(16),
        }),
        NOW,
      ),
    ).toEqual({ cpuPercent: null, memoryBytes: null, memoryPercent: null });
    expect(getDockerSwarmTaskReadings(task("shop_web.1"), NOW).cpuPercent).toBe(
      null,
    );
  });
});

describe("the managers' majority", () => {
  test("three managers stand the loss of one: one unreachable leaves none to lose", () => {
    const quorum: DockerSwarmManagerQuorum | null = getDockerSwarmManagerQuorum(
      [
        manager("manager-1", "Leader"),
        manager("manager-2", "Reachable"),
        manager("manager-3", "Unreachable"),
        node("worker-1"),
      ],
    );
    expect(quorum).toEqual({
      total: 3,
      reachable: 2,
      majority: 2,
      hasQuorum: true,
      canLose: 0,
    });
  });

  test("two of three gone: the majority is lost", () => {
    const quorum: DockerSwarmManagerQuorum | null = getDockerSwarmManagerQuorum(
      [
        manager("manager-1", "Leader"),
        manager("manager-2", "Unreachable"),
        manager("manager-3", "Reachable", { state: "down", isReady: false }),
      ],
    );
    expect(quorum?.hasQuorum).toBe(false);
    expect(quorum?.reachable).toBe(1);
  });

  test("a swarm of workers only (an inventory without its managers) has no majority to tell", () => {
    expect(getDockerSwarmManagerQuorum([node("worker-1")])).toBeNull();
  });
});

describe("Needs attention", () => {
  const rows: Array<DockerSwarmResource> = [
    manager("manager-1", "Leader"),
    manager("manager-2", "Reachable"),
    manager("manager-3", "Unreachable"),
    node("worker-1"),
    node("worker-2", { state: "down", isReady: false }),
    node("worker-3", { attributes: { availability: "drain" } }),
    service("shop_web", { runningReplicas: 2 }),
    service("shop_db", { runningReplicas: 0, desiredReplicas: 1 }),
    service("shop_cache"),
    task("shop_web.1"),
    task("shop_web.2", { state: "failed" }),
    // A task whose service the inventory does not hold.
    task("orphan_svc.1", {
      state: "rejected",
      serviceName: "orphan_svc",
      nodeHostname: "worker-1",
    }),
    // A task a rolling update replaced: Swarm no longer wants it.
    task("shop_cache.1", {
      state: "failed",
      attributes: { desiredState: "shutdown" },
    }),
  ];

  test("the Overview lists the swarm, its nodes and services, critical first, and a task only when its service is not listed", () => {
    const items: Array<ResourceAttentionItem> = getDockerSwarmAttentionItems({
      rows: rows,
      clusterName: "prod-swarm",
      routeFor: routeFor,
      now: NOW,
    });
    expect(keys(items)).toEqual([
      "Node:node/manager-3-id",
      "Node:node/worker-2-id",
      "Service:service/shop_db-id",
      DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
      "Service:service/shop_web-id",
      "Task:task/orphan_svc.1-id",
    ]);
    expect(DOCKER_SWARM_ATTENTION_KIND_ORDER).toEqual([
      "Swarm",
      "Node",
      "Service",
      "Task",
    ]);

    const swarm: ResourceAttentionItem = items[3]!;
    expect(swarm).toMatchObject({
      kind: "Swarm",
      icon: IconProp.DockerSwarm,
      name: "prod-swarm",
      severity: ResourceAttentionSeverity.Warning,
    });
    expect(swarm.reasons).toEqual([
      { text: "Can lose no more managers" },
      {
        text: "{{reachable}} of {{total}} managers reachable",
        values: { reachable: "2", total: "3" },
      },
    ]);
    // A task says the node it was placed on, and each row is one step from its page.
    expect(items[5]!.detail).toBe("worker-1");
    expect(items[1]!.route?.toString()).toBe("/swarm/node/node/worker-2-id");
    expect(getDockerSwarmHealth(items)).toBe("Unhealthy");
  });

  test("a part's page lists its own row and every current task", () => {
    const serviceRows: Array<DockerSwarmResource> = getDockerSwarmServiceRows({
      rows: rows,
      service: rows[6]!,
    });
    expect(
      serviceRows.map((candidate: DockerSwarmResource): string => {
        return candidate.externalId || "";
      }),
    ).toEqual([
      "service/shop_web-id",
      "task/shop_web.1-id",
      "task/shop_web.2-id",
    ]);

    const items: Array<ResourceAttentionItem> = getDockerSwarmAttentionItems({
      rows: serviceRows,
      routeFor: routeFor,
      now: NOW,
      scope: "part",
    });
    expect(keys(items)).toEqual([
      "Service:service/shop_web-id",
      "Task:task/shop_web.2-id",
    ]);
    expect(items[0]!.key).toBe(
      getDockerSwarmAttentionKey("Service", "service/shop_web-id"),
    );
  });

  test("the majority lost is critical; a swarm with a manager to spare says nothing", () => {
    const lost: Array<ResourceAttentionItem> = getDockerSwarmAttentionItems({
      rows: [
        manager("manager-1", "Leader"),
        manager("manager-2", "Unreachable"),
        manager("manager-3", "Unreachable"),
      ],
      clusterName: "prod-swarm",
      routeFor: routeFor,
      now: NOW,
    });
    expect(lost[0]!.key).toBe(DOCKER_SWARM_CLUSTER_ATTENTION_KEY);
    expect(lost[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(lost[0]!.reasons)).toEqual([
      "Manager quorum lost",
      "{{reachable}} of {{total}} managers reachable",
    ]);

    // Five managers, one unreachable: it can lose one more.
    const spare: Array<ResourceAttentionItem> = getDockerSwarmAttentionItems({
      rows: [
        manager("manager-1", "Leader"),
        manager("manager-2", "Reachable"),
        manager("manager-3", "Reachable"),
        manager("manager-4", "Reachable"),
        manager("manager-5", "Unreachable"),
      ],
      clusterName: "prod-swarm",
      routeFor: routeFor,
      now: NOW,
    });
    expect(keys(spare)).toEqual(["Node:node/manager-5-id"]);

    // One manager, reachable: a small swarm is not nagged about it.
    expect(
      getDockerSwarmAttentionItems({
        rows: [manager("manager-1", "Leader")],
        routeFor: routeFor,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a healthy swarm is Healthy; a warning alone makes it Degraded", () => {
    expect(
      getDockerSwarmHealth(
        getDockerSwarmAttentionItems({
          rows: [manager("manager-1", "Leader"), service("shop_web")],
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Healthy");
    expect(
      getDockerSwarmHealth(
        getDockerSwarmAttentionItems({
          rows: [service("shop_web", { runningReplicas: 2 })],
          routeFor: routeFor,
          now: NOW,
        }),
      ),
    ).toBe("Degraded");
  });
});

describe("a list row's reasons are the ones its status does not already say", () => {
  test("2 of 3 running drops its own reason; a paused update stays", () => {
    const assessment: DockerSwarmAssessment = assessDockerSwarmService(
      service("shop_web", {
        runningReplicas: 2,
        attributes: { updateState: "paused" },
      }),
      NOW,
    );
    expect(texts(assessment.reasons)).toEqual([
      "{{running}} of {{desired}} replicas run",
      "Update paused",
    ]);
    expect(texts(getDockerSwarmStatusReasons(assessment))).toEqual([
      "Update paused",
    ]);
  });

  test("Unreachable does not repeat Manager unreachable; Down keeps it", () => {
    expect(
      getDockerSwarmStatusReasons(
        assessDockerSwarmNode(manager("manager-2", "Unreachable")),
      ),
    ).toEqual([]);
    expect(
      texts(
        getDockerSwarmStatusReasons(
          assessDockerSwarmNode(
            manager("manager-2", "Unreachable", {
              state: "down",
              isReady: false,
            }),
          ),
        ),
      ),
    ).toEqual(["Manager unreachable"]);
  });
});

describe("the newest snapshot, and the tasks Swarm still wants", () => {
  test("rows the newest snapshot did not write are gone; a snapshot's spread is kept", () => {
    const kept: Array<DockerSwarmResource> = keepLatestDockerSwarmSnapshot([
      task("shop_web.1", { lastSeenAt: minutesBefore(1) }),
      task("shop_web.2", { lastSeenAt: minutesBefore(2.5) }),
      // Replaced by the rolling update: its last snapshot was 5 minutes ago.
      task("shop_web.3", { lastSeenAt: minutesBefore(6) }),
      row({ kind: "Stack", name: "no-date" }),
    ]);
    expect(
      kept.map((candidate: DockerSwarmResource): string => {
        return candidate.name || "";
      }),
    ).toEqual(["shop_web.1", "shop_web.2", "no-date"]);
  });

  test("a stopped poller's rows age together, and are kept: the swarm as it last was", () => {
    const rows: Array<DockerSwarmResource> = [
      node("worker-1", { lastSeenAt: minutesBefore(600) }),
      node("worker-2", { lastSeenAt: minutesBefore(601) }),
    ];
    expect(keepLatestDockerSwarmSnapshot(rows)).toHaveLength(2);
    expect(keepLatestDockerSwarmSnapshot([])).toEqual([]);
  });

  test("a current task is one Swarm wants running", () => {
    expect(isCurrentDockerSwarmTask(task("a.1"))).toBe(true);
    expect(
      isCurrentDockerSwarmTask(
        task("a.1", { attributes: { desiredState: "shutdown" } }),
      ),
    ).toBe(false);
    // An older agent sent no desired state: a shut-down task is not current.
    expect(
      isCurrentDockerSwarmTask(
        row({ kind: "Task", name: "a.2", state: "shutdown" }),
      ),
    ).toBe(false);
    expect(isCurrentDockerSwarmTask(node("worker-1"))).toBe(false);
  });

  test("counting a part's tasks counts the current ones, and those running", () => {
    expect(
      countDockerSwarmTasks([
        task("a.1"),
        task("a.2", { state: "starting" }),
        task("a.3", { attributes: { desiredState: "shutdown" } }),
        node("worker-1"),
      ]),
    ).toEqual({ running: 1, total: 2 });
  });
});

describe("a node at a glance", () => {
  test("its tasks' CPU against its CPUs and their memory against its memory", () => {
    const worker: DockerSwarmResource = node("worker-1", {
      attributes: { cpus: "4", memoryBytes: String(8 * 1024 * 1024 * 1024) },
    });
    const load: DockerSwarmNodeLoad = getDockerSwarmNodeLoad({
      rows: [
        worker,
        task("a.1", {
          latestCpuPercent: 150,
          latestMemoryBytes: 2 * 1024 * 1024 * 1024,
          metricsUpdatedAt: minutesBefore(1),
        }),
        task("b.1", {
          latestCpuPercent: 50,
          latestMemoryBytes: 2 * 1024 * 1024 * 1024,
          metricsUpdatedAt: minutesBefore(1),
        }),
        // Another node's task.
        task("c.1", {
          nodeHostname: "worker-2",
          latestCpuPercent: 400,
          metricsUpdatedAt: minutesBefore(1),
        }),
      ],
      node: worker,
      now: NOW,
    });
    expect(load.tasks).toEqual({ running: 2, total: 2 });
    expect(load.cpuPercentOfNode).toBe(50);
    expect(load.memoryPercentOfNode).toBe(50);
    expect(
      getDockerSwarmNodeRows({ rows: [worker, task("a.1")], node: worker }),
    ).toHaveLength(2);
  });

  test("no size (an agent older than files 0.161.3), no fresh reading or a node that is down: no bar", () => {
    const bare: DockerSwarmResource = node("worker-1");
    expect(
      getDockerSwarmNodeLoad({
        rows: [
          bare,
          task("a.1", {
            latestCpuPercent: 10,
            metricsUpdatedAt: minutesBefore(1),
          }),
        ],
        node: bare,
        now: NOW,
      }).cpuPercentOfNode,
    ).toBeNull();

    const down: DockerSwarmResource = node("worker-1", {
      state: "down",
      attributes: { cpus: "4" },
    });
    expect(
      getDockerSwarmNodeLoad({
        rows: [
          down,
          task("a.1", {
            latestCpuPercent: 10,
            metricsUpdatedAt: minutesBefore(1),
          }),
        ],
        node: down,
        now: NOW,
      }).cpuPercentOfNode,
    ).toBeNull();
  });

  test("the nodes in trouble first, then the leader and the managers, then the rest, as people number them", () => {
    const sorted: Array<DockerSwarmResource> = sortDockerSwarmNodesForGlance([
      node("worker-10"),
      node("worker-2"),
      manager("manager-2", "Reachable"),
      manager("manager-1", "Leader"),
      node("worker-9", { state: "unknown" }),
      node("worker-3", { state: "down", isReady: false }),
      service("not-a-node"),
    ]);
    expect(
      sorted.map((candidate: DockerSwarmResource): string => {
        return candidate.name || "";
      }),
    ).toEqual([
      "worker-3",
      "worker-9",
      "manager-1",
      "manager-2",
      "worker-2",
      "worker-10",
    ]);
  });
});

describe("the Topology colours a part by the same rules", () => {
  test("critical, warning, healthy, off and unknown", () => {
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmNode(node("w", { state: "down", isReady: false })),
      ),
    ).toBe("critical");
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmService(service("s", { runningReplicas: 2 }), NOW),
      ),
    ).toBe("warning");
    expect(getDockerSwarmTopologyHealth(assessDockerSwarmNode(node("w")))).toBe(
      "healthy",
    );
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmNode(
          node("w", { attributes: { availability: "drain" } }),
        ),
      ),
    ).toBe("off");
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmService(
          service("s", { runningReplicas: 0, desiredReplicas: 0 }),
          NOW,
        ),
      ),
    ).toBe("off");
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmService(
          service("s", { attributes: { updateState: "updating" } }),
          NOW,
        ),
      ),
    ).toBe("healthy");
    expect(
      getDockerSwarmTopologyHealth(
        assessDockerSwarmTask(task("a.1", { state: "starting" }), NOW),
      ),
    ).toBe("unknown");
  });
});

describe("which part an open incident or alert is about", () => {
  test("a task alert names its container: the service, the slot, the task id", () => {
    expect(
      getDockerSwarmIssueTarget(
        record({ "resource.container.name": "shop_web.2.k3x9q" }),
      ),
    ).toEqual({ serviceName: "shop_web", nodeName: null, taskId: "k3x9q" });
    // A global service's task is named after its node id; a dotted service name survives.
    expect(
      getDockerSwarmIssueTarget(
        record({ "container.name": "my.api.n0d3id.t4sk1d" }),
      ),
    ).toEqual({ serviceName: "my.api", nodeName: null, taskId: "t4sk1d" });
  });

  test("the node and the service alerts name them by their resource attributes", () => {
    expect(
      getDockerSwarmIssueTarget(
        record({ "resource.docker.swarm.node.name": "worker-2" }),
      ),
    ).toEqual({ serviceName: null, nodeName: "worker-2", taskId: null });
    expect(
      getDockerSwarmIssueTarget(
        record({ "resource.docker.swarm.service.name": "shop_web" }),
      ),
    ).toEqual({ serviceName: "shop_web", nodeName: null, taskId: null });
    expect(getDockerSwarmIssueTarget(record({ host: "x" }))).toBeNull();
  });

  test("a service is about its own alerts and its tasks'; a task only its own; a node not its tasks'", () => {
    const web: DockerSwarmResource = service("shop_web");
    const webTask: DockerSwarmResource = task("shop_web.2", {
      externalId: "task/k3x9q",
    });
    const worker: DockerSwarmResource = node("worker-2");

    const taskAlert: OpenIssueRecord = record({
      "resource.container.name": "shop_web.2.k3x9q",
      "resource.docker.swarm.node.name": "worker-2",
    });
    const nodeAlert: OpenIssueRecord = record({
      "resource.docker.swarm.node.name": "Worker-2",
    });
    const replicasAlert: OpenIssueRecord = record({
      "resource.docker.swarm.service.name": "shop_web",
    });

    expect(isDockerSwarmIssueAbout(taskAlert, web)).toBe(true);
    expect(isDockerSwarmIssueAbout(replicasAlert, web)).toBe(true);
    expect(isDockerSwarmIssueAbout(taskAlert, webTask)).toBe(true);
    expect(isDockerSwarmIssueAbout(replicasAlert, webTask)).toBe(false);
    expect(isDockerSwarmIssueAbout(nodeAlert, worker)).toBe(true);
    expect(isDockerSwarmIssueAbout(taskAlert, worker)).toBe(false);
    expect(isDockerSwarmIssueAbout(replicasAlert, service("shop_web_v2"))).toBe(
      false,
    );
    expect(getDockerSwarmTaskId(webTask)).toBe("k3x9q");
  });
});

/*
 * A reason's counts are kept as plain digits ("2", "3"): every place that
 * draws a reason fills its sentence through withSentenceDigits, which
 * writes a whole number in the sentence's own digits (issue #7107) - "۲
 * از ۳ رونوشت اجرا می‌شوند" on a Persian page, and English digits in a
 * sentence the reader's language has not worded yet.
 */
describe("a reason's counts, drawn in the sentence's digits", () => {
  const drawn: (
    translator: Translator,
    reason: ResourceAttentionText,
  ) => string = (
    translator: Translator,
    reason: ResourceAttentionText,
  ): string => {
    return withoutIsolateMarks(
      translator.translateTemplate(
        reason.text,
        withSentenceDigits(reason.values),
      ),
    );
  };

  test("a service short of replicas and the managers a swarm can reach, in Persian", () => {
    const persian: Translator = dashboardTranslator("fa");
    const short: ResourceAttentionText = assessDockerSwarmService(
      service("shop_web", { runningReplicas: 2 }),
      NOW,
    ).reasons[0]!;

    // Plain digits in the rules: the filter and the sort read them.
    expect(short.values).toEqual({ running: "2", desired: "3" });
    expect(drawn(persian, short)).toBe("۲ از ۳ رونوشت اجرا می‌شوند");

    const none: ResourceAttentionText = assessDockerSwarmService(
      service("shop_db", { runningReplicas: 0, desiredReplicas: 12 }),
      NOW,
    ).reasons[0]!;
    expect(drawn(persian, none)).toBe("هیچ‌یک از ۱۲ رونوشت آن اجرا نمی‌شود");

    const managers: ResourceAttentionText = {
      text: "{{reachable}} of {{total}} managers reachable",
      values: { reachable: "2", total: "3" },
    };
    expect(drawn(persian, managers)).toBe("۲ از ۳ مدیر در دسترس");
  });

  test("in English and Arabic, Latin digits", () => {
    const short: ResourceAttentionText = assessDockerSwarmService(
      service("shop_web", { runningReplicas: 2 }),
      NOW,
    ).reasons[0]!;

    expect(drawn(dashboardTranslator("en"), short)).toBe("2 of 3 replicas run");
    expect(drawn(dashboardTranslator("ar"), short)).toMatch(/2.*3/);
  });

  test("a sentence the reader's language has not worded yet keeps English digits", () => {
    expect(
      drawn(dashboardTranslator("fa"), {
        text: "{{running}} of {{desired}} replicas in a sentence no locale has",
        values: { running: "2", desired: "3" },
      }),
    ).toBe("2 of 3 replicas in a sentence no locale has");
  });
});

/*
 * "2/3 nodes ready" and "4/6 tasks running" said a part was wrong and never
 * which or why (#9594). The counts beside them open exactly those parts,
 * by the rules Needs attention uses.
 */
describe("what the hero's counts of what is wrong open", () => {
  test("the nodes not ready: each with why, Swarm's word and which one it is, a step from its page", () => {
    const rows: Array<DockerSwarmResource> = [
      node("worker-1"),
      node("worker-2", {
        state: "down",
        isReady: false,
        attributes: { message: "heartbeat failure", addr: "10.0.0.12" },
      }),
      manager("manager-2", "Unreachable", {
        state: "unknown",
        isReady: false,
      }),
      service("web"),
    ];

    const items: Array<ResourceAttentionItem> =
      getDockerSwarmNodesNotReadyItems({ rows: rows, routeFor: routeFor });

    // Both critical; by name, as people number them.
    expect(keys(items)).toEqual([
      "Node:node/manager-2-id",
      "Node:node/worker-2-id",
    ]);

    const unknown: ResourceAttentionItem = items[0]!;
    expect(unknown.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(unknown.reasons)).toEqual([
      "State unknown",
      "Manager unreachable",
    ]);
    // A manager says its role in Docker's own word.
    expect(unknown.facts).toEqual([
      { key: "role", label: "Role", value: "Unreachable" },
    ]);

    const down: ResourceAttentionItem = items[1]!;
    expect(down.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(down.reasons)).toEqual(["Down"]);
    expect(down.message).toBe("heartbeat failure");
    expect(down.route?.toString()).toBe("/swarm/node/node/worker-2-id");
    expect(down.facts).toEqual([
      { key: "address", label: "Address", value: "10.0.0.12" },
    ]);
  });

  test("a node with no state yet is listed with its status as its reason, never left out of its count", () => {
    const items: Array<ResourceAttentionItem> =
      getDockerSwarmNodesNotReadyItems({
        rows: [node("worker-3", { state: "", isReady: undefined })],
        routeFor: routeFor,
      });

    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(items[0]!.reasons)).toEqual(["No data yet"]);
  });

  test("every node ready: nothing to open", () => {
    expect(
      getDockerSwarmNodesNotReadyItems({
        rows: [node("worker-1"), manager("manager-1", "Leader")],
        routeFor: routeFor,
      }),
    ).toEqual([]);
  });

  test("the tasks failing: Docker's error, their service and node, each a step from its page", () => {
    const rows: Array<DockerSwarmResource> = [
      node("worker-1"),
      service("web"),
      service("db"),
      task("web.1", { state: "running" }),
      task("web.2", {
        state: "failed",
        attributes: {
          desiredState: "running",
          error: "task: non-zero exit (137)",
        },
      }),
      task("db.1", {
        state: "pending",
        nodeHostname: "",
        attributes: {
          desiredState: "running",
          error: "no suitable node (insufficient resources on 3 nodes)",
        },
      }),
      // Swarm is still placing it: no problem yet.
      task("db.2", { state: "pending", nodeHostname: "" }),
      // A task a slot replaced is history.
      task("web.3", {
        state: "failed",
        attributes: { desiredState: "shutdown", error: "old" },
      }),
      // Busy is not failing: the rules flag it, the count does not.
      task("web.4", {
        state: "running",
        latestMemoryPercent: 97,
        metricsUpdatedAt: minutesBefore(1),
      }),
    ];

    const items: Array<ResourceAttentionItem> = getDockerSwarmFailingTaskItems({
      rows: rows,
      routeFor: routeFor,
      now: NOW,
    });

    expect(keys(items).sort()).toEqual([
      "Task:task/db.1-id",
      "Task:task/web.2-id",
    ]);

    const failed: ResourceAttentionItem = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.key === "Task:task/web.2-id";
      },
    )!;
    expect(texts(failed.reasons)).toEqual(["Failed"]);
    expect(failed.message).toBe("task: non-zero exit (137)");
    // Its node is a fact, not the line under its name.
    expect(failed.detail).toBeUndefined();
    expect(
      (failed.facts || []).map(
        (fact: { key: string; value: string }): Array<string> => {
          return [fact.key, fact.value];
        },
      ),
    ).toEqual([
      ["service", "web"],
      ["node", "worker-1"],
    ]);
    expect(failed.facts![0]!.route?.toString()).toBe(
      "/swarm/service/service/web-id",
    );
    expect(failed.facts![1]!.route?.toString()).toBe(
      "/swarm/node/node/worker-1-id",
    );

    const pending: ResourceAttentionItem = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.key === "Task:task/db.1-id";
      },
    )!;
    expect(pending.message).toBe(
      "no suitable node (insufficient resources on 3 nodes)",
    );
    // Placed on no node yet: no node to name.
    expect(
      (pending.facts || []).map((fact: { key: string }): string => {
        return fact.key;
      }),
    ).toEqual(["service"]);
  });

  /*
   * "3 managers" said nothing while the swarm lost its majority (#9729):
   * it opens the managers the majority cannot count on, by the rule the
   * quorum counts them with, and the swarm's own row when that put the
   * majority at risk.
   */
  test("a manager is out of reach when its node is not Ready or the others cannot reach it", () => {
    expect(isDockerSwarmManagerOutOfReach(manager("m-1", "Leader"))).toBe(
      false,
    );
    expect(isDockerSwarmManagerOutOfReach(manager("m-2", "Reachable"))).toBe(
      false,
    );
    expect(isDockerSwarmManagerOutOfReach(manager("m-3", "Unreachable"))).toBe(
      true,
    );
    expect(
      isDockerSwarmManagerOutOfReach(
        manager("m-4", "Reachable", { state: "down", isReady: false }),
      ),
    ).toBe(true);
    expect(
      isDockerSwarmManagerOutOfReach(
        manager("m-5", "Reachable", { state: "unknown" }),
      ),
    ).toBe(true);
    // A worker has no standing among the managers.
    expect(
      isDockerSwarmManagerOutOfReach(
        node("worker-1", { state: "down", isReady: false }),
      ),
    ).toBe(false);
  });

  test("the managers out of reach: the majority lost first, then each manager with why, Docker's word and its address", () => {
    const rows: Array<DockerSwarmResource> = [
      manager("manager-1", "Leader"),
      manager("manager-2", "Unreachable", {
        attributes: { addr: "10.0.0.12" },
      }),
      manager("manager-3", "Reachable", {
        state: "down",
        isReady: false,
        attributes: { message: "heartbeat failure", addr: "10.0.0.13" },
      }),
      node("worker-1", { state: "down", isReady: false }),
      service("web"),
    ];

    const items: Array<ResourceAttentionItem> =
      getDockerSwarmManagersOutOfReachItems({
        rows: rows,
        clusterName: "prod-swarm",
        routeFor: routeFor,
      });

    // A worker that is down is the nodes count's, never a manager's.
    expect(keys(items)).toEqual([
      DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
      "Node:node/manager-2-id",
      "Node:node/manager-3-id",
    ]);

    const swarm: ResourceAttentionItem = items[0]!;
    expect(swarm.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(swarm.name).toBe("prod-swarm");
    expect(texts(swarm.reasons)).toEqual([
      "Manager quorum lost",
      "{{reachable}} of {{total}} managers reachable",
    ]);
    expect(swarm.reasons[1]!.values).toEqual({ reachable: "1", total: "3" });

    const unreachable: ResourceAttentionItem = items[1]!;
    expect(unreachable.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(unreachable.reasons)).toEqual(["Manager unreachable"]);
    expect(unreachable.facts).toEqual([
      { key: "role", label: "Role", value: "Unreachable" },
      { key: "address", label: "Address", value: "10.0.0.12" },
    ]);
    expect(unreachable.route?.toString()).toBe("/swarm/node/node/manager-2-id");

    const down: ResourceAttentionItem = items[2]!;
    expect(texts(down.reasons)).toEqual(["Down"]);
    expect(down.message).toBe("heartbeat failure");
    expect(down.facts).toEqual([
      { key: "role", label: "Role", value: "Reachable" },
      { key: "address", label: "Address", value: "10.0.0.13" },
    ]);
  });

  test("one manager from losing the majority: the swarm's row is a warning; with one to spare there is none", () => {
    const edge: Array<ResourceAttentionItem> =
      getDockerSwarmManagersOutOfReachItems({
        rows: [
          manager("manager-1", "Leader"),
          manager("manager-2", "Reachable"),
          manager("manager-3", "Unreachable"),
        ],
        clusterName: "prod-swarm",
        routeFor: routeFor,
      });
    // The unreachable manager is critical, so it comes first.
    expect(keys(edge)).toEqual([
      "Node:node/manager-3-id",
      DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
    ]);
    expect(edge[1]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(edge[1]!.reasons)).toEqual([
      "Can lose no more managers",
      "{{reachable}} of {{total}} managers reachable",
    ]);

    const spare: Array<ResourceAttentionItem> =
      getDockerSwarmManagersOutOfReachItems({
        rows: [
          manager("manager-1", "Leader"),
          manager("manager-2", "Reachable"),
          manager("manager-3", "Reachable"),
          manager("manager-4", "Reachable"),
          manager("manager-5", "Unreachable"),
        ],
        routeFor: routeFor,
      });
    expect(keys(spare)).toEqual(["Node:node/manager-5-id"]);
  });

  test("a manager in a state Swarm does not know is a warning, and one with no state yet says so", () => {
    const items: Array<ResourceAttentionItem> =
      getDockerSwarmManagersOutOfReachItems({
        rows: [
          manager("manager-1", "Leader"),
          manager("manager-2", "Reachable"),
          manager("manager-3", "Reachable"),
          manager("manager-4", "Reachable"),
          manager("manager-5", "Reachable", { state: "unknown" }),
          manager("manager-6", "Reachable"),
          manager("manager-7", "Reachable", { state: "", isReady: undefined }),
        ],
        routeFor: routeFor,
      });
    expect(keys(items)).toEqual([
      "Node:node/manager-5-id",
      "Node:node/manager-7-id",
    ]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(items[0]!.reasons)).toEqual(["State unknown"]);
    expect(items[1]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(items[1]!.reasons)).toEqual(["No data yet"]);
  });

  test("every manager in reach, or no manager reported: nothing to open", () => {
    expect(
      getDockerSwarmManagersOutOfReachItems({
        rows: [
          manager("manager-1", "Leader"),
          manager("manager-2", "Reachable"),
          node("worker-1", { state: "down", isReady: false }),
        ],
        routeFor: routeFor,
      }),
    ).toEqual([]);
    expect(
      getDockerSwarmManagersOutOfReachItems({
        rows: [node("worker-1")],
        routeFor: routeFor,
      }),
    ).toEqual([]);
  });

  test("Needs attention's swarm row is the managers list's own", () => {
    const rows: Array<DockerSwarmResource> = [
      manager("manager-1", "Leader"),
      manager("manager-2", "Unreachable"),
      manager("manager-3", "Unreachable"),
    ];
    const attention: Array<ResourceAttentionItem> =
      getDockerSwarmAttentionItems({
        rows: rows,
        clusterName: "prod-swarm",
        routeFor: routeFor,
        now: NOW,
      });
    expect(attention[0]).toEqual(
      getDockerSwarmQuorumItem({ rows: rows, clusterName: "prod-swarm" }),
    );
    expect(
      getDockerSwarmQuorumItem({
        rows: [manager("manager-1", "Leader")],
        clusterName: "prod-swarm",
      }),
    ).toBeNull();
  });

  test("a task whose service or node the inventory does not hold is named, a step from nowhere", () => {
    const items: Array<ResourceAttentionItem> = getDockerSwarmFailingTaskItems({
      rows: [
        task("api.1", {
          state: "rejected",
          nodeHostname: "gone-node",
          attributes: { desiredState: "running", error: "image not found" },
        }),
      ],
      routeFor: routeFor,
      now: NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.facts).toEqual([
      { key: "service", label: "Service", value: "api", route: undefined },
      { key: "node", label: "Node", value: "gone-node", route: undefined },
    ]);
  });
});
