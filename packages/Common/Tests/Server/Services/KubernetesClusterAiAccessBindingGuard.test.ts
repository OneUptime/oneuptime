import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the tenant guard on a cluster's AI access binding.
 *
 * aiAccessRunnerId and aiAccessCredentialId are ordinary CRUD columns that
 * every member who may edit a cluster can write, and the framework checks
 * only the tenant relation itself — never that a ManyToOne target belongs
 * to the row's project. Without this guard a member of project A could
 * point their cluster at project B's Runner or credential and then read
 * that Runner's name, liveness and connection status (or the credential's
 * name and type) through the relation join, and probe foreign ids through
 * the foreign key. So KubernetesClusterService's create and update hooks
 * must:
 *
 * - resolve the Runner and the credential scoped to the cluster's project,
 *   under BOTH spellings the payload can use (FK column, relation object);
 * - refuse a Runner or credential from another project, or one that does
 *   not exist, with the same message MonitorProbeService uses;
 * - refuse a credential that is not a Kubernetes credential;
 * - let a clear (null) through, and do nothing for writes that do not
 *   touch the binding;
 * - on update, use the caller's tenant when there is one and otherwise the
 *   project of every cluster the query matches, failing closed when a
 *   binding cannot be checked against any project.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
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

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<KubernetesCluster>,
  ) => Promise<{ createBy: CreateBy<KubernetesCluster> }>;
  onBeforeUpdate: (
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<{ updateBy: UpdateBy<KubernetesCluster> }>;
};

function hooks(): Hooks {
  return KubernetesClusterService as unknown as Hooks;
}

function memberProps(
  tenantId?: ObjectID | undefined,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    ...(tenantId ? { tenantId } : {}),
  } as DatabaseCommonInteractionProps;
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function createBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = memberProps(PROJECT_ID),
): CreateBy<KubernetesCluster> {
  return {
    data: data as unknown as KubernetesCluster,
    props,
  } as CreateBy<KubernetesCluster>;
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = memberProps(PROJECT_ID),
): UpdateBy<KubernetesCluster> {
  return {
    query: { _id: CLUSTER_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<KubernetesCluster>;
}

function lastQuery(spy: jest.SpyInstance): Record<string, unknown> {
  return (
    spy.mock.calls[spy.mock.calls.length - 1]![0] as {
      query: Record<string, unknown>;
    }
  ).query;
}

describe("KubernetesClusterService AI access binding guard", () => {
  let runnerLookup: jest.SpyInstance;
  let credentialLookup: jest.SpyInstance;
  let clusterProjectLookup: jest.SpyInstance;

  beforeEach(() => {
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);
    credentialLookup = jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue({
        id: CREDENTIAL_ID,
        credentialType: RunbookCredentialType.Kubernetes,
      } as unknown as RunbookCredential);
    clusterProjectLookup = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        {
          id: CLUSTER_ID,
          projectId: PROJECT_ID,
        } as unknown as KubernetesCluster,
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("installs non-stock create and update hooks", () => {
    expect(hooks().onBeforeCreate).not.toBe(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DatabaseService.prototype as any).onBeforeCreate,
    );
    expect(hooks().onBeforeUpdate).not.toBe(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (DatabaseService.prototype as any).onBeforeUpdate,
    );
  });

  describe("on update", () => {
    it("checks the Runner against the caller's project and lets a same-project Runner through", async () => {
      await hooks().onBeforeUpdate(updateBy({ aiAccessRunnerId: RUNNER_ID }));

      expect(runnerLookup).toHaveBeenCalledTimes(1);
      expect(lastQuery(runnerLookup)["_id"]).toBe(RUNNER_ID.toString());
      expect(lastQuery(runnerLookup)["projectId"]).toBe(PROJECT_ID);
      // The tenant was on the props; no need to look the cluster up.
      expect(clusterProjectLookup).not.toHaveBeenCalled();
    });

    it("refuses a Runner that is not in the caller's project", async () => {
      runnerLookup.mockResolvedValue(null);

      await expect(
        hooks().onBeforeUpdate(updateBy({ aiAccessRunnerId: RUNNER_ID })),
      ).rejects.toThrow(
        "Runner not found or it does not belong to this project.",
      );
    });

    it("reads the relation-object spelling the dashboard posts", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunner: { _id: RUNNER_ID.toString() } }),
      );

      expect(lastQuery(runnerLookup)["_id"]).toBe(RUNNER_ID.toString());

      runnerLookup.mockResolvedValue(null);

      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessRunner: { _id: RUNNER_ID.toString() } }),
        ),
      ).rejects.toThrow(BadDataException);
    });

    it("reads a bare id string in the relation slot, and an ObjectID", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunner: RUNNER_ID.toString() }),
      );
      expect(lastQuery(runnerLookup)["_id"]).toBe(RUNNER_ID.toString());

      await hooks().onBeforeUpdate(updateBy({ aiAccessRunner: RUNNER_ID }));
      expect(lastQuery(runnerLookup)["_id"]).toBe(RUNNER_ID.toString());
    });

    it("refuses a payload whose two spellings point at different Runners", async () => {
      const otherRunnerId: ObjectID = ObjectID.generate();

      await expect(
        hooks().onBeforeUpdate(
          updateBy({
            aiAccessRunnerId: RUNNER_ID,
            aiAccessRunner: { _id: otherRunnerId.toString() },
          }),
        ),
      ).rejects.toThrow(/Conflicting AI access Runner references/);

      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("checks the credential against the caller's project and requires a Kubernetes credential", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessCredentialId: CREDENTIAL_ID }),
      );

      expect(credentialLookup).toHaveBeenCalledTimes(1);
      expect(lastQuery(credentialLookup)["_id"]).toBe(CREDENTIAL_ID.toString());
      expect(lastQuery(credentialLookup)["projectId"]).toBe(PROJECT_ID);

      credentialLookup.mockResolvedValue(null);
      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessCredentialId: CREDENTIAL_ID }),
        ),
      ).rejects.toThrow(
        "Credential not found or it does not belong to this project.",
      );

      credentialLookup.mockResolvedValue({
        id: CREDENTIAL_ID,
        credentialType: RunbookCredentialType.SSH,
      } as unknown as RunbookCredential);
      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessCredential: { _id: CREDENTIAL_ID.toString() } }),
        ),
      ).rejects.toThrow(/must be a Kubernetes credential/);
    });

    it("checks both when both are written, and reports the Runner first", async () => {
      runnerLookup.mockResolvedValue(null);
      credentialLookup.mockResolvedValue(null);

      await expect(
        hooks().onBeforeUpdate(
          updateBy({
            aiAccessRunnerId: RUNNER_ID,
            aiAccessCredentialId: CREDENTIAL_ID,
          }),
        ),
      ).rejects.toThrow(/Runner not found/);

      runnerLookup.mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);

      await expect(
        hooks().onBeforeUpdate(
          updateBy({
            aiAccessRunnerId: RUNNER_ID,
            aiAccessCredentialId: CREDENTIAL_ID,
          }),
        ),
      ).rejects.toThrow(/Credential not found/);
    });

    it("lets a clear (null) through without a lookup", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: null, aiAccessCredentialId: null }),
      );
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunner: null, aiAccessCredential: null }),
      );

      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(clusterProjectLookup).not.toHaveBeenCalled();
    });

    it("does nothing for an update that does not touch the binding", async () => {
      const update: UpdateBy<KubernetesCluster> = updateBy({
        name: "renamed",
        isAiInvestigationEnabled: true,
      });

      const result: { updateBy: UpdateBy<KubernetesCluster> } =
        await hooks().onBeforeUpdate(update);

      expect(result.updateBy).toBe(update);
      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(clusterProjectLookup).not.toHaveBeenCalled();
    });

    /*
     * Root/API updates (the in-cluster registration binds as root) carry
     * no tenantId, so the project comes from the clusters the query
     * matches — and the Runner must belong to every one of them.
     */
    it("falls back to the project of the matched cluster for a root update", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: RUNNER_ID }, rootProps()),
      );

      expect(clusterProjectLookup).toHaveBeenCalledTimes(1);
      expect(
        (clusterProjectLookup.mock.calls[0]![0] as { query: unknown }).query,
      ).toEqual({ _id: CLUSTER_ID.toString() });
      expect(lastQuery(runnerLookup)["projectId"]).toBe(PROJECT_ID);
    });

    it("refuses a root update whose Runner belongs to a different project than the matched cluster", async () => {
      runnerLookup.mockImplementation(
        async (args: unknown): Promise<Runner | null> => {
          const query: Record<string, unknown> = (
            args as { query: Record<string, unknown> }
          ).query;
          return (query["projectId"] as ObjectID).toString() ===
            OTHER_PROJECT_ID.toString()
            ? ({ id: RUNNER_ID } as unknown as Runner)
            : null;
        },
      );

      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessRunnerId: RUNNER_ID }, rootProps()),
        ),
      ).rejects.toThrow(/Runner not found/);
    });

    it("checks the Runner against every project a multi-row root update matches", async () => {
      clusterProjectLookup.mockResolvedValue([
        { id: CLUSTER_ID, projectId: PROJECT_ID },
        { id: ObjectID.generate(), projectId: OTHER_PROJECT_ID },
      ] as unknown as Array<KubernetesCluster>);

      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: RUNNER_ID }, rootProps()),
      );

      const projectsChecked: Array<string> = runnerLookup.mock.calls.map(
        (call: Array<unknown>) => {
          return (
            (call[0] as { query: Record<string, unknown> }).query[
              "projectId"
            ] as ObjectID
          ).toString();
        },
      );

      expect(projectsChecked.sort()).toEqual(
        [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
      );
    });

    it("fails closed when a binding is written but no project can be resolved", async () => {
      clusterProjectLookup.mockResolvedValue([]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessRunnerId: RUNNER_ID }, rootProps()),
        ),
      ).rejects.toThrow(/could not be resolved/);

      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("still lets a clear through when no project can be resolved", async () => {
      clusterProjectLookup.mockResolvedValue([]);

      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: null }, rootProps()),
      );

      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("prefers the caller's tenant over the matched rows when both are available", async () => {
      await hooks().onBeforeUpdate(
        updateBy(
          { aiAccessRunnerId: RUNNER_ID },
          memberProps(OTHER_PROJECT_ID),
        ),
      );

      expect(clusterProjectLookup).not.toHaveBeenCalled();
      expect(lastQuery(runnerLookup)["projectId"]).toBe(OTHER_PROJECT_ID);
    });
  });

  describe("on create", () => {
    it("checks the binding against the row's own project", async () => {
      await hooks().onBeforeCreate(
        createBy({
          projectId: PROJECT_ID,
          name: "prod-us",
          clusterIdentifier: "prod-us",
          aiAccessRunnerId: RUNNER_ID,
          aiAccessCredentialId: CREDENTIAL_ID,
        }),
      );

      expect(lastQuery(runnerLookup)["projectId"]).toBe(PROJECT_ID);
      expect(lastQuery(credentialLookup)["projectId"]).toBe(PROJECT_ID);
    });

    it("refuses a foreign Runner and a foreign credential on create", async () => {
      runnerLookup.mockResolvedValue(null);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            projectId: PROJECT_ID,
            name: "prod-us",
            aiAccessRunner: { _id: RUNNER_ID.toString() },
          }),
        ),
      ).rejects.toThrow(/Runner not found/);

      credentialLookup.mockResolvedValue(null);

      await expect(
        hooks().onBeforeCreate(
          createBy({
            projectId: PROJECT_ID,
            name: "prod-us",
            aiAccessCredentialId: CREDENTIAL_ID,
          }),
        ),
      ).rejects.toThrow(/Credential not found/);
    });

    it("falls back to the project relation and then to the caller's tenant", async () => {
      await hooks().onBeforeCreate(
        createBy({
          project: { id: PROJECT_ID, _id: PROJECT_ID.toString() },
          name: "prod-us",
          aiAccessRunnerId: RUNNER_ID,
        }),
      );
      expect(lastQuery(runnerLookup)["projectId"]).toBe(PROJECT_ID);

      await hooks().onBeforeCreate(
        createBy(
          { name: "prod-us", aiAccessRunnerId: RUNNER_ID },
          memberProps(OTHER_PROJECT_ID),
        ),
      );
      expect(lastQuery(runnerLookup)["projectId"]).toBe(OTHER_PROJECT_ID);
    });

    it("fails closed when a binding is given and no project is known", async () => {
      await expect(
        hooks().onBeforeCreate(
          createBy(
            { name: "prod-us", aiAccessRunnerId: RUNNER_ID },
            rootProps(),
          ),
        ),
      ).rejects.toThrow(/could not be resolved/);
    });

    it("does nothing for a create without a binding (the ingest path)", async () => {
      const create: CreateBy<KubernetesCluster> = createBy(
        {
          projectId: PROJECT_ID,
          name: "prod-us",
          clusterIdentifier: "prod-us",
        },
        rootProps(),
      );

      const result: { createBy: CreateBy<KubernetesCluster> } =
        await hooks().onBeforeCreate(create);

      expect(result.createBy).toBe(create);
      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
    });
  });
});
