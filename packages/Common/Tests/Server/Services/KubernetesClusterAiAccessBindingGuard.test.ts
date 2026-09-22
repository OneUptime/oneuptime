import KubernetesClusterService, {
  AI_ACCESS_CREDENTIAL_REFUSAL,
  MAX_KUBECTL_ALLOWLIST_PATTERNS,
  MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH,
  getAiAccessCredentialRefusal,
} from "../../../Server/Services/KubernetesClusterService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import CommandPolicy from "../../../Utils/AiRemediation/CommandPolicy";
import KubectlPolicy from "../../../Utils/AiRemediation/KubectlPolicy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the tenant guard on a cluster's AI access binding,
 * the shape of the AI remediation settings, and the "AI access was
 * configured" marker.
 *
 * aiAccessRunnerId and aiAccessCredentialId are ordinary CRUD columns, and
 * the framework checks only the tenant relation itself — never that a
 * ManyToOne target belongs to the row's project. Without this guard a
 * caller in project A could point their cluster at project B's Runner or
 * credential and then read that Runner's name, liveness and connection
 * status (or the credential's name and type) through the relation join,
 * and probe foreign ids through the foreign key. So KubernetesClusterService's
 * create and update hooks must:
 *
 * - resolve the Runner and the credential scoped to the cluster's project,
 *   under BOTH spellings the payload can use (FK column, relation object);
 * - refuse a Runner or credential from another project, or one that does
 *   not exist, with the same message MonitorProbeService uses — and give ONE
 *   answer for a credential that is missing and one that is not a
 *   Kubernetes credential, so the check is not a type oracle;
 * - let a clear (null) through, and do nothing for writes that do not
 *   touch the binding;
 * - on update, use the caller's tenant when there is one and otherwise the
 *   project of every cluster the query matches, failing closed when a
 *   binding cannot be checked against any project.
 *
 * WHO may bind (only the roles that may author a FullAuto remediation rule,
 * plus credential read for a credential) is covered in depth by
 * KubernetesClusterAiSettingsPermission.test.ts; the binding tests here run
 * as a project admin, who may, and this file pins the credential-read half.
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
  ) => Promise<OnCreate<KubernetesCluster>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<KubernetesCluster>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
  onCreateSuccess: (
    onCreate: OnCreate<KubernetesCluster>,
    createdItem: KubernetesCluster,
  ) => Promise<KubernetesCluster>;
};

function hooks(): Hooks {
  return KubernetesClusterService as unknown as Hooks;
}

/*
 * A signed-in user holding exactly `permissions` (as grants) in `tenantId`.
 * DatabaseCommonInteractionPropsUtil and holdsAnyPermission read only the
 * tenant bucket keyed by project id, so the key must be right or every
 * refusal below would pass for the wrong reason.
 */
function userProps(
  tenantId: ObjectID | undefined,
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const permissionProjectId: ObjectID = tenantId || PROJECT_ID;
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: permissionProjectId,
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: ObjectID.generate(),
    ...(tenantId ? { tenantId } : {}),
    userTenantAccessPermission: {
      [permissionProjectId.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

// A project admin: may bind a Runner and read (so bind) credentials.
function adminProps(
  tenantId: ObjectID | undefined = PROJECT_ID,
): DatabaseCommonInteractionProps {
  return userProps(tenantId, [Permission.ProjectAdmin]);
}

function rootProps(): DatabaseCommonInteractionProps {
  return { isRoot: true } as DatabaseCommonInteractionProps;
}

function createBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = adminProps(PROJECT_ID),
): CreateBy<KubernetesCluster> {
  return {
    data: data as unknown as KubernetesCluster,
    props,
  } as CreateBy<KubernetesCluster>;
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = adminProps(PROJECT_ID),
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

type FindByArgs = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
};

/*
 * KubernetesClusterService.findBy serves two readers in onBeforeUpdate: the
 * binding guard's "which project does this root update reach?" lookup
 * (selects only projectId) and the operator-write settings read (selects
 * the AI columns too). The binding assertions are about the first.
 */
function projectOnlyLookups(spy: jest.SpyInstance): Array<FindByArgs> {
  return spy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as FindByArgs;
    })
    .filter((args: FindByArgs) => {
      return !("aiRemediationMode" in (args.select || {}));
    });
}

function settingsReads(spy: jest.SpyInstance): Array<FindByArgs> {
  return spy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as FindByArgs;
    })
    .filter((args: FindByArgs) => {
      return "aiRemediationMode" in (args.select || {});
    });
}

describe("KubernetesClusterService AI access binding guard", () => {
  let runnerLookup: jest.SpyInstance;
  let credentialLookup: jest.SpyInstance;
  let clusterLookup: jest.SpyInstance;

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
    /*
     * The cluster lives in PROJECT_ID. A read scoped to another project
     * (the operator-write settings read adds the caller's tenant) finds
     * nothing, as Postgres would.
     */
    clusterLookup = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockImplementation(
        async (args: unknown): Promise<Array<KubernetesCluster>> => {
          const query: Record<string, unknown> = (args as FindByArgs).query;
          if (
            query["projectId"] &&
            (query["projectId"] as ObjectID).toString() !==
              PROJECT_ID.toString()
          ) {
            return [];
          }
          return [
            {
              id: CLUSTER_ID,
              projectId: PROJECT_ID,
            } as unknown as KubernetesCluster,
          ];
        },
      );
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
      // The tenant was on the props; no need to look the project up.
      expect(projectOnlyLookups(clusterLookup)).toHaveLength(0);
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
      ).rejects.toThrow(AI_ACCESS_CREDENTIAL_REFUSAL);

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

    /*
     * "Not found" and "wrong type" used to be two different messages, so a
     * caller could learn from the refusal whether an id existed in the
     * project and what kind of credential it was.
     */
    it("gives the same refusal for a missing credential and a credential of another type", async () => {
      const refusalFor: (
        credential: RunbookCredential | null,
      ) => Promise<string> = async (
        credential: RunbookCredential | null,
      ): Promise<string> => {
        credentialLookup.mockResolvedValue(credential);
        try {
          await hooks().onBeforeUpdate(
            updateBy({ aiAccessCredentialId: CREDENTIAL_ID }),
          );
        } catch (error) {
          expect(error).toBeInstanceOf(BadDataException);
          return (error as Error).message;
        }
        throw new Error("expected the credential to be refused");
      };

      const missing: string = await refusalFor(null);
      const ssh: string = await refusalFor({
        id: CREDENTIAL_ID,
        credentialType: RunbookCredentialType.SSH,
      } as unknown as RunbookCredential);

      expect(missing).toBe(AI_ACCESS_CREDENTIAL_REFUSAL);
      expect(ssh).toBe(missing);
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

    it("lets a clear (null) through without a Runner or credential lookup", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: null, aiAccessCredentialId: null }),
      );
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunner: null, aiAccessCredential: null }),
      );

      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(projectOnlyLookups(clusterLookup)).toHaveLength(0);
    });

    /*
     * Clearing only makes AI do less, so it needs no more than editing the
     * cluster: a project member without any AI-access permission may do it.
     */
    it("lets a caller with no AI-access permission clear the binding", async () => {
      await hooks().onBeforeUpdate(
        updateBy(
          { aiAccessRunnerId: null, aiAccessCredentialId: null },
          userProps(PROJECT_ID, [Permission.ProjectMember]),
        ),
      );

      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    /*
     * Pinned before this change as "does nothing": a user's write of an AI
     * setting now reads the cluster's current settings (the baseline the
     * permission check compares against and the "before" half of the feed
     * item). It still looks up no Runner, credential or project.
     */
    it("looks up no Runner, credential or project for an update that does not touch the binding", async () => {
      const update: UpdateBy<KubernetesCluster> = updateBy({
        name: "renamed",
        isAiInvestigationEnabled: true,
      });

      const result: OnUpdate<KubernetesCluster> =
        await hooks().onBeforeUpdate(update);

      expect(result.updateBy).toBe(update);
      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(projectOnlyLookups(clusterLookup)).toHaveLength(0);
      expect(settingsReads(clusterLookup)).toHaveLength(1);
    });

    it("reads nothing at all for an update that writes no AI access setting", async () => {
      const update: UpdateBy<KubernetesCluster> = updateBy({
        name: "renamed",
      });

      const result: OnUpdate<KubernetesCluster> =
        await hooks().onBeforeUpdate(update);

      expect(result.updateBy).toBe(update);
      expect(result.carryForward).toBeNull();
      expect(clusterLookup).not.toHaveBeenCalled();
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

      expect(clusterLookup).toHaveBeenCalledTimes(1);
      expect(
        (clusterLookup.mock.calls[0]![0] as { query: unknown }).query,
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
      clusterLookup.mockResolvedValue([
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
      clusterLookup.mockResolvedValue([]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessRunnerId: RUNNER_ID }, rootProps()),
        ),
      ).rejects.toThrow(/could not be resolved/);

      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("still lets a clear through when no project can be resolved", async () => {
      clusterLookup.mockResolvedValue([]);

      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: null }, rootProps()),
      );

      expect(runnerLookup).not.toHaveBeenCalled();
    });

    it("prefers the caller's tenant over the matched rows when both are available", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessRunnerId: RUNNER_ID }, adminProps(OTHER_PROJECT_ID)),
      );

      expect(projectOnlyLookups(clusterLookup)).toHaveLength(0);
      expect(lastQuery(runnerLookup)["projectId"]).toBe(OTHER_PROJECT_ID);
    });
  });

  /*
   * The dashboard hides the credential picker from users who may not read
   * credentials, but the CRUD API used to accept any credential id from
   * anyone who may edit the cluster (an id is readable off another
   * cluster's aiAccessCredentialId). The server now applies the picker's
   * rule itself.
   */
  describe("binding a credential needs permission to read credentials", () => {
    it("refuses a project member binding a same-project Kubernetes credential, before any credential lookup", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: CREDENTIAL_ID },
            userProps(PROJECT_ID, [Permission.ProjectMember]),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      // Refused on who is asking, so the lookup is no oracle for them.
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("refuses a holder of Edit Auto Remediation Rule without credential read, under both spellings", async () => {
      for (const data of [
        { aiAccessCredentialId: CREDENTIAL_ID },
        { aiAccessCredential: { _id: CREDENTIAL_ID.toString() } },
      ]) {
        await expect(
          hooks().onBeforeUpdate(
            updateBy(
              data,
              userProps(PROJECT_ID, [Permission.EditAutoRemediationRule]),
            ),
          ),
        ).rejects.toThrow(getAiAccessCredentialRefusal());
      }

      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("names the permissions that would allow it", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: CREDENTIAL_ID },
            userProps(PROJECT_ID, [Permission.EditAutoRemediationRule]),
          ),
        ),
      ).rejects.toThrow(
        /Project Owner, Project Admin, Read Runbook Credential/,
      );
    });

    it("accepts the same binding once the caller may read credentials", async () => {
      await hooks().onBeforeUpdate(
        updateBy(
          { aiAccessCredentialId: CREDENTIAL_ID },
          userProps(PROJECT_ID, [
            Permission.EditAutoRemediationRule,
            Permission.ReadRunbookCredential,
          ]),
        ),
      );

      expect(credentialLookup).toHaveBeenCalledTimes(1);
    });

    it("accepts a project admin and a project owner", async () => {
      await hooks().onBeforeUpdate(
        updateBy({ aiAccessCredentialId: CREDENTIAL_ID }, adminProps()),
      );
      await hooks().onBeforeUpdate(
        updateBy(
          { aiAccessCredential: { _id: CREDENTIAL_ID.toString() } },
          userProps(PROJECT_ID, [Permission.ProjectOwner]),
        ),
      );

      expect(credentialLookup).toHaveBeenCalledTimes(2);
    });

    it("does not read a block row for credential read as a grant", async () => {
      const props: DatabaseCommonInteractionProps = userProps(PROJECT_ID, [
        Permission.EditAutoRemediationRule,
      ]);
      props.userTenantAccessPermission![
        PROJECT_ID.toString()
      ]!.permissions.push({
        _type: "UserPermission",
        permission: Permission.ReadRunbookCredential,
        labelIds: [],
        isBlockPermission: true,
      });

      await expect(
        hooks().onBeforeUpdate(
          updateBy({ aiAccessCredentialId: CREDENTIAL_ID }, props),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("lets the in-cluster registration (root) bind without any permission rows", async () => {
      await hooks().onBeforeUpdate(
        updateBy(
          {
            aiAccessRunnerId: RUNNER_ID,
            aiAccessCredentialId: CREDENTIAL_ID,
          },
          rootProps(),
        ),
      );

      expect(credentialLookup).toHaveBeenCalledTimes(1);
    });

    /*
     * The AI page posts every field of its form, so a member who only flips
     * the investigation switch re-posts the credential an admin bound.
     * Unchanged is not "binding".
     */
    it("lets a member re-post the credential that is already bound", async () => {
      clusterLookup.mockResolvedValue([
        {
          id: CLUSTER_ID,
          projectId: PROJECT_ID,
          aiAccessCredentialId: CREDENTIAL_ID,
        } as unknown as KubernetesCluster,
      ]);

      await hooks().onBeforeUpdate(
        updateBy(
          {
            isAiInvestigationEnabled: false,
            aiAccessCredential: { _id: CREDENTIAL_ID.toString() },
          },
          userProps(PROJECT_ID, [Permission.ProjectMember]),
        ),
      );
    });
  });

  /*
   * A Settings Member cannot approve a single kubectl plan, so it must not
   * be able to remove the approval step either. The full role matrix lives
   * in KubernetesClusterAiSettingsPermission.test.ts; this is the shortest
   * statement of the escalation that was closed.
   */
  describe("only roles that may author a FullAuto rule can make a cluster unattended", () => {
    it.each([
      [{ aiRemediationMode: KubernetesAiRemediationMode.BypassApproval }],
      [{ aiRemediationMode: KubernetesAiRemediationMode.Automatic }],
      [{ aiKubectlCommandAllowlist: ["*"] }],
    ])(
      "refuses %p from a Settings Member and accepts it from a Project Admin",
      async (data: object) => {
        await expect(
          hooks().onBeforeUpdate(
            updateBy(
              data as Record<string, unknown>,
              userProps(PROJECT_ID, [Permission.SettingsMember]),
            ),
          ),
        ).rejects.toThrow(NotAuthorizedException);

        await expect(
          hooks().onBeforeUpdate(
            updateBy(data as Record<string, unknown>, adminProps()),
          ),
        ).resolves.toBeDefined();
      },
    );
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
          adminProps(OTHER_PROJECT_ID),
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

      const result: OnCreate<KubernetesCluster> =
        await hooks().onBeforeCreate(create);

      expect(result.createBy).toBe(create);
      expect(runnerLookup).not.toHaveBeenCalled();
      expect(credentialLookup).not.toHaveBeenCalled();
    });

    it("refuses a create that binds a credential for a caller without credential read", async () => {
      await expect(
        hooks().onBeforeCreate(
          createBy(
            {
              projectId: PROJECT_ID,
              name: "prod-us",
              aiAccessCredentialId: CREDENTIAL_ID,
            },
            userProps(PROJECT_ID, [Permission.EditAutoRemediationRule]),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });
  });
});

/*
 * aiRemediationMode is a plain text column and aiKubectlCommandAllowlist
 * untyped JSON; their readers map anything unusable to Disabled / "no
 * pattern". Without write-side validation an API or Terraform write of
 * "automatic" or of a pattern that can never match answered 200, showed no
 * drift, and silently did nothing.
 */
describe("KubernetesClusterService AI remediation settings validation", () => {
  let runnerLookup: jest.SpyInstance;

  beforeEach(() => {
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);
    jest.spyOn(KubernetesClusterService, "findBy").mockResolvedValue([
      {
        id: CLUSTER_ID,
        projectId: PROJECT_ID,
      } as unknown as KubernetesCluster,
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function update(
    data: Record<string, unknown>,
  ): Promise<UpdateBy<KubernetesCluster>> {
    const update: UpdateBy<KubernetesCluster> = updateBy(data);
    await hooks().onBeforeUpdate(update);
    return update;
  }

  function writtenAllowlist(update: UpdateBy<KubernetesCluster>): unknown {
    return (update.data as unknown as Record<string, unknown>)[
      "aiKubectlCommandAllowlist"
    ];
  }

  describe("remediation mode", () => {
    it.each([
      ["automatic"],
      ["Automatic "],
      ["Bypass"],
      ["FullAuto"],
      [""],
      [null],
      [3],
    ])("refuses %p", async (mode: unknown) => {
      await expect(update({ aiRemediationMode: mode })).rejects.toThrow(
        BadDataException,
      );
    });

    it("says which values are accepted and what it got", async () => {
      await expect(update({ aiRemediationMode: "automatic" })).rejects.toThrow(
        'AI remediation mode must be one of Disabled, RequireApproval, Automatic, BypassApproval (got "automatic").',
      );
    });

    it.each(Object.values(KubernetesAiRemediationMode))(
      "accepts %s",
      async (mode: KubernetesAiRemediationMode) => {
        const written: UpdateBy<KubernetesCluster> = await update({
          aiRemediationMode: mode,
        });
        expect(
          (written.data as unknown as Record<string, unknown>)[
            "aiRemediationMode"
          ],
        ).toBe(mode);
      },
    );

    it("rejects on the mode even when a valid Runner is written alongside it (the check is not behind the binding guard)", async () => {
      await expect(
        update({ aiRemediationMode: "automatic", aiAccessRunnerId: RUNNER_ID }),
      ).rejects.toThrow(/AI remediation mode must be one of/);

      expect(runnerLookup).not.toHaveBeenCalled();
    });
  });

  describe("kubectl allowlist", () => {
    it.each([
      [{ a: 1 }, /must be a JSON array/],
      [42, /must be a JSON array/],
      [true, /must be a JSON array/],
      ["kubectl scale *", /must be a JSON array/],
      ['{"a": 1}', /must be a JSON array/],
      [[1], /Pattern 1 of the kubectl allowlist must be text \(got number\)/],
      [
        ["kubectl scale *", null],
        /Pattern 2 of the kubectl allowlist must be text \(got null\)/,
      ],
      [[""], /Pattern 1 of the kubectl allowlist is empty/],
      [["   "], /Pattern 1 of the kubectl allowlist is empty/],
      [
        ["set image deployment/web *"],
        /Pattern 1 of the kubectl allowlist \("set image deployment\/web \*"\) must start with "kubectl " or with a \* wildcard/,
      ],
      [["kubectlscale *"], /must start with "kubectl "/],
      [["Kubectl scale *"], /must start with "kubectl "/],
    ])("refuses %p", async (value: unknown, message: RegExp) => {
      await expect(
        update({ aiKubectlCommandAllowlist: value }),
      ).rejects.toThrow(message);
      await expect(
        update({ aiKubectlCommandAllowlist: value }),
      ).rejects.toThrow(BadDataException);
    });

    it(`refuses more than ${MAX_KUBECTL_ALLOWLIST_PATTERNS} patterns`, async () => {
      const patterns: Array<string> = [];
      for (let i: number = 0; i <= MAX_KUBECTL_ALLOWLIST_PATTERNS; i++) {
        patterns.push(`kubectl scale deployment/web-${i} --replicas=*`);
      }

      await expect(
        update({ aiKubectlCommandAllowlist: patterns }),
      ).rejects.toThrow(
        `The kubectl allowlist can hold at most ${MAX_KUBECTL_ALLOWLIST_PATTERNS} patterns (got ${MAX_KUBECTL_ALLOWLIST_PATTERNS + 1}).`,
      );

      // Negative control: exactly the limit is fine.
      const written: UpdateBy<KubernetesCluster> = await update({
        aiKubectlCommandAllowlist: patterns.slice(
          0,
          MAX_KUBECTL_ALLOWLIST_PATTERNS,
        ),
      });
      expect(writtenAllowlist(written)).toHaveLength(
        MAX_KUBECTL_ALLOWLIST_PATTERNS,
      );
    });

    it(`refuses a pattern longer than ${MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH} characters`, async () => {
      const prefix: string = "kubectl set image deployment/";
      const tooLong: string =
        prefix +
        "a".repeat(MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH + 1 - prefix.length);
      const atLimit: string = tooLong.slice(0, -1);

      await expect(
        update({ aiKubectlCommandAllowlist: [tooLong] }),
      ).rejects.toThrow(
        /Pattern 1 of the kubectl allowlist is 501 characters long; the most is 500/,
      );

      const written: UpdateBy<KubernetesCluster> = await update({
        aiKubectlCommandAllowlist: [atLimit],
      });
      expect(writtenAllowlist(written)).toEqual([atLimit]);
    });

    it("accepts patterns that start with kubectl or with a wildcard, trimmed", async () => {
      const written: UpdateBy<KubernetesCluster> = await update({
        aiKubectlCommandAllowlist: [
          "  kubectl set image deployment/web * -n web  ",
          "* set image deployment/api *",
          "kubectl\tscale deployment/web --replicas=*",
        ],
      });

      expect(writtenAllowlist(written)).toEqual([
        "kubectl set image deployment/web * -n web",
        "* set image deployment/api *",
        "kubectl\tscale deployment/web --replicas=*",
      ]);
    });

    it("stores a JSON-encoded array (a form the readers already accept) as the array", async () => {
      const written: UpdateBy<KubernetesCluster> = await update({
        aiKubectlCommandAllowlist: '["kubectl scale *"]',
      });

      expect(writtenAllowlist(written)).toEqual(["kubectl scale *"]);
    });

    it("stores an empty text field and null as no allowlist, and keeps an empty list", async () => {
      expect(
        writtenAllowlist(await update({ aiKubectlCommandAllowlist: "" })),
      ).toBeNull();
      expect(
        writtenAllowlist(await update({ aiKubectlCommandAllowlist: "  " })),
      ).toBeNull();
      expect(
        writtenAllowlist(await update({ aiKubectlCommandAllowlist: null })),
      ).toBeNull();
      expect(
        writtenAllowlist(await update({ aiKubectlCommandAllowlist: [] })),
      ).toEqual([]);
    });

    it("skips validation entirely for an update that writes neither setting", async () => {
      const written: UpdateBy<KubernetesCluster> = await update({
        name: "renamed",
      });

      expect(written.data).toEqual({ name: "renamed" });
    });

    it("validates the create path too", async () => {
      await expect(
        hooks().onBeforeCreate(
          createBy(
            {
              projectId: PROJECT_ID,
              name: "prod-us",
              aiRemediationMode: "automatic",
            },
            rootProps(),
          ),
        ),
      ).rejects.toThrow(/AI remediation mode must be one of/);

      await expect(
        hooks().onBeforeCreate(
          createBy(
            {
              projectId: PROJECT_ID,
              name: "prod-us",
              aiKubectlCommandAllowlist: ["set image *"],
            },
            rootProps(),
          ),
        ),
      ).rejects.toThrow(/must start with "kubectl "/);
    });

    /*
     * The validator and the matcher must not drift apart: every pattern the
     * validator accepts must be able to match the command it describes, and
     * the limits must be exactly where the matcher starts ignoring
     * patterns (past them it skips silently, which is what the validator
     * exists to prevent).
     */
    describe("agrees with the matcher", () => {
      const setImage: string = KubectlPolicy.renderDisplayCommand([
        "set",
        "image",
        "deployment/web",
        "web=nginx:2",
        "-n",
        "web",
      ]);

      it("an accepted kubectl-prefixed pattern matches its command", async () => {
        const written: UpdateBy<KubernetesCluster> = await update({
          aiKubectlCommandAllowlist: [" kubectl set image deployment/web * "],
        });

        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: writtenAllowlist(written) as Array<string>,
          }),
        ).toBe(true);
      });

      it("an accepted leading-wildcard pattern matches its command", async () => {
        const written: UpdateBy<KubernetesCluster> = await update({
          aiKubectlCommandAllowlist: ["* set image deployment/web *"],
        });

        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: writtenAllowlist(written) as Array<string>,
          }),
        ).toBe(true);
      });

      it("a refused pattern without the kubectl prefix could never have matched", () => {
        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: ["set image deployment/web *"],
          }),
        ).toBe(false);
      });

      it(`the matcher ignores a pattern past the ${MAX_KUBECTL_ALLOWLIST_PATTERNS}th, which is why more are refused`, () => {
        const filler: Array<string> = [];
        for (let i: number = 0; i < MAX_KUBECTL_ALLOWLIST_PATTERNS; i++) {
          filler.push(`kubectl scale deployment/other-${i} --replicas=*`);
        }

        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: [...filler, "kubectl set image *"],
          }),
        ).toBe(false);
        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: [...filler.slice(1), "kubectl set image *"],
          }),
        ).toBe(true);
      });

      it(`the matcher ignores a pattern longer than ${MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH} characters, which is why one is refused`, () => {
        const padded: (length: number) => string = (length: number): string => {
          const head: string = "kubectl set image deployment/web ";
          return head + "*".repeat(length - head.length);
        };

        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: [
              padded(MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH + 1),
            ],
          }),
        ).toBe(false);
        expect(
          CommandPolicy.matchesAllowlist({
            command: setImage,
            allowlistPatterns: [padded(MAX_KUBECTL_ALLOWLIST_PATTERN_LENGTH)],
          }),
        ).toBe(true);
      });
    });
  });
});

/*
 * aiAccessConfiguredAt tells the in-cluster Runner's registration "an
 * operator has configured AI access here" apart from "nobody ever did", so
 * a Runner deleted and re-registered never re-applies the chart's defaults
 * over an operator's "off". This file pins the user-write side: every
 * operator write of an AI setting sets it once, nothing else does, and it
 * is never cleared.
 */
describe("KubernetesClusterService AI access configured marker", () => {
  let updateBySpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);
    jest.spyOn(KubernetesClusterService, "findBy").mockResolvedValue([
      {
        id: CLUSTER_ID,
        projectId: PROJECT_ID,
      } as unknown as KubernetesCluster,
    ]);
    updateBySpy = jest
      .spyOn(KubernetesClusterService, "updateBy")
      .mockResolvedValue(1);
    // The feed writers are not what this block is about.
    jest
      .spyOn(
        KubernetesClusterService as unknown as {
          writeAiAccessSettingsChangedFeed: () => Promise<void>;
        },
        "writeAiAccessSettingsChangedFeed",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        KubernetesClusterService as unknown as {
          writeKubernetesClusterUpdatedFeed: () => Promise<void>;
        },
        "writeKubernetesClusterUpdatedFeed",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runUpdate(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    updatedItemIds: Array<ObjectID> = [CLUSTER_ID],
  ): Promise<UpdateBy<KubernetesCluster>> {
    const update: UpdateBy<KubernetesCluster> = updateBy(data, props);
    const onUpdate: OnUpdate<KubernetesCluster> =
      await hooks().onBeforeUpdate(update);
    await hooks().onUpdateSuccess(onUpdate, updatedItemIds);
    return update;
  }

  function markerWrites(): Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }> {
    return updateBySpy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };
    });
  }

  it("marks the cluster when a user turns AI investigation off", async () => {
    await runUpdate(
      { isAiInvestigationEnabled: false },
      userProps(PROJECT_ID, [Permission.SettingsMember]),
    );

    expect(markerWrites()).toHaveLength(1);
    const write: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = markerWrites()[0]!;

    expect(write.data["aiAccessConfiguredAt"]).toBeInstanceOf(Date);
    expect(Object.keys(write.data)).toEqual(["aiAccessConfiguredAt"]);
    // Written by the server, as root — the column's update ACL is empty.
    expect(write.props.isRoot).toBe(true);
  });

  it("only sets the marker where it is not set yet, so the first-configured time is kept", async () => {
    await runUpdate(
      { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
      adminProps(),
    );

    const query: Record<string, unknown> = markerWrites()[0]!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["_id", "aiAccessConfiguredAt"].sort(),
    );
    // A FindOperator, never a value: the write is conditional on IS NULL.
    expect(query["aiAccessConfiguredAt"]).not.toBeInstanceOf(Date);
    expect(query["aiAccessConfiguredAt"]).toBeTruthy();
    expect(JSON.stringify(query["_id"])).toContain(CLUSTER_ID.toString());
  });

  it("does not slip the server-only column into the user's own write", async () => {
    const update: UpdateBy<KubernetesCluster> = await runUpdate(
      { aiRemediationMode: KubernetesAiRemediationMode.RequireApproval },
      adminProps(),
    );

    expect(
      (update.data as unknown as Record<string, unknown>)[
        "aiAccessConfiguredAt"
      ],
    ).toBeUndefined();
  });

  it.each([
    [{ aiAccessRunnerId: null }],
    [{ aiAccessCredential: null }],
    [{ aiKubectlCommandAllowlist: [] }],
    [{ aiRemediationMode: KubernetesAiRemediationMode.Disabled }],
    [{ isAiInvestigationEnabled: true }],
  ])("marks the cluster for a user write of %p", async (data: object) => {
    await runUpdate(
      data as Record<string, unknown>,
      userProps(PROJECT_ID, [Permission.EditKubernetesCluster]),
    );

    expect(markerWrites()).toHaveLength(1);
  });

  it("does not mark the cluster for a user write of an unrelated column", async () => {
    await runUpdate({ name: "x" }, adminProps());

    expect(markerWrites()).toHaveLength(0);
  });

  it("does not mark the cluster for a root heartbeat or outcome write", async () => {
    await runUpdate(
      { lastSeenAt: new Date(), otelCollectorStatus: "connected" },
      rootProps(),
    );
    await runUpdate({ aiAccessLastVerifiedAt: new Date() }, rootProps());

    expect(markerWrites()).toHaveLength(0);
  });

  /*
   * Registration writes as root and sets the marker on first bind itself;
   * the operator path must not double up on it.
   */
  it("does not mark the cluster for a root write of AI settings (registration marks its own)", async () => {
    await runUpdate(
      {
        aiAccessRunnerId: RUNNER_ID,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      },
      rootProps(),
    );

    expect(markerWrites()).toHaveLength(0);
  });

  it("marks nothing when the update matched no row", async () => {
    await runUpdate({ isAiInvestigationEnabled: false }, adminProps(), []);

    expect(markerWrites()).toHaveLength(0);
  });

  it("marks nothing when the write is refused", async () => {
    await expect(
      runUpdate(
        { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
        userProps(PROJECT_ID, [Permission.SettingsMember]),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    expect(markerWrites()).toHaveLength(0);
  });

  it("never writes the marker as a clear", async () => {
    await runUpdate({ isAiInvestigationEnabled: false }, adminProps());

    for (const write of markerWrites()) {
      expect(write.data["aiAccessConfiguredAt"]).not.toBeNull();
    }
  });

  describe("on create", () => {
    it("marks a cluster a master admin creates with AI settings", async () => {
      const create: CreateBy<KubernetesCluster> = createBy(
        {
          projectId: PROJECT_ID,
          name: "prod-us",
          isAiInvestigationEnabled: true,
        },
        { isMasterAdmin: true, userId: ObjectID.generate() },
      );
      const onCreate: OnCreate<KubernetesCluster> =
        await hooks().onBeforeCreate(create);

      jest
        .spyOn(
          KubernetesClusterService as unknown as {
            writeKubernetesClusterCreatedFeed: () => Promise<void>;
          },
          "writeKubernetesClusterCreatedFeed",
        )
        .mockResolvedValue(undefined);

      await hooks().onCreateSuccess(onCreate, {
        id: CLUSTER_ID,
        // The saved row carries column defaults; they must not count.
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      } as unknown as KubernetesCluster);

      expect(markerWrites()).toHaveLength(1);
    });

    it("does not mark a cluster created without AI settings, even though the saved row carries their defaults", async () => {
      const create: CreateBy<KubernetesCluster> = createBy({
        projectId: PROJECT_ID,
        name: "prod-us",
      });
      const onCreate: OnCreate<KubernetesCluster> =
        await hooks().onBeforeCreate(create);

      jest
        .spyOn(
          KubernetesClusterService as unknown as {
            writeKubernetesClusterCreatedFeed: () => Promise<void>;
          },
          "writeKubernetesClusterCreatedFeed",
        )
        .mockResolvedValue(undefined);

      await hooks().onCreateSuccess(onCreate, {
        id: CLUSTER_ID,
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      } as unknown as KubernetesCluster);

      expect(markerWrites()).toHaveLength(0);
    });
  });
});
