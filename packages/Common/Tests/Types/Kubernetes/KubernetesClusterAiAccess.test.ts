import {
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  UNATTENDED_REMEDIATION_MODES,
  getKubernetesAgentRunnerName,
  isUnattendedRemediationMode,
  parseKubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the shared vocabulary of AI cluster access:
 *
 * - exactly four remediation modes exist and exactly two of them run
 *   without a human (Automatic, BypassApproval); every branch that decides
 *   "does this run unattended?" goes through isUnattendedRemediationMode,
 *   so a new mode cannot silently become attended or unattended;
 * - the in-cluster Runner's name is derived from the cluster identifier;
 * - the Runner posture is parsed defensively from untrusted hostInfo.
 */

describe("KubernetesAiRemediationMode", () => {
  it("has exactly the four operator-facing modes", () => {
    expect(Object.values(KubernetesAiRemediationMode).sort()).toEqual(
      ["Automatic", "BypassApproval", "Disabled", "RequireApproval"].sort(),
    );
  });

  it("treats Automatic and BypassApproval as unattended and nothing else", () => {
    expect(UNATTENDED_REMEDIATION_MODES).toEqual([
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ]);

    expect(
      isUnattendedRemediationMode(KubernetesAiRemediationMode.Automatic),
    ).toBe(true);
    expect(
      isUnattendedRemediationMode(KubernetesAiRemediationMode.BypassApproval),
    ).toBe(true);
    expect(
      isUnattendedRemediationMode(KubernetesAiRemediationMode.RequireApproval),
    ).toBe(false);
    expect(
      isUnattendedRemediationMode(KubernetesAiRemediationMode.Disabled),
    ).toBe(false);
    expect(isUnattendedRemediationMode(undefined)).toBe(false);
  });

  it("never treats a string that merely looks like a mode as unattended", () => {
    expect(
      isUnattendedRemediationMode(
        "automatic" as unknown as KubernetesAiRemediationMode,
      ),
    ).toBe(false);
    expect(
      isUnattendedRemediationMode(
        "Bypass" as unknown as KubernetesAiRemediationMode,
      ),
    ).toBe(false);
  });
});

describe("getKubernetesAgentRunnerName", () => {
  it("derives a stable, prefixed name from the cluster identifier", () => {
    expect(getKubernetesAgentRunnerName("prod-us")).toBe(
      "kubernetes-agent/prod-us",
    );
    expect(getKubernetesAgentRunnerName("prod-us")).toBe(
      getKubernetesAgentRunnerName("prod-us"),
    );
  });
});

describe("parseKubernetesRunnerPosture", () => {
  it("returns undefined for a Runner that never reported a Kubernetes posture", () => {
    expect(parseKubernetesRunnerPosture(undefined)).toBeUndefined();
    expect(parseKubernetesRunnerPosture(null)).toBeUndefined();
    expect(parseKubernetesRunnerPosture("nope")).toBeUndefined();
    expect(parseKubernetesRunnerPosture({})).toBeUndefined();
    expect(
      parseKubernetesRunnerPosture({ kubernetes: "not-an-object" }),
    ).toBeUndefined();
  });

  it("parses a complete posture and only accepts literal true for the booleans", () => {
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: {
          clusterIdentifier: "prod-us",
          inCluster: true,
          allowWrites: "true",
          kubectlVersion: "v1.31.4",
          agentChartVersion: "0.7.0",
        },
      });

    expect(posture).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      kubectlVersion: "v1.31.4",
      agentChartVersion: "0.7.0",
    });
  });

  it("drops non-string identifiers rather than coercing them", () => {
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: { clusterIdentifier: 42, kubectlVersion: {} },
      });

    expect(posture?.clusterIdentifier).toBeUndefined();
    expect(posture?.kubectlVersion).toBeUndefined();
    expect(posture?.inCluster).toBe(false);
    expect(posture?.allowWrites).toBe(false);
  });
});
