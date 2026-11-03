import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Docker Swarm cluster pages, rendered for real in jsdom with only the
 * API and the router replaced: every count, state, field and column header
 * that needs explaining has an (i), hovering it shows the text from
 * DockerSwarmMetricDescriptions, and the (i) never sits inside another
 * control. The Overview's counts are chips that open their lists, under one
 * (i) that says what they count; its health pill has its own.
 *
 * Tippy under jsdom (see InfoTooltip.test.tsx): the popup is portalled to
 * document.body and queried through `screen`; it is lazy, so fake timers
 * are advanced after the hover.
 */

const CLUSTER_ID: string = "11111111-1111-4111-8111-111111111111";

const getItemMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
let lastParam: string = "";
// The inventory the DockerSwarmResource reads return; other reads are empty.
let mockInventory: Array<unknown> = [];

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const data: Array<unknown> =
          new Model().tableName === "DockerSwarmResource" ? mockInventory : [];
        return Promise.resolve({
          data: data,
          count: data.length,
          skip: 0,
          limit: data.length,
        });
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const ObjectIDClass: typeof import("../../../Types/ObjectID").default = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof import("../../../Types/ObjectID").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return new ObjectIDClass(CLUSTER_ID);
      },
      getLastParamAsString: () => {
        return lastParam;
      },
      // RouteMap asks for the project from the URL; there is none here.
      getFirstParam: (): undefined => {
        return undefined;
      },
      navigate: (...args: Array<unknown>) => {
        navigateMock(...args);
      },
      getCurrentRoute: () => {
        return {
          toString: (): string => {
            return "/";
          },
        };
      },
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

/*
 * The auto-refresh control has its own tests; here it would only add a
 * 30-second timer to every render.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

// What is open on the cluster has suites of its own; here it would only fetch.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartOpenEventsCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import DockerSwarmClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import DockerSwarmClusterTaskDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/TaskDetail";
import DockerSwarmClusterServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/ServiceDetail";
import DockerSwarmClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/NodeDetail";
import DockerSwarmClusterTasks from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Tasks";
import DockerSwarmClusterNodes from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Nodes";
import DockerSwarmClusterServices from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Services";
import DockerSwarmClusterStacks from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Stacks";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import {
  DOCKER_SWARM_AGENT_COLLECTOR_VERSION,
  DOCKER_SWARM_AGENT_VERSION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";

const T: typeof DOCKER_SWARM_METRIC_DESCRIPTIONS =
  DOCKER_SWARM_METRIC_DESCRIPTIONS;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type RowInit = Partial<{
  kind: string;
  externalId: string;
  name: string;
  state: string;
  role: string;
  isReady: boolean;
  serviceMode: string;
  runningReplicas: number;
  desiredReplicas: number;
  serviceName: string;
  nodeHostname: string;
  image: string;
  latestCpuPercent: number;
  latestMemoryBytes: number;
  latestMemoryPercent: number;
  metricsUpdatedAt: Date;
  lastSeenAt: Date;
  attributes: Record<string, unknown>;
}>;

function row(init: RowInit): DockerSwarmResource {
  const model: DockerSwarmResource = new DockerSwarmResource();
  Object.assign(model, { lastSeenAt: new Date(), ...init });
  return model;
}

function cluster(): DockerSwarmCluster {
  const model: DockerSwarmCluster = new DockerSwarmCluster();
  model.name = "prod-swarm";
  model.otelCollectorStatus = "connected";
  model.dockerVersion = "27.1.1";
  model.agentVersion = "0.161.0";
  return model;
}

function inventory(): Array<DockerSwarmResource> {
  return [
    row({
      kind: "Node",
      externalId: "node/a",
      name: "manager-1",
      state: "ready",
      role: "manager",
      isReady: true,
      attributes: {
        managerStatus: "Leader",
        isLeader: true,
        availability: "active",
      },
    }),
    row({
      kind: "Node",
      externalId: "node/b",
      name: "worker-1",
      state: "ready",
      role: "worker",
      isReady: true,
      attributes: { availability: "active" },
    }),
    row({
      kind: "Service",
      externalId: "service/web",
      name: "shop_web",
      state: "2/3",
      serviceMode: "replicated",
      runningReplicas: 2,
      desiredReplicas: 3,
      isReady: false,
    }),
    row({
      kind: "Task",
      externalId: "task/t1",
      name: "shop_web.1",
      state: "running",
      isReady: true,
      serviceName: "shop_web",
      nodeHostname: "worker-1",
      attributes: { desiredState: "running" },
    }),
    row({
      kind: "Task",
      externalId: "task/t2",
      name: "shop_web.2",
      state: "starting",
      isReady: false,
      serviceName: "shop_web",
      nodeHostname: "manager-1",
      attributes: { desiredState: "running" },
    }),
    row({ kind: "Stack", externalId: "stack/shop", name: "shop" }),
    row({ kind: "Network", externalId: "network/n1", name: "shop_default" }),
    row({ kind: "Volume", externalId: "volume/data@manager-1", name: "data" }),
  ];
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

async function expectTooltip(name: string, text: string): Promise<void> {
  const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${name}`,
  });

  for (const button of buttons) {
    await hover(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);
    fireEvent.mouseLeave(button);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

// The (i)s on the page, by what they are about, in page order.
function infoNames(root: HTMLElement = document.body): Array<string> {
  return within(root)
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
}

function expectNoNestedControls(root: HTMLElement): void {
  expect(root.querySelectorAll("button button")).toHaveLength(0);
  expect(root.querySelectorAll("a button")).toHaveLength(0);
  expect(root.querySelectorAll("button a")).toHaveLength(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  navigateMock.mockReset();
  lastParam = "";
  mockInventory = inventory();
  getItemMock.mockImplementation(async () => {
    return cluster();
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Docker Swarm overview page", () => {
  async function renderOverview(): Promise<RenderResult> {
    const result: RenderResult = render(
      <DockerSwarmClusterOverview {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("prod-swarm")).toBeInTheDocument();

    return result;
  }

  test("the counts are chips that open their lists", async () => {
    await renderOverview();

    const chips: Array<[string, string, string]> = [
      ["docker-swarm-hero-nodes", "2/2 nodes ready", "/nodes"],
      ["docker-swarm-hero-managers", "1 manager", "/nodes"],
      ["docker-swarm-hero-services", "1 service", "/services"],
      ["docker-swarm-hero-tasks", "1/2 tasks running", "/tasks"],
      ["docker-swarm-hero-stacks", "1 stack", "/stacks"],
    ];
    for (const [testId, label, path] of chips) {
      const chip: HTMLElement = screen.getByTestId(testId);
      expect(chip).toHaveTextContent(label);
      const href: string = chip.getAttribute("href") || "";
      expect(href).toContain(CLUSTER_ID);
      expect(href.endsWith(path)).toBe(true);
    }
  });

  test("one (i) says what the chips count; it is named for them, never after a number", async () => {
    await renderOverview();

    const chips: HTMLElement = screen.getByTestId("docker-swarm-hero-chips");
    expect(infoNames(chips)).toEqual(["Swarm inventory counts"]);
    await expectTooltip("Swarm inventory counts", T.inventoryCounts);

    expect(
      screen.queryByRole("button", { name: /About \d/ }),
    ).not.toBeInTheDocument();
  });

  test("the health pill reads the swarm's rules - a service short of replicas is Degraded - and explains itself", async () => {
    await renderOverview();

    const health: HTMLElement = screen.getByTestId("docker-swarm-hero-health");
    expect(health).toHaveAttribute("data-health", "Degraded");
    expect(health).toHaveTextContent("Degraded");
    await expectTooltip("Swarm health", T.clusterHealth);
  });

  test("Needs attention names the service and why, one step from its page", async () => {
    await renderOverview();

    const card: HTMLElement = screen.getByTestId(
      "docker-swarm-needs-attention",
    );
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "docker-swarm-needs-attention-item",
    );
    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-key");
      }),
    ).toEqual(["Service:service/web"]);
    expect(items[0]).toHaveTextContent("shop_web");
    expect(items[0]).toHaveTextContent("2 of 3 replicas run");
    expect(
      (items[0]!.closest("a") || items[0]!.querySelector("a"))?.getAttribute(
        "href",
      ),
    ).toContain(encodeURIComponent("service/web"));
  });

  test("a disconnected swarm's last snapshot is no longer the truth: Health Unknown, and no Needs attention", async () => {
    getItemMock.mockImplementation(async () => {
      const model: DockerSwarmCluster = cluster();
      model.otelCollectorStatus = "disconnected";
      return model;
    });
    await renderOverview();

    expect(screen.getByTestId("docker-swarm-hero-health")).toHaveAttribute(
      "data-health",
      "Unknown",
    );
    expect(
      screen.queryByTestId("docker-swarm-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("each node at a glance: the leader first, then the rest, each one step from its page", async () => {
    await renderOverview();

    const card: HTMLElement = screen.getByTestId("docker-swarm-nodes-card");
    expect(
      within(card)
        .getAllByTestId("docker-swarm-nodes-card-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["manager-1", "worker-1"]);
    expect(
      within(card)
        .getAllByTestId("docker-swarm-nodes-card-status")
        .map((status: HTMLElement): string => {
          return status.textContent || "";
        }),
    ).toEqual(["Ready", "Ready"]);
  });

  test("version chips are metadata and get no (i)", async () => {
    await renderOverview();

    expect(screen.getByText("Docker 27.1.1")).toBeInTheDocument();
    expect(screen.getByText("Agent 0.161.0")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /About (Docker|Agent)/ }),
    ).not.toBeInTheDocument();
  });

  /*
   * The Swarm agent reports its files' version - the collector its compose
   * file pins, raised when the files change without the collector - so an
   * agent on this release's files is up to date whatever the server's own
   * version is, and its chip is the plain gray one.
   */
  test("an agent on the files this release ships keeps the plain chip, with no sign", async () => {
    getItemMock.mockImplementation(async () => {
      const model: DockerSwarmCluster = cluster();
      model.agentVersion = DOCKER_SWARM_AGENT_VERSION;
      return model;
    });
    await renderOverview();

    expect(screen.getByTestId("agent-version-chip")).toHaveTextContent(
      `Agent ${DOCKER_SWARM_AGENT_VERSION}`,
    );
    expect(
      screen.queryByTestId("agent-version-outdated"),
    ).not.toBeInTheDocument();
  });

  /*
   * The agent's files changed on the same collector (0.161.3: every
   * snapshot read again, the swarm's state as metrics), and an agent on the
   * older files reports their version, behind the files this release ships.
   */
  test("an agent on the same collector with older files gets the sign", async () => {
    expect(DOCKER_SWARM_AGENT_COLLECTOR_VERSION).toBe("0.161.0");
    getItemMock.mockImplementation(async () => {
      const model: DockerSwarmCluster = cluster();
      model.agentVersion = "0.161.2";
      return model;
    });
    await renderOverview();

    expect(
      screen.getByRole("button", {
        name: `Agent 0.161.2 is outdated. A newer agent is available: ${DOCKER_SWARM_AGENT_VERSION}. Show how to upgrade.`,
      }),
    ).toHaveTextContent("Agent 0.161.2");
    expect(screen.queryByTestId("agent-version-chip")).not.toBeInTheDocument();
  });

  test("an agent behind the pinned collector gets the sign, which opens how to upgrade it", async () => {
    getItemMock.mockImplementation(async () => {
      const model: DockerSwarmCluster = cluster();
      model.agentVersion = "0.154.0";
      return model;
    });
    await renderOverview();

    const chip: HTMLElement = screen.getByRole("button", {
      name: `Agent 0.154.0 is outdated. A newer agent is available: ${DOCKER_SWARM_AGENT_VERSION}. Show how to upgrade.`,
    });
    expect(chip).toHaveTextContent("Agent 0.154.0");
    // Still in the hero's chip row, after the Docker version.
    expect(chip.parentElement).toBe(
      screen.getByTestId("docker-swarm-hero-chips"),
    );

    fireEvent.click(chip);
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Upgrade the OneUptime Docker Swarm Agent",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("no control is nested in another anywhere on the page", async () => {
    const result: RenderResult = await renderOverview();

    expectNoNestedControls(result.container);
  });

  test("a swarm that reported nothing yet has no health to tell, and no counts", async () => {
    mockInventory = [];
    await renderOverview();

    expect(
      screen.queryByTestId("docker-swarm-hero-health"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("docker-swarm-hero-nodes"),
    ).not.toBeInTheDocument();
    expect(infoNames()).not.toContain("Swarm inventory counts");
  });
});

describe("Docker Swarm part pages", () => {
  const FRESH: () => Date = (): Date => {
    return new Date(Date.now() - 60 * 1000);
  };

  test("the task page explains CPU, Memory and its desired state, and leaves names plain", async () => {
    lastParam = encodeURIComponent("task/t1");
    mockInventory = [
      row({
        kind: "Task",
        externalId: "task/t1",
        name: "shop_web.1",
        state: "running",
        isReady: true,
        serviceName: "shop_web",
        nodeHostname: "worker-1",
        latestCpuPercent: 12.5,
        latestMemoryBytes: 64 * 1024 * 1024,
        latestMemoryPercent: 25,
        metricsUpdatedAt: FRESH(),
        attributes: { desiredState: "running", slot: "1" },
      }),
    ];

    render(<DockerSwarmClusterTaskDetail {...PAGE_PROPS} />);
    await flush();

    const tiles: HTMLElement = screen.getByTestId("docker-swarm-task-tiles");
    expect(tiles).toHaveTextContent("12.5%");
    expect(tiles).toHaveTextContent("25.0%");
    expect(tiles).toHaveTextContent("64.0 MiB in use");

    await expectTooltip("CPU", T.taskCpu);
    await expectTooltip("Memory", T.taskMemory);
    await expectTooltip("Desired State", T.taskDesiredState);

    for (const plain of ["Name", "Service", "Node", "Image", "Task ID"]) {
      expect(infoNames()).not.toContain(plain);
    }
  });

  test("the service page explains its replicas, its update and its failures, and its tasks' columns", async () => {
    lastParam = encodeURIComponent("service/web");
    mockInventory = [
      row({
        kind: "Service",
        externalId: "service/web",
        name: "shop_web",
        serviceMode: "replicated",
        runningReplicas: 2,
        desiredReplicas: 3,
        attributes: {
          updateState: "paused",
          recentFailedTasks: "4",
          lastTaskError: "task: non-zero exit (1)",
        },
      }),
      row({
        kind: "Task",
        externalId: "task/t1",
        name: "shop_web.1",
        state: "running",
        serviceName: "shop_web",
        nodeHostname: "worker-1",
        latestCpuPercent: 12.5,
        metricsUpdatedAt: FRESH(),
        attributes: { desiredState: "running" },
      }),
    ];

    render(<DockerSwarmClusterServiceDetail {...PAGE_PROPS} />);
    await flush();

    await expectTooltip("Replicas", T.replicas);
    await expectTooltip("Last Update", T.serviceUpdate);
    await expectTooltip("Failed Tasks (Last Hour)", T.recentFailedTasks);
    await expectTooltip("Last Task Error", T.lastTaskError);
    await expectTooltip("Status", T.taskStatus);
    await expectTooltip("CPU", T.taskCpuColumn);
    await expectTooltip("Memory", T.taskMemoryColumn);

    expect(infoNames()).not.toContain("Mode");
    expect(infoNames()).not.toContain("Image");
  });

  test("the node page explains its role, its standing and its availability", async () => {
    lastParam = encodeURIComponent("node/a");
    mockInventory = [
      row({
        kind: "Node",
        externalId: "node/a",
        name: "manager-1",
        state: "ready",
        role: "manager",
        isReady: true,
        attributes: {
          managerStatus: "Leader",
          isLeader: true,
          availability: "active",
          cpus: "4",
          memoryBytes: String(8 * 1024 * 1024 * 1024),
        },
      }),
    ];

    render(<DockerSwarmClusterNodeDetail {...PAGE_PROPS} />);
    await flush();

    expect(screen.getByTestId("docker-swarm-node-hero")).toHaveTextContent(
      "manager-1",
    );
    await expectTooltip("Role", T.managers);
    await expectTooltip("Manager Status", T.managerStatus);
    await expectTooltip("Availability", T.availability);

    // Its facts are plain; the (i)s of its tasks' table are the table's.
    const details: HTMLElement = screen.getByTestId(
      "docker-swarm-node-details",
    );
    expect(infoNames(details)).toEqual([
      "Role",
      "Manager Status",
      "Availability",
    ]);
  });
});

describe("Docker Swarm list pages", () => {
  const FRESH: Date = new Date();

  test("Tasks: Status, CPU and Memory headers explain the rules and the latest reading", async () => {
    mockInventory = [
      row({
        kind: "Task",
        externalId: "task/t1",
        name: "shop_web.1",
        state: "running",
        isReady: true,
        serviceName: "shop_web",
        nodeHostname: "manager-1",
        latestCpuPercent: 12.5,
        latestMemoryBytes: 64 * 1024 * 1024,
        metricsUpdatedAt: FRESH,
        attributes: { desiredState: "running" },
      }),
    ];

    const result: RenderResult = render(
      <DockerSwarmClusterTasks {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("shop_web.1")).toBeInTheDocument();

    await expectTooltip("Status", T.taskStatus);
    await expectTooltip("CPU", T.taskCpuColumn);
    await expectTooltip("Memory", T.taskMemoryColumn);

    // Metadata columns stay plain.
    for (const plain of ["Service", "Image", "Node"]) {
      expect(infoNames()).not.toContain(plain);
    }
    expectNoNestedControls(result.container);
  });

  test("Nodes: Status, Role, Availability and Manager Status are explained, and there are no usage columns", async () => {
    mockInventory = [
      row({
        kind: "Node",
        externalId: "node/a",
        name: "manager-1",
        state: "ready",
        role: "manager",
        isReady: true,
        attributes: { managerStatus: "Leader", availability: "active" },
      }),
    ];

    const result: RenderResult = render(
      <DockerSwarmClusterNodes {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("manager-1")).toBeInTheDocument();
    await expectTooltip("Status", T.nodeStatus);
    await expectTooltip("Role", T.managers);
    await expectTooltip("Availability", T.availability);
    await expectTooltip("Manager Status", T.managerStatus);
    expect(
      screen.queryByRole("columnheader", { name: /^CPU/ }),
    ).not.toBeInTheDocument();
    expect(infoNames()).not.toContain("Engine Version");
    expectNoNestedControls(result.container);
  });

  test("Services: Status and Replicas headers are explained, and there are no usage columns", async () => {
    mockInventory = [
      row({
        kind: "Service",
        externalId: "service/web",
        name: "shop_web",
        state: "2/3",
        serviceMode: "replicated",
        runningReplicas: 2,
        desiredReplicas: 3,
        isReady: false,
      }),
    ];

    const result: RenderResult = render(
      <DockerSwarmClusterServices {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("shop_web")).toBeInTheDocument();

    await expectTooltip("Status", T.serviceStatusColumn);
    await expectTooltip("Replicas", T.replicas);
    expect(
      screen.queryByRole("columnheader", { name: /^CPU/ }),
    ).not.toBeInTheDocument();
    expect(infoNames()).not.toContain("Mode");
    expectNoNestedControls(result.container);
  });

  test("Stacks: the Services count and the Status that repeats it are explained", async () => {
    mockInventory = [
      row({
        kind: "Stack",
        externalId: "stack/shop",
        name: "shop",
        state: "3 services",
        attributes: { serviceCount: 3 },
      }),
    ];

    const result: RenderResult = render(
      <DockerSwarmClusterStacks {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("shop")).toBeInTheDocument();
    // The Status badge and the Services cell show the same count.
    expect(screen.getByText("3 services")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    await expectTooltip("Services", T.stackServices);
    await expectTooltip("Status", T.stackStatusColumn);

    expect(infoNames()).toEqual(["Status", "Services"]);
    // A stack has no CPU or memory of its own, and no columns for them.
    expect(
      screen.queryByRole("columnheader", { name: /^CPU/ }),
    ).not.toBeInTheDocument();
    expectNoNestedControls(result.container);
  });
});
