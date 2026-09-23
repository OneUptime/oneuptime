import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunbookSecretService from "../../../Server/Services/RunbookSecretService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import RunbookSecret from "../../../Models/DatabaseModels/RunbookSecret";
import Runner from "../../../Models/DatabaseModels/Runner";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a kubernetes-agent Runner (a row the telemetry
 * ingestion key can mint and, while it is offline, re-key) is never a
 * holder of anything an operator would not hand to whoever holds that key:
 *
 * - it is never offered to AI remediation as a Bash/SSH host
 *   (RunnerService.getOnlineAiCommandRunnersForProject leaves it out, in
 *   the query so it cannot crowd real hosts out of the limit, and on the
 *   rows);
 * - no RunbookCredential and no RunbookSecret can be assigned to it, on
 *   create or on any later write of the Runner list — whatever shape the
 *   Runner list arrives in (models, serialised relations, ids);
 * - ordinary Runners, including ones that live in a pod, are unaffected.
 *
 * "Agent" is one rule (RunnerService.isKubernetesAgentRunnerRow), failing
 * closed on either fact: the server-owned name marker (kubernetes-agent/...,
 * compared case-insensitively; RunnerService refuses a non-root rename into
 * or out of it) or an agent posture (in-cluster AND naming a cluster, which
 * only the kubernetes-agent binary reports).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const HOST_RUNNER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

/*
 * An ordinary Runner that happens to live in a pod. Before round two this
 * fixture also carried a cluster identity (an AGENT posture) — a posture
 * only the kubernetes-agent binary ever reports, and which now marks a row
 * as an agent on its own (see the posture-only case below).
 */
function hostRunner(): Runner {
  return {
    id: HOST_RUNNER_ID,
    _id: HOST_RUNNER_ID.toString(),
    name: "office-runner",
    hostInfo: {
      kubernetes: { inCluster: true },
    },
  } as unknown as Runner;
}

// An agent row renamed by root: no name marker, agent posture intact.
const RENAMED_AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

function renamedAgentRunner(): Runner {
  return {
    id: RENAMED_AGENT_RUNNER_ID,
    _id: RENAMED_AGENT_RUNNER_ID.toString(),
    name: "prod in-cluster runner",
    hostInfo: {
      kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
    },
  } as unknown as Runner;
}

// A case variant of the marker, heartbeat without a posture.
const CASE_VARIANT_AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function caseVariantAgentRunner(): Runner {
  return {
    id: CASE_VARIANT_AGENT_RUNNER_ID,
    _id: CASE_VARIANT_AGENT_RUNNER_ID.toString(),
    name: "Kubernetes-Agent/prod-us",
    hostInfo: {},
  } as unknown as Runner;
}

function agentRunner(): Runner {
  return {
    id: AGENT_RUNNER_ID,
    _id: AGENT_RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    // A heartbeat that dropped the posture does not make it a host.
    hostInfo: {},
  } as unknown as Runner;
}

/*
 * The hooks are protected, as every DatabaseService hook is. Reached
 * through a narrow interface (rather than `as any`) so a change to the
 * hook's shape breaks this file instead of silently passing.
 */
interface CreateHookAccess<T extends DatabaseBaseModel> {
  onBeforeCreate(createBy: CreateBy<T>): Promise<OnCreate<T>>;
}

interface UpdateHookAccess<T extends DatabaseBaseModel> {
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
}

function kubernetesCredential(runners: unknown): RunbookCredential {
  const credential: RunbookCredential = new RunbookCredential();
  credential.name = "prod-us kubeconfig";
  credential.projectId = PROJECT_ID;
  credential.credentialType = RunbookCredentialType.Kubernetes;
  credential.kubernetesApiServerUrl = "https://10.0.0.1:6443";
  credential.kubernetesServiceAccountToken = "token";
  (credential as unknown as Record<string, unknown>)["runners"] = runners;
  return credential;
}

function secret(runners: unknown): RunbookSecret {
  const model: RunbookSecret = new RunbookSecret();
  model.name = "PROD_PASSWORD";
  model.projectId = PROJECT_ID;
  (model as unknown as Record<string, unknown>)["runners"] = runners;
  return model;
}

describe("kubernetes-agent Runners never hold credentials or run shell work", () => {
  let runnerFind: jest.SpyInstance;

  beforeEach(() => {
    /*
     * The one lookup the guard makes: which of the named Runners are
     * agents. Answered from the ids actually asked for.
     */
    runnerFind = jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (args: unknown): Promise<Array<Runner>> => {
        const idFilter: {
          objectLiteralParameters?: Record<string, unknown>;
        } = (args as { query: Record<string, unknown> }).query["_id"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
        const ids: Array<string> = Object.values(
          idFilter.objectLiteralParameters || {},
        )[0] as Array<string>;

        return [
          hostRunner(),
          agentRunner(),
          renamedAgentRunner(),
          caseVariantAgentRunner(),
        ].filter((runner: Runner) => {
          return ids.includes(runner.id!.toString());
        });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("RunnerService.getOnlineAiCommandRunnersForProject (the AI's Bash/SSH hosts)", () => {
    it("excludes agent rows in the query itself, so they cannot take up the limit", async () => {
      runnerFind.mockResolvedValue([hostRunner()]);

      await RunnerService.getOnlineAiCommandRunnersForProject({
        projectId: PROJECT_ID,
      });

      const query: Record<string, unknown> = (
        runnerFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["canRunAiCommands"]).toBe(true);

      const nameFilter: {
        getSql?: (alias: string) => string;
        objectLiteralParameters?: Record<string, unknown>;
      } = query["name"] as {
        getSql?: (alias: string) => string;
        objectLiteralParameters?: Record<string, unknown>;
      };
      expect(nameFilter.getSql!('"name"')).toContain("NOT ILIKE");
      expect(Object.values(nameFilter.objectLiteralParameters || {})).toEqual([
        "kubernetes-agent/%",
      ]);
    });

    it("drops an agent row the query let through, and keeps every ordinary host", async () => {
      runnerFind.mockResolvedValue([hostRunner(), agentRunner()]);

      const runners: Array<Runner> =
        await RunnerService.getOnlineAiCommandRunnersForProject({
          projectId: PROJECT_ID,
        });

      expect(
        runners.map((runner: Runner) => {
          return runner.name;
        }),
      ).toEqual(["office-runner"]);
    });
  });

  describe("RunnerService.readRunnerIds", () => {
    it("reads models, serialised relations, ObjectIDs and id strings, and skips anything else", () => {
      expect(
        RunnerServiceClass.readRunnerIds([
          hostRunner(),
          { _id: AGENT_RUNNER_ID.toString() },
          AGENT_RUNNER_ID,
          HOST_RUNNER_ID.toString(),
          "not-a-uuid",
          null,
          42,
        ]).map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([
        HOST_RUNNER_ID.toString(),
        AGENT_RUNNER_ID.toString(),
        AGENT_RUNNER_ID.toString(),
        HOST_RUNNER_ID.toString(),
      ]);

      expect(RunnerServiceClass.readRunnerIds(undefined)).toEqual([]);
      expect(RunnerServiceClass.readRunnerIds("x")).toEqual([]);
    });
  });

  describe("RunbookCredentialService", () => {
    const createHook: CreateHookAccess<RunbookCredential> =
      RunbookCredentialService as unknown as CreateHookAccess<RunbookCredential>;
    const updateHook: UpdateHookAccess<RunbookCredential> =
      RunbookCredentialService as unknown as UpdateHookAccess<RunbookCredential>;

    it("refuses to create a credential assigned to an agent Runner", async () => {
      let thrown: unknown = null;

      try {
        await createHook.onBeforeCreate({
          data: kubernetesCredential([hostRunner(), agentRunner()]),
          props: { isRoot: true },
        } as CreateBy<RunbookCredential>);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain(
        'Runner "kubernetes-agent/prod-us"',
      );
      expect((thrown as Error).message).toContain("never given a credential");
      expect((thrown as Error).message).toContain("Project Settings → Runners");
    });

    it("refuses to assign an existing credential to an agent Runner, whatever shape the list arrives in", async () => {
      for (const runners of [
        [{ _id: AGENT_RUNNER_ID.toString() }],
        [AGENT_RUNNER_ID],
        [AGENT_RUNNER_ID.toString()],
      ]) {
        await expect(
          updateHook.onBeforeUpdate({
            query: { _id: ObjectID.generate().toString() },
            data: { runners } as never,
            props: { isRoot: true },
          } as unknown as UpdateBy<RunbookCredential>),
        ).rejects.toThrow(BadDataException);
      }
    });

    it("refuses an agent row recognised by its posture only, or by a case variant of the marker", async () => {
      for (const runner of [renamedAgentRunner(), caseVariantAgentRunner()]) {
        await expect(
          createHook.onBeforeCreate({
            data: kubernetesCredential([runner]),
            props: { isRoot: true },
          } as CreateBy<RunbookCredential>),
        ).rejects.toThrow(/never given a credential/);
      }
    });

    it("negative control: ordinary Runners — including one in a pod — are assigned as before", async () => {
      await expect(
        createHook.onBeforeCreate({
          data: kubernetesCredential([hostRunner()]),
          props: { isRoot: true },
        } as CreateBy<RunbookCredential>),
      ).resolves.toBeDefined();

      await expect(
        updateHook.onBeforeUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: { runners: [{ _id: HOST_RUNNER_ID.toString() }] } as never,
          props: { isRoot: true },
        } as unknown as UpdateBy<RunbookCredential>),
      ).resolves.toBeDefined();
    });

    it("negative control: a write that does not touch the Runner list reads nothing", async () => {
      await expect(
        updateHook.onBeforeUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: { name: "renamed" } as never,
          props: { isRoot: true },
        } as unknown as UpdateBy<RunbookCredential>),
      ).resolves.toBeDefined();

      await expect(
        createHook.onBeforeCreate({
          data: kubernetesCredential(undefined),
          props: { isRoot: true },
        } as CreateBy<RunbookCredential>),
      ).resolves.toBeDefined();

      expect(runnerFind).not.toHaveBeenCalled();
    });
  });

  describe("RunbookSecretService", () => {
    const createHook: CreateHookAccess<RunbookSecret> =
      RunbookSecretService as unknown as CreateHookAccess<RunbookSecret>;
    const updateHook: UpdateHookAccess<RunbookSecret> =
      RunbookSecretService as unknown as UpdateHookAccess<RunbookSecret>;

    it("refuses to create or assign a secret for an agent Runner", async () => {
      await expect(
        createHook.onBeforeCreate({
          data: secret([agentRunner()]),
          props: { isRoot: true },
        } as CreateBy<RunbookSecret>),
      ).rejects.toThrow(/never given a secret/);

      await expect(
        updateHook.onBeforeUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: { runners: [{ _id: AGENT_RUNNER_ID.toString() }] } as never,
          props: { isRoot: true },
        } as unknown as UpdateBy<RunbookSecret>),
      ).rejects.toThrow(/never given a secret/);
    });

    it("negative control: an ordinary Runner gets the secret", async () => {
      await expect(
        createHook.onBeforeCreate({
          data: secret([hostRunner()]),
          props: { isRoot: true },
        } as CreateBy<RunbookSecret>),
      ).resolves.toBeDefined();

      await expect(
        updateHook.onBeforeUpdate({
          query: { _id: ObjectID.generate().toString() },
          data: { runners: [HOST_RUNNER_ID] } as never,
          props: { isRoot: true },
        } as unknown as UpdateBy<RunbookSecret>),
      ).resolves.toBeDefined();
    });
  });
});
