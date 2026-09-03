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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The device Overview's status hero, RENDERED.
 *
 * A monitor-backed device with nothing bound is the one "Pending" that never
 * resolves by itself, so the hero says so three ways: a gray "No monitor"
 * qualifier beside the verdict, a caption that admits nothing is reporting,
 * and a Monitor Status tile that turns into the two ways out — create a Ping
 * monitor (seeded on this device, so it binds on save) or bind an existing
 * one under Settings. A BOUND monitor-backed device that has simply not been
 * evaluated yet gets none of that: it reads "Pending" with a different
 * tooltip, its caption credits the monitor, and the tile says "Not
 * monitored". An SNMP device keeps the poll vocabulary.
 *
 * Until now every one of those sentences was pinned by a source-text match
 * (DeviceStatusSurfaceInvariants, NetworkDeviceStatusCopyInvariants) plus a
 * unit test of the `isUnboundMonitorBackedDevice` predicate. Nothing
 * rendered the hero, so swapping `isUnbound` for `isMonitorBacked` in one
 * branch — which puts "No monitor" and two dead-end links on a device whose
 * monitor is bound and merely quiet — left every suite green. This renders
 * the real component against a ModelAPI stub, one row per case, and asserts
 * the DOM: which pills, which caption, which tile, which hrefs.
 *
 * Tooltips are tippy, portalled to document.body on mouseenter; the notes in
 * DisabledButtonTooltip.test.tsx on asserting them under jsdom apply here.
 */

let deviceRow: NetworkDevice | null = null;
let getItemRequests: Array<{
  modelType: unknown;
  id: ObjectID;
  select?: Record<string, unknown> | undefined;
}> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: unknown;
        id: ObjectID;
        select?: Record<string, unknown> | undefined;
      }): Promise<unknown> => {
        getItemRequests.push(request);
        return Promise.resolve(deviceRow);
      },
    },
  };
});

import DeviceStatusHero from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero";
import {
  BOUND_MONITOR_PENDING_TOOLTIP,
  NO_MONITOR_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";

/*
 * Below the imports on purpose: the jest.mock factory above is hoisted, which
 * leaves the imports evaluated after any module-level constant that precedes
 * them, and constructing an ObjectID up there runs before the class exists.
 */
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/** The three columns that decide everything under test, nothing else set. */
function device(data: {
  monitoringMethod: string | undefined;
  monitorId?: ObjectID | undefined;
  status?: { name: string; isOfflineState: boolean } | undefined;
}): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.id = DEVICE_ID;
  row.name = "Lobby AP";
  row.hostname = "10.0.12.41";

  if (data.monitoringMethod !== undefined) {
    row.monitoringMethod = data.monitoringMethod;
  }

  if (data.monitorId) {
    row.monitorId = data.monitorId;
  }

  if (data.status) {
    const status: MonitorStatus = new MonitorStatus();
    status.name = data.status.name;
    status.color = Green;
    status.isOfflineState = data.status.isOfflineState;
    row.currentMonitorStatus = status;
  }

  return row;
}

/** (a) Monitor-backed, nothing bound, nothing reported. */
function unboundMonitorBackedDevice(): NetworkDevice {
  return device({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor });
}

/** (b) Monitor-backed, a monitor bound, nothing reported yet. */
function boundQuietMonitorBackedDevice(): NetworkDevice {
  return device({
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    monitorId: MONITOR_ID,
  });
}

/** (c) SNMP by way of the NULL column, never polled. */
function neverPolledSnmpDevice(): NetworkDevice {
  return device({ monitoringMethod: undefined });
}

/** (d) Monitor-backed, bound, and the monitor has reported. */
function boundReportingMonitorBackedDevice(): NetworkDevice {
  return device({
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    monitorId: MONITOR_ID,
    status: { name: "Operational", isOfflineState: false },
  });
}

async function renderHero(row: NetworkDevice): Promise<void> {
  deviceRow = row;

  render(
    <MemoryRouter>
      <DeviceStatusHero modelId={DEVICE_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
  });

  // Not the empty fragment the hero falls back to on a failed read.
  expect(screen.getByTestId("device-status-hero")).toBeInTheDocument();
}

/** Every pill on the hero, in DOM order — verdict, qualifiers, tile. */
function pillTexts(): Array<string> {
  return Array.from(
    screen
      .getByTestId("device-status-hero")
      .querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).map((pill: HTMLElement): string => {
    return pill.textContent || "";
  });
}

function linkHref(text: string): string {
  const anchor: HTMLAnchorElement | null = screen.getByText(text).closest("a");

  expect(anchor).not.toBeNull();

  return anchor!.getAttribute("href") || "";
}

/** Hover a pill and return the text of every tooltip tippy has mounted. */
function tooltipsAfterHovering(pillText: string): Array<string> {
  fireEvent.mouseEnter(screen.getByText(pillText));

  return screen.getAllByRole("tooltip").map((tooltip: HTMLElement): string => {
    return tooltip.textContent || "";
  });
}

const SETTINGS_HREF: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route,
  { modelId: DEVICE_ID },
).toString();

const MONITOR_CREATE_HREF: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.MONITOR_CREATE] as Route,
).toString();

describe("the device Overview status hero", () => {
  beforeEach(() => {
    deviceRow = null;
    getItemRequests = [];
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("a monitor-backed device with no monitor bound", () => {
    test("reads Pending with the No monitor qualifier beside it", async () => {
      await renderHero(unboundMonitorBackedDevice());

      expect(pillTexts()).toEqual(["Pending", NO_MONITOR_QUALIFIER.text]);
      expect(screen.getByText("No monitor")).toBeInTheDocument();
    });

    test("says nothing is bound to report on it", async () => {
      await renderHero(unboundMonitorBackedDevice());

      expect(
        screen.getByText("Nothing is bound to report on it yet"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Reported by the monitor bound to this device"),
      ).toBeNull();
      // The poll vocabulary is for devices something polls.
      expect(screen.queryByText("Never answered a poll")).toBeNull();
    });

    test("turns the Monitor Status tile into the two ways out", async () => {
      await renderHero(unboundMonitorBackedDevice());

      expect(screen.getByText("No monitor bound")).toBeInTheDocument();
      expect(screen.queryByText("Not monitored")).toBeNull();

      /*
       * The create link carries the device id, which is what makes the
       * monitor form seed a Ping monitor on this address and bind it on
       * save — without it the form opens on a blank monitor.
       */
      const createHref: string = linkHref("Create Ping monitor");
      expect(createHref).toContain(MONITOR_CREATE_HREF);
      expect(createHref).toContain(`networkDeviceId=${DEVICE_ID.toString()}`);

      expect(linkHref("Bind a monitor")).toBe(SETTINGS_HREF);
    });

    test("explains Pending as the missing binding, and the qualifier as what to do", async () => {
      await renderHero(unboundMonitorBackedDevice());

      expect(tooltipsAfterHovering("Pending")).toContain(
        UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
      );
      expect(tooltipsAfterHovering(NO_MONITOR_QUALIFIER.text)).toContain(
        NO_MONITOR_QUALIFIER.tooltip,
      );
    });
  });

  describe("a monitor-backed device whose bound monitor has not reported", () => {
    test("reads Pending alone — the qualifier is for the unbound case", async () => {
      await renderHero(boundQuietMonitorBackedDevice());

      expect(pillTexts()).toEqual(["Pending"]);
      expect(screen.queryByText(NO_MONITOR_QUALIFIER.text)).toBeNull();
    });

    test("credits the bound monitor and offers no links", async () => {
      await renderHero(boundQuietMonitorBackedDevice());

      expect(
        screen.getByText("Reported by the monitor bound to this device"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Nothing is bound to report on it yet"),
      ).toBeNull();

      expect(screen.getByText("Not monitored")).toBeInTheDocument();
      expect(screen.queryByText("No monitor bound")).toBeNull();
      expect(screen.queryByText("Create Ping monitor")).toBeNull();
      expect(screen.queryByText("Bind a monitor")).toBeNull();
    });

    test("explains Pending as a monitor that has not reported yet", async () => {
      await renderHero(boundQuietMonitorBackedDevice());

      const tooltips: Array<string> = tooltipsAfterHovering("Pending");

      expect(tooltips).toContain(BOUND_MONITOR_PENDING_TOOLTIP);
      expect(tooltips).not.toContain(UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP);
    });
  });

  describe("a monitor-backed device whose bound monitor has reported", () => {
    test("shows the monitor's verdict and its own status word, and nothing about binding", async () => {
      await renderHero(boundReportingMonitorBackedDevice());

      expect(pillTexts()).toEqual(["Up", "Operational"]);
      expect(screen.queryByText(NO_MONITOR_QUALIFIER.text)).toBeNull();
      expect(screen.queryByText("No monitor bound")).toBeNull();
      expect(screen.queryByText("Create Ping monitor")).toBeNull();
      expect(screen.queryByText("Bind a monitor")).toBeNull();
      expect(
        screen.getByText("Reported by the monitor bound to this device"),
      ).toBeInTheDocument();
    });
  });

  describe("an SNMP device that has never been polled", () => {
    test("reads Pending in the poll vocabulary, with no binding qualifier", async () => {
      await renderHero(neverPolledSnmpDevice());

      expect(pillTexts()).toEqual(["Pending"]);
      expect(screen.queryByText(NO_MONITOR_QUALIFIER.text)).toBeNull();
      expect(screen.queryByText("Stale")).toBeNull();

      expect(screen.getByText("Never answered a poll")).toBeInTheDocument();
      expect(
        screen.queryByText("Nothing is bound to report on it yet"),
      ).toBeNull();
      expect(
        screen.queryByText("Reported by the monitor bound to this device"),
      ).toBeNull();

      expect(screen.getByText("Not monitored")).toBeInTheDocument();
      expect(screen.queryByText("No monitor bound")).toBeNull();
      expect(screen.queryByText("Create Ping monitor")).toBeNull();
      expect(screen.queryByText("Bind a monitor")).toBeNull();
    });

    test("explains Pending as a poll that has not happened", async () => {
      await renderHero(neverPolledSnmpDevice());

      const tooltips: Array<string> = tooltipsAfterHovering("Pending");

      expect(tooltips).toContain("This device has not been polled yet.");
      expect(tooltips).not.toContain(UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP);
      expect(tooltips).not.toContain(BOUND_MONITOR_PENDING_TOOLTIP);
    });
  });

  /*
   * The qualifier is decided from `monitorId`, and the verdict from
   * `monitoringMethod` and the nested status. A hero that stopped selecting
   * any of them would not fail to render — it would render "No monitor" on
   * every monitor-backed device, or "Pending" on every one of them.
   */
  test("selects the columns the qualifier and the verdict are decided from", async () => {
    await renderHero(boundReportingMonitorBackedDevice());

    expect(getItemRequests).toHaveLength(1);
    expect(getItemRequests[0]!.modelType).toBe(NetworkDevice);
    expect(getItemRequests[0]!.id.toString()).toBe(DEVICE_ID.toString());
    expect(getItemRequests[0]!.select).toMatchObject({
      monitorId: true,
      monitoringMethod: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOfflineState: true,
      },
    });
  });
});
