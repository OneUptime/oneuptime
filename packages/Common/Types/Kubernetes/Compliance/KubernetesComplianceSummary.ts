import { ComplianceRequirementStatus } from "../../DataSecurity/ComplianceRequirementCatalog";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
} from "./KubernetesComplianceApiTypes";
import { KubernetesComplianceRequirementResult } from "./KubernetesComplianceScoring";

/*
 * EVERY CLUSTER'S HARDENING, KEPT SMALL (#9876).
 *
 * A platform team with ten clusters had to open ten Compliance pages to learn
 * which one is furthest from Restricted, and an auditor asking "which
 * clusters fail CIS 5.1.1?" got no single answer. Scoring every cluster on
 * every visit would read up to 25,000 pods and every role of each, so each
 * cluster keeps a summary of its last scoring on its own record
 * (KubernetesCluster.complianceSummary): each framework's score, the controls
 * that fail it and how many objects fail each, and the workloads it read.
 * Kubernetes' Compliance page reads only these.
 *
 * It is worked out from the very answer the cluster's own Compliance page
 * draws, so the two never disagree: when that page is opened, and by the
 * Kubernetes:RefreshComplianceSummaries job, as the agent's snapshots land.
 * Its frameworks are a list keyed by the name a setting stores, so a
 * framework added to the scoring - the NSA/CISA hardening guide, the node
 * controls a kube-bench job reads - is summarized and drawn with no change
 * here.
 */

// Raised when the summary changes shape, so a reader can tell an old one apart.
export const KUBERNETES_COMPLIANCE_SUMMARY_VERSION: number = 1;

/*
 * How often a cluster whose agent reports is scored again: the agent's
 * snapshots land every five minutes by default, and the job looks every
 * five minutes too.
 */
export const KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES: number = 15;

/*
 * The oldest any summary is let get, whether or not its agent reports: a
 * setting changed through the API, or an accepted finding that expired, is
 * scored within it.
 */
export const KUBERNETES_COMPLIANCE_SUMMARY_MAX_AGE_MINUTES: number = 60;

/*
 * Older than this, a reporting cluster's summary is late - the job is behind
 * or failing - and its row says so.
 */
export const KUBERNETES_COMPLIANCE_SUMMARY_LATE_MINUTES: number =
  KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES * 2;

// A control that fails, and how many objects fail it, what is accepted left out.
export interface KubernetesComplianceFailingControl {
  requirement: string;
  // As English writes it, for the export; the page words the catalog's key.
  title: string;
  failingCount: number;
}

export interface KubernetesComplianceFrameworkSummary {
  // The framework, as a setting stores it: "PSS Baseline", "CIS Kubernetes".
  framework: string;
  fullName: string;
  // 0 to 100, or null when nothing could be evaluated.
  score: number | null;
  isTurnedOff: boolean;
  controlsEvaluated: number;
  controlsPassing: number;
  controlsNotEvaluated: number;
  workloadsEvaluated: number;
  workloadsPassing: number;
  // Of the workloads, those read from their pod template (#9880).
  workloadsFromTemplates: number;
  // Findings accepted for one object (#9874).
  acceptedCount: number;
  // The controls that fail, in the standard's or the benchmark's order.
  failingControls: Array<KubernetesComplianceFailingControl>;
}

export interface KubernetesComplianceSummary {
  version: number;
  // When the cluster was scored.
  refreshedAt: string;
  kubernetesVersion: string | null;
  podCount: number;
  // Workloads read, by the framework that read the most.
  workloadCount: number;
  frameworks: Array<KubernetesComplianceFrameworkSummary>;
}

function isScored(
  requirement: Pick<KubernetesComplianceRequirementResult, "status">,
): boolean {
  return (
    requirement.status === ComplianceRequirementStatus.Passing ||
    requirement.status === ComplianceRequirementStatus.Failing
  );
}

export function summarizeKubernetesFramework(
  framework: KubernetesComplianceFrameworkResponse,
): KubernetesComplianceFrameworkSummary {
  const requirements: Array<KubernetesComplianceRequirementResult> =
    framework.requirements || [];

  return {
    framework: framework.framework,
    fullName: framework.fullName,
    score: framework.isTurnedOff ? null : framework.score,
    isTurnedOff: framework.isTurnedOff,
    controlsEvaluated: requirements.filter(isScored).length,
    controlsPassing: requirements.filter(
      (requirement: KubernetesComplianceRequirementResult): boolean => {
        return requirement.status === ComplianceRequirementStatus.Passing;
      },
    ).length,
    controlsNotEvaluated: requirements.filter(
      (requirement: KubernetesComplianceRequirementResult): boolean => {
        return requirement.status === ComplianceRequirementStatus.NotEvaluated;
      },
    ).length,
    workloadsEvaluated: framework.workloadsEvaluated,
    workloadsPassing: framework.workloadsPassing,
    workloadsFromTemplates: framework.workloadsFromTemplates || 0,
    acceptedCount: framework.acceptedCount || 0,
    failingControls: framework.isTurnedOff
      ? []
      : requirements
          .filter(
            (requirement: KubernetesComplianceRequirementResult): boolean => {
              return requirement.status === ComplianceRequirementStatus.Failing;
            },
          )
          .map(
            (
              requirement: KubernetesComplianceRequirementResult,
            ): KubernetesComplianceFailingControl => {
              return {
                requirement: requirement.requirement,
                title: requirement.title,
                failingCount: requirement.failingCount,
              };
            },
          ),
  };
}

// A cluster's compliance answer, as its summary keeps it.
export function summarizeKubernetesCompliance(
  compliance: KubernetesComplianceResponse,
  refreshedAt: Date,
): KubernetesComplianceSummary {
  const frameworks: Array<KubernetesComplianceFrameworkSummary> =
    compliance.frameworks.map(summarizeKubernetesFramework);

  return {
    version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
    refreshedAt: refreshedAt.toISOString(),
    kubernetesVersion: compliance.kubernetesVersion,
    podCount: compliance.podCount,
    workloadCount: frameworks.reduce(
      (
        most: number,
        framework: KubernetesComplianceFrameworkSummary,
      ): number => {
        return Math.max(most, framework.workloadsEvaluated);
      },
      0,
    ),
    frameworks,
  };
}

type Plain = Record<string, unknown>;

function asPlain(value: unknown): Plain | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Plain)
    : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readFailingControl(
  value: unknown,
): KubernetesComplianceFailingControl | null {
  const control: Plain | null = asPlain(value);
  const requirement: string = readText(control?.["requirement"]);

  if (!control || !requirement) {
    return null;
  }

  return {
    requirement,
    title: readText(control["title"]) || requirement,
    failingCount: readCount(control["failingCount"]),
  };
}

function readFrameworkSummary(
  value: unknown,
): KubernetesComplianceFrameworkSummary | null {
  const framework: Plain | null = asPlain(value);
  const name: string = readText(framework?.["framework"]);

  if (!framework || !name) {
    return null;
  }

  const score: unknown = framework["score"];

  return {
    framework: name,
    fullName: readText(framework["fullName"]) || name,
    score:
      typeof score === "number" && Number.isFinite(score)
        ? Math.min(100, Math.max(0, Math.round(score)))
        : null,
    isTurnedOff: framework["isTurnedOff"] === true,
    controlsEvaluated: readCount(framework["controlsEvaluated"]),
    controlsPassing: readCount(framework["controlsPassing"]),
    controlsNotEvaluated: readCount(framework["controlsNotEvaluated"]),
    workloadsEvaluated: readCount(framework["workloadsEvaluated"]),
    workloadsPassing: readCount(framework["workloadsPassing"]),
    workloadsFromTemplates: readCount(framework["workloadsFromTemplates"]),
    acceptedCount: readCount(framework["acceptedCount"]),
    failingControls: (Array.isArray(framework["failingControls"])
      ? (framework["failingControls"] as Array<unknown>)
      : []
    )
      .map(readFailingControl)
      .filter(
        (
          control: KubernetesComplianceFailingControl | null,
        ): control is KubernetesComplianceFailingControl => {
          return Boolean(control);
        },
      ),
  };
}

/*
 * A stored summary read back, defensively: one of this version, every field
 * of the type it should be, or none - and the cluster reads as not scored
 * yet rather than as one that passes.
 */
export function readKubernetesComplianceSummary(
  value: unknown,
): KubernetesComplianceSummary | null {
  const summary: Plain | null = asPlain(value);

  if (
    !summary ||
    summary["version"] !== KUBERNETES_COMPLIANCE_SUMMARY_VERSION ||
    !Array.isArray(summary["frameworks"])
  ) {
    return null;
  }

  const refreshedAt: string = readText(summary["refreshedAt"]);

  if (!refreshedAt || Number.isNaN(new Date(refreshedAt).getTime())) {
    return null;
  }

  return {
    version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
    refreshedAt,
    kubernetesVersion: readText(summary["kubernetesVersion"]) || null,
    podCount: readCount(summary["podCount"]),
    workloadCount: readCount(summary["workloadCount"]),
    frameworks: (summary["frameworks"] as Array<unknown>)
      .map(readFrameworkSummary)
      .filter(
        (
          framework: KubernetesComplianceFrameworkSummary | null,
        ): framework is KubernetesComplianceFrameworkSummary => {
          return Boolean(framework);
        },
      ),
  };
}

/*
 * A cluster's lowest score among the frameworks that apply to it: what the
 * page sorts by, the worst first. Null when no framework could be scored.
 */
export function getLowestKubernetesComplianceScore(
  summary: Pick<KubernetesComplianceSummary, "frameworks"> | null,
): number | null {
  let lowest: number | null = null;

  for (const framework of summary?.frameworks || []) {
    if (framework.isTurnedOff || framework.score === null) {
      continue;
    }

    lowest =
      lowest === null ? framework.score : Math.min(lowest, framework.score);
  }

  return lowest;
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60000;
}

/*
 * Whether a cluster's summary is due to be worked out again: one never
 * scored; one whose agent reports, past the refresh interval, as its
 * snapshots have moved on since; and any past the most it may age.
 */
export function isKubernetesComplianceSummaryDue(data: {
  refreshedAt: Date | string | null | undefined;
  isConnected: boolean;
  now: Date;
}): boolean {
  if (!data.refreshedAt) {
    return true;
  }

  const refreshedAt: Date = new Date(data.refreshedAt);

  if (Number.isNaN(refreshedAt.getTime())) {
    return true;
  }

  const age: number = minutesBetween(refreshedAt, data.now);

  return (
    age >= KUBERNETES_COMPLIANCE_SUMMARY_MAX_AGE_MINUTES ||
    (data.isConnected && age >= KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES)
  );
}

// How far a summary can be trusted, as the page says it.
export enum KubernetesComplianceSummaryFreshness {
  // Scored within the refresh interval's margin.
  Fresh = "Fresh",
  // The agent reports, but the scores are older than they should be.
  Late = "Late",
  // The agent stopped reporting: the scores are from its last report.
  Disconnected = "Disconnected",
  // Not scored yet.
  Missing = "Missing",
}

export function getKubernetesComplianceSummaryFreshness(data: {
  refreshedAt: Date | string | null | undefined;
  isConnected: boolean;
  now: Date;
}): KubernetesComplianceSummaryFreshness {
  if (!data.refreshedAt || Number.isNaN(new Date(data.refreshedAt).getTime())) {
    return KubernetesComplianceSummaryFreshness.Missing;
  }

  if (!data.isConnected) {
    return KubernetesComplianceSummaryFreshness.Disconnected;
  }

  return minutesBetween(new Date(data.refreshedAt), data.now) >
    KUBERNETES_COMPLIANCE_SUMMARY_LATE_MINUTES
    ? KubernetesComplianceSummaryFreshness.Late
    : KubernetesComplianceSummaryFreshness.Fresh;
}
