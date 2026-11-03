import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  CONTAINER_READING_METRICS,
  CONTAINER_READINGS_LIMIT,
  CONTAINER_READINGS_WINDOW_MINUTES,
  CONTAINER_RESTARTS_METRIC,
  ContainerHostMetricPoint,
  ContainerHostReadings,
  getContainerRestartTotals,
  joinContainerHostReadings,
  loadContainerHostReadings,
  readContainerLabelsFromAttributes,
  toContainerDate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostReadings";
import { ContainerHostContainer } from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostHealth";
import {
  DOCKER_CONTAINER_HOST_RUNTIME,
  PODMAN_CONTAINER_HOST_RUNTIME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostRuntime";

/*
 * Every container of a Docker or Podman host with its latest readings
 * (Components/ContainerHost/ContainerHostReadings): the newest point of
 * each of five metrics in the last 5 minutes, the restarts of the last 15,
 * and the inventory row that keeps a container that stopped - joined by
 * name, for the Overview's Needs attention, the Containers list and a
 * container's page alike. The restarts and the inventory are supplements: a
 * read of either that fails still leaves the readings.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const HOST_ID: ObjectID = new ObjectID("5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9");
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const FULL_ID: string =
  "f00d0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab";

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

function point(
  name: string,
  value: unknown,
  seconds: number,
  extra: Record<string, unknown> = {},
): ContainerHostMetricPoint {
  return {
    time: secondsAgo(seconds),
    value: value,
    attributes: { "resource.container.name": name, ...extra },
  };
}

function byName(
  readings: ContainerHostReadings,
  name: string,
): ContainerHostContainer {
  const found: ContainerHostContainer | undefined = readings.containers.find(
    (container: ContainerHostContainer): boolean => {
      return container.name === name;
    },
  );
  if (!found) {
    throw new Error(`No container ${name}`);
  }
  return found;
}

describe("joining the reads", () => {
  test("a container's latest reading is its newest point of each metric", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [
          point("api", 42, 10, {
            "resource.container.id": FULL_ID,
            "resource.container.image.name": "acme/api:2",
          }),
          point("api", 99, 40),
        ],
        "container.memory.usage.total": [point("api", 1024, 10)],
        "container.memory.percent": [point("api", "12.5", 10)],
        "container.network.io.usage.rx_bytes": [point("api", 7, 10)],
        "container.network.io.usage.tx_bytes": [point("api", 9, 10)],
      },
      restartTotals: null,
      inventoryRows: null,
      readAt: NOW,
    });

    const api: ContainerHostContainer = byName(readings, "api");
    expect(api.cpuPercent).toBe(42);
    expect(api.memoryBytes).toBe(1024);
    expect(api.memoryPercent).toBe(12.5);
    expect(api.networkRxBytes).toBe(7);
    expect(api.networkTxBytes).toBe(9);
    // The id as the agent reports it: the logs are filed under the whole id.
    expect(api.containerId).toBe(FULL_ID);
    expect(api.image).toBe("acme/api:2");
    expect(api.lastReadingAt).toEqual(secondsAgo(10));
  });

  test("points without a name, without a value or with a value that is not a number are left out", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [
          { time: NOW, value: 5, attributes: {} },
          { time: NOW, value: 5, attributes: "not an object" },
          point("api", null, 5),
          point("api", "lots", 6),
          point("api", 3, 30),
        ],
      },
      restartTotals: null,
      inventoryRows: null,
      readAt: NOW,
    });

    expect(readings.containers).toHaveLength(1);
    // The first point it could read: the one 30 seconds ago.
    expect(byName(readings, "api").cpuPercent).toBe(3);
  });

  test("the Compose labels the agent copies onto readings name its project and service", () => {
    expect(
      readContainerLabelsFromAttributes({
        "resource.com.docker.compose.project": "shop",
        "resource.com.docker.compose.service": "api",
        "resource.container.name": "shop-api-1",
        "com.docker.compose.project": "not a resource attribute",
      }),
    ).toEqual({
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "api",
    });
    expect(readContainerLabelsFromAttributes({})).toBeNull();

    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [
          point("site-web-1", 1, 5, {
            "resource.io.podman.compose.project": "site",
          }),
        ],
      },
      restartTotals: null,
      inventoryRows: null,
      readAt: NOW,
    });
    expect(byName(readings, "site-web-1").labels).toEqual({
      "io.podman.compose.project": "site",
    });
  });

  test("the inventory keeps a container that stopped, with when its run started", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [point("api", 1, 10)],
      },
      restartTotals: null,
      inventoryRows: [
        {
          kind: "Container",
          name: "billing",
          containerId: FULL_ID,
          imageName: "acme/billing:4",
          labels: { "com.docker.compose.project": "shop" },
          metricsUpdatedAt: secondsAgo(8 * 60),
          lastSeenAt: secondsAgo(8 * 60).toISOString(),
          resourceCreationTimestamp: secondsAgo(3 * 60 * 60).toISOString(),
        },
        {
          kind: "Container",
          name: "api",
          resourceCreationTimestamp: secondsAgo(600),
          metricsUpdatedAt: secondsAgo(20),
        },
        // Images, networks and volumes are not containers.
        { kind: "Image", name: "nginx:1.27" },
        { kind: "Container", name: "  " },
      ],
      readAt: NOW,
    });

    expect(
      readings.containers.map((container: ContainerHostContainer): string => {
        return container.name;
      }),
    ).toEqual(["api", "billing"]);

    const billing: ContainerHostContainer = byName(readings, "billing");
    expect(billing.cpuPercent).toBeNull();
    expect(billing.image).toBe("acme/billing:4");
    expect(billing.containerId).toBe(FULL_ID);
    expect(billing.labels).toEqual({ "com.docker.compose.project": "shop" });
    expect(billing.startedAt).toEqual(secondsAgo(3 * 60 * 60));
    expect(billing.lastReadingAt).toEqual(secondsAgo(8 * 60));

    // The newer of its point and its row.
    const api: ContainerHostContainer = byName(readings, "api");
    expect(api.lastReadingAt).toEqual(secondsAgo(10));
    expect(api.startedAt).toEqual(secondsAgo(600));

    expect(readings.hasInventory).toBe(true);
    expect(readings.hostLatestReadingAt).toEqual(secondsAgo(10));
  });

  test("the row's labels join the reading's, the row's winning", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [
          point("api", 1, 5, {
            "resource.com.docker.compose.project": "old",
          }),
        ],
      },
      restartTotals: null,
      inventoryRows: [
        {
          kind: "Container",
          name: "api",
          labels: {
            "com.docker.compose.project": "shop",
            "com.docker.compose.service": "api",
          },
        },
      ],
      readAt: NOW,
    });

    expect(byName(readings, "api").labels).toEqual({
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "api",
    });
  });

  test("restart counts: every container has one once the agent sends any, none when it sends none", () => {
    const counted: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [point("api", 1, 5), point("web", 1, 5)],
      },
      restartTotals: new Map([["api", 4]]),
      inventoryRows: null,
      readAt: NOW,
    });
    expect(byName(counted, "api").restarts).toBe(4);
    expect(byName(counted, "web").restarts).toBe(0);
    expect(counted.hasRestartCounts).toBe(true);

    const uncounted: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [point("api", 1, 5)],
      },
      restartTotals: null,
      inventoryRows: null,
      readAt: NOW,
    });
    expect(byName(uncounted, "api").restarts).toBeNull();
    expect(uncounted.hasRestartCounts).toBe(false);
    expect(uncounted.hasInventory).toBe(false);
  });

  test("containers read in the order people count: web-2 before web-10", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {
        "container.cpu.utilization": [
          point("web-10", 1, 5),
          point("Web-2", 1, 5),
          point("api", 1, 5),
        ],
      },
      restartTotals: null,
      inventoryRows: null,
      readAt: NOW,
    });

    expect(
      readings.containers.map((container: ContainerHostContainer): string => {
        return container.name;
      }),
    ).toEqual(["api", "Web-2", "web-10"]);
  });

  test("no reads at all: no containers, and the host has no newest reading", () => {
    const readings: ContainerHostReadings = joinContainerHostReadings({
      metricPoints: {},
      restartTotals: null,
      inventoryRows: [],
      readAt: NOW,
    });
    expect(readings.containers).toEqual([]);
    expect(readings.hostLatestReadingAt).toBeNull();
    expect(readings.readAt).toBe(NOW);
  });
});

describe("restart totals", () => {
  test("add up each container's increases; a name or value that cannot be read is left out", () => {
    const totals: Map<string, number> | null = getContainerRestartTotals({
      data: [
        { value: 2, attributes: { "resource.container.name": "api" } },
        { value: 1, attributes: { "resource.container.name": "api" } },
        { value: 0, attributes: { "resource.container.name": "web" } },
        { value: "x", attributes: { "resource.container.name": "bad" } },
        { value: 3, attributes: {} },
        { value: 3 },
      ],
    });
    expect(totals).toEqual(
      new Map([
        ["api", 3],
        ["web", 0],
      ]),
    );
  });

  test("an empty answer is an agent that sends no count, not every container at zero", () => {
    expect(getContainerRestartTotals({ data: [] })).toBeNull();
    expect(getContainerRestartTotals(null)).toBeNull();
  });
});

describe("dates", () => {
  test("read a Date or its text; anything else is no date", () => {
    expect(toContainerDate(NOW)).toBe(NOW);
    expect(toContainerDate(NOW.toISOString())).toEqual(NOW);
    expect(toContainerDate("yesterday-ish")).toBeNull();
    expect(toContainerDate(null)).toBeNull();
    expect(toContainerDate(undefined)).toBeNull();
  });
});

describe("loading a host's containers", () => {
  interface ListRequest {
    query: {
      projectId: string;
      name: string;
      time: InBetween<Date>;
      attributes: Record<string, string>;
    };
    limit: number;
    sort: Record<string, string>;
  }

  let listRequests: Array<ListRequest>;
  let aggregateRequests: Array<{
    aggregateBy: {
      query: {
        name: string;
        time: InBetween<Date>;
        attributes: Record<string, string>;
      };
      aggregationType: AggregationType;
      aggregationInterval: AggregationInterval;
      groupByAttributeKeys: Array<string>;
    };
  }>;
  let inventoryRequests: Array<{
    modelType: unknown;
    query: Record<string, unknown>;
  }>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    listRequests = [];
    aggregateRequests = [];
    inventoryRequests = [];
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockImplementation((...args: Array<unknown>): Promise<never> => {
        const request: ListRequest = args[0] as ListRequest;
        listRequests.push(request);
        return Promise.resolve({
          data:
            request.query.name === "container.cpu.utilization"
              ? [point("api", 12, 10)]
              : [],
          count: 0,
          skip: 0,
          limit: CONTAINER_READINGS_LIMIT,
        } as never);
      });
    jest
      .spyOn(AnalyticsModelAPI, "aggregate")
      .mockImplementation((...args: Array<unknown>): Promise<never> => {
        aggregateRequests.push(args[0] as (typeof aggregateRequests)[number]);
        return Promise.resolve({
          data: [
            { value: 5, attributes: { "resource.container.name": "api" } },
          ],
        } as never);
      });
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation((...args: Array<unknown>): Promise<never> => {
        inventoryRequests.push(
          args[0] as { modelType: unknown; query: Record<string, unknown> },
        );
        return Promise.resolve({
          data: [{ kind: "Container", name: "billing", lastSeenAt: NOW }],
          count: 1,
          skip: 0,
          limit: 1,
        } as never);
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test.each([
    ["Docker", DOCKER_CONTAINER_HOST_RUNTIME, DockerResource, "dockerHostId"],
    ["Podman", PODMAN_CONTAINER_HOST_RUNTIME, PodmanResource, "podmanHostId"],
  ] as Array<[string, typeof DOCKER_CONTAINER_HOST_RUNTIME, unknown, string]>)(
    "%s: the five readings of the last 5 minutes, the restarts of 15, and the inventory, all of its own runtime",
    async (
      _name: string,
      runtime: typeof DOCKER_CONTAINER_HOST_RUNTIME,
      model: unknown,
      hostColumn: string,
    ) => {
      const readings: ContainerHostReadings = await loadContainerHostReadings({
        runtime: runtime,
        hostId: HOST_ID,
        hostIdentifier: "web-01",
      });

      expect(
        listRequests.map((request: ListRequest): string => {
          return request.query.name;
        }),
      ).toEqual(
        CONTAINER_READING_METRICS.map(
          (metric: { metricName: string }): string => {
            return metric.metricName;
          },
        ),
      );
      for (const request of listRequests) {
        expect(request.query.projectId).toBe(PROJECT_ID.toString());
        expect(request.query.attributes).toEqual({
          "resource.host.name": "web-01",
          "resource.container.runtime": runtime.runtime,
        });
        expect(request.query.time.startValue).toEqual(
          new Date(NOW.getTime() - CONTAINER_READINGS_WINDOW_MINUTES * 60_000),
        );
        expect(request.query.time.endValue).toEqual(NOW);
        expect(request.limit).toBe(CONTAINER_READINGS_LIMIT);
        expect(request.sort).toEqual({ time: SortOrder.Descending });
      }

      expect(aggregateRequests).toHaveLength(1);
      const restarts: (typeof aggregateRequests)[number]["aggregateBy"] =
        aggregateRequests[0]!.aggregateBy;
      expect(restarts.query.name).toBe(CONTAINER_RESTARTS_METRIC);
      expect(restarts.query.attributes).toEqual({
        "resource.host.name": "web-01",
        "resource.container.runtime": runtime.runtime,
      });
      expect(restarts.query.time.startValue).toEqual(
        new Date(NOW.getTime() - 15 * 60_000),
      );
      expect(restarts.aggregationType).toBe(AggregationType.Sum);
      expect(restarts.aggregationInterval).toBe(AggregationInterval.Total);
      expect(restarts.groupByAttributeKeys).toEqual([
        "resource.container.name",
      ]);

      expect(inventoryRequests).toHaveLength(1);
      expect(inventoryRequests[0]!.modelType).toBe(model);
      expect(
        (inventoryRequests[0]!.query[hostColumn] as ObjectID).toString(),
      ).toBe(HOST_ID.toString());
      expect(inventoryRequests[0]!.query["kind"]).toBe("Container");

      expect(
        readings.containers.map((container: ContainerHostContainer): string => {
          return container.name;
        }),
      ).toEqual(["api", "billing"]);
      expect(byName(readings, "api").restarts).toBe(5);
      expect(byName(readings, "billing").restarts).toBe(0);
      expect(readings.readAt).toEqual(NOW);
    },
  );

  test("a restarts read that fails leaves the readings, without counts", async () => {
    jest
      .spyOn(AnalyticsModelAPI, "aggregate")
      .mockImplementation((): Promise<never> => {
        return Promise.reject(new Error("Timed out"));
      });

    const readings: ContainerHostReadings = await loadContainerHostReadings({
      runtime: DOCKER_CONTAINER_HOST_RUNTIME,
      hostId: HOST_ID,
      hostIdentifier: "web-01",
    });

    expect(readings.hasRestartCounts).toBe(false);
    expect(byName(readings, "api").restarts).toBeNull();
    expect(byName(readings, "api").cpuPercent).toBe(12);
  });

  test("an inventory a role may not read leaves the readings, without the stopped ones", async () => {
    jest.spyOn(ModelAPI, "getList").mockImplementation((): Promise<never> => {
      return Promise.reject(new Error("You do not have permission"));
    });

    const readings: ContainerHostReadings = await loadContainerHostReadings({
      runtime: PODMAN_CONTAINER_HOST_RUNTIME,
      hostId: HOST_ID,
      hostIdentifier: "web-01",
    });

    expect(readings.hasInventory).toBe(false);
    expect(
      readings.containers.map((container: ContainerHostContainer): string => {
        return container.name;
      }),
    ).toEqual(["api"]);
  });

  test("a readings read that fails fails the whole: there is nothing to say", async () => {
    jest
      .spyOn(AnalyticsModelAPI, "getList")
      .mockImplementation((): Promise<never> => {
        return Promise.reject(new Error("ClickHouse is down"));
      });

    await expect(
      loadContainerHostReadings({
        runtime: DOCKER_CONTAINER_HOST_RUNTIME,
        hostId: HOST_ID,
        hostIdentifier: "web-01",
      }),
    ).rejects.toThrow("ClickHouse is down");
  });
});
