import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import EnterpriseLicenseUsageSnapshot from "Common/Types/EnterpriseLicense/EnterpriseLicenseUsageSnapshot";
import {
  EnterpriseLicenseUsageMinimumRefreshDelayInMilliseconds,
  EnterpriseLicenseUsageRefreshIntervalInMilliseconds,
  getEnterpriseLicenseInstanceActivityState,
  getEnterpriseLicenseUsageBoundaryRefreshDelay,
  isEnterpriseLicenseUsageRequestCurrent,
} from "../../FeatureSet/AdminDashboard/src/Components/EnterpriseLicense/LicenseActivityUtil";

/*
 * The Admin Dashboard package has no React render harness, so this suite pins
 * the table/component wiring against comment-stripped source just like the
 * other AdminDashboard regression suites. The time-boundary and accounting
 * behavior behind the shared predicate are covered by Common unit/API tests.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const viewSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(
      ADMIN_DASHBOARD_SRC,
      "Pages/EnterpriseLicenses/View/Index.tsx",
    ),
    "utf8",
  ),
);

const licenseUtilSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(
      ADMIN_DASHBOARD_SRC,
      "Components/EnterpriseLicense/LicenseUtil.tsx",
    ),
    "utf8",
  ),
);

const licenseActivityUtilSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(
      ADMIN_DASHBOARD_SRC,
      "Components/EnterpriseLicense/LicenseActivityUtil.ts",
    ),
    "utf8",
  ),
);

const instanceTableSource: string = (
  viewSource.split('id="enterprise-license-instances-table"')[1] || ""
).split("<ModelDelete")[0] as string;

const usageCardSource: string = (
  viewSource.split(
    'title={t("pages.enterpriseLicenseView.usageCardTitle")}',
  )[1] || ""
).split("<ModelTable")[0] as string;

describe("Admin Dashboard > Enterprise License instance activity", () => {
  test("shows an explicit status for every instance", () => {
    expect(instanceTableSource).toContain('title: "Status"');
    expect(instanceTableSource).toContain(
      "<EnterpriseLicenseInstanceStatusPill",
    );
    expect(instanceTableSource).toContain("instance={item}");
  });

  test("renders both Active and Inactive states", () => {
    expect(licenseUtilSource).toContain('text="Active"');
    expect(licenseUtilSource).toContain('text="Inactive"');
  });

  test("derives the badge from the same predicate used for seat counting", () => {
    expect(licenseActivityUtilSource).toContain(
      "EnterpriseLicenseUsageUtil.isInstanceCountedTowardsUsage",
    );
    expect(licenseActivityUtilSource).not.toContain("instance.isActive");
    expect(licenseActivityUtilSource).not.toMatch(/7\s*\*\s*24\s*\*\s*60/);
  });

  test("uses one server-side snapshot for both status and seat count", () => {
    expect(viewSource).toContain("/enterprise-license/${modelId}/active-usage");
    expect(usageCardSource).toContain("usageSnapshot?.currentUserCount");
    expect(usageCardSource).not.toContain("license.currentUserCount");
    expect(instanceTableSource).toContain(
      "usageSnapshot.activeInstanceIds.includes",
    );
  });

  test("refreshes the usage snapshot whenever the instance table fetches", () => {
    expect(instanceTableSource).toContain("onFetchSuccess={async () => {");
    expect(instanceTableSource).toContain("await refreshUsageSnapshot()");
  });

  test("polls while the page remains open", () => {
    expect(EnterpriseLicenseUsageRefreshIntervalInMilliseconds).toBe(60_000);
    expect(viewSource).toContain("setInterval(");
    expect(viewSource).toContain(
      "EnterpriseLicenseUsageRefreshIntervalInMilliseconds",
    );
    expect(instanceTableSource).toContain(
      "refreshToggle={instanceTableRefreshCounter.toString()}",
    );
    expect(viewSource).toContain("setInstanceTableRefreshCounter");
  });

  test("prevents an older overlapping response from replacing newer state", () => {
    expect(viewSource).toContain("usageSnapshotRequestIdRef");
    expect(isEnterpriseLicenseUsageRequestCurrent(1, 2)).toBe(false);
    expect(isEnterpriseLicenseUsageRequestCurrent(2, 2)).toBe(true);

    const requestGuardUses: Array<string> | null = viewSource.match(
      /isEnterpriseLicenseUsageRequestCurrent\(/g,
    );
    expect(requestGuardUses).toHaveLength(2);
  });

  test("schedules a refresh at the next exact inactivity boundary", () => {
    const now: Date = new Date("2026-09-02T12:00:00.000Z");
    const snapshot: EnterpriseLicenseUsageSnapshot = {
      currentUserCount: 2,
      activeInstanceIds: [],
      masterAdminEmails: [],
      calculatedAt: now.toISOString(),
      lastUsageReportedAt: null,
      nextInstanceStatusChangeAt: new Date(
        now.getTime() + 12_345,
      ).toISOString(),
    };

    expect(getEnterpriseLicenseUsageBoundaryRefreshDelay(snapshot)).toBe(
      12_345,
    );
    expect(
      getEnterpriseLicenseUsageBoundaryRefreshDelay({
        ...snapshot,
        nextInstanceStatusChangeAt: new Date(now.getTime() - 1).toISOString(),
      }),
    ).toBe(EnterpriseLicenseUsageMinimumRefreshDelayInMilliseconds);
    expect(
      getEnterpriseLicenseUsageBoundaryRefreshDelay({
        ...snapshot,
        nextInstanceStatusChangeAt: null,
      }),
    ).toBeNull();
  });

  test("uses server timestamps so browser clock skew cannot cause a refresh loop", () => {
    const snapshot: EnterpriseLicenseUsageSnapshot = {
      currentUserCount: 2,
      activeInstanceIds: [],
      masterAdminEmails: [],
      calculatedAt: "2026-09-02T12:00:00.000Z",
      lastUsageReportedAt: null,
      nextInstanceStatusChangeAt: "2026-09-02T12:00:05.000Z",
    };

    expect(getEnterpriseLicenseUsageBoundaryRefreshDelay(snapshot)).toBe(5000);
    expect(licenseActivityUtilSource).not.toContain("Date.now()");
  });

  test("subtracts response latency before scheduling the inactivity boundary", () => {
    const snapshot: EnterpriseLicenseUsageSnapshot = {
      currentUserCount: 2,
      activeInstanceIds: [],
      masterAdminEmails: [],
      calculatedAt: "2026-09-02T12:00:00.000Z",
      lastUsageReportedAt: null,
      nextInstanceStatusChangeAt: "2026-09-02T12:00:12.345Z",
    };

    expect(getEnterpriseLicenseUsageBoundaryRefreshDelay(snapshot, 5000)).toBe(
      7345,
    );
    expect(
      getEnterpriseLicenseUsageBoundaryRefreshDelay(snapshot, 15_000),
    ).toBe(EnterpriseLicenseUsageMinimumRefreshDelayInMilliseconds);
    expect(viewSource).toContain("performance.now()");
    expect(viewSource).toContain("elapsedSinceRequestStarted");
  });

  test("does not send user email hashes to the browser", () => {
    expect(viewSource).not.toContain("userEmailHashes: true");
  });

  test("makes the billing effect explicit next to the last report", () => {
    expect(instanceTableSource).toContain(
      "Inactive — not counted towards seats",
    );
    expect(licenseUtilSource).toContain("is not included in seat usage");
  });

  test("keeps the last-activity timestamp visible for diagnosing inactivity", () => {
    expect(instanceTableSource).toContain('title: "Last Activity"');
    expect(instanceTableSource).toContain(
      "OneUptimeDate.getDateAsUserFriendlyFormattedString",
    );
    expect(instanceTableSource).toContain("Never communicated");
    expect(usageCardSource).toContain("usageSnapshot?.lastUsageReportedAt");
    expect(usageCardSource).not.toContain("license.userCountUpdatedAt");
  });

  test("maps a recent report to the active state", () => {
    const now: Date = new Date("2026-09-02T12:00:00.000Z");
    expect(
      getEnterpriseLicenseInstanceActivityState({
        instance: {
          lastReportedAt: new Date("2026-09-01T12:00:00.000Z"),
        },
        now,
      }),
    ).toBe("active");
  });

  test("maps a week without a report to the inactive state", () => {
    const now: Date = new Date("2026-09-02T12:00:00.000Z");
    expect(
      getEnterpriseLicenseInstanceActivityState({
        instance: {
          lastReportedAt: new Date("2026-08-26T12:00:00.000Z"),
        },
        now,
      }),
    ).toBe("inactive");
  });

  test("honors the status from the same snapshot as the displayed count", () => {
    expect(
      getEnterpriseLicenseInstanceActivityState({
        instance: {
          lastReportedAt: new Date("2026-09-02T12:00:00.000Z"),
        },
        isActive: false,
      }),
    ).toBe("inactive");
  });
});
