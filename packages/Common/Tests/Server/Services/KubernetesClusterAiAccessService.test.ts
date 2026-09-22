import KubernetesClusterAiAccessService, {
  KubernetesClusterAiAccessProjectGates,
  MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT,
  MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR,
  RegisterKubernetesAgentRunnerResult,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import logger from "../../../Server/Utils/Logger";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner, {
  RunnerConnectionStatus,
} from "../../../Models/DatabaseModels/Runner";
import OneUptimeDate from "../../../Types/Date";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  getKubernetesAgentRunnerName,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the readiness computation behind a cluster's AI
 * page and the in-cluster Runner's self-registration:
 *
 * - every reason OneUptime AI cannot reach or change a cluster becomes a
 *   gap with a next step, and readiness is derived ONLY from gaps: no
 *   Runner, an offline Runner, a Runner without the AI-commands capability,
 *   an external Runner without a Kubernetes credential, a read-only
 *   in-cluster Runner asked to remediate, and every project gate;
 * - "in-cluster" access is only ever the in-cluster Runner OF THIS CLUSTER:
 *   a bound Runner that runs inside a different cluster (or never said
 *   which) is a gap, never credential-less access to the wrong cluster;
 * - investigation and remediation readiness are independent: a gap that
 *   only blocks remediation never reads as "AI cannot investigate";
 * - registration with the ingestion key creates the agent Runner row with
 *   exactly the kubectl capability (never runbooks or code fixes), binds a
 *   never-configured cluster with investigation on and remediation
 *   "ask for approval" when the chart granted writes (keeping a mode an
 *   operator chose beforehand), rotates the key on a restart WITHOUT
 *   touching the operator's switches, never steals a
 *   cluster an operator bound to a different Runner, never re-binds a
 *   cluster an operator cleared, only reuses a Runner that is THIS
 *   cluster's agent, refuses to re-key a Runner that is online unless the
 *   caller proves it holds the current key, bounds how many agent Runner
 *   rows an ingestion key can mint, and records every bind and rotation on
 *   the cluster's feed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const READY_GATES: KubernetesClusterAiAccessProjectGates = {
  isAiEnabled: true,
  isAutoRemediationEnabled: true,
  isAiCommandExecutionEnabled: true,
  hasLlmProvider: true,
};

function fakeCluster(
  overrides: Partial<Record<string, unknown>> = {},
): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-us",
    clusterIdentifier: "prod-us",
    aiAccessRunnerId: RUNNER_ID,
    aiAccessCredentialId: undefined,
    isAiInvestigationEnabled: true,
    aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    aiKubectlCommandAllowlist: undefined,
    ...overrides,
  } as unknown as KubernetesCluster;
}

function fakeRunner(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: RUNNER_ID,
    _id: RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    lastAlive: OneUptimeDate.getCurrentDate(),
    canRunAiCommands: true,
    hostInfo: {
      kubernetes: {
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
      },
    },
    ...overrides,
  } as unknown as Runner;
}

function gapCodes(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGapCode> {
  return status.gaps.map((gap: KubernetesAiAccessGap) => {
    return gap.code;
  });
}

describe("KubernetesClusterAiAccessService.getStatusForClusterModel", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is ready for both when an online in-cluster Runner with writes is bound and every gate passes", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(status.gaps).toEqual([]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(true);
    expect(status.accessMethod).toBe("in_cluster");
    expect(status.runner?.isOnline).toBe(true);
    expect(status.runner?.posture?.allowWrites).toBe(true);
    expect(status.kubectlAllowlist).toEqual([]);
  });

  it("reports no_runner_bound and blocks both when the cluster has no Runner", async () => {
    const findOneBy: jest.SpyInstance = jest.spyOn(RunnerService, "findOneBy");

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessRunnerId: undefined }),
        gates: READY_GATES,
      });

    expect(findOneBy).not.toHaveBeenCalled();
    expect(gapCodes(status)).toEqual(["no_runner_bound"]);
    expect(status.gaps[0]?.blocks).toBe("both");
    expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
    expect(status.runner).toBeNull();
    expect(status.accessMethod).toBe("none");
  });

  it("reports runner_missing when the bound Runner was deleted", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_missing"]);
    expect(status.isInvestigationReady).toBe(false);
  });

  it("reports runner_offline (never connected vs stale) and keeps the Runner summary", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner({ lastAlive: undefined }));

    const never: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(never)).toEqual(["runner_offline"]);
    expect(never.gaps[0]?.title).toContain("never connected");
    expect(never.runner?.isOnline).toBe(false);

    jest.restoreAllMocks();
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      );

    const stale: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(stale)).toEqual(["runner_offline"]);
    expect(stale.gaps[0]?.title).toBe("The Runner is offline");
    expect(stale.gaps[0]?.nextStep).toContain("component=ai-runner");
  });

  it("reports runner_ai_commands_disabled when the capability is off", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner({ canRunAiCommands: false }));

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_ai_commands_disabled"]);
    expect(status.runner?.canRunAiCommands).toBe(false);
  });

  it("requires a Kubernetes credential assigned to an external Runner", async () => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );

    const noCredential: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(noCredential)).toEqual(["credential_missing"]);
    expect(noCredential.accessMethod).toBe("none");

    // Credential exists but is not assigned to this Runner.
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: CREDENTIAL_ID,
      _id: CREDENTIAL_ID.toString(),
      name: "prod kubeconfig",
      credentialType: "Kubernetes",
      runners: [],
    } as unknown as RunbookCredential);

    const unassigned: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
        gates: READY_GATES,
      });

    expect(gapCodes(unassigned)).toEqual(["credential_missing"]);
    expect(unassigned.gaps[0]?.description).toContain("not assigned");

    // Assigned Kubernetes credential: ready, and the id travels on the status.
    jest.restoreAllMocks();
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(
        fakeRunner({ name: "office-runner", hostInfo: { hostname: "x" } }),
      );
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: CREDENTIAL_ID,
      _id: CREDENTIAL_ID.toString(),
      name: "prod kubeconfig",
      credentialType: "Kubernetes",
      runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
    } as unknown as RunbookCredential);

    const assigned: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
        gates: READY_GATES,
      });

    expect(assigned.gaps).toEqual([]);
    expect(assigned.accessMethod).toBe("credential");
    expect(assigned.credentialId).toBe(CREDENTIAL_ID.toString());
    expect(assigned.credentialName).toBe("prod kubeconfig");
  });

  /*
   * The cross-cluster hole: the dashboard lets an operator bind ANY Runner,
   * and a Runner that is in-cluster in cluster B would run every command
   * for cluster A against B's ServiceAccount. In-cluster access therefore
   * exists only for the Runner whose posture names THIS cluster.
   */
  describe("in-cluster access is only the in-cluster Runner of this cluster", () => {
    it("refuses the in-cluster Runner of a different cluster with a gap that blocks both", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
      expect(status.gaps[0]?.blocks).toBe("both");
      expect(status.gaps[0]?.title).toContain("different cluster");
      expect(status.gaps[0]?.description).toContain('"prod-eu"');
      expect(status.gaps[0]?.description).toContain('"prod-us"');
      expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
      expect(status.accessMethod).toBe("none");
      expect(status.credentialId).toBeUndefined();
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
      // The Runner is still described, so the page can say WHICH Runner.
      expect(status.runner?.name).toBe("kubernetes-agent/prod-eu");
      expect(status.runner?.posture?.clusterIdentifier).toBe("prod-eu");
    });

    it("refuses a pod Runner that never said which cluster it runs in", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true, allowWrites: true } },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
      expect(status.gaps[0]?.title).toContain("did not report which cluster");
      expect(status.accessMethod).toBe("none");
      expect(status.isInvestigationReady).toBe(false);
    });

    it("never treats a blank cluster identifier on the cluster row as a match", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ clusterIdentifier: "" }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["runner_cluster_mismatch"]);
      expect(status.accessMethod).toBe("none");
    });

    it("matches the cluster identifier case-insensitively and with surrounding whitespace", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "  PROD-us ",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ clusterIdentifier: "prod-us" }),
          gates: READY_GATES,
        });

      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("in_cluster");
      expect(status.isInvestigationReady).toBe(true);
    });

    it("falls back to a bound, assigned Kubernetes credential when the Runner is another cluster's agent", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );
      jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
        id: CREDENTIAL_ID,
        _id: CREDENTIAL_ID.toString(),
        name: "prod-us kubeconfig",
        credentialType: "Kubernetes",
        runners: [{ id: RUNNER_ID, _id: RUNNER_ID.toString() }],
      } as unknown as RunbookCredential);

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      // The credential names the API server, so the pod's cluster is moot.
      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("credential");
      expect(status.credentialId).toBe(CREDENTIAL_ID.toString());
    });

    it("still reports the credential gap, not a mismatch, when the bound credential is unusable", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );
      jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["credential_missing"]);
      expect(status.accessMethod).toBe("none");
    });

    it("reports both the mismatch and the read-only gap for a read-only agent of another cluster", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: false,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual([
        "runner_cluster_mismatch",
        "remediation_write_access_missing",
      ]);
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
    });
  });

  it("blocks only remediation when the in-cluster Runner is read-only", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.gaps[0]?.blocks).toBe("remediation");
    expect(status.gaps[0]?.nextStep).toContain(
      "aiAccess.remediation.enabled=true",
    );
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("does not raise the read-only gap when remediation is off", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_disabled"]);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  it("keeps remediation ready when only investigation is switched off", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ isAiInvestigationEnabled: false }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["investigation_disabled"]);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(true);
  });

  it("turns every failed project gate into its own gap", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: {
          isAiEnabled: false,
          isAutoRemediationEnabled: false,
          isAiCommandExecutionEnabled: false,
          hasLlmProvider: false,
        },
      });

    expect(gapCodes(status)).toEqual([
      "project_ai_disabled",
      "llm_provider_missing",
      "project_auto_remediation_disabled",
      "project_ai_command_execution_disabled",
    ]);
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
  });

  it("is remediation-ready in BypassApproval mode with a write-capable Runner and reports the mode verbatim", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        gates: READY_GATES,
      });

    expect(status.gaps).toEqual([]);
    expect(status.remediationMode).toBe(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(status.isRemediationReady).toBe(true);
    expect(status.isInvestigationReady).toBe(true);
  });

  it("raises the read-only gap for a BypassApproval cluster whose Runner cannot write", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: false,
            clusterIdentifier: "prod-us",
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["remediation_write_access_missing"]);
    expect(status.remediationMode).toBe(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(status.isRemediationReady).toBe(false);
    expect(status.isInvestigationReady).toBe(true);
  });

  it("names every enabling mode in the remediation_disabled next step", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
        gates: READY_GATES,
      });

    expect(status.gaps[0]?.code).toBe("remediation_disabled");
    expect(status.gaps[0]?.nextStep).toContain("Ask for approval");
    expect(status.gaps[0]?.nextStep).toContain("Automatic");
    expect(status.gaps[0]?.nextStep).toContain("Bypass approval");
  });

  it("normalizes a JSON-string allowlist and an unknown mode fails closed to Disabled", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({
          aiRemediationMode: "Yolo",
          aiKubectlCommandAllowlist: '["kubectl set image *", "  "]',
        }),
        gates: READY_GATES,
      });

    expect(status.remediationMode).toBe(KubernetesAiRemediationMode.Disabled);
    expect(status.kubectlAllowlist).toEqual(["kubectl set image *"]);
  });
});

describe("KubernetesClusterAiAccessService.normalizeRemediationMode", () => {
  it("accepts every declared mode verbatim", () => {
    for (const mode of Object.values(KubernetesAiRemediationMode)) {
      expect(
        KubernetesClusterAiAccessService.normalizeRemediationMode(mode),
      ).toBe(mode);
    }
  });

  it("fails closed to Disabled for anything else, including case variants", () => {
    for (const value of [
      undefined,
      null,
      "",
      "automatic",
      "bypassapproval",
      "Bypass",
      "BYPASSAPPROVAL",
      " BypassApproval",
      42,
      true,
      {},
      ["BypassApproval"],
    ]) {
      expect(
        KubernetesClusterAiAccessService.normalizeRemediationMode(value),
      ).toBe(KubernetesAiRemediationMode.Disabled);
    }
  });
});

describe("KubernetesClusterAiAccessService.getFirstBindRemediationMode", () => {
  it("fills in the chart's intent only when the mode is still at its default", () => {
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: KubernetesAiRemediationMode.Disabled,
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: KubernetesAiRemediationMode.Disabled,
        allowWrites: false,
      }),
    ).toBe(KubernetesAiRemediationMode.Disabled);
    // A missing or unrecognised value is the default too.
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: undefined,
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
    expect(
      KubernetesClusterAiAccessService.getFirstBindRemediationMode({
        currentMode: "bypassapproval",
        allowWrites: true,
      }),
    ).toBe(KubernetesAiRemediationMode.RequireApproval);
  });

  it("keeps every mode an operator chose, whatever the chart granted", () => {
    for (const chosen of [
      KubernetesAiRemediationMode.RequireApproval,
      KubernetesAiRemediationMode.Automatic,
      KubernetesAiRemediationMode.BypassApproval,
    ]) {
      for (const allowWrites of [true, false]) {
        expect(
          KubernetesClusterAiAccessService.getFirstBindRemediationMode({
            currentMode: chosen,
            allowWrites,
          }),
        ).toBe(chosen);
      }
    }
  });
});

describe("KubernetesClusterAiAccessService.getProjectGates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads kill switches as enabled-by-default and command execution as opt-in", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: undefined,
      enableAutoRemediation: undefined,
      enableAiCommandExecution: undefined,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as LlmProvider);

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates).toEqual({
      isAiEnabled: true,
      isAutoRemediationEnabled: true,
      isAiCommandExecutionEnabled: false,
      hasLlmProvider: true,
    });
  });

  it("treats a provider lookup failure as no provider", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAiCommandExecution: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockRejectedValue(new Error("boom"));

    const gates: KubernetesClusterAiAccessProjectGates =
      await KubernetesClusterAiAccessService.getProjectGates(PROJECT_ID);

    expect(gates.hasLlmProvider).toBe(false);
    expect(gates.isAiCommandExecutionEnabled).toBe(true);
  });
});

describe("KubernetesClusterAiAccessService.registerKubernetesAgentRunner", () => {
  const OTHER_RUNNER_ID: ObjectID = new ObjectID(
    "66666666-6666-4666-8666-666666666666",
  );
  // Hex letters on purpose: the case-variant near-miss below must differ.
  const CURRENT_KEY: string = "9a9b9c9d-9e9f-4a9b-8c9d-9e9f9a9b9c9d";

  let clusterUpdates: Array<Record<string, unknown>>;
  let runnerUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  let createdRunner: Runner | null;
  let feedItems: Array<Record<string, unknown>>;
  let countBySpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  /*
   * An agent Runner row as the last heartbeat left it, OFFLINE: the pod it
   * belonged to stopped half an hour ago, which is the restart case that
   * must always be admitted.
   */
  function offlineAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return fakeRunner({
      key: CURRENT_KEY,
      lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      connectionStatus: RunnerConnectionStatus.Connected,
      ...overrides,
    });
  }

  // The same row while its pod is still heartbeating.
  function onlineAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return fakeRunner({
      key: CURRENT_KEY,
      lastAlive: OneUptimeDate.getCurrentDate(),
      connectionStatus: RunnerConnectionStatus.Connected,
      ...overrides,
    });
  }

  /*
   * Answers the two Runner lookups registration makes — by bound id and by
   * agent name — separately, so a test can put a different row behind each.
   */
  function mockRunnerLookups(data: {
    bound?: Runner | null | undefined;
    byName?: Runner | null | undefined;
  }): jest.SpyInstance {
    return jest
      .spyOn(RunnerService, "findOneBy")
      .mockImplementation(async (args: unknown): Promise<Runner | null> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["_id"]) {
          return data.bound ?? null;
        }

        return data.byName ?? null;
      });
  }

  beforeEach(() => {
    clusterUpdates = [];
    runnerUpdates = [];
    createdRunner = null;
    feedItems = [];

    warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        clusterUpdates.push((args as { data: Record<string, unknown> }).data);
        return undefined as never;
      });
    jest
      .spyOn(RunnerService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const call: { id: ObjectID; data: Record<string, unknown> } = args as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
        runnerUpdates.push({ id: call.id.toString(), data: call.data });
        return undefined as never;
      });
    jest
      .spyOn(RunnerService, "create")
      .mockImplementation(async (args: unknown): Promise<Runner> => {
        const data: Runner = (args as { data: Runner }).data;
        data.id = RUNNER_ID;
        createdRunner = data;
        return data;
      });
    countBySpy = jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockImplementation(async (args: unknown): Promise<void> => {
        feedItems.push(args as Record<string, unknown>);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an empty cluster name", async () => {
    await expect(
      KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "   ",
        posture: { allowWrites: true },
      }),
    ).rejects.toThrow("clusterName is required.");
  });

  describe("first bind of a never-configured cluster", () => {
    // A cluster row as ingest creates it: every AI switch at its default.
    function neverConfiguredCluster(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        ...overrides,
      });
    }

    it("creates a kubectl-only Runner, binds the cluster, turns investigation on and remediation to ask-for-approval", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          agentVersion: "9.1.0",
          posture: { allowWrites: true, kubectlVersion: "v1.31.4" },
        });

      expect(result.isFirstBind).toBe(true);
      expect(result.isBoundToCluster).toBe(true);
      expect(result.bindingState).toBe("first_bind");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
      expect(result.runnerKey).toHaveLength(36);

      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe(getKubernetesAgentRunnerName("prod-us"));
      expect(createdRunner!.canRunAiCommands).toBe(true);
      expect(createdRunner!.canRunRunbooks).toBe(false);
      expect(createdRunner!.canRunCodeFixTasks).toBe(false);
      expect(createdRunner!.key).toBe(result.runnerKey);
      expect(
        (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
          .kubernetes,
      ).toMatchObject({
        inCluster: true,
        allowWrites: true,
        clusterIdentifier: "prod-us",
        kubectlVersion: "v1.31.4",
      });

      expect(clusterUpdates).toHaveLength(1);
      expect(clusterUpdates[0]).toMatchObject({
        aiAccessRunnerId: RUNNER_ID,
        aiAccessCredentialId: null,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });

      // Recorded on the cluster feed so an operator can see it happened.
      expect(feedItems).toHaveLength(1);
      expect(feedItems[0]!["kubernetesClusterId"]).toBe(CLUSTER_ID);
      expect(feedItems[0]!["projectId"]).toBe(PROJECT_ID);
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "was bound as this cluster's AI access Runner",
      );
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Ask for approval"',
      );
    });

    it("without write RBAC leaves remediation Disabled", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: false },
      });

      expect(clusterUpdates[0]).toMatchObject({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "AI remediation is Disabled",
      );
    });

    /*
     * The dashboard is the control plane even before a Runner exists: an
     * operator may set the mode on the AI page and install the chart
     * afterwards. The chart's intent only fills in a switch still at its
     * default; it never downgrades a chosen mode to "ask for approval",
     * and never lifts one either.
     */
    it("keeps a remediation mode the operator chose before the Runner registered", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        neverConfiguredCluster({
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates).toHaveLength(1);
      expect(clusterUpdates[0]).toMatchObject({
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Automatic"',
      );
    });

    it("keeps a chosen write mode on a read-only chart too (the readiness gap handles it, not a silent downgrade)", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        neverConfiguredCluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
      );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: false },
      });

      expect(clusterUpdates[0]).toMatchObject({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      });
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        'AI remediation is "Bypass approval"',
      );
    });

    it("treats an unknown stored mode as the default and applies the chart's intent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          neverConfiguredCluster({ aiRemediationMode: "Yolo" }),
        );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      expect(clusterUpdates[0]).toMatchObject({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });
    });

    it("looks the agent Runner row up by name case-insensitively", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      const findOneBy: jest.SpyInstance = mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "Prod-US",
        posture: { allowWrites: true },
      });

      const nameQuery: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;

      expect(nameQuery["projectId"]).toBe(PROJECT_ID);
      /*
       * A findWithSameText operator, not the raw string: a chart that
       * registers "Prod-US" must find the row a "prod-us" registration made
       * instead of tripping the unique-name guard on a second create.
       */
      expect(typeof nameQuery["name"]).not.toBe("string");
      expect(nameQuery["name"]).toBeDefined();
    });
  });

  describe("re-registration of this cluster's agent (a pod restart)", () => {
    it("rotates the key and posture of the OFFLINE bound agent Runner but never touches the operator's switches", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: false },
        });

      expect(result.isFirstBind).toBe(false);
      expect(result.isBoundToCluster).toBe(true);
      expect(result.bindingState).toBe("already_bound");
      expect(createdRunner).toBeNull();
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(result.runnerKey).not.toBe(CURRENT_KEY);
      expect(
        (
          runnerUpdates[0]!.data["hostInfo"] as {
            kubernetes: { allowWrites: boolean; clusterIdentifier: string };
          }
        ).kubernetes,
      ).toMatchObject({ allowWrites: false, clusterIdentifier: "prod-us" });
      // No cluster write at all: the dashboard is the control plane.
      expect(clusterUpdates).toHaveLength(0);
      // Creation brakes are for new rows only.
      expect(countBySpy).not.toHaveBeenCalled();
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "key was rotated",
      );
    });

    it("also admits a Runner that signed off (Disconnected) even though its last heartbeat is recent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["connectionStatus"]).toBe(
        RunnerConnectionStatus.Connected,
      );
    });

    it("admits a Runner that never heartbeated at all", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({ lastAlive: undefined }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
    });
  });

  /*
   * The ingestion key is held by every collector and CI job in the project.
   * With it alone, nobody may evict the live pod and take its identity —
   * the identity every kubectl job for that cluster is targeted at.
   */
  describe("re-keying a Runner that is ONLINE needs proof of continuity", () => {
    it("refuses with 403, rotates nothing, writes nothing and never discloses the current key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      let thrown: unknown = null;

      try {
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ForbiddenException);
      const message: string = (thrown as Error).message;
      expect(message).toContain("is online");
      expect(message).toContain("previousRunnerKey");
      expect(message).not.toContain(CURRENT_KEY);

      expect(runnerUpdates).toHaveLength(0);
      expect(clusterUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
      expect(feedItems).toHaveLength(0);

      // Logged for the operator, without the key.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain("refused to re-key");
      expect(String(warnSpy.mock.calls[0]![0])).not.toContain(CURRENT_KEY);
    });

    it("admits a registration that presents the Runner's current key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
          previousRunnerKey: CURRENT_KEY,
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(result.runnerKey).not.toBe(CURRENT_KEY);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("refuses a wrong, a near-miss and an empty previousRunnerKey alike", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      for (const presented of [
        "00000000-0000-4000-8000-000000000000",
        CURRENT_KEY.slice(0, -1),
        `${CURRENT_KEY}x`,
        CURRENT_KEY.toUpperCase(),
        "",
      ]) {
        await expect(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
            previousRunnerKey: presented,
          }),
        ).rejects.toThrow(ForbiddenException);
      }

      expect(runnerUpdates).toHaveLength(0);
    });

    it("applies the same rule to the by-name agent row of an unbound cluster", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({ byName: onlineAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(runnerUpdates).toHaveLength(0);
      expect(clusterUpdates).toHaveLength(0);
    });
  });

  describe("bounds on what an ingestion key can mint", () => {
    it("refuses a new agent Runner once the project holds the maximum, with 429", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy.mockResolvedValue(
        new PositiveNumber(MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT),
      );

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(TooManyRequestsException);

      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
      expect(feedItems).toHaveLength(0);

      // Counted on this project's agent rows only.
      const query: Record<string, unknown> = (
        countBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["name"]).toBeDefined();
    });

    it("refuses a new agent Runner once the hourly creation brake is reached", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy
        .mockResolvedValueOnce(new PositiveNumber(3))
        .mockResolvedValueOnce(
          new PositiveNumber(
            MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR,
          ),
        );

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(/in the last hour/);

      expect(createdRunner).toBeNull();

      const hourlyQuery: Record<string, unknown> = (
        countBySpy.mock.calls[1]![0] as { query: Record<string, unknown> }
      ).query;
      expect(hourlyQuery["createdAt"]).toBeDefined();
    });

    it("admits one below each brake", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({});
      countBySpy
        .mockResolvedValueOnce(
          new PositiveNumber(MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT - 1),
        )
        .mockResolvedValueOnce(
          new PositiveNumber(
            MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR - 1,
          ),
        );

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(createdRunner).not.toBeNull();
    });
  });

  /*
   * The ping-pong finding: cluster A is bound (via the dashboard) to the
   * in-cluster Runner of cluster B. A's pod registering must not re-key B's
   * pod and overwrite its posture; it gets its own row and A stays as the
   * operator left it.
   */
  describe("a bound Runner that is another cluster's agent is never reused", () => {
    it("creates this cluster's own agent row and leaves the other cluster's Runner and the binding alone", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-eu",
            },
          },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.isBoundToCluster).toBe(false);
      expect(result.isFirstBind).toBe(false);
      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());

      // prod-eu's live pod keeps its key and its posture.
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe(getKubernetesAgentRunnerName("prod-us"));
      expect(
        (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
          .kubernetes["clusterIdentifier"],
      ).toBe("prod-us");
      expect(clusterUpdates).toHaveLength(0);
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "bound to a different Runner",
      );
    });

    it("re-keys this cluster's existing by-name row instead of the other cluster's bound Runner", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-eu",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
        byName: offlineAgentRunner(),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(runnerUpdates[0]!.id).not.toBe(OTHER_RUNNER_ID.toString());
      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });

    it("treats a bound pod Runner with no cluster identity as not this cluster's agent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "pod-runner",
          hostInfo: { kubernetes: { inCluster: true } },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
    });

    it("does reuse the bound agent when its posture names this cluster in a different case", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "PROD-US" },
          },
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.id).toBe(RUNNER_ID.toString());
      expect(createdRunner).toBeNull();
    });
  });

  it("does not steal a cluster an operator bound to an external Runner", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
    mockRunnerLookups({
      // The bound Runner: an operator's external Runner, no posture.
      bound: onlineAgentRunner({ name: "office-runner", hostInfo: {} }),
      // The agent Runner row for this cluster, previously registered.
      byName: offlineAgentRunner({
        id: OTHER_RUNNER_ID,
        _id: OTHER_RUNNER_ID.toString(),
      }),
    });

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isBoundToCluster).toBe(false);
    expect(result.bindingState).toBe("bound_to_other_runner");
    expect(result.runnerId.toString()).toBe(OTHER_RUNNER_ID.toString());
    expect(clusterUpdates).toHaveLength(0);
    expect(runnerUpdates).toHaveLength(1);
    expect(runnerUpdates[0]!.id).toBe(OTHER_RUNNER_ID.toString());
  });

  it("takes over when the bound Runner no longer exists, without touching the switches", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
    mockRunnerLookups({});

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isFirstBind).toBe(false);
    expect(result.isBoundToCluster).toBe(true);
    expect(result.bindingState).toBe("rebound_after_runner_missing");
    expect(createdRunner).not.toBeNull();
    expect(clusterUpdates).toHaveLength(1);
    // Only the binding moves; the switches stay as the operator left them.
    expect(clusterUpdates[0]).toEqual({
      aiAccessRunnerId: RUNNER_ID,
      aiAccessCredentialId: null,
    });
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain("took over");
  });

  /*
   * The silent re-enable finding: an operator who cleared the Runner (and
   * turned the switches off) must not have AI turned back on by the next
   * pod restart. An unbound cluster WITH an AI-access history was cleared
   * on purpose; only a cluster with no history at all is "never
   * configured".
   */
  describe("a cluster an operator unbound stays unbound", () => {
    it("re-keys the existing agent row but neither re-binds nor flips a switch", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );
      mockRunnerLookups({ byName: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.isFirstBind).toBe(false);
      expect(result.isBoundToCluster).toBe(false);
      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.runnerId.toString()).toBe(RUNNER_ID.toString());
      expect(clusterUpdates).toHaveLength(0);
      expect(runnerUpdates).toHaveLength(1);
      expect(runnerUpdates[0]!.data["key"]).toBe(result.runnerKey);
      expect(createdRunner).toBeNull();
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "cleared by an operator",
      );
    });

    it("also holds when the Runner row is gone but the cluster has a recorded access check", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(60 * 24 * 7),
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.isBoundToCluster).toBe(false);
      expect(createdRunner).not.toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });

    it("also holds when the only trace is a recorded access error", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          aiAccessLastError: "kubectl: connection refused",
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("still first-binds a cluster with switches at their defaults and no history", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiAccessLastVerifiedAt: undefined,
          aiAccessLastError: undefined,
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("first_bind");
      expect(clusterUpdates).toHaveLength(1);
    });
  });

  it("survives a feed write failure: the registration still succeeds", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
    mockRunnerLookups({});
    (
      KubernetesClusterFeedService.createKubernetesClusterFeedItem as unknown as jest.SpyInstance
    ).mockRejectedValue(new Error("feed is down"));

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.bindingState).toBe("first_bind");
    expect(clusterUpdates).toHaveLength(1);
  });
});
