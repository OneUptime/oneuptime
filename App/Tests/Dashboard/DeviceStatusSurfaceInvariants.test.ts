import { describe, expect, test } from "@jest/globals";
import { DEVICE_STATUS_SELECT } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import fs from "fs";
import path from "path";

/*
 * Every screen that prints a NetworkDevice's status, held to one rule.
 *
 * Issue #3392 was not a wrong rule, it was a partial one applied unevenly.
 * A monitor-backed device — a phone, a camera, an access point, anything
 * that cannot be walked over SNMP — is judged by the Monitor bound to it,
 * and the poll columns that decide every other device are NULL on its row
 * forever. A surface that selects only those columns therefore renders
 * "Pending" for it no matter what its monitor says, and does so silently:
 * the code compiles, the pill draws, and the answer is simply wrong.
 *
 * The shared rule (DeviceReachabilityUtil, via DeviceStatusUtil) now knows
 * about both kinds of device, and DEVICE_STATUS_SELECT names every column
 * it reads. What is left to enforce is that the surfaces actually go
 * through the pair — which is wiring, and the App suite runs in a plain
 * Node environment with no renderer, so it is asserted against the sources
 * the way NetworkSitePageInvariants and SummaryTileFilteringInvariants are.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line
 * cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readRawSource(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(readRawSource(...relativeParts));
}

/**
 * The object literal the DEVICE_STATUS_SELECT spread sits inside — i.e. the
 * device select itself, and nothing else in the file.
 *
 * Position alone is not enough to tell one select from another here: a
 * NetworkSite has a `currentMonitorStatus` of its own (its rollup), and the
 * Network Overview page selects devices and sites side by side. So the
 * enclosing literal is found by brace matching from the spread outwards,
 * and every assertion about "the device select" is made against that slice.
 */
function deviceSelectLiteral(...relativeParts: Array<string>): string {
  const source: string = readRawSource(...relativeParts);
  const spreadAt: number = source.indexOf("...DEVICE_STATUS_SELECT");

  expect(spreadAt).toBeGreaterThanOrEqual(0);

  let start: number = -1;
  let depth: number = 0;

  for (let index: number = spreadAt; index >= 0; index--) {
    const character: string = source[index]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
        break;
      }
      depth--;
    }
  }

  expect(start).toBeGreaterThanOrEqual(0);

  depth = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return squash(source.substring(start, index + 1));
      }
    }
  }

  throw new Error("The device select literal is not brace-balanced.");
}

/*
 * The surfaces that turn a NetworkDevice row into an up/down verdict. Each
 * fetches its own devices, so each has to ask for the columns the rule
 * reads; none of them can borrow another's select.
 */
const DEVICE_STATUS_SURFACES: Array<{ name: string; parts: Array<string> }> = [
  {
    name: "the device list",
    parts: ["Pages", "NetworkDevice", "Devices.tsx"],
  },
  {
    name: "the device Overview hero",
    parts: ["Components", "NetworkDevice", "DeviceStatusHero.tsx"],
  },
  {
    name: "a site's Devices tab",
    parts: ["Pages", "NetworkSite", "View", "Devices.tsx"],
  },
  {
    name: "the site status hero",
    parts: ["Components", "NetworkSite", "SiteStatusHero.tsx"],
  },
  {
    name: "the Network Overview fleet strip",
    parts: ["Pages", "NetworkDevice", "Overview.tsx"],
  },
];

describe("every device-status surface selects the whole rule", () => {
  test.each(DEVICE_STATUS_SURFACES)(
    "$name spreads DEVICE_STATUS_SELECT",
    ({ parts }: { parts: Array<string> }) => {
      const source: string = readSource(...parts);

      expect(source).toContain(squash("...DEVICE_STATUS_SELECT,"));
    },
  );

  /*
   * Spreading it is not enough on its own. A key repeated after a spread
   * REPLACES what the spread put there, so an explicit `currentMonitorStatus:
   * { name, color }` — which is all a "Monitor Status" tile needs to print —
   * silently drops `isOfflineState`, the single field the verdict turns on.
   * That is a one-line edit away at any time, it leaves the page compiling
   * and rendering, and nothing else in the repo would go red for it. The
   * device Overview hero had exactly that shape before this fix.
   */
  test.each(DEVICE_STATUS_SURFACES)(
    "$name does not narrow currentMonitorStatus back down",
    ({ parts }: { parts: Array<string> }) => {
      const select: string = deviceSelectLiteral(...parts);

      if (select.includes("currentMonitorStatus:")) {
        expect(select).toContain("isOfflineState: true");
      }
    },
  );

  /*
   * The same trap for the poll half: a repeated `isReachable` or
   * `monitoringMethod` after the spread could quietly turn either off.
   */
  test.each(DEVICE_STATUS_SURFACES)(
    "$name does not override the columns the spread provides",
    ({ parts }: { parts: Array<string> }) => {
      const select: string = deviceSelectLiteral(...parts);

      expect(select).not.toContain("isReachable: false");
      expect(select).not.toContain("monitoringMethod: false");
    },
  );

  /*
   * The regression in one assertion: the select the surfaces share has to
   * carry the monitor columns, not just the poll ones. Without these two a
   * correctly bound ping-only device reads "Pending" on every screen above.
   */
  test("the shared select carries both halves of the rule", () => {
    expect(DEVICE_STATUS_SELECT.isReachable).toBe(true);
    expect(DEVICE_STATUS_SELECT.monitoringMethod).toBe(true);
    expect(DEVICE_STATUS_SELECT.currentMonitorStatus.isOfflineState).toBe(true);
  });
});

/*
 * Wording, not verdicts. The two kinds of device reach the same three
 * pills by different routes, and a tooltip that talks about an SNMP poll
 * on a device nothing polls sends its operator to check a probe that does
 * not exist — which is how a real ping outage gets read as a
 * misconfiguration and ignored.
 */
describe("the pills explain the verdict they actually reached", () => {
  const MONITOR_BACKED_SURFACES: Array<{ name: string; parts: Array<string> }> =
    [
      {
        name: "a site's Devices tab",
        parts: ["Pages", "NetworkSite", "View", "Devices.tsx"],
      },
      {
        name: "the device Overview hero",
        parts: ["Components", "NetworkDevice", "DeviceStatusHero.tsx"],
      },
    ];

  test.each(MONITOR_BACKED_SURFACES)(
    "$name branches its tooltips on isMonitorBacked",
    ({ parts }: { parts: Array<string> }) => {
      const source: string = readSource(...parts);

      expect(source).toContain("isMonitorBacked");
      expect(source).toContain("The monitor bound to this device reports it");
    },
  );

  /*
   * The device list is the surface in the issue's screenshot, and it says
   * more than Up/Down: it prints the operator's own status word for a
   * monitor-backed device ("Operational", "Degraded"), which is why it
   * reads the stamped status by name rather than through the shared rule.
   */
  test("the device list renders a monitor-backed device's status by name", () => {
    const source: string = readSource("Pages", "NetworkDevice", "Devices.tsx");

    expect(source).toContain(
      squash(
        "NetworkDeviceMonitoringMethodUtil.isMonitorBacked( item.monitoringMethod,",
      ),
    );
    expect(source).toContain("item.currentMonitorStatus.name");
  });
});
