import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import {
  KubernetesComplianceControlInfo,
  getKubernetesComplianceControls,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS,
  isKubernetesComplianceFramework,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceFailingControl,
  KubernetesComplianceFrameworkSummary,
  KubernetesComplianceSummary,
  KubernetesComplianceSummaryFreshness,
  getKubernetesComplianceSummaryFreshness,
  getLowestKubernetesComplianceScore,
  readKubernetesComplianceSummary,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceSummary";

/*
 * EVERY CLUSTER'S HARDENING ON ONE PAGE (#9876), worked out without React so
 * a plain test pins it: each cluster's row from the summary its record
 * keeps, the frameworks the page draws a column for, the worst first, and
 * the filters - which clusters fail CIS 5.1.1, which are not scored yet.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// Where a cluster stands, as the Status filter offers it.
export enum KubernetesFleetComplianceStatus {
  Failing = "Failing",
  Passing = "Passing",
  NotScored = "NotScored",
}

export const FLEET_COMPLIANCE_STATUS_LABELS: Readonly<
  Record<KubernetesFleetComplianceStatus, string>
> = {
  [KubernetesFleetComplianceStatus.Failing]:
    translationKey("Failing a control"),
  [KubernetesFleetComplianceStatus.Passing]: translationKey(
    "Every control passing",
  ),
  [KubernetesFleetComplianceStatus.NotScored]: translationKey("Not scored yet"),
};

// The cluster columns the page sorts by; a framework's column sorts by its score.
export const NAME_SORT_KEY: string = "name";
export const LOWEST_SCORE_SORT_KEY: string = "lowestScore";
export const WORKLOADS_SORT_KEY: string = "workloadCount";

export function getFrameworkSortKey(framework: string): string {
  return `score:${framework}`;
}

/*
 * One cluster's row. Everything the table sorts and filters on is a flat
 * field, a framework's score under its own key (getFrameworkSortKey), so a
 * framework added to the scoring gets a column with nothing to change here.
 */
export interface KubernetesFleetComplianceRow {
  [key: string]: unknown;
  clusterId: string;
  name: string;
  isConnected: boolean;
  // When its agent last reported.
  lastSeenAt: string | null;
  refreshedAt: string | null;
  summary: KubernetesComplianceSummary | null;
  freshness: KubernetesComplianceSummaryFreshness;
  lowestScore: number | null;
  workloadCount: number | null;
  failingControlCount: number;
  status: KubernetesFleetComplianceStatus;
  // "PSS Baseline|Privileged Containers": what the Fails filter matches.
  failingControlKeys: Array<string>;
}

// A cluster as its list reads it.
export interface KubernetesFleetCluster {
  id: string;
  name: string;
  isConnected: boolean;
  lastSeenAt?: Date | string | null | undefined;
  complianceSummary?: unknown;
  complianceSummaryRefreshedAt?: Date | string | null | undefined;
}

export function getFailingControlKey(
  framework: string,
  requirement: string,
): string {
  return `${framework}|${requirement}`;
}

function asIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toFleetComplianceRow(
  cluster: KubernetesFleetCluster,
  now: Date,
): KubernetesFleetComplianceRow {
  const summary: KubernetesComplianceSummary | null =
    readKubernetesComplianceSummary(cluster.complianceSummary);
  const applying: Array<KubernetesComplianceFrameworkSummary> = (
    summary?.frameworks || []
  ).filter((framework: KubernetesComplianceFrameworkSummary): boolean => {
    return !framework.isTurnedOff;
  });
  const failingControlKeys: Array<string> = applying.flatMap(
    (framework: KubernetesComplianceFrameworkSummary): Array<string> => {
      return framework.failingControls.map(
        (control: KubernetesComplianceFailingControl): string => {
          return getFailingControlKey(framework.framework, control.requirement);
        },
      );
    },
  );
  const lowestScore: number | null =
    getLowestKubernetesComplianceScore(summary);
  const row: KubernetesFleetComplianceRow = {
    clusterId: cluster.id,
    name: cluster.name,
    isConnected: cluster.isConnected,
    lastSeenAt: asIsoString(cluster.lastSeenAt),
    // The summary says when it was worked out; the column is the same time.
    refreshedAt:
      summary?.refreshedAt || asIsoString(cluster.complianceSummaryRefreshedAt),
    summary,
    freshness: getKubernetesComplianceSummaryFreshness({
      refreshedAt: summary ? summary.refreshedAt : null,
      isConnected: cluster.isConnected,
      now,
    }),
    lowestScore,
    workloadCount: summary ? summary.workloadCount : null,
    failingControlCount: failingControlKeys.length,
    status: !summary
      ? KubernetesFleetComplianceStatus.NotScored
      : failingControlKeys.length > 0
        ? KubernetesFleetComplianceStatus.Failing
        : KubernetesFleetComplianceStatus.Passing,
    failingControlKeys,
  };

  for (const framework of summary?.frameworks || []) {
    row[getFrameworkSortKey(framework.framework)] = framework.isTurnedOff
      ? null
      : framework.score;
  }

  return row;
}

// A framework the page draws a column for, and its summary on a row.
export interface KubernetesFleetFramework {
  framework: string;
  fullName: string;
}

/*
 * The frameworks any cluster was scored against: the ones OneUptime knows in
 * the catalog's order, then any other by name - a framework added to the
 * scoring later shows with no change to the page.
 */
export function getFleetFrameworks(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
): Array<KubernetesFleetFramework> {
  const byName: Map<string, KubernetesFleetFramework> = new Map();

  for (const row of rows) {
    for (const framework of row.summary?.frameworks || []) {
      if (!byName.has(framework.framework)) {
        byName.set(framework.framework, {
          framework: framework.framework,
          fullName: framework.fullName,
        });
      }
    }
  }

  const known: ReadonlyArray<string> = ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS;

  return Array.from(byName.values()).sort(
    (a: KubernetesFleetFramework, b: KubernetesFleetFramework): number => {
      const rankA: number = known.indexOf(a.framework);
      const rankB: number = known.indexOf(b.framework);

      return (
        (rankA === -1 ? known.length : rankA) -
          (rankB === -1 ? known.length : rankB) ||
        a.framework.localeCompare(b.framework)
      );
    },
  );
}

export function getFrameworkSummary(
  row: Pick<KubernetesFleetComplianceRow, "summary">,
  framework: string,
): KubernetesComplianceFrameworkSummary | undefined {
  return row.summary?.frameworks.find(
    (each: KubernetesComplianceFrameworkSummary): boolean => {
      return each.framework === framework;
    },
  );
}

function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: number,
): number {
  const hasA: boolean = typeof a === "number";
  const hasB: boolean = typeof b === "number";

  // A cluster with nothing to compare goes last, whichever way the list runs.
  if (!hasA || !hasB) {
    return hasA === hasB ? 0 : hasA ? -1 : 1;
  }

  return ((a as number) - (b as number)) * direction;
}

/*
 * The rows in the order the reader asked for. Unsorted, or by the lowest
 * score, the worst first: the cluster furthest from its frameworks heads the
 * list, a cluster not scored yet ends it. Ties by name.
 */
export function sortFleetComplianceRows(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
  sortBy: string | null,
  sortOrder: SortOrder,
): Array<KubernetesFleetComplianceRow> {
  const key: string = sortBy || LOWEST_SCORE_SORT_KEY;
  const direction: number =
    sortBy && sortOrder === SortOrder.Descending ? -1 : 1;

  return [...rows].sort(
    (a: KubernetesFleetComplianceRow, b: KubernetesFleetComplianceRow) => {
      const byName: number = a.name.localeCompare(b.name);

      if (key === NAME_SORT_KEY) {
        return byName * direction;
      }

      return (
        compareNullableNumbers(
          a[key] as number | null | undefined,
          b[key] as number | null | undefined,
          direction,
        ) || byName
      );
    },
  );
}

// One filter value, as the filter controls write it, as a list of strings.
export function readFilterValues(value: unknown): Array<string> {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown): string => {
      return String(entry);
    });
  }

  return [String(value)];
}

/*
 * Whether a cluster's name matches the Cluster filter, by the operator the
 * reader chose: the text control writes a wrapper for each - does not
 * contain, is, starts with - and reading every one as "contains" would
 * answer "does not contain prod" with the prod clusters.
 */
export function matchesNameFilter(name: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  if (value instanceof IsNull) {
    return name.trim() === "";
  }

  if (value instanceof NotNull) {
    return name.trim() !== "";
  }

  const text: string = String(value).toLowerCase().trim();
  const candidate: string = name.toLowerCase();

  if (!text) {
    return true;
  }

  if (value instanceof NotContains) {
    return !candidate.includes(text);
  }

  if (value instanceof NotEqual) {
    return candidate !== text;
  }

  if (value instanceof EqualTo) {
    return candidate === text;
  }

  if (value instanceof StartsWith) {
    return candidate.startsWith(text);
  }

  if (value instanceof EndsWith) {
    return candidate.endsWith(text);
  }

  return candidate.includes(text);
}

// The rows the reader's filters keep: by name, by where they stand, by a control they fail.
export function filterFleetComplianceRows(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
  filterData: Record<string, unknown>,
): Array<KubernetesFleetComplianceRow> {
  const statuses: Array<string> = readFilterValues(filterData["status"]);
  const failing: Array<string> = readFilterValues(
    filterData["failingControlKeys"],
  );

  return rows.filter((row: KubernetesFleetComplianceRow): boolean => {
    return (
      matchesNameFilter(row.name, filterData["name"]) &&
      (statuses.length === 0 || statuses.includes(row.status)) &&
      (failing.length === 0 ||
        row.failingControlKeys.some((key: string): boolean => {
          return failing.includes(key);
        }))
    );
  });
}

/*
 * The controls any cluster fails, for the Fails filter, each once: by
 * framework, and a framework's in its catalog's order.
 */
export function getFailingControls(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
): Array<{ framework: string; requirement: string; title: string }> {
  const seen: Map<
    string,
    { framework: string; requirement: string; title: string }
  > = new Map();

  for (const framework of getFleetFrameworks(rows)) {
    for (const row of rows) {
      const summary: KubernetesComplianceFrameworkSummary | undefined =
        getFrameworkSummary(row, framework.framework);

      if (!summary || summary.isTurnedOff) {
        continue;
      }

      for (const control of summary.failingControls) {
        const key: string = getFailingControlKey(
          framework.framework,
          control.requirement,
        );

        if (!seen.has(key)) {
          seen.set(key, {
            framework: framework.framework,
            requirement: control.requirement,
            title: control.title,
          });
        }
      }
    }
  }

  const rank: (control: {
    framework: string;
    requirement: string;
  }) => number = (control: {
    framework: string;
    requirement: string;
  }): number => {
    if (!isKubernetesComplianceFramework(control.framework)) {
      return Number.MAX_SAFE_INTEGER;
    }

    const index: number = getKubernetesComplianceControls(
      control.framework,
    ).findIndex((each: KubernetesComplianceControlInfo): boolean => {
      return each.requirement === control.requirement;
    });

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const frameworkOrder: Array<string> = getFleetFrameworks(rows).map(
    (framework: KubernetesFleetFramework): string => {
      return framework.framework;
    },
  );

  // A framework's controls in its catalog's order; an unknown one's as first met.
  return Array.from(seen.values())
    .map(
      (
        control: { framework: string; requirement: string; title: string },
        index: number,
      ) => {
        return { control, index };
      },
    )
    .sort(
      (
        a: {
          control: { framework: string; requirement: string; title: string };
          index: number;
        },
        b: {
          control: { framework: string; requirement: string; title: string };
          index: number;
        },
      ): number => {
        return (
          frameworkOrder.indexOf(a.control.framework) -
            frameworkOrder.indexOf(b.control.framework) ||
          rank(a.control) - rank(b.control) ||
          a.index - b.index
        );
      },
    )
    .map(
      (item: {
        control: { framework: string; requirement: string; title: string };
      }) => {
        return item.control;
      },
    );
}

export const FLEET_COMPLIANCE_ROWS_PER_PAGE: number = 25;

export function pageFleetComplianceRows(
  rows: ReadonlyArray<KubernetesFleetComplianceRow>,
  page: number,
  pageSize: number,
): Array<KubernetesFleetComplianceRow> {
  const start: number = (Math.max(1, page) - 1) * pageSize;

  return rows.slice(start, start + pageSize);
}
