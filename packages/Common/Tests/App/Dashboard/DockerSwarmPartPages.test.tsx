/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * The page of a Docker Swarm node, service and task
 * (Pages/DockerSwarm/View/NodeDetail, ServiceDetail, TaskDetail), rendered
 * for real against a stubbed data layer: what each says about the part - its
 * state by the swarm's rules (DockerSwarmHealth) in Docker's words, where it
 * sits, what on it needs attention with Docker's own error, its tasks, what
 * is open on it, the alerts that watch it with Turn on N, its details - and
 * what each says when the inventory cannot be read or the part has not
 * reported.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "32000000-0000-4000-8000-000000000001";
const BASE: string = `/dashboard/${PROJECT_ID}/docker-swarm/${CLUSTER_ID}`;
const GIB: number = 1024 * 1024 * 1024;

let mockRows: Array<Record<string, unknown>> = [];
let mockInventoryFails: boolean = false;
let mockIncidents: Array<Record<string, unknown>> = [];
let mockAlerts: Array<Record<string, unknown>> = [];
let mockInventoryReads: number = 0;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        return Promise.resolve(
          Object.assign(new Model(), {
            _id: CLUSTER_ID,
            name: "prod-swarm",
          }),
        );
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";

        let records: Array<Record<string, unknown>> = [];
        if (modelName === "DockerSwarmResource") {
          mockInventoryReads++;
          if (mockInventoryFails) {
            return Promise.reject(
              new Error("The server could not be reached."),
            );
          }
          records = mockRows;
        } else if (modelName === "Incident") {
          records = mockIncidents;
        } else if (modelName === "Alert") {
          records = mockAlerts;
        }

        const data: Array<{ tableName?: string }> = records.map(
          (record: Record<string, unknown>): { tableName?: string } => {
            return Object.assign(new Model(), record);
          },
        );
        return Promise.resolve({ data, count: data.length });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([
            {
              id: {
                toString: () => {
                  return "50000000-0000-4000-8000-000000000001";
                },
              },
            },
          ]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([
          {
            id: {
              toString: () => {
                return "51000000-0000-4000-8000-000000000001";
              },
            },
          },
        ]);
      },
    },
  };
});

// The Logs tab is not the subject here, and it is not the open tab.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="logs-viewer" />;
      },
    };
  },
);

import NodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/NodeDetail";
import ServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/ServiceDetail";
import TaskDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/TaskDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function partUrl(segment: string, externalId: string): string {
  return `${BASE}/${segment}/${encodeURIComponent(externalId)}`;
}

let rowNumber: number = 0;

function base(fields: Record<string, unknown>): Record<string, unknown> {
  rowNumber++;
  return {
    _id: `48000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    lastSeenAt: minutesAgo(1),
    ...fields,
  };
}

function node(
  name: string,
  fields: Record<string, unknown> = {},
  attributes: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Node",
    externalId: `node/${name}-id`,
    name: name,
    state: "ready",
    role: "worker",
    isReady: true,
    ...fields,
    attributes: {
      availability: "active",
      engineVersion: "27.1.1",
      cpus: "4",
      memoryBytes: String(16 * GIB),
      addr: "10.0.0.12",
      ...attributes,
    },
  });
}

function service(
  name: string,
  fields: Record<string, unknown> = {},
  attributes: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Service",
    externalId: `service/${name}-id`,
    name: name,
    serviceMode: "replicated",
    runningReplicas: 3,
    desiredReplicas: 3,
    stackName: "shop",
    image: "registry.example.com/shop/web:1.4.2",
    ...fields,
    attributes: { ...attributes },
  });
}

function task(
  name: string,
  fields: Record<string, unknown> = {},
  attributes: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Task",
    externalId: `task/${name.replace(".", "-")}-id`,
    name: name,
    state: "running",
    serviceName: name.split(".")[0],
    nodeHostname: "worker-1",
    image: "registry.example.com/shop/web:1.4.2",
    latestCpuPercent: 20,
    latestMemoryBytes: 256 * 1024 * 1024,
    latestMemoryPercent: 25,
    metricsUpdatedAt: minutesAgo(1),
    ...fields,
    attributes: {
      desiredState: "running",
      slot: name.split(".")[1] || "",
      containerId:
        "4f1c2d3e5a6b7c8d9e0f11223344556677889900aabbccddeeff001122334455",
      ...attributes,
    },
  });
}

function attentionRows(testId: string): Array<{
  key: string | null;
  severity: string | null;
  text: string;
}> {
  return within(screen.getByTestId(testId))
    .getAllByTestId(`${testId}-item`)
    .map((item: HTMLElement) => {
      return {
        key: item.getAttribute("data-key"),
        severity: item.getAttribute("data-severity"),
        text: item.textContent || "",
      };
    });
}

function selectionOf(link: HTMLElement): Array<string> {
  const url: URL = new URL(
    link.getAttribute("href") || "",
    "https://oneuptime.example",
  );
  expect(url.pathname).toBe(`${BASE}/recommendations`);
  return (url.searchParams.get("select") || "").split(",");
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Until the part's Overview tab says what it has: the part, no row, or a failed read.
async function waitForOverview(
  kind: "node" | "service" | "task",
): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByTestId(`docker-swarm-${kind}-overview`) ||
        screen.queryByTestId(`docker-swarm-${kind}-not-reported`) ||
        screen.queryByTestId(`docker-swarm-${kind}-read-error`),
    ).not.toBeNull();
  });
  await settle();
}

beforeEach(() => {
  mockRows = [];
  mockInventoryFails = false;
  mockIncidents = [];
  mockAlerts = [];
  mockInventoryReads = 0;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("a node's page", () => {
  async function openNode(name: string): Promise<void> {
    window.history.pushState({}, "", partUrl("nodes", `node/${name}-id`));
    render(<NodeDetail {...PAGE_PROPS} />);
    await screen.findByTestId("docker-swarm-node-page");
    await waitForOverview("node");
  }

  test("one that is down: Down in red, why, with Swarm's message, and the tasks it ran", async () => {
    mockRows = [
      node(
        "worker-2",
        { state: "down", isReady: false },
        {
          message: "heartbeat failure",
        },
      ),
      task("shop_web.2", { nodeHostname: "worker-2" }),
      task("shop_api.1", { nodeHostname: "worker-2" }),
      task("shop_web.1", { nodeHostname: "worker-1" }),
    ];
    await openNode("worker-2");

    const status: HTMLElement = screen.getByTestId(
      "docker-swarm-node-hero-status",
    );
    expect(status).toHaveTextContent(/^Down/);
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(
      screen.getByTestId("docker-swarm-node-hero-location"),
    ).toHaveTextContent("Node of swarm prod-swarm");
    const chips: HTMLElement = screen.getByTestId(
      "docker-swarm-node-hero-chips",
    );
    expect(chips).toHaveTextContent("2/2 tasks running");
    expect(chips).toHaveTextContent("4 CPUs");
    expect(chips).toHaveTextContent("16.0 GiB memory");
    expect(chips).toHaveTextContent("Docker 27.1.1");

    expect(attentionRows("docker-swarm-node-attention")).toEqual([
      {
        key: "Node:node/worker-2-id",
        severity: "critical",
        text: expect.stringContaining("heartbeat failure"),
      },
    ]);
    expect(screen.getByTestId("docker-swarm-node-attention")).toHaveTextContent(
      "This node",
    );
    // Swarm's message in its details, named as Docker names the field.
    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-node-details",
    );
    expect(details).toHaveTextContent("Status Message");
    expect(details).toHaveTextContent("heartbeat failure");

    // Its own tasks only, each named after its service.
    const overview: HTMLElement = screen.getByTestId(
      "docker-swarm-node-overview",
    );
    expect(within(overview).getByText("shop_web.2")).toBeInTheDocument();
    expect(within(overview).getByText("shop_api.1")).toBeInTheDocument();
    expect(within(overview).queryByText("shop_web.1")).toBeNull();

    /*
     * Its Overview is its only tab, so no row of one tab sits between the
     * hero and its cards (ResourcePartTabs).
     */
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  test("the leader: its badge, its standing and its size in its details", async () => {
    mockRows = [
      node(
        "manager-1",
        { role: "manager" },
        { managerStatus: "Leader", isLeader: true, cpus: "0.5" },
      ),
    ];
    await openNode("manager-1");

    expect(screen.getByTestId("docker-swarm-node-hero")).toHaveTextContent(
      "Leader",
    );
    expect(
      screen.getByTestId("docker-swarm-node-hero-status"),
    ).toHaveTextContent(/^Ready/);
    expect(
      screen.getByTestId("docker-swarm-node-hero-chips"),
    ).toHaveTextContent("0.5 CPUs");
    expect(screen.queryByTestId("docker-swarm-node-attention")).toBeNull();

    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-node-details",
    );
    expect(details).toHaveTextContent("Manager node");
    expect(details).toHaveTextContent("Leader");
    expect(details).toHaveTextContent("Active");
    expect(details).toHaveTextContent("10.0.0.12");
    expect(details).toHaveTextContent("manager-1-id");
  });

  test("the node alerts: Node Not Ready, and one step to turn it on", async () => {
    mockRows = [node("worker-1")];
    await openNode("worker-1");

    const card: HTMLElement = await screen.findByTestId(
      "docker-swarm-node-alerts",
    );
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "docker-swarm-node-alerts-item",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Node Not Ready");
    const turnOn: HTMLElement = within(card).getByTestId(
      "docker-swarm-node-alerts-turn-on",
    );
    expect(selectionOf(turnOn)).toEqual([
      "DockerSwarm:docker-swarm-node-not-ready",
    ]);
  });

  test("an alert that names the node is open on it; one of a task on it is the task's", async () => {
    mockRows = [node("worker-1"), task("shop_web.1")];
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000001",
        title: "[Docker Swarm] Node Not Ready - prod-swarm",
        alertNumber: 4,
        createdAt: minutesAgo(5),
        seriesLabels: { "resource.docker.swarm.node.name": "worker-1" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000002",
        title: "[Docker Swarm] High Task Memory Usage - prod-swarm",
        createdAt: minutesAgo(3),
        seriesLabels: {
          "resource.container.name": "shop_web.1.k3x9q",
          "resource.docker.swarm.node.name": "worker-1",
        },
      },
    ];
    await openNode("worker-1");

    const card: HTMLElement = await screen.findByTestId(
      "docker-swarm-node-open",
    );
    await waitFor(() => {
      expect(
        within(card).getAllByTestId("docker-swarm-node-open-title"),
      ).toHaveLength(1);
    });
    expect(
      within(card).getByTestId("docker-swarm-node-open-title"),
    ).toHaveTextContent("[Docker Swarm] Node Not Ready - prod-swarm");
  });

  test("one the inventory has no row for says it has not reported", async () => {
    mockRows = [node("worker-1")];
    await openNode("worker-9");

    expect(
      screen.getByTestId("docker-swarm-node-not-reported"),
    ).toHaveTextContent(
      "Node details not reported yet. Make sure the Docker Swarm agent is sending metrics.",
    );
    expect(screen.queryByTestId("docker-swarm-node-hero-status")).toBeNull();
  });

  test("an inventory that cannot be read says so, with Try again, and reads it again", async () => {
    mockInventoryFails = true;
    mockRows = [node("worker-1")];
    await openNode("worker-1");

    const error: HTMLElement = screen.getByTestId(
      "docker-swarm-node-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this node");
    expect(error).toHaveTextContent("The server could not be reached.");
    expect(screen.queryByTestId("docker-swarm-node-hero-status")).toBeNull();

    mockInventoryFails = false;
    const reads: number = mockInventoryReads;
    fireEvent.click(within(error).getByRole("button", { name: /Try again/ }));
    await settle();

    expect(mockInventoryReads).toBe(reads + 1);
    expect(
      await screen.findByTestId("docker-swarm-node-overview"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("docker-swarm-node-hero-status"),
    ).toHaveTextContent(/^Ready/);
  });
});

describe("a service's page", () => {
  async function openService(name: string): Promise<void> {
    window.history.pushState({}, "", partUrl("services", `service/${name}-id`));
    render(<ServiceDetail {...PAGE_PROPS} />);
    await screen.findByTestId("docker-swarm-service-page");
    await waitForOverview("service");
  }

  test("one short of replicas: 2 of 3 running in amber, where it sits, and the task that failed with Docker's error", async () => {
    mockRows = [
      service("shop_web", { runningReplicas: 2 }),
      task("shop_web.1", { nodeHostname: "worker-1" }),
      task("shop_web.2", { nodeHostname: "worker-2" }),
      task(
        "shop_web.3",
        { state: "failed", nodeHostname: "worker-3" },
        { error: "task: non-zero exit (137)" },
      ),
      task("shop_api.1"),
    ];
    await openService("shop_web");

    const status: HTMLElement = screen.getByTestId(
      "docker-swarm-service-hero-status",
    );
    expect(status).toHaveTextContent(/^2 of 3 running/);
    expect(status).toHaveAttribute("data-tone", "warning");
    expect(
      screen.getByTestId("docker-swarm-service-hero-location"),
    ).toHaveTextContent("Service of stack shop in swarm prod-swarm");
    expect(screen.getByTestId("docker-swarm-service-hero")).toHaveTextContent(
      "Replicated",
    );
    /*
     * Its replicas are counted once, in its pill: a chip under it saying
     * "2/3 tasks running" said the same numbers again.
     */
    expect(
      screen.getByTestId("docker-swarm-service-hero"),
    ).not.toHaveTextContent("tasks running");
    expect(screen.queryByTestId("docker-swarm-service-hero-chips")).toBeNull();
    // Its Overview is its only tab: no row of one tab.
    expect(screen.queryByRole("tablist")).toBeNull();

    expect(attentionRows("docker-swarm-service-attention")).toEqual([
      {
        key: "Service:service/shop_web-id",
        severity: "warning",
        text: expect.stringContaining("2 of 3 replicas run"),
      },
      {
        key: "Task:task/shop_web-3-id",
        severity: "warning",
        text: expect.stringContaining("task: non-zero exit (137)"),
      },
    ]);

    // Its own tasks, each with the node it runs on.
    const overview: HTMLElement = screen.getByTestId(
      "docker-swarm-service-overview",
    );
    for (const name of ["shop_web.1", "shop_web.2", "shop_web.3"]) {
      expect(within(overview).getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(within(overview).queryAllByText("shop_api.1")).toHaveLength(0);
    expect(within(overview).getAllByText("worker-3").length).toBeGreaterThan(0);
  });

  test("a rolling update: Updating in its pill, and its tasks running in a chip, the count the pill does not give", async () => {
    mockRows = [
      service("shop_web", { runningReplicas: 2 }, { updateState: "updating" }),
      task("shop_web.1"),
      task("shop_web.2"),
      task("shop_web.3", { state: "starting" }),
    ];
    await openService("shop_web");

    expect(
      screen.getByTestId("docker-swarm-service-hero-status"),
    ).toHaveTextContent(/^Updating/);
    expect(
      screen.getByTestId("docker-swarm-service-hero-chips"),
    ).toHaveTextContent("2/3 tasks running");
  });

  test("a crash loop that reads full: its failures and Docker's last error in Needs attention and its details", async () => {
    mockRows = [
      service(
        "shop_worker",
        {},
        {
          recentFailedTasks: "5",
          lastTaskError: "task: non-zero exit (1)",
          lastTaskExitCode: "1",
          lastTaskErrorAt: "2026-11-02T11:58:00Z",
        },
      ),
      task("shop_worker.1"),
    ];
    await openService("shop_worker");

    expect(attentionRows("docker-swarm-service-attention")).toEqual([
      {
        key: "Service:service/shop_worker-id",
        severity: "warning",
        text: expect.stringContaining("5 failed tasks in the last hour"),
      },
    ]);
    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-service-details",
    );
    expect(details).toHaveTextContent("Failed Tasks (Last Hour)");
    expect(details).toHaveTextContent("task: non-zero exit (1)");
    expect(details).toHaveTextContent("Last Exit Code");
    expect(details).toHaveTextContent("registry.example.com/shop/web:1.4.2");
  });

  test("a rolled-back update: its badge, its words and Docker's message", async () => {
    mockRows = [
      service(
        "shop_web",
        {},
        {
          updateState: "rollback_completed",
          updateMessage: "rollback completed",
          updateCompletedAt: minutesAgo(30).toISOString(),
        },
      ),
    ];
    await openService("shop_web");

    expect(screen.getByTestId("docker-swarm-service-hero")).toHaveTextContent(
      "Rolled back",
    );
    expect(attentionRows("docker-swarm-service-attention")).toEqual([
      {
        key: "Service:service/shop_web-id",
        severity: "warning",
        text: expect.stringContaining("Update rolled back"),
      },
    ]);
    expect(
      screen.getByTestId("docker-swarm-service-details"),
    ).toHaveTextContent("rollback completed");
  });

  test("the service alerts: its replicas first, then its tasks', and one step to turn them on", async () => {
    mockRows = [service("shop_web")];
    await openService("shop_web");

    const card: HTMLElement = await screen.findByTestId(
      "docker-swarm-service-alerts",
    );
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "docker-swarm-service-alerts-item",
    );
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("Service Replicas Mismatch");
    const turnOn: HTMLElement = within(card).getByTestId(
      "docker-swarm-service-alerts-turn-on",
    );
    expect(turnOn).toHaveTextContent("Turn on 5 alerts");
    expect(selectionOf(turnOn)).toEqual([
      "DockerSwarm:docker-swarm-service-replicas-mismatch",
      "DockerSwarm:docker-swarm-task-down",
      "DockerSwarm:docker-swarm-high-memory",
      "DockerSwarm:docker-swarm-high-cpu",
      "DockerSwarm:docker-swarm-high-pids",
    ]);
  });

  test("its replicas alert and its tasks' alerts are open on it; another service's are not", async () => {
    mockRows = [service("shop_web"), task("shop_web.1")];
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000011",
        title: "[Docker Swarm] Service Replicas Mismatch - prod-swarm",
        createdAt: minutesAgo(9),
        seriesLabels: { "resource.docker.swarm.service.name": "shop_web" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000012",
        title: "[Docker Swarm] Task Down (Low Uptime) - prod-swarm",
        createdAt: minutesAgo(7),
        seriesLabels: { "resource.container.name": "shop_web.1.k3x9q" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000013",
        title: "Another service's alert",
        createdAt: minutesAgo(5),
        seriesLabels: { "resource.docker.swarm.service.name": "shop_api" },
      },
    ];
    await openService("shop_web");

    const card: HTMLElement = await screen.findByTestId(
      "docker-swarm-service-open",
    );
    await waitFor(() => {
      expect(
        within(card).getAllByTestId("docker-swarm-service-open-title"),
      ).toHaveLength(2);
    });
    expect(
      within(card)
        .getAllByTestId("docker-swarm-service-open-title")
        .map((title: HTMLElement): string => {
          return title.textContent || "";
        })
        .sort(),
    ).toEqual([
      "[Docker Swarm] Service Replicas Mismatch - prod-swarm",
      "[Docker Swarm] Task Down (Low Uptime) - prod-swarm",
    ]);
  });

  test("a job that ran to completion: Completed in grey, its completed tasks, no replicas to keep up", async () => {
    mockRows = [
      service(
        "db_migrate",
        {
          serviceMode: "replicated-job",
          runningReplicas: 0,
          desiredReplicas: 1,
        },
        { completedTasks: "1" },
      ),
    ];
    await openService("db_migrate");

    const status: HTMLElement = screen.getByTestId(
      "docker-swarm-service-hero-status",
    );
    expect(status).toHaveTextContent(/^Completed/);
    expect(status).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByTestId("docker-swarm-service-hero")).toHaveTextContent(
      "Job",
    );
    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-service-details",
    );
    expect(details).toHaveTextContent("Completed Tasks");
    expect(details).not.toHaveTextContent("Replicas");
    expect(screen.queryByTestId("docker-swarm-service-attention")).toBeNull();
  });
});

describe("a task's page", () => {
  async function openTask(externalId: string): Promise<void> {
    window.history.pushState({}, "", partUrl("tasks", externalId));
    render(<TaskDetail {...PAGE_PROPS} />);
    await screen.findByTestId("docker-swarm-task-page");
    await waitForOverview("task");
  }

  test("a running task: where it runs, each one step away, its slot and container, and what it uses", async () => {
    mockRows = [
      service("shop_web"),
      node("worker-1"),
      task("shop_web.2", {
        latestCpuPercent: 91,
        latestMemoryPercent: 40,
        latestMemoryBytes: 512 * 1024 * 1024,
      }),
    ];
    await openTask("task/shop_web-2-id");

    const status: HTMLElement = screen.getByTestId(
      "docker-swarm-task-hero-status",
    );
    expect(status).toHaveTextContent(/^Running/);
    expect(status).toHaveAttribute("data-tone", "positive");

    const location: HTMLElement = screen.getByTestId(
      "docker-swarm-task-hero-location",
    );
    expect(location).toHaveTextContent(
      "Task of service shop_web on node worker-1",
    );
    expect(within(location).getByText("shop_web").closest("a")).toHaveAttribute(
      "href",
      partUrl("services", "service/shop_web-id"),
    );
    expect(within(location).getByText("worker-1").closest("a")).toHaveAttribute(
      "href",
      partUrl("nodes", "node/worker-1-id"),
    );
    const chips: HTMLElement = screen.getByTestId(
      "docker-swarm-task-hero-chips",
    );
    expect(chips).toHaveTextContent("Slot 2");
    expect(chips).toHaveTextContent("Container 4f1c2d3e5a6b");

    // A busy CPU is amber on its tile, never a reason by itself.
    const tiles: HTMLElement = screen.getByTestId("docker-swarm-task-tiles");
    expect(tiles).toHaveTextContent("91.0%");
    expect(tiles).toHaveTextContent("40.0%");
    expect(tiles).toHaveTextContent("512 MiB in use");
    expect(screen.queryByTestId("docker-swarm-task-attention")).toBeNull();

    // Its container's logs, under its id.
    expect(screen.getByRole("tab", { name: /Logs/ })).toBeInTheDocument();
  });

  test("a failed task: Failed in red, Docker's error, its exit code, and no tiles", async () => {
    mockRows = [
      task(
        "shop_web.3",
        { state: "failed", latestCpuPercent: 0 },
        { error: "task: non-zero exit (137)", exitCode: "137" },
      ),
    ];
    await openTask("task/shop_web-3-id");

    const status: HTMLElement = screen.getByTestId(
      "docker-swarm-task-hero-status",
    );
    expect(status).toHaveTextContent(/^Failed/);
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(attentionRows("docker-swarm-task-attention")).toEqual([
      {
        key: "Task:task/shop_web-3-id",
        severity: "warning",
        text: expect.stringContaining("task: non-zero exit (137)"),
      },
    ]);
    expect(screen.queryByTestId("docker-swarm-task-tiles")).toBeNull();
    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-task-details",
    );
    expect(details).toHaveTextContent("Exit Code");
    expect(details).toHaveTextContent("137");
    // Its service and node are not in the inventory: plain names, no links.
    const location: HTMLElement = screen.getByTestId(
      "docker-swarm-task-hero-location",
    );
    expect(within(location).getByText("shop_web").closest("a")).toBeNull();
  });

  test("near its memory limit: amber, with how close, and the task alerts to turn on", async () => {
    mockRows = [task("shop_web.1", { latestMemoryPercent: 93 })];
    await openTask("task/shop_web-1-id");

    expect(attentionRows("docker-swarm-task-attention")).toEqual([
      {
        key: "Task:task/shop_web-1-id",
        severity: "warning",
        text: expect.stringContaining("Memory at 93% of its limit"),
      },
    ]);
    const card: HTMLElement = await screen.findByTestId(
      "docker-swarm-task-alerts",
    );
    expect(
      within(card).getByTestId("docker-swarm-task-alerts-turn-on"),
    ).toHaveTextContent("Turn on 4 alerts");
  });

  test("readings older than 15 minutes are none: dashes, not old numbers", async () => {
    mockRows = [
      task("shop_web.1", {
        latestCpuPercent: 55,
        latestMemoryPercent: 93,
        metricsUpdatedAt: minutesAgo(20),
      }),
    ];
    await openTask("task/shop_web-1-id");

    const tiles: HTMLElement = screen.getByTestId("docker-swarm-task-tiles");
    expect(tiles).not.toHaveTextContent("55.0%");
    expect(within(tiles).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("docker-swarm-task-attention")).toBeNull();
  });

  test("a task the swarm no longer has: not reported yet, and no Logs tab", async () => {
    mockRows = [];
    await openTask("task/gone-id");

    expect(
      screen.getByTestId("docker-swarm-task-not-reported"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Logs/ })).toBeNull();
    // Nor a row with its Overview alone in it.
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
