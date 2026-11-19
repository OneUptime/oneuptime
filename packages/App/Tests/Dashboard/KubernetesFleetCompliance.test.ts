import {
  FLEET_REPORT_HEADER,
  getFleetComplianceCsv,
  getFleetComplianceReport,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesFleetComplianceExport";
import {
  KubernetesFleetCluster,
  KubernetesFleetComplianceRow,
  KubernetesFleetComplianceStatus,
  LOWEST_SCORE_SORT_KEY,
  NAME_SORT_KEY,
  WORKLOADS_SORT_KEY,
  filterFleetComplianceRows,
  getFailingControlKey,
  getFailingControls,
  getFleetFrameworks,
  getFrameworkSortKey,
  matchesNameFilter,
  pageFleetComplianceRows,
  sortFleetComplianceRows,
  toFleetComplianceRow,
} from "../../FeatureSet/Dashboard/src/Components/KubernetesCompliance/KubernetesFleetComplianceModel";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
  KubernetesComplianceFrameworkSummary,
  KubernetesComplianceSummary,
  KubernetesComplianceSummaryFreshness,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CLUSTER'S HARDENING ON ONE PAGE (#9876), without React: each
 * cluster's row from the summary its record keeps, the frameworks the page
 * draws a column for - one OneUptime does not know yet included - the worst
 * first, the filters ("which clusters fail CIS 5.1.1?") and the project's
 * CSV and JSON exports.
 */

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60000).toISOString();
}

function framework(
  name: string,
  score: number | null,
  failing: Array<[string, number]> = [],
  data: Partial<KubernetesComplianceFrameworkSummary> = {},
): KubernetesComplianceFrameworkSummary {
  return {
    framework: name,
    fullName: `${name} in full`,
    score,
    isTurnedOff: false,
    controlsEvaluated: 10,
    controlsPassing: 10 - failing.length,
    controlsNotEvaluated: 0,
    workloadsEvaluated: 12,
    workloadsPassing: 9,
    workloadsFromTemplates: 1,
    acceptedCount: 2,
    failingControls: failing.map(
      ([requirement, failingCount]: [string, number]) => {
        return { requirement, title: `Title of ${requirement}`, failingCount };
      },
    ),
    ...data,
  };
}

function summary(
  frameworks: Array<KubernetesComplianceFrameworkSummary>,
  refreshedAt: string = minutesAgo(5),
): KubernetesComplianceSummary {
  return {
    version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
    refreshedAt,
    kubernetesVersion: "1.31",
    podCount: 40,
    workloadCount: 12,
    frameworks,
  };
}

function cluster(
  name: string,
  complianceSummary: KubernetesComplianceSummary | null,
  isConnected: boolean = true,
): KubernetesFleetCluster {
  return {
    id: `${name}-id`,
    name,
    isConnected,
    lastSeenAt: minutesAgo(1),
    complianceSummary,
    complianceSummaryRefreshedAt: complianceSummary?.refreshedAt || null,
  };
}

const BASELINE: string = KubernetesComplianceFramework.PssBaseline;
const RESTRICTED: string = KubernetesComplianceFramework.PssRestricted;
const CIS: string = KubernetesComplianceFramework.CisKubernetes;

function fleet(): Array<KubernetesFleetComplianceRow> {
  return [
    cluster(
      "prod-eu",
      summary([
        framework(BASELINE, 90, [["Privileged Containers", 2]]),
        framework(RESTRICTED, 40, [
          ["Running as Non-root", 9],
          ["Seccomp", 4],
        ]),
        framework(CIS, 70, [["5.1.1", 1]]),
      ]),
    ),
    cluster(
      "prod-us",
      summary([
        framework(BASELINE, 100),
        framework(RESTRICTED, 80, [["Seccomp", 1]]),
        framework(CIS, 95),
      ]),
    ),
    cluster("new-cluster", null),
    cluster(
      "staging",
      summary(
        [
          framework(BASELINE, 60, [["Host Namespaces", 3]]),
          framework(RESTRICTED, null, [], { isTurnedOff: true }),
          framework(CIS, 100),
        ],
        minutesAgo(45),
      ),
    ),
    cluster(
      "edge",
      summary(
        [framework(BASELINE, 100), framework(CIS, 50, [["5.1.1", 4]])],
        minutesAgo(3),
      ),
      false,
    ),
  ].map((each: KubernetesFleetCluster): KubernetesFleetComplianceRow => {
    return toFleetComplianceRow(each, NOW);
  });
}

function names(rows: Array<KubernetesFleetComplianceRow>): Array<string> {
  return rows.map((row: KubernetesFleetComplianceRow): string => {
    return row.name;
  });
}

describe("a cluster's row", () => {
  const rows: Array<KubernetesFleetComplianceRow> = fleet();

  test("its lowest score of what applies, its failing controls and its workloads", () => {
    expect(rows[0]).toMatchObject({
      clusterId: "prod-eu-id",
      lowestScore: 40,
      workloadCount: 12,
      failingControlCount: 4,
      status: KubernetesFleetComplianceStatus.Failing,
      failingControlKeys: [
        "PSS Baseline|Privileged Containers",
        "PSS Restricted|Running as Non-root",
        "PSS Restricted|Seccomp",
        "CIS Kubernetes|5.1.1",
      ],
      [getFrameworkSortKey(RESTRICTED)]: 40,
    });
  });

  test("a framework turned off for the cluster neither scores nor fails it", () => {
    const staging: KubernetesFleetComplianceRow = rows[3]!;

    expect(staging.lowestScore).toBe(60);
    expect(staging[getFrameworkSortKey(RESTRICTED)]).toBeNull();
    expect(staging.failingControlKeys).toEqual([
      "PSS Baseline|Host Namespaces",
    ]);
  });

  test("a cluster never scored is not scored yet, with nothing to sort by", () => {
    expect(rows[2]).toMatchObject({
      status: KubernetesFleetComplianceStatus.NotScored,
      lowestScore: null,
      workloadCount: null,
      freshness: KubernetesComplianceSummaryFreshness.Missing,
      summary: null,
    });
  });

  test("says how fresh its scores are", () => {
    expect(
      rows.map((row: KubernetesFleetComplianceRow) => {
        return [row.name, row.freshness];
      }),
    ).toEqual([
      ["prod-eu", KubernetesComplianceSummaryFreshness.Fresh],
      ["prod-us", KubernetesComplianceSummaryFreshness.Fresh],
      ["new-cluster", KubernetesComplianceSummaryFreshness.Missing],
      // Its agent reports, but the job is behind.
      ["staging", KubernetesComplianceSummaryFreshness.Late],
      // Its agent stopped: scores from its last report.
      ["edge", KubernetesComplianceSummaryFreshness.Disconnected],
    ]);
  });

  test("a summary that is not one reads as not scored yet", () => {
    expect(
      toFleetComplianceRow(
        {
          id: "x",
          name: "x",
          isConnected: true,
          complianceSummary: { version: 99, frameworks: [] },
        },
        NOW,
      ).status,
    ).toBe(KubernetesFleetComplianceStatus.NotScored);
  });
});

describe("the frameworks the page draws a column for", () => {
  test("the ones OneUptime knows in the catalog's order, then any other: a new framework needs no change", () => {
    const rows: Array<KubernetesFleetComplianceRow> = [
      ...fleet(),
      toFleetComplianceRow(
        cluster(
          "hardened",
          summary([
            framework("NSA/CISA Hardening", 75, [["Non-root containers", 2]]),
            framework(CIS, 100),
          ]),
        ),
        NOW,
      ),
    ];

    expect(
      getFleetFrameworks(rows).map((each: { framework: string }) => {
        return each.framework;
      }),
    ).toEqual([BASELINE, RESTRICTED, CIS, "NSA/CISA Hardening"]);
    expect(rows[5]![getFrameworkSortKey("NSA/CISA Hardening")]).toBe(75);
  });
});

describe("the order", () => {
  test("by default the worst first, a cluster not scored yet last", () => {
    expect(
      names(sortFleetComplianceRows(fleet(), null, SortOrder.Ascending)),
    ).toEqual(["prod-eu", "edge", "staging", "prod-us", "new-cluster"]);
  });

  test("by a framework's score, either way, a cluster without it last", () => {
    expect(
      names(
        sortFleetComplianceRows(
          fleet(),
          getFrameworkSortKey(RESTRICTED),
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["prod-eu", "prod-us", "edge", "new-cluster", "staging"]);
    expect(
      names(
        sortFleetComplianceRows(
          fleet(),
          getFrameworkSortKey(CIS),
          SortOrder.Descending,
        ),
      ),
    ).toEqual(["staging", "prod-us", "prod-eu", "edge", "new-cluster"]);
  });

  test("by name, and by workloads", () => {
    expect(
      names(
        sortFleetComplianceRows(fleet(), NAME_SORT_KEY, SortOrder.Ascending),
      ),
    ).toEqual(["edge", "new-cluster", "prod-eu", "prod-us", "staging"]);
    expect(
      names(
        sortFleetComplianceRows(
          fleet(),
          WORKLOADS_SORT_KEY,
          SortOrder.Descending,
        ),
      ).pop(),
    ).toBe("new-cluster");
    expect(
      names(
        sortFleetComplianceRows(
          fleet(),
          LOWEST_SCORE_SORT_KEY,
          SortOrder.Descending,
        ),
      ),
    ).toEqual(["prod-us", "staging", "edge", "prod-eu", "new-cluster"]);
  });

  test("a page at a time", () => {
    const rows: Array<KubernetesFleetComplianceRow> = fleet();

    expect(names(pageFleetComplianceRows(rows, 2, 2))).toEqual([
      "new-cluster",
      "staging",
    ]);
    expect(pageFleetComplianceRows(rows, 4, 2)).toEqual([]);
  });
});

describe("the filters", () => {
  test("which clusters fail CIS 5.1.1", () => {
    expect(
      names(
        filterFleetComplianceRows(fleet(), {
          failingControlKeys: [getFailingControlKey(CIS, "5.1.1")],
        }),
      ),
    ).toEqual(["prod-eu", "edge"]);
  });

  test("any of several controls", () => {
    expect(
      names(
        filterFleetComplianceRows(fleet(), {
          failingControlKeys: [
            getFailingControlKey(RESTRICTED, "Seccomp"),
            getFailingControlKey(BASELINE, "Host Namespaces"),
          ],
        }),
      ),
    ).toEqual(["prod-eu", "prod-us", "staging"]);
  });

  test("where a cluster stands", () => {
    expect(
      names(
        filterFleetComplianceRows(fleet(), {
          status: [KubernetesFleetComplianceStatus.NotScored],
        }),
      ),
    ).toEqual(["new-cluster"]);
    expect(
      names(
        filterFleetComplianceRows(fleet(), {
          status: KubernetesFleetComplianceStatus.Failing,
        }),
      ),
    ).toEqual(["prod-eu", "prod-us", "staging", "edge"]);
  });

  test("by name, as the operator the reader chose says", () => {
    expect(names(filterFleetComplianceRows(fleet(), { name: "prod" }))).toEqual(
      ["prod-eu", "prod-us"],
    );
    // "Does not contain prod" is not "contains prod".
    expect(
      names(
        filterFleetComplianceRows(fleet(), { name: new NotContains("prod") }),
      ),
    ).toEqual(["new-cluster", "staging", "edge"]);
    expect(matchesNameFilter("prod-eu", new EqualTo("PROD-EU"))).toBe(true);
    expect(matchesNameFilter("prod-eu", new StartsWith("eu"))).toBe(false);
    expect(matchesNameFilter("prod-eu", new IsNull())).toBe(false);
    expect(matchesNameFilter("prod-eu", "")).toBe(true);
  });

  test("the Fails filter offers the controls any cluster fails, by framework, each in its catalog's order", () => {
    expect(
      getFailingControls(fleet()).map(
        (control: { framework: string; requirement: string }): string => {
          return getFailingControlKey(control.framework, control.requirement);
        },
      ),
    ).toEqual([
      // The standard lists Host Namespaces before Privileged Containers.
      "PSS Baseline|Host Namespaces",
      "PSS Baseline|Privileged Containers",
      "PSS Restricted|Seccomp",
      "PSS Restricted|Running as Non-root",
      "CIS Kubernetes|5.1.1",
    ]);
  });
});

describe("the project's export", () => {
  test("CSV: one row per cluster, framework and failing control, a cluster not scored yet saying so", () => {
    const csv: string = getFleetComplianceCsv(
      sortFleetComplianceRows(fleet(), null, SortOrder.Ascending),
    );
    const lines: Array<string> = csv.trim().split(/\r?\n/);

    expect(lines[0]).toBe(FLEET_REPORT_HEADER.join(","));
    expect(lines).toContain(
      `prod-eu,prod-eu-id,CIS Kubernetes,70,1,12,9,2,5.1.1,Title of 5.1.1,1,${minutesAgo(5)},Connected`,
    );
    expect(lines).toContain(
      `prod-eu,prod-eu-id,PSS Restricted,40,2,12,9,2,Running as Non-root,Title of Running as Non-root,9,${minutesAgo(5)},Connected`,
    );
    // A framework the cluster passes: one row, no control.
    expect(lines).toContain(
      `prod-us,prod-us-id,PSS Baseline,100,0,12,9,2,,,,${minutesAgo(5)},Connected`,
    );
    expect(lines).toContain(
      `staging,staging-id,PSS Restricted,Turned off,0,12,9,2,,,,${minutesAgo(45)},Connected`,
    );
    expect(lines).toContain(
      "new-cluster,new-cluster-id,,Not scored yet,,,,,,,,,Connected",
    );
    expect(
      lines.filter((line: string) => {
        return line.startsWith("edge,");
      }),
    ).toEqual([
      `edge,edge-id,PSS Baseline,100,0,12,9,2,,,,${minutesAgo(3)},Disconnected`,
      `edge,edge-id,CIS Kubernetes,50,1,12,9,2,5.1.1,Title of 5.1.1,4,${minutesAgo(3)},Disconnected`,
    ]);
  });

  test("CSV: a cluster's name that starts a formula is written as text", () => {
    const csv: string = getFleetComplianceCsv([
      toFleetComplianceRow(
        cluster("=HYPERLINK(1)", summary([framework(BASELINE, 100)])),
        NOW,
      ),
    ]);

    expect(csv).not.toMatch(/^=HYPERLINK/m);
  });

  test("JSON: each cluster as it was scored, with the frameworks it has", () => {
    const report: Record<string, unknown> = getFleetComplianceReport(
      fleet(),
      NOW,
    );
    const clusters: Array<Record<string, unknown>> = report[
      "clusters"
    ] as Array<Record<string, unknown>>;

    expect(report["exportedAt"]).toBe(NOW.toISOString());
    expect(report["frameworks"]).toEqual([
      { framework: BASELINE, fullName: `${BASELINE} in full` },
      { framework: RESTRICTED, fullName: `${RESTRICTED} in full` },
      { framework: CIS, fullName: `${CIS} in full` },
    ]);
    expect(clusters[0]).toMatchObject({
      clusterId: "prod-eu-id",
      name: "prod-eu",
      agentConnected: true,
      scoredAt: minutesAgo(5),
      lowestScore: 40,
      kubernetesVersion: "1.31",
      podCount: 40,
      workloadCount: 12,
    });
    expect((clusters[0]!["frameworks"] as Array<unknown>).length).toBe(3);
    expect(clusters[2]).toMatchObject({
      name: "new-cluster",
      scoredAt: null,
      frameworks: [],
    });
  });
});
