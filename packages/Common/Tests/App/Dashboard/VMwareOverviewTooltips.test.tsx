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
  within,
} from "@testing-library/react";
import React from "react";

/*
 * The VMware vCenter overview, rendered for real with the network and the
 * heavy children (charts, activity cards, the details card) replaced. It
 * checks what a customer sees: the hero's pills and count chips, every
 * tile, chart card and top-5 section has an (i) beside its title, the (i)
 * says the right thing, the chart cards have it from the first paint (while
 * their data is still loading), and the hero's counts open their lists.
 *
 * And what its numbers say (the UI review): a host vCenter cannot reach is
 * no idle capacity in the vCenter's CPU and memory, the top consumers are
 * coloured by the lines their alerts fire at, a failed inventory read says
 * so in Needs attention's frame with Refresh, and a vCenter with nothing to
 * rank has no Top Resource Consumers card.
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
// What each metric's aggregate answers, by its name.
let mockAggregateData: Record<string, Array<unknown>> = {};
// Every inventory read fails, as a server that answers 500 does.
let mockListFails: boolean = false;

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
        if (mockListFails) {
          throw new Error("The server could not be reached.");
        }
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
        const name: unknown = (
          request as { aggregateBy?: { query?: { name?: unknown } } }
        ).aggregateBy?.query?.name;
        return {
          data: typeof name === "string" ? mockAggregateData[name] || [] : [],
        };
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
  mockAggregateData = {};
  mockListFails = false;
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

  test("with an agent version, the counts' (i) still follows the last count, before the agent's chip", async () => {
    mockVCenter = vcenterModel({
      datacenterCount: 1,
      clusterCount: 1,
      hostCount: 1,
      vmCount: 1,
      poweredOnVmCount: 1,
      datastoreCount: 1,
      agentVersion: "1.2.3",
    });
    await renderLoaded();

    const [button] = infoButtonsFor("vCenter inventory counts");
    /*
     * After the agent's chip it read as that chip's (i) - alone with it on
     * the row's second line where the chips wrap.
     */
    expect(button!.previousElementSibling?.textContent).toContain(
      "1 datastore",
    );
    expect(button!.nextElementSibling?.textContent).toContain("Agent 1.2.3");
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

/*
 * Two hosts of 10 GHz and 128 GiB each: esx01 runs, half busy; vCenter has
 * lost esx03, and reports it at 0 MHz and 0 MiB.
 */
function hostSeries(): Record<string, Array<unknown>> {
  const at: Date = new Date(Date.now() - 2 * 60 * 1000);
  const of: (host: string, value: number) => Record<string, unknown> = (
    host: string,
    value: number,
  ): Record<string, unknown> => {
    return {
      timestamp: at,
      value: value,
      attributes: {
        "resource.vcenter.datacenter.name": "dc1",
        "resource.vcenter.host.name": host,
      },
    };
  };
  return {
    "vcenter.host.cpu.utilization": [of("esx01", 50), of("esx03", 0)],
    "vcenter.host.cpu.capacity": [of("esx01", 10000), of("esx03", 10000)],
    "vcenter.host.memory.usage": [of("esx01", 64 * 1024), of("esx03", 0)],
    "vcenter.host.memory.capacity": [
      of("esx01", 128 * 1024),
      of("esx03", 128 * 1024),
    ],
  };
}

// A golden tile, by its (i).
function goldenTile(title: string): HTMLElement {
  const button: HTMLElement | undefined = infoButtonsFor(title)[0];
  const tile: HTMLElement | null = button
    ? (button.closest("div.rounded-xl") as HTMLElement | null)
    : null;
  if (!tile) {
    throw new Error(`no tile ${title}`);
  }
  return tile;
}

describe("VMware overview: a host vCenter cannot reach is no idle capacity", () => {
  test("Host CPU and Host Memory count the hosts that report their use", async () => {
    mockAggregateData = hostSeries();
    await renderLoaded();

    /*
     * esx01 at 50% of its 10 GHz is the vCenter's 50%: counted, esx03's
     * 0 MHz of 10 GHz made it 25%, as if half the capacity were free.
     */
    await waitFor(() => {
      expect(goldenTile("Host CPU")).toHaveTextContent("50.0%");
    });
    const memory: HTMLElement = goldenTile("Host Memory");
    expect(memory).toHaveTextContent("50.0%");
    expect(memory).toHaveTextContent("64.0 GiB of 128 GiB");
    expect(memory).not.toHaveTextContent("of 256 GiB");
  });

  test("while every host runs, every host counts", async () => {
    const series: Record<string, Array<unknown>> = hostSeries();
    // esx03 back: 32 GiB in use, idle CPU.
    series["vcenter.host.memory.usage"] = [
      (
        series["vcenter.host.memory.usage"] as Array<Record<string, unknown>>
      )[0],
      {
        ...(
          series["vcenter.host.memory.usage"] as Array<Record<string, unknown>>
        )[1],
        value: 32 * 1024,
      },
    ];
    mockAggregateData = series;
    await renderLoaded();

    await waitFor(() => {
      expect(goldenTile("Host CPU")).toHaveTextContent("25.0%");
    });
    expect(goldenTile("Host Memory")).toHaveTextContent("96.0 GiB of 256 GiB");
  });
});

describe("VMware overview: the top consumers, coloured as their alerts read them", () => {
  // Each host's name ends with `domain` ("esx01" + ".acme.example").
  function busyInventory(domain: string = ""): Array<unknown> {
    const now: Date = new Date();
    const base: Array<unknown> = inventory().filter((row: unknown): boolean => {
      const kind: unknown = (row as { kind?: unknown }).kind;
      return (
        kind !== "Host" && kind !== "Datastore" && kind !== "VirtualMachine"
      );
    });
    const busyHost: (name: string, cpu: number, memory: number) => unknown = (
      name: string,
      cpu: number,
      memory: number,
    ): unknown => {
      return inventoryRow({
        kind: "Host",
        externalId: `host/dc1/${name}`,
        name: `${name}${domain}`,
        hostName: `${name}${domain}`,
        datacenterName: "dc1",
        clusterName: "cl1",
        latestCpuPercent: cpu,
        latestCpuMhz: cpu * 100,
        latestMemoryBytes: (memory / 100) * 128 * GIB,
        latestMemoryPercent: memory,
        maxMemoryBytes: 128 * GIB,
        metricsUpdatedAt: now,
      });
    };
    const datastore: (name: string, percent: number) => unknown = (
      name: string,
      percent: number,
    ): unknown => {
      return inventoryRow({
        kind: "Datastore",
        externalId: `datastore/dc1/${name}`,
        name: name,
        datacenterName: "dc1",
        latestDiskBytes: percent * GIB,
        maxDiskBytes: 100 * GIB,
        latestDiskPercent: percent,
        metricsUpdatedAt: now,
      });
    };
    const waitingVm: (name: string, ready: number) => unknown = (
      name: string,
      ready: number,
    ): unknown => {
      return inventoryRow({
        kind: "VirtualMachine",
        externalId: `vm/${name}`,
        name: name,
        hostName: `esx01${domain}`,
        datacenterName: "dc1",
        isTemplate: false,
        isPoweredOn: true,
        cpuReadinessPercent: ready,
        metricsUpdatedAt: now,
      });
    };
    return [
      ...base,
      busyHost("esx01", 94.2, 67),
      busyHost("esx02", 80, 91),
      busyHost("esx03", 41.6, 62),
      datastore("ds-full", 93),
      datastore("ds-filling", 84),
      datastore("ds-calm", 62),
      waitingVm("ci-runner-01", 14.2),
      waitingVm("db-primary", 6.2),
    ];
  }

  function tonesIn(sectionTestId: string): Array<[string, string | null]> {
    return within(screen.getByTestId(sectionTestId))
      .getAllByTestId("vmware-top-consumer")
      .map((row: HTMLElement): [string, string | null] => {
        return [
          within(row).getByTestId("vmware-top-consumer-name").textContent || "",
          row.getAttribute("data-tone"),
        ];
      });
  }

  test("a host amber past 90%, never red; a datastore amber past 80% and red past 90%; a VM amber past 10% CPU ready", async () => {
    mockRows = busyInventory();
    await renderLoaded();

    await waitFor(() => {
      expect(screen.getByTestId("vmware-top-host-cpu")).toBeInTheDocument();
    });

    // 94.2% CPU amber, never red; 80% green (the table's generic 60/80 made it red).
    expect(tonesIn("vmware-top-host-cpu")).toEqual([
      ["esx01", "warning"],
      ["esx02", "positive"],
      ["esx03", "positive"],
    ]);
    // By its own memory share: 91% amber, 67% and 62% green.
    expect(tonesIn("vmware-top-host-memory")).toEqual([
      ["esx02", "warning"],
      ["esx01", "positive"],
      ["esx03", "positive"],
    ]);
    // 93% red, 84% amber (was red), 62% green (was amber).
    expect(tonesIn("vmware-top-datastores")).toEqual([
      ["ds-full", "danger"],
      ["ds-filling", "warning"],
      ["ds-calm", "positive"],
    ]);
    // 14.2% waits past the VM CPU Ready Contention line: amber.
    expect(tonesIn("vmware-top-vm-cpu-ready")).toEqual([
      ["ci-runner-01", "warning"],
      ["db-primary", "positive"],
    ]);

    const bar: HTMLElement = within(
      screen.getByTestId("vmware-top-datastores"),
    ).getAllByTestId("vmware-top-consumer-bar")[1]!;
    expect(bar.className).toContain("bg-amber-500");
    expect(bar.className).not.toContain("bg-red-500");
  });

  // The text between the <wbr>s of a name drawn in its <bdi>.
  function partsOf(bdi: HTMLElement): Array<string> {
    const parts: Array<string> = [""];

    for (const node of Array.from(bdi.childNodes)) {
      if (node.nodeName === "WBR") {
        parts.push("");
        continue;
      }
      parts[parts.length - 1] += node.textContent || "";
    }

    return parts;
  }

  test("a name is never cut short: it breaks after its dots, whole", async () => {
    mockRows = busyInventory(".acme.example");
    await renderLoaded();

    await waitFor(() => {
      expect(screen.getByTestId("vmware-top-host-cpu")).toBeInTheDocument();
    });
    const name: HTMLElement = within(
      screen.getByTestId("vmware-top-host-cpu"),
    ).getAllByTestId("vmware-top-consumer-name")[0]!;
    expect(name.className).not.toContain("truncate");
    expect(name.className).toContain("[overflow-wrap:anywhere]");
    /*
     * 18 letters, short of the 20 a name in running text breaks from: alone
     * beside its value it breaks after its dots too - at 1024px beside the
     * side menu "esx01.acme." / "example", never "esx01.acme.exampl" / "e".
     */
    expect(partsOf(name.querySelector("bdi")!)).toEqual([
      "esx01.",
      "acme.",
      "example",
    ]);
    expect(name).toHaveTextContent(/^esx01\.acme\.example$/);

    // A VM's host, in its chip, the same.
    const host: HTMLElement = within(
      screen.getByTestId("vmware-top-vm-cpu-ready"),
    ).getAllByText("esx01.acme.example")[0]!;
    expect(host.tagName).toBe("BDI");
    expect(partsOf(host)).toEqual(["esx01.", "acme.", "example"]);

    /*
     * And each host's name in the ESXi Hosts card: at 768px beside the side
     * menu it broke as "esx03.acme.exa" / "mple".
     */
    const cardNames: Array<Array<string>> = within(
      screen.getByTestId("vmware-hosts-card"),
    )
      .getAllByTestId("vmware-hosts-card-name")
      .map((cardName: HTMLElement): Array<string> => {
        return partsOf(cardName.querySelector("bdi")!);
      });
    expect(cardNames.length).toBe(3);
    for (const parts of cardNames) {
      expect(parts).toEqual([parts[0], "acme.", "example"]);
      expect(parts[0]).toMatch(/^esx0[1-3]\.$/);
    }
  });
});

describe("VMware overview: when the inventory cannot be read, or there is nothing to rank", () => {
  test("a failed read says so in Needs attention's frame, with Refresh that reads it again", async () => {
    mockListFails = true;
    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    const error: HTMLElement = await screen.findByTestId(
      "vmware-needs-attention-error",
    );
    expect(error).toHaveTextContent("Needs attention");
    expect(error).toHaveTextContent("The server could not be reached.");
    // Four "No ... data available." boxes would read as an empty vCenter.
    expect(screen.queryByTestId("vmware-top-consumers")).toBeNull();
    expect(screen.queryByText("No host CPU data available.")).toBeNull();
    // Nor a health it could not judge.
    expect(screen.queryByTestId("vmware-hero-health")).toBeNull();

    const readsBefore: number = mockGetListCalls.length;
    mockListFails = false;
    fireEvent.click(within(error).getByRole("button"));

    await waitFor(() => {
      expect(screen.queryByTestId("vmware-needs-attention-error")).toBeNull();
    });
    expect(mockGetListCalls.length).toBeGreaterThan(readsBefore);
    expect(await screen.findByTestId("vmware-hero-health")).toHaveTextContent(
      "Healthy",
    );
    expect(screen.getByTestId("vmware-top-consumers")).toBeInTheDocument();
  });

  test("a vCenter with nothing to rank has no Top Resource Consumers card", async () => {
    mockRows = inventory().filter((row: unknown): boolean => {
      const kind: unknown = (row as { kind?: unknown }).kind;
      return kind === "Datacenter" || kind === "Cluster";
    });
    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(infoButtonsFor("vCenter Health")).toHaveLength(1);
    });
    expect(screen.queryByTestId("vmware-top-consumers")).toBeNull();
    expect(screen.queryByText("Top Resource Consumers")).toBeNull();
  });

  test("while the inventory loads, the card holds its place with a loader", async () => {
    const list: Gate = gate();
    mockListGate = list.promise;

    render(<VMwareVCenterOverview {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("vmware-top-consumers"),
    ).toBeInTheDocument();

    await act(async () => {
      list.open();
    });
    await waitFor(() => {
      expect(screen.getByTestId("vmware-top-host-cpu")).toBeInTheDocument();
    });
  });
});
