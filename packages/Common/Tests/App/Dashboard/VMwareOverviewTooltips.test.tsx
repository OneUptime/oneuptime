/**
 * @timezone UTC
 */
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
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * The VMware vCenter overview, rendered for real with the network and the
 * heavy children (charts, activity cards, the details card) replaced. It
 * checks what a customer sees: every tile, chart card, summary card and
 * top-5 section has an (i) beside its title, the (i) says the right thing,
 * the chart cards have it from the first paint (while their data is still
 * loading), and pressing an (i) on a clickable summary card explains
 * rather than navigates.
 */

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return { promise, open };
}

const mockGetItemCalls: Array<unknown> = [];
const mockGetListCalls: Array<unknown> = [];
const mockAggregateCalls: Array<unknown> = [];

let mockVCenter: unknown = null;
let mockRows: Array<unknown> = [];
let mockListGate: Promise<void> = Promise.resolve();
let mockAggregateGate: Promise<void> = Promise.resolve();
let mockAggregateFails: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: unknown): Promise<unknown> => {
        mockGetItemCalls.push(request);
        return Promise.resolve(mockVCenter);
      },
      getList: async (request: unknown): Promise<unknown> => {
        mockGetListCalls.push(request);
        await mockListGate;
        return { data: mockRows, count: mockRows.length };
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: async (request: unknown): Promise<unknown> => {
        mockAggregateCalls.push(request);
        await mockAggregateGate;
        if (mockAggregateFails) {
          throw new Error("ClickHouse is not reachable");
        }
        return { data: [] };
      },
    },
  };
});

// Recharts has no layout under jsdom; the card around the chart is the subject.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("section", { "data-testid": "details" });
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "range-picker" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "auto-refresh" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "activity" });
      },
    };
  },
);

import VMwareVCenterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  VMWARE_METRIC_DESCRIPTIONS,
  VMwareMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import {
  GIB,
  explainedLabels,
  explanationOnFocus,
  explanationOnHover,
  expectNotNested,
  infoButtonsFor,
  infoLabels,
  inventoryRow,
  vcenterModel,
} from "./VMwareTooltipHarness";

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const VCENTER_ID: string = "11111111-1111-4111-8111-111111111111";

const D: Record<VMwareMetric, string> = VMWARE_METRIC_DESCRIPTIONS;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`),
  currentProject: null,
  hasPaymentMethod: false,
};

// One (i) after the hero's count chips (datacenters, clusters, hosts...).
const HERO: Array<[string, string]> = [
  ["vCenter inventory counts", D.overviewInventoryCounts],
];

const TILES: Array<[string, string]> = [
  ["Host Effectiveness", D.overviewHostEffectiveness],
  ["Host CPU", D.overviewHostCpu],
  ["Host Memory", D.overviewHostMemory],
  ["Datastores", D.overviewDatastores],
  ["VM CPU Ready", D.overviewVmCpuReady],
  ["Virtual Machines", D.overviewVirtualMachines],
];

const CHARTS: Array<[string, string]> = [
  ["Host CPU", D.overviewHostCpuChart],
  ["Host Memory", D.overviewHostMemoryChart],
  ["Datastore Used", D.overviewDatastoreUsedChart],
  ["VM CPU Ready", D.overviewVmCpuReadyChart],
];

const SUMMARY: Array<[string, string]> = [
  ["vCenter Health", D.overviewVCenterHealth],
  ["Datacenters", D.overviewDatacenterCount],
  ["Clusters", D.overviewClusterCount],
  ["Hosts", D.overviewHostCount],
  ["Virtual Machines", D.overviewVirtualMachineCount],
  ["Datastores", D.overviewDatastoreCount],
  ["Resource Pools", D.overviewResourcePoolCount],
  ["Agent Status", D.overviewAgentStatus],
];

const TOP: Array<[string, string]> = [
  ["Host CPU", D.topHostsByCpu],
  ["Host Memory", D.topHostsByMemory],
  ["Datastore Utilization", D.topDatastoresByUtilization],
  ["VM CPU Ready", D.topVmsByCpuReady],
];

function labelsOf(pairs: Array<[string, string]>): Array<string> {
  return pairs.map(([label]: [string, string]): string => {
    return label;
  });
}

function inventory(): Array<unknown> {
  const now: Date = new Date();

  return [
    inventoryRow({
      kind: "Datacenter",
      externalId: "datacenter/dc1",
      name: "dc1",
      hostCount: 2,
      poweredOnHostCount: 2,
    }),
    inventoryRow({
      kind: "Cluster",
      externalId: "cluster/dc1/cl1",
      name: "cl1",
      datacenterName: "dc1",
      hostCount: 2,
      effectiveHostCount: 2,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "Host",
      externalId: "host/dc1/esx01",
      name: "esx01",
      datacenterName: "dc1",
      clusterName: "cl1",
      latestCpuPercent: 42,
      latestMemoryBytes: 64 * GIB,
      latestMemoryPercent: 50,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "VirtualMachine",
      externalId: "vm/uuid-1",
      name: "web-01",
      hostName: "esx01",
      isTemplate: false,
      isPoweredOn: true,
      cpuReadinessPercent: 3,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "Datastore",
      externalId: "datastore/dc1/ds1",
      name: "ds1",
      datacenterName: "dc1",
      latestDiskBytes: 40 * GIB,
      maxDiskBytes: 100 * GIB,
      latestDiskPercent: 40,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "ResourcePool",
      externalId: "resourcepool/dc1/cl1/Resources",
      name: "Resources",
    }),
  ];
}

let navigateSpy: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  jest.useFakeTimers();
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`,
  );
  mockGetItemCalls.length = 0;
  mockGetListCalls.length = 0;
  mockAggregateCalls.length = 0;
  mockVCenter = vcenterModel();
  mockRows = inventory();
  mockListGate = Promise.resolve();
  mockAggregateGate = Promise.resolve();
  mockAggregateFails = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    (): void => {},
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.pushState({}, "", "/");
});

async function renderLoaded(): Promise<void> {
  render(<VMwareVCenterOverview {...PAGE_PROPS} />);

  // The last golden tile and the last top-5 section are both on screen.
  await waitFor(() => {
    expect(infoButtonsFor("Host Effectiveness")).toHaveLength(1);
    expect(infoButtonsFor("Datastore Utilization")).toHaveLength(1);
  });
}

describe("VMware overview: an (i) beside every number", () => {
  test("hero counts, tiles, chart cards, summary cards and top-5 sections, in page order", async () => {
    await renderLoaded();

    expect(infoLabels()).toEqual([
      ...labelsOf(HERO),
      ...labelsOf(TILES),
      ...labelsOf(CHARTS),
      ...labelsOf(SUMMARY),
      ...labelsOf(TOP),
    ]);
  });

  test("each (i) says what its own number means", async () => {
    await renderLoaded();

    expect(await explainedLabels()).toEqual([
      ...HERO,
      ...TILES,
      ...CHARTS,
      ...SUMMARY,
      ...TOP,
    ]);
  });

  test("the hero's (i) follows its count chips, in the same row", async () => {
    await renderLoaded();

    const [button] = infoButtonsFor("vCenter inventory counts");
    const row: HTMLElement = button!.parentElement!;

    expectNotNested(button!);
    // The chips of the fixture inventory, then the (i) - last in the row.
    expect(row.textContent).toContain("1 datacenter");
    expect(row.textContent).toContain("1 cluster");
    expect(row.textContent).toContain("1 ESXi host");
    expect(row.textContent).toContain("1/1 VM powered on");
    expect(row.textContent).toContain("1 datastore");
    expect(row.lastElementChild).toBe(button);
  });

  test("a hero with only the agent version chip gets no (i)", async () => {
    mockVCenter = vcenterModel({ agentVersion: "1.2.3" });
    mockRows = [];

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Agent 1.2.3")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(infoButtonsFor("Agent Status")).toHaveLength(1);
    });

    expect(infoButtonsFor("vCenter inventory counts")).toHaveLength(0);
  });

  test("the same explanation is reachable from the keyboard", async () => {
    await renderLoaded();

    const [tileCpu, chartCpu, topCpu] = infoButtonsFor("Host CPU");

    expect(await explanationOnFocus(tileCpu!)).toBe(D.overviewHostCpu);
    expect(await explanationOnFocus(chartCpu!)).toBe(D.overviewHostCpuChart);
    expect(await explanationOnFocus(topCpu!)).toBe(D.topHostsByCpu);
  });

  test("each (i) sits right beside the title it explains", async () => {
    await renderLoaded();

    for (const label of new Set(
      labelsOf([...TILES, ...CHARTS, ...SUMMARY, ...TOP]),
    )) {
      for (const button of infoButtonsFor(label)) {
        // The (i)'s own row holds the title and nothing else.
        expect({
          label,
          row: button.parentElement?.textContent?.trim(),
        }).toEqual({ label, row: label });
      }
    }
  });

  test("no (i) is nested in a link or another button", async () => {
    await renderLoaded();

    for (const label of new Set(
      labelsOf([...HERO, ...TILES, ...CHARTS, ...SUMMARY, ...TOP]),
    )) {
      for (const button of infoButtonsFor(label)) {
        expectNotNested(button);
      }
    }
  });
});

describe("VMware overview: the chart cards explain themselves while they load", () => {
  test("before the metrics arrive, every chart skeleton already has its (i)", async () => {
    const metrics: Gate = gate();
    mockAggregateGate = metrics.promise;

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(infoButtonsFor("Datastore Used")).toHaveLength(1);
    });

    // The golden tiles are skeletons with no titles yet...
    expect(infoButtonsFor("Host Effectiveness")).toHaveLength(0);
    // ...but each chart card is drawn with its title and (i).
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);

    const chartButtons: Array<HTMLElement> = [
      infoButtonsFor("Host CPU")[0]!,
      infoButtonsFor("Host Memory")[0]!,
      infoButtonsFor("Datastore Used")[0]!,
      infoButtonsFor("VM CPU Ready")[0]!,
    ];
    const texts: Array<string> = [];

    for (const button of chartButtons) {
      texts.push(await explanationOnHover(button));
    }

    expect(texts).toEqual(
      CHARTS.map(([, text]: [string, string]): string => {
        return text;
      }),
    );

    await act(async () => {
      metrics.open();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart")).toHaveLength(4);
    });

    // Same four (i)s once the charts are in.
    expect(infoButtonsFor("Datastore Used")).toHaveLength(1);
    expect(await explanationOnHover(infoButtonsFor("Datastore Used")[0]!)).toBe(
      D.overviewDatastoreUsedChart,
    );
  });

  test("the summary cards are explained before the inventory arrives", async () => {
    const list: Gate = gate();
    mockListGate = list.promise;

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(infoButtonsFor("vCenter Health")).toHaveLength(1);
    });

    // Values are still the "…" placeholder, the (i)s are already there.
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    expect(await explanationOnHover(infoButtonsFor("Resource Pools")[0]!)).toBe(
      D.overviewResourcePoolCount,
    );

    await act(async () => {
      list.open();
    });
  });

  test("when the metrics fail, the inventory cards keep their (i)s", async () => {
    mockAggregateFails = true;

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(
        screen.getByText("ClickHouse is not reachable", { exact: false }),
      ).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(infoButtonsFor("Datastore Utilization")).toHaveLength(1);
    });

    /*
     * No tiles and no charts - but the hero counts, the summary strip and
     * the top-5 lists remain.
     */
    expect(infoLabels()).toEqual([
      ...labelsOf(HERO),
      ...labelsOf(SUMMARY),
      ...labelsOf(TOP),
    ]);
  });
});

describe("VMware overview: an (i) on a clickable summary card explains, it does not navigate", () => {
  const CLICKABLE: Array<[string, string]> = [
    ["Clusters", "/clusters"],
    ["Hosts", "/hosts"],
    ["Virtual Machines", "/virtual-machines"],
    ["Datastores", "/datastores"],
    ["Resource Pools", "/resource-pools"],
  ];

  /*
   * The summary card's (i), not the golden tile's: "Datastores" and
   * "Virtual Machines" are both a tile and a card, and the tile comes first.
   */
  function summaryButton(label: string): HTMLElement {
    const buttons: Array<HTMLElement> = infoButtonsFor(label);

    return buttons[buttons.length === 1 ? 0 : 1]!;
  }

  test.each(CLICKABLE)(
    "%s: clicking the (i) stays on the page, clicking the card opens the list",
    async (label: string, routeSuffix: string) => {
      await renderLoaded();

      const info: HTMLElement = summaryButton(label);
      /*
       * The card's own click target is a separate button named after the
       * card, laid over it - a sibling of the (i), never its ancestor.
       */
      const cardButton: HTMLElement = screen.getByRole("button", {
        name: label,
      });

      expect(cardButton).not.toBe(info);
      expect(cardButton.contains(info)).toBe(false);
      expect(info.parentElement?.closest("button, a, [role='button']")).toBe(
        null,
      );
      expect(cardButton.parentElement?.contains(info)).toBe(true);
      // Lifted above the overlay, so the pointer reaches the (i) first.
      expect(info.className).toContain("z-10");

      fireEvent.click(info);
      expect(navigateSpy).not.toHaveBeenCalled();

      fireEvent.keyDown(info, { key: "Enter" });
      fireEvent.keyDown(info, { key: " " });
      expect(navigateSpy).not.toHaveBeenCalled();

      fireEvent.click(cardButton);
      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]![0])).toContain(
        `/vmware/${VCENTER_ID}${routeSuffix}`,
      );
    },
  );

  test("the (i) on a clickable card still shows its explanation", async () => {
    await renderLoaded();

    expect(await explanationOnHover(summaryButton("Clusters"))).toBe(
      D.overviewClusterCount,
    );
    expect(await explanationOnHover(summaryButton("Datastores"))).toBe(
      D.overviewDatastoreCount,
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("cards that do not navigate are not turned into buttons by the (i)", async () => {
    await renderLoaded();

    for (const label of ["vCenter Health", "Datacenters", "Agent Status"]) {
      const button: HTMLElement = infoButtonsFor(label)[0]!;

      expect(button.parentElement?.closest("button, [role='button']")).toBe(
        null,
      );
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});
