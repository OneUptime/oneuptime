import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService, {
  Service as RunnerServiceClass,
  getKubernetesAgentRunnerNameForCluster,
} from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  getKubernetesAgentRunnerName,
  isKubernetesAgentRunnerName,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { getDeletedAgentRunnerRebindNote } from "../../../Types/Kubernetes/KubernetesClusterAiAccessPermissions";
import ObjectID from "../../../Types/ObjectID";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the kubernetes-agent marker is server-owned.
 *
 * A Runner row whose name starts with "kubernetes-agent/" is one the
 * telemetry ingestion key can mint and re-key, so every "never hand it a
 * credential, a secret or shell work" guard keys on that name (or on an
 * agent posture). That only holds if nobody but registration can write the
 * marker:
 *
 * - a non-root rename of an agent row is refused (case-only renames too);
 * - a non-root rename of any row INTO the prefix, and a non-root create
 *   under it, are refused (compared case-insensitively, as the database
 *   compares the marker);
 * - "Runs Runbooks" / "Runs AI Code Fixes" cannot be turned on for an agent
 *   row (either would stop it re-registering after a restart);
 * - root writes (registration, heartbeats) and ordinary Runners are
 *   untouched, and the form's re-post of unchanged values still saves.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const HOST_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

interface HookAccess {
  onBeforeCreate(createBy: CreateBy<Runner>): Promise<OnCreate<Runner>>;
  onBeforeUpdate(updateBy: UpdateBy<Runner>): Promise<OnUpdate<Runner>>;
}

interface CredentialHookAccess<T extends DatabaseBaseModel> {
  onBeforeUpdate(updateBy: UpdateBy<T>): Promise<OnUpdate<T>>;
}

const hooks: HookAccess = RunnerService as unknown as HookAccess;

function editorProps(): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function agentRow(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: AGENT_RUNNER_ID,
    _id: AGENT_RUNNER_ID.toString(),
    name: "kubernetes-agent/prod",
    hostInfo: {
      kubernetes: { inCluster: true, clusterIdentifier: "prod" },
    },
    ...overrides,
  } as unknown as Runner;
}

function hostRow(overrides: Partial<Record<string, unknown>> = {}): Runner {
  return {
    id: HOST_RUNNER_ID,
    _id: HOST_RUNNER_ID.toString(),
    name: "office-runner",
    hostInfo: {},
    ...overrides,
  } as unknown as Runner;
}

function update(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = editorProps(),
  id: ObjectID = AGENT_RUNNER_ID,
): UpdateBy<Runner> {
  return {
    query: { _id: id.toString() },
    data: data as unknown as Runner,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<Runner>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("expected the write to be refused");
}

describe("isKubernetesAgentName / isKubernetesAgentRunnerRow", () => {
  it("reads the marker case-insensitively and trimmed, like the database", () => {
    for (const name of [
      "kubernetes-agent/prod",
      "Kubernetes-Agent/prod",
      "KUBERNETES-AGENT/x",
      "  kubernetes-agent/prod ",
    ]) {
      expect(RunnerServiceClass.isKubernetesAgentName(name)).toBe(true);
    }
  });

  it("negative control: names that only resemble the prefix are not agents", () => {
    for (const name of [
      "kubernetes-agentx/prod",
      "kubernetes-agent-office",
      "prod in-cluster runner",
      "my kubernetes-agent/x",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(RunnerServiceClass.isKubernetesAgentName(name)).toBe(false);
    }
  });

  /*
   * The service wrapper is what every guard calls. It agrees with the
   * shared helper on the canonical spelling, and reads every case variant
   * as the marker whatever the shared helper does with it.
   */
  it("agrees with the shared helper on the canonical name, and reads case variants too", () => {
    expect(isKubernetesAgentRunnerName("kubernetes-agent/prod")).toBe(true);
    expect(
      RunnerServiceClass.isKubernetesAgentName("kubernetes-agent/prod"),
    ).toBe(true);
    expect(
      RunnerServiceClass.isKubernetesAgentName("Kubernetes-Agent/prod"),
    ).toBe(true);
  });

  it("is an agent row by the name marker OR an agent posture", () => {
    // Renamed by root (the only writer left), posture intact.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow(
        agentRow({ name: "prod-runner" }),
      ),
    ).toBe(true);
    // Name intact, heartbeat dropped the posture.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow(agentRow({ hostInfo: {} })),
    ).toBe(true);
    // Case-variant name, no posture.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow(
        agentRow({ name: "Kubernetes-Agent/prod", hostInfo: {} }),
      ),
    ).toBe(true);
  });

  it("negative control: a Runner in a pod without a cluster identity is not an agent", () => {
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerRow(
        hostRow({ hostInfo: { kubernetes: { inCluster: true } } }),
      ),
    ).toBe(false);
    expect(RunnerServiceClass.isKubernetesAgentRunnerRow(hostRow())).toBe(
      false,
    );
    expect(RunnerServiceClass.isKubernetesAgentRunnerRow(null)).toBe(false);
  });

  it("knows whose agent a row is", () => {
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(agentRow(), "prod"),
    ).toBe(true);
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(agentRow(), "PROD"),
    ).toBe(true);
    // Another cluster's agent row.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        agentRow(),
        "staging",
      ),
    ).toBe(false);
    // This cluster's name, but its posture names another cluster.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        agentRow({
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "staging" },
          },
        }),
        "prod",
      ),
    ).toBe(false);
    // No name marker: only a posture naming this cluster makes it its agent.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        agentRow({ name: "prod-runner" }),
        "prod",
      ),
    ).toBe(true);
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(hostRow(), "prod"),
    ).toBe(false);
    // A cluster without an identifier has no agent.
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(agentRow(), ""),
    ).toBe(false);
  });

  it("recognises a shortened agent name as that cluster's", () => {
    const longIdentifier: string = "c".repeat(100);
    const name: string = getKubernetesAgentRunnerNameForCluster(longIdentifier);

    expect(name).not.toBe(getKubernetesAgentRunnerName(longIdentifier));
    expect(
      RunnerServiceClass.isKubernetesAgentRunnerOfCluster(
        agentRow({ name, hostInfo: {} }),
        longIdentifier,
      ),
    ).toBe(true);
  });
});

describe("RunnerService hooks keep the kubernetes-agent marker server-owned", () => {
  let findBy: jest.SpyInstance;
  let rows: Array<Runner>;

  beforeEach(() => {
    rows = [agentRow()];
    findBy = jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return rows;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("renames", () => {
    it("refuses renaming an agent row out of the prefix", async () => {
      const message: string = await refusal(
        hooks.onBeforeUpdate(update({ name: "prod-in-cluster" })),
      );

      expect(message).toContain('Runner "kubernetes-agent/prod"');
      expect(message).toContain("cannot be renamed");
      /*
       * Deleting it leaves the cluster with no Runner bound, and the agent's
       * fresh Runner never binds itself: the delete remedy names the select
       * step, and who may take it.
       */
      expect(message).toContain(
        "or delete the Runner, let the agent register a fresh one (on its next retry, within a minute) and then select the new Runner on the cluster's AI page as its Runner.",
      );
      expect(message).toContain(getDeletedAgentRunnerRebindNote());
      expect(message).toContain("Project Owner");
    });

    it("refuses a case-only rename of an agent row", async () => {
      await refusal(
        hooks.onBeforeUpdate(update({ name: "Kubernetes-Agent/prod" })),
      );
    });

    it("refuses renaming an agent row to another agent name", async () => {
      await refusal(
        hooks.onBeforeUpdate(update({ name: "kubernetes-agent/staging" })),
      );
    });

    it("refuses renaming an ordinary Runner INTO the prefix, in any case", async () => {
      rows = [hostRow()];

      for (const name of [
        "kubernetes-agent/x",
        "KUBERNETES-AGENT/x",
        "Kubernetes-Agent/prod",
      ]) {
        const message: string = await refusal(
          hooks.onBeforeUpdate(update({ name }, editorProps(), HOST_RUNNER_ID)),
        );
        expect(message).toContain('starting with "kubernetes-agent/"');
      }
    });

    it("scopes the rows it reads to the caller's project", async () => {
      await hooks
        .onBeforeUpdate(update({ name: "kubernetes-agent/prod" }))
        .catch(() => {
          return undefined;
        });

      const query: Record<string, unknown> = (
        findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["_id"]).toBe(AGENT_RUNNER_ID.toString());
    });

    it("negative control: the form re-posting an agent row's unchanged name saves", async () => {
      await expect(
        hooks.onBeforeUpdate(
          update({
            name: "kubernetes-agent/prod",
            description: "Our prod cluster's in-cluster Runner",
            canRunRunbooks: false,
            canRunCodeFixTasks: false,
          }),
        ),
      ).resolves.toBeDefined();
    });

    /*
     * Registration looks its row up by the exact (lowercased) name, so a
     * padded agent name would lose the row just as a rename would.
     */
    it("refuses padding an agent row's name with whitespace", async () => {
      for (const name of [" kubernetes-agent/prod", "kubernetes-agent/prod "]) {
        await refusal(hooks.onBeforeUpdate(update({ name })));
      }
    });

    it("negative control: an ordinary Runner is renamed as before", async () => {
      rows = [hostRow()];

      await expect(
        hooks.onBeforeUpdate(
          update({ name: "prod-eu-2" }, editorProps(), HOST_RUNNER_ID),
        ),
      ).resolves.toBeDefined();
    });

    it("negative control: root writes (registration) are not checked at all", async () => {
      await expect(
        hooks.onBeforeUpdate(
          update({ name: "renamed-by-the-server", key: "new" }, rootProps()),
        ),
      ).resolves.toBeDefined();
      expect(findBy).not.toHaveBeenCalled();
    });

    it("negative control: a write that touches neither the name nor a capability reads nothing", async () => {
      await hooks.onBeforeUpdate(update({ description: "x" }));

      expect(findBy).not.toHaveBeenCalled();
    });
  });

  describe("creates", () => {
    it("refuses a non-root create under the prefix, in any case", async () => {
      for (const name of [
        "kubernetes-agent/x",
        "Kubernetes-Agent/x",
        " KUBERNETES-AGENT/x",
      ]) {
        const create: CreateBy<Runner> = {
          data: { name, projectId: PROJECT_ID } as unknown as Runner,
          props: editorProps(),
        } as CreateBy<Runner>;

        await refusal(hooks.onBeforeCreate(create));
      }
    });

    it("negative control: an ordinary create, and registration's root create, pass", async () => {
      await expect(
        hooks.onBeforeCreate({
          data: new Runner(),
          props: editorProps(),
        } as CreateBy<Runner>),
      ).resolves.toBeDefined();

      const agent: Runner = new Runner();
      agent.name = "kubernetes-agent/prod";

      await expect(
        hooks.onBeforeCreate({
          data: agent,
          props: rootProps(),
        } as CreateBy<Runner>),
      ).resolves.toBeDefined();
    });
  });

  describe("capabilities on an agent row", () => {
    it.each([
      [{ canRunRunbooks: true }, '"Runs Runbooks"'],
      [{ canRunCodeFixTasks: true }, '"Runs AI Code Fixes"'],
    ])(
      "refuses turning on %p for an agent row",
      async (data: Record<string, unknown>, title: string) => {
        const message: string = await refusal(
          hooks.onBeforeUpdate(update(data)),
        );

        expect(message).toContain(title);
        expect(message).toContain("re-registering");
      },
    );

    it("refuses it for a row recognised by its posture only (renamed by root)", async () => {
      rows = [agentRow({ name: "prod-runner" })];

      await refusal(hooks.onBeforeUpdate(update({ canRunRunbooks: true })));
    });

    it("negative control: the same toggles on an ordinary Runner save", async () => {
      rows = [hostRow()];

      await expect(
        hooks.onBeforeUpdate(
          update(
            { canRunRunbooks: true, canRunCodeFixTasks: true },
            editorProps(),
            HOST_RUNNER_ID,
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("negative control: root may still write them (the server's own writes)", async () => {
      await expect(
        hooks.onBeforeUpdate(update({ canRunRunbooks: true }, rootProps())),
      ).resolves.toBeDefined();
    });
  });

  /*
   * The point of a server-owned marker: after a refused rename the row is
   * still an agent row, so a credential still cannot be assigned to it.
   */
  it("after a refused rename, assigning a credential to the row is still refused", async () => {
    await refusal(hooks.onBeforeUpdate(update({ name: "prod-in-cluster" })));

    const credentialHooks: CredentialHookAccess<RunbookCredential> =
      RunbookCredentialService as unknown as CredentialHookAccess<RunbookCredential>;

    const credential: RunbookCredential = new RunbookCredential();
    credential.credentialType = RunbookCredentialType.Kubernetes;

    await expect(
      credentialHooks.onBeforeUpdate({
        query: { _id: ObjectID.generate().toString() },
        data: {
          runners: [{ _id: AGENT_RUNNER_ID.toString() }],
        } as unknown as RunbookCredential,
        limit: 1,
        skip: 0,
        props: rootProps(),
      } as unknown as UpdateBy<RunbookCredential>),
    ).rejects.toThrow(/never given a credential/);
  });
});

describe("RunnerService lookups leave agent rows out", () => {
  let findBy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("getOnlineCodeFixRunnerForProject excludes agent rows in the query and on the rows", async () => {
    findBy = jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([
        agentRow({ canRunCodeFixTasks: true }),
        agentRow({ name: "renamed", canRunCodeFixTasks: true }),
        hostRow({ canRunCodeFixTasks: true }),
      ]);

    const runner: Runner | null =
      await RunnerService.getOnlineCodeFixRunnerForProject(PROJECT_ID);

    expect(runner?.name).toBe("office-runner");

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
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

  it("getOnlineCodeFixRunnerForProject: a project whose only code-fix Runner is an agent has none", async () => {
    jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([agentRow({ canRunCodeFixTasks: true })]);

    expect(
      await RunnerService.getOnlineCodeFixRunnerForProject(PROJECT_ID),
    ).toBeNull();
  });

  it("getOnlineAiCommandRunnersForProject drops a row with an agent posture whatever its name", async () => {
    jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([
        agentRow({ name: "renamed-agent" }),
        agentRow({ name: "Kubernetes-Agent/prod", hostInfo: {} }),
        hostRow(),
      ]);

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

  it("assertNoKubernetesAgentRunners refuses a posture-only or case-variant agent row", async () => {
    for (const row of [
      agentRow({ name: "renamed-agent" }),
      agentRow({ name: "Kubernetes-Agent/prod", hostInfo: {} }),
    ]) {
      jest.restoreAllMocks();
      jest.spyOn(RunnerService, "findBy").mockResolvedValue([row]);

      await expect(
        RunnerService.assertNoKubernetesAgentRunners({
          runners: [AGENT_RUNNER_ID],
          assignedWhat: "credential",
        }),
      ).rejects.toThrow(/never given a credential/);
    }
  });

  it("negative control: an ordinary Runner in a pod may be assigned credentials", async () => {
    jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([
        hostRow({ hostInfo: { kubernetes: { inCluster: true } } }),
      ]);

    await expect(
      RunnerService.assertNoKubernetesAgentRunners({
        runners: [HOST_RUNNER_ID],
        assignedWhat: "credential",
      }),
    ).resolves.toBeUndefined();
  });
});
