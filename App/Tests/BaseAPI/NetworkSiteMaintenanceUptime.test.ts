import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3431 — the parts of /network-site/children's uptime that live in a
 * `select`, a query, or the ORDER of two statements, and so cannot be
 * reached by testing SiteUptimeUtil alone.
 *
 * Each assertion corresponds to a way the numbers can be quietly wrong
 * rather than loudly broken:
 *
 *   - dropping `materializedPath` from the child select silently un-covers
 *     every window attached to an ancestor, and every child still renders
 *     with a plausible number;
 *   - forgetting to pass the windows into calculateUptimePercent reports
 *     planned outages as real ones, which is the complaint that opened the
 *     issue;
 *   - computing the daily figure over the 30-day window is a one-character
 *     mistake that makes both tiles show the same value.
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

const apiSource: string = squash(fs.readFileSync(API_SOURCE_PATH, "utf8"));

describe("the children endpoint can resolve ancestor-attached maintenance", () => {
  test("the CHILD row select carries materializedPath", () => {
    /*
     * A window attached to a Region covers its Units. The path is the only
     * place a child's ancestry is available without one query per child.
     *
     * Pinned against the surrounding select rather than on its own: several
     * other queries in this file also select materializedPath, so a bare
     * `toContain("materializedPath: true,")` passes even after the child
     * select loses it — which is precisely the regression this test names.
     */
    expect(apiSource).toContain(
      squash(`currentMonitorStatusId: true,
                /*
                 * Needed to resolve which maintenance windows cover this
                 * child: a window attached to an ancestor covers it, and the
                 * path is the only place that ancestry is available here
                 * without another query per child.
                 */
                materializedPath: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },`),
    );
  });

  test("maintenance windows are fetched for the project, in the same batch", () => {
    expect(apiSource).toContain(
      squash("NetworkSiteMaintenanceSuppression.getMaintenanceEventWindows({"),
    );
    expect(apiSource).toContain(squash("windowStart: windowStart,"));
    expect(apiSource).toContain(squash("windowEnd: windowEnd,"));
  });

  test("coverage is resolved with the shared util, not re-derived here", () => {
    /*
     * The dashboard resolves coverage with the same function. Two
     * implementations of "which windows cover this site" is how the API and
     * the page start disagreeing about a site's uptime.
     */
    expect(apiSource).toContain(squash("SiteMaintenanceUtil.windowsBySite({"));
  });
});

describe("both uptime figures exclude maintenance", () => {
  test("the 30-day figure is passed the child's windows", () => {
    expect(apiSource).toContain(
      squash(`SiteUptimeUtil.measureUptime(
                    uptimeRows!,
                    windowStart,
                    windowEnd,
                    childMaintenanceWindows,
                  )`),
    );
  });

  test("the daily figure is measured over exactly 24 hours", () => {
    /*
     * A calendar day would span 23 or 25 hours when the clocks move and
     * disagree with the fixed-bucket strip on the site page.
     */
    expect(apiSource).toContain(
      squash(`const dailyWindowStart: Date = SiteUptimeUtil.trailingWindowStart(
            windowEnd,
            1,
          );`),
    );
    expect(apiSource).toContain(
      squash(`SiteUptimeUtil.measureUptime(
                    uptimeRows!,
                    dailyWindowStart,
                    windowEnd,
                    childMaintenanceWindows,
                  )`),
    );
  });

  test("a period with nothing left to measure goes out as null, not 100", () => {
    /*
     * A child whose whole 30 days sat inside a maintenance window has no
     * evidence either way. Sending 100 would draw a perfect card for a site
     * that was switched off all month.
     */
    expect(apiSource).toContain(
      squash(`const uptimePercent: number | null =
                monthly && monthly.measuredInMs > 0
                  ? monthly.uptimePercent
                  : null;`),
    );
    expect(apiSource).toContain(
      squash(`const dailyUptimePercent: number | null =
                daily && daily.measuredInMs > 0 ? daily.uptimePercent : null;`),
    );
  });

  test("a maintenance read failure degrades the numbers, it does not 500 the page", () => {
    /*
     * Maintenance is a CORRECTION to uptime, not a precondition for it. An
     * unhandled rejection here would take breadcrumbs, device counts and
     * links down with it.
     */
    expect(apiSource).toContain(
      squash("}).catch((error: Error): Array<MaintenanceEventWindow> => {"),
    );
  });

  test("both are null together when the site has no rollup history", () => {
    /*
     * A site nothing has ever rolled up is unmonitored, not perfect. If the
     * daily figure stopped sharing this gate it would report 100% for a
     * site the 30-day tile reports as "—".
     */
    expect(apiSource).toContain(
      squash("const hasUptimeRows: boolean = Boolean("),
    );
    expect(apiSource).toContain(
      squash("const monthly: SiteUptimeMeasurement | null = hasUptimeRows"),
    );
    expect(apiSource).toContain(
      squash("const daily: SiteUptimeMeasurement | null = hasUptimeRows"),
    );
  });
});

describe("the response carries what the card needs to distinguish planned work", () => {
  test("children report dailyUptimePercent and isUnderMaintenance", () => {
    expect(apiSource).toContain(
      squash(`dailyUptimePercent: dailyUptimePercent,
                isUnderMaintenance: isUnderMaintenance,`),
    );
  });

  test("the maintenance flag is evaluated at the window end, i.e. now", () => {
    expect(apiSource).toContain(
      squash(`SiteUptimeUtil.isUnderMaintenanceAt(
                  childMaintenanceWindows,
                  windowEnd,
                )`),
    );
  });
});

describe("the maintenance-windows endpoint is the single source", () => {
  /*
   * Added after review found the site pages reading ScheduledMaintenance
   * directly from the browser, which made a site's uptime depend on who was
   * looking at it: a viewer without that permission saw the un-discounted
   * number on the site page while the hierarchy card beside it, computed
   * here under root, showed the discounted one.
   */
  test("the endpoint exists and is user-authenticated", () => {
    expect(apiSource).toContain(
      squash(`router.post(
      "/network-site/maintenance-windows",
      UserMiddleware.getUserMiddleware,`),
    );
  });

  test("the SITE is read with the caller's props — that is the permission gate", () => {
    /*
     * The events are read as root (uptime must not vary by viewer), so the
     * only thing standing between a caller and another tenant's windows is
     * this read. If it ever switches to isRoot, the endpoint leaks.
     */
    expect(apiSource).toContain(
      squash(`const site: NetworkSite | null = await NetworkSiteService.findOneBy({
            query: {
              projectId: projectId,
              _id: rawSiteId,
            },
            select: {
              _id: true,
              materializedPath: true,
            },
            props: props,
          });`),
    );
    expect(apiSource).toContain(
      squash(`if (!site || !site._id) {
            throw new BadDataException("Network site not found");
          }`),
    );
  });

  test("it resolves coverage with the shared util, and returns intervals only", () => {
    /*
     * Only start/end cross the wire. Event titles, numbers and the other
     * resources they touch stay server-side — a caller who can read a site
     * has not thereby been granted the maintenance calendar.
     */
    expect(apiSource).toContain(
      squash("SiteMaintenanceUtil.windowsCoveringSite({"),
    );
    expect(apiSource).toContain(
      squash(`return {
                startsAt: window.startsAt,
                endsAt: window.endsAt,
              } as unknown as JSONObject;`),
    );
  });

  test("the window span is clamped, not taken from the caller verbatim", () => {
    expect(apiSource).toContain(
      squash(`NetworkSiteHierarchyUtil.clampUptimeWindowDays(
              body["windowInDays"],
            )`),
    );
  });
});
