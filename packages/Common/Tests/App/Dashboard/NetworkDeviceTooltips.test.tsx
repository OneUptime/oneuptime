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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The (i) tooltips on the network device pages, RENDERED: the device
 * Overview hero, the summary strip above the device list, the Overview's
 * interface digest and Inventory uptime, the Network Overview landing page,
 * the Interfaces tab and the Probe Latency Matrix.
 *
 * Each surface is rendered for real with only the network (ModelAPI, the
 * summary endpoints) and the ModelTable replaced, and every metric title is
 * checked for an (i) whose tooltip is the matching
 * NETWORK_DEVICE_METRIC_DESCRIPTIONS entry. Titles that only name something
 * (Site, Polled By, Index, MAC Address) are checked for having none, and the
 * clickable summary tiles are checked for not toggling their filter when
 * someone asks what the number means.
 *
 * Asserting tippy under jsdom: see InfoTooltip.test.tsx. Tooltips are lazy,
 * portalled to document.body, and never finish animating out, so each
 * assertion looks for its text among the tooltips on the page.
 */

const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const fetchDeviceSummaryMock: MockFunction = getJestMockFunction();
const fetchNetworkOverviewMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Network/NetworkSummaryApi",
  () => {
    return {
      __esModule: true,
      fetchDeviceSummary: (...args: Array<unknown>): unknown => {
        return fetchDeviceSummaryMock(...args);
      },
      fetchNetworkOverview: (...args: Array<unknown>): unknown => {
        return fetchNetworkOverviewMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      // Read at render time, long after the module-level id below exists.
      getLastParamAsObjectID: (): unknown => {
        return mockDeviceObjectId;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return mockProjectObjectId;
      },
    },
  };
});

/*
 * The Interfaces tab's list is a ModelTable. It is replaced by a recorder,
 * so the columns the page hands it — titles and header tooltips — can be
 * read without a server.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

import DeviceStatusHero, {
  DeviceHeroTileTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero";
import DeviceSummaryCards from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards";
import DeviceInterfacesPreview from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInterfacesPreview";
import {
  DEVICE_SUMMARY_TILES,
  DeviceSummaryTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryTiles";
import {
  NETWORK_DEVICE_METRIC_DESCRIPTIONS,
  NetworkDeviceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import { InventoryUptimeValue } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import NetworkOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Overview";
import NetworkDeviceLatencyMatrix from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/LatencyMatrix";
import NetworkDeviceInterfaces from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Interfaces";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Probe from "../../../Models/DatabaseModels/Probe";
import { Green } from "../../../Types/BrandColors";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";

const DESCRIPTIONS: Record<NetworkDeviceMetric, string> =
  NETWORK_DEVICE_METRIC_DESCRIPTIONS;

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

/*
 * The ids the Navigation and Project mocks hand out. Below the imports on
 * purpose: the mock factories are hoisted above everything, but they only
 * read these when a page asks, by which time both exist.
 */
const mockDeviceObjectId: ObjectID = new ObjectID(DEVICE_ID);
const mockProjectObjectId: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderAndSettle(element: React.ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);
  await flush();
}

function infoButtonNames(): Array<string> {
  return screen
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || "";
    });
}

/*
 * Hover the (i) named "About <label>" and expect `text` among the tooltips
 * tippy has mounted.
 */
async function expectExplained(label: string, text: string): Promise<void> {
  const button: HTMLElement = screen.getByRole("button", {
    name: `About ${label}`,
  });

  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  expect(
    screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
      return tooltip.textContent || "";
    }),
  ).toContain(text);

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

function probeDevice(): NetworkDevice {
  const now: Date = new Date();
  const row: NetworkDevice = new NetworkDevice();
  row.id = new ObjectID(DEVICE_ID);
  row.name = "core-switch-01";
  row.hostname = "10.0.0.1";
  row.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  row.probeId = new ObjectID(PROBE_ID);
  row.isPollingEnabled = true;
  row.isReachable = true;
  row.isSnmpReachable = true;
  row.lastPolledAt = now;
  row.lastSeenAt = now;
  row.lastSnmpSeenAt = now;
  row.lastRebootedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  row.interfacesTotal = 48;
  row.interfacesUp = 40;
  row.interfacesDown = 3;

  const status: MonitorStatus = new MonitorStatus();
  status.name = "Operational";
  status.color = Green;
  status.isOfflineState = false;
  row.currentMonitorStatus = status;

  const probe: Probe = new Probe();
  probe.name = "Rack 3";
  row.probe = probe;

  const site: NetworkSite = new NetworkSite();
  site._id = "55555555-5555-4555-8555-555555555555";
  site.name = "HQ";
  row.site = site;

  return row;
}

function monitorBackedDevice(): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = new ObjectID(DEVICE_ID);
  row.name = "lobby-ap";
  row.monitoringMethod = NetworkDeviceMonitoringMethod.Monitor;
  return row;
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  fetchDeviceSummaryMock.mockReset();
  fetchNetworkOverviewMock.mockReset();
  modelTableMock.mockReset();

  getListMock.mockResolvedValue({ data: [], count: 0 });
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---------------------------------------------------------------- the hero

describe("DeviceHeroTileTitle", () => {
  test("with a description, the title gets an (i) named after it", async () => {
    render(
      <DeviceHeroTileTitle
        title="Reachability"
        description={DESCRIPTIONS.reachability}
      />,
    );

    expect(screen.getByText("Reachability")).toBeInTheDocument();
    await expectExplained("Reachability", DESCRIPTIONS.reachability);
  });

  test("without one, the title stands alone", () => {
    render(<DeviceHeroTileTitle title="Site" />);

    expect(screen.getByText("Site")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("the text is not in the page until someone reaches for it", () => {
    render(
      <DeviceHeroTileTitle
        title="Hardware Uptime"
        description={DESCRIPTIONS.hardwareUptime}
      />,
    );

    expect(
      screen.queryByText(DESCRIPTIONS.hardwareUptime),
    ).not.toBeInTheDocument();
  });
});

describe("the device Overview hero", () => {
  const HERO_TILES: Array<[string, NetworkDeviceMetric]> = [
    ["Reachability", "reachability"],
    ["Monitor Status", "monitorStatus"],
    ["Interfaces", "heroInterfaces"],
    ["Hardware Uptime", "hardwareUptime"],
  ];

  test("the four metric tiles, and only they, carry an (i)", async () => {
    getItemMock.mockResolvedValue(probeDevice());

    await renderAndSettle(
      <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />,
    );

    expect(screen.getByTestId("device-status-hero")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(
      HERO_TILES.map(([title]: [string, NetworkDeviceMetric]): string => {
        return `About ${title}`;
      }),
    );
  });

  test.each(HERO_TILES)(
    "the %s tile's (i) reads NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: NetworkDeviceMetric) => {
      getItemMock.mockResolvedValue(probeDevice());

      await renderAndSettle(
        <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />,
      );

      await expectExplained(title, DESCRIPTIONS[key]);
    },
  );

  test("a monitor-backed device keeps every (i), even where the value is 'Not collected'", async () => {
    getItemMock.mockResolvedValue(monitorBackedDevice());

    await renderAndSettle(
      <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />,
    );

    expect(screen.getByText("Not collected")).toBeInTheDocument();
    expect(infoButtonNames()).toHaveLength(4);
    await expectExplained("Interfaces", DESCRIPTIONS.heroInterfaces);
  });

  test("the loading skeleton draws no titles, and so no (i)", async () => {
    getItemMock.mockReturnValue(
      new Promise<NetworkDevice>(() => {
        // Never settles: the device read is still in flight.
      }),
    );

    await renderAndSettle(
      <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />,
    );

    expect(
      screen.getByTestId("device-status-hero-skeleton"),
    ).toBeInTheDocument();
    expect(infoButtonNames()).toEqual([]);
  });

  test("an (i) is never inside a link", async () => {
    getItemMock.mockResolvedValue(probeDevice());

    await renderAndSettle(
      <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />,
    );

    for (const button of screen.getAllByRole("button", { name: /^About / })) {
      expect(button.closest("a")).toBeNull();
      expect(button.parentElement?.closest("button")).toBeNull();
    }
  });
});

// ------------------------------------------------------ the summary strip

const SUMMARY_COUNTS: {
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  interfacesDown: number;
  totalDevices: number;
  devicesWithoutSite: number;
} = {
  devicesUp: 12,
  devicesDown: 2,
  devicesPending: 1,
  interfacesDown: 7,
  totalDevices: 15,
  devicesWithoutSite: 3,
};

describe("the device list summary strip", () => {
  test("every tile carries an (i), in tile order", async () => {
    fetchDeviceSummaryMock.mockResolvedValue(SUMMARY_COUNTS);

    await renderAndSettle(
      <DeviceSummaryCards facetSelections={{}} facetOperators={{}} />,
    );

    expect(infoButtonNames()).toEqual(
      DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile): string => {
        return `About ${tile.label}`;
      }),
    );
  });

  test.each(
    DEVICE_SUMMARY_TILES.map((tile: DeviceSummaryTile): [string, string] => {
      return [tile.label, tile.description];
    }),
  )(
    "the %s tile's (i) reads its description",
    async (label: string, text: string) => {
      fetchDeviceSummaryMock.mockResolvedValue(SUMMARY_COUNTS);

      await renderAndSettle(
        <DeviceSummaryCards facetSelections={{}} facetOperators={{}} />,
      );

      await expectExplained(label, text);
    },
  );

  test("the (i)s are there while the counts are still loading", async () => {
    fetchDeviceSummaryMock.mockReturnValue(
      new Promise<unknown>(() => {
        // Never settles.
      }),
    );

    await renderAndSettle(
      <DeviceSummaryCards facetSelections={{}} facetOperators={{}} />,
    );

    expect(infoButtonNames()).toHaveLength(DEVICE_SUMMARY_TILES.length);
    await expectExplained("Devices Down", DESCRIPTIONS.devicesDown);
  });

  test("asking what a tile means does not filter the list", async () => {
    const onTileClick: MockFunction = getJestMockFunction();
    fetchDeviceSummaryMock.mockResolvedValue(SUMMARY_COUNTS);

    await renderAndSettle(
      <DeviceSummaryCards
        facetSelections={{}}
        facetOperators={{}}
        onTileClick={onTileClick}
      />,
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Devices Up",
    });

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });
    fireEvent.keyDown(info, { key: " " });

    expect(onTileClick).not.toHaveBeenCalled();

    /*
     * ...while the tile itself still does. Found by its accessible name (the
     * card's ariaLabel), which is the card's own control whether InfoCard
     * draws it as a role="button" card or as a button laid over the card.
     */
    fireEvent.click(
      screen.getByRole("button", { name: /^Devices Up: 12\. Activate/ }),
    );
    expect(onTileClick).toHaveBeenCalledTimes(1);
    expect(
      (onTileClick.mock.calls[0]![0] as DeviceSummaryTile).description,
    ).toBe(DESCRIPTIONS.devicesUp);
  });
});

// ------------------------------------------------ the interface digest

function networkInterface(data: {
  index: number;
  name: string;
  isUp: boolean;
  utilization?: number | undefined;
}): NetworkInterface {
  const row: NetworkInterface = new NetworkInterface();
  row._id = `66666666-6666-4666-8666-00000000000${data.index}`;
  row.interfaceIndex = data.index;
  row.name = data.name;
  row.isAdministrativelyUp = true;
  row.isOperationallyUp = data.isUp;
  row.inRateMbps = 12;
  row.outRateMbps = 3;

  if (data.utilization !== undefined) {
    row.utilizationPercent = data.utilization;
  }

  return row;
}

describe("the device Overview's interface digest", () => {
  test("the card title's (i) explains the bare per-port numbers", async () => {
    getListMock.mockResolvedValue({
      data: [
        networkInterface({ index: 1, name: "Gi0/1", isUp: false }),
        networkInterface({
          index: 2,
          name: "Gi0/2",
          isUp: true,
          utilization: 84,
        }),
      ],
      count: 2,
    });

    await renderAndSettle(
      <DeviceInterfacesPreview modelId={new ObjectID(DEVICE_ID)} />,
    );

    // The numbers the (i) has to explain: no header names them.
    expect(screen.getAllByText("12 / 3 Mbps")).toHaveLength(2);
    expect(screen.getByText("84%")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(["About Interfaces"]);
    await expectExplained("Interfaces", DESCRIPTIONS.interfacesPreview);
  });

  test("the (i) is on the card while it loads and when it is empty", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    await renderAndSettle(
      <DeviceInterfacesPreview modelId={new ObjectID(DEVICE_ID)} />,
    );

    expect(
      screen.getByText("No interfaces discovered yet.", { exact: false }),
    ).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(["About Interfaces"]);
  });
});

// ------------------------------------------------- the Network Overview

function overviewSummary(): unknown {
  return {
    fleet: { total: 20, up: 15, down: 3, pending: 2, interfacesDown: 9 },
    siteCount: 4,
    unhealthySiteCount: 1,
    endpointCount: 311,
    vendors: [
      { vendor: "Cisco", count: 12 },
      { vendor: "Unknown", count: 8 },
    ],
    attentionDevices: [
      {
        id: DEVICE_ID,
        name: "core-switch-01",
        lastSeenAt: null,
        interfacesDown: 0,
        isDown: true,
        isMonitorBacked: false,
        isSnmpFailing: false,
      },
    ],
    attentionSites: [],
  };
}

describe("the Network Overview", () => {
  const FLEET_CARDS: Array<[string, NetworkDeviceMetric]> = [
    ["Devices", "fleetDevices"],
    ["Interfaces Down", "fleetInterfacesDown"],
    ["Sites", "fleetSites"],
    ["Endpoints", "fleetEndpoints"],
  ];

  test("the four fleet cards and the vendor card carry an (i); the lists do not", async () => {
    fetchNetworkOverviewMock.mockResolvedValue(overviewSummary());

    await renderAndSettle(<NetworkOverview {...PAGE_PROPS} />);

    expect(infoButtonNames()).toEqual([
      ...FLEET_CARDS.map(([title]: [string, NetworkDeviceMetric]): string => {
        return `About ${title}`;
      }),
      "About Fleet by vendor",
    ]);
    expect(screen.getByText("Devices needing attention")).toBeInTheDocument();
  });

  test.each(FLEET_CARDS)(
    "the %s card's (i) reads NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: NetworkDeviceMetric) => {
      fetchNetworkOverviewMock.mockResolvedValue(overviewSummary());

      await renderAndSettle(<NetworkOverview {...PAGE_PROPS} />);

      await expectExplained(title, DESCRIPTIONS[key]);
    },
  );

  test("the vendor card's (i) says only the top six are listed and what Unknown is", async () => {
    fetchNetworkOverviewMock.mockResolvedValue(overviewSummary());

    await renderAndSettle(<NetworkOverview {...PAGE_PROPS} />);

    // "Unknown" is a real bar the (i) has to account for.
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    await expectExplained("Fleet by vendor", DESCRIPTIONS.fleetByVendor);
  });

  test("the onboarding state shows no numbers, and no (i)", async () => {
    fetchNetworkOverviewMock.mockResolvedValue({
      fleet: { total: 0, up: 0, down: 0, pending: 0, interfacesDown: 0 },
      siteCount: 0,
      unhealthySiteCount: 0,
      endpointCount: 0,
      vendors: [],
      attentionDevices: [],
      attentionSites: [],
    });

    await renderAndSettle(<NetworkOverview {...PAGE_PROPS} />);

    expect(
      screen.getByText("Welcome to Network Monitoring"),
    ).toBeInTheDocument();
    expect(infoButtonNames()).toEqual([]);
  });
});

// ---------------------------------------------------- the Interfaces tab

type CapturedColumn = {
  title: string;
  headerTooltip?: string | undefined;
};

describe("the Interfaces tab", () => {
  function deviceCounts(): NetworkDevice {
    const row: NetworkDevice = new NetworkDevice();
    row.interfacesTotal = 52;
    row.interfacesUp = 40;
    row.interfacesDown = 4;
    return row;
  }

  const COUNT_CARDS: Array<[string, NetworkDeviceMetric]> = [
    ["Total Interfaces", "totalInterfaces"],
    ["Up", "interfacesUp"],
    ["Down", "interfacesDown"],
    ["Monitored", "interfacesMonitored"],
  ];

  test("every count card carries an (i)", async () => {
    getItemMock.mockResolvedValue(deviceCounts());
    countMock.mockResolvedValue(50);

    await renderAndSettle(<NetworkDeviceInterfaces {...PAGE_PROPS} />);

    expect(screen.getByText("52")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(
      COUNT_CARDS.map(([title]: [string, NetworkDeviceMetric]): string => {
        return `About ${title}`;
      }),
    );
  });

  test.each(COUNT_CARDS)(
    "the %s card's (i) reads NETWORK_DEVICE_METRIC_DESCRIPTIONS.%s",
    async (title: string, key: NetworkDeviceMetric) => {
      getItemMock.mockResolvedValue(deviceCounts());
      countMock.mockResolvedValue(50);

      await renderAndSettle(<NetworkDeviceInterfaces {...PAGE_PROPS} />);

      await expectExplained(title, DESCRIPTIONS[key]);
    },
  );

  test("the metric columns carry their header tooltip; the rest carry none", async () => {
    getItemMock.mockResolvedValue(deviceCounts());
    countMock.mockResolvedValue(50);

    await renderAndSettle(<NetworkDeviceInterfaces {...PAGE_PROPS} />);

    expect(modelTableMock).toHaveBeenCalled();

    const props: { columns: Array<CapturedColumn> } = modelTableMock.mock.calls[
      modelTableMock.mock.calls.length - 1
    ]![0] as {
      columns: Array<CapturedColumn>;
    };
    const tooltips: Record<string, string | undefined> = {};

    for (const column of props.columns) {
      tooltips[column.title] = column.headerTooltip;
    }

    expect(tooltips).toEqual({
      Index: undefined,
      Name: undefined,
      Status: DESCRIPTIONS.interfaceStatus,
      "MAC Address": undefined,
      "Speed (Mbps)": DESCRIPTIONS.interfaceSpeed,
      "In / Out (Mbps)": DESCRIPTIONS.interfaceInOutRate,
      Utilization: DESCRIPTIONS.interfaceUtilization,
      "Errors / sec": DESCRIPTIONS.interfaceErrorsPerSecond,
      Monitored: undefined,
    });
  });
});

// ------------------------------------------ the Overview's Inventory card

describe("the Inventory card's Uptime value", () => {
  const THREE_DAYS_IN_MS: number = 3 * 24 * 60 * 60 * 1000;

  test("carries an (i) named after the field, reading the Hardware Uptime text", async () => {
    render(
      <InventoryUptimeValue
        lastRebootedAt={new Date(Date.now() - THREE_DAYS_IN_MS)}
      />,
    );

    expect(infoButtonNames()).toEqual(["About Uptime"]);
    await expectExplained("Uptime", DESCRIPTIONS.hardwareUptime);
  });

  test("is the same number as the hero's Hardware Uptime, so one text explains both", async () => {
    const device: NetworkDevice = probeDevice();
    const expected: string =
      OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        device.lastRebootedAt as Date,
        OneUptimeDate.getCurrentDate(),
      );
    getItemMock.mockResolvedValue(device);

    await renderAndSettle(
      <div>
        <DeviceStatusHero modelId={new ObjectID(DEVICE_ID)} />
        <InventoryUptimeValue lastRebootedAt={device.lastRebootedAt as Date} />
      </div>,
    );

    // Fake timers hold the clock, so both read the same instant.
    expect(screen.getAllByText(expected)).toHaveLength(2);
    await expectExplained("Hardware Uptime", DESCRIPTIONS.hardwareUptime);
    await expectExplained("Uptime", DESCRIPTIONS.hardwareUptime);
  });

  test("the (i) is beside the value, never inside a link or button", () => {
    render(
      <InventoryUptimeValue
        lastRebootedAt={new Date(Date.now() - THREE_DAYS_IN_MS)}
      />,
    );

    const button: HTMLElement = screen.getByRole("button", {
      name: "About Uptime",
    });

    expect(button.closest("a")).toBeNull();
    expect(button.parentElement?.closest("button")).toBeNull();
  });
});

// ------------------------------------------------ the Probe Latency Matrix

describe("the Probe Latency Matrix", () => {
  let postSpy: ReturnType<typeof jest.spyOn> | null = null;

  function matrixResponse(): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(
      200,
      {
        monitors: [{ id: "web", name: "Website" }],
        probes: [{ id: "rack-3", name: "Rack 3" }],
        cells: {
          web: {
            "rack-3": {
              monitorId: "web",
              probeId: "rack-3",
              hasData: true,
              latencyInMs: 42,
              isOnline: true,
              ageInSeconds: 30,
            },
          },
        },
      },
      {},
    );
  }

  beforeEach(() => {
    postSpy = jest.spyOn(API, "post").mockResolvedValue(matrixResponse());
  });

  afterEach(() => {
    postSpy?.mockRestore();
    postSpy = null;
  });

  test("the card title carries the (i) that says what a cell is", async () => {
    await renderAndSettle(<NetworkDeviceLatencyMatrix {...PAGE_PROPS} />);

    // The bare number the (i) has to explain.
    expect(screen.getByText("42 ms")).toBeInTheDocument();
    expect(screen.getByText("Probe Latency Matrix")).toBeInTheDocument();
    expect(infoButtonNames()).toEqual(["About Probe Latency Matrix"]);
    await expectExplained("Probe Latency Matrix", DESCRIPTIONS.latencyMatrix);
  });

  test("asking what a cell means does not refetch the matrix", async () => {
    await renderAndSettle(<NetworkDeviceLatencyMatrix {...PAGE_PROPS} />);

    expect(postSpy).toHaveBeenCalledTimes(1);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Probe Latency Matrix",
    });

    fireEvent.click(info);
    fireEvent.keyDown(info, { key: "Enter" });
    await flush();

    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
