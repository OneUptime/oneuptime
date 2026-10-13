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
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Events page (NetworkEventsView), rendered, in both of its places: the
 * whole network's and one device's.
 *
 *   - It lists what the devices reported, newest first, in one vocabulary;
 *     the buttons and pickers over the list narrow it, and the address bar
 *     keeps what they were set to.
 *   - A row opens what the device said, word for word, with one click to be
 *     told the next time it happens.
 *   - Before anything has arrived the page is the set-up guide, which turns
 *     into the list by itself when the first message arrives. In between it
 *     says which of "nothing in this range", "syslog arrives, but no
 *     events" or "filtered out" it is.
 *   - On the network's page an address that sends syslog but is no device
 *     yet is one click from being one.
 *
 * The network is replaced by a small log store that answers the way the
 * logs' list and facets endpoints do - by attributes and by window - so a
 * filter really narrows what comes back. The range picker is a stand-in.
 */

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const UNKNOWN_ADDRESS: string = "203.0.113.77";

const apiPostMock: MockFunction = getJestMockFunction();
const logsListMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (range: { range: string }) => void;
    }): React.ReactElement => {
      return (
        <span>
          <span data-testid="card-picker">
            {props.dashboardStartAndEndDate.range}
          </span>
          <button
            type="button"
            data-testid="pick-past-hour"
            onClick={() => {
              props.onChange({ range: "Past 1 Hour" });
            }}
          >
            past hour
          </button>
        </span>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return logsListMock(...args);
      },
    },
  };
});

import NetworkEventsView, {
  NETWORK_EVENTS_ROWS_STEP,
  NETWORK_EVENTS_SETUP_POLL_IN_MS,
  NetworkEventsDeviceInfo,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsView";
import {
  NETWORK_EVENTS_PAGE_LIMIT,
  NetworkEventsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsModel";
import { getNetworkEventsDocsUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsSetup";
import Log from "../../../Models/AnalyticsModels/Log";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

// --- a log store that answers like the logs' list and facets endpoints

interface StoredLog {
  time: Date;
  body: string;
  attributes: Record<string, string>;
}

let store: Array<StoredLog> = [];

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function put(
  minutes: number,
  attributes: Record<string, string>,
  body: string = "",
): void {
  store.push({
    time: minutesAgo(minutes),
    body: body,
    attributes: attributes,
  });
}

function matching(
  attributes: Record<string, string>,
  start: Date,
  end: Date,
): Array<StoredLog> {
  return store
    .filter((log: StoredLog): boolean => {
      return (
        log.time.getTime() >= start.getTime() &&
        log.time.getTime() <= end.getTime() &&
        Object.keys(attributes).every((key: string): boolean => {
          return log.attributes[key] === attributes[key];
        })
      );
    })
    .sort((left: StoredLog, right: StoredLog): number => {
      return right.time.getTime() - left.time.getTime();
    });
}

interface LogsListRequest {
  query: {
    time: InBetween<Date>;
    attributes: Record<string, string>;
  };
  limit: number;
}

interface FacetsRequest {
  startTime: string;
  endTime: string;
  facetKeys: Array<string>;
  attributes: Record<string, string>;
  limit: number;
}

function answerLogsList(options: unknown): JSONObject {
  const request: LogsListRequest = options as LogsListRequest;
  const found: Array<StoredLog> = matching(
    request.query.attributes,
    request.query.time.startValue,
    request.query.time.endValue,
  );

  return {
    data: found.slice(0, request.limit).map((stored: StoredLog): Log => {
      const log: Log = new Log();
      log.time = stored.time;
      log.body = stored.body;
      log.attributes = stored.attributes;
      return log;
    }) as unknown as JSONObject,
    count: Math.min(found.length, request.limit),
    skip: 0,
    limit: request.limit,
    hasMore: found.length > request.limit,
  };
}

function answerFacets(args: unknown): JSONObject {
  const request: FacetsRequest = (args as { data: FacetsRequest }).data;
  const found: Array<StoredLog> = matching(
    request.attributes,
    new Date(request.startTime),
    new Date(request.endTime),
  );
  const facets: Record<string, Array<JSONObject>> = {};

  for (const key of request.facetKeys) {
    const counts: Map<string, number> = new Map();

    for (const log of found) {
      const value: string | undefined = log.attributes[key];

      if (value !== undefined) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }

    facets[key] = Array.from(counts.entries())
      .map(([value, count]: [string, number]): JSONObject => {
        return { value: value, count: count };
      })
      .sort((left: JSONObject, right: JSONObject): number => {
        return (right["count"] as number) - (left["count"] as number);
      })
      .slice(0, request.limit);
  }

  return { data: { facets: facets as unknown as JSONObject } };
}

function logsRequests(): Array<LogsListRequest> {
  return logsListMock.mock.calls.map(
    (call: Array<unknown>): LogsListRequest => {
      return call[0] as LogsListRequest;
    },
  );
}

// The last request for the page's rows (not a look-back, not the senders).
function lastEventsRequest(): LogsListRequest {
  const requests: Array<LogsListRequest> = logsRequests().filter(
    (request: LogsListRequest): boolean => {
      return (
        request.limit === NETWORK_EVENTS_PAGE_LIMIT &&
        request.query.attributes["event.domain"] === "network"
      );
    },
  );
  const last: LogsListRequest | undefined = requests[requests.length - 1];

  if (!last) {
    throw new Error("The events were never asked for");
  }

  return last;
}

function lastCountsRequest(): FacetsRequest {
  const requests: Array<FacetsRequest> = apiPostMock.mock.calls
    .map((call: Array<unknown>): FacetsRequest => {
      return (call[0] as { data: FacetsRequest }).data;
    })
    .filter((request: FacetsRequest): boolean => {
      return request.facetKeys.includes("event.kind");
    });
  const last: FacetsRequest | undefined = requests[requests.length - 1];

  if (!last) {
    throw new Error("The counts were never asked for");
  }

  return last;
}

// --- what the devices reported

const LINK_DOWN: Record<string, string> = {
  "event.domain": "network",
  "event.name": "interface.down",
  "event.kind": "problem",
  "event.category": "interface",
  "event.device": "Core Switch",
  "event.message": "Interface GigabitEthernet0/1, changed state to down",
  "network.interface.name": "GigabitEthernet0/1",
  "networkDevice.id": DEVICE_ID,
  "networkDevice.name": "Core Switch",
  "syslog.vendor": "Cisco",
  "syslog.parser": "cisco",
  "syslog.sourceIp": "10.0.0.2",
  "syslog.hostname": "core-sw1",
  "probe.id": PROBE_ID,
  "cisco.facility": "LINK",
  "cisco.mnemonic": "UPDOWN",
};

const LINK_UP: Record<string, string> = {
  ...LINK_DOWN,
  "event.name": "interface.up",
  "event.kind": "recovery",
  "event.message": "Interface GigabitEthernet0/1, changed state to up",
};

const TUNNEL_DOWN: Record<string, string> = {
  "event.domain": "network",
  "event.name": "vpn.tunnel_down",
  "event.kind": "problem",
  "event.category": "vpn",
  "event.device": "Branch Firewall",
  "event.message": "IPSec tunnel HQ-to-Branch went down",
  "vpn.tunnel.name": "HQ-to-Branch",
  "networkDevice.id": OTHER_DEVICE_ID,
  "networkDevice.name": "Branch Firewall",
  "syslog.vendor": "Sophos",
  "syslog.parser": "sophos-firewall",
  "syslog.sourceIp": "10.0.9.1",
  "probe.id": PROBE_ID,
};

// From an address that is not a device yet.
const STRANGER_REBOOT: Record<string, string> = {
  "event.domain": "network",
  "event.name": "device.reboot",
  "event.kind": "problem",
  "event.category": "device",
  "event.device": "unknown-sw",
  "event.message": "System restarted",
  "syslog.unmatched": "true",
  "syslog.vendor": "Cisco",
  "syslog.sourceIp": UNKNOWN_ADDRESS,
  "syslog.hostname": "unknown-sw",
  "probe.id": PROBE_ID,
};

const WIFI_CLIENT: Record<string, string> = {
  "event.domain": "network",
  "event.name": "wireless.client_connected",
  "event.kind": "info",
  "event.category": "wireless",
  "event.device": "Lobby AP",
  "event.message": "STA aa:bb:cc:dd:ee:ff associated to Guest",
  "client.mac": "aa:bb:cc:dd:ee:ff",
  "wifi.ssid": "Guest",
  "syslog.vendor": "Ubiquiti",
  "syslog.sourceIp": "10.0.5.5",
};

// Named by the project in a log pipeline.
const UPS_ON_BATTERY: Record<string, string> = {
  "event.domain": "network",
  "event.name": "ups.on_battery",
  "event.kind": "info",
  "event.device": "Rack UPS",
  "hw.name": "rack-1",
  "syslog.sourceIp": "10.0.7.7",
};

// The same trap every vendor sends.
const TRAP_LINK_DOWN: Record<string, string> = {
  "event.domain": "network",
  "event.name": "interface.down",
  "event.kind": "problem",
  "event.category": "interface",
  "event.device": "Core Switch",
  "network.interface.name": "ether7",
  "networkDevice.id": DEVICE_ID,
  "snmpTrap.oid": "1.3.6.1.6.3.1.1.5.3",
  "snmpTrap.name": "linkDown",
  "snmpTrap.sourceIp": "10.0.0.2",
};

function aDayOfEvents(): void {
  put(1, LINK_DOWN, "the body of the log");
  put(2, LINK_UP);
  put(10, TUNNEL_DOWN);
  put(20, STRANGER_REBOOT);
  put(30, WIFI_CLIENT);
  put(40, UPS_ON_BATTERY, "UPS rack-1 is on battery");
  // Outside the past day, inside the past week.
  put(60 * 24 * 2, {
    ...LINK_DOWN,
    "event.name": "ha.failover",
    "event.category": "ha",
    "event.message": "Failover: this unit is now active",
    "ha.role": "active",
  });
}

// --- the page

async function flush(): Promise<void> {
  for (let i: number = 0; i < 14; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const NETWORK: NetworkEventsScope = { kind: "network" };
const DEVICE: NetworkEventsScope = {
  kind: "device",
  networkDeviceId: DEVICE_ID,
};

async function renderView(
  scope: NetworkEventsScope,
  device?: NetworkEventsDeviceInfo,
): Promise<void> {
  render(
    <MemoryRouter>
      <NetworkEventsView scope={scope} device={device} />
    </MemoryRouter>,
  );
  await flush();
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId("network-event-row");
}

function rowNames(): Array<string> {
  return rows().map((row: HTMLElement): string => {
    return row.getAttribute("data-event-name") || "";
  });
}

function rowTitles(): Array<string> {
  return rows().map((row: HTMLElement): string => {
    return within(row).getByTestId("network-event-open").textContent || "";
  });
}

function rowNamed(name: string): HTMLElement {
  const row: HTMLElement | undefined = rows().find(
    (candidate: HTMLElement): boolean => {
      return candidate.getAttribute("data-event-name") === name;
    },
  );

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row;
}

async function open(name: string): Promise<HTMLElement> {
  fireEvent.click(within(rowNamed(name)).getByTestId("network-event-open"));
  await flush();

  return screen.getByTestId("side-over");
}

function kindButton(name: string): HTMLElement {
  return within(screen.getByTestId("network-events-filters")).getByRole(
    "radio",
    { name: name },
  );
}

async function pick(label: string, option: string): Promise<void> {
  const picker: HTMLElement = within(
    screen.getByTestId("network-events-filters"),
  ).getByRole("combobox", { name: label });

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
  await flush();
}

async function optionsOf(label: string): Promise<Array<string>> {
  const picker: HTMLElement = within(
    screen.getByTestId("network-events-filters"),
  ).getByRole("combobox", { name: label });

  fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

  const options: Array<string> = (await screen.findAllByRole("option")).map(
    (option: HTMLElement): string => {
      return option.textContent || "";
    },
  );

  fireEvent.keyDown(picker, { key: "Escape", code: "Escape" });

  return options;
}

function query(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function allowCreating(): void {
  jest
    .spyOn(PermissionGate, "gateCardButton")
    .mockImplementation((button: unknown): never => {
      return button as never;
    });
}

function createAlertButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Create alert" });
}

function urlOf(route: Route): URL {
  return new URL(route.toString(), "https://oneuptime.example");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState(null, "", "/");
  store = [];
  apiPostMock.mockReset();
  logsListMock.mockReset();
  getListMock.mockReset();
  updateByIdMock.mockReset();
  logsListMock.mockImplementation(async (options: unknown) => {
    return answerLogsList(options);
  });
  apiPostMock.mockImplementation(async (args: unknown) => {
    return answerFacets(args);
  });
  allowCreating();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the network's Events page", () => {
  beforeEach(() => {
    aDayOfEvents();
  });

  test("lists what the devices reported in the past day, newest first, in one vocabulary", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("card-picker")).toHaveTextContent("Past 1 Day");
    expect(rowNames()).toEqual([
      "interface.down",
      "interface.up",
      "vpn.tunnel_down",
      "device.reboot",
      "wireless.client_connected",
      "ups.on_battery",
    ]);
    // Whoever made the device, the words are the same.
    expect(rowTitles()).toEqual([
      "Interface down",
      "Interface up",
      "VPN tunnel down",
      "Device restarted",
      "Wi-Fi client connected",
      // One the project named: called by its own name.
      "ups.on_battery",
    ]);
  });

  test("asks for the network's events of the window, and for nothing a row does not show", async () => {
    await renderView(NETWORK);

    const request: LogsListRequest & {
      select?: Record<string, boolean>;
      sort?: Record<string, unknown>;
    } = lastEventsRequest();

    expect(request.query.attributes).toEqual({ "event.domain": "network" });
    expect(request.query.time.endValue).toEqual(NOW);
    expect(request.query.time.startValue).toEqual(minutesAgo(60 * 24));
    expect(request.limit).toBe(500);
    expect(request.select).toEqual({
      time: true,
      body: true,
      severityText: true,
      attributes: true,
    });
    expect(lastCountsRequest().attributes).toEqual({
      "event.domain": "network",
    });
  });

  test("a row says what happened, to what, on which device, when - and in the device's own words", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowNamed("interface.down");

    expect(row).toHaveAttribute("data-event-kind", "problem");
    expect(within(row).getByTestId("network-event-subject")).toHaveTextContent(
      "Interface GigabitEthernet0/1",
    );
    expect(within(row).getByTestId("network-event-message")).toHaveTextContent(
      "Interface GigabitEthernet0/1, changed state to down",
    );
    expect(within(row).getByTestId("network-event-time")).toHaveTextContent(
      "a minute ago",
    );
    // The kind is a coloured dot; it is said in words for a screen reader.
    expect(row).toHaveTextContent("Problem");
    expect(rowNamed("interface.up")).toHaveTextContent("Recovery");
    expect(rowNamed("wireless.client_connected")).toHaveTextContent(
      "Informational",
    );
  });

  test("a row is a list item with one control: the event's name, which opens it", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowNamed("interface.down");

    expect(row.tagName).toBe("LI");
    expect(row).not.toHaveAttribute("role");
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(
      within(row).getByRole("button", { name: "Interface down" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  test("a device's name is a link to that device's own Events page", async () => {
    await renderView(NETWORK);

    expect(
      within(rowNamed("interface.down")).getByRole("link", {
        name: "Core Switch",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/events`,
    );
    expect(
      within(rowNamed("vpn.tunnel_down")).getByRole("link", {
        name: "Branch Firewall",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${OTHER_DEVICE_ID}/events`,
    );
  });

  test("an event from an address that is not a device yet is listed by the name it gives itself, and says so", async () => {
    await renderView(NETWORK);

    const row: HTMLElement = rowNamed("device.reboot");

    expect(row).toHaveTextContent("unknown-sw");
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(row).getByTestId("network-event-unknown-source"),
    ).toHaveTextContent("Not a device yet");
    expect(
      within(rowNamed("interface.down")).queryByTestId(
        "network-event-unknown-source",
      ),
    ).not.toBeInTheDocument();
  });

  test("an event with no words of its own shows the log's body", async () => {
    await renderView(NETWORK);

    expect(
      within(rowNamed("ups.on_battery")).getByTestId("network-event-message"),
    ).toHaveTextContent("UPS rack-1 is on battery");
    expect(
      within(rowNamed("ups.on_battery")).getByTestId("network-event-subject"),
    ).toHaveTextContent("Component rack-1");
  });

  test("the kind buttons count the whole window", async () => {
    await renderView(NETWORK);

    expect(kindButton("All 6")).toHaveAttribute("aria-checked", "true");
    expect(kindButton("Problems 3")).toHaveAttribute("aria-checked", "false");
    expect(kindButton("Recoveries 1")).toBeInTheDocument();
    expect(kindButton("Informational 2")).toBeInTheDocument();
  });

  test("Problems narrows the list to problems - and the other buttons still say how many they hold", async () => {
    await renderView(NETWORK);

    fireEvent.click(kindButton("Problems 3"));
    await flush();

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.kind": "problem",
    });
    // The counts leave the kind out.
    expect(lastCountsRequest().attributes).toEqual({
      "event.domain": "network",
    });
    expect(rowNames()).toEqual([
      "interface.down",
      "vpn.tunnel_down",
      "device.reboot",
    ]);
    expect(kindButton("Problems 3")).toHaveAttribute("aria-checked", "true");
    expect(kindButton("All 6")).toHaveAttribute("aria-checked", "false");
    expect(kindButton("Recoveries 1")).toBeInTheDocument();
    expect(kindButton("Informational 2")).toBeInTheDocument();
    expect(query().get("kind")).toBe("problem");

    fireEvent.click(kindButton("All 6"));
    await flush();

    expect(rows()).toHaveLength(6);
    expect(query().get("kind")).toBeNull();
  });

  test("Informational lists a project's own events too: every event has a kind", async () => {
    await renderView(NETWORK);

    fireEvent.click(kindButton("Informational 2"));
    await flush();

    expect(rowNames()).toEqual(["wireless.client_connected", "ups.on_battery"]);
  });

  test("the event picker offers what was reported, the most frequent first, each with how often", async () => {
    put(3, LINK_DOWN);
    put(4, LINK_DOWN);
    put(5, TUNNEL_DOWN);
    await renderView(NETWORK);

    expect(await optionsOf("Event")).toEqual([
      "Interface down (3)",
      "VPN tunnel down (2)",
      // As often as each other: by name, so the order never jumps about.
      "Device restarted (1)",
      "Interface up (1)",
      "ups.on_battery (1)",
      "Wi-Fi client connected (1)",
    ]);
  });

  test("picking an event narrows the list and the counts to it", async () => {
    await renderView(NETWORK);

    await pick("Event", "VPN tunnel down (1)");

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.name": "vpn.tunnel_down",
    });
    expect(lastCountsRequest().attributes).toEqual({
      "event.domain": "network",
      "event.name": "vpn.tunnel_down",
    });
    expect(rowNames()).toEqual(["vpn.tunnel_down"]);
    expect(kindButton("All 1")).toBeInTheDocument();
    expect(kindButton("Problems 1")).toBeInTheDocument();
    expect(query().get("event")).toBe("vpn.tunnel_down");
  });

  test("picking a device narrows the list to what it reported, by the name on its events", async () => {
    await renderView(NETWORK);

    expect(await optionsOf("Device")).toEqual([
      "Core Switch (2)",
      "Branch Firewall (1)",
      "Lobby AP (1)",
      "Rack UPS (1)",
      "unknown-sw (1)",
    ]);

    await pick("Device", "Core Switch (2)");

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.device": "Core Switch",
    });
    expect(rowNames()).toEqual(["interface.down", "interface.up"]);
    expect(query().get("device")).toBe("Core Switch");
  });

  test("filters add up", async () => {
    await renderView(NETWORK);

    await pick("Device", "Core Switch (2)");
    fireEvent.click(kindButton("Recoveries 1"));
    await flush();

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.kind": "recovery",
      "event.device": "Core Switch",
    });
    expect(rowNames()).toEqual(["interface.up"]);
    expect(query().get("device")).toBe("Core Switch");
    expect(query().get("kind")).toBe("recovery");
  });

  test("a page opened from a link lands on exactly that view", async () => {
    window.history.replaceState(
      null,
      "",
      "/?range=Past%201%20Week&kind=problem&device=Core%20Switch",
    );
    await renderView(NETWORK);

    expect(screen.getByTestId("card-picker")).toHaveTextContent("Past 1 Week");
    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.kind": "problem",
      "event.device": "Core Switch",
    });
    expect(lastEventsRequest().query.time.startValue).toEqual(
      minutesAgo(60 * 24 * 7),
    );
    // The failover of two days ago is in the week.
    expect(rowNames()).toEqual(["interface.down", "ha.failover"]);
    expect(kindButton("Problems 2")).toHaveAttribute("aria-checked", "true");
  });

  test("a filter set from a link stays in its picker even when the range holds none of it", async () => {
    window.history.replaceState(null, "", "/?event=hardware.fan_failed");
    await renderView(NETWORK);

    expect(screen.getByTestId("network-events-filters")).toHaveTextContent(
      "Fan failed",
    );
    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "event.name": "hardware.fan_failed",
    });
  });

  test("nonsense in the address bar is the default view, not a broken page", async () => {
    window.history.replaceState(
      null,
      "",
      "/?range=forever&kind=catastrophe&event=DROP%20TABLE",
    );
    await renderView(NETWORK);

    expect(screen.getByTestId("card-picker")).toHaveTextContent("Past 1 Day");
    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
    });
    expect(rows()).toHaveLength(6);
  });

  test("a new time range reads the page again over it, and goes into the address bar", async () => {
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("pick-past-hour"));
    await flush();

    expect(screen.getByTestId("card-picker")).toHaveTextContent("Past 1 Hour");
    expect(lastEventsRequest().query.time.startValue).toEqual(minutesAgo(60));
    expect(lastCountsRequest().startTime).toBe(minutesAgo(60).toISOString());
    expect(query().get("range")).toBe("Past 1 Hour");
    expect(rows()).toHaveLength(6);
  });

  test("Refresh reads the page again, up to this moment", async () => {
    await renderView(NETWORK);
    expect(rows()).toHaveLength(6);

    put(0, { ...LINK_DOWN, "network.interface.name": "GigabitEthernet0/2" });
    jest.setSystemTime(new Date(NOW.getTime() + 30 * 1000));
    // Reported in the half minute since the page was read.
    store[store.length - 1]!.time = new Date(NOW.getTime() + 10 * 1000);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(rows()).toHaveLength(7);
    expect(lastEventsRequest().query.time.endValue).toEqual(
      new Date(NOW.getTime() + 30 * 1000),
    );
  });

  test("shows fifty rows at a time", async () => {
    store = [];
    for (let index: number = 0; index < 120; index++) {
      put(index + 1, LINK_DOWN);
    }
    await renderView(NETWORK);

    expect(NETWORK_EVENTS_ROWS_STEP).toBe(50);
    expect(rows()).toHaveLength(50);

    fireEvent.click(screen.getByTestId("network-events-show-more"));
    expect(rows()).toHaveLength(100);

    fireEvent.click(screen.getByTestId("network-events-show-more"));
    expect(rows()).toHaveLength(120);
    expect(
      screen.queryByTestId("network-events-show-more"),
    ).not.toBeInTheDocument();
    // Everything in the range is on the page: nothing more to say.
    expect(
      screen.queryByTestId("network-events-more-note"),
    ).not.toBeInTheDocument();
    expect(kindButton("All 120")).toBeInTheDocument();
  });

  test("a range with more events than a page holds says how to see the older ones", async () => {
    store = [];
    for (
      let index: number = 0;
      index < NETWORK_EVENTS_PAGE_LIMIT + 20;
      index++
    ) {
      put(index + 1, LINK_DOWN);
    }
    await renderView(NETWORK);

    for (
      let shown: number = 50;
      shown < NETWORK_EVENTS_PAGE_LIMIT;
      shown += 50
    ) {
      expect(
        screen.queryByTestId("network-events-more-note"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("network-events-show-more"));
    }

    expect(rows()).toHaveLength(NETWORK_EVENTS_PAGE_LIMIT);
    expect(screen.getByTestId("network-events-more-note")).toHaveTextContent(
      "These are the newest 500 events of this time range. Shorten the range or pick a filter to see older ones.",
    );
    // The count is of the whole range, not of the page.
    expect(kindButton("All 520")).toBeInTheDocument();
  });

  test("a new filter starts again from the first fifty", async () => {
    store = [];
    for (let index: number = 0; index < 120; index++) {
      put(index + 1, LINK_DOWN);
    }
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("network-events-show-more"));
    expect(rows()).toHaveLength(100);

    fireEvent.click(kindButton("Problems 120"));
    await flush();

    expect(rows()).toHaveLength(50);
  });
});

describe("what a device said, word for word", () => {
  beforeEach(() => {
    aDayOfEvents();
  });

  test("a row opens the event: what it is, the facts, the message and everything read out of it", async () => {
    await renderView(NETWORK);

    const panel: HTMLElement = await open("interface.down");

    expect(within(panel).getByTestId("side-over-title")).toHaveTextContent(
      "Interface down",
    );
    expect(
      within(panel).getByTestId("side-over-description"),
    ).not.toBeEmptyDOMElement();

    const facts: Array<string> = within(panel)
      .getAllByTestId("network-event-fact")
      .map((fact: HTMLElement): string => {
        return fact.textContent || "";
      });

    expect(facts[0]).toContain("When");
    expect(facts[0]).toContain("a minute ago");
    expect(facts.slice(1)).toEqual([
      "DeviceCore Switch",
      "InterfaceGigabitEthernet0/1",
      "KindProblem",
      "Reported asSyslog, Cisco format",
      "Sent from10.0.0.2",
    ]);
    expect(
      within(panel).getByTestId("network-event-details-message"),
    ).toHaveTextContent("Interface GigabitEthernet0/1, changed state to down");

    const attributes: HTMLElement = within(panel).getByTestId(
      "network-event-details-attributes",
    );

    for (const text of [
      "event.nameinterface.down",
      "network.interface.nameGigabitEthernet0/1",
      "cisco.mnemonicUPDOWN",
      "syslog.vendorCisco",
    ]) {
      expect(attributes).toHaveTextContent(text);
    }
    // What only OneUptime's plumbing reads is left out.
    expect(attributes).not.toHaveTextContent("event.domain");
    expect(attributes).not.toHaveTextContent("probe.id");
    expect(attributes).not.toHaveTextContent(DEVICE_ID);
  });

  test("the device in the panel is a link to its Events page", async () => {
    await renderView(NETWORK);

    const panel: HTMLElement = await open("interface.down");

    expect(
      within(panel).getByRole("link", { name: "Core Switch" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/events`,
    );
  });

  test("Close closes it, and the list is as it was", async () => {
    await renderView(NETWORK);

    const panel: HTMLElement = await open("interface.down");

    fireEvent.click(
      within(within(panel).getByTestId("side-over-footer")).getByRole(
        "button",
        { name: "Close" },
      ),
    );
    await flush();

    expect(screen.queryByTestId("side-over")).not.toBeInTheDocument();
    expect(rows()).toHaveLength(6);
  });

  test("Create alert for this event opens Create Monitor on that event, for every device", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView(NETWORK);

    const panel: HTMLElement = await open("vpn.tunnel_down");

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Create alert for this event",
      }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    const url: URL = urlOf(navigate.mock.calls[0]![0] as Route);

    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(url.searchParams.get("networkEventAlert")).toBe("vpn.tunnel_down");
    expect(url.searchParams.get("networkEventDeviceId")).toBeNull();
  });

  test("an event the project named says so, and can be alerted on like any other", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView(NETWORK);

    const panel: HTMLElement = await open("ups.on_battery");

    expect(within(panel).getByTestId("side-over-title")).toHaveTextContent(
      "ups.on_battery",
    );
    expect(
      within(panel).getByTestId("side-over-description"),
    ).toHaveTextContent(
      "An event your project named in a log pipeline: ups.on_battery.",
    );
    const facts: Array<string> = within(panel)
      .getAllByTestId("network-event-fact")
      .map((fact: HTMLElement): string => {
        return fact.textContent || "";
      });

    // No vendor's format to name.
    expect(facts.slice(1)).toEqual([
      "DeviceRack UPS",
      "Componentrack-1",
      "KindInformational",
      "Reported asSyslog",
      "Sent from10.0.7.7",
    ]);

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Create alert for this event",
      }),
    );

    expect(
      urlOf(navigate.mock.calls[0]![0] as Route).searchParams.get(
        "networkEventAlert",
      ),
    ).toBe("ups.on_battery");
  });

  test("an event from an address that is not a device yet offers to make it one, address and probe filled in", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView(NETWORK);

    const panel: HTMLElement = await open("device.reboot");

    expect(panel).toHaveTextContent("Not a device yet");
    expect(panel).toHaveTextContent(`Sent from${UNKNOWN_ADDRESS}`);

    fireEvent.click(
      within(panel).getByTestId("network-event-details-add-device"),
    );

    const url: URL = urlOf(navigate.mock.calls[0]![0] as Route);

    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/network-devices`);
    expect(url.searchParams.get("open")).toBe("add-device");
    expect(url.searchParams.get("address")).toBe(UNKNOWN_ADDRESS);
    expect(url.searchParams.get("probe")).toBe(PROBE_ID);
  });

  test("an event of a device has no Add as device", async () => {
    await renderView(NETWORK);

    const panel: HTMLElement = await open("interface.down");

    expect(
      within(panel).queryByTestId("network-event-details-add-device"),
    ).not.toBeInTheDocument();
  });

  test("a trap is told from syslog", async () => {
    store = [];
    put(1, TRAP_LINK_DOWN, "SNMP trap 1.3.6.1.6.3.1.1.5.3 (linkDown)");
    await renderView(NETWORK);

    const panel: HTMLElement = await open("interface.down");

    expect(panel).toHaveTextContent("Reported asSNMP trap");
    expect(panel).toHaveTextContent("Interfaceether7");
    expect(
      within(panel).getByTestId("network-event-details-message"),
    ).toHaveTextContent("SNMP trap 1.3.6.1.6.3.1.1.5.3 (linkDown)");
  });

  test("an event that names more than its subject lists the rest too", async () => {
    await renderView(NETWORK);

    const panel: HTMLElement = await open("wireless.client_connected");

    expect(panel).toHaveTextContent("Clientaa:bb:cc:dd:ee:ff");
    expect(panel).toHaveTextContent("Wi-Fi networkGuest");
  });
});

describe("Create alert", () => {
  beforeEach(() => {
    aDayOfEvents();
  });

  test("opens the alerts most networks want, each one click from a filled-in monitor", async () => {
    await renderView(NETWORK);

    fireEvent.click(createAlertButton()!);
    await flush();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(modal).toHaveTextContent(
      "Get told when something happens on your network",
    );
    expect(modal).toHaveTextContent(
      "It watches every device that sends its syslog or traps to a probe",
    );

    const cards: Array<HTMLElement> = within(modal).getAllByTestId(
      "network-event-alert-template",
    );

    expect(
      cards.map((card: HTMLElement): string => {
        return card.getAttribute("data-template-id") || "";
      }),
    ).toEqual([
      "vpn-tunnel-down",
      "ha-failover",
      "wan-gateway-down",
      "routing-neighbor-down",
      "device-reboot",
      "hardware-failure",
      "interface-down",
      "failed-logins",
    ]);

    for (const card of cards) {
      const url: URL = new URL(
        within(card)
          .getByRole("link", { name: "Create alert" })
          .getAttribute("href") || "",
        "https://oneuptime.example",
      );

      expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
      expect(url.searchParams.get("networkEventAlert")).toBe(
        card.getAttribute("data-template-id"),
      );
      expect(url.searchParams.get("networkEventDeviceId")).toBeNull();
    }

    const scratch: URL = new URL(
      within(modal)
        .getByRole("link", { name: "Start from scratch" })
        .getAttribute("href") || "",
      "https://oneuptime.example",
    );

    expect(scratch.pathname).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(scratch.searchParams.get("monitorType")).toBe("Logs");
  });

  test("Close closes it", async () => {
    await renderView(NETWORK);

    fireEvent.click(createAlertButton()!);
    await flush();
    fireEvent.click(
      within(screen.getByTestId("modal-footer")).getByRole("button", {
        name: "Close",
      }),
    );
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  test("someone who may not create monitors is not offered it - on the page or in an event", async () => {
    jest.spyOn(PermissionGate, "gateCardButton").mockReturnValue(null);
    await renderView(NETWORK);

    expect(createAlertButton()).not.toBeInTheDocument();

    const panel: HTMLElement = await open("interface.down");

    expect(
      within(panel).queryByRole("button", {
        name: "Create alert for this event",
      }),
    ).not.toBeInTheDocument();
    // The event itself is theirs to read.
    expect(
      within(panel).getByTestId("network-event-details-message"),
    ).toBeInTheDocument();
  });

  test("a locked button is not permission to create", async () => {
    jest
      .spyOn(PermissionGate, "gateCardButton")
      .mockImplementation((button: unknown): never => {
        return {
          ...(button as Record<string, unknown>),
          disabled: true,
          tooltip: "You need the Create Monitor permission.",
        } as never;
      });
    await renderView(NETWORK);

    expect(createAlertButton()).toBeDisabled();

    fireEvent.click(createAlertButton()!);
    await flush();

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    const panel: HTMLElement = await open("interface.down");

    expect(
      within(panel).queryByRole("button", {
        name: "Create alert for this event",
      }),
    ).not.toBeInTheDocument();
  });

  test("asks the gate about creating a monitor, which is what an alert here is", async () => {
    const gate: SpyInstance<typeof PermissionGate.gateCardButton> = jest
      .spyOn(PermissionGate, "gateCardButton")
      .mockImplementation((button: unknown): never => {
        return button as never;
      });
    await renderView(NETWORK);

    const call: Array<unknown> = gate.mock.calls[0] as Array<unknown>;

    expect(
      (call[1] as { constructor: { name: string } }).constructor.name,
    ).toBe("Monitor");
    expect(call[2]).toBe("create");
  });
});

describe("a page with nothing to list says why", () => {
  test("nothing has ever arrived: the page is the set-up guide, and nothing else", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("syslog-setup-guide")).toHaveTextContent(
      "See what your network devices report",
    );
    expect(rows()).toHaveLength(0);
    // Nothing to filter, pick a range for or alert on yet.
    expect(
      screen.queryByTestId("network-events-filters"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-picker")).not.toBeInTheDocument();
    expect(createAlertButton()).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-event-sources"),
    ).not.toBeInTheDocument();
  });

  test("the guide waits for the first message, and turns into the list by itself", async () => {
    await renderView(NETWORK);

    expect(screen.getByTestId("syslog-setup-waiting")).toHaveTextContent(
      "Waiting for the first message. This page checks for it every few seconds.",
    );

    const requestsBefore: number = logsListMock.mock.calls.length;

    // Nothing yet: the guide stays exactly as it is.
    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS);
    });
    await flush();

    expect(logsListMock.mock.calls.length).toBeGreaterThan(requestsBefore);
    expect(screen.getByTestId("syslog-setup-guide")).toBeInTheDocument();

    // Somebody pasted the lines into a switch.
    put(0, LINK_DOWN);
    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS);
    });
    await flush();

    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
    expect(rowNames()).toEqual(["interface.down"]);
    expect(screen.getByTestId("card-picker")).toBeInTheDocument();
    expect(createAlertButton()).toBeInTheDocument();
  });

  test("the guide does not ask while nobody is looking at the tab", async () => {
    await renderView(NETWORK);

    const visibility: SpyInstance<() => DocumentVisibilityState> = jest
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const requestsBefore: number = logsListMock.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS * 4);
    });
    await flush();

    expect(logsListMock.mock.calls.length).toBe(requestsBefore);

    visibility.mockReturnValue("visible");
    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS);
    });
    await flush();

    expect(logsListMock.mock.calls.length).toBeGreaterThan(requestsBefore);
  });

  test("a look for the first message that fails changes nothing, and the next one is made", async () => {
    await renderView(NETWORK);

    logsListMock.mockRejectedValueOnce(new Error("The server is restarting."));
    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS);
    });
    await flush();

    expect(screen.getByTestId("syslog-setup-guide")).toBeInTheDocument();
    expect(
      screen.queryByText("The server is restarting.", { exact: false }),
    ).not.toBeInTheDocument();

    put(0, LINK_DOWN);
    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS);
    });
    await flush();

    expect(rowNames()).toEqual(["interface.down"]);
  });

  test("a page with events never asks on its own: the list does not move under a reader", async () => {
    aDayOfEvents();
    await renderView(NETWORK);

    const requestsBefore: number = logsListMock.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS * 10);
    });
    await flush();

    expect(logsListMock.mock.calls.length).toBe(requestsBefore);
  });

  test("a page that is left stops asking", async () => {
    await renderView(NETWORK);

    cleanup();
    const requestsBefore: number = logsListMock.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(NETWORK_EVENTS_SETUP_POLL_IN_MS * 4);
    });

    expect(logsListMock.mock.calls.length).toBe(requestsBefore);
  });

  test("there are events, just not in this range: when the last one was, and one click to it", async () => {
    // Two days ago: outside the past day, inside the week looked back.
    put(60 * 24 * 2, LINK_DOWN);
    await renderView(NETWORK);

    const empty: HTMLElement = screen.getByTestId("network-events-empty-range");

    expect(empty).toHaveTextContent("No events in this time range");
    expect(empty).toHaveTextContent("The last one was 2 days ago.");
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
    // The range picker and the alerts are there: the page works.
    expect(screen.getByTestId("card-picker")).toBeInTheDocument();
    expect(createAlertButton()).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("network-events-show-week"));
    await flush();

    expect(screen.getByTestId("card-picker")).toHaveTextContent("Past 1 Week");
    expect(rowNames()).toEqual(["interface.down"]);
    expect(query().get("range")).toBe("Past 1 Week");
  });

  test("syslog is arriving, but none of it is an event: says so, with where the messages are and how to name them", async () => {
    put(5, { "syslog.sourceIp": "10.0.0.2", "syslog.hostname": "core-sw1" });
    await renderView(NETWORK);

    const empty: HTMLElement = screen.getByTestId(
      "network-events-empty-unrecognized",
    );

    expect(empty).toHaveTextContent(
      "Syslog is arriving, but none of it is an event yet",
    );
    expect(empty).toHaveTextContent(
      "Nothing in the last 7 days was something OneUptime reads as an event",
    );
    expect(empty).toHaveTextContent("Every message is still stored.");
    expect(
      within(empty).getByRole("link", { name: "Open Logs" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/logs`);

    const docs: HTMLElement = within(empty).getByRole("link", {
      name: "How to name your own events",
    });

    // The docs page the set-up guide links to as well.
    expect(docs).toHaveAttribute("href", getNetworkEventsDocsUrl().toString());
    expect(docs).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
  });

  test("everything is filtered out: says so, with the way back", async () => {
    aDayOfEvents();
    window.history.replaceState(null, "", "/?event=hardware.fan_failed");
    await renderView(NETWORK);

    const empty: HTMLElement = screen.getByTestId(
      "network-events-empty-filtered",
    );

    expect(empty).toHaveTextContent("No events match these filters");

    fireEvent.click(screen.getByTestId("network-events-clear-filters"));
    await flush();

    expect(rows()).toHaveLength(6);
    expect(query().get("event")).toBeNull();
    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
    });
  });

  test("a kind with nothing of it is filtered out, not a reason to show the set-up guide", async () => {
    window.history.replaceState(null, "", "/?kind=recovery");
    await renderView(NETWORK);

    expect(
      screen.getByTestId("network-events-empty-filtered"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
  });

  test("when why could not be found out, the page says only what it knows", async () => {
    let lookBacks: number = 0;

    logsListMock.mockImplementation(async (options: unknown) => {
      // The look back for the last event is the one-row list.
      if ((options as LogsListRequest).limit === 1) {
        lookBacks++;
        throw new Error("The look back failed.");
      }

      return answerLogsList(options);
    });
    await renderView(NETWORK);

    expect(lookBacks).toBe(1);

    const empty: HTMLElement = screen.getByTestId(
      "network-events-empty-unknown",
    );

    expect(empty).toHaveTextContent("No events in this time range");
    expect(empty).toHaveTextContent(
      "Nothing was reported in this time range. Pick a longer one to look further back.",
    );
    // Never the set-up guide of someone whose devices may already report.
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
    expect(
      screen.queryByText("The look back failed.", { exact: false }),
    ).not.toBeInTheDocument();
  });
});

describe("who sends syslog without being a device", () => {
  beforeEach(() => {
    aDayOfEvents();
    // Its other messages, which are no events.
    put(21, {
      "syslog.unmatched": "true",
      "syslog.sourceIp": UNKNOWN_ADDRESS,
      "syslog.hostname": "unknown-sw",
      "probe.id": PROBE_ID,
    });
  });

  test("is listed under the events: the address, the name it gives itself, who made it, when it was last heard", async () => {
    await renderView(NETWORK);

    const sources: Array<HTMLElement> = screen.getAllByTestId(
      "network-event-source",
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveTextContent(UNKNOWN_ADDRESS);
    expect(sources[0]).toHaveTextContent("unknown-sw");
    expect(sources[0]).toHaveTextContent("Cisco · last message 20 minutes ago");
    expect(
      within(sources[0]!).getByTestId("network-event-source-unknown"),
    ).toHaveTextContent("Not a device yet");
  });

  test("is asked for by the mark ingest leaves, over the page's own range", async () => {
    await renderView(NETWORK);

    const request: LogsListRequest | undefined = logsRequests().find(
      (candidate: LogsListRequest): boolean => {
        return candidate.query.attributes["syslog.unmatched"] === "true";
      },
    );

    expect(request?.query.attributes).toEqual({ "syslog.unmatched": "true" });
    expect(request?.query.time.startValue).toEqual(minutesAgo(60 * 24));
    expect(request?.limit).toBe(500);
  });

  test("Add as device opens Add Device with the address and the probe filled in", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("network-event-source-add"));

    expect(navigate).toHaveBeenCalledTimes(1);
    const url: URL = urlOf(navigate.mock.calls[0]![0] as Route);

    expect(url.pathname).toBe(`/dashboard/${PROJECT_ID}/network-devices`);
    expect(url.searchParams.get("open")).toBe("add-device");
    expect(url.searchParams.get("address")).toBe(UNKNOWN_ADDRESS);
    expect(url.searchParams.get("probe")).toBe(PROBE_ID);
  });

  test("It is one of my devices: the address joins the device's Other Addresses, and the page reads again", async () => {
    getListMock.mockResolvedValue({
      data: [
        Object.assign(new NetworkDevice(), {
          _id: DEVICE_ID,
          name: "Core Switch",
          hostname: "10.0.0.2",
          otherAddresses: "10.255.0.1",
        }),
        Object.assign(new NetworkDevice(), {
          _id: OTHER_DEVICE_ID,
          name: "Branch Firewall",
          hostname: "10.0.9.1",
        }),
      ],
      count: 2,
      skip: 0,
      limit: 500,
    });
    updateByIdMock.mockResolvedValue({});
    await renderView(NETWORK);
    const requestsBefore: number = logsListMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("network-event-source-link"));
    await flush();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(modal).toHaveTextContent("Which device sends this syslog?");
    expect(modal).toHaveTextContent(
      `Syslog from ${UNKNOWN_ADDRESS} will go to the device you pick.`,
    );
    // Nothing is picked yet: nothing to save.
    expect(
      within(modal).getByRole("button", { name: "Use this device" }),
    ).toBeDisabled();

    const picker: HTMLElement = await within(modal).findByRole("combobox", {
      name: "Device",
    });

    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(
      await screen.findByRole("option", { name: "Core Switch (10.0.0.2)" }),
    );
    fireEvent.click(
      within(modal).getByRole("button", { name: "Use this device" }),
    );
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const update: { id: ObjectID; data: JSONObject } = updateByIdMock.mock
      .calls[0]![0] as { id: ObjectID; data: JSONObject };

    expect(update.id.toString()).toBe(DEVICE_ID);
    expect(update.data).toEqual({
      otherAddresses: `10.255.0.1, ${UNKNOWN_ADDRESS}`,
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("network-event-sources-notice"),
    ).toHaveTextContent(
      `Syslog from ${UNKNOWN_ADDRESS} goes to Core Switch from the next minute on.`,
    );
    expect(logsListMock.mock.calls.length).toBeGreaterThan(requestsBefore);
  });

  test("a device that could not be updated says why, and the dialog stays open", async () => {
    getListMock.mockResolvedValue({
      data: [
        Object.assign(new NetworkDevice(), {
          _id: DEVICE_ID,
          name: "Core Switch",
          hostname: "10.0.0.2",
        }),
      ],
      count: 1,
      skip: 0,
      limit: 500,
    });
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to edit this device."),
    );
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("network-event-source-link"));
    await flush();

    const modal: HTMLElement = screen.getByTestId("modal");

    fireEvent.keyDown(await within(modal).findByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: "Core Switch (10.0.0.2)" }),
    );
    fireEvent.click(
      within(modal).getByRole("button", { name: "Use this device" }),
    );
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "You do not have permission to edit this device.",
    );
    expect(
      screen.queryByTestId("network-event-sources-notice"),
    ).not.toBeInTheDocument();
  });

  test("the devices that could not be listed say why", async () => {
    getListMock.mockRejectedValue(new Error("Devices could not be read."));
    await renderView(NETWORK);

    fireEvent.click(screen.getByTestId("network-event-source-link"));
    await flush();

    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Devices could not be read.",
    );
  });

  test("with nobody sending from an unknown address there is no card", async () => {
    store = [];
    put(1, LINK_DOWN);
    await renderView(NETWORK);

    expect(rows()).toHaveLength(1);
    expect(
      screen.queryByTestId("network-event-sources"),
    ).not.toBeInTheDocument();
  });

  test("senders that could not be read are no reason to fail the page", async () => {
    logsListMock.mockImplementation(async (options: unknown) => {
      if (
        (options as LogsListRequest).query.attributes["syslog.unmatched"] ===
        "true"
      ) {
        throw new Error("The senders could not be read.");
      }

      return answerLogsList(options);
    });
    await renderView(NETWORK);

    expect(rows()).toHaveLength(6);
    expect(
      screen.queryByTestId("network-event-sources"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The senders could not be read.", { exact: false }),
    ).not.toBeInTheDocument();
  });
});

describe("a page that could not be read", () => {
  test("says why", async () => {
    logsListMock.mockRejectedValue(
      new Error("You do not have permission to read logs."),
    );
    await renderView(NETWORK);

    expect(
      screen.getByText("You do not have permission to read logs."),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-events-filters"),
    ).not.toBeInTheDocument();
  });

  test("Refresh tries again", async () => {
    aDayOfEvents();
    logsListMock.mockRejectedValueOnce(new Error("The server is restarting."));
    logsListMock.mockRejectedValueOnce(new Error("The server is restarting."));
    await renderView(NETWORK);

    expect(screen.getByText("The server is restarting.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(
      screen.queryByText("The server is restarting."),
    ).not.toBeInTheDocument();
    expect(rows()).toHaveLength(6);
  });

  test("a refresh that fails keeps the rows that were read, and says they are old", async () => {
    aDayOfEvents();
    await renderView(NETWORK);
    expect(rows()).toHaveLength(6);

    logsListMock.mockRejectedValue(new Error("The server is restarting."));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(rows()).toHaveLength(6);
    expect(
      screen.getByTestId("network-events-refresh-error"),
    ).toHaveTextContent(
      "Couldn't refresh — showing previously loaded data. The server is restarting.",
    );
    expect(screen.getByTestId("network-events-refresh-error")).toHaveAttribute(
      "role",
      "alert",
    );

    // And the next one that works takes the note away.
    logsListMock.mockImplementation(async (options: unknown) => {
      return answerLogsList(options);
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(
      screen.queryByTestId("network-events-refresh-error"),
    ).not.toBeInTheDocument();
  });

  test("a filter that could not be applied never dresses the old rows as filtered-out", async () => {
    aDayOfEvents();
    await renderView(NETWORK);

    logsListMock.mockRejectedValue(new Error("The server is restarting."));
    fireEvent.click(kindButton("Recoveries 1"));
    await flush();

    // The rows of the last view that worked, every kind of them.
    expect(rows()).toHaveLength(6);
    expect(
      screen.queryByTestId("network-events-empty-filtered"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("network-events-refresh-error"),
    ).toBeInTheDocument();
  });

  test("counts that could not be read leave the rows on the page", async () => {
    aDayOfEvents();
    // The facets endpoint answers with nothing when a facet cannot be made in time.
    apiPostMock.mockResolvedValue({ data: { facets: {} } });
    await renderView(NETWORK);

    expect(rows()).toHaveLength(6);
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
    expect(kindButton("All")).toHaveAttribute("aria-checked", "true");
  });

  test("the answer to a request the page is no longer waiting for is dropped", async () => {
    aDayOfEvents();
    await renderView(NETWORK);

    // The first click's answer is held back until after the second's.
    let releaseFirst: () => void = (): void => {};
    let isFirst: boolean = true;

    logsListMock.mockImplementation(async (options: unknown) => {
      const request: LogsListRequest = options as LogsListRequest;

      if (
        isFirst &&
        request.limit === NETWORK_EVENTS_PAGE_LIMIT &&
        request.query.attributes["event.kind"] === "problem"
      ) {
        isFirst = false;
        await new Promise<void>((resolve: () => void) => {
          releaseFirst = resolve;
        });
      }

      return answerLogsList(options);
    });

    fireEvent.click(kindButton("Problems 3"));
    await flush();
    fireEvent.click(kindButton("Recoveries 1"));
    await flush();

    expect(rowNames()).toEqual(["interface.up"]);

    await act(async () => {
      releaseFirst();
    });
    await flush();

    // Still the recoveries: the late answer about problems changed nothing.
    expect(rowNames()).toEqual(["interface.up"]);
    expect(kindButton("Recoveries 1")).toHaveAttribute("aria-checked", "true");
  });
});

describe("one device's Events page", () => {
  const INFO: NetworkEventsDeviceInfo = {
    name: "Core Switch",
    hostname: "10.0.0.2",
    otherAddresses: "10.255.0.1, 2001:db8::1",
    probeName: "office-probe",
    isGlobalProbe: false,
  };

  test("asks for that device's events, by the id a rename does not change", async () => {
    aDayOfEvents();
    await renderView(DEVICE, INFO);

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "networkDevice.id": DEVICE_ID,
    });
    expect(lastCountsRequest().attributes).toEqual({
      "event.domain": "network",
      "networkDevice.id": DEVICE_ID,
    });
    expect(rowNames()).toEqual(["interface.down", "interface.up"]);
  });

  test("does not name the device on every row, offer to pick one, or list other senders", async () => {
    aDayOfEvents();
    await renderView(DEVICE, INFO);

    expect(
      within(rowNamed("interface.down")).queryByRole("link"),
    ).not.toBeInTheDocument();
    expect(rowNamed("interface.down")).not.toHaveTextContent("Core Switch");
    expect(
      within(screen.getByTestId("network-events-filters")).queryByRole(
        "combobox",
        { name: "Device" },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("network-events-filters")).getByRole(
        "combobox",
        { name: "Event" },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("network-event-sources"),
    ).not.toBeInTheDocument();
    // The senders are not even asked for.
    expect(
      logsRequests().some((request: LogsListRequest): boolean => {
        return request.query.attributes["syslog.unmatched"] === "true";
      }),
    ).toBe(false);
  });

  test("a device filter in the address bar means nothing here", async () => {
    aDayOfEvents();
    window.history.replaceState(null, "", "/?device=Somebody%20Else");
    await renderView(DEVICE, INFO);

    expect(lastEventsRequest().query.attributes).toEqual({
      "event.domain": "network",
      "networkDevice.id": DEVICE_ID,
    });
    expect(rows()).toHaveLength(2);
  });

  test("an alert made from an event is for this device only", async () => {
    aDayOfEvents();
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});
    await renderView(DEVICE, INFO);

    const panel: HTMLElement = await open("interface.down");

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Create alert for this event",
      }),
    );

    const url: URL = urlOf(navigate.mock.calls[0]![0] as Route);

    expect(url.searchParams.get("networkEventAlert")).toBe("interface.down");
    expect(url.searchParams.get("networkEventDeviceId")).toBe(DEVICE_ID);
  });

  test("Create alert names the device, and every card is for it alone", async () => {
    aDayOfEvents();
    await renderView(DEVICE, INFO);

    fireEvent.click(createAlertButton()!);
    await flush();

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(modal).toHaveTextContent(
      "Get told when something happens on Core Switch",
    );
    expect(modal).toHaveTextContent("It watches this device only");

    for (const card of within(modal).getAllByTestId(
      "network-event-alert-template",
    )) {
      expect(
        new URL(
          within(card)
            .getByRole("link", { name: "Create alert" })
            .getAttribute("href") || "",
          "https://oneuptime.example",
        ).searchParams.get("networkEventDeviceId"),
      ).toBe(DEVICE_ID);
    }
  });

  test("before its first message: the guide names its probe and the addresses its messages are matched by", async () => {
    await renderView(DEVICE, INFO);

    const guide: HTMLElement = screen.getByTestId("syslog-setup-guide");

    expect(guide).toHaveTextContent("See what this device reports");
    expect(guide).toHaveTextContent("Send syslog to probe office-probe");
    expect(
      within(guide)
        .getAllByTestId("syslog-setup-match-address")
        .map((address: HTMLElement): string => {
          return address.textContent || "";
        }),
    ).toEqual(["10.0.0.2", "10.255.0.1", "2001:db8::1"]);
    expect(
      within(guide).getByRole("link", { name: "Open device settings" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/settings`,
    );
    expect(
      within(guide).queryByTestId("syslog-setup-global-probe"),
    ).not.toBeInTheDocument();
  });

  test("a device polled by a global probe is told its syslog cannot get there", async () => {
    await renderView(DEVICE, { ...INFO, isGlobalProbe: true });

    expect(screen.getByTestId("syslog-setup-global-probe")).toHaveTextContent(
      "This device is polled by a global probe, which syslog from your network cannot reach.",
    );
  });

  test("the guide is not shown to a device whose syslog arrives: its messages are just no events yet", async () => {
    // A log of the device that is no event.
    put(5, {
      "networkDevice.id": DEVICE_ID,
      "syslog.sourceIp": "10.0.0.2",
    });
    await renderView(DEVICE, INFO);

    const empty: HTMLElement = screen.getByTestId(
      "network-events-empty-unrecognized",
    );

    expect(empty).toHaveTextContent(
      "This device's syslog is arriving, but none of it is an event yet",
    );
    // Its own Logs tab, not the project's.
    expect(
      within(empty).getByRole("link", { name: "Open Logs" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}/logs`,
    );
    expect(screen.queryByTestId("syslog-setup-guide")).not.toBeInTheDocument();
  });

  test("another device's syslog does not count as this one's", async () => {
    put(5, {
      "networkDevice.id": OTHER_DEVICE_ID,
      "syslog.sourceIp": "10.0.9.1",
    });
    put(6, TUNNEL_DOWN);
    await renderView(DEVICE, INFO);

    expect(screen.getByTestId("syslog-setup-guide")).toBeInTheDocument();
  });

  test("the page reads well before the device's details arrive, and without them", async () => {
    aDayOfEvents();
    await renderView(DEVICE);

    expect(rows()).toHaveLength(2);

    fireEvent.click(createAlertButton()!);
    await flush();

    // No name to say: the dialog says what it can, and never "your network".
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "Get told when something happens on this device",
    );
    expect(screen.getByTestId("modal")).toHaveTextContent(
      "It watches this device only",
    );
  });
});
