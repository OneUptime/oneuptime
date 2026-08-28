import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3431, dashboard side. These are React components with no pure
 * logic left to extract — the defects pinned below live in a select, a
 * prop, or a constant — and the App suite runs in a plain Node environment
 * with no renderer. So, exactly as NetworkSitePageInvariants.test.ts does,
 * these read the sources and assert the expressions.
 *
 * Every assertion corresponds to a way the feature can be quietly wrong:
 *
 *   - a hero that forgets `materializedPath` silently stops honouring any
 *     window attached to a Region, and still renders a plausible number;
 *   - a daily figure computed over the 30-day window renders two tiles with
 *     the same value, which reads as a working feature;
 *   - a maintenance badge that is not rendered leaves a red site card
 *     indistinguishable from a real outage, which is the whole complaint.
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

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

describe("SiteStatusHero shows a daily figure beside the 30-day one", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteStatusHero.tsx",
  );

  test("asks the API for materializedPath so ancestor windows can be found", () => {
    expect(source).toContain(squash("materializedPath: true,"));
    expect(source).toContain(
      squash("materializedPath: site?.materializedPath,"),
    );
  });

  test("both uptime figures are passed the resolved windows", () => {
    expect(source).toContain(
      squash(`uptimePercent = SiteUptimeUtil.calculateUptimePercent(
          rows,
          windowStart,
          windowEnd,
          maintenanceWindows,
        );`),
    );
    expect(source).toContain(
      squash(`dailyUptimePercent = SiteUptimeUtil.calculateUptimePercent(
          rows,
          OneUptimeDate.getSomeDaysAgo(DAILY_UPTIME_WINDOW_DAYS),
          windowEnd,
          maintenanceWindows,
        );`),
    );
  });

  test("the daily window is one day, not thirty", () => {
    expect(source).toContain(
      squash("const DAILY_UPTIME_WINDOW_DAYS: number = 1;"),
    );
    expect(source).toContain(squash("const UPTIME_WINDOW_DAYS: number = 30;"));
  });

  test("a failed maintenance lookup degrades to no windows, not to no hero", () => {
    /*
     * The strip is supplementary. Losing the uptime tiles because the
     * maintenance query 403'd would be a worse regression than showing
     * numbers that have not discounted a window.
     */
    expect(source).toContain(
      squash(`} catch {
        maintenanceWindows = [];
      }`),
    );
  });

  test("renders a 24-hour tile", () => {
    expect(source).toContain(squash('data-testid="site-hero-daily-uptime"'));
    expect(source).toContain(
      squash("{formatUptimePercent(data.dailyUptimePercent)}"),
    );
  });

  test("renders an in-maintenance badge without suppressing the health chip", () => {
    /*
     * The chip must keep reading Offline during planned work — someone
     * looking at the page needs to know the site is off right now.
     */
    expect(source).toContain(squash("{data.isUnderMaintenance && ("));
    expect(source).toContain("In maintenance");
    expect(source).toContain(
      squash("{data.site.currentMonitorStatus.name}").replace(
        "{data.site.currentMonitorStatus.name}",
        "text={data.site.currentMonitorStatus.name}",
      ),
    );
  });

  test("the grid has a column for every tile it renders", () => {
    /*
     * Seven tiles in a six-column grid wraps one of them onto its own row
     * on wide screens, which reads as a rendering bug.
     */
    const tileCount: number = (
      source.match(/className="text-sm font-medium text-gray-500"/g) || []
    ).length;
    expect(tileCount).toBe(7);
    expect(source).toContain("xl:grid-cols-7");
    expect(source).toContain(squash("{[0, 1, 2, 3, 4, 5, 6].map("));
  });
});

describe("the Status Timeline page adds a daily view", () => {
  const source: string = readSource(
    "Pages",
    "NetworkSite",
    "View",
    "StatusTimeline.tsx",
  );

  test("measures a 24-hour window alongside 7 / 30 / 90", () => {
    expect(source).toContain(
      squash("const UPTIME_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30, 90];"),
    );
  });

  test("fetches timeline rows over the longest window any figure needs", () => {
    /*
     * The strip is 30 days and the widest card is 90. Fetching only 30 would
     * make the 90-day figure read 100% for the two months it cannot see.
     */
    expect(source).toContain(
      squash(`const longestWindowInDays: number = Math.max(
        ...UPTIME_WINDOWS_IN_DAYS,
        DAILY_STRIP_DAYS,
      );`),
    );
  });

  test("every window and the strip exclude maintenance", () => {
    expect(source).toContain(
      squash(`computed[days] = SiteUptimeUtil.calculateUptimePercent(
          rows,
          OneUptimeDate.getSomeDaysAgo(days),
          windowEnd,
          maintenanceWindows,
        );`),
    );
    expect(source).toContain(
      squash(`SiteUptimeUtil.calculateDailyUptime({
          rows: rows,
          days: DAILY_STRIP_DAYS,
          endDate: windowEnd,
          maintenanceWindows: maintenanceWindows,
        })`),
    );
  });

  test("renders the strip", () => {
    expect(source).toContain(
      squash("<SiteDailyUptimeStrip entries={dailyEntries} />"),
    );
  });

  test("a 4-wide grid, matching the four windows", () => {
    expect(source).toContain("xl:grid-cols-4");
  });
});

describe("SiteCard distinguishes planned work from an outage", () => {
  const source: string = readSource(
    "Components",
    "NetworkSite",
    "SiteCard.tsx",
  );

  test("labels the 30-day figure so the daily one beside it is unambiguous", () => {
    expect(source).toContain("30d uptime");
  });

  test("shows the daily figure only when there is rollup history", () => {
    expect(source).toContain(squash("{site.dailyUptimePercent !== null && ("));
  });

  test("shows a maintenance chip next to the status chip", () => {
    expect(source).toContain(squash("{site.isUnderMaintenance && ("));
    expect(source).toContain("Maintenance");
  });
});

describe("the site's own Scheduled Maintenance page is wired end to end", () => {
  test("the route, the side menu and the breadcrumb all know the page", () => {
    /*
     * A page reachable by URL but absent from the menu is a page nobody
     * finds; one in the menu with no breadcrumb entry renders a blank
     * header.
     */
    const routes: string = readSource("Routes", "NetworkSiteRoutes.tsx");
    expect(routes).toContain("NetworkSiteViewScheduledMaintenance");
    expect(routes).toContain("PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE");

    const sideMenu: string = readSource(
      "Pages",
      "NetworkSite",
      "View",
      "SideMenu.tsx",
    );
    expect(sideMenu).toContain(
      "PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE",
    );
    expect(sideMenu).toContain(
      squash("networkSites: new Includes([props.modelId]),"),
    );

    const breadcrumbs: string = readSource(
      "Pages",
      "NetworkSite",
      "Utils",
      "Breadcrumbs.ts",
    );
    expect(breadcrumbs).toContain(
      "PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE",
    );
  });

  test("the page filters by the site's own attachment", () => {
    const page: string = readSource(
      "Pages",
      "NetworkSite",
      "View",
      "ScheduledMaintenance.tsx",
    );
    expect(page).toContain(
      squash("query.networkSites = new Includes([modelId]);"),
    );
  });
});

describe("Network Sites are attachable to a maintenance event", () => {
  test("the picker offers the type and does not try to select it by label", () => {
    /*
     * NetworkSite has no labels relation. Querying `{ labels: ... }` against
     * it is a guaranteed-failed request per label per expand — swallowed by
     * fetchByQuery, so it shows up as a slow, empty Labels tab rather than
     * as an error.
     */
    const picker: string = readSource(
      "Components",
      "AffectedResources",
      "AffectedResourcesPicker.tsx",
    );
    expect(picker).toContain(squash('label: "Network Site",'));
    expect(picker).toContain(squash("supportsLabels: false,"));
    expect(picker).toContain(
      squash("for (const type of labelSelectableTypes) {"),
    );
    expect(picker).not.toContain(
      squash(`for (const type of resourceTypes) {
        requests.push(
          fetchByQuery(
            type,
            { labels:`),
    );
  });

  test("both maintenance forms write the relation back", () => {
    /*
     * The picker's payload is split across relations by the FORM. A page
     * that renders the picker but does not map `networkSites` in its
     * onChange drops the user's selection silently on save.
     */
    for (const source of [
      readSource("Pages", "ScheduledMaintenanceEvents", "Create.tsx"),
      readSource("Pages", "ScheduledMaintenanceEvents", "View", "Index.tsx"),
    ]) {
      expect(source).toContain(squash("networkSites: payload.networkSites,"));
      expect(source).toContain(squash("field: { networkSites: true },"));
      expect(source).toContain(squash('"NetworkSite",'));
    }
  });

  test("the affected-resources facet is opt-in, because only maintenance has the relation", () => {
    const facet: string = readSource(
      "Components",
      "AffectedResources",
      "buildAffectedResourcesFacet.ts",
    );
    expect(facet).toContain(squash('networkSite: "networkSites",'));
    expect(facet).toContain(
      squash("includeNetworkSite?: boolean | undefined;"),
    );

    const table: string = readSource(
      "Components",
      "ScheduledMaintenance",
      "ScheduledMaintenanceTable.tsx",
    );
    expect(table).toContain(squash("includeNetworkSite: true,"));

    // Incidents and Alerts must NOT opt in — they have no networkSites column.
    const alerts: string = readSource("Components", "Alert", "AlertsTable.tsx");
    const incidents: string = readSource(
      "Components",
      "Incident",
      "IncidentsTable.tsx",
    );
    expect(alerts).not.toContain("includeNetworkSite");
    expect(incidents).not.toContain("includeNetworkSite");
  });
});
