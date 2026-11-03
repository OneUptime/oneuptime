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
 * A Docker or Podman host's Overview and a container's page
 * (Pages/{Docker,Podman}/View/Overview and ContainerDetail), rendered for
 * real against a stubbed data layer: the host's health and Needs attention
 * by the containers' rules (ContainerHostHealth), the count chip that opens
 * the Containers list, and a container's own page - its state in the hero,
 * where it runs, what on it needs attention, what it uses, its restarts,
 * what is open on it, the container alerts with Turn on N, its details - and
 * what each says when its read fails or the container is unknown.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOST_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";
const FULL_ID: string =
  "4f1c2d3e5a6b7c8d9e0f11223344556677889900aabbccddeeff001122334455";

interface MockContainer {
  name: string;
  cpu?: number;
  memoryPercent?: number;
  memoryBytes?: number;
  // Its network running totals, since it started.
  rx?: number;
  tx?: number;
  // Seconds since its last reading; past the 5-minute window it has none.
  readSecondsAgo?: number;
  // Seconds since its current run started (its inventory row).
  startedSecondsAgo?: number;
  restarts?: number;
  image?: string;
  labels?: Record<string, string>;
}

let mockContainers: Array<MockContainer> = [];
let mockHostStatus: string = "connected";
let mockReadingsFail: boolean = false;
let mockReadingReads: number = 0;
let mockSendsRestarts: boolean = true;

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

function readingPoints(metricName: string): Array<Record<string, unknown>> {
  const field: Record<string, keyof MockContainer> = {
    "container.cpu.utilization": "cpu",
    "container.memory.percent": "memoryPercent",
    "container.memory.usage.total": "memoryBytes",
    "container.network.io.usage.rx_bytes": "rx",
    "container.network.io.usage.tx_bytes": "tx",
  };
  const key: keyof MockContainer | undefined = field[metricName];
  return mockContainers
    .filter((container: MockContainer): boolean => {
      return (
        Boolean(key) &&
        container[key!] !== undefined &&
        (container.readSecondsAgo ?? 15) <= 5 * 60
      );
    })
    .map((container: MockContainer): Record<string, unknown> => {
      return {
        time: secondsAgo(container.readSecondsAgo ?? 15),
        value: container[key!],
        attributes: {
          "resource.container.name": container.name,
          "resource.container.id": FULL_ID,
          "resource.container.image.name": container.image || "acme/app:1",
        },
      };
    });
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => Record<string, unknown> = request.modelType;
        return Promise.resolve(
          Object.assign(new Model(), {
            _id: HOST_ID,
            name: "web-01",
            hostIdentifier: "web-01.acme.internal",
            otelCollectorStatus: mockHostStatus,
            lastSeenAt: new Date(),
            osType: "linux",
          }),
        );
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        let records: Array<Record<string, unknown>> = [];
        if (
          (modelName === "DockerResource" || modelName === "PodmanResource") &&
          !request.query?.["name"]
        ) {
          records = mockContainers.map(
            (container: MockContainer): Record<string, unknown> => {
              return {
                kind: "Container",
                name: container.name,
                imageName: container.image || "acme/app:1",
                labels: container.labels,
                metricsUpdatedAt: secondsAgo(container.readSecondsAgo ?? 15),
                lastSeenAt: secondsAgo(container.readSecondsAgo ?? 15),
                resourceCreationTimestamp:
                  container.startedSecondsAgo === undefined
                    ? undefined
                    : secondsAgo(container.startedSecondsAgo),
              };
            },
          );
        }
        const data: Array<Record<string, unknown>> = records.map(
          (record: Record<string, unknown>): Record<string, unknown> => {
            return Object.assign(new Model(), record);
          },
        );
        return Promise.resolve({ data, count: data.length });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
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
      getList: (request: { query: { name: string } }): Promise<unknown> => {
        mockReadingReads++;
        if (mockReadingsFail) {
          return Promise.reject(new Error("The server could not be reached."));
        }
        const data: Array<Record<string, unknown>> = readingPoints(
          request.query.name,
        );
        return Promise.resolve({ data, count: data.length });
      },
      aggregate: (request: {
        aggregateBy: { query: { name: string } };
      }): Promise<unknown> => {
        if (
          request.aggregateBy.query.name === "container.restarts.increase" &&
          mockSendsRestarts
        ) {
          return Promise.resolve({
            data: mockContainers
              .filter((container: MockContainer): boolean => {
                return container.restarts !== undefined;
              })
              .map((container: MockContainer): Record<string, unknown> => {
                return {
                  value: container.restarts,
                  attributes: { "resource.container.name": container.name },
                };
              }),
          });
        }
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
          return Promise.resolve([]);
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
        return Promise.resolve([]);
      },
    },
  };
});

function mockStub(testId: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={testId} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockStub("logs-viewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return mockStub("metric-card");
  },
);
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return mockStub("line-chart");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return mockStub("activity-cards");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
  () => {
    return mockStub("security-card");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return mockStub("ai-agent-card");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockStub("refresh-control");
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return mockStub("host-details");
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerWorkloadBadge",
  () => {
    return mockStub("database-badge");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ReceivingGaps",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Utils/ReceivingGaps",
    ) as Record<string, unknown>;
    return {
      ...actual,
      fetchReceivingGaps: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    };
  },
);

import DockerHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import PodmanHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import DockerHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/ContainerDetail";
import PodmanHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/ContainerDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

interface RuntimeCase {
  slug: "docker" | "podman";
  Overview: React.FunctionComponent<PageComponentProps>;
  ContainerDetail: React.FunctionComponent<PageComponentProps>;
  restartLoopTemplate: string;
}

const RUNTIMES: Array<[string, RuntimeCase]> = [
  [
    "Docker",
    {
      slug: "docker",
      Overview: DockerHostOverview,
      ContainerDetail: DockerHostContainerDetail,
      restartLoopTemplate: "docker-restart-loop",
    },
  ],
  [
    "Podman",
    {
      slug: "podman",
      Overview: PodmanHostOverview,
      ContainerDetail: PodmanHostContainerDetail,
      restartLoopTemplate: "podman-restart-loop",
    },
  ],
];

function pageProps(runtime: RuntimeCase): PageComponentProps {
  return {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}`),
    currentProject: null,
    hasPaymentMethod: false,
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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

// A host on which one container crash-loops, one stopped and one is fine.
const TROUBLED_HOST: Array<MockContainer> = [
  {
    name: "api",
    cpu: 12,
    memoryPercent: 30,
    restarts: 0,
    startedSecondsAgo: 7200,
  },
  {
    name: "worker",
    cpu: 3,
    memoryPercent: 20,
    restarts: 6,
    startedSecondsAgo: 40,
  },
  {
    name: "billing",
    readSecondsAgo: 6 * 60,
    startedSecondsAgo: 3 * 60 * 60,
    image: "acme/billing:4",
  },
  // A migration that ran for a minute and finished: nothing to say.
  { name: "migrate", readSecondsAgo: 6 * 60, startedSecondsAgo: 7 * 60 },
];

beforeEach(() => {
  mockContainers = [];
  mockHostStatus = "connected";
  mockReadingsFail = false;
  mockReadingReads = 0;
  mockSendsRestarts = true;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe.each(RUNTIMES)(
  "%s host Overview",
  (_name: string, runtime: RuntimeCase) => {
    async function openOverview(): Promise<void> {
      window.history.pushState(
        {},
        "",
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}`,
      );
      render(<runtime.Overview {...pageProps(runtime)} />);
      await waitFor(() => {
        expect(screen.getByText("web-01")).toBeInTheDocument();
      });
      await settle();
    }

    test("Needs attention lists the crash loop, then the service that stopped; the finished job is not there", async () => {
      mockContainers = TROUBLED_HOST;
      await openOverview();

      await waitFor(() => {
        expect(
          screen.getByTestId("container-host-needs-attention"),
        ).toBeInTheDocument();
      });

      const rows: Array<{
        key: string | null;
        severity: string | null;
        text: string;
      }> = attentionRows("container-host-needs-attention");
      expect(
        rows.map((row: { key: string | null }): string | null => {
          return row.key;
        }),
      ).toEqual(["container:worker", "container:billing"]);
      expect(rows[0]!.severity).toBe("critical");
      expect(rows[0]!.text).toContain("6 restarts in 15 minutes");
      expect(rows[1]!.severity).toBe("warning");
      expect(rows[1]!.text).toContain("Stopped reporting");
      expect(rows[1]!.text).toContain("acme/billing:4");

      // Each row opens the container's page.
      const workerLink: HTMLElement | null = within(
        screen.getByTestId("container-host-needs-attention"),
      )
        .getAllByTestId("container-host-needs-attention-item")[0]!
        .querySelector("a");
      expect(workerLink?.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}/containers/worker`,
      );
    });

    test("the hero says Unhealthy beside Connected, and counts every container the list has", async () => {
      mockContainers = TROUBLED_HOST;
      await openOverview();

      await waitFor(() => {
        expect(screen.getByTestId("container-host-health")).toHaveAttribute(
          "data-health",
          "Unhealthy",
        );
      });
      expect(screen.getByTestId("container-host-health")).toHaveTextContent(
        "Unhealthy",
      );

      const chip: HTMLElement = screen.getByTestId(
        "container-host-hero-containers",
      );
      expect(chip).toHaveTextContent("4 containers");
      expect(chip.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}/containers`,
      );
    });

    test("a host whose containers are fine: Healthy, and no Needs attention card", async () => {
      mockContainers = [
        { name: "api", cpu: 12, memoryPercent: 30, restarts: 0 },
        { name: "web", cpu: 95, memoryPercent: 40, restarts: 0 },
      ];
      await openOverview();

      await waitFor(() => {
        expect(screen.getByTestId("container-host-health")).toHaveAttribute(
          "data-health",
          "Healthy",
        );
      });
      expect(screen.queryByTestId("container-host-needs-attention")).toBeNull();
    });

    test("one restart and a container near its memory limit: Degraded", async () => {
      mockContainers = [
        { name: "api", cpu: 12, memoryPercent: 91, restarts: 0 },
        { name: "web", cpu: 5, memoryPercent: 40, restarts: 1 },
      ];
      await openOverview();

      await waitFor(() => {
        expect(screen.getByTestId("container-host-health")).toHaveAttribute(
          "data-health",
          "Degraded",
        );
      });
      expect(
        attentionRows("container-host-needs-attention").map(
          (row: { text: string }): boolean => {
            return (
              row.text.includes("Memory 91% used") ||
              row.text.includes("1 restart in 15 minutes")
            );
          },
        ),
      ).toEqual([true, true]);
    });

    test("a disconnected agent's readings are not the truth: Health Unknown, no card", async () => {
      mockHostStatus = "disconnected";
      mockContainers = TROUBLED_HOST;
      await openOverview();

      await waitFor(() => {
        expect(screen.getByTestId("container-host-health")).toHaveAttribute(
          "data-health",
          "Unknown",
        );
      });
      expect(screen.getByTestId("container-host-health")).toHaveTextContent(
        "Health Unknown",
      );
      expect(screen.queryByTestId("container-host-needs-attention")).toBeNull();
    });

    test("a host that reported no container yet has no health to tell, and no count", async () => {
      mockContainers = [];
      await openOverview();

      expect(screen.queryByTestId("container-host-health")).toBeNull();
      expect(screen.queryByTestId("container-host-hero-containers")).toBeNull();
    });

    test("a failed read says so in Needs attention's frame, and Refresh reads again", async () => {
      mockReadingsFail = true;
      mockContainers = TROUBLED_HOST;
      await openOverview();

      const frame: HTMLElement = await screen.findByTestId(
        "container-host-needs-attention-error",
      );
      expect(frame).toHaveTextContent("The server could not be reached.");

      mockReadingsFail = false;
      const reads: number = mockReadingReads;
      fireEvent.click(within(frame).getByRole("button"));

      await waitFor(() => {
        expect(
          screen.getByTestId("container-host-needs-attention"),
        ).toBeInTheDocument();
      });
      expect(mockReadingReads).toBeGreaterThan(reads);
      expect(
        screen.queryByTestId("container-host-needs-attention-error"),
      ).toBeNull();
    });
  },
);

describe.each(RUNTIMES)(
  "%s container page",
  (_name: string, runtime: RuntimeCase) => {
    async function openContainer(name: string): Promise<void> {
      window.history.pushState(
        {},
        "",
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}/containers/${name}`,
      );
      render(<runtime.ContainerDetail {...pageProps(runtime)} />);
      await screen.findByTestId("container-host-container-hero");
      await waitFor(() => {
        expect(
          screen.queryByTestId("container-host-container-overview") ||
            screen.queryByTestId("container-host-container-not-reported") ||
            screen.queryByTestId("container-host-container-read-error"),
        ).not.toBeNull();
      });
      await settle();
    }

    test("a crash-looping container: Restart loop in red, where it runs, and why", async () => {
      mockContainers = TROUBLED_HOST;
      await openContainer("worker");

      const hero: HTMLElement = screen.getByTestId(
        "container-host-container-hero",
      );
      expect(hero).toHaveTextContent("worker");
      expect(hero).toHaveTextContent("Restart loop");
      expect(hero).toHaveTextContent("Container on web-01");
      expect(hero).toHaveTextContent("acme/app:1");
      // It is running: no "Last reported" line.
      expect(hero).not.toHaveTextContent("Last reported");

      expect(attentionRows("container-host-container-attention")).toEqual([
        {
          key: "container:worker",
          severity: "critical",
          text: expect.stringContaining("6 restarts in 15 minutes"),
        },
      ]);
      expect(
        screen.getByTestId("container-host-container-attention"),
      ).toHaveTextContent("This container");

      const tiles: HTMLElement = screen.getByTestId(
        "container-host-container-tiles",
      );
      expect(tiles).toHaveTextContent("3.0%");
      expect(tiles).toHaveTextContent("20.0%");
      expect(tiles).toHaveTextContent("6");
      expect(tiles).toHaveTextContent("A restart loop");
    });

    test("a running container's details: image, id, Compose project and service, and its host", async () => {
      mockContainers = [
        {
          name: "shop-api-1",
          cpu: 12,
          memoryPercent: 30,
          restarts: 0,
          rx: 1000,
          tx: 3072,
          // Two and a half hours: "2 hours ago", whatever the read's timing.
          startedSecondsAgo: 9000,
          image: "acme/shop-api:2.4.1",
          labels: {
            "com.docker.compose.project": "shop",
            "com.docker.compose.service": "api",
          },
        },
      ];
      await openContainer("shop-api-1");

      expect(
        screen.queryByTestId("container-host-container-attention"),
      ).toBeNull();
      const hero: HTMLElement = screen.getByTestId(
        "container-host-container-hero",
      );
      expect(hero).toHaveTextContent("Running");
      expect(hero).toHaveTextContent("shop / api");

      const details: HTMLElement = screen.getByTestId(
        "container-host-container-details",
      );
      expect(details).toHaveTextContent("acme/shop-api:2.4.1");
      expect(details).toHaveTextContent(FULL_ID);
      expect(details).toHaveTextContent("shop");
      expect(details).toHaveTextContent("api");
      // Its network running totals: the list leaves them to this page.
      expect(details).toHaveTextContent("Network RX (total)");
      expect(details).toHaveTextContent("1000 B");
      expect(details).toHaveTextContent("Network TX (total)");
      expect(details).toHaveTextContent("3.0 KB");
      expect(within(details).getByText("web-01").closest("a")).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}`,
      );

      // The tiles: no restarts, started two hours ago.
      const tiles: HTMLElement = screen.getByTestId(
        "container-host-container-tiles",
      );
      expect(tiles).toHaveTextContent("2 hours ago");
      expect(tiles).toHaveTextContent("in the last 15 minutes");
    });

    test("the container alerts, the restart loop first, with one step to turn them on", async () => {
      mockContainers = TROUBLED_HOST;
      await openContainer("api");

      const alerts: HTMLElement = await screen.findByTestId(
        "container-host-container-alerts",
      );
      expect(alerts).toHaveTextContent("Container Restart Loop");
      const turnOn: HTMLElement | null = await waitFor(() => {
        const link: HTMLElement | null =
          within(alerts)
            .queryAllByRole("link")
            .find((candidate: HTMLElement): boolean => {
              return (candidate.textContent || "").startsWith("Turn on");
            }) || null;
        expect(link).not.toBeNull();
        return link;
      });
      const url: URL = new URL(
        turnOn!.getAttribute("href") || "",
        "https://oneuptime.example",
      );
      expect(url.pathname).toBe(
        `/dashboard/${PROJECT_ID}/${runtime.slug}/${HOST_ID}/recommendations`,
      );
      expect(url.searchParams.get("select") || "").toContain(
        runtime.restartLoopTemplate,
      );
    });

    test("a service that stopped: Stopped reporting, when it last reported, and no readings", async () => {
      mockContainers = TROUBLED_HOST;
      await openContainer("billing");

      const hero: HTMLElement = screen.getByTestId(
        "container-host-container-hero",
      );
      expect(hero).toHaveTextContent("Stopped reporting");
      expect(hero).toHaveTextContent("Last reported");
      expect(screen.queryByTestId("container-host-container-tiles")).toBeNull();
      expect(attentionRows("container-host-container-attention")).toEqual([
        {
          key: "container:billing",
          severity: "warning",
          text: expect.stringContaining("Stopped reporting"),
        },
      ]);
    });

    test("a job that finished: Not reporting, nothing needs attention", async () => {
      mockContainers = TROUBLED_HOST;
      await openContainer("migrate");

      expect(
        screen.getByTestId("container-host-container-hero"),
      ).toHaveTextContent("Not reporting");
      expect(
        screen.queryByTestId("container-host-container-attention"),
      ).toBeNull();
    });

    test("an agent without restart counts: the Restarts tile reads missing, never 0", async () => {
      mockSendsRestarts = false;
      mockContainers = [{ name: "api", cpu: 1, memoryPercent: 2 }];
      await openContainer("api");

      const tiles: HTMLElement = screen.getByTestId(
        "container-host-container-tiles",
      );
      const restarts: HTMLElement = within(tiles)
        .getByRole("button", { name: "About Restarts" })
        .closest("div.rounded-xl") as HTMLElement;
      expect(
        (restarts.querySelector("div.text-2xl")?.textContent || "").trim(),
      ).toBe("—");
    });

    test("a container nothing reported: it says so, and where every container is", async () => {
      mockContainers = TROUBLED_HOST;
      await openContainer("ghost");

      expect(
        screen.getByTestId("container-host-container-not-reported"),
      ).toHaveTextContent("No reading of this container has arrived");
      expect(
        screen.getByTestId("container-host-container-hero"),
      ).toHaveTextContent("Container on web-01");
    });

    test("a read that fails says so in its own frame, with Try again", async () => {
      mockReadingsFail = true;
      mockContainers = TROUBLED_HOST;
      await openContainer("api");

      const error: HTMLElement = screen.getByTestId(
        "container-host-container-read-error",
      );
      expect(error).toHaveTextContent("Couldn't load this container");
      expect(error).toHaveTextContent("The server could not be reached.");

      mockReadingsFail = false;
      fireEvent.click(within(error).getByRole("button", { name: /Try again/ }));

      await waitFor(() => {
        expect(
          screen.getByTestId("container-host-container-overview"),
        ).toBeInTheDocument();
      });
    });
  },
);
