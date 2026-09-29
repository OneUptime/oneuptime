import SiteMaintenanceUtil, {
  MaintenanceEventWindow,
} from "../../../Utils/NetworkSite/SiteMaintenanceUtil";
import { SiteMaintenanceWindow } from "../../../Utils/NetworkSite/SiteUptimeUtil";

/*
 * Coverage inheritance for scheduled maintenance on network sites
 * (issue #3431).
 *
 * The rule this pins, in both directions:
 *
 *   DOWN  — a window on a Region covers every Market and Unit under it.
 *           Without this a regional cutover means naming four hundred
 *           stores, and any store added after scheduling is missed.
 *
 *   NOT UP — a window on one Unit does NOT put its Region under
 *            maintenance. The region is still expected to be up, and a
 *            genuine failure in a different unit during the same hours
 *            must still count against it.
 */

const REGION_ID: string = "region-1";
const MARKET_ID: string = "market-1";
const UNIT_ID: string = "unit-1";
const OTHER_UNIT_ID: string = "unit-2";

const UNIT_PATH: string = `/${REGION_ID}/${MARKET_ID}/${UNIT_ID}/`;
const MARKET_PATH: string = `/${REGION_ID}/${MARKET_ID}/`;
const REGION_PATH: string = `/${REGION_ID}/`;

const STARTS_AT: Date = new Date("2026-08-01T00:00:00Z");
const ENDS_AT: Date = new Date("2026-08-01T04:00:00Z");

function event(
  siteIds: Array<string>,
  startsAt: Date = STARTS_AT,
  endsAt: Date | null = ENDS_AT,
): MaintenanceEventWindow {
  return { startsAt, endsAt, siteIds };
}

describe("SiteMaintenanceUtil.windowsCoveringSite", () => {
  it("covers a site attached directly", () => {
    const windows: Array<SiteMaintenanceWindow> =
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: UNIT_PATH,
        events: [event([UNIT_ID])],
      });

    expect(windows).toHaveLength(1);
    expect(windows[0]!.startsAt).toBe(STARTS_AT);
    expect(windows[0]!.endsAt).toBe(ENDS_AT);
  });

  it("covers a site through an ancestor several levels up", () => {
    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: UNIT_PATH,
        events: [event([REGION_ID])],
      }),
    ).toHaveLength(1);
  });

  it("does NOT cover an ancestor from a window on one of its descendants", () => {
    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: REGION_ID,
        materializedPath: REGION_PATH,
        events: [event([UNIT_ID])],
      }),
    ).toEqual([]);

    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: MARKET_ID,
        materializedPath: MARKET_PATH,
        events: [event([UNIT_ID])],
      }),
    ).toEqual([]);
  });

  it("does not cover a sibling", () => {
    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: OTHER_UNIT_ID,
        materializedPath: `/${REGION_ID}/${MARKET_ID}/${OTHER_UNIT_ID}/`,
        events: [event([UNIT_ID])],
      }),
    ).toEqual([]);
  });

  it("still matches a direct attachment when the site has no path yet", () => {
    /*
     * A site mid-way through hierarchy repair, or one created before path
     * maintenance ran. Its own id is checked on its own rather than trusted
     * to appear in the path.
     */
    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: null,
        events: [event([UNIT_ID])],
      }),
    ).toHaveLength(1);

    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: undefined,
        events: [event([REGION_ID])],
      }),
    ).toEqual([]);
  });

  it("returns every covering window, including overlapping ones", () => {
    const windows: Array<SiteMaintenanceWindow> =
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: UNIT_PATH,
        events: [
          event([REGION_ID]),
          event([UNIT_ID], new Date("2026-08-01T02:00:00Z"), null),
          event([OTHER_UNIT_ID]),
        ],
      });

    expect(windows).toHaveLength(2);
    expect(windows[1]!.endsAt).toBeNull();
  });

  it("matches an event listing several sites when any one of them covers", () => {
    expect(
      SiteMaintenanceUtil.windowsCoveringSite({
        siteId: UNIT_ID,
        materializedPath: UNIT_PATH,
        events: [event([OTHER_UNIT_ID, MARKET_ID])],
      }),
    ).toHaveLength(1);
  });
});

describe("SiteMaintenanceUtil.windowsBySite", () => {
  it("keys results by site and records an empty array for uncovered sites", () => {
    /*
     * "Resolved, nothing covers it" has to be distinguishable from "never
     * looked" — the hierarchy API reads this map per child, and a missing
     * key would silently become 'no maintenance' for a site that was never
     * resolved at all.
     */
    const bySite: Map<
      string,
      Array<SiteMaintenanceWindow>
    > = SiteMaintenanceUtil.windowsBySite({
      sites: [
        { id: UNIT_ID, materializedPath: UNIT_PATH },
        {
          id: OTHER_UNIT_ID,
          materializedPath: `/${REGION_ID}/${OTHER_UNIT_ID}/`,
        },
      ],
      events: [event([UNIT_ID])],
    });

    expect(bySite.get(UNIT_ID)).toHaveLength(1);
    expect(bySite.get(OTHER_UNIT_ID)).toEqual([]);
    expect(bySite.has(OTHER_UNIT_ID)).toBe(true);
  });

  it("covers every site under one attached ancestor in a single pass", () => {
    const bySite: Map<
      string,
      Array<SiteMaintenanceWindow>
    > = SiteMaintenanceUtil.windowsBySite({
      sites: [
        { id: MARKET_ID, materializedPath: MARKET_PATH },
        { id: UNIT_ID, materializedPath: UNIT_PATH },
        { id: REGION_ID, materializedPath: REGION_PATH },
      ],
      events: [event([REGION_ID])],
    });

    expect(bySite.get(REGION_ID)).toHaveLength(1);
    expect(bySite.get(MARKET_ID)).toHaveLength(1);
    expect(bySite.get(UNIT_ID)).toHaveLength(1);
  });
});
