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
 * A persistent volume claim's used, free and capacity on the pages people
 * read it on (#9539), rendered for real with their data fetches stubbed:
 *
 *   - the Persistent Volume Claims list: a bar and a percent per claim in
 *     its Used column, what is left in its Free column, a claim with no
 *     usage saying why, and the agent upgrade once when no claim reports;
 *   - a claim's page: its Storage card, and its Metrics tab reading that one
 *     claim's series;
 *   - the Persistent Volumes list: each volume's usage is its claim's.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockGetList: MockFunction = getJestMockFunction();
const mockFetchInventory: MockFunction = getJestMockFunction();
const mockFetchLatestObject: MockFunction = getJestMockFunction();
const mockMetricsTab: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return mockGetItem(...args);
      },
      getList: (...args: Array<any>) => {
        return mockGetList(...args);
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
        return "data-postgres-0";
      },
      getQueryStringByName: (name: string) => {
        return name === "namespace" ? "data" : null;
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

/*
 * The inventory read, as the real one does it: each row made into a list
 * resource, then handed to the page's transform with the row it came from.
 */
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
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      fetchLatestK8sObject: (...args: Array<any>) => {
        return mockFetchLatestObject(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        mockMetricsTab(props);
        return <div data-testid="metrics-tab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab",
  () => {
    return {
      __esModule: true,
      useKubernetesEventsTab: () => {
        return { name: "Events", children: <div /> };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceLink",
  () => {
    return {
      __esModule: true,
      default: (props: { resourceName: string }) => {
        return <span>{props.resourceName}</span>;
      },
    };
  },
);

import PersistentVolumeClaimsView from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PersistentVolumeClaims";
import PersistentVolumesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PersistentVolumes";
import PVCDetailView from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/PVCDetail";
import { KUBERNETES_VOLUME_USAGE_MISSING_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesVolumeUsageMissingAlert";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";

const GIB: number = 1024 * 1024 * 1024;

// The pages, handed the props every page is (PageComponentProps).
const PersistentVolumeClaimsPage: React.FunctionComponent<any> =
  PersistentVolumeClaimsView;
const PersistentVolumesPage: React.FunctionComponent<any> =
  PersistentVolumesView;
const PVCDetailPage: React.FunctionComponent<any> = PVCDetailView;

const PAGE_PROPS: Record<string, unknown> = {
  pageRoute: undefined,
  currentProject: null,
  hasPaymentMethod: false,
};

type Row = Record<string, unknown>;

function claimRow(name: string, fields: Row = {}): Row {
  return {
    name: name,
    namespaceKey: "data",
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "premium-rwo",
      volumeName: `pvc-${name}`,
      resources: { requests: { storage: "50Gi" } },
    },
    status: { phase: "Bound", capacity: { storage: "50Gi" } },
    metricsUpdatedAt: new Date(),
    ...fields,
  };
}

const NEARLY_FULL: Row = claimRow("data-postgres-0", {
  latestVolumeCapacityBytes: String(50 * GIB),
  latestVolumeAvailableBytes: String(4 * GIB),
  latestVolumeInodes: "3276800",
  latestVolumeInodesFree: "3200000",
});
const ROOMY: Row = claimRow("data-redis-0", {
  latestVolumeCapacityBytes: 10 * GIB,
  latestVolumeAvailableBytes: 8 * GIB,
});
const SILENT: Row = claimRow("blog-home-0");
const PENDING: Row = claimRow("data-new-0", {
  status: { phase: "Pending", capacity: {} },
});

// The inventory rows of a kind, through the page's transform.
function serveInventory(rowsByKind: Record<string, Array<Row>>): void {
  mockFetchInventory.mockImplementation((options: any) => {
    const rows: Array<Row> = rowsByKind[options.kind] || [];
    return Promise.resolve(
      rows.map((row: Row) => {
        const resource: Record<string, any> = {
          name: row["name"],
          namespace: row["namespaceKey"] || "",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: ((row["status"] as Row)?.["phase"] as string) || "",
          age: "3d",
          additionalAttributes: {},
        };
        options.transform?.(resource, row);
        return resource;
      }),
    );
  });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(10);
    });
  }
}

function rowOf(name: string): HTMLElement {
  const cell: HTMLElement = screen.getAllByText(name)[0]!;
  return cell.closest("tr") as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetItem.mockReset();
  mockGetList.mockReset();
  mockFetchInventory.mockReset();
  mockFetchLatestObject.mockReset();
  mockMetricsTab.mockReset();

  mockGetItem.mockImplementation(() => {
    return Promise.resolve({ clusterIdentifier: "prod", name: "Prod" });
  });
  mockGetList.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0 });
  });
  mockFetchLatestObject.mockImplementation(() => {
    return Promise.resolve(null);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the Persistent Volume Claims list", () => {
  test("shows how much of each claim is used, as a bar and a percent, and what is free", async () => {
    serveInventory({ PersistentVolumeClaim: [NEARLY_FULL, ROOMY] });

    render(<PersistentVolumeClaimsPage {...PAGE_PROPS} />);
    await settle();

    const full: HTMLElement = rowOf("data-postgres-0");
    expect(within(full).getByRole("meter")).toHaveAttribute(
      "aria-valuenow",
      "92",
    );
    expect(within(full).getByText("92%")).toBeInTheDocument();
    expect(full.textContent).toContain("46\u00A0GiB");
    expect(full.textContent).toContain("4\u00A0GiB");
    // Its size as Kubernetes gave it, beside them.
    expect(within(full).getByText("50Gi")).toBeInTheDocument();
    // Almost out of space: red.
    expect(within(full).getByTestId("storage-usage-fill").className).toContain(
      "bg-red-500",
    );

    const roomy: HTMLElement = rowOf("data-redis-0");
    expect(within(roomy).getByText("20%")).toBeInTheDocument();
    expect(within(roomy).getByTestId("storage-usage-fill").className).toContain(
      "bg-emerald-500",
    );
  });

  test("a claim with no usage says why in its cell, never a blank", async () => {
    serveInventory({
      PersistentVolumeClaim: [NEARLY_FULL, SILENT, PENDING],
    });

    render(<PersistentVolumeClaimsPage {...PAGE_PROPS} />);
    await settle();

    expect(
      within(rowOf("blog-home-0")).getByText("Not reported"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("data-new-0")).getByText("Not bound"),
    ).toBeInTheDocument();
    // One claim reports, so the agent sends it: no note.
    expect(
      screen.queryByTestId(KUBERNETES_VOLUME_USAGE_MISSING_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says once how to get usage when not one claim reports it", async () => {
    serveInventory({ PersistentVolumeClaim: [SILENT, PENDING] });

    render(<PersistentVolumeClaimsPage {...PAGE_PROPS} />);
    await settle();

    const note: HTMLElement = screen.getByTestId(
      KUBERNETES_VOLUME_USAGE_MISSING_TEST_ID,
    );
    expect(note.textContent).toContain("kubeletstats.volumeMetrics.enabled");
    expect(note.textContent).toContain(
      "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
    );
  });

  test("reads the usage columns with the claims, in one read", async () => {
    serveInventory({ PersistentVolumeClaim: [NEARLY_FULL] });

    render(<PersistentVolumeClaimsPage {...PAGE_PROPS} />);
    await settle();

    expect(mockFetchInventory).toHaveBeenCalledTimes(1);
    expect(mockFetchInventory.mock.calls[0]![0]).toMatchObject({
      kind: "PersistentVolumeClaim",
      selectVolumeUsage: true,
    });
  });
});

describe("a claim's page", () => {
  test("opens on its Storage card: used, free and capacity, and its inodes", async () => {
    mockGetList.mockImplementation(() => {
      return Promise.resolve({ data: [NEARLY_FULL], count: 1 });
    });

    render(<PVCDetailPage {...PAGE_PROPS} />);
    await settle();

    expect(screen.getByTestId("kubernetes-volume-usage-used").textContent).toBe(
      "46\u00A0GiB",
    );
    expect(screen.getByTestId("kubernetes-volume-usage-free").textContent).toBe(
      "4\u00A0GiB",
    );
    expect(
      screen.getByTestId("kubernetes-volume-usage-capacity").textContent,
    ).toBe("50\u00A0GiB");
    expect(
      screen.getByTestId("kubernetes-volume-usage-level"),
    ).toHaveTextContent("Almost out of space");
    expect(
      screen.getByTestId("kubernetes-volume-usage-inodes").textContent,
    ).toContain("76.8K of 3.3M used (2%)");

    // The claim, in its namespace: names repeat across them.
    expect(mockGetList.mock.calls[0]![0]).toMatchObject({
      query: {
        kind: "PersistentVolumeClaim",
        name: "data-postgres-0",
        namespaceKey: "data",
      },
    });
  });

  test("says when it will be full at the rate it is filling, read with its usage", async () => {
    const measuredAt: Date = new Date();
    mockGetList.mockImplementation(() => {
      return Promise.resolve({
        data: [
          {
            ...NEARLY_FULL,
            latestVolumeMeasuredAt: measuredAt,
            // 6 GiB more used than 3 hours before: 2 GiB an hour, 4 GiB left.
            latestVolumeUsedBaselineBytes: String(40 * GIB),
            latestVolumeUsedBaselineAt: new Date(
              measuredAt.getTime() - 3 * 60 * 60 * 1000,
            ),
          },
        ],
        count: 1,
      });
    });

    render(<PVCDetailPage {...PAGE_PROPS} />);
    await settle();

    expect(
      screen.getByTestId("kubernetes-volume-usage-fill"),
    ).toHaveTextContent("Full in about 2 hours");
    expect(mockGetList.mock.calls[0]![0]).toMatchObject({
      select: {
        latestVolumeMeasuredAt: true,
        latestVolumeUsedBaselineBytes: true,
        latestVolumeUsedBaselineAt: true,
      },
    });
  });

  test("says nothing of filling for a claim with no baseline yet", async () => {
    mockGetList.mockImplementation(() => {
      return Promise.resolve({ data: [NEARLY_FULL], count: 1 });
    });

    render(<PVCDetailPage {...PAGE_PROPS} />);
    await settle();

    expect(screen.getByTestId("kubernetes-volume-usage-used")).toBeTruthy();
    expect(screen.queryByTestId("kubernetes-volume-usage-fill")).toBeNull();
  });

  test("says why when the claim reports no usage", async () => {
    mockGetList.mockImplementation(() => {
      return Promise.resolve({
        data: [claimRow("data-postgres-0", { spec: { volumeMode: "Block" } })],
        count: 1,
      });
    });

    render(<PVCDetailPage {...PAGE_PROPS} />);
    await settle();

    expect(
      screen.getByText(
        "This claim is a raw block device. It has no filesystem, so Kubernetes reports no usage for it.",
      ),
    ).toBeInTheDocument();
  });

  test("its Metrics tab charts that one claim's capacity, free space and used percent", async () => {
    mockGetList.mockImplementation(() => {
      return Promise.resolve({ data: [NEARLY_FULL], count: 1 });
    });

    render(<PVCDetailPage {...PAGE_PROPS} />);
    await settle();

    await act(async () => {
      screen.getByRole("tab", { name: "Metrics" }).click();
    });
    await settle();

    const calls: Array<Array<any>> = mockMetricsTab.mock.calls as Array<
      Array<any>
    >;
    const props: Record<string, any> = calls[calls.length - 1]![0];
    const queries: Array<MetricQueryConfigData> = props["queryConfigs"];
    expect(
      queries.map((query: MetricQueryConfigData) => {
        return query.metricQueryData.filterData.metricName;
      }),
    ).toEqual([
      "k8s.volume.capacity",
      "k8s.volume.available",
      "k8s.volume.inodes",
      "k8s.volume.inodes.free",
    ]);
    expect(queries[0]!.metricQueryData.filterData.attributes).toEqual({
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "data",
      "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
    });
    expect(props["formulaConfigs"]).toHaveLength(2);
  });
});

describe("the Persistent Volumes list", () => {
  test("shows each volume's usage from the claim bound to it", async () => {
    serveInventory({
      PersistentVolume: [
        {
          name: "pvc-data-postgres-0",
          namespaceKey: "",
          spec: {
            capacity: { storage: "50Gi" },
            storageClassName: "premium-rwo",
            persistentVolumeReclaimPolicy: "Delete",
            claimRef: { name: "data-postgres-0", namespace: "data" },
          },
          status: { phase: "Bound" },
        },
        {
          name: "pv-spare",
          namespaceKey: "",
          spec: { capacity: { storage: "20Gi" }, claimRef: {} },
          status: { phase: "Available" },
        },
      ],
    });
    mockGetList.mockImplementation(() => {
      return Promise.resolve({ data: [NEARLY_FULL, ROOMY], count: 2 });
    });

    render(<PersistentVolumesPage {...PAGE_PROPS} />);
    await settle();

    expect(
      within(rowOf("pvc-data-postgres-0")).getByText("92%"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("pv-spare")).getByText("Not bound"),
    ).toBeInTheDocument();
  });
});
