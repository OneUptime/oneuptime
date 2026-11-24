import {
  ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS,
  CIS_NOT_SCORED,
  CisNotScoredGroup,
  CisNotScoredReason,
  KUBERNETES_COMPLIANCE_CONTROLS,
  KUBERNETES_COMPLIANCE_FRAMEWORK_INFO,
  KubernetesComplianceControlInfo,
  KubernetesComplianceFramework,
  getCisNotScoredControlCount,
  getKubernetesComplianceControls,
  isKubernetesComplianceFramework,
  isKubernetesComplianceRequirement,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { CIS_SCORED_CONTROLS } from "../../../../Types/Kubernetes/Compliance/CisKubernetesBenchmark";
import {
  BASELINE_CONTROLS,
  RESTRICTED_ONLY_CONTROLS,
} from "../../../../Types/Kubernetes/Compliance/PodSecurityStandards";
import { ALL_COMPLIANCE_FRAMEWORKS } from "../../../../Types/DataSecurity/ComplianceFramework";
import { describe, expect, test } from "@jest/globals";

/*
 * The Kubernetes frameworks' catalog (#9627): every control of the Pod
 * Security Standards and every scored policy control of the CIS Kubernetes
 * Benchmark has a title, what it finds wrong and how to fix it; the rest of
 * the benchmark is said not to be scored, and why; and the benchmark's own
 * text is never reproduced.
 */

// The CIS Kubernetes Benchmark v2.0's section 5, by number, in its order.
const CIS_SECTION_FIVE: Array<string> = [
  "5.1.1",
  "5.1.2",
  "5.1.3",
  "5.1.4",
  "5.1.5",
  "5.1.6",
  "5.1.7",
  "5.1.8",
  "5.1.9",
  "5.1.10",
  "5.1.11",
  "5.1.12",
  "5.1.13",
  "5.2.1",
  "5.2.2",
  "5.2.3",
  "5.2.4",
  "5.2.5",
  "5.2.6",
  "5.2.7",
  "5.2.8",
  "5.2.9",
  "5.2.10",
  "5.2.11",
  "5.2.12",
  "5.3.1",
  "5.3.2",
  "5.4.1",
  "5.4.2",
  "5.5.1",
  "5.6.1",
  "5.6.2",
  "5.6.3",
  "5.6.4",
];

describe("the frameworks", () => {
  test("are the two Pod Security Standards policies, the CIS benchmark and the NSA/CISA guide, with names apart from the data frameworks'", () => {
    expect(ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS).toEqual([
      "PSS Baseline",
      "PSS Restricted",
      "CIS Kubernetes",
      "NSA/CISA Hardening",
    ]);
    for (const framework of ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS) {
      expect(isKubernetesComplianceFramework(framework)).toBe(true);
      expect(ALL_COMPLIANCE_FRAMEWORKS as Array<string>).not.toContain(
        framework,
      );
      expect(
        KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
      ).toBeTruthy();
      expect(KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[framework].scope).toMatch(
        /\.$/,
      );
    }
    expect(isKubernetesComplianceFramework("GDPR")).toBe(false);
    expect(isKubernetesComplianceFramework(undefined)).toBe(false);
  });
});

describe("the controls", () => {
  test("Baseline has the standard's twelve, Restricted those and its six, by the standard's names", () => {
    expect(
      getKubernetesComplianceControls(
        KubernetesComplianceFramework.PssBaseline,
      ).map((control: KubernetesComplianceControlInfo): string => {
        return control.requirement;
      }),
    ).toEqual([...BASELINE_CONTROLS]);
    expect(
      getKubernetesComplianceControls(
        KubernetesComplianceFramework.PssRestricted,
      ).map((control: KubernetesComplianceControlInfo): string => {
        return control.requirement;
      }),
    ).toEqual([...BASELINE_CONTROLS, ...RESTRICTED_ONLY_CONTROLS]);
  });

  test("the CIS benchmark's section 5 is all here: each control scored, or said not to be", () => {
    const scored: Array<string> = getKubernetesComplianceControls(
      KubernetesComplianceFramework.CisKubernetes,
    ).map((control: KubernetesComplianceControlInfo): string => {
      return control.requirement;
    });
    const notScored: Array<string> = CIS_NOT_SCORED.filter(
      (group: CisNotScoredGroup): boolean => {
        return group.id.startsWith("5.");
      },
    ).map((group: CisNotScoredGroup): string => {
      return group.id;
    });

    expect(scored).toEqual(Object.keys(CIS_SCORED_CONTROLS));
    expect(scored).toHaveLength(27);
    expect(
      [...scored, ...notScored].sort((a: string, b: string): number => {
        return CIS_SECTION_FIVE.indexOf(a) - CIS_SECTION_FIVE.indexOf(b);
      }),
    ).toEqual(CIS_SECTION_FIVE);
    for (const id of notScored) {
      expect(scored).not.toContain(id);
    }
  });

  test("every control says what it finds wrong and how to fix it, each in a sentence", () => {
    for (const control of KUBERNETES_COMPLIANCE_CONTROLS) {
      expect([control.requirement, control.title.length > 0]).toEqual([
        control.requirement,
        true,
      ]);
      expect(control.description).toMatch(/^[A-Z].*\.$/);
      expect(control.fix).toMatch(/^[A-Z].*\.$/);
      expect(control.isNumbered).toBe(
        control.framework === KubernetesComplianceFramework.CisKubernetes,
      );
      // The guide numbers nothing: each of its controls names its section instead (#9875).
      expect(Boolean(control.section)).toBe(
        control.framework === KubernetesComplianceFramework.NsaCisaHardening,
      );
    }
  });

  test("a setting may name only a scored control of its framework", () => {
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.PssRestricted,
        "Volume Types",
      ),
    ).toBe(true);
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.PssBaseline,
        "Volume Types",
      ),
    ).toBe(false);
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.CisKubernetes,
        "5.1.3",
      ),
    ).toBe(true);
    // Not scored here, so nothing to turn off.
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.CisKubernetes,
        "5.1.7",
      ),
    ).toBe(false);
    /*
     * A node or control plane control kube-bench scores (#9873), the generic
     * benchmark's or a managed platform's, may be named before it runs.
     */
    for (const requirement of [
      "1.2.1",
      "2.1",
      "4.2.1",
      "EKS 3.2.1",
      "GKE 3.1.1",
      "AKS 3.2.9",
    ]) {
      expect([
        requirement,
        isKubernetesComplianceRequirement(
          KubernetesComplianceFramework.CisKubernetes,
          requirement,
        ),
      ]).toEqual([requirement, true]);
    }
    // But never one outside the sections kube-bench reads, or another framework's.
    for (const requirement of [
      "6.1",
      "EKS 4.1.1",
      "EKS3.2.1",
      "eks 3.2.1",
      "4",
    ]) {
      expect([
        requirement,
        isKubernetesComplianceRequirement(
          KubernetesComplianceFramework.CisKubernetes,
          requirement,
        ),
      ]).toEqual([requirement, false]);
    }
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.PssRestricted,
        "4.2.1",
      ),
    ).toBe(false);
    // The NSA/CISA guide's controls by their English titles (#9875).
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.NsaCisaHardening,
        "Default-deny network policies",
      ),
    ).toBe(true);
    expect(
      isKubernetesComplianceRequirement(
        KubernetesComplianceFramework.NsaCisaHardening,
        "5.1.1",
      ),
    ).toBe(false);
  });
});

describe("the CIS benchmark's own text", () => {
  /*
   * CIS publishes its benchmarks under terms that keep their text out of
   * other products: a control is named by its number and a short title of
   * OneUptime's own, never the recommendation as the benchmark words it.
   */
  test("no title, description or fix opens as the benchmark's recommendations do", () => {
    const cisWords: Array<string> = [
      ...getKubernetesComplianceControls(
        KubernetesComplianceFramework.CisKubernetes,
      ).flatMap((control: KubernetesComplianceControlInfo): Array<string> => {
        return [control.title, control.description, control.fix];
      }),
      ...CIS_NOT_SCORED.flatMap((group: CisNotScoredGroup): Array<string> => {
        return [group.title, group.why || ""];
      }),
    ];

    for (const words of cisWords) {
      expect(words).not.toMatch(
        /^(Ensure|Minimize|Minimise|Avoid|Limit use|Prefer|Consider|Configure|Create administrative|Apply Security Context)/,
      );
      expect(words).not.toMatch(/\((Manual|Automated)\)/);
    }
  });
});

describe("what the benchmark asks that is not scored", () => {
  test("says plainly which need node or control plane access, and which a person's review", () => {
    const byReason: Record<string, Array<string>> = {};

    for (const group of CIS_NOT_SCORED) {
      byReason[group.reason] = [...(byReason[group.reason] || []), group.id];
    }

    expect(byReason).toEqual({
      [CisNotScoredReason.NodeAccess]: ["1.1", "4.1", "4.2", "4.3"],
      [CisNotScoredReason.ControlPlaneAccess]: [
        "1.2",
        "1.3",
        "1.4",
        "2",
        "3.1",
        "3.2",
        "5.5.1",
      ],
      [CisNotScoredReason.Manual]: [
        "5.1.6",
        "5.1.7",
        "5.3.1",
        "5.4.2",
        "5.6.1",
        "5.6.3",
      ],
    });
  });

  test("counts the benchmark's 97 node and control plane controls and its 7 policy controls no API answers", () => {
    expect(getCisNotScoredControlCount()).toBe(97 + 7);
  });

  test("each control a person must review says why", () => {
    for (const group of CIS_NOT_SCORED) {
      if (group.reason === CisNotScoredReason.Manual) {
        expect([group.id, group.why]).toEqual([
          group.id,
          expect.stringMatching(/^[A-Z].*\.$/),
        ]);
      }
    }
  });
});
