import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * The second half of OneUptime/oneuptime#3447. A monitor-backed device — one
 * imported from a discovery scan because it answered ping but not SNMP — has
 * no probe, no interface inventory and no `lastSeenAt`, BY DESIGN: nothing
 * walks it, and the columns that hold those answers are only ever written by
 * the SNMP walk ingest.
 *
 * The device list rendered all three anyway, in the vocabulary of failure:
 *
 *   Probe       -> "No probe found."   (the shared element's null path)
 *   Interfaces  -> "0 / 0"             (a green zero and a gray zero)
 *   Last Seen   -> "Never"
 *
 * Every one of those is a true statement about a NULL column and a false
 * statement about the device. "No probe found" reads as a lookup failure and
 * sent the reporter hunting for a probe to assign to a device that is designed
 * never to have one. "Never" directly contradicts the Status pill one column
 * to its left, which may be saying Operational because the bound monitor just
 * reported. And "0 / 0" claims the switch has no working ports rather than
 * "interfaces are not something we know about this device".
 *
 * The Status column had a monitor-backed branch from the day the monitoring
 * method was introduced, and #3392 later extended monitor-awareness to five
 * more surfaces. These three columns were skipped by BOTH passes. This file
 * stops that happening a third time.
 *
 * METHOD. Source-text assertions, comments stripped and whitespace squashed,
 * the same approach as DeviceStatusSurfaceInvariants.test.ts — the App suite
 * runs in a plain Node environment with no React renderer, so the columns
 * cannot be mounted and inspected.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

function devicesList(): string {
  return readCode("Pages", "NetworkDevice", "Devices.tsx");
}

function sliceBetween(data: { code: string; from: string; to: string }): string {
  const start: number = data.code.indexOf(data.from);
  const end: number = data.code.indexOf(data.to, start + 1);

  expect({ from: data.from, found: start > -1 }).toEqual({
    from: data.from,
    found: true,
  });
  expect({ to: data.to, after: end > start }).toEqual({
    to: data.to,
    after: true,
  });

  return data.code.slice(start, end);
}

/** One column's definition, from its title to the next column's title. */
function column(data: { from: string; to: string }): string {
  return sliceBetween({ code: devicesList(), from: data.from, to: data.to });
}

const MONITOR_BACKED_GUARD: string =
  "NetworkDeviceMonitoringMethodUtil.isMonitorBacked( item.monitoringMethod, )";

describe("the device list does not describe a monitor-backed device as broken", () => {
  test("the Probe column branches before rendering the shared element", () => {
    const probeColumn: string = column({
      from: 'title: "Probe", type: FieldType.Entity',
      to: 'title: "Interfaces (Up / Down)"',
    });

    /*
     * The branch must come BEFORE <ProbeElement>, whose null path is the
     * bold "No probe found." that the reporter screenshotted.
     */
    const guardAt: number = probeColumn.indexOf(MONITOR_BACKED_GUARD);
    const elementAt: number = probeColumn.indexOf("<ProbeElement");

    expect(guardAt).toBeGreaterThan(-1);
    expect(elementAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(elementAt);
  });

  test("the Probe column says the device is not polled, rather than that a probe is missing", () => {
    const probeColumn: string = column({
      from: 'title: "Probe", type: FieldType.Entity',
      to: 'title: "Interfaces (Up / Down)"',
    });

    expect(probeColumn).toContain("Not polled");
  });

  test("the Interfaces column branches on the monitoring method", () => {
    const interfacesColumn: string = column({
      from: 'title: "Interfaces (Up / Down)"',
      to: 'title: "Last Seen"',
    });

    /*
     * Interface counts are written by the SNMP walk and nothing else, so on a
     * monitor-backed device "0 / 0" is not zero interfaces — it is never
     * collected, which is a different claim.
     */
    expect(interfacesColumn).toContain(MONITOR_BACKED_GUARD);
  });

  test("the Last Seen column branches on the monitoring method", () => {
    const lastSeenColumn: string = column({
      from: 'title: "Last Seen"',
      to: 'title: "Labels"',
    });

    /*
     * `lastSeenAt` only moves on a successful SNMP walk, so on a
     * monitor-backed device it is NULL for life. "Never" contradicts the
     * status pill beside it.
     */
    expect(lastSeenColumn).toContain(MONITOR_BACKED_GUARD);
  });

  test("Last Seen still says Never for an SNMP device that has genuinely never answered", () => {
    const lastSeenColumn: string = column({
      from: 'title: "Last Seen"',
      to: 'title: "Labels"',
    });

    /*
     * The fix must not swallow a real negative: an SNMP device with a probe
     * assigned that has never once been reached SHOULD read "Never", because
     * for that device it is both true and actionable.
     */
    expect(lastSeenColumn).toContain("Never");
    expect(lastSeenColumn).toContain("!item.lastSeenAt &&");
  });

  test("the shared Probe element is left alone", () => {
    /*
     * Eight unrelated call sites (Monitor settings, Alerts, Incidents, two
     * AdminDashboard pages) rely on "No probe found." as a genuine negative,
     * and Common/Tests/UI/Components/Probe.test.tsx asserts its null path. The
     * branch belongs in the column, not the component.
     */
    const probeElement: string = stripComments(
      fs.readFileSync(
        path.join(
          DASHBOARD_SRC,
          "..",
          "..",
          "..",
          "..",
          "Common",
          "UI",
          "Components",
          "Probe",
          "Probe.tsx",
        ),
        "utf8",
      ),
    ).replace(/\s+/g, " ");

    expect(probeElement).toContain("No probe found.");
  });

  test("the list's own description no longer says every device is polled by a probe", () => {
    const code: string = devicesList();

    const cardDescription: string = sliceBetween({
      code: code,
      from: 'title: "Network Devices"',
      to: "showViewIdButton",
    });

    expect(cardDescription).toContain("monitor");
    expect(cardDescription).not.toContain(
      "Devices are polled by the probe you assign.",
    );
  });
});

describe("the device's own pages stop contradicting its status", () => {
  test("the monitors card takes the monitoring method", () => {
    const card: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceMonitorsCard.tsx",
    );

    expect(card).toContain("isMonitorBacked?: boolean | undefined");
  });

  test("the empty state no longer claims a monitor-backed device is polled by a probe", () => {
    const card: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceMonitorsCard.tsx",
    );

    /*
     * "The device is still polled and inventoried by its assigned probe" is
     * false for the very devices most likely to see that empty state, and it
     * is the sentence that sends operators looking for a probe.
     */
    const emptyState: string = sliceBetween({
      code: card,
      from: "props.monitors.length === 0",
      to: "Create Ping Monitor",
    });

    expect(emptyState).toContain("props.isMonitorBacked");
    expect(emptyState).toContain("Pending");
  });

  test("both pages that render the card pass the method through", () => {
    for (const page of ["Index.tsx", "Monitors.tsx"]) {
      const source: string = readCode(
        "Pages",
        "NetworkDevice",
        "View",
        page,
      );

      expect(source).toContain("getDeviceMonitorContext");
      expect(source).toContain("isMonitorBacked={isMonitorBacked}");
    }
  });

  test("the monitor lookup returns the bound monitor, not only step-referencing watchers", () => {
    const util: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceMonitorLookupUtil.ts",
    );

    /*
     * A bound Ping monitor is not of type NetworkDevice and its steps say
     * nothing about the device, so the project-wide Network Device query can
     * never find it. Without this the card said "no monitors" about a device
     * whose green pill that monitor had just produced.
     */
    expect(util).toContain("getDeviceBinding");
    expect(util).toContain("monitoringMethod: true");
    expect(util).toContain("boundMonitor");
  });
});
