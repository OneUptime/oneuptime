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
 * The Network Overview, rendered: what someone opening Network sees first.
 *
 * "Think from first principles ... it should basically wow users." (the
 * maintainer) The page used to open on four tiles and two lists and leave
 * the reader to work out whether anything was wrong. Now it opens on the
 * answer (NetworkHealthHero): one sentence, worst news first, a line saying
 * whether anything raises an incident when a device goes down, and the two
 * ways to bring more of the network in. With nothing on it yet it shows
 * only those two ways in (NetworkGetStarted), each one click from its form.
 *
 * Only the network is replaced: the overview endpoint, the scan list and
 * the alert-policy count. Navigation is the real one, watched, so a button
 * is checked by where it actually goes.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const fetchNetworkOverviewMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
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
      fetchNetworkOverview: (...args: Array<unknown>): unknown => {
        return fetchNetworkOverviewMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
    },
  };
});

import NetworkOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import Navigation from "../../../UI/Utils/Navigation";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const ADD_DEVICE_PATH: string = `/dashboard/${PROJECT_ID}/network-devices?open=add-device`;
const DISCOVER_DEVICES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices/discovery?open=discover-devices`;
const ALERT_POLICIES_PATH: string = `/dashboard/${PROJECT_ID}/network-devices/settings/alert-policies`;

interface FleetCounts {
  total?: number;
  up?: number;
  down?: number;
  pending?: number;
  interfacesDown?: number;
  snmpFailing?: number;
}

function overviewWith(
  fleet: FleetCounts,
  sites?: { siteCount?: number; unhealthySiteCount?: number },
): Record<string, unknown> {
  return {
    fleet: {
      total: fleet.total || 0,
      up: fleet.up || 0,
      down: fleet.down || 0,
      pending: fleet.pending || 0,
      interfacesDown: fleet.interfacesDown || 0,
      snmpFailing: fleet.snmpFailing || 0,
    },
    siteCount: sites?.siteCount || 0,
    unhealthySiteCount: sites?.unhealthySiteCount || 0,
    endpointCount: 0,
    vendors: [],
    attentionDevices: [],
    attentionSites: [],
  };
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

async function flush(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(
  fleet: FleetCounts,
  options?: {
    alertPolicies?: number | Error;
    sites?: { siteCount?: number; unhealthySiteCount?: number };
  },
): Promise<void> {
  fetchNetworkOverviewMock.mockResolvedValue(
    overviewWith(fleet, options?.sites) as never,
  );

  const alertPolicies: number | Error =
    options?.alertPolicies === undefined ? 0 : options.alertPolicies;

  if (alertPolicies instanceof Error) {
    countMock.mockRejectedValue(alertPolicies as never);
  } else {
    countMock.mockResolvedValue(alertPolicies as never);
  }

  render(
    <MemoryRouter>
      <NetworkOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await flush();
}

function hero(): HTMLElement {
  return screen.getByTestId("network-health-hero");
}

function headline(): string {
  return (
    within(hero()).getByTestId("network-health-headline").textContent || ""
  );
}

function detail(): string {
  return within(hero()).getByTestId("network-health-detail").textContent || "";
}

function navigatedTo(): Array<string> {
  return navigateSpy.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach(() => {
  fetchNetworkOverviewMock.mockReset();
  countMock.mockReset();
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0 } as never);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  navigateSpy.mockRestore();
});

describe("before there is anything on it", () => {
  test("shows the two ways in, and no verdict about a network it has not seen", async () => {
    await renderOverview({});

    expect(screen.getByText("Bring your network in")).toBeInTheDocument();
    expect(screen.getByText("Discover devices")).toBeInTheDocument();
    expect(screen.getByText("Add one device")).toBeInTheDocument();
    expect(screen.queryByTestId("network-health-hero")).toBeNull();
    // Nothing to count yet: no tiles of zeroes.
    expect(screen.queryByText("Interfaces Down")).toBeNull();
  });

  test("each way in says who it is for", async () => {
    await renderOverview({});

    expect(
      screen.getByText(
        "Scan an address range, see what answers, and pick the devices to add. Best for a whole network or a new site.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a switch, router, firewall or anything else by its IP address or hostname.",
      ),
    ).toBeInTheDocument();
  });

  test("Discover devices opens the scan form, one click away", async () => {
    await renderOverview({});

    fireEvent.click(screen.getByTestId("network-get-started-discover"));

    expect(navigatedTo()).toEqual([DISCOVER_DEVICES_PATH]);
  });

  test("Add one device opens the Add Device form, one click away", async () => {
    await renderOverview({});

    fireEvent.click(screen.getByTestId("network-get-started-add"));

    expect(navigatedTo()).toEqual([ADD_DEVICE_PATH]);
  });

  test("both choices are real buttons, reachable from the keyboard", async () => {
    await renderOverview({});

    for (const testId of [
      "network-get-started-discover",
      "network-get-started-add",
    ]) {
      const choice: HTMLElement = screen.getByTestId(testId);

      expect(choice.tagName).toBe("BUTTON");
      expect(choice).toHaveAttribute("type", "button");
    }
  });

  test("a project with sites but no devices is offered the same two ways in", async () => {
    await renderOverview({}, { sites: { siteCount: 4 } });

    expect(screen.getByText("Bring your network in")).toBeInTheDocument();
  });
});

describe("the verdict, worst news first", () => {
  test("devices down: red, counted, and named before anything else", async () => {
    await renderOverview(
      { total: 12, up: 6, down: 3, interfacesDown: 5, snmpFailing: 2 },
      { sites: { siteCount: 3, unhealthySiteCount: 2 } },
    );

    expect(hero()).toHaveAttribute("data-tone", "critical");
    expect(headline()).toBe("3 devices are down");
    expect(detail()).toContain(
      "Their probes or monitors cannot reach them. They are listed first under Devices needing attention.",
    );
  });

  test("one device down reads in the singular", async () => {
    await renderOverview({ total: 12, up: 11, down: 1 });

    expect(headline()).toBe("1 device is down");
    expect(detail()).toContain("Its probe or monitor cannot reach it.");
  });

  test("unhealthy sites come next, in amber", async () => {
    await renderOverview(
      { total: 12, up: 12, interfacesDown: 5 },
      { sites: { siteCount: 3, unhealthySiteCount: 2 } },
    );

    expect(hero()).toHaveAttribute("data-tone", "warning");
    expect(headline()).toBe("2 sites need attention");
  });

  test("then interfaces down", async () => {
    await renderOverview({ total: 12, up: 12, interfacesDown: 5, snmpFailing: 1 });

    expect(hero()).toHaveAttribute("data-tone", "warning");
    expect(headline()).toBe("5 interfaces are down");
  });

  test("then devices whose details are not being read", async () => {
    await renderOverview({ total: 12, up: 12, snmpFailing: 2 });

    expect(hero()).toHaveAttribute("data-tone", "warning");
    expect(headline()).toBe("2 devices are not reporting their details");
    expect(detail()).toContain("Check their SNMP credentials.");
  });

  test("devices added and not checked yet: waiting, in grey, with no alarm", async () => {
    await renderOverview({ total: 3, pending: 3 });

    expect(hero()).toHaveAttribute("data-tone", "waiting");
    expect(headline()).toBe("Waiting for the first check");
    expect(detail()).toBe(
      "3 devices were added. Their probe checks them within a few minutes.",
    );
    // The waiting line already counts them.
    expect(screen.queryByTestId("network-health-pending-note")).toBeNull();
  });

  test("everything answering: green, and it says so plainly", async () => {
    await renderOverview({ total: 40, up: 40 });

    expect(hero()).toHaveAttribute("data-tone", "healthy");
    expect(headline()).toBe("All 40 devices are up");
    expect(detail()).toBe(
      "Every device answers, no interface is down and every site is healthy.",
    );
  });

  test("a single device that answers reads as your device", async () => {
    await renderOverview({ total: 1, up: 1 });

    expect(headline()).toBe("Your device is up");
  });

  test("devices still waiting are never hidden behind All up", async () => {
    await renderOverview({ total: 40, up: 38, pending: 2 });

    expect(headline()).toBe("All 38 devices are up");
    expect(
      screen.getByTestId("network-health-pending-note"),
    ).toHaveTextContent("2 more are waiting for their first check.");
  });

  test("the verdict sits above the tiles it sums up", async () => {
    await renderOverview({ total: 12, up: 9, down: 3 });

    const tilesTitle: HTMLElement = screen.getByText("Interfaces Down");

    expect(
      hero().compareDocumentPosition(tilesTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("whether anything alerts on it", () => {
  test("is read as the project's enabled alert policies", async () => {
    await renderOverview({ total: 2, up: 2 }, { alertPolicies: 1 });

    const call: Record<string, unknown> | undefined = countMock.mock
      .calls[0]?.[0] as Record<string, unknown> | undefined;

    expect(call?.["modelType"]).toBe(NetworkAlertPolicy);

    const query: Record<string, unknown> = call?.["query"] as Record<
      string,
      unknown
    >;

    expect(query["isEnabled"]).toBe(true);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
  });

  test("none yet: says what one would do, and links to set one up", async () => {
    await renderOverview({ total: 2, up: 2 }, { alertPolicies: 0 });

    const line: HTMLElement = screen.getByTestId("network-health-alerting");

    expect(line).toHaveTextContent(
      "No alert policy yet. Turn one on to raise an incident when a device goes down.",
    );

    const link: HTMLElement = within(
      screen.getByTestId("network-health-alerting-link"),
    ).getByText("Set up alerts");

    expect(link.closest("a")).toHaveAttribute("href", ALERT_POLICIES_PATH);
  });

  test("some: counts them, and links to them", async () => {
    await renderOverview({ total: 2, up: 2 }, { alertPolicies: 3 });

    expect(screen.getByTestId("network-health-alerting")).toHaveTextContent(
      "3 alert policies raise incidents for this network.",
    );

    const link: HTMLElement = within(
      screen.getByTestId("network-health-alerting-link"),
    ).getByText("Alert Policies");

    expect(link.closest("a")).toHaveAttribute("href", ALERT_POLICIES_PATH);
  });

  test("one reads in the singular", async () => {
    await renderOverview({ total: 2, up: 2 }, { alertPolicies: 1 });

    expect(screen.getByTestId("network-health-alerting")).toHaveTextContent(
      "1 alert policy raises incidents for this network.",
    );
  });

  /*
   * A role that cannot read alert policies is not told there are none: the
   * line is left out, and the rest of the page is drawn as usual.
   */
  test("unknown (the count could not be read): the line is left out, the page is not", async () => {
    await renderOverview(
      { total: 12, up: 9, down: 3 },
      { alertPolicies: new Error("Forbidden") },
    );

    expect(screen.queryByTestId("network-health-alerting")).toBeNull();
    expect(headline()).toBe("3 devices are down");
  });
});

describe("the ways to bring more in", () => {
  test("Add Device on the verdict opens the Add Device form", async () => {
    await renderOverview({ total: 2, up: 2 });

    fireEvent.click(screen.getByTestId("network-overview-add-device"));

    expect(navigatedTo()).toEqual([ADD_DEVICE_PATH]);
  });

  test("Discover Devices on the verdict opens the scan form", async () => {
    await renderOverview({ total: 2, up: 2 });

    fireEvent.click(screen.getByTestId("network-overview-discover-devices"));

    expect(navigatedTo()).toEqual([DISCOVER_DEVICES_PATH]);
  });

  test("with no scans yet, the scans card says what a scan is for and starts one", async () => {
    await renderOverview({ total: 2, up: 2 });

    expect(
      screen.getByText(
        "No scans yet. Scan a subnet to find the devices on it, then pick the ones to add.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Scan" }));

    expect(navigatedTo()).toEqual([DISCOVER_DEVICES_PATH]);
  });
});
