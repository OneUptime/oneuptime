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
 * monitored". A probe-polled device keeps the poll vocabulary, and has its own
 * never-resolving Pending — no probe assigned, or polling switched off —
 * qualified by "No probe" rather than by anything about binding.
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
  NO_PROBE_QUALIFIER,
  SNMP_FAILING_QUALIFIER,
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
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

/** The columns that decide everything under test, nothing else set. */
function device(data: {
  monitoringMethod: string | undefined;
  monitorId?: ObjectID | undefined;
  probeId?: ObjectID | undefined;
  isPollingEnabled?: boolean | undefined;
  isReachable?: boolean | undefined;
  isSnmpReachable?: boolean | undefined;
  polledJustNow?: boolean | undefined;
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

  if (data.probeId) {
    row.probeId = data.probeId;
  }

  if (data.isPollingEnabled !== undefined) {
    row.isPollingEnabled = data.isPollingEnabled;
  }

  if (data.isReachable !== undefined) {
    row.isReachable = data.isReachable;
  }

  /*
   * `isSnmpReachable` left unset is the NULL the column carries when no walk
   * was attempted — a ping-only device — and it is a different state from
   * `false`, which is a walk that ran and failed.
   */
  if (data.isSnmpReachable !== undefined) {
    row.isSnmpReachable = data.isSnmpReachable;
  }

  /*
   * A poll that has just happened, so the shared rule's stale window cannot
   * expire and add an amber pill the assertions below do not expect.
   */
  if (data.polledJustNow) {
    const now: Date = new Date();
    row.lastPolledAt = now;

    if (data.isReachable) {
      row.lastSeenAt = now;
    }
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

/**
 * (c) Probe-polled by way of the NULL column — the legacy spelling parses to
 * Probe — with a probe assigned and polling on, and no poll reported yet.
 */
function neverPolledProbeDevice(): NetworkDevice {
  return device({
    monitoringMethod: undefined,
    probeId: PROBE_ID,
    isPollingEnabled: true,
  });
}

/**
 * (e) Probe-polled with NO probe assigned: the Pending that never resolves by
 * itself on this kind of device, the way an unbound monitor-backed one is.
 */
function unpolledProbeDevice(): NetworkDevice {
  return device({ monitoringMethod: NetworkDeviceMonitoringMethod.Probe });
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

/**
 * The pill carrying this text. Scoped to `[data-testid="pill"]` rather than
 * matched on text anywhere in the hero, because "No probe" is also the "Polled
 * By" tile's empty state — the qualifier and the tile say the same two words
 * about two different things, and a bare text query would find both.
 */
function pillNamed(pillText: string): HTMLElement {
  const pill: HTMLElement | undefined = Array.from(
    screen
      .getByTestId("device-status-hero")
      .querySelectorAll<HTMLElement>('[data-testid="pill"]'),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").trim() === pillText;
  });

  if (!pill) {
    throw new Error(`No pill reading "${pillText}" was rendered.`);
  }

  return pill;
}

/** Hover a pill and return the text of every tooltip tippy has mounted. */
function tooltipsAfterHovering(pillText: string): Array<string> {
  fireEvent.mouseEnter(pillNamed(pillText));

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

  describe("a probe-polled device that has never been polled", () => {
    /*
     * A probe IS assigned here and polling is on, so the poll is coming: the
     * verdict stands alone. Both qualifiers have to stay off — "No monitor"
     * because nothing is meant to be bound to a probe-polled device, and "No
     * probe" because a device that is merely waiting for its first cycle is
     * not a device nothing can reach.
     */
    test("reads Pending in the poll vocabulary, with no qualifier beside it", async () => {
      await renderHero(neverPolledProbeDevice());

      /*
       * The equality is the assertion: it says the verdict stands alone, so
       * neither qualifier and no "Stale" pill can appear beside it.
       */
      expect(pillTexts()).toEqual(["Pending"]);

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
      await renderHero(neverPolledProbeDevice());

      const tooltips: Array<string> = tooltipsAfterHovering("Pending");

      expect(tooltips).toContain("This device has not been polled yet.");
      expect(tooltips).not.toContain(UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP);
      expect(tooltips).not.toContain(BOUND_MONITOR_PENDING_TOOLTIP);
    });
  });

  /*
   * The probe-polled counterpart of the unbound monitor-backed case, and the
   * reason it needs its own pill: every device is pinged by its probe now, so
   * "Pending" on a device with no probe is not "the first cycle has not run" —
   * it is "no cycle will ever run", and the operator has to be told which of
   * the two they are looking at. The way out is a probe, never a monitor, so
   * the binding vocabulary must stay off this device entirely.
   */
  describe("a probe-polled device with no probe assigned", () => {
    test("reads Pending with the No probe qualifier, and nothing about binding", async () => {
      await renderHero(unpolledProbeDevice());

      expect(pillTexts()).toEqual(["Pending", NO_PROBE_QUALIFIER.text]);
      expect(screen.queryByText("No monitor bound")).toBeNull();
      expect(screen.queryByText("Create Ping monitor")).toBeNull();
      expect(screen.queryByText("Bind a monitor")).toBeNull();
    });

    test("says assigning a probe is what starts the pinging", async () => {
      await renderHero(unpolledProbeDevice());

      expect(tooltipsAfterHovering(NO_PROBE_QUALIFIER.text)).toContain(
        NO_PROBE_QUALIFIER.tooltip,
      );
    });

    /*
     * Switching polling off reaches the same dead end by the other door, and
     * the hero has to say so: a device nobody polls on purpose still reads
     * Pending forever, and an operator who does not see the qualifier goes
     * looking for a probe that is already assigned.
     */
    test("says the same when a probe is assigned but polling is switched off", async () => {
      await renderHero(
        device({
          monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
          probeId: PROBE_ID,
          isPollingEnabled: false,
        }),
      );

      expect(pillTexts()).toEqual(["Pending", NO_PROBE_QUALIFIER.text]);
    });
  });

  /*
   * The reason the walk needs a pill of its own. Ping and SNMP are two
   * separate questions about a probe-polled device now: reachability is "ping
   * answered OR the walk succeeded", so a device whose credentials are wrong
   * answers ping and is CORRECTLY Up — while its interfaces, inventory and
   * health OIDs quietly stop being refreshed. Without the qualifier the only
   * signal is a green pill and numbers that never change.
   */
  describe("a probe-polled device that answers ping while its walk fails", () => {
    function pingingButNotWalking(): NetworkDevice {
      return device({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        probeId: PROBE_ID,
        isPollingEnabled: true,
        isReachable: true,
        isSnmpReachable: false,
        polledJustNow: true,
      });
    }

    test("stays Up, and says so with SNMP failing beside it rather than a red pill", async () => {
      await renderHero(pingingButNotWalking());

      expect(pillTexts()).toEqual(["Up", SNMP_FAILING_QUALIFIER.text]);
      expect(tooltipsAfterHovering(SNMP_FAILING_QUALIFIER.text)).toContain(
        SNMP_FAILING_QUALIFIER.tooltip,
      );
    });

    test("the SNMP line names the walk as what is broken", async () => {
      await renderHero(pingingButNotWalking());

      expect(
        screen.getByTestId("device-status-hero-snmp").textContent,
      ).toContain("Failing");
    });
  });

  /*
   * The other half of that split, and the one the ping-first change exists
   * for: a device with no credentials is pinged and never walked, so its
   * `isSnmpReachable` is NULL rather than false. Calling that "SNMP failing"
   * would send its operator hunting for credentials on a device nobody ever
   * decided to walk — the hero says it is not configured instead, and points
   * at where to configure it.
   */
  describe("a probe-polled device that is pinged and never walked", () => {
    function pingOnly(): NetworkDevice {
      return device({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        probeId: PROBE_ID,
        isPollingEnabled: true,
        isReachable: true,
        polledJustNow: true,
      });
    }

    test("reads Up alone — a device nobody walks is never SNMP failing", async () => {
      await renderHero(pingOnly());

      expect(pillTexts()).toEqual(["Up"]);
    });

    test("the SNMP line offers credentials instead of reporting a failure", async () => {
      await renderHero(pingOnly());

      const snmpLine: string =
        screen.getByTestId("device-status-hero-snmp").textContent || "";

      expect(snmpLine).toContain("Not configured");
      expect(snmpLine).not.toContain("Failing");
    });
  });

  /*
   * "No monitor" is decided from `monitorId`, "No probe" from `probeId` and
   * `isPollingEnabled`, and the verdict from `monitoringMethod` and the nested
   * status. A hero that stopped selecting any of them would not fail to
   * render — an unselected column arrives undefined, which reads as "not set",
   * so it would hang "No monitor" on every monitor-backed device and "No
   * probe" on every probe-polled one however well they are configured.
   */
  test("selects the columns the qualifiers and the verdict are decided from", async () => {
    await renderHero(boundReportingMonitorBackedDevice());

    expect(getItemRequests).toHaveLength(1);
    expect(getItemRequests[0]!.modelType).toBe(NetworkDevice);
    expect(getItemRequests[0]!.id.toString()).toBe(DEVICE_ID.toString());
    expect(getItemRequests[0]!.select).toMatchObject({
      monitorId: true,
      monitoringMethod: true,
      probeId: true,
      isPollingEnabled: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        isOfflineState: true,
      },
    });
  });
});
