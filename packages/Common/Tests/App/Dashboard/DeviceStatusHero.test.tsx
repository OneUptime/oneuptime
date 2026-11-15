import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
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
// The next reads fail, as a dropped connection's would.
let isReadFailing: boolean = false;
// While set, reads answer only once it settles: a read still on its way.
let readHeldUntil: Promise<void> | null = null;
let getItemRequests: Array<{
  modelType: unknown;
  id: ObjectID;
  select?: Record<string, unknown> | undefined;
}> = [];
let updateByIdRequests: Array<{
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}> = [];
// What the next save does: by default the server takes it.
let answerUpdateById: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({});
};

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

        if (isReadFailing) {
          return Promise.reject(new Error("The network went away."));
        }

        if (readHeldUntil) {
          return readHeldUntil.then((): NetworkDevice | null => {
            return deviceRow;
          });
        }

        return Promise.resolve(deviceRow);
      },
      updateById: (request: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<unknown> => {
        updateByIdRequests.push(request);
        return answerUpdateById();
      },
    },
  };
});

import DeviceStatusHero from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero";
import {
  TURN_MONITORING_ON_BUTTON_TEST_ID,
  TURN_MONITORING_ON_ERROR_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
import {
  BOUND_MONITOR_PENDING_TOOLTIP,
  MONITORING_OFF_QUALIFIER,
  MONITOR_ARCHIVED_QUALIFIER,
  NO_MONITOR_QUALIFIER,
  NO_PROBE_QUALIFIER,
  SNMP_FAILING_QUALIFIER,
  UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import { Green } from "../../../Types/BrandColors";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import { WORDS_KEEP_INFO_ROOM_CLASS_NAME } from "../../../UI/Components/HyphenatedWords/WordsBeforeInfo";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";

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

/**
 * (f) Monitor-backed and bound, but nothing checks the bound monitor - its
 * monitoring turned off, or archived (issue #6965). The server leaves such
 * a device's stamp empty, so it arrives with no status, as here.
 */
function boundToMonitorNotChecked(switches: {
  disableActiveMonitoring: boolean;
  isArchived: boolean;
}): NetworkDevice {
  const row: NetworkDevice = device({
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    monitorId: MONITOR_ID,
  });
  const monitor: Monitor = new Monitor();
  monitor.disableActiveMonitoring = switches.disableActiveMonitoring;
  monitor.isArchived = switches.isArchived;
  row.monitor = monitor;
  return row;
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

// Whether the reader may turn a monitor's monitoring on (its column's gate).
let columnGate: PermissionGateResult = { isAllowed: true };

// Lets every promise the last event started settle, as the browser would.
async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

describe("the device Overview status hero", () => {
  beforeEach(() => {
    deviceRow = null;
    isReadFailing = false;
    readHeldUntil = null;
    getItemRequests = [];
    updateByIdRequests = [];
    answerUpdateById = (): Promise<unknown> => {
      return Promise.resolve({});
    };

    columnGate = { isAllowed: true };
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return columnGate;
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
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

      /*
       * Its monitor is bound: there is nothing to set up, only that
       * monitor's first check to wait for.
       */
      expect(
        screen.getByTestId("device-hero-monitor-waiting"),
      ).toHaveTextContent("Waiting for its monitor to report");
      expect(screen.queryByText("No alerts yet")).toBeNull();
      expect(screen.queryByText("Set up alerts")).toBeNull();
      expect(screen.queryByText("Not monitored")).toBeNull();
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

      /*
       * Its probe watches it, so it is not "Not monitored" (beside a green
       * Up that read as a contradiction): what it lacks is an alert, and the
       * tile links to the policies that add one.
       */
      const noAlerts: HTMLElement = screen.getByTestId("device-hero-no-alerts");

      expect(noAlerts).toHaveTextContent("No alerts yet");
      expect(linkHref("Set up alerts")).toBe(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES] as Route,
        ).toString(),
      );
      expect(screen.queryByText("Not monitored")).toBeNull();
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
   * Issue #6965. A bound monitor nothing checks gives the device no verdict,
   * and will not give one until it is checked again: the hero must not say
   * "waiting for its monitor to report" - nothing will - but why it is
   * Pending, and where it is put right: on the monitor.
   */
  describe("a monitor-backed device whose bound monitor is not checked", () => {
    const MONITOR_VIEW_HREF: string = RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW] as Route,
      { modelId: MONITOR_ID },
    ).toString();

    /*
     * The qualifier names why; the caption under the verdict says what it
     * means for the verdict - when it will change - and the Monitor Status
     * tile says what the monitor is, in the words its own pages use. They
     * used to be one sentence said twice, a tile apart.
     */
    test.each([
      {
        label: "monitoring turned off",
        switches: { disableActiveMonitoring: true, isArchived: false },
        qualifier: MONITORING_OFF_QUALIFIER,
        caption: "Not checked until monitoring is back on",
        tileText: "Monitoring is turned off",
      },
      {
        label: "archived",
        switches: { disableActiveMonitoring: false, isArchived: true },
        qualifier: MONITOR_ARCHIVED_QUALIFIER,
        caption: "Not checked until its monitor is unarchived",
        tileText: "Its monitor is archived",
      },
      {
        label: "archived with its monitoring off as well",
        switches: { disableActiveMonitoring: true, isArchived: true },
        qualifier: MONITOR_ARCHIVED_QUALIFIER,
        caption: "Not checked until its monitor is unarchived",
        tileText: "Its monitor is archived",
      },
    ])(
      "$label: Pending with its qualifier, a caption that says until when, and the monitor one click away",
      async ({
        switches,
        qualifier,
        caption,
        tileText,
      }: {
        switches: { disableActiveMonitoring: boolean; isArchived: boolean };
        qualifier: { text: string; tooltip: string; pendingTooltip: string };
        caption: string;
        tileText: string;
      }) => {
        await renderHero(boundToMonitorNotChecked(switches));

        expect(pillTexts()).toEqual(["Pending", qualifier.text]);

        const tile: HTMLElement = screen.getByTestId(
          "device-hero-monitor-not-checked",
        );

        // Each said once, each in its own tile.
        expect(screen.getAllByText(caption)).toHaveLength(1);
        expect(tile).not.toContainElement(screen.getByText(caption));
        expect(screen.getAllByText(tileText)).toHaveLength(1);
        expect(tile).toContainElement(screen.getByText(tileText));
        expect(linkHref("Open monitor")).toBe(MONITOR_VIEW_HREF);

        // Nothing it says belongs to a monitor that is about to report.
        expect(screen.queryByTestId("device-hero-monitor-waiting")).toBeNull();
        expect(
          screen.queryByText("Reported by the monitor bound to this device"),
        ).toBeNull();
        // Nor to a device with nothing bound.
        expect(screen.queryByText(NO_MONITOR_QUALIFIER.text)).toBeNull();
        expect(screen.queryByText("No monitor bound")).toBeNull();
        expect(screen.queryByText("Create Ping monitor")).toBeNull();
        expect(screen.queryByText("Bind a monitor")).toBeNull();
      },
    );

    test("explains Pending as a monitor nothing checks, and the qualifier as what to do", async () => {
      await renderHero(
        boundToMonitorNotChecked({
          disableActiveMonitoring: true,
          isArchived: false,
        }),
      );

      const pendingTooltips: Array<string> = tooltipsAfterHovering("Pending");
      expect(pendingTooltips).toContain(
        MONITORING_OFF_QUALIFIER.pendingTooltip,
      );
      expect(pendingTooltips).not.toContain(BOUND_MONITOR_PENDING_TOOLTIP);
      expect(pendingTooltips).not.toContain(
        UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP,
      );

      expect(tooltipsAfterHovering(MONITORING_OFF_QUALIFIER.text)).toContain(
        MONITORING_OFF_QUALIFIER.tooltip,
      );
    });

    test("an archived monitor's tooltips say archived, not off", async () => {
      await renderHero(
        boundToMonitorNotChecked({
          disableActiveMonitoring: false,
          isArchived: true,
        }),
      );

      expect(tooltipsAfterHovering("Pending")).toContain(
        MONITOR_ARCHIVED_QUALIFIER.pendingTooltip,
      );
      expect(tooltipsAfterHovering(MONITOR_ARCHIVED_QUALIFIER.text)).toContain(
        MONITOR_ARCHIVED_QUALIFIER.tooltip,
      );
    });

    /*
     * Both switches as a checked monitor has them: the bound-and-quiet case
     * above, word for word - the qualifier is only for a monitor nobody
     * checks.
     */
    test("a bound monitor that is checked and has not reported keeps waiting for it", async () => {
      await renderHero(
        boundToMonitorNotChecked({
          disableActiveMonitoring: false,
          isArchived: false,
        }),
      );

      expect(pillTexts()).toEqual(["Pending"]);
      expect(
        screen.getByTestId("device-hero-monitor-waiting"),
      ).toHaveTextContent("Waiting for its monitor to report");
      expect(
        screen.queryByTestId("device-hero-monitor-not-checked"),
      ).toBeNull();
      expect(tooltipsAfterHovering("Pending")).toContain(
        BOUND_MONITOR_PENDING_TOOLTIP,
      );
    });

    /*
     * The qualifier explains a Pending and nothing else. A row that still
     * carries a status - read before the server took the stamp off it -
     * shows that status as every other surface does, with nothing beside it
     * claiming it has none.
     */
    test("a device that still carries its monitor's status shows it, with no qualifier", async () => {
      const row: NetworkDevice = boundToMonitorNotChecked({
        disableActiveMonitoring: true,
        isArchived: false,
      });
      const status: MonitorStatus = new MonitorStatus();
      status.name = "Operational";
      status.color = Green;
      status.isOfflineState = false;
      row.currentMonitorStatus = status;

      await renderHero(row);

      expect(pillTexts()).toEqual(["Up", "Operational"]);
      expect(
        screen.queryByTestId("device-hero-monitor-not-checked"),
      ).toBeNull();
      expect(screen.queryByText(MONITORING_OFF_QUALIFIER.text)).toBeNull();
    });

    // A probe-polled device's poll decides it, whatever its monitor's switches.
    test("a probe-polled device pointing at a monitor that is off is not qualified by it", async () => {
      const row: NetworkDevice = device({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        monitorId: MONITOR_ID,
        probeId: PROBE_ID,
        isPollingEnabled: true,
      });
      const monitor: Monitor = new Monitor();
      monitor.disableActiveMonitoring = true;
      monitor.isArchived = false;
      row.monitor = monitor;

      await renderHero(row);

      expect(pillTexts()).toEqual(["Pending"]);
      expect(screen.queryByText(MONITORING_OFF_QUALIFIER.text)).toBeNull();
      expect(
        screen.queryByTestId("device-hero-monitor-not-checked"),
      ).toBeNull();
    });

    test("the hero asks for the bound monitor's two switches", async () => {
      await renderHero(
        boundToMonitorNotChecked({
          disableActiveMonitoring: true,
          isArchived: false,
        }),
      );

      expect(getItemRequests[0]!.select).toMatchObject({
        monitorId: true,
        monitor: { disableActiveMonitoring: true, isArchived: true },
      });
    });

    /*
     * Turned off, the fix is one press, and the monitor's own pages make it
     * with "Turn monitoring on" (useTurnMonitoringOn). The tile used to
     * offer only "Open monitor": a trip to another page, to find the button
     * there. Now the tile carries the same button, gated the same way.
     */
    describe("Turn monitoring on, in the Monitor Status tile", () => {
      const turnedOff: () => NetworkDevice = (): NetworkDevice => {
        return boundToMonitorNotChecked({
          disableActiveMonitoring: true,
          isArchived: false,
        });
      };

      // The device as the save leaves it: stamped with its monitor's status.
      const stampedAgain: () => NetworkDevice = (): NetworkDevice => {
        const row: NetworkDevice = boundToMonitorNotChecked({
          disableActiveMonitoring: false,
          isArchived: false,
        });
        const status: MonitorStatus = new MonitorStatus();
        status.name = "Operational";
        status.color = Green;
        status.isOfflineState = false;
        row.currentMonitorStatus = status;
        return row;
      };

      const turnOnButton: () => HTMLElement = (): HTMLElement => {
        return screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID);
      };

      test("sits in the tile beside Open monitor, as a link of the line's size", async () => {
        await renderHero(turnedOff());

        const tile: HTMLElement = screen.getByTestId(
          "device-hero-monitor-not-checked",
        );
        const button: HTMLElement = screen.getByRole("button", {
          name: "Turn monitoring on",
        });

        expect(tile).toContainElement(button);
        expect(button).toBe(turnOnButton());
        expect(button).toBeEnabled();
        expect(linkHref("Open monitor")).toBe(MONITOR_VIEW_HREF);
        // One line with the link beside it, its spinner at the line's height.
        expect(button.parentElement).toBe(
          screen.getByText("Open monitor").closest("a")!.parentElement,
        );
        expect(button).toHaveClass(
          "text-xs",
          "font-medium",
          "[&_svg]:h-4",
          "[&_svg]:w-4",
          "[&_svg]:ms-0",
        );
        // Wrapped in a narrow tile, its words start where the tile's do.
        expect(button).toHaveClass("text-start");
      });

      test("a press turns the bound monitor's monitoring on, stays busy until the device is read again, then shows the monitor's status", async () => {
        let finishSave: () => void = (): void => {};
        answerUpdateById = (): Promise<unknown> => {
          return new Promise<unknown>((resolve: (value: unknown) => void) => {
            finishSave = (): void => {
              resolve({});
            };
          });
        };

        await renderHero(turnedOff());

        fireEvent.click(turnOnButton());
        await settle();

        // Exactly what the Monitoring switch writes, to the bound monitor.
        expect(updateByIdRequests).toHaveLength(1);
        expect(updateByIdRequests[0]!.modelType).toBe(Monitor);
        expect(updateByIdRequests[0]!.id.toString()).toBe(
          MONITOR_ID.toString(),
        );
        expect(updateByIdRequests[0]!.data).toEqual({
          disableActiveMonitoring: false,
        });
        expect(turnOnButton()).toBeDisabled();
        expect(getItemRequests).toHaveLength(1);

        // Saved: the device is read again, and that read is on its way.
        let finishRead: () => void = (): void => {};
        readHeldUntil = new Promise<void>((resolve: () => void) => {
          finishRead = resolve;
        });
        deviceRow = stampedAgain();

        await act(async () => {
          finishSave();
        });
        await settle();

        expect(getItemRequests).toHaveLength(2);
        expect(getItemRequests[1]!.id.toString()).toBe(DEVICE_ID.toString());
        // Still busy: no live button beside words that are no longer true.
        expect(turnOnButton()).toBeDisabled();
        expect(
          screen.getByText("Monitoring is turned off"),
        ).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();

        await act(async () => {
          finishRead();
        });

        await waitFor(() => {
          expect(
            screen.queryByTestId("device-hero-monitor-not-checked"),
          ).toBeNull();
        });
        // The monitor's verdict and its status word, and no qualifier.
        expect(pillTexts()).toEqual(["Up", "Operational"]);
        expect(screen.queryByText(MONITORING_OFF_QUALIFIER.text)).toBeNull();
        expect(
          screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
        ).toBeNull();
        // Read again in place: never the skeleton.
        expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
      });

      test("pressed twice before it locks, it saves once", async () => {
        await renderHero(turnedOff());

        const button: HTMLElement = turnOnButton();
        fireEvent.click(button);
        fireEvent.click(button);
        await settle();

        expect(updateByIdRequests).toHaveLength(1);
      });

      test("a save the server refuses says why in the tile, reads nothing again, and can be tried again", async () => {
        answerUpdateById = (): Promise<unknown> => {
          return Promise.reject(
            new Error("You do not have permission to update this Monitor."),
          );
        };

        await renderHero(turnedOff());

        fireEvent.click(turnOnButton());
        await settle();

        const alert: HTMLElement = screen.getByRole("alert");
        expect(alert).toHaveTextContent(
          "You do not have permission to update this Monitor.",
        );
        expect(alert).toBe(
          screen.getByTestId(TURN_MONITORING_ON_ERROR_TEST_ID),
        );
        expect(
          screen.getByTestId("device-hero-monitor-not-checked"),
        ).toContainElement(alert);
        expect(getItemRequests).toHaveLength(1);
        expect(turnOnButton()).toBeEnabled();
        expect(
          screen.getByText("Monitoring is turned off"),
        ).toBeInTheDocument();
      });

      test("someone who may not turn monitoring on sees it locked, with why, and a press writes nothing", async () => {
        columnGate = {
          isAllowed: false,
          disabledReason:
            "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
        };

        await renderHero(turnedOff());

        expect(turnOnButton()).toBeDisabled();
        // The locked button's reason sits in the wrapper that takes its place.
        expect(
          screen.getByTestId(
            `${TURN_MONITORING_ON_BUTTON_TEST_ID}-disabled-wrapper`,
          ),
        ).toContainElement(turnOnButton());

        fireEvent.click(turnOnButton());
        await settle();

        expect(updateByIdRequests).toHaveLength(0);
        // The monitor is still one click away.
        expect(linkHref("Open monitor")).toBe(MONITOR_VIEW_HREF);
      });

      test("while the permissions are still loading it offers no button, rather than a lock it cannot explain", async () => {
        columnGate = { isAllowed: false };

        await renderHero(turnedOff());

        expect(
          screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
        ).toBeNull();
        expect(
          screen.getByText("Monitoring is turned off"),
        ).toBeInTheDocument();
        expect(linkHref("Open monitor")).toBe(MONITOR_VIEW_HREF);
      });

      /*
       * Archived wins over turned off: turning monitoring on would leave an
       * archived monitor unchecked, so the tile offers no press that does
       * nothing. It is unarchived on the monitor, which Open monitor opens.
       */
      test.each([
        { label: "archived", disableActiveMonitoring: false },
        {
          label: "archived with its monitoring off as well",
          disableActiveMonitoring: true,
        },
      ])(
        "$label: no Turn monitoring on, only Open monitor",
        async ({
          disableActiveMonitoring,
        }: {
          disableActiveMonitoring: boolean;
        }) => {
          await renderHero(
            boundToMonitorNotChecked({
              disableActiveMonitoring,
              isArchived: true,
            }),
          );

          expect(
            screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
          ).toBeNull();
          expect(
            screen.queryByRole("button", { name: "Turn monitoring on" }),
          ).toBeNull();
          expect(linkHref("Open monitor")).toBe(MONITOR_VIEW_HREF);
        },
      );
    });
  });

  test("a refresh answered elsewhere on the page reads the device again, in place - no skeleton - and shows the new reading", async () => {
    deviceRow = unpolledProbeDevice();

    const { rerender } = render(
      <MemoryRouter>
        <DeviceStatusHero modelId={DEVICE_ID} refreshKey={0} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
    });
    expect(pillTexts()).toContain(NO_PROBE_QUALIFIER.text);
    expect(getItemRequests).toHaveLength(1);

    // The device was read again, polled by its probe now.
    deviceRow = boundReportingMonitorBackedDevice();
    rerender(
      <MemoryRouter>
        <DeviceStatusHero modelId={DEVICE_ID} refreshKey={1} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
    await waitFor(() => {
      expect(pillTexts()).not.toContain(NO_PROBE_QUALIFIER.text);
    });
    expect(getItemRequests).toHaveLength(2);
  });

  /*
   * The bug a review found: the read again shared the first read's error
   * path, and a hero with an error draws nothing - a dropped connection
   * after Refresh took the device's health off its page.
   */
  test("a read again that fails keeps the hero as it was, never an empty space", async () => {
    deviceRow = unpolledProbeDevice();

    const { rerender } = render(
      <MemoryRouter>
        <DeviceStatusHero modelId={DEVICE_ID} refreshKey={0} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
    });
    const shown: Array<string> = pillTexts();
    expect(shown).toContain(NO_PROBE_QUALIFIER.text);

    isReadFailing = true;
    rerender(
      <MemoryRouter>
        <DeviceStatusHero modelId={DEVICE_ID} refreshKey={1} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getItemRequests).toHaveLength(2);
    });
    // Let the failed read settle, then the hero must still be the same.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });
    expect(screen.queryByTestId("device-status-hero-skeleton")).toBeNull();
    expect(pillTexts()).toEqual(shown);
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

/*
 * A hero tile's (i) follows its title's last word (issue #7348).
 *
 * It used to be the title's flex sibling: a title that wraps - German
 * "Hardware-Betriebszeit", Arabic "وقت تشغيل الجهاز المادي" in a tile two
 * to a row - took the row's whole width, and the (i) was drawn at the far
 * edge of the tile, between the two lines. It is now inside the element
 * that holds the title's words, right after the last word, and the words
 * keep its room free at the end of every line, so it always fits after
 * that word. jsdom lays nothing out: what is pinned is that structure, and
 * that the (i) is still named for the title.
 */
describe("the device Overview status hero's tile titles", () => {
  const TITLES_WITH_INFO: Array<string> = [
    "Reachability",
    "Monitor Status",
    "Interfaces",
    "Hardware Uptime",
  ];

  function tileTitle(text: string): HTMLElement {
    const title: HTMLElement | undefined = screen
      .getAllByTestId("device-hero-tile-title")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === text;
      });

    if (!title) {
      throw new Error(`No tile title reading "${text}" was rendered.`);
    }

    return title;
  }

  // The box that holds the (i) after the title's last word, if there is one.
  function glueOf(title: HTMLElement): HTMLElement | null {
    return title.querySelector<HTMLElement>("[data-info-glue]");
  }

  beforeEach(() => {
    deviceRow = null;
    isReadFailing = false;
    readHeldUntil = null;
    getItemRequests = [];
    updateByIdRequests = [];
    columnGate = { isAllowed: true };
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return columnGate;
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test.each(TITLES_WITH_INFO)(
    "%s: the (i) is a descendant of the element holding the title's words, still named for the title",
    async (text: string) => {
      await renderHero(boundReportingMonitorBackedDevice());

      const title: HTMLElement = tileTitle(text);
      const info: HTMLElement = screen.getByRole("button", {
        name: `About ${text}`,
      });

      expect(title).toContainElement(info);
      // Its focus ring is the (i)'s own, as before.
      expect(info).toHaveClass("focus-visible:ring-2");

      /*
       * Right after the last word, in the room the words keep for it at the
       * end of every line: the (i) is never left at the line's far end, or
       * alone at the start of the next.
       */
      const glue: HTMLElement | null = glueOf(title);
      expect(glue).not.toBeNull();
      expect(glue).toHaveClass("whitespace-nowrap");
      expect(glue!.childNodes).toHaveLength(1);
      expect(glue!.firstChild).toBe(info);
      expect(glue!.previousSibling?.textContent).toBe(text);
      expect(glue!.parentElement).toHaveClass(
        ...WORDS_KEEP_INFO_ROOM_CLASS_NAME.split(" "),
      );

      // The words stay one text: the title is found by them, as before.
      expect(title).toContainElement(screen.getByText(text));
    },
  );

  test("a title that only names something has no (i), and no glue", async () => {
    await renderHero(boundReportingMonitorBackedDevice());

    for (const text of ["Site", "Polled By"]) {
      const title: HTMLElement = tileTitle(text);
      expect(title.querySelector("button")).toBeNull();
      expect(glueOf(title)).toBeNull();
    }
  });

  test("no (i) is a sibling of a title any more: each is inside the title it explains", async () => {
    await renderHero(boundReportingMonitorBackedDevice());

    const titles: Array<HTMLElement> = screen.getAllByTestId(
      "device-hero-tile-title",
    );
    const infos: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return (button.getAttribute("aria-label") || "").startsWith("About ");
      });

    expect(infos).toHaveLength(TITLES_WITH_INFO.length);

    for (const info of infos) {
      expect(
        titles.some((title: HTMLElement): boolean => {
          return title.contains(info);
        }),
      ).toBe(true);
    }
  });

  describe("in the reader's language", () => {
    const LOCALES_DIR: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Locales",
    );

    function readLocale(locale: string): Record<string, string> {
      return JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
      ) as Record<string, string>;
    }

    const EN: Record<string, string> = readLocale("en");
    const DE: Record<string, string> = readLocale("de");
    const AR: Record<string, string> = readLocale("ar");

    beforeAll(async () => {
      await i18next.use(initReactI18next).init({
        lng: "en",
        fallbackLng: "en",
        resources: {
          de: { translation: DE },
          ar: { translation: AR },
          en: { translation: EN },
        },
        interpolation: { escapeValue: false },
      });
    });

    afterAll(async () => {
      await i18next.changeLanguage("en");
    });

    test.each([
      ["de", DE],
      ["ar", AR],
    ])(
      "%s: the wrapping Hardware Uptime title has the (i) glued after its last word, named in the locale's words",
      async (language: string, locale: Record<string, string>) => {
        await i18next.changeLanguage(language);
        await renderHero(boundReportingMonitorBackedDevice());

        const translated: string = locale["Hardware Uptime"] as string;
        expect(translated).not.toBe("Hardware Uptime");

        const title: HTMLElement = tileTitle(translated);
        const glue: HTMLElement | null = glueOf(title);
        expect(glue).not.toBeNull();
        expect(glue!.previousSibling?.textContent).toBe(translated);

        const info: HTMLElement = screen.getByRole("button", {
          name: (locale["About {{label}}"] as string).replace(
            "{{label}}",
            translated,
          ),
        });
        expect(title).toContainElement(info);
        expect(glue!.firstChild).toBe(info);
        // A logical margin: after the word, which is its left in Arabic.
        expect(info).toHaveClass("ms-1");
      },
    );
  });
});
