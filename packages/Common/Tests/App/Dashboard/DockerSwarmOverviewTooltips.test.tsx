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
 * API and the router replaced: every count, field and column header that
 * shows a number has an (i), hovering it shows the text from
 * DockerSwarmMetricDescriptions, and the (i) never sits inside another
 * control. The overview tiles used to be <button>s; they are now cards with
 * an overlay button, so the (i) can be reached and does not navigate.
 *
 * Tippy under jsdom (see InfoTooltip.test.tsx): the popup is portalled to
 * document.body and queried through `screen`; it is lazy, so fake timers
 * are advanced after the hover.
 */

const CLUSTER_ID: string = "11111111-1111-4111-8111-111111111111";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
let lastParam: string = "";

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
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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

import DockerSwarmClusterOverview, {
  SwarmCountTile,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Index";
import DockerSwarmClusterTaskDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/TaskDetail";
import DockerSwarmClusterServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/ServiceDetail";
import DockerSwarmClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/NodeDetail";
import DockerSwarmClusterTasks from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Tasks";
import DockerSwarmClusterNodes from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Nodes";
import DockerSwarmClusterServices from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Services";
import DockerSwarmClusterStacks from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Stacks";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmResource from "../../../Models/DatabaseModels/DockerSwarmResource";
import Route from "../../../Types/API/Route";

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
  metricsUpdatedAt: Date;
  lastSeenAt: Date;
  attributes: Record<string, unknown>;
}>;

function row(init: RowInit): DockerSwarmResource {
  const model: DockerSwarmResource = new DockerSwarmResource();
  Object.assign(model, init);
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

const INVENTORY: Array<DockerSwarmResource> = [
  row({
    kind: "Node",
    externalId: "node/a",
    name: "manager-1",
    state: "ready",
    role: "manager",
    isReady: true,
  }),
  row({
    kind: "Node",
    externalId: "node/b",
    name: "worker-1",
    state: "ready",
    role: "worker",
    isReady: true,
  }),
  row({
    kind: "Service",
    externalId: "service/web",
    name: "shop_web",
    state: "2/3",
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
  }),
  row({
    kind: "Task",
    externalId: "task/t2",
    name: "shop_web.2",
    state: "starting",
    isReady: false,
  }),
  row({ kind: "Stack", externalId: "stack/shop", name: "shop" }),
  row({ kind: "Network", externalId: "network/n1", name: "shop_default" }),
  row({ kind: "Volume", externalId: "volume/data@manager-1", name: "data" }),
];

function listResult(data: Array<DockerSwarmResource>): {
  data: Array<DockerSwarmResource>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: data.length };
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
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

function expectNoNestedControls(root: HTMLElement): void {
  expect(root.querySelectorAll("button button")).toHaveLength(0);
  expect(root.querySelectorAll("a button")).toHaveLength(0);
  expect(root.querySelectorAll("button a")).toHaveLength(0);
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  navigateMock.mockReset();
  lastParam = "";
  getItemMock.mockImplementation(async () => {
    return cluster();
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("SwarmCountTile", () => {
  function renderTile(
    props: Partial<React.ComponentProps<typeof SwarmCountTile>> = {},
  ): { onOpen: MockFunction; result: RenderResult } {
    const onOpen: MockFunction = getJestMockFunction();
    const result: RenderResult = render(
      <SwarmCountTile
        label="Tasks"
        value={12}
        subline="10/12 running"
        description={T.tasks}
        onOpen={() => {
          onOpen();
        }}
        {...props}
      />,
    );
    return { onOpen, result };
  }

  test("shows the label, the count, the subline and an (i) named after the label", () => {
    renderTile();

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("10/12 running")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Tasks" }),
    ).toBeInTheDocument();
  });

  test("hovering the (i) explains the count", async () => {
    renderTile();

    await expectTooltip("Tasks", T.tasks);
  });

  test("the whole card still opens the list through an overlay button", () => {
    const { onOpen } = renderTile();

    fireEvent.click(screen.getByRole("button", { name: "View Tasks" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("asking what the count means does not open the list - by click, Enter or Space", () => {
    const { onOpen } = renderTile();
    const info: HTMLElement = screen.getByRole("button", {
      name: "About Tasks",
    });

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.keyDown(info, { key: " " });

    expect(onOpen).not.toHaveBeenCalled();
  });

  test("the (i) is a sibling of the overlay, lifted above it, never inside it", () => {
    const { result } = renderTile();
    const overlay: HTMLElement = screen.getByRole("button", {
      name: "View Tasks",
    });
    const info: HTMLElement = screen.getByRole("button", {
      name: "About Tasks",
    });

    expectNoNestedControls(result.container);
    expect(overlay).not.toContainElement(info);
    expect(overlay.className).toContain("absolute inset-0");
    expect(info.className).toContain("relative z-10");
    expect(overlay.parentElement!.className).toContain("relative");
  });

  test("no description, no (i) - and the tile still works", () => {
    const { onOpen } = renderTile({ description: undefined, subline: null });

    expect(
      screen.queryByRole("button", { name: "About Tasks" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("10/12 running")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Tasks" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("Docker Swarm overview page", () => {
  async function renderOverview(): Promise<RenderResult> {
    getListMock.mockImplementation(async () => {
      return listResult(INVENTORY);
    });

    const result: RenderResult = render(
      <DockerSwarmClusterOverview {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("prod-swarm")).toBeInTheDocument();

    return result;
  }

  const TILES: Array<[string, string]> = [
    ["Nodes", T.nodes],
    ["Tasks", T.tasks],
    ["Stacks", T.stacks],
    ["Networks", T.networks],
    ["Volumes", T.volumes],
  ];

  test.each(TILES)(
    "the %s tile explains itself on hover",
    async (title: string, text: string) => {
      await renderOverview();

      await expectTooltip(title, text);
    },
  );

  test("Services has one (i) on its tile and one on its hero chip, both with the same text", async () => {
    await renderOverview();

    expect(
      screen.getAllByRole("button", { name: "About Services" }),
    ).toHaveLength(2);
    await expectTooltip("Services", T.services);
  });

  test("the hero chips that are counts are explained under a static name", async () => {
    await renderOverview();

    expect(screen.getByText("2/2 nodes ready")).toBeInTheDocument();
    expect(screen.getByText("1 manager")).toBeInTheDocument();
    expect(screen.getByText("1/2 tasks running")).toBeInTheDocument();

    await expectTooltip("Nodes ready", T.nodes);
    await expectTooltip("Managers", T.managers);
    await expectTooltip("Tasks running", T.tasks);

    // The (i) is never named after the numbers in the chip.
    expect(
      screen.queryByRole("button", { name: /About \d/ }),
    ).not.toBeInTheDocument();
  });

  test("version chips are metadata and get no (i)", async () => {
    await renderOverview();

    expect(screen.getByText("Docker 27.1.1")).toBeInTheDocument();
    expect(screen.getByText("Agent 0.161.0")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /About (Docker|Agent)/ }),
    ).not.toBeInTheDocument();
  });

  test("tiles show the inventory counts they explain", async () => {
    await renderOverview();

    const tasksTile: HTMLElement = screen.getByRole("button", {
      name: "View Tasks",
    }).parentElement!;

    expect(within(tasksTile).getByText("2")).toBeInTheDocument();
    expect(within(tasksTile).getByText("1/2 running")).toBeInTheDocument();

    const servicesTile: HTMLElement = screen.getByRole("button", {
      name: "View Services",
    }).parentElement!;

    expect(within(servicesTile).getByText("0/1 converged")).toBeInTheDocument();
  });

  test("every tile has exactly one (i), and there are six tiles", async () => {
    await renderOverview();

    const overlays: Array<HTMLElement> = screen.getAllByRole("button", {
      name: /^View /,
    });

    expect(
      overlays.map((overlay: HTMLElement) => {
        return overlay.textContent;
      }),
    ).toEqual([
      "View Nodes",
      "View Services",
      "View Tasks",
      "View Stacks",
      "View Networks",
      "View Volumes",
    ]);

    for (const overlay of overlays) {
      expect(
        within(overlay.parentElement!).getAllByRole("button", {
          name: /^About /,
        }),
      ).toHaveLength(1);
    }
  });

  test("no control is nested in another anywhere on the page", async () => {
    const result: RenderResult = await renderOverview();

    expectNoNestedControls(result.container);
  });

  test("a tile still opens its list; its (i) does not", async () => {
    await renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "About Tasks" }));
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "View Tasks" }));
    expect(navigateMock).toHaveBeenCalledTimes(1);

    const route: Route = navigateMock.mock.calls[0]![0] as Route;
    expect(route.toString()).toContain(CLUSTER_ID);
    expect(route.toString()).toContain("tasks");
  });
});

describe("Docker Swarm detail pages", () => {
  test("the task page explains CPU and Memory, and leaves names and state plain", async () => {
    lastParam = encodeURIComponent("task/t1");
    getListMock.mockImplementation(async () => {
      return listResult([
        row({
          kind: "Task",
          externalId: "task/t1",
          name: "shop_web.1",
          state: "running",
          isReady: true,
          serviceName: "shop_web",
          latestCpuPercent: 12.5,
          latestMemoryBytes: 64 * 1024 * 1024,
        }),
      ]);
    });

    render(<DockerSwarmClusterTaskDetail {...PAGE_PROPS} />);
    await flush();

    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("64.0 MiB")).toBeInTheDocument();

    await expectTooltip("CPU", T.taskCpu);
    await expectTooltip("Memory", T.taskMemory);

    for (const plain of [
      "Task",
      "Cluster",
      "State",
      "Service",
      "External ID",
    ]) {
      expect(
        screen.queryByRole("button", { name: `About ${plain}` }),
      ).not.toBeInTheDocument();
    }
  });

  test("the service page explains Status and Replicas", async () => {
    lastParam = encodeURIComponent("service/web");
    getListMock.mockImplementation(async () => {
      return listResult([
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
      ]);
    });

    render(<DockerSwarmClusterServiceDetail {...PAGE_PROPS} />);
    await flush();

    expect(screen.getAllByText("2/3").length).toBeGreaterThanOrEqual(2);

    await expectTooltip("Status", T.serviceStatus);
    await expectTooltip("Replicas", T.replicas);

    expect(
      screen.queryByRole("button", { name: "About Mode" }),
    ).not.toBeInTheDocument();
  });

  test("the node page shows no (i): nothing on it is a metric the swarm reports per node", async () => {
    lastParam = encodeURIComponent("node/a");
    getListMock.mockImplementation(async () => {
      return listResult([
        row({
          kind: "Node",
          externalId: "node/a",
          name: "manager-1",
          state: "ready",
          role: "manager",
          isReady: true,
        }),
      ]);
    });

    render(<DockerSwarmClusterNodeDetail {...PAGE_PROPS} />);
    await flush();

    expect(screen.getByText("manager-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });
});

describe("Docker Swarm list pages", () => {
  const FRESH: Date = new Date();

  test("Tasks: CPU and Memory headers explain the latest reading", async () => {
    getListMock.mockImplementation(async () => {
      return listResult([
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
        }),
      ]);
    });

    const result: RenderResult = render(
      <DockerSwarmClusterTasks {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("shop_web.1")).toBeInTheDocument();

    await expectTooltip("CPU", T.taskCpuColumn);
    await expectTooltip("Memory", T.taskMemoryColumn);

    // Status and metadata columns stay plain.
    for (const plain of ["Status", "Service", "Image", "Node", "Age"]) {
      expect(
        screen.queryByRole("button", { name: `About ${plain}` }),
      ).not.toBeInTheDocument();
    }
    expectNoNestedControls(result.container);
  });

  test("Nodes: CPU and Memory headers say why every row reads N/A", async () => {
    getListMock.mockImplementation(async () => {
      return listResult([
        row({
          kind: "Node",
          externalId: "node/a",
          name: "manager-1",
          state: "ready",
          role: "manager",
          isReady: true,
        }),
      ]);
    });

    const result: RenderResult = render(
      <DockerSwarmClusterNodes {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getAllByText("N/A")).toHaveLength(2);

    await expectTooltip("CPU", T.nodeUsageColumns);
    await expectTooltip("Memory", T.nodeUsageColumns);
    expect(
      screen.queryByRole("button", { name: "About Role" }),
    ).not.toBeInTheDocument();
    expectNoNestedControls(result.container);
  });

  test("Services: Status, Replicas, CPU and Memory headers are explained", async () => {
    getListMock.mockImplementation(async () => {
      return listResult([
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
      ]);
    });

    const result: RenderResult = render(
      <DockerSwarmClusterServices {...PAGE_PROPS} />,
    );
    await flush();

    expect(screen.getByText("shop_web")).toBeInTheDocument();

    await expectTooltip("Status", T.serviceStatusColumn);
    await expectTooltip("Replicas", T.replicas);
    await expectTooltip("CPU", T.serviceUsageColumns);
    await expectTooltip("Memory", T.serviceUsageColumns);
    expect(
      screen.queryByRole("button", { name: "About Mode" }),
    ).not.toBeInTheDocument();
    expectNoNestedControls(result.container);
  });

  test("Stacks: the Services count and the Status that repeats it are explained", async () => {
    getListMock.mockImplementation(async () => {
      return listResult([
        row({
          kind: "Stack",
          externalId: "stack/shop",
          name: "shop",
          state: "3 services",
          attributes: { serviceCount: 3 },
        }),
      ]);
    });

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

    expect(
      screen
        .getAllByRole("button", { name: /^About / })
        .map((button: HTMLElement): string => {
          return button.getAttribute("aria-label") || "";
        }),
    ).toEqual(["About Status", "About Services"]);
    // A stack has no CPU or memory of its own, and no columns for them.
    expect(
      screen.queryByRole("columnheader", { name: /^CPU/ }),
    ).not.toBeInTheDocument();
    expectNoNestedControls(result.container);
  });
});
