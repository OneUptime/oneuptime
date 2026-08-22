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

/*
 * Just the body of fetchAttachedDevicesForRollup.
 *
 * The select assertions below USED to run against the whole 1,400-line
 * file, where "siteId: true" and "currentMonitorStatusId: true" also appear
 * in unrelated selects — so two of the seven would have passed with the
 * column deleted from the query they are supposed to be guarding. A test
 * that cannot fail for its own reason is worse than no test: it reports
 * coverage it does not have.
 */
function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = source.indexOf(startMarker);
  const end: number = source.indexOf(endMarker, start + 1);
  if (start === -1 || end === -1) {
    throw new Error(
      `Could not slice NetworkSiteHierarchy.ts between "${startMarker}" and "${endMarker}" — the shape of the file changed, so these assertions are no longer pointing at what they name.`,
    );
  }
  return source.slice(start, end);
}

const DEVICE_FETCH: string = squash(
  sliceBetween(
    RAW,
    "async function fetchAttachedDevicesForRollup(",
    "export default class NetworkSiteHierarchyAPI",
  ),
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
    test(`selects ${column.replace(": true", "")} — in the device query itself`, () => {
      expect(DEVICE_FETCH).toContain(column);
    });
  }

  /*
   * The slice has to be the right one. If the marker ever matched something
   * else the assertions above would go quietly vacuous, so pin a string that
   * only the device fetch contains.
   */
  test("the slice under test really is the device fetch", () => {
    expect(DEVICE_FETCH).toContain("NetworkDeviceService.findBy(");
    expect(DEVICE_FETCH).toContain("limit: DEVICE_ROLLUP_PAGE_SIZE");
  });

  /*
   * Archived devices are hidden from every list but keep collecting
   * telemetry. Counting them would put a permanent red badge on a site
   * whose only sin is that somebody retired a switch.
   */
  test("never counts archived devices", () => {
    expect(DEVICE_FETCH).toContain(
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
        "for (const device of deviceFetch.devices) { if (device.currentMonitorStatusId) { statusIds.add(device.currentMonitorStatusId.toString()); } }",
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
      "const deviceAttachments: Array<DeviceAttachmentRow> = deviceFetch.devices",
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

  /*
   * The rule the whole shared classifier exists to keep: MonitorStatus is a
   * ladder, and the map reads its OFFLINE end. An earlier revision passed
   * the operational end, which counted every "Degraded" device as down on
   * the card while the map drew it green.
   */
  test("the ladder is read at the offline end, as the map reads it", () => {
    expect(CODE).toContain(
      squash(
        "monitorStatusIsOffline: deviceStatus ? deviceStatus.isOfflineState : undefined,",
      ),
    );
    expect(CODE).not.toContain("monitorStatusIsOperational");
  });

  test("isOfflineState is actually selected, or the rule above reads undefined", () => {
    expect(CODE).toContain(squash("isOfflineState: true,"));
    expect(CODE).toContain(
      squash("isOfflineState: Boolean(status.isOfflineState),"),
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
  test("truncation still covers the device fetch as well as the site one", () => {
    expect(CODE).toContain(
      squash(
        "descendantCountsTruncated: subtreeRows.length >= LIMIT_PER_PROJECT || deviceFetch.isTruncated,",
      ),
    );
  });
});

/*
 * The device rollup fetch pages now, because one findBy caps at 10,000 and
 * issue #3320 describes 21,713 devices. The loop cannot be imported (it
 * closes over the service layer), so its ARITHMETIC is restated here against
 * a fake page source and the source text is pinned to the same shape. What
 * is really being defended is the reason it exists: a rollup that stops at
 * 10,000 reports a store as healthy because the only down device in it fell
 * outside the page, and the "Needs attention" filter then hides that store
 * completely.
 */
describe("the paginated device fetch", () => {
  const PAGE_SIZE: number = 10000;
  const CEILING: number = 200000;

  interface FakePage {
    devices: Array<number>;
    isTruncated: boolean;
  }

  // The loop under test, restated. Keep in step with the source assertions below.
  function pagedFetch(totalRows: number): FakePage {
    const devices: Array<number> = [];
    let skip: number = 0;
    let queries: number = 0;
    for (;;) {
      queries++;
      const remaining: number = Math.max(0, totalRows - skip);
      const pageLength: number = Math.min(remaining, PAGE_SIZE);
      for (let i: number = 0; i < pageLength; i++) {
        devices.push(skip + i);
      }
      if (pageLength < PAGE_SIZE) {
        return { devices: devices, isTruncated: false };
      }
      skip += pageLength;
      if (skip >= CEILING) {
        return { devices: devices, isTruncated: true };
      }
      if (queries > 100) {
        throw new Error("pagination did not terminate");
      }
    }
  }

  test("an estate smaller than one page is one query and not truncated", () => {
    const result: FakePage = pagedFetch(1200);
    expect(result.devices).toHaveLength(1200);
    expect(result.isTruncated).toBe(false);
  });

  /*
   * The scenario from the issue. Before pagination this returned 10,000 of
   * 21,713 devices and silently under-reported every level above them.
   */
  test("21,713 devices all arrive, across three pages", () => {
    const result: FakePage = pagedFetch(21713);
    expect(result.devices).toHaveLength(21713);
    expect(result.isTruncated).toBe(false);
  });

  test("no device is fetched twice or skipped", () => {
    const result: FakePage = pagedFetch(21713);
    expect(new Set<number>(result.devices).size).toBe(result.devices.length);
    expect(result.devices[0]).toBe(0);
    expect(result.devices[result.devices.length - 1]).toBe(21712);
  });

  /*
   * A full last page does not prove there is another one. The loop must ask
   * again rather than assuming, or an estate of exactly 10,000 would report
   * itself truncated for ever.
   */
  test("an exact multiple of the page size is complete, not truncated", () => {
    for (const total of [PAGE_SIZE, PAGE_SIZE * 2]) {
      const result: FakePage = pagedFetch(total);
      expect(result.devices).toHaveLength(total);
      expect(result.isTruncated).toBe(false);
    }
  });

  test("an empty estate terminates immediately", () => {
    const result: FakePage = pagedFetch(0);
    expect(result.devices).toHaveLength(0);
    expect(result.isTruncated).toBe(false);
  });

  /*
   * The ceiling is a backstop against an unbounded scan, and hitting it is
   * reported rather than hidden — the level then shows its "rollups may be
   * partial" note instead of quietly under-counting.
   */
  test("a pathological estate stops at the ceiling and SAYS it truncated", () => {
    const result: FakePage = pagedFetch(CEILING + 5000);
    expect(result.devices).toHaveLength(CEILING);
    expect(result.isTruncated).toBe(true);
  });

  /*
   * The offset actually reaches the query.
   *
   * Every other assertion in this block passes with `skip: 0` hard-coded:
   * the loop still runs, still counts, still terminates at the ceiling. It
   * would just fetch page one twenty times over — twenty identical copies of
   * the first 10,000 devices, every site's counts inflated twentyfold, the
   * rest of the estate missing, and `isTruncated` set so the whole thing
   * looks deliberate. That is a worse lie than the cap this replaced.
   */
  test("each page is asked for at the accumulated offset", () => {
    expect(DEVICE_FETCH).toContain(
      squash("limit: DEVICE_ROLLUP_PAGE_SIZE, skip: skip,"),
    );
  });

  test("a loop that ignored the offset would be caught by duplicate ids", () => {
    // The broken variant, so the assertion above has a demonstrated failure.
    function fixedOffsetFetch(totalRows: number): Array<number> {
      const devices: Array<number> = [];
      let skip: number = 0;
      for (;;) {
        const pageLength: number = Math.min(totalRows, PAGE_SIZE);
        for (let i: number = 0; i < pageLength; i++) {
          devices.push(i); // always page one
        }
        if (pageLength < PAGE_SIZE) {
          return devices;
        }
        skip += pageLength;
        if (skip >= CEILING) {
          return devices;
        }
      }
    }
    const broken: Array<number> = fixedOffsetFetch(21713);
    expect(new Set<number>(broken).size).toBeLessThan(broken.length);
    // ...whereas the real shape yields no duplicates at all.
    expect(new Set<number>(pagedFetch(21713).devices).size).toBe(21713);
  });

  /*
   * Pages ACCUMULATE. `devices = page` would keep only the last one — for
   * 21,713 devices that is the final 1,713 rows, so every level reports
   * health for the tail of the estate and zeroes for the rest, and
   * attachedDeviceCount drops far enough to change what the root renders.
   */
  test("pages accumulate rather than replace", () => {
    expect(DEVICE_FETCH).toContain(squash("devices.push(...page);"));
    expect(pagedFetch(10001).devices).toHaveLength(10001);
    expect(pagedFetch(10001).devices[0]).toBe(0);
  });

  test("there are exactly two ways out of the loop", () => {
    expect(DEVICE_FETCH.split("return {").length - 1).toBe(2);
  });

  /*
   * The tenant scoping travels with every page. Dropping `props` from a
   * query that walks every device in the database is a data leak, not a
   * crash, so nothing else would notice.
   */
  test("every page is permission-scoped and re-applies its filters", () => {
    expect(DEVICE_FETCH).toContain(squash("props: props,"));
    expect(DEVICE_FETCH).toContain(
      squash(
        "query: { projectId: projectId, siteId: QueryHelper.notNull(), isArchived: false, },",
      ),
    );
  });

  /*
   * The ceiling test above asserts an exact length, which is only true
   * because the ceiling is a whole number of pages. If either constant moves
   * to a non-multiple the loop overshoots by up to one page and that
   * assertion silently starts testing something else.
   */
  test("the ceiling is a whole number of pages", () => {
    expect(CEILING % PAGE_SIZE).toBe(0);
    expect(pagedFetch(CEILING + 5000).devices.length % PAGE_SIZE).toBe(0);
  });

  test("the source implements this shape, not a single capped query", () => {
    expect(DEVICE_FETCH).toContain(squash("let skip: number = 0;"));
    expect(DEVICE_FETCH).toContain(squash("for (;;) {"));
    expect(DEVICE_FETCH).toContain(
      squash(
        "if (page.length < DEVICE_ROLLUP_PAGE_SIZE) { return { devices: devices, isTruncated: false }; }",
      ),
    );
    expect(DEVICE_FETCH).toContain(squash("skip += page.length;"));
    expect(DEVICE_FETCH).toContain(
      squash(
        "if (skip >= MAX_ROLLUP_DEVICES) { return { devices: devices, isTruncated: true }; }",
      ),
    );
  });

  /*
   * Stable paging. Without an ordered key the database may return rows in a
   * different order per page, which both duplicates and skips devices while
   * the estate is being edited underneath the walk.
   */
  test("pages are ordered by a key that never changes", () => {
    expect(DEVICE_FETCH).toContain(
      squash("sort: { _id: SortOrder.Ascending, },"),
    );
  });

  test("the page size and ceiling are the ones this suite reasons about", () => {
    expect(CODE).toContain(
      squash(`const DEVICE_ROLLUP_PAGE_SIZE: number = LIMIT_PER_PROJECT;`),
    );
    expect(CODE).toContain(
      squash(`const MAX_ROLLUP_DEVICES: number = ${CEILING};`),
    );
  });
});

/*
 * The claim the shared classifier is FOR: a device cannot read one way on a
 * site card and another way on the map that card opens.
 *
 * DeviceHealthStateUtil.test.ts pins the rollup's side of that agreement
 * against a hand-copied restatement of the map's rule. A hand copy only
 * defends one direction — flip the MAP to the operational end (the same
 * mistake this change had to fix on the rollup side) and every test in the
 * repo stays green while the two halves diverge again. So the map's own
 * source is read here and pinned to the rule the rollup was written to
 * match.
 */
describe("the two halves of the product cannot disagree", () => {
  const MAP_SOURCE_PATH: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "BaseAPI",
    "API",
    "NetworkDeviceTopology.ts",
  );
  const MAP: string = squash(
    fs
      .readFileSync(MAP_SOURCE_PATH, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " "),
  );

  test("the map still resolves the status ladder at its offline end", () => {
    expect(MAP).toContain(
      squash(
        'nodeStatusByMonitorStatusId.set( status._id.toString(), status.isOfflineState ? "down" : "up", );',
      ),
    );
  });

  test("the map still selects the column that rule reads", () => {
    expect(MAP).toContain(squash("isOfflineState: true,"));
  });

  test("neither half has been switched to the operational end", () => {
    expect(MAP).not.toContain(
      squash('status.isOperationalState ? "up" : "down"'),
    );
    expect(CODE).not.toContain("monitorStatusIsOperational");
  });

  /*
   * The site rollup is the OTHER consumer of these rows and it legitimately
   * reads the operational end — a unit counts as operational only when its
   * status says so. The two must not be conflated: rebuilt from
   * !isOfflineState, every Degraded store would count as operational and a
   * region of sixty-three degraded stores would card as "63 of 63
   * operational".
   */
  test("the SITE rollup still reads the operational end, separately", () => {
    expect(CODE).toContain(
      squash(
        "for (const status of statusById.values()) { if (status.isOperationalState) { operationalStatusIds.add(status.id); } }",
      ),
    );
  });

  test("the child's wire status still reports the operational flag", () => {
    expect(CODE).toContain(
      squash("isOperationalState: status.isOperationalState,"),
    );
  });

  /*
   * The no-monitor path — the ordinary case for every SNMP-walked switch,
   * and so for most of a 21,713-device estate — has to go through the same
   * shared reachability rule the map uses, not a freshness comparison
   * written by hand.
   */
  test("the unstamped path defers to the shared reachability rule", () => {
    const UTIL: string = squash(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Utils",
          "NetworkDevice",
          "DeviceHealthStateUtil.ts",
        ),
        "utf8",
      ),
    );
    expect(UTIL).toContain("DeviceReachabilityUtil.getStatus(");
    expect(UTIL).toContain("NetworkDeviceReachability.Pending");
    // The map's own fallback goes through the same util.
    const TOPOLOGY_UTIL: string = squash(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Utils",
          "Monitor",
          "NetworkTopologyUtil.ts",
        ),
        "utf8",
      ),
    );
    expect(TOPOLOGY_UTIL).toContain("DeviceReachabilityUtil.getStatus(");
  });
});

describe("the endpoint documents the rollup it now does", () => {
  test("the device select explains why it grew", () => {
    expect(SOURCE).toContain("Issue #3320");
  });
});
