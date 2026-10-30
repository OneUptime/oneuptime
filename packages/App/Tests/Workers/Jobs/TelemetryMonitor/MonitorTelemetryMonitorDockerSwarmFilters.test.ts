import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse, {
  DockerSwarmAffectedResource,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStepDockerSwarmMonitor, {
  DockerSwarmResourceFilters,
  MonitorStepDockerSwarmMonitorUtil,
  SWARM_TASK_SERVICE_ATTRIBUTE,
} from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
} from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What a Docker Swarm monitor's resource filters do to the query the worker
 * runs (MonitorTelemetryMonitor.monitorDockerSwarm), against the attributes
 * a Swarm task's metrics really carry.
 *
 * The bug: Service Name and Node Name could never match. The worker
 * filtered on `docker.swarm.service.name` / `docker.swarm.node.name` with
 * no `resource.` prefix, and the agent sent neither. The agent now copies
 * Swarm's service label onto each task's metrics and stamps its node's name,
 * both on the RESOURCE (agents/DockerSwarmAgent/otel-collector-config.yaml),
 * and ingest stores resource attributes `resource.`-prefixed - so those are
 * the keys the filters must use. And Container Image matched exactly, while
 * a task runs its image pinned to a digest (`nginx:latest@sha256:…`): it is
 * now a Wildcard that matches with or without one
 * (MonitorStepDockerSwarmImageFilter.test.ts in Common runs its patterns).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorDockerSwarm } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const CLUSTER: string = "swarm-prod";
const DIGEST: string =
  "sha256:4c0fdaa8b6341bfdeca5f18f7837462c80cff90527ee35ef185571e1c327beac";

/*
 * One task's container metric as ingest stores it: every attribute the
 * docker_stats receiver and the Swarm agent's config put on the resource,
 * `resource.`-prefixed.
 */
const TASK_ATTRIBUTES: JSONObject = {
  "resource.docker.swarm.cluster.name": CLUSTER,
  "resource.container.runtime": "docker",
  "resource.container.name": "shop_web.1.x7k2m9p4q1r8s5t3v6w0y2z4a",
  "resource.container.image.name": `nginx:1.27@${DIGEST}`,
  "resource.container.id": "6f3c2a91d8b7",
  "resource.docker.swarm.service.name": "shop_web",
  "resource.docker.swarm.node.id": "6b9e8xyl1u9e3jg1dyvq6ocb8",
  "resource.docker.swarm.node.name": "worker-1",
};

interface QueryArgs {
  query: { name: string; attributes?: Record<string, unknown> };
}

function queryConfig(
  groupByAttributeKeys?: Array<string>,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "cpu",
      title: "cpu",
      description: "cpu",
      legend: "cpu",
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
        aggregateBy: {},
      },
      ...(groupByAttributeKeys ? { groupByAttributeKeys } : {}),
    },
  };
}

function swarmStep(input: {
  resourceFilters: DockerSwarmResourceFilters;
  groupByTask?: boolean | undefined;
}): MonitorStep {
  const config: MonitorStepDockerSwarmMonitor = {
    ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
    clusterIdentifier: CLUSTER,
    resourceFilters: input.resourceFilters,
    rollingTime: RollingTime.Past5Minutes,
    metricViewConfig: {
      queryConfigs: [
        queryConfig(input.groupByTask ? ["resource.container.name"] : []),
      ],
      formulaConfigs: [],
    },
  };

  const step: MonitorStep = new MonitorStep();
  step.setDockerSwarmMonitor(config);
  return step;
}

// The attributes of the one query the worker ran, aggregated or raw.
function queriedAttributes(
  mock: jest.Mock,
  call: number = 0,
): Record<string, unknown> | undefined {
  return (mock.mock.calls[call]![0] as QueryArgs).query.attributes;
}

/*
 * Whether a stored task matches a query's attribute filters, the way the
 * analytics query compiles them: a string is equality on that key, a
 * Wildcard one of its LIKE patterns (ILIKE: `%` any run, `_` any one
 * character, `\` escapes, case ignored).
 */
function taskMatches(
  attributes: Record<string, unknown>,
  task: JSONObject,
): boolean {
  return Object.entries(attributes).every(
    ([key, filter]: [string, unknown]): boolean => {
      const stored: unknown = task[key];

      if (filter instanceof NotNull) {
        return typeof stored === "string" && stored !== "";
      }

      if (filter instanceof Wildcard) {
        return (
          typeof stored === "string" &&
          filter.toPatterns().some((pattern: string): boolean => {
            return ilike(pattern, stored);
          })
        );
      }

      return stored === filter;
    },
  );
}

function ilike(pattern: string, value: string): boolean {
  // Compare piece by piece rather than through a RegExp built from data.
  const match: (p: number, v: number) => boolean = (
    p: number,
    v: number,
  ): boolean => {
    if (p === pattern.length) {
      return v === value.length;
    }

    const character: string = pattern[p]!;

    if (character === "%") {
      for (let next: number = v; next <= value.length; next++) {
        if (match(p + 1, next)) {
          return true;
        }
      }
      return false;
    }

    if (v === value.length) {
      return false;
    }

    if (character === "_") {
      return match(p + 1, v + 1);
    }

    const literal: string =
      character === "\\" && p + 1 < pattern.length
        ? pattern[p + 1]!
        : character;
    const step: number = literal === character ? 1 : 2;

    return (
      literal.toLowerCase() === value[v]!.toLowerCase() &&
      match(p + step, v + 1)
    );
  };

  return match(0, 0);
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitorDockerSwarm: every filter is on the resource attribute the task carries", () => {
  test("Service Name and Node Name filter on resource.docker.swarm.service.name and resource.docker.swarm.node.name", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { serviceName: "shop_web", nodeName: "worker-1" },
      }),
      monitorId,
      projectId,
    });

    expect(queriedAttributes(metricAggregateBy)).toEqual({
      "resource.docker.swarm.cluster.name": CLUSTER,
      "resource.docker.swarm.service.name": "shop_web",
      "resource.docker.swarm.node.name": "worker-1",
    });
  });

  test("the query of every filter set matches the task the agent sends, and only filters matching it do", async () => {
    const matching: Array<DockerSwarmResourceFilters> = [
      { serviceName: "shop_web" },
      { nodeName: "worker-1" },
      { containerName: "shop_web.1.x7k2m9p4q1r8s5t3v6w0y2z4a" },
      { containerImage: "nginx:1.27" },
      { containerImage: `nginx:1.27@${DIGEST}` },
      {
        serviceName: "shop_web",
        nodeName: "worker-1",
        containerImage: "nginx:1.27",
      },
    ];
    const notMatching: Array<DockerSwarmResourceFilters> = [
      { serviceName: "web" },
      { nodeName: "worker-2" },
      { containerImage: "nginx:1.28" },
      { containerImage: "nginx" },
      { serviceName: "shop_web", nodeName: "worker-2" },
    ];

    for (const [resourceFilters, expected] of [
      ...matching.map(
        (
          filters: DockerSwarmResourceFilters,
        ): [DockerSwarmResourceFilters, boolean] => {
          return [filters, true];
        },
      ),
      ...notMatching.map(
        (
          filters: DockerSwarmResourceFilters,
        ): [DockerSwarmResourceFilters, boolean] => {
          return [filters, false];
        },
      ),
    ] as Array<[DockerSwarmResourceFilters, boolean]>) {
      metricAggregateBy.mockClear();

      await monitorDockerSwarm({
        monitorStep: swarmStep({ resourceFilters }),
        monitorId,
        projectId,
      });

      expect({
        resourceFilters,
        matches: taskMatches(
          queriedAttributes(metricAggregateBy)!,
          TASK_ATTRIBUTES,
        ),
      }).toEqual({ resourceFilters, matches: expected });
    }
  });

  test("the bare swarm keys, which nothing stores, are never filtered on", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { serviceName: "shop_web", nodeName: "worker-1" },
      }),
      monitorId,
      projectId,
    });

    const attributes: Record<string, unknown> =
      queriedAttributes(metricAggregateBy)!;

    expect(attributes["docker.swarm.service.name"]).toBeUndefined();
    expect(attributes["docker.swarm.node.name"]).toBeUndefined();
    expect(attributes["resource.container.runtime"]).toBeUndefined();
    expect(attributes["resource.host.name"]).toBeUndefined();
  });

  test("Container Image is a Wildcard matching the typed image with or without a digest", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { containerImage: "nginx:latest" },
      }),
      monitorId,
      projectId,
    });

    const image: unknown =
      queriedAttributes(metricAggregateBy)!["resource.container.image.name"];

    expect(image).toBeInstanceOf(Wildcard);
    expect((image as Wildcard<string>).values).toEqual([
      "nginx:latest",
      "nginx:latest@*",
    ]);
  });

  test("a task-grouped monitor reads its rows with every filter too", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: {
          serviceName: "shop_web",
          nodeName: "worker-1",
          containerImage: "nginx:1.27",
        },
        groupByTask: true,
      }),
      monitorId,
      projectId,
    });

    /*
     * The per-series read, grouped in SQL by the task (#5281), then the
     * breakdown's scan of raw rows: the same filters on both.
     */
    expect(metricAggregateBy).toHaveBeenCalledTimes(1);
    expect(metricFindBy).toHaveBeenCalledTimes(1);
    expect(
      (
        metricAggregateBy.mock.calls[0]![0] as {
          groupByAttributeKeys?: Array<string>;
        }
      ).groupByAttributeKeys,
    ).toEqual(["resource.container.name"]);

    for (const mock of [metricAggregateBy, metricFindBy]) {
      const attributes: Record<string, unknown> = queriedAttributes(mock)!;

      expect(attributes["resource.docker.swarm.service.name"]).toBe("shop_web");
      expect(attributes["resource.docker.swarm.node.name"]).toBe("worker-1");
      expect(attributes["resource.container.image.name"]).toBeInstanceOf(
        Wildcard,
      );
      expect(taskMatches(attributes, TASK_ATTRIBUTES)).toBe(true);
    }
  });

  test("a blank Container Image is no filter", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({ resourceFilters: { containerImage: "   " } }),
      monitorId,
      projectId,
    });

    expect(queriedAttributes(metricAggregateBy)).toEqual({
      "resource.docker.swarm.cluster.name": CLUSTER,
    });
  });
});

describe("monitorDockerSwarm: the affected tasks name their service and node", () => {
  test("from the resource attributes the agent sends, and the breakdown reports the filters as typed", async () => {
    metricFindBy.mockResolvedValue([
      {
        time: new Date("2026-10-30T10:00:30.000Z"),
        value: 91,
        attributes: TASK_ATTRIBUTES,
      },
    ]);

    const response: MetricMonitorResponse = await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { containerImage: "nginx:1.27" },
      }),
      monitorId,
      projectId,
    });

    const affected: Array<DockerSwarmAffectedResource> =
      response.dockerSwarmResourceBreakdowns![0]!.affectedResources;

    expect(affected).toEqual([
      {
        containerName: "shop_web.1.x7k2m9p4q1r8s5t3v6w0y2z4a",
        containerImage: `nginx:1.27@${DIGEST}`,
        nodeName: "worker-1",
        serviceName: "shop_web",
        metricValue: 91,
        lowestMetricValue: 91,
      },
    ]);
    expect(response.dockerSwarmResourceBreakdowns![0]!.attributes).toEqual({
      "resource.docker.swarm.cluster.name": CLUSTER,
      "resource.container.image.name": "nginx:1.27",
    });
  });
});

/*
 * The agent runs as a plain container on every node, and so can anything
 * started with `docker run`: the templates judged those next to the swarm's
 * tasks. A step with `tasksOnly` reads only the containers that carry
 * Swarm's service label, which only a task's container does.
 */
describe("monitorDockerSwarm: Swarm tasks only", () => {
  // The agent's own container on a node: no service label.
  const AGENT_ATTRIBUTES: JSONObject = {
    "resource.docker.swarm.cluster.name": CLUSTER,
    "resource.container.runtime": "docker",
    "resource.container.name": "oneuptime-docker-swarm-agent",
    "resource.container.image.name": "otel/opentelemetry-collector-contrib",
    "resource.docker.swarm.node.name": "worker-1",
  };

  test("a tasks-only step reads the task and not the agent's own container", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({ resourceFilters: { tasksOnly: true } }),
      monitorId,
      projectId,
    });

    const attributes: Record<string, unknown> =
      queriedAttributes(metricAggregateBy)!;

    expect(attributes[SWARM_TASK_SERVICE_ATTRIBUTE]).toBeInstanceOf(NotNull);
    expect(taskMatches(attributes, TASK_ATTRIBUTES)).toBe(true);
    expect(taskMatches(attributes, AGENT_ATTRIBUTES)).toBe(false);
  });

  test("so does a grouped one, on its raw read", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { tasksOnly: true },
        groupByTask: true,
      }),
      monitorId,
      projectId,
    });

    expect(
      queriedAttributes(metricFindBy)![SWARM_TASK_SERVICE_ATTRIBUTE],
    ).toBeInstanceOf(NotNull);
  });

  test("a Service Name filter keeps its own equality", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({
        resourceFilters: { tasksOnly: true, serviceName: "shop_web" },
      }),
      monitorId,
      projectId,
    });

    expect(queriedAttributes(metricAggregateBy)).toEqual({
      "resource.docker.swarm.cluster.name": CLUSTER,
      "resource.docker.swarm.service.name": "shop_web",
    });
  });

  test("a step without it reads every container, the agent's too", async () => {
    await monitorDockerSwarm({
      monitorStep: swarmStep({ resourceFilters: {} }),
      monitorId,
      projectId,
    });

    const attributes: Record<string, unknown> =
      queriedAttributes(metricAggregateBy)!;

    expect(attributes[SWARM_TASK_SERVICE_ATTRIBUTE]).toBeUndefined();
    expect(taskMatches(attributes, AGENT_ATTRIBUTES)).toBe(true);
  });

  test("every template but Cluster Stopped Reporting watches tasks only", () => {
    const templates: Array<DockerSwarmAlertTemplate> =
      getAllDockerSwarmAlertTemplates();

    expect(templates.length).toBeGreaterThan(1);

    for (const template of templates) {
      const step: MonitorStep = template.getMonitorStep({
        clusterIdentifier: CLUSTER,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Swarm",
      });

      expect({
        id: template.id,
        tasksOnly: Boolean(
          step.data?.dockerSwarmMonitor?.resourceFilters.tasksOnly,
        ),
      }).toEqual({
        id: template.id,
        tasksOnly: template.id !== "docker-swarm-cluster-stopped-reporting",
      });
    }
  });
});
