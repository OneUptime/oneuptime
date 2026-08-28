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
  test("child rows select materializedPath", () => {
    /*
     * A window attached to a Region covers its Units. The path is the only
     * place a child's ancestry is available without one query per child.
     */
    expect(apiSource).toContain(squash("materializedPath: true,"));
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
      squash(`SiteUptimeUtil.calculateUptimePercent(
        uptimeRows!,
        windowStart,
        windowEnd,
        childMaintenanceWindows,
      )`),
    );
  });

  test("the daily figure is measured over 24 hours, not the 30-day window", () => {
    expect(apiSource).toContain(
      squash("const dailyWindowStart: Date = OneUptimeDate.getSomeDaysAgo(1);"),
    );
    expect(apiSource).toContain(
      squash(`SiteUptimeUtil.calculateUptimePercent(
        uptimeRows!,
        dailyWindowStart,
        windowEnd,
        childMaintenanceWindows,
      )`),
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
      squash("const uptimePercent: number | null = hasUptimeRows"),
    );
    expect(apiSource).toContain(
      squash("const dailyUptimePercent: number | null = hasUptimeRows"),
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
