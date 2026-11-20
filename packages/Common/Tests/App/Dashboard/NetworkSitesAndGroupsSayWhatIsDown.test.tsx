/** @timezone UTC */
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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SITE'S OR A GROUP'S "DOWN" SAYS WHICH ONE, AND WHY (#9596).
 *
 * A network site's hero said "2 down" and Offline, and a monitor group's
 * Current Status read Offline, and none said which device, child site or
 * monitor: the reader had to look for the red rows. Now:
 *
 *   - "2 down" on a site opens those two devices, each with why (its last
 *     poll reached it by neither ping nor SNMP, or its monitor's status),
 *     when it last answered, and View;
 *   - an Offline or Degraded site's health opens what is not operational
 *     under it: its devices that are down, then its child sites that are
 *     not operational, read when it is pressed;
 *   - an Offline or Degraded group opens its monitors that are not
 *     operational, each with its status, what set it (the criteria and
 *     what it found, or a person's or an incident's note) and since when.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const fetchMaintenanceWindowsMock: MockFunction = getJestMockFunction();

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
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMaintenanceWindows",
  () => {
    const fetcher: (...args: Array<unknown>) => unknown = (
      ...args: Array<unknown>
    ): unknown => {
      return fetchMaintenanceWindowsMock(...args);
    };

    return {
      __esModule: true,
      default: fetcher,
      fetchSiteMaintenanceWindows: fetcher,
    };
  },
);

import SiteStatusHero from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteStatusHero";
import {
  CHILD_SITE_SENTENCE,
  MONITOR_BACKED_DOWN_SENTENCE,
  SiteChildRow,
  getSiteChildItems,
  getSiteDownDeviceItems,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteDownDevices";
import {
  MONITOR_GROUP_MONITORS_SELECT,
  MONITOR_GROUP_STATUS_SELECT,
  MonitorGroupStatusEvent,
  MonitorGroupStatusRow,
  getMonitorGroupStatusItems,
  getStatusReasonText,
  loadMonitorGroupStatusReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupStatusReason";
import { PROBE_POLLED_DOWN_TOOLTIP } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import {
  DOWN_INTERFACES_QUERY,
  INTERFACES_SHOW_DOWN,
  INTERFACES_SHOW_PARAM,
  getDownInterfacesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/InterfaceListRoute";
import {
  SITE_LIST_SHOW_PARAM,
  SITE_LIST_SHOW_UNHEALTHY,
  getUnhealthySitesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteListRoute";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Route from "../../../Types/API/Route";
import { Green, Red } from "../../../Types/BrandColors";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import Monitor from "../../../Models/DatabaseModels/Monitor";

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const SITE_ID: string = "55555555-5555-4555-8555-555555559596";

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

function status(data: {
  name: string;
  isOperationalState: boolean;
  isOfflineState?: boolean | undefined;
}): MonitorStatus {
  const row: MonitorStatus = new MonitorStatus();

  row._id = `status-${data.name}`;
  row.name = data.name;
  row.color = data.isOperationalState ? Green : Red;
  row.isOperationalState = data.isOperationalState;
  row.isOfflineState = Boolean(data.isOfflineState);

  return row;
}

// A device a probe polls: up when its last poll reached it.
function polledDevice(data: {
  id: string;
  name: string;
  hostname?: string | undefined;
  isReachable: boolean;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  device._id = data.id;
  device.name = data.name;
  if (data.hostname) {
    device.hostname = data.hostname;
  }
  device.monitoringMethod = "Probe";
  device.isPollingEnabled = true;
  device.probeId = new ObjectID("66666666-6666-4666-8666-666666666666");
  device.isReachable = data.isReachable;
  device.lastPolledAt = minutesAgo(2);
  device.lastSeenAt = data.isReachable ? minutesAgo(2) : minutesAgo(180);
  device.pollingIntervalInMinutes = 5;

  return device;
}

// A device a monitor reports for: down when its monitor's status is offline.
function monitorBackedDevice(data: {
  id: string;
  name: string;
  statusName: string;
  isOfflineState: boolean;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();

  device._id = data.id;
  device.name = data.name;
  device.monitoringMethod = "Monitor";
  device.currentMonitorStatus = status({
    name: data.statusName,
    isOperationalState: !data.isOfflineState,
    isOfflineState: data.isOfflineState,
  });

  return device;
}

const deviceRoute: (deviceId: string) => Route = (deviceId: string): Route => {
  return new Route(`/dashboard/p/network/devices/${deviceId}`);
};

function names(items: Array<ResourceAttentionItem>): Array<string> {
  return items.map((item: ResourceAttentionItem): string => {
    return item.name;
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  fetchMaintenanceWindowsMock.mockReset();
});

describe("a site's devices that are down", () => {
  const devices: Array<NetworkDevice> = [
    polledDevice({ id: "d-up", name: "core-sw-1", isReachable: true }),
    polledDevice({
      id: "d-10",
      name: "edge-10",
      hostname: "10.0.0.10",
      isReachable: false,
    }),
    polledDevice({ id: "d-2", name: "edge-2", isReachable: false }),
    monitorBackedDevice({
      id: "d-m",
      name: "branch-router",
      statusName: "Offline",
      isOfflineState: true,
    }),
  ];

  test("lists only the devices that are down, by name as people read numbers", () => {
    expect(
      names(
        getSiteDownDeviceItems({
          devices: devices,
          translator: ENGLISH,
          getDeviceRoute: deviceRoute,
        }),
      ),
    ).toEqual(["branch-router", "edge-2", "edge-10"]);
  });

  test("a polled device says its last poll reached it by neither ping nor SNMP, and when it last answered", () => {
    const item: ResourceAttentionItem | undefined = getSiteDownDeviceItems({
      devices: devices,
      translator: ENGLISH,
      getDeviceRoute: deviceRoute,
    }).find((candidate: ResourceAttentionItem): boolean => {
      return candidate.name === "edge-10";
    });

    expect(item?.explanation).toBe(PROBE_POLLED_DOWN_TOOLTIP);
    expect(item?.reasons).toEqual([]);
    expect(item?.detail).toBe("10.0.0.10");
    expect(item?.lastReportAt?.getTime()).toBe(minutesAgo(180).getTime());
    expect(item?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(item?.route?.toString()).toBe("/dashboard/p/network/devices/d-10");
  });

  test("a monitor-backed device says its monitor's status", () => {
    const item: ResourceAttentionItem | undefined = getSiteDownDeviceItems({
      devices: devices,
      translator: ENGLISH,
      getDeviceRoute: deviceRoute,
    }).find((candidate: ResourceAttentionItem): boolean => {
      return candidate.name === "branch-router";
    });

    expect(item?.explanation).toBe(MONITOR_BACKED_DOWN_SENTENCE);
    expect(item?.reasons).toEqual([
      { text: "{{reason}}", values: { reason: "Offline" } },
    ]);
    expect(item?.lastReportAt).toBeUndefined();
  });

  test("none down lists none", () => {
    expect(
      getSiteDownDeviceItems({
        devices: [devices[0] as NetworkDevice],
        translator: ENGLISH,
        getDeviceRoute: deviceRoute,
      }),
    ).toEqual([]);
  });
});

describe("a site's child sites that are not operational", () => {
  const children: Array<SiteChildRow> = [
    {
      id: "s-ok",
      name: "Building A",
      statusName: "Operational",
      isOperationalState: true,
      isOfflineState: false,
    },
    {
      id: "s-slow",
      name: "Building C",
      statusName: "Degraded",
      isOperationalState: false,
      isOfflineState: false,
    },
    {
      id: "s-down",
      name: "Building B",
      statusName: "Offline",
      isOperationalState: false,
      isOfflineState: true,
    },
    {
      id: "s-new",
      name: "Building D",
      statusName: "",
      isOperationalState: false,
      isOfflineState: false,
    },
  ];

  test("are listed, the offline ones first, each opening its own page", () => {
    const items: Array<ResourceAttentionItem> = getSiteChildItems({
      children: children,
      translator: ENGLISH,
      getSiteRoute: (siteId: string): Route => {
        return new Route(`/dashboard/p/network/sites/${siteId}`);
      },
    });

    expect(names(items)).toEqual(["Building B", "Building C"]);
    expect(items[0]?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[1]?.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[0]?.explanation).toBe(CHILD_SITE_SENTENCE);
    expect(items[0]?.icon).toBe(IconProp.BuildingOffice);
    expect(items[0]?.route?.toString()).toBe(
      "/dashboard/p/network/sites/s-down",
    );
  });
});

// The hero's reads: the site, its devices, its counts and its timeline.
function arrangeSite(data: {
  siteStatus: MonitorStatus;
  devices: Array<NetworkDevice>;
  children?: Array<NetworkSite> | undefined;
}): void {
  const site: NetworkSite = new NetworkSite();

  site._id = SITE_ID;
  site.currentMonitorStatus = data.siteStatus;
  site.lastRollupAt = minutesAgo(1);

  getItemMock.mockResolvedValue(site);
  countMock.mockResolvedValue(0);
  fetchMaintenanceWindowsMock.mockResolvedValue([]);
  getListMock.mockImplementation(
    async (args: { modelType: unknown }): Promise<unknown> => {
      if (args.modelType === NetworkDevice) {
        return { data: data.devices, count: data.devices.length };
      }

      if (args.modelType === NetworkSite) {
        const children: Array<NetworkSite> = data.children || [];
        return { data: children, count: children.length };
      }

      return { data: [], count: 0 };
    },
  );
}

function childSite(data: {
  id: string;
  name: string;
  status: MonitorStatus;
}): NetworkSite {
  const site: NetworkSite = new NetworkSite();

  site._id = data.id;
  site.name = data.name;
  site.currentMonitorStatus = data.status;

  return site;
}

async function renderHero(): Promise<void> {
  render(
    <MemoryRouter>
      <SiteStatusHero modelId={new ObjectID(SITE_ID)} />
    </MemoryRouter>,
  );
  await flush();
}

describe("a site's hero", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(NOW);
  });

  test("'2 down' opens those two devices, with why", async () => {
    arrangeSite({
      siteStatus: status({
        name: "Offline",
        isOperationalState: false,
        isOfflineState: true,
      }),
      devices: [
        polledDevice({ id: "d-up", name: "core-sw-1", isReachable: true }),
        polledDevice({ id: "d-1", name: "edge-1", isReachable: false }),
        polledDevice({ id: "d-2", name: "edge-2", isReachable: false }),
      ],
    });
    await renderHero();

    const pill: HTMLElement = screen.getByTestId("site-hero-devices-down");

    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveTextContent("2 down");

    fireEvent.click(pill);

    const dialog: HTMLElement = screen.getByTestId(
      "site-hero-devices-down-dialog",
    );

    expect(screen.getByText("2 devices down")).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByTestId("site-hero-devices-down-dialog-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["edge-1", "edge-2"]);
    expect(
      within(dialog).getAllByTestId(
        "site-hero-devices-down-dialog-explanation",
      )[0],
    ).toHaveTextContent(PROBE_POLLED_DOWN_TOOLTIP);
    expect(
      within(dialog).getAllByTestId(
        "site-hero-devices-down-dialog-last-report",
      )[0],
    ).toHaveTextContent("Last reported 3 hours ago");
    expect(
      within(dialog).getAllByTestId("site-hero-devices-down-dialog-view")[0],
    ).toHaveAttribute("href", expect.stringContaining("/d-1"));
  });

  test("with nothing down, 'down' is a count, not a button", async () => {
    arrangeSite({
      siteStatus: status({ name: "Operational", isOperationalState: true }),
      devices: [
        polledDevice({ id: "d-up", name: "core-sw-1", isReachable: true }),
      ],
    });
    await renderHero();

    expect(
      screen.queryByTestId("site-hero-devices-down"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("0 down")).toBeInTheDocument();
    // An operational site's health is a plain pill.
    expect(
      screen.queryByTestId("site-hero-health-why"),
    ).not.toBeInTheDocument();
  });

  test("an Offline site's health opens its devices that are down, then its child sites", async () => {
    arrangeSite({
      siteStatus: status({
        name: "Offline",
        isOperationalState: false,
        isOfflineState: true,
      }),
      devices: [
        polledDevice({ id: "d-1", name: "edge-1", isReachable: false }),
      ],
      children: [
        childSite({
          id: "s-b",
          name: "Building B",
          status: status({
            name: "Degraded",
            isOperationalState: false,
          }),
        }),
        childSite({
          id: "s-a",
          name: "Building A",
          status: status({ name: "Operational", isOperationalState: true }),
        }),
      ],
    });
    await renderHero();

    const health: HTMLElement = screen.getByTestId("site-hero-health-why");

    expect(health).toHaveTextContent("Offline");
    expect(health).toHaveAttribute("data-tone", "danger");

    fireEvent.click(health);
    await flush();

    const dialog: HTMLElement = screen.getByTestId(
      "site-hero-health-why-dialog",
    );

    expect(screen.getByText("Why is this site offline?")).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByTestId("site-hero-health-why-dialog-item")
        .map((item: HTMLElement): string | null => {
          return item.getAttribute("data-key");
        }),
    ).toEqual(["device-d-1", "site-s-b"]);

    // The child sites are read only now, under this site.
    const childRead: { query: { parentSiteId: string } } | undefined =
      getListMock.mock.calls
        .map((call: Array<unknown>): unknown => {
          return call[0];
        })
        .find((args: unknown): boolean => {
          return (args as { modelType: unknown }).modelType === NetworkSite;
        }) as { query: { parentSiteId: string } } | undefined;

    expect(childRead?.query.parentSiteId).toBe(SITE_ID);
  });
});

describe("the lists a count opens", () => {
  test("a device's interfaces that are down: up by its admin, not in operation", () => {
    expect(DOWN_INTERFACES_QUERY).toEqual({
      isAdministrativelyUp: true,
      isOperationallyUp: false,
    });

    const route: string = getDownInterfacesRoute(
      new ObjectID("33333333-3333-4333-8333-333333333333"),
    ).toString();

    expect(route).toContain(
      "/33333333-3333-4333-8333-333333333333/interfaces?",
    );
    expect(
      route.endsWith(`${INTERFACES_SHOW_PARAM}=${INTERFACES_SHOW_DOWN}`),
    ).toBe(true);
  });

  test("the sites that are unhealthy: the Sites page, its tile named", () => {
    const route: string = getUnhealthySitesRoute().toString();

    expect(route).toContain("/network-sites?");
    expect(
      route.endsWith(`${SITE_LIST_SHOW_PARAM}=${SITE_LIST_SHOW_UNHEALTHY}`),
    ).toBe(true);
    // A link built twice is the same link: the route map is never written.
    expect(getUnhealthySitesRoute().toString()).toBe(route);
  });
});

describe("what set a monitor's status, in one line", () => {
  test("the criteria and what it found", () => {
    expect(
      getStatusReasonText(
        {
          criteriaName: "Website is down",
          findings: ["Response Status Code was 503."],
          facts: [],
        },
        ENGLISH,
      ),
    ).toBe("Website is down: Response Status Code was 503.");
  });

  test("the cause when the criteria has no finding, the note when no criteria set it", () => {
    expect(
      getStatusReasonText(
        {
          criteriaName: "Website is down",
          findings: [],
          cause: "Server returned 503",
          facts: [],
        },
        ENGLISH,
      ),
    ).toBe("Website is down: Server returned 503");
    expect(
      getStatusReasonText(
        { findings: [], facts: [], note: "Changed by Jane Doe" },
        ENGLISH,
      ),
    ).toBe("Changed by Jane Doe");
    expect(getStatusReasonText(null, ENGLISH)).toBeUndefined();
  });
});

const ROOT_CAUSE: string =
  mdText`**Created because the following criteria was met**:

**Criteria Name**: ${"Website is down"}

**Filter Conditions Met**: ${"Response Status Code was 503."}
`.toString();

function groupMonitor(
  overrides: Partial<MonitorGroupStatusRow>,
): MonitorGroupStatusRow {
  return {
    monitorId: "m-1",
    name: "Checkout API",
    statusName: "Offline",
    isOperationalState: false,
    isOfflineState: true,
    isMonitored: true,
    ...overrides,
  };
}

const monitorRoute: (monitorId: string) => Route = (
  monitorId: string,
): Route => {
  return new Route(`/dashboard/p/monitors/${monitorId}`);
};

describe("a group's monitors that are not operational", () => {
  test("are its monitored monitors that are not operational, the offline first", () => {
    const items: Array<ResourceAttentionItem> = getMonitorGroupStatusItems({
      monitors: [
        groupMonitor({
          monitorId: "m-ok",
          name: "Home page",
          statusName: "Operational",
          isOperationalState: true,
          isOfflineState: false,
        }),
        groupMonitor({
          monitorId: "m-slow",
          name: "Search",
          statusName: "Degraded",
          isOfflineState: false,
        }),
        groupMonitor({ monitorId: "m-1", name: "Checkout API" }),
        // Archived or turned off: its frozen status does not count.
        groupMonitor({
          monitorId: "m-off",
          name: "Old API",
          isMonitored: false,
        }),
      ],
      events: [],
      translator: ENGLISH,
      getMonitorRoute: monitorRoute,
    });

    expect(names(items)).toEqual(["Checkout API", "Search"]);
    expect(items[0]?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[1]?.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[0]?.reasons).toEqual([
      { text: "{{reason}}", values: { reason: "Offline" } },
    ]);
    expect(items[0]?.route?.toString()).toBe("/dashboard/p/monitors/m-1");
  });

  test("each says what set its status and since when, from its newest open event", () => {
    const startedAt: Date = minutesAgo(90);
    const items: Array<ResourceAttentionItem> = getMonitorGroupStatusItems({
      monitors: [groupMonitor({})],
      events: [
        { monitorId: "m-1", startsAt: startedAt, rootCause: ROOT_CAUSE },
        // An older open row of the same monitor never wins.
        {
          monitorId: "m-1",
          startsAt: minutesAgo(600),
          rootCause: "Status was changed because Incident #4 was created.",
        },
      ],
      translator: ENGLISH,
      getMonitorRoute: monitorRoute,
    });

    expect(items[0]?.explanation).toBe(
      "Website is down: Response Status Code was 503.",
    );
    expect(items[0]?.since).toEqual({
      at: startedAt,
      template: "Started {{time}}",
    });
  });

  test("a monitor whose event is unknown still says its status", () => {
    const items: Array<ResourceAttentionItem> = getMonitorGroupStatusItems({
      monitors: [groupMonitor({})],
      events: [] as Array<MonitorGroupStatusEvent>,
      translator: ENGLISH,
      getMonitorRoute: monitorRoute,
    });

    expect(items[0]?.explanation).toBeUndefined();
    expect(items[0]?.since).toBeUndefined();
    expect(items[0]?.reasons).toHaveLength(1);
  });
});

// The statuses the group's monitors are in, as the project holds them.
let groupStatuses: Array<MonitorStatus> = [];

/*
 * A group's monitor as the server answers the group's read: its status by
 * its id only - a relation's relation is never read through it (#10238).
 */
function groupResource(data: {
  id: string;
  name: string;
  status: MonitorStatus;
  isArchived?: boolean | undefined;
}): MonitorGroupResource {
  const monitor: Monitor = new Monitor();

  monitor._id = data.id;
  monitor.name = data.name;
  monitor.isArchived = Boolean(data.isArchived);
  monitor.disableActiveMonitoring = false;
  monitor.currentMonitorStatusId = new ObjectID(data.status._id!.toString());

  if (
    !groupStatuses.some((known: MonitorStatus): boolean => {
      return known._id === data.status._id;
    })
  ) {
    groupStatuses.push(data.status);
  }

  const resource: MonitorGroupResource = new MonitorGroupResource();

  resource.monitor = monitor;

  return resource;
}

// The statuses a read of statuses by their ids asks for.
function statusesAskedFor(args: {
  query: { _id: { values: Array<string> } };
}): { data: Array<MonitorStatus>; count: number } {
  const asked: Array<string> = args.query._id.values.map(
    (id: unknown): string => {
      return String(id);
    },
  );
  const data: Array<MonitorStatus> = groupStatuses.filter(
    (known: MonitorStatus): boolean => {
      return asked.includes(known._id!.toString());
    },
  );

  return { data: data, count: data.length };
}

describe("reading a group's why when it is pressed", () => {
  beforeEach(() => {
    groupStatuses = [];
  });

  test("reads its monitors with their statuses' ids, and the statuses on their own: never a relation of a relation, which the server refuses", async () => {
    getListMock.mockImplementation(
      async (args: {
        modelType: unknown;
        query: { _id: { values: Array<string> } };
      }): Promise<unknown> => {
        if (args.modelType === MonitorStatus) {
          return statusesAskedFor(args);
        }

        if (args.modelType === MonitorGroupResource) {
          return {
            data: [
              groupResource({
                id: "m-1",
                name: "Checkout API",
                status: status({
                  name: "Offline",
                  isOperationalState: false,
                  isOfflineState: true,
                }),
              }),
              groupResource({
                id: "m-2",
                name: "Payments API",
                status: status({
                  name: "Offline",
                  isOperationalState: false,
                  isOfflineState: true,
                }),
              }),
            ],
            count: 2,
          };
        }

        return { data: [], count: 0 };
      },
    );

    const read: ResourceAttentionDialogRead =
      await loadMonitorGroupStatusReason({
        monitorGroupId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        translator: ENGLISH,
        getMonitorRoute: monitorRoute,
      });

    expect(names(read.items).sort()).toEqual(["Checkout API", "Payments API"]);

    const reads: Array<{
      modelType: unknown;
      select: Record<string, unknown>;
      query: Record<string, unknown>;
    }> = getListMock.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        modelType: unknown;
        select: Record<string, unknown>;
        query: Record<string, unknown>;
      };
    });

    const monitorsRead: { select: Record<string, unknown> } = reads.find(
      (args: { modelType: unknown }): boolean => {
        return args.modelType === MonitorGroupResource;
      },
    )!;

    expect(monitorsRead.select).toEqual(MONITOR_GROUP_MONITORS_SELECT);

    // Nothing under the monitor is itself a relation.
    for (const value of Object.values(
      monitorsRead.select["monitor"] as Record<string, unknown>,
    )) {
      expect(typeof value).not.toBe("object");
    }

    const statusesRead: {
      select: Record<string, unknown>;
      query: Record<string, unknown>;
    } = reads.find((args: { modelType: unknown }): boolean => {
      return args.modelType === MonitorStatus;
    })!;

    expect(statusesRead.select).toEqual(MONITOR_GROUP_STATUS_SELECT);
    // Each status once, however many monitors are in it.
    expect(
      (statusesRead.query["_id"] as { values: Array<string> }).values,
    ).toEqual(["status-Offline"]);
  });

  test("a group with no monitors reads no statuses", async () => {
    getListMock.mockImplementation(async (): Promise<unknown> => {
      return { data: [], count: 0 };
    });

    const read: ResourceAttentionDialogRead =
      await loadMonitorGroupStatusReason({
        monitorGroupId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        translator: ENGLISH,
        getMonitorRoute: monitorRoute,
      });

    expect(read.items).toEqual([]);
    expect(
      getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === MonitorStatus;
      }),
    ).toEqual([]);
  });

  test("reads its monitors, then the open events of those not operational", async () => {
    getListMock.mockImplementation(
      async (args: {
        modelType: unknown;
        query: { _id: { values: Array<string> } };
      }): Promise<unknown> => {
        if (args.modelType === MonitorStatus) {
          return statusesAskedFor(args);
        }

        if (args.modelType === MonitorGroupResource) {
          return {
            data: [
              groupResource({
                id: "m-1",
                name: "Checkout API",
                status: status({
                  name: "Offline",
                  isOperationalState: false,
                  isOfflineState: true,
                }),
              }),
              groupResource({
                id: "m-2",
                name: "Home page",
                status: status({
                  name: "Operational",
                  isOperationalState: true,
                }),
              }),
              groupResource({
                id: "m-3",
                name: "Old API",
                isArchived: true,
                status: status({
                  name: "Offline",
                  isOperationalState: false,
                  isOfflineState: true,
                }),
              }),
            ],
            count: 3,
          };
        }

        return { data: [], count: 0 };
      },
    );

    const read: ResourceAttentionDialogRead =
      await loadMonitorGroupStatusReason({
        monitorGroupId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        translator: ENGLISH,
        getMonitorRoute: monitorRoute,
      });

    expect(names(read.items)).toEqual(["Checkout API"]);

    const eventsRead: { query: { monitorId: { values: Array<string> } } } =
      getListMock.mock.calls
        .map((call: Array<unknown>): unknown => {
          return call[0];
        })
        .find((args: unknown): boolean => {
          return (
            (args as { modelType: unknown }).modelType === MonitorStatusTimeline
          );
        }) as { query: { monitorId: { values: Array<string> } } };

    // Only the monitor that is not operational, and counted.
    expect(eventsRead.query.monitorId.values).toEqual(["m-1"]);
  });

  test("a failed read of the events still lists the monitors", async () => {
    getListMock.mockImplementation(
      async (args: {
        modelType: unknown;
        query: { _id: { values: Array<string> } };
      }): Promise<unknown> => {
        if (args.modelType === MonitorStatus) {
          return statusesAskedFor(args);
        }

        if (args.modelType === MonitorGroupResource) {
          return {
            data: [
              groupResource({
                id: "m-1",
                name: "Checkout API",
                status: status({
                  name: "Offline",
                  isOperationalState: false,
                  isOfflineState: true,
                }),
              }),
            ],
            count: 1,
          };
        }

        throw new Error("You need permission to read status timelines.");
      },
    );

    const read: ResourceAttentionDialogRead =
      await loadMonitorGroupStatusReason({
        monitorGroupId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        translator: ENGLISH,
        getMonitorRoute: monitorRoute,
      });

    expect(names(read.items)).toEqual(["Checkout API"]);
    expect(read.items[0]?.explanation).toBeUndefined();
  });
});
