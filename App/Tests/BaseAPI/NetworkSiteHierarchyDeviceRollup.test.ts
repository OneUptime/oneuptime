import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3320 — the parts of /network-site/children's device rollup that
 * live in a `select`, a query or the order of two statements, and so cannot
 * be reached by testing the pure aggregator alone.
 *
 * Each assertion here corresponds to a way the rollup can be quietly wrong
 * rather than loudly broken: a column that stops being selected turns every
 * monitor-backed device "unknown"; resolving the health before the statuses
 * are fetched does the same thing without changing a single visible count
 * to zero. Those are the failures that ship.
 *
 * Sources are whitespace-squashed first, so prettier re-wrapping a line
 * cannot turn a real regression check into a red herring.
 */

const API_SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "BaseAPI",
  "API",
  "NetworkSiteHierarchy.ts",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

const RAW: string = fs.readFileSync(API_SOURCE_PATH, "utf8");
const SOURCE: string = squash(RAW);
const CODE: string = squash(
  RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " "),
);

describe("the device query carries everything the classifier reads", () => {
  /*
   * DeviceHealthStateUtil reads exactly these. A column dropped from this
   * select does not fail — it silently reclassifies part of the fleet, and
   * the level above goes quiet about an outage.
   */
  const REQUIRED_COLUMNS: Array<string> = [
    "siteId: true",
    "isReachable: true",
    "lastPolledAt: true",
    "lastSeenAt: true",
    "pollingIntervalInMinutes: true",
    "currentMonitorStatusId: true",
    "interfacesDown: true",
  ];

  for (const column of REQUIRED_COLUMNS) {
    test(`selects ${column.replace(": true", "")}`, () => {
      expect(CODE).toContain(column);
    });
  }

  /*
   * Archived devices are hidden from every list but keep collecting
   * telemetry. Counting them would put a permanent red badge on a site
   * whose only sin is that somebody retired a switch.
   */
  test("never counts archived devices", () => {
    expect(CODE).toContain(
      squash("siteId: QueryHelper.notNull(), isArchived: false,"),
    );
  });
});

describe("statuses are resolved before health is", () => {
  /*
   * A monitor-backed device has no SNMP walk at all. If its stamped status
   * row is not among the ones fetched, the classifier falls through to
   * reachability, finds nothing, and tallies it "unknown" — so the whole
   * monitor-backed half of a fleet disappears from the health counts while
   * every number on screen still looks plausible.
   */
  test("device-stamped status ids join the batch status fetch", () => {
    expect(CODE).toContain(
      squash(
        "for (const device of deviceRows) { if (device.currentMonitorStatusId) { statusIds.add(device.currentMonitorStatusId.toString()); } }",
      ),
    );
  });

  /*
   * Order matters and is invisible: reading statusById before it is filled
   * yields undefined for every device, which is a legal value meaning "no
   * monitor" rather than an error.
   */
  test("the health pass runs after the status map is built", () => {
    const statusFetchAt: number = CODE.indexOf(
      "const statusById: StatusMap = await fetchStatusesByIds(",
    );
    const healthPassAt: number = CODE.indexOf(
      "const deviceAttachments: Array<DeviceAttachmentRow> = deviceRows",
    );
    expect(statusFetchAt).toBeGreaterThan(-1);
    expect(healthPassAt).toBeGreaterThan(-1);
    expect(statusFetchAt).toBeLessThan(healthPassAt);
  });

  /*
   * One clock for the whole response. Calling the classifier with a fresh
   * `new Date()` per device would let two devices on the same page be judged
   * against different "now"s — rare, but the resulting disagreement between
   * a card and the map you drill into is impossible to reproduce.
   */
  test("every device is judged against one clock", () => {
    expect(CODE).toContain(
      squash("const now: Date = OneUptimeDate.getCurrentDate();"),
    );
    expect(CODE).toContain(
      squash("interfacesDown: device.interfacesDown, }, now,"),
    );
  });

  test("the classifier is the shared one, not a copy written here", () => {
    expect(CODE).toContain(
      squash('} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";'),
    );
    expect(CODE).toContain("deviceHealthState(");
  });
});

describe("the response answers the questions the explorer asks", () => {
  test("every child row carries its subtree's device health", () => {
    expect(CODE).toContain(squash("deviceStats: aggregate.deviceStats,"));
  });

  /*
   * Devices on the level the reader is STANDING on belong to no child's
   * subtree. Without this they are counted nowhere and drawn nowhere — a
   * distribution centre's own core switches simply vanish.
   */
  test("the level's own devices are tallied separately", () => {
    expect(CODE).toContain(squash("ownDeviceStats: ownDeviceStats,"));
    expect(CODE).toContain("NetworkSiteHierarchyUtil.tallyDeviceHealth(");
  });

  /*
   * The explorer reads attachedDeviceCount to decide whether a hierarchy is
   * worth showing at all, and unattachedDeviceCount to say what it is NOT
   * showing. Both have to be on the wire or the fallback silently stops
   * working.
   */
  test("the project's device scope is reported", () => {
    expect(CODE).toContain(
      squash(
        "deviceScope: { attachedDeviceCount: deviceAttachments.length, unattachedDeviceCount: unattachedDeviceCount, },",
      ),
    );
  });

  test("unattached devices are counted, not listed", () => {
    expect(CODE).toContain(
      squash(
        "await NetworkDeviceService.countBy({ query: { projectId: projectId, siteId: QueryHelper.isNull(), isArchived: false, },",
      ),
    );
  });

  /*
   * A device with no site belongs to no level. Carrying it into the
   * aggregator with an empty site id would bucket it under whichever child
   * happened to have that key.
   */
  test("devices with no site are dropped before aggregation", () => {
    expect(CODE).toContain(squash("if (!deviceSiteId) { return null; }"));
  });

  /*
   * A cap hit means the rollups below this level are partial. The explorer
   * shows a note for it, so the flag has to keep reflecting BOTH caps.
   */
  test("truncation still covers the device cap as well as the site one", () => {
    expect(CODE).toContain(
      squash(
        "descendantCountsTruncated: subtreeRows.length >= LIMIT_PER_PROJECT || deviceRows.length >= LIMIT_PER_PROJECT,",
      ),
    );
  });
});

describe("the endpoint documents the rollup it now does", () => {
  test("the device select explains why it grew", () => {
    expect(SOURCE).toContain("Issue #3320");
  });
});
