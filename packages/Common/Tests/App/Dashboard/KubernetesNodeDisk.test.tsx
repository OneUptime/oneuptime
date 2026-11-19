import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Kubernetes node's disks on the pages people read them on (#9645): the
 * Nodes list's Disk, Disk Free and Disk Capacity columns after CPU and
 * Memory, an Image Disk column only while a node's images have a disk of
 * their own, the node page's Disk card, and its Metrics tab's disk charts.
 * Rendered for real, with the inventory read stubbed.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockFetchInventory: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return mockGetItem(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return "node-1";
      },
      getQueryStringByName: () => {
        return null;
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    return {
      __esModule: true,
      default: {
        fetchInventoryResources: (...args: Array<any>) => {
          return mockFetchInventory(...args);
        },
        formatAge: () => {
          return "3d";
        },
        parseK8sMemoryToBytes: () => {
          return 0;
        },
      },
    };
  },
);

import NodesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Nodes";
import KubernetesNodeDiskCard, {
  KUBERNETES_NODE_DISK_CARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesNodeDiskCard";
import {
  KUBERNETES_NODE_DISK_NOT_REPORTED,
  KubernetesNodeDisk,
  KubernetesNodeDiskCells,
  getKubernetesNodeDisk,
  getKubernetesNodeDiskCells,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesNodeDisk";
import {
  KubernetesNodeDiskCharts,
  getKubernetesNodeDiskCharts,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesNodeDiskCharts";
import { StorageUsageLevel } from "../../../Utils/Storage/StorageUsage";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";

const GIB: number = 1024 * 1024 * 1024;
const MINUTE: number = 60 * 1000;
const NOW: number = new Date("2026-11-19T12:00:00.000Z").getTime();

const NodesPage: React.FunctionComponent<any> = NodesView;
const PAGE_PROPS: Record<string, unknown> = {
  pageRoute: undefined,
  currentProject: null,
  hasPaymentMethod: false,
};

type Row = Record<string, unknown>;

function nodeRow(name: string, fields: Row = {}): Row {
  return {
    name: name,
    namespaceKey: "",
    status: { allocatable: { memory: "16Gi" } },
    ...fields,
  };
}

describe("a node's disks, read from its row", () => {
  test("its root filesystem, with when it was measured", () => {
    const disk: KubernetesNodeDisk = getKubernetesNodeDisk(
      {
        latestVolumeCapacityBytes: 100 * GIB,
        latestVolumeAvailableBytes: 15 * GIB,
        latestVolumeMeasuredAt: new Date(NOW - MINUTE),
      },
      NOW,
    );
    expect(disk.root?.usedPercent).toBe(85);
    expect(disk.root?.level).toBe(StorageUsageLevel.Warning);
    expect(disk.image).toBeNull();
    expect(disk.measuredAt).toEqual(new Date(NOW - MINUTE));
    expect(disk.isStale).toBe(false);
  });

  test("its image filesystem when it is a disk of its own, from text as Postgres hands it", () => {
    const disk: KubernetesNodeDisk = getKubernetesNodeDisk(
      {
        latestVolumeCapacityBytes: String(100 * GIB),
        latestVolumeAvailableBytes: String(60 * GIB),
        latestImageFsCapacityBytes: String(500 * GIB),
        latestImageFsAvailableBytes: String(25 * GIB),
        latestVolumeMeasuredAt: new Date(NOW - MINUTE).toISOString(),
      },
      NOW,
    );
    expect(disk.root?.usedPercent).toBe(40);
    expect(disk.image?.usedPercent).toBe(95);
    expect(disk.image?.level).toBe(StorageUsageLevel.Critical);
  });

  test("a reading older than fifteen minutes is stale; none at all is no reading", () => {
    expect(
      getKubernetesNodeDisk(
        {
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 15 * GIB,
          latestVolumeMeasuredAt: new Date(NOW - 16 * MINUTE),
        },
        NOW,
      ).isStale,
    ).toBe(true);
    const none: KubernetesNodeDisk = getKubernetesNodeDisk({}, NOW);
    expect(none).toEqual({
      root: null,
      image: null,
      measuredAt: null,
      isStale: true,
    });
  });

  test("the list's cells: the root disk's bar, the image disk's beside it, and words for none", () => {
    const fresh: KubernetesNodeDiskCells = getKubernetesNodeDiskCells(
      getKubernetesNodeDisk(
        {
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 15 * GIB,
          latestImageFsCapacityBytes: 400 * GIB,
          latestImageFsAvailableBytes: 100 * GIB,
          latestVolumeMeasuredAt: new Date(NOW - MINUTE),
        },
        NOW,
      ),
    );
    expect(fresh.storageUsage.usage?.usedPercent).toBe(85);
    expect(fresh.secondaryStorageUsage?.usage?.usedPercent).toBe(75);

    for (const disk of [
      getKubernetesNodeDisk({}, NOW),
      getKubernetesNodeDisk(
        {
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 15 * GIB,
          latestVolumeMeasuredAt: new Date(NOW - 20 * MINUTE),
        },
        NOW,
      ),
    ]) {
      expect(getKubernetesNodeDiskCells(disk)).toEqual({
        storageUsage: {
          usage: null,
          noUsageText: KUBERNETES_NODE_DISK_NOT_REPORTED,
        },
      });
    }
  });
});

describe("a node's disk charts", () => {
  const translator: ReturnType<typeof dashboardTranslator> =
    dashboardTranslator("en");

  function names(queries: Array<MetricQueryConfigData>): Array<string> {
    return queries.map((query: MetricQueryConfigData): string => {
      return query.metricQueryData.filterData.metricName as string;
    });
  }

  test("capacity with free space on it, and the share used against the bar's lines, for that node", () => {
    const charts: KubernetesNodeDiskCharts = getKubernetesNodeDiskCharts({
      clusterIdentifier: "prod",
      nodeName: "node-1",
      hasImageDisk: false,
      translator: translator,
    });

    expect(names(charts.queryConfigs)).toEqual([
      "k8s.node.filesystem.capacity",
      "k8s.node.filesystem.available",
    ]);
    expect(charts.queryConfigs[1]!.overlayWithPreviousQuery).toBe(true);
    for (const query of charts.queryConfigs) {
      expect(query.metricQueryData.filterData.attributes).toEqual({
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.node.name": "node-1",
      });
    }
    const [used] = charts.formulaConfigs as [MetricFormulaConfigData];
    expect(used.metricFormulaData.metricFormula).toBe(
      "((node_disk_capacity - node_disk_free) / node_disk_capacity) * 100",
    );
    expect(used.warningThreshold).toBe(80);
    expect(used.criticalThreshold).toBe(90);
    expect(used.metricAliasData.legendUnit).toBe("%");
  });

  test("an image disk of its own gets its two charts, from every container's root filesystem", () => {
    const charts: KubernetesNodeDiskCharts = getKubernetesNodeDiskCharts({
      clusterIdentifier: "prod",
      nodeName: "node-1",
      hasImageDisk: true,
      translator: translator,
    });

    expect(names(charts.queryConfigs)).toEqual([
      "k8s.node.filesystem.capacity",
      "k8s.node.filesystem.available",
      "container.filesystem.capacity",
      "container.filesystem.available",
    ]);
    expect(charts.formulaConfigs).toHaveLength(2);
    expect(charts.formulaConfigs[1]!.metricFormulaData.metricFormula).toBe(
      "((node_image_disk_capacity - node_image_disk_free) / node_image_disk_capacity) * 100",
    );
  });
});

describe("the node page's Disk card", () => {
  afterEach(() => {
    cleanup();
  });

  test("one disk: how much is used, free and its capacity, nearly full in amber", () => {
    render(
      <KubernetesNodeDiskCard
        disk={getKubernetesNodeDisk({
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 15 * GIB,
          latestVolumeMeasuredAt: new Date(),
        })}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Disk")).toBeInTheDocument();
    // Each amount held to its unit.
    expect(
      screen.getByTestId(`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-used`)
        .textContent,
    ).toBe("85\u00A0GiB");
    expect(
      screen.getByTestId(`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-free`)
        .textContent,
    ).toBe("15\u00A0GiB");
    expect(
      screen.getByTestId(`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-capacity`)
        .textContent,
    ).toBe("100\u00A0GiB");
    expect(
      screen.getByTestId(`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-level`),
    ).toHaveTextContent("Nearly full");
    expect(screen.getByTestId("storage-usage-fill").className).toContain(
      "bg-amber-500",
    );
    expect(
      screen.queryByTestId(
        `${KUBERNETES_NODE_DISK_CARD_TEST_ID}-image-section`,
      ),
    ).toBeNull();
  });

  test("an image disk of its own: two sections, each with its own bar", () => {
    render(
      <KubernetesNodeDiskCard
        disk={getKubernetesNodeDisk({
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 70 * GIB,
          latestImageFsCapacityBytes: 500 * GIB,
          latestImageFsAvailableBytes: 20 * GIB,
          latestVolumeMeasuredAt: new Date(),
        })}
        isLoading={false}
      />,
    );

    const root: HTMLElement = screen.getByTestId(
      `${KUBERNETES_NODE_DISK_CARD_TEST_ID}-root-section`,
    );
    const image: HTMLElement = screen.getByTestId(
      `${KUBERNETES_NODE_DISK_CARD_TEST_ID}-image-section`,
    );
    expect(within(root).getByText("Root filesystem")).toBeInTheDocument();
    expect(within(root).getByText("30%")).toBeInTheDocument();
    expect(within(image).getByText("Image filesystem")).toBeInTheDocument();
    expect(within(image).getByText("96%")).toBeInTheDocument();
    expect(
      within(image).getByTestId(
        `${KUBERNETES_NODE_DISK_CARD_TEST_ID}-image-level`,
      ),
    ).toHaveTextContent("Almost out of space");
  });

  test("no reading says why in a sentence, never an empty bar", () => {
    render(
      <KubernetesNodeDiskCard
        disk={getKubernetesNodeDisk({})}
        isLoading={false}
      />,
    );

    expect(
      screen.getByTestId(`${KUBERNETES_NODE_DISK_CARD_TEST_ID}-none`),
    ).toHaveTextContent("No disk reading for this node yet.");
    expect(screen.queryByRole("meter")).toBeNull();
  });

  test("its shape while it loads, and what failed", () => {
    const { rerender } = render(
      <KubernetesNodeDiskCard disk={null} isLoading={true} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();

    rerender(
      <KubernetesNodeDiskCard
        disk={null}
        isLoading={false}
        error="Could not read the node"
      />,
    );
    expect(screen.getByText("Could not read the node")).toBeInTheDocument();
  });
});

describe("the Nodes list's disk columns", () => {
  async function settle(): Promise<void> {
    for (let i: number = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
        jest.advanceTimersByTime(10);
      });
    }
  }

  function serveNodes(rows: Array<Row>): void {
    mockFetchInventory.mockImplementation((options: any) => {
      return Promise.resolve(
        rows.map((row: Row) => {
          const resource: Record<string, any> = {
            name: row["name"],
            namespace: "",
            cpuUtilization: 12,
            memoryUsageBytes: GIB,
            memoryLimitBytes: null,
            status: "Ready",
            age: "3d",
            additionalAttributes: {},
          };
          options.transform?.(resource, row);
          return resource;
        }),
      );
    });
  }

  function rowOf(name: string): HTMLElement {
    return screen.getAllByText(name)[0]!.closest("tr") as HTMLElement;
  }

  function headers(): Array<string> {
    return screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      })
      .filter(Boolean);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mockGetItem.mockReset();
    mockFetchInventory.mockReset();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("each node's disk as a bar and a percent, what is free and its size, after CPU and Memory", async () => {
    serveNodes([
      nodeRow("node-1", {
        latestVolumeCapacityBytes: String(100 * GIB),
        latestVolumeAvailableBytes: String(8 * GIB),
        latestVolumeMeasuredAt: new Date(),
      }),
      nodeRow("node-2", {
        latestVolumeCapacityBytes: 200 * GIB,
        latestVolumeAvailableBytes: 150 * GIB,
        latestVolumeMeasuredAt: new Date(),
      }),
    ]);

    render(<NodesPage {...PAGE_PROPS} />);
    await settle();

    expect(mockFetchInventory.mock.calls[0]![0]).toMatchObject({
      kind: "Node",
      selectVolumeUsage: true,
    });

    const order: Array<string> = headers();
    expect(order.indexOf("Memory")).toBeLessThan(order.indexOf("Disk"));
    expect(order.indexOf("CPU")).toBeLessThan(order.indexOf("Disk"));
    expect(order).toContain("Disk Free");
    expect(order).toContain("Disk Capacity");
    // No node's images have a disk of their own: no column for one.
    expect(order).not.toContain("Image Disk");

    const full: HTMLElement = rowOf("node-1");
    expect(within(full).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "92",
    );
    expect(within(full).getByTestId("storage-usage-fill").className).toContain(
      "bg-red-500",
    );
    expect(full.textContent).toContain("8\u00A0GiB");
    expect(full.textContent).toContain("100\u00A0GiB");

    const roomy: HTMLElement = rowOf("node-2");
    expect(within(roomy).getByText("25%")).toBeInTheDocument();
  });

  test("an Image Disk column while a node's images have a disk of their own", async () => {
    serveNodes([
      nodeRow("node-1", {
        latestVolumeCapacityBytes: 100 * GIB,
        latestVolumeAvailableBytes: 60 * GIB,
        latestImageFsCapacityBytes: 400 * GIB,
        latestImageFsAvailableBytes: 40 * GIB,
        latestVolumeMeasuredAt: new Date(),
      }),
      nodeRow("node-2", {
        latestVolumeCapacityBytes: 100 * GIB,
        latestVolumeAvailableBytes: 60 * GIB,
        latestVolumeMeasuredAt: new Date(),
      }),
    ]);

    render(<NodesPage {...PAGE_PROPS} />);
    await settle();

    expect(headers()).toContain("Image Disk");
    expect(within(rowOf("node-1")).getAllByRole("meter")).toHaveLength(2);
    expect(within(rowOf("node-1")).getByText("90%")).toBeInTheDocument();
    expect(within(rowOf("node-2")).getAllByRole("meter")).toHaveLength(1);
  });

  test("a node with no fresh reading says so in its cell", async () => {
    serveNodes([
      nodeRow("node-1", {
        latestVolumeCapacityBytes: 100 * GIB,
        latestVolumeAvailableBytes: 60 * GIB,
        latestVolumeMeasuredAt: new Date(Date.now() - 30 * MINUTE),
      }),
      nodeRow("node-2"),
    ]);

    render(<NodesPage {...PAGE_PROPS} />);
    await settle();

    expect(
      within(rowOf("node-1")).getByText("Not reported"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("node-2")).getByText("Not reported"),
    ).toBeInTheDocument();
  });
});
