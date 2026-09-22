import {
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  UNATTENDED_REMEDIATION_MODES,
  getKubernetesAgentRunnerName,
  isInClusterPostureForCluster,
  isKubernetesAgentRunnerPosture,
  isSameKubernetesClusterIdentifier,
  isUnattendedRemediationMode,
  normalizeKubernetesClusterIdentifier,
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
 * - the Runner posture is parsed defensively from untrusted hostInfo;
 * - "is this the same cluster?" is ONE rule (case-insensitive, trimmed,
 *   never true for blanks) shared by the readiness status, the enqueue
 *   chokepoint and the claim path, and "may this Runner run credential-less
 *   kubectl for cluster X?" is true only for the in-cluster agent OF X.
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

describe("normalizeKubernetesClusterIdentifier", () => {
  it("trims and lowercases a string and turns anything else into an empty string", () => {
    expect(normalizeKubernetesClusterIdentifier("  Prod-US ")).toBe("prod-us");
    expect(normalizeKubernetesClusterIdentifier("prod-us")).toBe("prod-us");
    expect(normalizeKubernetesClusterIdentifier("")).toBe("");
    expect(normalizeKubernetesClusterIdentifier("   ")).toBe("");
    expect(normalizeKubernetesClusterIdentifier(undefined)).toBe("");
    expect(normalizeKubernetesClusterIdentifier(null)).toBe("");
    expect(normalizeKubernetesClusterIdentifier(42)).toBe("");
    expect(normalizeKubernetesClusterIdentifier({ name: "prod" })).toBe("");
  });
});

describe("isSameKubernetesClusterIdentifier", () => {
  it("matches the same cluster across casing and surrounding whitespace", () => {
    expect(isSameKubernetesClusterIdentifier("prod-us", "prod-us")).toBe(true);
    expect(isSameKubernetesClusterIdentifier("Prod-US", "prod-us")).toBe(true);
    expect(isSameKubernetesClusterIdentifier("  prod-us", "prod-us ")).toBe(
      true,
    );
  });

  it("never matches different clusters", () => {
    expect(isSameKubernetesClusterIdentifier("prod-us", "prod-eu")).toBe(false);
    expect(isSameKubernetesClusterIdentifier("prod-us", "prod-us-2")).toBe(
      false,
    );
    expect(isSameKubernetesClusterIdentifier("prod", "prod-us")).toBe(false);
  });

  /*
   * The load-bearing edge: two blanks are NOT "the same cluster". A Runner
   * that never said which cluster it is in must not match a cluster row
   * that has no identifier, or a credential-less command would be served
   * to a pod nobody can place.
   */
  it("never matches when either side is blank or missing", () => {
    expect(isSameKubernetesClusterIdentifier("", "")).toBe(false);
    expect(isSameKubernetesClusterIdentifier("   ", "  ")).toBe(false);
    expect(isSameKubernetesClusterIdentifier(undefined, undefined)).toBe(false);
    expect(isSameKubernetesClusterIdentifier(null, null)).toBe(false);
    expect(isSameKubernetesClusterIdentifier("prod-us", "")).toBe(false);
    expect(isSameKubernetesClusterIdentifier("", "prod-us")).toBe(false);
    expect(isSameKubernetesClusterIdentifier("prod-us", undefined)).toBe(false);
    expect(isSameKubernetesClusterIdentifier(undefined, "prod-us")).toBe(false);
  });

  it("does not coerce non-strings into a match", () => {
    expect(isSameKubernetesClusterIdentifier(42, 42)).toBe(false);
    expect(isSameKubernetesClusterIdentifier("42", 42)).toBe(false);
    expect(isSameKubernetesClusterIdentifier({}, {})).toBe(false);
  });
});

describe("isKubernetesAgentRunnerPosture", () => {
  it("is true only for an in-cluster posture that names its cluster", () => {
    expect(
      isKubernetesAgentRunnerPosture({
        inCluster: true,
        clusterIdentifier: "prod-us",
      }),
    ).toBe(true);
  });

  it("is false for a pod Runner that never said which cluster it is in", () => {
    expect(isKubernetesAgentRunnerPosture({ inCluster: true })).toBe(false);
    expect(
      isKubernetesAgentRunnerPosture({
        inCluster: true,
        clusterIdentifier: "",
      }),
    ).toBe(false);
    expect(
      isKubernetesAgentRunnerPosture({
        inCluster: true,
        clusterIdentifier: "   ",
      }),
    ).toBe(false);
  });

  it("is false for an external Runner even when it names a cluster", () => {
    expect(
      isKubernetesAgentRunnerPosture({
        inCluster: false,
        clusterIdentifier: "prod-us",
      }),
    ).toBe(false);
    expect(
      isKubernetesAgentRunnerPosture({ clusterIdentifier: "prod-us" }),
    ).toBe(false);
  });

  it("is false for no posture at all", () => {
    expect(isKubernetesAgentRunnerPosture(undefined)).toBe(false);
    expect(
      isKubernetesAgentRunnerPosture(parseKubernetesRunnerPosture({})),
    ).toBe(false);
  });
});

describe("isInClusterPostureForCluster", () => {
  const agentOfProdUs: KubernetesRunnerPosture = {
    inCluster: true,
    allowWrites: true,
    clusterIdentifier: "prod-us",
  };

  it("is true for the in-cluster agent of that cluster, case-insensitively", () => {
    expect(isInClusterPostureForCluster(agentOfProdUs, "prod-us")).toBe(true);
    expect(isInClusterPostureForCluster(agentOfProdUs, "PROD-US")).toBe(true);
    expect(isInClusterPostureForCluster(agentOfProdUs, " prod-us ")).toBe(true);
  });

  /*
   * The finding: a Runner that is in-cluster somewhere ELSE must never be
   * "in-cluster" for this cluster — its ServiceAccount reaches the other
   * cluster only.
   */
  it("is false for the in-cluster agent of a different cluster", () => {
    expect(isInClusterPostureForCluster(agentOfProdUs, "prod-eu")).toBe(false);
    expect(isInClusterPostureForCluster(agentOfProdUs, "prod-us-2")).toBe(
      false,
    );
  });

  it("is false for an in-cluster Runner with no cluster identity", () => {
    expect(isInClusterPostureForCluster({ inCluster: true }, "prod-us")).toBe(
      false,
    );
  });

  it("is false when the cluster row itself has no identifier", () => {
    expect(isInClusterPostureForCluster(agentOfProdUs, "")).toBe(false);
    expect(isInClusterPostureForCluster(agentOfProdUs, undefined)).toBe(false);
  });

  it("is false for an external Runner and for no posture", () => {
    expect(
      isInClusterPostureForCluster(
        { inCluster: false, clusterIdentifier: "prod-us" },
        "prod-us",
      ),
    ).toBe(false);
    expect(isInClusterPostureForCluster(undefined, "prod-us")).toBe(false);
  });

  it("works on a posture parsed from raw hostInfo", () => {
    const parsed: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: { inCluster: true, clusterIdentifier: "Prod-US" },
      });

    expect(isInClusterPostureForCluster(parsed, "prod-us")).toBe(true);
    expect(isInClusterPostureForCluster(parsed, "prod-eu")).toBe(false);
  });
});
