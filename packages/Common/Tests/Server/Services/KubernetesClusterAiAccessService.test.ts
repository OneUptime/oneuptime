import KubernetesClusterAiAccessService, {
  KubernetesAgentRegistrationRefusedException,
  KubernetesClusterAiAccessProjectGates,
  MAX_KUBERNETES_AGENT_RUNNERS_PER_PROJECT,
  MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
  MAX_NEW_KUBERNETES_AGENT_RUNNERS_PER_PROJECT_PER_HOUR,
  RegisterKubernetesAgentRunnerResult,
  REMEDIATION_WRITE_ACCESS_NEXT_STEP,
  getKubernetesAgentRunnerNameForCluster,
  getPreviousInstanceRetryAfterSeconds,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
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
import BadDataException from "../../../Types/Exception/BadDataException";
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
  isTransientKubernetesAgentRegistrationRefusal,
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
    /*
     * What registration gives an agent row. Readiness now reads these for
     * an offline agent row (they would block its re-registration), so the
     * fixture carries the agent defaults rather than leaving them unset
     * (which reads as "Runs Runbooks" on).
     */
    canRunRunbooks: false,
    canRunCodeFixTasks: false,
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
  /*
   * What an offline agent Runner of this cluster holds beyond the agent
   * defaults (readiness asks, because holdings stop it re-registering).
   * Nothing, unless a test says otherwise.
   */
  let credentialCountSpy: jest.SpyInstance;
  let secretCountSpy: jest.SpyInstance;
  let boundClusterCountSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    credentialCountSpy = jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    secretCountSpy = jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    boundClusterCountSpy = jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
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

  /*
   * The Runner's write scope reaches the status (and so the AI page and
   * the planner) as the Runner reported it: the namespaces it lets AI
   * change, its own namespace, and whether node operations are allowed.
   */
  it("reports the bound Runner's write scope in its posture", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
      fakeRunner({
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: true,
            clusterIdentifier: "prod-us",
            writeNamespaces: ["web", "api"],
            podNamespace: "oneuptime-agent",
            allowNodeOperations: false,
          },
        },
      }),
    );

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(status.runner?.posture?.writeNamespaces).toEqual(["web", "api"]);
    expect(status.runner?.posture?.podNamespace).toBe("oneuptime-agent");
    expect(status.runner?.posture?.allowNodeOperations).toBe(false);
  });

  it("reports no_runner_bound with the install step and blocks both when the cluster has no Runner and none is registered for it", async () => {
    /*
     * The status now looks for this cluster's agent Runner row before
     * choosing the next step (see the "installed but not selected" block
     * below); with none registered, the one-command install is the step.
     */
    const findOneBy: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster({ aiAccessRunnerId: undefined }),
        gates: READY_GATES,
      });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(gapCodes(status)).toEqual(["no_runner_bound"]);
    expect(status.gaps[0]?.blocks).toBe("both");
    expect(status.gaps[0]?.title).toBe("No Runner can reach this cluster");
    expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    expect(status.isInvestigationReady).toBe(false);
    expect(status.isRemediationReady).toBe(false);
    expect(status.runner).toBeNull();
    expect(status.accessMethod).toBe("none");
  });

  /*
   * The FK on aiAccessRunnerId is ON DELETE SET NULL, so deleting the bound
   * Runner clears the binding in the same statement: the only way to see a
   * bound id with no Runner row is the race between reading the cluster and
   * reading its Runner while a delete lands.
   */
  it("reports runner_missing only for the race with a Runner delete, and says so", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(null);

    const status: KubernetesClusterAiAccessStatus =
      await KubernetesClusterAiAccessService.getStatusForClusterModel({
        cluster: fakeCluster(),
        gates: READY_GATES,
      });

    expect(gapCodes(status)).toEqual(["runner_missing"]);
    expect(status.gaps[0]?.title).toBe("The bound Runner was just deleted");
    /*
     * Round three: gap next steps are shown verbatim on incident pages too,
     * where "this page" would be the incident. They name the cluster's AI
     * page instead (was "Reload this page").
     */
    expect(status.gaps[0]?.nextStep).toContain("Reload the cluster's AI page");
    expect(status.gaps[0]?.nextStep).not.toContain("this page");
    expect(status.isInvestigationReady).toBe(false);
  });

  /*
   * A cluster left unbound while its agent Runner already exists (the
   * binding was cleared, its Runner was deleted and re-registered, or the
   * cluster row was recreated by telemetry). Re-running the helm upgrade
   * would change nothing there — a registering Runner never re-binds a
   * cluster that was configured before — so the step that works is
   * selecting the Runner on the AI page.
   */
  describe("no Runner bound, but this cluster's agent Runner is registered", () => {
    it("tells the operator to select that Runner on the cluster's AI page, not to run helm", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(fakeRunner());

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["no_runner_bound"]);
      expect(status.gaps[0]?.title).toBe(
        "The in-cluster Runner is installed but not selected",
      );
      expect(status.gaps[0]?.description).toContain("and online");
      expect(status.gaps[0]?.nextStep).toContain(
        'Select the kubernetes-agent Runner "kubernetes-agent/prod-us"',
      );
      // Round three: named, not "on this page" (shown on incident pages too).
      expect(status.gaps[0]?.nextStep).toContain("on the cluster's AI page");
      expect(status.gaps[0]?.nextStep).not.toContain("this page");
      expect(status.gaps[0]?.nextStep).not.toContain("aiAccess.enabled=true");
      expect(status.gaps[0]?.blocks).toBe("both");
      expect(status.isInvestigationReady).toBe(false);
      expect(status.runner).toBeNull();

      // Looked up in this project, by the agent name, case-insensitively.
      const query: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(typeof query["name"]).not.toBe("string");
      expect(query["name"]).toBeDefined();
    });

    it("says the Runner is not online when it is not, and still points at selecting it", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.description).toContain("not online right now");
      expect(status.gaps[0]?.nextStep).toContain("Select the kubernetes-agent");
    });

    it("keeps the install step when the row by that name reports a different cluster", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.title).toBe("No Runner can reach this cluster");
      expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    });

    it("never throws: a failed lookup falls back to the install step", async () => {
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockRejectedValue(new Error("db down"));

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessRunnerId: undefined }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["no_runner_bound"]);
      expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    });

    it("does not look anything up for a cluster row without an identifier", async () => {
      const findOneBy: jest.SpyInstance = jest.spyOn(
        RunnerService,
        "findOneBy",
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({
            aiAccessRunnerId: undefined,
            clusterIdentifier: "  ",
          }),
          gates: READY_GATES,
        });

      expect(findOneBy).not.toHaveBeenCalled();
      expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
    });
  });

  /*
   * A Runner that signs off (/runner-ingest/disconnect — what a helm
   * uninstall or turning aiAccess off does to the agent's pod) is offline
   * at once, not "Connected" until its last heartbeat ages out.
   */
  describe("a Runner that signed off", () => {
    it("is offline and blocks both, with the uninstall-aware copy and not the 'check the pod' step", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          fakeRunner({
            lastAlive: OneUptimeDate.getCurrentDate(),
            connectionStatus: RunnerConnectionStatus.Disconnected,
          }),
        );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.runner?.isOnline).toBe(false);
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
      expect(gapCodes(status)).toEqual(["runner_offline"]);
      expect(status.gaps[0]?.title).toBe("The in-cluster Runner signed off");
      expect(status.gaps[0]?.description).toContain("uninstalled");
      // Round three: was "clear the Runner on this page".
      expect(status.gaps[0]?.nextStep).toContain(
        "clear the Runner on the cluster's AI page",
      );
      expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
      expect(status.gaps[0]?.nextStep).not.toContain("component=ai-runner");

      // The sign-off is read, not guessed.
      const select: Record<string, unknown> = (
        findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;
      expect(select["connectionStatus"]).toBe(true);
    });

    it("uses plain copy for a dashboard Runner that signed off", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "office-runner",
          hostInfo: { hostname: "x" },
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.code).toBe("runner_offline");
      expect(status.gaps[0]?.title).toBe("The Runner signed off");
      expect(status.gaps[0]?.nextStep).toContain("Start the Runner container");
    });

    it("negative control: the same Runner Connected is online and ready", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: OneUptimeDate.getCurrentDate(),
          connectionStatus: RunnerConnectionStatus.Connected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.runner?.isOnline).toBe(true);
      expect(status.gaps).toEqual([]);
      expect(status.isInvestigationReady).toBe(true);
      expect(status.isRemediationReady).toBe(true);
    });

    it("negative control: a row that never heartbeated is 'never connected', not 'signed off'", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: undefined,
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      expect(status.gaps[0]?.title).toBe("The Runner has never connected");
    });

    /*
     * A restarted agent pod cannot present the key its predecessor held, so
     * a row holding more than the agent defaults is refused on every
     * registration — "it reconnects within a minute" would be false.
     */
    describe("an offline agent Runner that holds more than the defaults", () => {
      it('says it cannot re-register and names "Runs Runbooks" instead of promising a reconnect', async () => {
        jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
          fakeRunner({
            connectionStatus: RunnerConnectionStatus.Disconnected,
            canRunRunbooks: true,
          }),
        );

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster(),
            gates: READY_GATES,
          });

        expect(gapCodes(status)).toEqual(["runner_offline"]);
        const gap: KubernetesAiAccessGap = status.gaps[0]!;
        expect(gap.title).toContain("cannot re-register");
        expect(gap.description).toContain('"Runs Runbooks" is on');
        expect(gap.nextStep).toContain(
          'on Runner "kubernetes-agent/prod-us": turn off "Runs Runbooks"',
        );
        expect(gap.nextStep).toContain("delete the Runner");
        expect(gap.nextStep).not.toContain("reconnects within a minute");
        expect(gap.nextStep).not.toContain("aiAccess.enabled=true");
        expect(gap.blocks).toBe("both");
      });

      it("names assigned credentials, secrets and other clusters bound to it, counted for THIS cluster", async () => {
        credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
        secretCountSpy.mockResolvedValue(new PositiveNumber(2));
        boundClusterCountSpy.mockResolvedValue(new PositiveNumber(1));
        jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
          fakeRunner({
            lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
          }),
        );

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster(),
            gates: READY_GATES,
          });

        const gap: KubernetesAiAccessGap = status.gaps[0]!;
        expect(gap.description).toContain("1 Runner credential(s) assigned");
        expect(gap.description).toContain("2 runbook secret(s) assigned");
        expect(gap.description).toContain(
          "the AI access Runner of 1 other cluster(s)",
        );
        // "Runs Runbooks" is off on this row, so it is not named.
        expect(gap.description).not.toContain("Runs Runbooks");

        const clusterQuery: Record<string, unknown> = (
          boundClusterCountSpy.mock.calls[0]![0] as {
            query: Record<string, unknown>;
          }
        ).query;
        expect(clusterQuery["_id"]).toBeDefined();
        expect(typeof clusterQuery["_id"]).not.toBe("string");
      });

      it("negative control: a signed-off agent row with nothing extra keeps the reconnect wording", async () => {
        jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
          fakeRunner({
            connectionStatus: RunnerConnectionStatus.Disconnected,
          }),
        );

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster(),
            gates: READY_GATES,
          });

        expect(status.gaps[0]?.title).toBe("The in-cluster Runner signed off");
        expect(status.gaps[0]?.nextStep).toContain("aiAccess.enabled=true");
      });

      it("negative control: an online agent row is never counted", async () => {
        jest
          .spyOn(RunnerService, "findOneBy")
          .mockResolvedValue(fakeRunner({ canRunRunbooks: true }));

        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

        expect(credentialCountSpy).not.toHaveBeenCalled();
      });

      it("negative control: another cluster's agent row is not judged by this cluster's holdings", async () => {
        jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
          fakeRunner({
            name: "kubernetes-agent/prod-eu",
            connectionStatus: RunnerConnectionStatus.Disconnected,
            canRunRunbooks: true,
            hostInfo: {
              kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
            },
          }),
        );

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster(),
            gates: READY_GATES,
          });

        expect(status.gaps[0]?.title).toBe("The in-cluster Runner signed off");
        expect(credentialCountSpy).not.toHaveBeenCalled();
      });

      it("never throws: a failed holdings lookup falls back to the plain offline gap", async () => {
        credentialCountSpy.mockRejectedValue(new Error("db down"));
        jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
          fakeRunner({
            connectionStatus: RunnerConnectionStatus.Disconnected,
          }),
        );

        const status: KubernetesClusterAiAccessStatus =
          await KubernetesClusterAiAccessService.getStatusForClusterModel({
            cluster: fakeCluster(),
            gates: READY_GATES,
          });

        expect(status.gaps[0]?.title).toBe("The in-cluster Runner signed off");
      });
    });

    it("still reports the sign-off once the last heartbeat has also aged out", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
          connectionStatus: RunnerConnectionStatus.Disconnected,
        }),
      );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster(),
          gates: READY_GATES,
        });

      // Signed off AND stale: the sign-off is the more precise explanation.
      expect(status.gaps[0]?.title).toBe("The in-cluster Runner signed off");
      expect(status.runner?.isOnline).toBe(false);
    });
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

    /*
     * Changed with the credential-exfiltration fix: this used to be the
     * supported "another cluster's agent + an assigned credential" setup
     * and read as ready. A kubernetes-agent Runner is minted and re-keyed
     * with the telemetry ingestion key, so it is never handed credential
     * material — the claim path refuses it — and readiness must say so
     * instead of promising access that would fail on every command.
     */
    it("refuses a credential on another cluster's agent Runner with its own gap, never 'credential' access", async () => {
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
      const credentialLookup: jest.SpyInstance = jest
        .spyOn(RunbookCredentialService, "findOneBy")
        .mockResolvedValue({
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

      expect(gapCodes(status)).toEqual(["credential_on_agent_runner"]);
      expect(status.gaps[0]?.blocks).toBe("both");
      expect(status.gaps[0]?.description).toContain(
        'the in-cluster Runner of cluster "prod-eu"',
      );
      expect(status.gaps[0]?.nextStep).toContain(
        "Create a Runner under Project Settings → Runners",
      );
      expect(status.accessMethod).toBe("none");
      expect(status.credentialId).toBeUndefined();
      expect(status.isInvestigationReady).toBe(false);
      expect(status.isRemediationReady).toBe(false);
      // The credential's details are moot: an agent row never carries one.
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("keyed on the server-owned NAME: an agent row whose heartbeat dropped its posture still cannot carry a credential", async () => {
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          fakeRunner({ name: "kubernetes-agent/prod-eu", hostInfo: {} }),
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

      expect(gapCodes(status)).toEqual(["credential_on_agent_runner"]);
      expect(status.accessMethod).toBe("none");
    });

    /*
     * An agent row renamed (only root can rename one now) keeps its agent
     * posture, and the posture alone marks it: the one "is an agent row"
     * rule fails closed on the name OR the posture.
     */
    it("keyed on the name OR the posture: a row with another cluster's agent posture but no marker cannot carry a credential", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "prod-eu in-cluster runner",
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

      expect(gapCodes(status)).toEqual(["credential_on_agent_runner"]);
      expect(status.accessMethod).toBe("none");
      expect(status.credentialId).toBeUndefined();
    });

    it("keyed on a case variant of the marker too", async () => {
      jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(
          fakeRunner({ name: "Kubernetes-Agent/prod-eu", hostInfo: {} }),
        );

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toEqual(["credential_on_agent_runner"]);
    });

    /*
     * Before round two this fixture reported a cluster identity too (an
     * agent posture). An ordinary Runner in a pod never does — only the
     * kubernetes-agent binary reports one — and such a posture now marks
     * the row as an agent (the case above).
     */
    it("negative control: a dashboard Runner that happens to live in a pod still uses an assigned credential", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          name: "pod-runner",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
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

    it("negative control: THIS cluster's agent with a credential also selected stays in-cluster (the credential is ignored)", async () => {
      const credentialLookup: jest.SpyInstance = jest.spyOn(
        RunbookCredentialService,
        "findOneBy",
      );
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(fakeRunner());

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: fakeCluster({ aiAccessCredentialId: CREDENTIAL_ID }),
          gates: READY_GATES,
        });

      expect(status.gaps).toEqual([]);
      expect(status.accessMethod).toBe("in_cluster");
      expect(status.credentialId).toBeUndefined();
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("still reports the credential gap, not a mismatch, when the bound credential is unusable", async () => {
      jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(
        fakeRunner({
          /*
           * A dashboard Runner living in a pod: an agent row here would be
           * the credential_on_agent_runner case above. Before round two
           * this fixture also named a cluster — an agent posture, which
           * only the kubernetes-agent binary reports and which now marks
           * the row as an agent on its own.
           */
          name: "pod-runner",
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
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
    expect(status.gaps[0]?.nextStep).toBe(REMEDIATION_WRITE_ACCESS_NEXT_STEP);
    expect(status.isInvestigationReady).toBe(true);
    expect(status.isRemediationReady).toBe(false);
  });

  /*
   * Round three: the read-only gap used to give only a bare
   * "--set aiAccess.remediation.enabled=true", which grants write RBAC
   * cluster-wide and to every node. It now points at the AI page's
   * write-access section (the complete commands) and names the two values
   * that bound where the write role reaches.
   */
  it("points the read-only gap at the AI page's write-access section and the values that scope it", () => {
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "--set aiAccess.remediation.enabled=true",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      '"Let AI apply fixes (write access)" on the cluster\'s AI page',
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAccess.remediation.namespaces",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain(
      "aiAccess.remediation.nodeOperations=false",
    );
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).toContain("cluster-wide");
    expect(REMEDIATION_WRITE_ACCESS_NEXT_STEP).not.toContain("this page");
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
  // What an unproven re-key checks the row holds beyond the agent defaults.
  let credentialCountSpy: jest.SpyInstance;
  let secretCountSpy: jest.SpyInstance;
  let boundClusterCountSpy: jest.SpyInstance;

  /*
   * An agent Runner row as the last heartbeat left it, OFFLINE: the pod it
   * belonged to stopped half an hour ago, which is the restart case that
   * must always be admitted. It holds exactly what registration gave it:
   * kubectl only, no runbooks, no code fixes.
   */
  function offlineAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return fakeRunner({
      key: CURRENT_KEY,
      lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      connectionStatus: RunnerConnectionStatus.Connected,
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
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
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      ...overrides,
    });
  }

  // The row after its pod signed off on a clean shutdown (a helm upgrade).
  function signedOffAgentRunner(
    overrides: Partial<Record<string, unknown>> = {},
  ): Runner {
    return onlineAgentRunner({
      connectionStatus: RunnerConnectionStatus.Disconnected,
      ...overrides,
    });
  }

  /*
   * Answers the two Runner lookups registration makes — by agent name, and
   * by bound id — separately, so a test can put a different row behind
   * each. Registration finds the row it re-keys by NAME only, so without an
   * explicit `byName` the name lookup answers with the bound row exactly
   * when that row carries the name being looked up (compared the way
   * findWithSameText compares), as Postgres would.
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

        if (data.byName !== undefined) {
          return data.byName;
        }

        const nameFilter: {
          objectLiteralParameters?: Record<string, unknown>;
        } = query["name"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
        const lookedUp: unknown = Object.values(
          nameFilter?.objectLiteralParameters || {},
        )[0];

        return data.bound &&
          typeof lookedUp === "string" &&
          (data.bound.name || "").trim().toLowerCase() === lookedUp
          ? data.bound
          : null;
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
    credentialCountSpy = jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    secretCountSpy = jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    boundClusterCountSpy = jest
      .spyOn(KubernetesClusterService, "countBy")
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

    /*
     * The write scope the Runner reports at registration is stored at once,
     * so the enqueue chokepoint (and the AI page) know it before the first
     * heartbeat — and the service, not the body, says which cluster and that
     * it is in-cluster.
     */
    it("stores the Runner's reported write scope with the posture, the cluster identity its own", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(neverConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: {
          allowWrites: true,
          writeNamespaces: ["web"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: false,
          clusterIdentifier: "someone-else",
          inCluster: false,
        },
      });

      expect(
        (createdRunner!.hostInfo as { kubernetes: Record<string, unknown> })
          .kubernetes,
      ).toEqual({
        allowWrites: true,
        writeNamespaces: ["web"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
        clusterIdentifier: "prod-us",
        inCluster: true,
      });
    });

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
      /*
       * The first bind stamps the never-cleared "configured" marker, so a
       * later Runner delete (the FK nulls the binding) can never make this
       * cluster look never-configured and first-bind it again.
       */
      expect(clusterUpdates[0]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);

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
      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("key was rotated");
      // Said plainly: no key was presented, and why it was admitted anyway.
      expect(feed).toContain("WITHOUT proof of continuity");
      expect(feed).toContain("had stopped heartbeating");
    });

    /*
     * Round three (follow-up e): the write scope a restarted pod reports is
     * stored on the re-keyed row at once, replacing what the previous pod
     * reported, so a scope changed by a helm upgrade is known before the
     * first heartbeat. The service, not the body, still says which cluster.
     */
    it("stores the restarted Runner's reported write scope on the re-keyed row", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: offlineAgentRunner({
          hostInfo: {
            kubernetes: {
              inCluster: true,
              allowWrites: true,
              clusterIdentifier: "prod-us",
              writeNamespaces: ["legacy"],
              allowNodeOperations: true,
            },
          },
        }),
      });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: {
          allowWrites: true,
          writeNamespaces: ["web", "api"],
          podNamespace: "oneuptime-agent",
          allowNodeOperations: false,
          clusterIdentifier: "someone-else",
          inCluster: false,
        },
      });

      expect(runnerUpdates).toHaveLength(1);
      expect(
        (
          runnerUpdates[0]!.data["hostInfo"] as {
            kubernetes: Record<string, unknown>;
          }
        ).kubernetes,
      ).toEqual({
        allowWrites: true,
        writeNamespaces: ["web", "api"],
        podNamespace: "oneuptime-agent",
        allowNodeOperations: false,
        clusterIdentifier: "prod-us",
        inCluster: true,
      });
    });

    it("also admits a Runner that signed off (Disconnected) even though its last heartbeat is recent", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner(),
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
      expect(String(feedItems[0]!["feedInfoInMarkdown"])).toContain(
        "the previous instance had signed off",
      );
    });

    it("says a rotation WITH the current key was proven, and without the takeover warning", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
        previousRunnerKey: CURRENT_KEY,
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("It presented its current key");
      expect(feed).not.toContain("WITHOUT proof");
      expect(feed).not.toContain("telemetry ingestion key");
    });

    it("warns about a possible takeover on a rotation WITHOUT proof, in a different color", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const unproven: Record<string, unknown> = feedItems[0]!;
      expect(String(unproven["feedInfoInMarkdown"])).toContain(
        "telemetry ingestion key",
      );

      feedItems.length = 0;
      mockRunnerLookups({ bound: offlineAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
        previousRunnerKey: CURRENT_KEY,
      });

      expect(feedItems[0]!["displayColor"]).not.toEqual(
        unproven["displayColor"],
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

    /*
     * Round one re-keyed the BOUND row whenever its posture named this
     * cluster. A posture is whatever the Runner last heartbeated, so a row
     * renamed out of the agent marker (its name guards gone) was still
     * handed the ingestion-key identity. The row is found by NAME only.
     */
    it("never re-keys a bound row that only CLAIMS to be this cluster's agent by its posture", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: OTHER_RUNNER_ID }));
      const lookups: jest.SpyInstance = mockRunnerLookups({
        bound: offlineAgentRunner({
          id: OTHER_RUNNER_ID,
          _id: OTHER_RUNNER_ID.toString(),
          name: "prod-us in-cluster runner",
        }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_to_other_runner");
      expect(result.isBoundToCluster).toBe(false);
      // The bound row keeps its key; this cluster's agent row is minted.
      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe("kubernetes-agent/prod-us");
      expect(clusterUpdates).toHaveLength(0);

      // The row to re-key was looked up by name, first.
      const firstQuery: Record<string, unknown> = (
        lookups.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(firstQuery["_id"]).toBeUndefined();
      expect(firstQuery["name"]).toBeDefined();
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

  /*
   * Rewritten: this used to mock a bound id pointing at a missing Runner
   * and expect a take-over. The binding's FK is ON DELETE SET NULL, so that
   * state only exists in the race between reading the cluster and reading
   * its Runner while a delete lands — and a Runner delete is how an
   * operator revokes or resets it, so even then nothing is re-bound.
   */
  it("race only: a bound id whose Runner row vanished mid-registration is never re-bound and no switch moves", async () => {
    jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
      fakeCluster({
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    );
    mockRunnerLookups({});

    const result: RegisterKubernetesAgentRunnerResult =
      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

    expect(result.isFirstBind).toBe(false);
    expect(result.isBoundToCluster).toBe(false);
    expect(result.bindingState).toBe("left_unbound_by_operator");
    expect(createdRunner).not.toBeNull();
    expect(clusterUpdates).toHaveLength(0);
    expect(String(feedItems[0]!["feedInfoInMarkdown"])).not.toContain(
      "took over",
    );
  });

  /*
   * What Postgres actually leaves after an operator deletes the bound agent
   * Runner: the FK (ON DELETE SET NULL) has already cleared
   * aiAccessRunnerId, and the row is gone, so there is no agent row by name
   * either. The never-cleared aiAccessRunnerBoundAt marker remembers that a
   * Runner WAS bound (round one keyed this on aiAccessConfiguredAt, which
   * also left an operator who configured the cluster before installing the
   * chart unbound — known follow-up 12).
   */
  describe("re-registration after the bound agent Runner was deleted (the FK ON DELETE SET NULL state)", () => {
    function clusterAfterRunnerDelete(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        aiAccessCredentialId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        aiAccessLastVerifiedAt: undefined,
        aiAccessLastError: undefined,
        aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
        aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(60 * 24),
        ...overrides,
      });
    }

    it("does not re-enable switches an operator turned off before any command ran", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(result.isBoundToCluster).toBe(false);
      expect(result.isFirstBind).toBe(false);
      // A fresh Runner row for the pod, but the cluster is not touched.
      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name).toBe("kubernetes-agent/prod-us");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("says honestly what may have happened: cleared by an operator, OR its Runner was deleted", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain(
        "the binding was cleared by an operator, or the Runner it was bound to was deleted",
      );
      expect(feed).toContain("no AI switch was changed");
      expect(feed).toContain("Select **kubernetes-agent/prod-us**");
    });

    it("keeps an operator's enabled switches exactly as they are, too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        clusterAfterRunnerDelete({
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
          aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(90),
        }),
      );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: false },
        });

      expect(result.bindingState).toBe("left_unbound_by_operator");
      expect(clusterUpdates).toHaveLength(0);
    });

    it("afterwards, the cluster's status points at selecting the new Runner, not at helm", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(clusterAfterRunnerDelete());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      // The row registration just created is what the status now finds.
      mockRunnerLookups({ byName: createdRunner });

      const status: KubernetesClusterAiAccessStatus =
        await KubernetesClusterAiAccessService.getStatusForClusterModel({
          cluster: clusterAfterRunnerDelete(),
          gates: READY_GATES,
        });

      expect(gapCodes(status)).toContain("no_runner_bound");
      const gap: KubernetesAiAccessGap = status.gaps.find(
        (candidate: KubernetesAiAccessGap) => {
          return candidate.code === "no_runner_bound";
        },
      )!;
      expect(gap.nextStep).toContain(
        'Select the kubernetes-agent Runner "kubernetes-agent/prod-us"',
      );
      expect(gap.nextStep).not.toContain("aiAccess.enabled=true");
    });

    it("negative control: without either marker (and no other history) the same cluster still first-binds", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        clusterAfterRunnerDelete({
          aiAccessConfiguredAt: undefined,
          aiAccessRunnerBoundAt: undefined,
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
      expect(clusterUpdates[0]).toMatchObject({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      });
    });

    /*
     * The marker that decides it is "a Runner was bound", not "configured":
     * with only aiAccessConfiguredAt left, the cluster is the pre-configured
     * case below and is bound, switches untouched.
     */
    it("negative control: with only the configured marker it binds, keeping the operator's switches", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(
          clusterAfterRunnerDelete({ aiAccessRunnerBoundAt: undefined }),
        );
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
    });
  });

  /*
   * Known follow-up 12: an operator who opens the AI page and picks a
   * remediation mode (or flips a switch) BEFORE installing the chart stamps
   * aiAccessConfiguredAt. That must not strand the cluster unbound: no
   * Runner was ever bound, so the agent Runner is bound — and not one of the
   * operator's settings moves.
   */
  describe("a cluster configured on the AI page before the chart was installed", () => {
    function preConfiguredCluster(
      overrides: Partial<Record<string, unknown>> = {},
    ): KubernetesCluster {
      return fakeCluster({
        aiAccessRunnerId: undefined,
        aiAccessCredentialId: undefined,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        aiAccessLastVerifiedAt: undefined,
        aiAccessLastError: undefined,
        aiAccessConfiguredAt: OneUptimeDate.getSomeMinutesAgo(10),
        aiAccessRunnerBoundAt: undefined,
        ...overrides,
      });
    }

    it("binds the agent Runner and changes no switch", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({});

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
      expect(result.isBoundToCluster).toBe(true);
      expect(result.isFirstBind).toBe(false);
      expect(createdRunner).not.toBeNull();

      expect(clusterUpdates).toHaveLength(1);
      // Only the binding and its marker: no switch, no credential, no mode.
      expect(Object.keys(clusterUpdates[0]!).sort()).toEqual(
        ["aiAccessRunnerBoundAt", "aiAccessRunnerId"].sort(),
      );
      expect(String(clusterUpdates[0]!["aiAccessRunnerId"])).toBe(
        RUNNER_ID.toString(),
      );
      expect(clusterUpdates[0]!["aiAccessRunnerBoundAt"]).toBeInstanceOf(Date);
    });

    it("says so honestly on the feed: bound, and the operator's settings kept", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      const feed: string = String(feedItems[0]!["feedInfoInMarkdown"]);
      expect(feed).toContain("was bound as this cluster's AI access Runner");
      expect(feed).toContain("no AI setting was changed");
      expect(feed).toContain("AI investigation with kubectl is off");
      expect(feed).toContain('AI remediation is "Automatic"');
      expect(feed).not.toContain("left unbound");
    });

    it("keeps an investigation switch the operator turned on, too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
        }),
      );
      mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      // Disabled stays Disabled: the chart's intent never overrides a choice.
      expect(clusterUpdates[0]).not.toHaveProperty("aiRemediationMode");
      expect(clusterUpdates[0]).not.toHaveProperty("isAiInvestigationEnabled");
    });

    it("also re-keys and binds this cluster's agent row that already existed", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(preConfiguredCluster());
      mockRunnerLookups({ byName: offlineAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("bound_keeping_operator_settings");
      expect(runnerUpdates).toHaveLength(1);
      expect(clusterUpdates[0]!["aiAccessRunnerId"]).toBe(RUNNER_ID);
    });

    it("negative control: once a Runner was bound, the same cluster is left unbound", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(5),
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

    it("negative control: a recorded command outcome also leaves it unbound", async () => {
      for (const history of [
        { aiAccessLastVerifiedAt: OneUptimeDate.getSomeMinutesAgo(5) },
        { aiAccessLastError: "Forbidden" },
      ]) {
        clusterUpdates.length = 0;
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(preConfiguredCluster(history));
        mockRunnerLookups({});

        const result: RegisterKubernetesAgentRunnerResult =
          await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          });

        expect(result.bindingState).toBe("left_unbound_by_operator");
        expect(clusterUpdates).toHaveLength(0);
      }
    });

    it("a first bind stamps the bound marker too", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        preConfiguredCluster({
          aiAccessConfiguredAt: undefined,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
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
      expect(clusterUpdates[0]!["aiAccessRunnerBoundAt"]).toBeInstanceOf(Date);
      expect(clusterUpdates[0]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);
    });
  });

  /*
   * The credential-exfiltration finding: an offline (or signed-off) agent
   * row may be re-keyed by anyone holding the ingestion key, and the offline
   * window is predictable (every helm upgrade opens one). So a row an
   * operator entrusted with more than the agent defaults is never handed to
   * a registration that cannot present its current key.
   */
  describe("an unproven re-key of a row that holds more than the agent defaults is refused", () => {
    type Holding = {
      name: string;
      arrange: () => Partial<Record<string, unknown>>;
      expectInMessage: string;
    };

    const holdings: Array<Holding> = [
      {
        name: "a Runner credential assigned to it",
        arrange: (): Partial<Record<string, unknown>> => {
          credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
          return {};
        },
        expectInMessage: "1 Runner credential(s) assigned",
      },
      {
        name: "a runbook secret assigned to it",
        arrange: (): Partial<Record<string, unknown>> => {
          secretCountSpy.mockResolvedValue(new PositiveNumber(2));
          return {};
        },
        expectInMessage: "2 runbook secret(s) assigned",
      },
      {
        name: "another cluster bound to it",
        arrange: (): Partial<Record<string, unknown>> => {
          boundClusterCountSpy.mockResolvedValue(new PositiveNumber(1));
          return {};
        },
        expectInMessage: "the AI access Runner of 1 other cluster(s)",
      },
      {
        name: '"Runs Runbooks" turned on',
        arrange: (): Partial<Record<string, unknown>> => {
          return { canRunRunbooks: true };
        },
        expectInMessage: '"Runs Runbooks" is on',
      },
      {
        name: '"Runs AI Code Fixes" turned on',
        arrange: (): Partial<Record<string, unknown>> => {
          return { canRunCodeFixTasks: true };
        },
        expectInMessage: '"Runs AI Code Fixes" is on',
      },
    ];

    function itRefusesTheUnprovenReKey(holding: Holding, state: string): void {
      it(`refuses a ${state} row with ${holding.name}: 403, nothing written, no key handed out`, async () => {
        const overrides: Partial<Record<string, unknown>> = holding.arrange();
        jest
          .spyOn(KubernetesClusterService, "findOneBy")
          .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
        mockRunnerLookups({
          bound:
            state === "signed off"
              ? signedOffAgentRunner(overrides)
              : offlineAgentRunner(overrides),
        });

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
        expect(message).toContain(holding.expectInMessage);
        expect(message).toContain("delete the Runner");
        expect(message).not.toContain(CURRENT_KEY);

        expect(runnerUpdates).toHaveLength(0);
        expect(clusterUpdates).toHaveLength(0);
        expect(createdRunner).toBeNull();
        expect(feedItems).toHaveLength(0);
        expect(String(warnSpy.mock.calls[0]![0])).toContain(
          "without proof of continuity",
        );
      });
    }

    for (const holding of holdings) {
      for (const state of ["signed off", "offline"]) {
        itRefusesTheUnprovenReKey(holding, state);
      }
    }

    it("counts credentials and secrets assigned to THIS row in this project, and other clusters bound to it", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: signedOffAgentRunner() });

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: "prod-us",
        posture: { allowWrites: true },
      });

      for (const spy of [credentialCountSpy, secretCountSpy]) {
        const query: Record<string, unknown> = (
          spy.mock.calls[0]![0] as { query: Record<string, unknown> }
        ).query;
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(
          (query["runners"] as Array<ObjectID>).map((id: ObjectID) => {
            return id.toString();
          }),
        ).toEqual([RUNNER_ID.toString()]);
      }

      const clusterQuery: Record<string, unknown> = (
        boundClusterCountSpy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(clusterQuery["projectId"]).toBe(PROJECT_ID);
      expect(String(clusterQuery["aiAccessRunnerId"])).toBe(
        RUNNER_ID.toString(),
      );
      // "Other than this cluster": this cluster's own binding is expected.
      expect(clusterQuery["_id"]).toBeDefined();
      expect(typeof clusterQuery["_id"]).not.toBe("string");
    });

    it("the same refusal applies to the by-name row of an unbound cluster", async () => {
      credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({ byName: signedOffAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
    });

    it("admits the row when the registration proves continuity with its current key, whatever it holds", async () => {
      credentialCountSpy.mockResolvedValue(new PositiveNumber(1));
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner({ canRunRunbooks: true }),
      });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
          previousRunnerKey: CURRENT_KEY,
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      // The proof short-circuits: nothing is counted.
      expect(credentialCountSpy).not.toHaveBeenCalled();
    });

    it("negative control: a signed-off row with nothing beyond the defaults is still re-keyed without a key", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: signedOffAgentRunner() });

      const result: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        });

      expect(result.bindingState).toBe("already_bound");
      expect(runnerUpdates).toHaveLength(1);
      expect(credentialCountSpy).toHaveBeenCalledTimes(1);
      expect(secretCountSpy).toHaveBeenCalledTimes(1);
      expect(boundClusterCountSpy).toHaveBeenCalledTimes(1);
    });

    it("an online row is refused for being online before anything is counted", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({ bound: onlineAgentRunner() });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(/is online/);

      expect(credentialCountSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * The agent Runner is named "kubernetes-agent/<cluster>", and Runner.name
   * is a 100-character column. Every cluster name the cluster row itself
   * accepts must still get a Runner row.
   */
  describe("long cluster names", () => {
    const LONG_84: string = `arn:aws:eks:us-east-1:123456789012:cluster/${"p".repeat(84 - 43)}`;
    const LONG_100: string = "c".repeat(100);

    it("keeps the exact name for an 83-character identifier (existing rows keep matching)", () => {
      const id: string = "a".repeat(83);

      expect(getKubernetesAgentRunnerNameForCluster(id)).toBe(
        `kubernetes-agent/${id}`,
      );
      expect(getKubernetesAgentRunnerNameForCluster("prod-us")).toBe(
        getKubernetesAgentRunnerName("prod-us"),
      );
    });

    it("bounds 84- and 100-character identifiers to the Runner name column, deterministically", () => {
      for (const id of [LONG_84, LONG_100]) {
        const name: string = getKubernetesAgentRunnerNameForCluster(id);

        expect(LONG_84).toHaveLength(84);
        expect(name.length).toBeLessThanOrEqual(
          MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
        );
        expect(name.startsWith("kubernetes-agent/")).toBe(true);
        expect(name).toBe(getKubernetesAgentRunnerNameForCluster(id));
      }
    });

    it("maps case variants of one long identifier to the same row, and different long identifiers to different rows", () => {
      const lower: string = `${"x".repeat(90)}-prod`;
      const upper: string = lower.toUpperCase();
      const sibling: string = `${"x".repeat(90)}-test`;

      expect(getKubernetesAgentRunnerNameForCluster(upper).toLowerCase()).toBe(
        getKubernetesAgentRunnerNameForCluster(lower).toLowerCase(),
      );
      expect(getKubernetesAgentRunnerNameForCluster(sibling)).not.toBe(
        getKubernetesAgentRunnerNameForCluster(lower),
      );
    });

    it("registers a 100-character cluster name with a Runner name that fits, then finds that row again", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          clusterIdentifier: LONG_100,
        }),
      );
      const lookups: jest.SpyInstance = mockRunnerLookups({});

      await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
        projectId: PROJECT_ID,
        clusterIdentifier: LONG_100,
        posture: { allowWrites: true },
      });

      expect(createdRunner).not.toBeNull();
      expect(createdRunner!.name!.length).toBeLessThanOrEqual(
        MAX_KUBERNETES_AGENT_RUNNER_NAME_LENGTH,
      );
      expect(createdRunner!.name).toBe(
        getKubernetesAgentRunnerNameForCluster(LONG_100),
      );

      // The lookup asked for exactly that name (case-insensitively).
      const nameFilter: { objectLiteralParameters?: Record<string, unknown> } =
        (lookups.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
          "name"
        ] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
      expect(Object.values(nameFilter.objectLiteralParameters || {})).toEqual([
        createdRunner!.name!.toLowerCase(),
      ]);

      // A later restart re-finds that row instead of creating another.
      const created: Runner = createdRunner!;
      createdRunner = null;
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: RUNNER_ID,
          clusterIdentifier: LONG_100,
        }),
      );
      mockRunnerLookups({
        bound: offlineAgentRunner({
          name: created.name,
          hostInfo: created.hostInfo,
        }),
      });

      const again: RegisterKubernetesAgentRunnerResult =
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: LONG_100,
          posture: { allowWrites: true },
        });

      expect(again.bindingState).toBe("already_bound");
      expect(createdRunner).toBeNull();
      expect(runnerUpdates).toHaveLength(1);
    });

    it("refuses a name longer than the cluster column with a clear 400, before any cluster row is created", async () => {
      const findOrCreate: jest.SpyInstance =
        KubernetesClusterService.findOrCreateByClusterIdentifier as unknown as jest.SpyInstance;

      let thrown: unknown = null;

      try {
        await KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "d".repeat(101),
          posture: { allowWrites: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain("101 characters");
      expect((thrown as Error).message).toContain("up to 100 characters");
      expect(findOrCreate).not.toHaveBeenCalled();
      expect(createdRunner).toBeNull();
    });

    it("refuses to reuse a row by this name that reports it belongs to a different cluster", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({
        byName: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      });

      await expect(
        KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
          projectId: PROJECT_ID,
          clusterIdentifier: "prod-us",
          posture: { allowWrites: true },
        }),
      ).rejects.toThrow(
        /reports that it is the in-cluster Runner of a different cluster/,
      );

      expect(runnerUpdates).toHaveLength(0);
      expect(createdRunner).toBeNull();
      expect(clusterUpdates).toHaveLength(0);
    });
  });

  /*
   * The silent re-enable finding: an operator who cleared the Runner (and
   * turned the switches off) must not have AI turned back on by the next
   * pod restart. An unbound cluster WITH an AI-access history was cleared
   * on purpose; only a cluster with no history at all is "never
   * configured".
   */
  describe("a cluster an operator unbound stays unbound", () => {
    /*
     * Round one read "an agent row already existed" as the history that
     * meant "cleared on purpose"; the record of that is now the
     * never-cleared aiAccessRunnerBoundAt marker every bind stamps.
     */
    it("re-keys the existing agent row but neither re-binds nor flips a switch", async () => {
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: undefined,
          isAiInvestigationEnabled: false,
          aiRemediationMode: KubernetesAiRemediationMode.Disabled,
          aiAccessRunnerBoundAt: OneUptimeDate.getSomeMinutesAgo(60),
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

  /*
   * Every 403 says WHICH refusal it is, so the Runner can tell a wait that
   * clears on its own from one that needs an operator (and retry the first
   * when it says). Round one read every 403 as "the previous instance is
   * still online".
   */
  describe("registration refusals carry a machine-readable reason", () => {
    async function refusalOf(
      promise: Promise<unknown>,
    ): Promise<KubernetesAgentRegistrationRefusedException> {
      try {
        await promise;
      } catch (error) {
        expect(error).toBeInstanceOf(
          KubernetesAgentRegistrationRefusedException,
        );
        // Still a 403 for anything that reads it as a ForbiddenException.
        expect(error).toBeInstanceOf(ForbiddenException);
        return error as KubernetesAgentRegistrationRefusedException;
      }

      throw new Error("expected the registration to be refused");
    }

    it("previous_instance_online, with when to try again", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: onlineAgentRunner({
          lastAlive: OneUptimeDate.getSomeMinutesAgo(2),
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("previous_instance_online");
      expect(
        isTransientKubernetesAgentRegistrationRefusal(refusal.reason),
      ).toBe(true);
      // Admitted once the last heartbeat is 5 minutes old: ~3 minutes away.
      expect(refusal.retryAfterSeconds).toBeGreaterThanOrEqual(170);
      expect(refusal.retryAfterSeconds).toBeLessThanOrEqual(181);
    });

    it("runner_holds_more_than_defaults, with the instruction first and no retry hint", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: RUNNER_ID }));
      mockRunnerLookups({
        bound: signedOffAgentRunner({ canRunRunbooks: true }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("runner_holds_more_than_defaults");
      expect(
        isTransientKubernetesAgentRegistrationRefusal(refusal.reason),
      ).toBe(false);
      expect(refusal.retryAfterSeconds).toBeUndefined();
      expect(
        refusal.message.startsWith(
          'Under Project Settings → Runners, on Runner "kubernetes-agent/prod-us": turn off "Runs Runbooks"',
        ),
      ).toBe(true);
      // Only what it actually holds is asked for.
      expect(refusal.message).not.toContain('turn off "Runs AI Code Fixes"');
      expect(refusal.message).not.toContain("unassign");
    });

    /*
     * The Runner logs only the first 500 characters of the server's reason.
     * The whole instruction must fit in them even for a long cluster name
     * and every kind of holding at once.
     */
    it("keeps the full instruction within the first 500 characters for a 100-character cluster name", async () => {
      const longName: string = "x".repeat(100);
      credentialCountSpy.mockResolvedValue(new PositiveNumber(3));
      secretCountSpy.mockResolvedValue(new PositiveNumber(2));
      boundClusterCountSpy.mockResolvedValue(new PositiveNumber(4));
      jest.spyOn(KubernetesClusterService, "findOneBy").mockResolvedValue(
        fakeCluster({
          aiAccessRunnerId: RUNNER_ID,
          clusterIdentifier: longName,
        }),
      );
      mockRunnerLookups({
        bound: signedOffAgentRunner({
          name: getKubernetesAgentRunnerNameForCluster(longName),
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: longName },
          },
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: longName,
            posture: { allowWrites: true },
          }),
        );

      const head: string = refusal.message.slice(0, 500);
      expect(head).toContain("delete the Runner");
      expect(head).toContain('"Runs Runbooks"');
      expect(head).toContain('"Runs AI Code Fixes"');
      expect(head).toContain("3 Runner credential(s)");
      expect(head).toContain("2 runbook secret(s)");
      expect(head).toContain("4 other cluster(s)");
    });

    it("runner_belongs_to_another_cluster, with no retry hint", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneBy")
        .mockResolvedValue(fakeCluster({ aiAccessRunnerId: undefined }));
      mockRunnerLookups({
        byName: offlineAgentRunner({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
          },
        }),
      });

      const refusal: KubernetesAgentRegistrationRefusedException =
        await refusalOf(
          KubernetesClusterAiAccessService.registerKubernetesAgentRunner({
            projectId: PROJECT_ID,
            clusterIdentifier: "prod-us",
            posture: { allowWrites: true },
          }),
        );

      expect(refusal.reason).toBe("runner_belongs_to_another_cluster");
      expect(refusal.retryAfterSeconds).toBeUndefined();
      expect(refusal.message.startsWith("Rename or delete Runner")).toBe(true);
    });

    it("getPreviousInstanceRetryAfterSeconds counts down to the end of the alive window, never below 1s", () => {
      const now: Date = new Date("2026-09-22T12:00:00.000Z");

      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:59:00.000Z"),
          now,
        }),
      ).toBe(240);
      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:55:00.500Z"),
          now,
        }),
      ).toBe(1);
      expect(
        getPreviousInstanceRetryAfterSeconds({
          lastAlive: new Date("2026-09-22T11:00:00.000Z"),
          now,
        }),
      ).toBe(1);
      expect(
        getPreviousInstanceRetryAfterSeconds({ lastAlive: undefined, now }),
      ).toBe(1);
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
