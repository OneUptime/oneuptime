import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3320 — the parts of /network-site/children's device rollup that
 * live in a `select`, a query or the order of two statements, and so cannot
 * be reached by testing the pure aggregator alone.
 *
 * Each assertion here corresponds to a way the rollup can be quietly wrong
 * rather than loudly broken: a fact that stops being grouped on hands the
 * classifier a bucket it cannot tell apart from a different one; resolving
 * the health before the statuses are fetched turns every monitor-backed
 * device "unknown" without moving a single visible count to zero. Those are
 * the failures that ship.
 *
 * The rollup no longer reads device ROWS. It reads per-site health BUCKETS
 * out of one grouped aggregate, so the assertions that used to pin the paging
 * loop pin the shape that replaced it — carrying the reasons they were
 * written for across, because those reasons outlived the mechanism.
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

/*
 * The rollup's query does not live in the endpoint any more — the endpoint
 * asks NetworkDeviceService for buckets, and the filters that decide WHICH
 * devices are in them live in that service. Assertions about those filters
 * have to read it, or they assert nothing.
 */
const SERVICE_SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Services",
  "NetworkDeviceService.ts",
);

const AGGREGATION_SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "Server",
  "Utils",
  "NetworkDevice",
  "DeviceHealthAggregation.ts",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const RAW: string = fs.readFileSync(API_SOURCE_PATH, "utf8");
const SOURCE: string = squash(RAW);
const CODE: string = squash(stripComments(RAW));

const SERVICE_RAW: string = fs.readFileSync(SERVICE_SOURCE_PATH, "utf8");
const AGGREGATION: string = squash(
  stripComments(fs.readFileSync(AGGREGATION_SOURCE_PATH, "utf8")),
);

/*
 * Slices, so an assertion cannot pass on a line from somewhere else.
 *
 * The select assertions this file used to carry ran against the whole
 * 1,400-line endpoint, where "siteId: true" and "currentMonitorStatusId: true"
 * also appear in unrelated selects — so two of the seven would have passed
 * with the column deleted from the query they were supposed to be guarding. A
 * test that cannot fail for its own reason is worse than no test: it reports
 * coverage it does not have. Same hazard, same fix, in a file where
 * "isArchived: false" now appears in two different queries.
 */
function sliceBetween(
  source: string,
  fileName: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = source.indexOf(startMarker);
  const end: number = source.indexOf(endMarker, start + 1);
  if (start === -1 || end === -1) {
    throw new Error(
      `Could not slice ${fileName} between "${startMarker}" and "${endMarker}" — the shape of the file changed, so these assertions are no longer pointing at what they name.`,
    );
  }
  return source.slice(start, end);
}

/*
 * The endpoint's whole device read: no loop, and TWO branches.
 *
 * Drilling into one region scopes the aggregate to that subtree's site ids;
 * the root, and any subtree too large for an id list to be worth building,
 * aggregates the project. The two are supposed to be interchangeable — the
 * scoped set is a superset of what the level can draw from — which is exactly
 * why a rule that holds on one branch and not the other is invisible: the
 * broken half only runs once you have drilled in, and the root level anyone
 * checks first stays correct. So the rules below are asserted on BOTH.
 */
const DEVICE_AGGREGATE: string = squash(
  sliceBetween(
    RAW,
    "NetworkSiteHierarchy.ts",
    "async function fetchDeviceHealthBySite(",
    "export default class NetworkSiteHierarchyAPI",
  ),
);

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// The two service methods it calls, where the WHICH-devices filters live.
const HEALTH_GROUPS: string = squash(
  stripComments(
    sliceBetween(
      SERVICE_RAW,
      "NetworkDeviceService.ts",
      "public async getHealthGroups(data: {",
      "public async getHealthGroupsForSites(",
    ),
  ),
);

const HEALTH_GROUPS_FOR_SITES: string = squash(
  stripComments(
    sliceBetween(
      SERVICE_RAW,
      "NetworkDeviceService.ts",
      "public async getHealthGroupsForSites(data: {",
      "private async assertSiteBelongsToProject(",
    ),
  ),
);

describe("the rollup reads buckets, not device rows", () => {
  /*
   * Both slices have to be the right ones. If a marker ever matched something
   * else the assertions below would go quietly vacuous, so pin a string only
   * the thing under test contains.
   */
  test("the slices under test really are the aggregate and its service calls", () => {
    expect(DEVICE_AGGREGATE).toContain(
      "NetworkDeviceService.getHealthGroups({",
    );
    expect(DEVICE_AGGREGATE).toContain(
      "NetworkDeviceService.getHealthGroupsForSites({",
    );
    expect(DEVICE_AGGREGATE).toContain("Promise<Array<DeviceHealthGroup>>");
    expect(HEALTH_GROUPS).toContain("this.aggregateBy({");
    expect(HEALTH_GROUPS_FOR_SITES).toContain("this.aggregateBy({");
    // Not the same slice twice: one filters by site ids, the other does not.
    expect(HEALTH_GROUPS_FOR_SITES).toContain(
      "siteId: QueryHelper.any(data.siteIds),",
    );
    expect(HEALTH_GROUPS).not.toContain("data.siteIds");
  });

  /*
   * There is no paging loop left, and there must not be a new one.
   *
   * The loop it replaced was honest — it fetched every device rather than the
   * first 10,000 — and that honesty cost eight-plus sequential queries whose
   * OFFSET grew with every page, plus tens of thousands of hydrated model
   * objects per drill-down. A reader who "fixes" a future counting bug by
   * walking the rows again would get the same numbers back and nothing on the
   * wire would change, which is exactly why it is pinned here rather than
   * left to review.
   */
  test("no page walk over devices survives in the endpoint", () => {
    expect(CODE).not.toContain("DEVICE_ROLLUP_PAGE_SIZE");
    expect(CODE).not.toContain("MAX_ROLLUP_DEVICES");
    expect(CODE).not.toContain("deviceFetch");
    expect(DEVICE_AGGREGATE).not.toContain("for (;;)");
    expect(DEVICE_AGGREGATE).not.toContain("skip +=");
    expect(DEVICE_AGGREGATE).not.toContain("NetworkDeviceService.findBy(");
  });

  /*
   * The 200,000-device ceiling is DELETED, not moved.
   *
   * It existed because a walk has to stop somewhere, and everything past it
   * was a rollup that quietly described part of an estate. A grouped
   * aggregate returns a handful of rows per site whatever the fleet's size,
   * so there is no cap to hit and nothing to confess — which is why the
   * device half of the truncation flag is gone too (see below). The old
   * assertions about the ceiling's arithmetic went with it: there is no
   * ceiling to get the arithmetic of wrong.
   */
  test("there is no device ceiling left to hit", () => {
    expect(CODE).not.toContain("200000");
    expect(CODE).not.toContain("isTruncated: true");
    expect(CODE).not.toContain("deviceFetch.isTruncated");
  });

  /*
   * The tenant scoping travels with the aggregate. A grouped read over every
   * device row in the database, run without the caller's props, is a data
   * leak rather than a crash — nothing else in the response would notice, and
   * the numbers would simply be a little too large.
   */
  test("the aggregate is permission-scoped, on both branches", () => {
    expect(occurrences(DEVICE_AGGREGATE, "props: data.props,")).toBe(2);
    expect(HEALTH_GROUPS).toContain("props: data.props,");
    expect(HEALTH_GROUPS_FOR_SITES).toContain("props: data.props,");
  });

  /*
   * Archived devices are hidden from every list but keep their siteId and
   * keep collecting telemetry. Counting them would put a permanent red badge
   * on a site whose only sin is that somebody retired a switch — and the
   * drill-down under that badge would show zero devices, because the list
   * query does exclude them.
   *
   * A device attached to no site belongs to no level, and would otherwise
   * arrive as a bucket with a null site id for the endpoint to guess at. The
   * project-wide branch says so explicitly; the scoped branch gets it from
   * naming its sites, since a device with no site matches no id.
   */
  test("archived devices and devices with no site are never in a bucket", () => {
    expect(DEVICE_AGGREGATE).toContain("onlyAttachedToSite: true,");
    expect(DEVICE_AGGREGATE).toContain("siteIds: data.scopedSiteIds,");
    expect(HEALTH_GROUPS).toContain("isArchived: false,");
    expect(HEALTH_GROUPS_FOR_SITES).toContain("isArchived: false,");
    expect(HEALTH_GROUPS).toContain(
      squash(
        "if (data.onlyAttachedToSite) { query.siteId = QueryHelper.notNull(); }",
      ),
    );
  });

  /*
   * The per-site breakdown, which is the entire point of both calls.
   *
   * Without `groupBySite` the aggregate selects no site column at all: every
   * bucket parses back with `siteId: null`, the endpoint's own no-site filter
   * throws the whole fleet away, and every child reports zero devices. The
   * response still looks well-formed — and `attachedDeviceCount` lands on 0,
   * which is precisely the value the topology explorer reads to decide the
   * hierarchy is not worth showing at all.
   *
   * It defaults to OFF on the scoped call, because the site rollup engine
   * shares that method and wants one verdict for a whole subtree. So the
   * drill-down has to ask for it, on the branch a root-level check never
   * reaches.
   */
  test("the buckets are grouped per site, on both branches", () => {
    expect(occurrences(DEVICE_AGGREGATE, "groupBySite: true,")).toBe(2);
    // ...and the flag actually selects the site column, in both methods.
    const groupByTernary: string = squash(
      "groupBy: data.groupBySite ? DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE : DEVICE_HEALTH_GROUP_COLUMNS,",
    );
    expect(HEALTH_GROUPS).toContain(groupByTernary);
    expect(HEALTH_GROUPS_FOR_SITES).toContain(groupByTernary);
    expect(AGGREGATION).toContain(
      squash(
        '{ expression: column("siteId"), alias: DeviceHealthGroupAlias.SiteId },',
      ),
    );
  });

  /*
   * Scoping must never narrow the ANSWER, only the scan.
   *
   * Two ways it silently could. An id list built from the subtree query alone
   * would leave out the drilled site itself, and that site's own devices — a
   * distribution centre's core switches, which belong to no child's subtree
   * and are tallied separately into ownDeviceStats — would simply stop being
   * counted, while every child card stayed right. And an empty list must fall
   * through to the whole project rather than being handed to the scoped call,
   * which answers an empty id set with no rows at all: that is the root level,
   * where the hierarchy opens.
   */
  test("the scoped branch covers the drilled site and its whole subtree", () => {
    expect(CODE).toContain(
      squash(
        "const scopedSiteIds: Array<ObjectID> = siteId ? [ new ObjectID(siteId), ...subtreeRows",
      ),
    );
    // ...and the root, with no site drilled, names no sites at all.
    expect(CODE).toContain(
      squash(
        "return new ObjectID(row._id!.toString()); }), ] : []; const deviceGroups: Array<DeviceHealthGroup> = await fetchDeviceHealthBySite({",
      ),
    );
    expect(CODE).toContain(squash("scopedSiteIds: scopedSiteIds,"));
  });

  test("an empty scope aggregates the project rather than nothing", () => {
    expect(DEVICE_AGGREGATE).toContain(
      squash(
        "if ( data.scopedSiteIds.length > 0 && data.scopedSiteIds.length <= MAX_SCOPED_ROLLUP_SITES ) {",
      ),
    );
  });
});

/*
 * One clock, and the database and the classifier both read it.
 *
 * Staleness is the one fact in a bucket that is not already discrete, so it
 * is decided in SQL against a bound "now" and then reproduced in TypeScript
 * from timestamps placed relative to the same instant. Both halves therefore
 * have to be handed the SAME Date — a second clock anywhere on this path
 * makes two devices on one response answerable to two different "now"s, and
 * the resulting disagreement between a card and the map you drill into is
 * impossible to reproduce from the outside.
 */
describe("every bucket is judged against one clock, taken first", () => {
  const CLOCK: string = "const now: Date = OneUptimeDate.getCurrentDate();";
  const FETCH: string = "await fetchDeviceHealthBySite({";
  const HEALTH_PASS: string =
    "const deviceAttachments: Array<DeviceAttachmentRow> = deviceGroups";

  test("there is one clock, and it is the repo's clock", () => {
    expect(CODE).toContain(squash(CLOCK));
    /*
     * A raw `new Date()` sidesteps OneUptimeDate entirely, and it is how a
     * per-bucket clock would most naturally get written.
     */
    expect(CODE).not.toContain("new Date()");
  });

  /*
   * Ordering, and it is invisible: `now` is an ARGUMENT to the fetch, so a
   * clock declared after it does not compile — but a clock declared later,
   * with the fetch given one of its own, does. Both halves would still run;
   * the numbers would simply be measured against instants that drift apart
   * under load, and the drift grows with exactly the fleet size this whole
   * change exists to handle.
   */
  test("the clock is taken before the fetch, and the fetch before the classification", () => {
    const clockAt: number = CODE.indexOf(squash(CLOCK));
    const fetchAt: number = CODE.indexOf(squash(FETCH));
    const healthPassAt: number = CODE.indexOf(squash(HEALTH_PASS));
    expect(clockAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(healthPassAt).toBeGreaterThan(-1);
    expect(clockAt).toBeLessThan(fetchAt);
    expect(fetchAt).toBeLessThan(healthPassAt);
  });

  /*
   * The same instant reaches the SQL predicate and the classifier. The
   * database groups by "was this device last contacted before now minus its
   * own window"; `deviceHealthInputForGroup` then places a synthetic
   * timestamp on the correct side of that same window. Feed the two different
   * instants and a bucket can be grouped stale and read fresh.
   */
  test("that clock is what the aggregate binds and what the classifier reads", () => {
    // Both branches bind the caller's instant, not the database's NOW().
    expect(occurrences(DEVICE_AGGREGATE, "now: data.now,")).toBe(2);
    expect(CODE).toContain(squash("props: props, now: now, });"));
    expect(CODE).toContain(squash("now: now, }), now, ),"));
  });
});

describe("statuses are resolved before health is", () => {
  /*
   * A monitor-backed device has no SNMP walk at all. If its stamped status
   * row is not among the ones fetched, the classifier falls through to
   * reachability, finds nothing, and tallies it "unknown" — so the whole
   * monitor-backed half of a fleet disappears from the health counts while
   * every number on screen still looks plausible.
   *
   * The bucket carries the id as a string (it came out of an aggregate row,
   * not a model), so there is no ObjectID to stringify here.
   */
  test("device-stamped status ids join the batch status fetch", () => {
    expect(CODE).toContain(
      squash(
        "for (const group of deviceGroups) { if (group.monitorStatusId) { statusIds.add(group.monitorStatusId); } }",
      ),
    );
  });

  /*
   * Order matters and is invisible: reading statusById before it is filled
   * yields undefined for every bucket, which is a legal value meaning "no
   * monitor" rather than an error.
   */
  test("the health pass runs after the status map is built", () => {
    const statusFetchAt: number = CODE.indexOf(
      "const statusById: StatusMap = await fetchStatusesByIds(",
    );
    const healthPassAt: number = CODE.indexOf(
      "const deviceAttachments: Array<DeviceAttachmentRow> = deviceGroups",
    );
    expect(statusFetchAt).toBeGreaterThan(-1);
    expect(healthPassAt).toBeGreaterThan(-1);
    expect(statusFetchAt).toBeLessThan(healthPassAt);
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
    expect(CODE).toContain("deviceHealthInputForGroup({");
  });

  /*
   * And the endpoint decides NOTHING about health itself.
   *
   * A grouped aggregate is a standing invitation to write the rule a second
   * time — `CASE WHEN "isReachable" = false THEN 'down' ...` in the SQL, or
   * an if-chain over the bucket's flags here, either of which would be
   * shorter than the round trip through deviceHealthInputForGroup. Both would
   * also be a second implementation of a rule whose entire purpose is having
   * one: the day either copy is edited, the site card and the topology map it
   * opens start describing different networks.
   *
   * So the endpoint must not so much as name the facts the rule reads. Every
   * one of these identifiers appearing here would mean a verdict is being
   * reached outside DeviceHealthStateUtil.
   */
  test("no reachability rule is rewritten inside the endpoint", () => {
    for (const fact of [
      "isReachable",
      "lastPolledAt",
      "lastSeenAt",
      "interfacesDown",
      "pollingIntervalInMinutes",
      "NetworkDeviceReachability",
    ]) {
      expect(CODE).not.toContain(fact);
    }
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
        "deviceScope: { attachedDeviceCount: attachedDeviceCount, unattachedDeviceCount: unattachedDeviceCount, },",
      ),
    );
  });

  /*
   * The most likely silent regression on this field, and it has changed shape
   * twice — so both wrong answers are pinned out.
   *
   * `deviceScope` describes the PROJECT: the explorer reads it to decide
   * whether a hierarchy is worth opening at all. The buckets do not answer
   * that question any more, because they are scoped to the subtree in view —
   * summing them would report "devices under THIS level", and drilling into
   * an empty branch of a fully-populated estate would drop the reader onto
   * the flat map. And `deviceAttachments.length` — the shape this field had
   * when a row meant a device — would be worse still: a row is a BUCKET, so
   * it returns the number of distinct (site, facts) combinations. Measured
   * against the seeded fleet that is 4,131, standing for 76,800 site-attached
   * devices. A plausible-looking number on a field nobody cross-checks.
   *
   * So both halves are counted in the database, over the whole project.
   */
  test("the device scope is counted over the project, not derived from buckets", () => {
    expect(CODE).toContain(
      squash(
        "const [attachedDeviceCount, unattachedDeviceCount]: [number, number] = await Promise.all([",
      ),
    );
    expect(CODE).toContain(
      squash(
        "NetworkDeviceService.countBy({ query: { projectId: projectId, siteId: QueryHelper.notNull(), isArchived: false, },",
      ),
    );
    expect(CODE).toContain(
      squash(
        "NetworkDeviceService.countBy({ query: { projectId: projectId, siteId: QueryHelper.isNull(), isArchived: false, },",
      ),
    );
    expect(CODE).not.toContain("deviceAttachments.length");
    expect(CODE).not.toContain(
      "attachedDeviceCount: number = deviceAttachments",
    );
  });

  /*
   * And neither count is capped. `countBy` applies `limit` as a `.take()` on
   * the counted set, so a limit here caps the ANSWER rather than the work: a
   * project with fifty thousand unattached devices would be told ten thousand
   * of them are missing from the hierarchy. Both calls pass `skip` and no
   * `limit`, which defaults to Infinity.
   */
  test("neither scope count is capped by a limit", () => {
    const SCOPE: string = squash(
      sliceBetween(
        stripComments(RAW),
        "NetworkSiteHierarchy.ts",
        "const [attachedDeviceCount, unattachedDeviceCount]",
        "return Response.sendJsonObjectResponse(",
      ),
    );
    expect(occurrences(SCOPE, "NetworkDeviceService.countBy({")).toBe(2);
    expect(occurrences(SCOPE, "skip: 0,")).toBe(2);
    expect(SCOPE).not.toContain("limit:");
  });

  /*
   * A bucket with no site belongs to no level — a site deleted out from under
   * its devices, or one the caller cannot read. Carrying it into the
   * aggregator with an empty site id would bucket it under whichever child
   * happened to have that key.
   */
  test("buckets with no site are dropped before aggregation", () => {
    expect(CODE).toContain(squash("if (!group.siteId) { return null; }"));
  });

  /*
   * A cap hit means the rollups below this level are partial, and the
   * explorer shows a note for it. The SITE half of that flag is still real:
   * a project with more than LIMIT_PER_PROJECT sites gets a subtree query
   * that stops early, and the child a missing row belonged under would
   * under-report its descendants with nothing to say so.
   *
   * The DEVICE half is gone because the cap it reported is gone — the health
   * counts come from a grouped aggregate over the whole fleet and are exact
   * at any size. Leaving it in would be worse than useless: a flag that is
   * never true trains the reader to ignore a warning that still matters for
   * sites.
   */
  test("truncation still covers the site fetch, and only that", () => {
    expect(CODE).toContain(
      squash(
        "descendantCountsTruncated: subtreeRows.length >= LIMIT_PER_PROJECT,",
      ),
    );
    expect(CODE.split("descendantCountsTruncated:").length - 1).toBe(1);
    expect(CODE).toContain(
      squash("childrenTruncated: childRows.length >= LIMIT_PER_PROJECT,"),
    );
  });
});

/*
 * The heir of this file's old "the device query carries everything the
 * classifier reads" block.
 *
 * That block guarded a `select`: a column dropped from it did not fail, it
 * silently reclassified part of the fleet and the level above went quiet
 * about an outage. The select is gone, but the hazard moved rather than
 * disappearing — it is now the GROUP BY. A fact the classifier reads and the
 * grouping does not is a fact two different devices can disagree on inside
 * one bucket, and the bucket gets one verdict for all of them. Eighty
 * thousand devices, one arbitrary representative each, and every count on
 * the page still adds up.
 */
describe("the buckets carry every fact the classifier reads", () => {
  const DISCRIMINATORS: string = squash(
    sliceBetween(
      AGGREGATION,
      "DeviceHealthAggregation.ts",
      "const DEVICE_HEALTH_DISCRIMINATOR_COLUMNS",
      "export const DEVICE_COUNT_AGGREGATE",
    ),
  );

  test("the slice under test really is the discriminator list", () => {
    expect(DISCRIMINATORS).toContain("Array<AggregateColumn> = [");
    expect(DISCRIMINATORS).toContain(
      "DeviceHealthGroupAlias.HasDownInterfaces",
    );
  });

  /*
   * DeviceHealthStateUtil reads the stamped status, reachability, the two
   * contact timestamps (through DeviceReachabilityUtil) and the dark-port
   * count. DeviceReachabilityUtil additionally reads the monitoring method —
   * drop that one and every ping-only device in the estate reports Pending
   * for ever.
   */
  for (const fact of [
    'column("currentMonitorStatusId")',
    'column("monitoringMethod")',
    'column("isReachable")',
    'column("lastPolledAt")',
    'column("lastSeenAt")',
    'column("interfacesDown")',
  ]) {
    test(`groups by ${fact} — in the discriminator list itself`, () => {
      expect(DISCRIMINATORS).toContain(fact);
    });
  }

  /*
   * The sixth fact, staleness, is the only one that is not already discrete:
   * the window is per-device, derived from that device's own interval. So the
   * grouping carries the VERDICT rather than the column, computed from the
   * same three constants DeviceReachabilityUtil derives its window from —
   * which is what keeps "a long time" from having two definitions.
   */
  test("staleness is grouped as a verdict, off the device's own interval", () => {
    expect(DISCRIMINATORS).toContain("STALE_WINDOW_IN_MINUTES_SQL");
    expect(AGGREGATION).toContain('column("pollingIntervalInMinutes")');
    expect(AGGREGATION).toContain("DEVICE_MISSED_POLL_ALLOWANCE");
    expect(AGGREGATION).toContain("DEVICE_MIN_STALE_WINDOW_IN_MINUTES");
    expect(AGGREGATION).toContain("DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES");
  });

  /*
   * And the count rides along, or a bucket standing for four hundred devices
   * would be worth one.
   */
  test("each bucket carries how many devices are in it", () => {
    expect(AGGREGATION).toContain(
      squash(
        'expression: "COUNT(*)", alias: DeviceHealthGroupAlias.DeviceCount,',
      ),
    );
    expect(CODE).toContain(squash("deviceCount: group.deviceCount,"));
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
    stripComments(fs.readFileSync(MAP_SOURCE_PATH, "utf8")),
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
   * and so for most of an 80,000-device estate — has to go through the same
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
  /*
   * The ceiling survives as prose and nowhere else. That is the only record
   * a future reader has that 200,000 was DELETED rather than moved somewhere
   * they should go looking for it — and the pair of assertions is what keeps
   * the comment describing the code rather than the code it replaced.
   */
  test("the aggregate explains what it replaced, and only explains it", () => {
    expect(SOURCE).toContain("#3320");
    expect(SOURCE).toContain("200,000-row ceiling");
    expect(CODE).not.toContain("200,000");
    expect(CODE).not.toContain("200000");
  });
});
