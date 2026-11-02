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
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * The VMware vCenter overview, rendered for real with the network and the
 * heavy children (charts, activity cards, the details card) replaced. It
 * checks what a customer sees: the hero's pills and count chips, every
 * tile, chart card and top-5 section has an (i) beside its title, the (i)
 * says the right thing, the chart cards have it from the first paint (while
 * their data is still loading), and the hero's counts open their lists.
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
      getList: async (request: {
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        mockGetListCalls.push(request);
        await mockListGate;
        /*
         * The rows of the kinds the read asks for: one kind, or several
         * (the Overview reads every kind but the VMs at once).
         */
        const kind: unknown = request.query?.["kind"];
        const kinds: Array<unknown> | null =
          typeof kind === "string"
            ? [kind]
            : kind && Array.isArray((kind as { values?: unknown }).values)
              ? (kind as { values: Array<unknown> }).values
              : null;
        const rows: Array<unknown> = kinds
          ? mockRows.filter((row: unknown): boolean => {
              return kinds.includes((row as { kind?: unknown }).kind);
            })
          : mockRows;
        return { data: rows, count: rows.length };
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
  infoButtons,
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

/*
 * The hero: the connection pill's (i), the health pill's once the
 * inventory says what needs attention, and one (i) after the count chips.
 */
const HERO: Array<[string, string]> = [
  ["Data Status", D.overviewAgentStatus],
  ["vCenter Health", D.overviewVCenterHealth],
  ["vCenter inventory counts", D.overviewInventoryCounts],
];

const TILES: Array<[string, string]> = [
  ["Effective hosts", D.overviewHostEffectiveness],
  ["Host CPU", D.overviewHostCpu],
  ["Host Memory", D.overviewHostMemory],
  ["Datastores", D.overviewDatastores],
  ["VM CPU Ready", D.overviewVmCpuReady],
];

const CHARTS: Array<[string, string]> = [
  ["Host CPU", D.overviewHostCpuChart],
  ["Host Memory", D.overviewHostMemoryChart],
  ["Datastore Used", D.overviewDatastoreUsedChart],
  ["VM CPU Ready", D.overviewVmCpuReadyChart],
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
      datacenterName: "dc1",
      hostCount: 1,
      poweredOnHostCount: 1,
      notRespondingHostCount: 0,
      standbyHostCount: 0,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "Cluster",
      externalId: "cluster/dc1/cl1",
      name: "cl1",
      clusterName: "cl1",
      datacenterName: "dc1",
      hostCount: 1,
      effectiveHostCount: 1,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "Host",
      externalId: "host/dc1/esx01",
      name: "esx01",
      hostName: "esx01",
      datacenterName: "dc1",
      clusterName: "cl1",
      latestCpuPercent: 42,
      latestCpuMhz: 12000,
      latestMemoryBytes: 64 * GIB,
      latestMemoryPercent: 50,
      maxMemoryBytes: 128 * GIB,
      metricsUpdatedAt: now,
    }),
    inventoryRow({
      kind: "VirtualMachine",
      externalId: "vm/uuid-1",
      name: "web-01",
      hostName: "esx01",
      datacenterName: "dc1",
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
  mockVCenter = vcenterModel({
    datacenterCount: 1,
    clusterCount: 1,
    hostCount: 1,
    vmCount: 1,
    poweredOnVmCount: 1,
    datastoreCount: 1,
  });
  mockRows = inventory();
  mockListGate = Promise.resolve();
  mockAggregateGate = Promise.resolve();
  mockAggregateFails = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.pushState({}, "", "/");
});

async function renderLoaded(): Promise<void> {
  render(<VMwareVCenterOverview {...PAGE_PROPS} />);

  // The last golden tile, the health pill and the last top-5 section are on screen.
  await waitFor(() => {
    expect(infoButtonsFor("Effective hosts")).toHaveLength(1);
    expect(infoButtonsFor("vCenter Health")).toHaveLength(1);
    expect(infoButtonsFor("Datastore Utilization")).toHaveLength(1);
  });
}

describe("VMware overview: an (i) beside every number", () => {
  test("the hero's pills and counts, tiles, chart cards and top-5 sections, in page order", async () => {
    await renderLoaded();

    expect(infoLabels()).toEqual([
      ...labelsOf(HERO),
      ...labelsOf(TILES),
      ...labelsOf(CHARTS),
      ...labelsOf(TOP),
    ]);
  });

  test("each (i) says what its own number means", async () => {
    await renderLoaded();

    expect(await explainedLabels()).toEqual([
      ...HERO,
      ...TILES,
      ...CHARTS,
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
    // How many hosts vCenter reaches, of all: the first number an admin looks for.
    expect(row.textContent).toContain("1/1 ESXi host connected");
    expect(row.textContent).toContain("1/1 VM powered on");
    expect(row.textContent).toContain("1 datastore");
    expect(row.lastElementChild).toBe(button);
  });

  test("a hero with only the agent version chip gets no counts (i)", async () => {
    mockVCenter = vcenterModel({ agentVersion: "1.2.3" });
    mockRows = [];

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Agent 1.2.3")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(infoButtonsFor("Data Status")).toHaveLength(1);
    });

    expect(infoButtonsFor("vCenter inventory counts")).toHaveLength(0);
    // A vCenter that has reported nothing has no health to tell: no guess.
    expect(infoButtonsFor("vCenter Health")).toHaveLength(0);
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

    for (const label of new Set(labelsOf([...TILES, ...CHARTS, ...TOP]))) {
      for (const button of infoButtonsFor(label)) {
        // The (i)'s own row holds the title and nothing else.
        expect({
          label,
          row: button.parentElement?.textContent?.trim(),
        }).toEqual({ label, row: label });
      }
    }
  });

  test("each pill's (i) sits beside its pill", async () => {
    await renderLoaded();

    expect(
      infoButtonsFor("Data Status")[0]!.parentElement?.textContent?.trim(),
    ).toBe("Connected");
    expect(
      infoButtonsFor("vCenter Health")[0]!.parentElement?.textContent?.trim(),
    ).toBe("Healthy");
  });

  test("no (i) is nested in a link or another button", async () => {
    await renderLoaded();

    for (const label of new Set(
      labelsOf([...HERO, ...TILES, ...CHARTS, ...TOP]),
    )) {
      for (const button of infoButtons()) {
        if (button.getAttribute("aria-label") === `About ${label}`) {
          expectNotNested(button);
        }
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
    expect(infoButtonsFor("Effective hosts")).toHaveLength(0);
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

  test("the health pill waits for the inventory: no guess while it loads", async () => {
    const list: Gate = gate();
    mockListGate = list.promise;

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(infoButtonsFor("Data Status")).toHaveLength(1);
    });
    expect(infoButtonsFor("vCenter Health")).toHaveLength(0);

    await act(async () => {
      list.open();
    });

    await waitFor(() => {
      expect(infoButtonsFor("vCenter Health")).toHaveLength(1);
    });
    expect(await explanationOnHover(infoButtonsFor("vCenter Health")[0]!)).toBe(
      D.overviewVCenterHealth,
    );
  });

  test("when the metrics fail, the inventory's (i)s stay", async () => {
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

    // No tiles and no charts - but the hero and the top-5 lists remain.
    expect(infoLabels()).toEqual([...labelsOf(HERO), ...labelsOf(TOP)]);
  });
});

describe("VMware overview: the hero's counts open their lists", () => {
  test.each([
    ["vmware-hero-clusters", "/clusters"],
    ["vmware-hero-hosts", "/hosts"],
    ["vmware-hero-vms", "/virtual-machines"],
    ["vmware-hero-datastores", "/datastores"],
  ] as Array<[string, string]>)(
    "%s is a link to the vCenter's %s",
    async (testId: string, routeSuffix: string) => {
      await renderLoaded();

      const chip: HTMLElement = screen.getByTestId(testId);
      expect(chip.tagName).toBe("A");
      expect(chip.getAttribute("href")).toBe(
        `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}${routeSuffix}`,
      );
      // The (i) is never inside a chip.
      expect(chip.querySelector("button")).toBeNull();
    },
  );

  test("datacenters have no list of their own: their chip is a plain count", async () => {
    await renderLoaded();

    expect(screen.getByTestId("vmware-hero-datacenters").tagName).toBe("SPAN");
  });
});
