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
];

/*
 * The Network Overview's fleet strip used to be in that list. It no longer
 * fetches devices at all — its tally is counted in Postgres and classified on
 * the server (App/FeatureSet/BaseAPI/API/NetworkSummary.ts) — so there is no
 * client-side select left to hold to the rule.
 *
 * The invariant did not go away with the fetch: something still has to feed
 * the shared rule every input it reads, and getting it wrong there is exactly
 * as silent as getting it wrong in a select. It has moved to the block below,
 * which holds the SERVER path to the same standard.
 */
const OVERVIEW_ENDPOINT: string = squash(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "BaseAPI",
      "API",
      "NetworkSummary.ts",
    ),
    "utf8",
  ),
);

const HEALTH_AGGREGATION: string = squash(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "Server",
      "Utils",
      "NetworkDevice",
      "DeviceHealthAggregation.ts",
    ),
    "utf8",
  ),
);

describe("the server-side fleet tally reads the whole rule too", () => {
  /*
   * The tally goes through the SAME util the pills go through, not a
   * reimplementation. A rule written twice is a rule that will disagree with
   * itself, and this is the one place where "the strip at the top of the page"
   * and "the pill one click away" could start describing different devices.
   */
  test("the tally goes through the shared reachability rule", () => {
    expect(OVERVIEW_ENDPOINT).toContain("DeviceReachabilityUtil.getStatus(");
    expect(OVERVIEW_ENDPOINT).toContain(
      'from "Common/Utils/NetworkDevice/DeviceReachabilityUtil"',
    );
  });

  /*
   * `monitoringMethod` is the column that sends a monitor-backed device down
   * the monitor branch. Grouped by SQL, and re-attached to the classifier
   * input here — because `deviceHealthInputForGroup` deliberately does not
   * emit it (the health classifier ignores it) and the reachability rule very
   * much does not. Without it every ping-only device is Pending in the strip
   * forever, which is issue #3392 all over again one level up.
   */
  test("the tally carries the monitoring method into the rule", () => {
    expect(OVERVIEW_ENDPOINT).toContain(
      squash("monitoringMethod: group.monitoringMethod,"),
    );
    expect(HEALTH_AGGREGATION).toContain(
      squash('expression: column("monitoringMethod"),'),
    );
  });

  /*
   * ...and the OFFLINE end of the status ladder, resolved from the bucket's
   * stamped status. Reading the operational end instead would count every
   * "Degraded" device as down while the map draws it green.
   */
  test("the tally reads the ladder at its offline end", () => {
    expect(OVERVIEW_ENDPOINT).toContain(
      squash(
        "monitorStatusIsOffline: status ? Boolean(status.isOfflineState) : undefined,",
      ),
    );
    expect(OVERVIEW_ENDPOINT).not.toContain("monitorStatusIsOperational");
  });

  /*
   * Every fact the rule reads has to be a GROUP BY key. One missing and
   * devices the rule would judge differently land in the same bucket, so one
   * of them silently inherits the other's verdict.
   */
  test("the buckets group by every input the rule reads", () => {
    for (const column of [
      "currentMonitorStatusId",
      "monitoringMethod",
      "isReachable",
      "lastPolledAt",
      "lastSeenAt",
      "interfacesDown",
    ]) {
      expect(HEALTH_AGGREGATION).toContain(column);
    }
  });
});

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
