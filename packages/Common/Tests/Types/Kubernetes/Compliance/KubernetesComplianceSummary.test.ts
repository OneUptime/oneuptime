import { ComplianceRequirementStatus } from "../../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceResponse,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import { KubernetesComplianceFramework } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import { KubernetesComplianceRequirementResult } from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import {
  KUBERNETES_COMPLIANCE_SUMMARY_LATE_MINUTES,
  KUBERNETES_COMPLIANCE_SUMMARY_MAX_AGE_MINUTES,
  KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES,
  KUBERNETES_COMPLIANCE_SUMMARY_VERSION,
  KubernetesComplianceSummary,
  KubernetesComplianceSummaryFreshness,
  getKubernetesComplianceSummaryFreshness,
  getLowestKubernetesComplianceScore,
  isKubernetesComplianceSummaryDue,
  readKubernetesComplianceSummary,
  summarizeKubernetesCompliance,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceSummary";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CLUSTER'S HARDENING, KEPT SMALL (#9876): what the summary on each
 * cluster's record keeps of the answer its own Compliance page draws, how
 * it is read back, when it is due again, and how fresh the page says it is.
 */

function requirement(
  id: string,
  status: ComplianceRequirementStatus,
  failingCount: number = 0,
): KubernetesComplianceRequirementResult {
  return {
    requirement: id,
    title: `Title of ${id}`,
    status,
    failingCount,
    findings: [],
    turnedOffNamespaces: [],
  };
}

function framework(
  data: Partial<KubernetesComplianceFrameworkResponse> & {
    framework: KubernetesComplianceFramework;
  },
): KubernetesComplianceFrameworkResponse {
  return {
    fullName: `${data.framework} in full`,
    scope: "Pods",
    score: 50,
    isTurnedOff: false,
    turnedOffRequirements: [],
    turnedOffNamespaces: [],
    workloadsEvaluated: 10,
    workloadsPassing: 7,
    workloadsFromTemplates: 2,
    acceptedCount: 1,
    podsNotRead: 0,
    failingByNamespace: {},
    requirements: [
      requirement(
        "Privileged Containers",
        ComplianceRequirementStatus.Failing,
        3,
      ),
      requirement("Host Namespaces", ComplianceRequirementStatus.Passing),
      requirement("Capabilities", ComplianceRequirementStatus.NotEvaluated),
      requirement("Host Ports", ComplianceRequirementStatus.TurnedOff),
      requirement("HostPath Volumes", ComplianceRequirementStatus.Failing, 1),
    ],
    turnedOff: [],
    ...data,
  };
}

function compliance(
  frameworks: Array<KubernetesComplianceFrameworkResponse>,
): KubernetesComplianceResponse {
  return {
    clusterId: "cluster-1",
    kubernetesVersion: "1.31",
    standardVersion: "1.31",
    provider: "EKS",
    isManagedControlPlane: true,
    podCount: 120,
    podsRead: 120,
    templateCount: 2,
    hasPolicyObjects: true,
    policyEngine: null,
    isTruncated: false,
    namespaces: [],
    frameworks,
  };
}

const REFRESHED_AT: Date = new Date("2026-11-19T12:00:00.000Z");

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

describe("a cluster's answer, as its summary keeps it", () => {
  const summary: KubernetesComplianceSummary = summarizeKubernetesCompliance(
    compliance([
      framework({ framework: KubernetesComplianceFramework.PssBaseline }),
      framework({
        framework: KubernetesComplianceFramework.PssRestricted,
        score: 20,
        workloadsEvaluated: 12,
      }),
      framework({
        framework: KubernetesComplianceFramework.CisKubernetes,
        isTurnedOff: true,
        score: 90,
      }),
    ]),
    REFRESHED_AT,
  );

  test("each framework's score, controls, workloads and accepted findings", () => {
    expect(summary.version).toBe(KUBERNETES_COMPLIANCE_SUMMARY_VERSION);
    expect(summary.refreshedAt).toBe("2026-11-19T12:00:00.000Z");
    expect(summary.kubernetesVersion).toBe("1.31");
    expect(summary.podCount).toBe(120);
    expect(summary.frameworks[0]).toEqual({
      framework: KubernetesComplianceFramework.PssBaseline,
      fullName: "PSS Baseline in full",
      score: 50,
      isTurnedOff: false,
      controlsEvaluated: 3,
      controlsPassing: 1,
      controlsNotEvaluated: 1,
      workloadsEvaluated: 10,
      workloadsPassing: 7,
      workloadsFromTemplates: 2,
      acceptedCount: 1,
      failingControls: [
        {
          requirement: "Privileged Containers",
          title: "Title of Privileged Containers",
          failingCount: 3,
        },
        {
          requirement: "HostPath Volumes",
          title: "Title of HostPath Volumes",
          failingCount: 1,
        },
      ],
    });
  });

  test("the workloads read, by the framework that read the most", () => {
    expect(summary.workloadCount).toBe(12);
  });

  test("a framework turned off for the cluster has no score and fails nothing", () => {
    expect(summary.frameworks[2]).toMatchObject({
      framework: KubernetesComplianceFramework.CisKubernetes,
      isTurnedOff: true,
      score: null,
      failingControls: [],
    });
  });

  test("the lowest score of what applies is what the page sorts by", () => {
    expect(getLowestKubernetesComplianceScore(summary)).toBe(20);
    expect(getLowestKubernetesComplianceScore(null)).toBeNull();
    expect(
      getLowestKubernetesComplianceScore({
        frameworks: [
          { ...summary.frameworks[0]!, score: null },
          { ...summary.frameworks[1]!, isTurnedOff: true },
        ],
      }),
    ).toBeNull();
  });

  test("it is small: a cluster's findings stay on its own page", () => {
    expect(JSON.stringify(summary)).not.toContain("findings");
    expect(JSON.stringify(summary).length).toBeLessThan(2000);
  });
});

describe("a stored summary, read back", () => {
  const stored: unknown = JSON.parse(
    JSON.stringify(
      summarizeKubernetesCompliance(
        compliance([
          framework({ framework: KubernetesComplianceFramework.PssBaseline }),
        ]),
        REFRESHED_AT,
      ),
    ),
  );

  test("reads as it was written", () => {
    expect(readKubernetesComplianceSummary(stored)).toEqual(stored);
  });

  test("takes a framework it does not know: a new one needs no change here", () => {
    const withNew: Record<string, unknown> = JSON.parse(JSON.stringify(stored));
    (withNew["frameworks"] as Array<Record<string, unknown>>).push({
      framework: "NSA/CISA Hardening",
      fullName: "NSA/CISA Kubernetes Hardening Guide",
      score: 64.4,
      isTurnedOff: false,
      failingControls: [
        { requirement: "Non-root containers", failingCount: 2 },
      ],
    });

    expect(readKubernetesComplianceSummary(withNew)?.frameworks[1]).toEqual({
      framework: "NSA/CISA Hardening",
      fullName: "NSA/CISA Kubernetes Hardening Guide",
      score: 64,
      isTurnedOff: false,
      controlsEvaluated: 0,
      controlsPassing: 0,
      controlsNotEvaluated: 0,
      workloadsEvaluated: 0,
      workloadsPassing: 0,
      workloadsFromTemplates: 0,
      acceptedCount: 0,
      failingControls: [
        {
          requirement: "Non-root containers",
          title: "Non-root containers",
          failingCount: 2,
        },
      ],
    });
  });

  test("one of another version, or not a summary at all, reads as not scored yet", () => {
    expect(
      readKubernetesComplianceSummary({
        ...(stored as Record<string, unknown>),
        version: KUBERNETES_COMPLIANCE_SUMMARY_VERSION + 1,
      }),
    ).toBeNull();
    expect(
      readKubernetesComplianceSummary({
        ...(stored as Record<string, unknown>),
        refreshedAt: "yesterday",
      }),
    ).toBeNull();
    expect(readKubernetesComplianceSummary(null)).toBeNull();
    expect(readKubernetesComplianceSummary("text")).toBeNull();
    expect(readKubernetesComplianceSummary([stored])).toBeNull();
  });

  test("a field of the wrong type is read as none, and a broken framework left out", () => {
    const broken: Record<string, unknown> = JSON.parse(JSON.stringify(stored));
    const frameworks: Array<Record<string, unknown>> = broken[
      "frameworks"
    ] as Array<Record<string, unknown>>;
    frameworks[0]!["score"] = "high";
    frameworks[0]!["workloadsEvaluated"] = -3;
    frameworks[0]!["failingControls"] = [{ title: "no id" }, "text"];
    frameworks.push({ score: 10 });
    broken["podCount"] = "many";

    const read: KubernetesComplianceSummary | null =
      readKubernetesComplianceSummary(broken);

    expect(read?.podCount).toBe(0);
    expect(read?.frameworks).toHaveLength(1);
    expect(read?.frameworks[0]).toMatchObject({
      score: null,
      workloadsEvaluated: 0,
      failingControls: [],
    });
  });
});

describe("when a summary is due again", () => {
  test("never scored: at once", () => {
    for (const isConnected of [true, false]) {
      expect(
        isKubernetesComplianceSummaryDue({
          refreshedAt: null,
          isConnected,
          now: REFRESHED_AT,
        }),
      ).toBe(true);
    }
    expect(
      isKubernetesComplianceSummaryDue({
        refreshedAt: "not a date",
        isConnected: false,
        now: REFRESHED_AT,
      }),
    ).toBe(true);
  });

  test("its agent reporting: once the refresh interval has passed", () => {
    expect(KUBERNETES_COMPLIANCE_SUMMARY_REFRESH_MINUTES).toBe(15);
    expect(
      isKubernetesComplianceSummaryDue({
        refreshedAt: REFRESHED_AT,
        isConnected: true,
        now: minutesAfter(REFRESHED_AT, 14),
      }),
    ).toBe(false);
    expect(
      isKubernetesComplianceSummaryDue({
        refreshedAt: REFRESHED_AT,
        isConnected: true,
        now: minutesAfter(REFRESHED_AT, 15),
      }),
    ).toBe(true);
  });

  test("its agent silent: only once it is an hour old, its inventory not having moved", () => {
    expect(KUBERNETES_COMPLIANCE_SUMMARY_MAX_AGE_MINUTES).toBe(60);
    expect(
      isKubernetesComplianceSummaryDue({
        refreshedAt: REFRESHED_AT.toISOString(),
        isConnected: false,
        now: minutesAfter(REFRESHED_AT, 59),
      }),
    ).toBe(false);
    expect(
      isKubernetesComplianceSummaryDue({
        refreshedAt: REFRESHED_AT.toISOString(),
        isConnected: false,
        now: minutesAfter(REFRESHED_AT, 60),
      }),
    ).toBe(true);
  });
});

describe("how fresh the page says a summary is", () => {
  test("not scored yet", () => {
    expect(
      getKubernetesComplianceSummaryFreshness({
        refreshedAt: undefined,
        isConnected: true,
        now: REFRESHED_AT,
      }),
    ).toBe(KubernetesComplianceSummaryFreshness.Missing);
  });

  test("fresh while its agent reports and the job keeps up", () => {
    expect(
      getKubernetesComplianceSummaryFreshness({
        refreshedAt: REFRESHED_AT,
        isConnected: true,
        now: minutesAfter(
          REFRESHED_AT,
          KUBERNETES_COMPLIANCE_SUMMARY_LATE_MINUTES,
        ),
      }),
    ).toBe(KubernetesComplianceSummaryFreshness.Fresh);
  });

  test("late once it is twice the refresh interval old, its agent still reporting", () => {
    expect(KUBERNETES_COMPLIANCE_SUMMARY_LATE_MINUTES).toBe(30);
    expect(
      getKubernetesComplianceSummaryFreshness({
        refreshedAt: REFRESHED_AT,
        isConnected: true,
        now: minutesAfter(REFRESHED_AT, 31),
      }),
    ).toBe(KubernetesComplianceSummaryFreshness.Late);
  });

  test("from the agent's last report once it stopped reporting, however recently scored", () => {
    expect(
      getKubernetesComplianceSummaryFreshness({
        refreshedAt: REFRESHED_AT,
        isConnected: false,
        now: minutesAfter(REFRESHED_AT, 1),
      }),
    ).toBe(KubernetesComplianceSummaryFreshness.Disconnected);
  });
});
