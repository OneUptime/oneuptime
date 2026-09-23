import KubernetesClusterService, {
  getAiAccessAdminRefusal,
  getAiAccessCredentialRefusal,
} from "../../../Server/Services/KubernetesClusterService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { holdsAnyPermission } from "../../../Server/Utils/Runbook/RunbookExecutePermission";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Who may make OneUptime AI do MORE on a Kubernetes cluster.
 *
 * A cluster's AI remediation mode does the job of a FullAuto
 * AutoRemediationRule with no rule row: on Automatic, safe kubectl changes
 * run unattended; on Bypass approval, riskier ones (set image, patch, drain,
 * deleting workloads) do too; an allowlist pattern promotes a riskier shape
 * to unattended in Automatic mode. The columns used to take the cluster's
 * generic update ACL, so a Settings Member — who cannot approve a single
 * kubectl plan and cannot author a FullAuto rule — could switch a production
 * cluster to Bypass approval and remove the approval step for everyone.
 *
 * The rule now enforced in KubernetesClusterService:
 *
 * - LOOSENING (moving the mode up to Automatic / Bypass approval, adding an
 *   allowlist pattern, binding a Runner or credential other than the current
 *   one) needs a GRANT of Project Owner, Project Admin or Edit Auto
 *   Remediation Rule — the permissions that may author a FullAuto rule —
 *   and binding a credential also needs credential read;
 * - TIGHTENING (Off, Ask for approval, Bypass -> Automatic, removing
 *   patterns, clearing the Runner or credential) and the investigation
 *   switch stay open to everyone who may edit the cluster;
 * - an unchanged value re-posted by the AI page's form is not a change;
 * - root (the in-cluster Runner's registration) and master admins are not
 *   gated.
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
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_CREDENTIAL_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

// Roles that may edit a cluster but may not author a FullAuto rule.
const CLUSTER_EDITOR_ROLES: Array<Permission> = [
  Permission.SettingsMember,
  Permission.SettingsAdmin,
  Permission.EditKubernetesCluster,
  Permission.ProjectMember,
];

// Roles that may make AI do more (KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS).
const AI_ACCESS_ADMIN_ROLES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditAutoRemediationRule,
];

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
};

function hooks(): Hooks {
  return KubernetesClusterService as unknown as Hooks;
}

function permissionRow(
  permission: Permission,
  isBlockPermission: boolean = false,
): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission,
  };
}

function userProps(
  rows: Array<UserPermission>,
  options: {
    tenantId?: ObjectID | null;
    permissionProjectId?: ObjectID;
  } = {},
): DatabaseCommonInteractionProps {
  const tenantId: ObjectID | null =
    options.tenantId === undefined ? PROJECT_ID : options.tenantId;
  const permissionProjectId: ObjectID =
    options.permissionProjectId || tenantId || PROJECT_ID;

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: permissionProjectId,
    permissions: rows,
  };

  return {
    userId: ObjectID.generate(),
    ...(tenantId ? { tenantId } : {}),
    userTenantAccessPermission: {
      [permissionProjectId.toString()]: tenantPermission,
    },
  } as DatabaseCommonInteractionProps;
}

function propsWith(
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return userProps(
    permissions.map((permission: Permission) => {
      return permissionRow(permission);
    }),
  );
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<KubernetesCluster> {
  return {
    query: { _id: CLUSTER_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<KubernetesCluster>;
}

function cluster(overrides: Record<string, unknown> = {}): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    projectId: PROJECT_ID,
    isAiInvestigationEnabled: false,
    aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    aiKubectlCommandAllowlist: null,
    aiAccessRunnerId: null,
    aiAccessCredentialId: null,
    ...overrides,
  } as unknown as KubernetesCluster;
}

// Writes that make AI do more on a never-configured cluster.
const LOOSENING_WRITES: Array<[string, Record<string, unknown>]> = [
  [
    "switch AI remediation to Bypass approval",
    { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
  ],
  [
    "switch AI remediation to Automatic",
    { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
  ],
  [
    "add a kubectl allowlist pattern",
    { aiKubectlCommandAllowlist: ["kubectl set image deployment/web *"] },
  ],
  /*
   * These two were ["*"] and ["kubectl *"]. A * where the verb goes is no
   * longer a valid entry (KubectlPolicy.describeAllowlistPatternProblem),
   * and validity is checked before who may loosen, so those now read as a
   * BadDataException for every caller. The broadest valid entries stand in.
   */
  [
    "add an allowlist entry for every object in every namespace",
    { aiKubectlCommandAllowlist: ["kubectl delete * * -n *"] },
  ],
  [
    "pair Automatic with a broad allowlist",
    {
      aiRemediationMode: KubernetesAiRemediationMode.Automatic,
      aiKubectlCommandAllowlist: ["kubectl set image * * -n web"],
    },
  ],
  ["bind a Runner by id", { aiAccessRunnerId: RUNNER_ID }],
  [
    "bind a Runner through the relation the dashboard posts",
    { aiAccessRunner: { _id: RUNNER_ID.toString() } },
  ],
  ["bind a credential by id", { aiAccessCredentialId: CREDENTIAL_ID }],
  [
    "bind a credential through the relation the dashboard posts",
    { aiAccessCredential: { _id: CREDENTIAL_ID.toString() } },
  ],
];

const LOOSENING_WRITES_WITHOUT_CREDENTIAL: Array<
  [string, Record<string, unknown>]
> = LOOSENING_WRITES.filter(([, data]: [string, Record<string, unknown>]) => {
  return !("aiAccessCredentialId" in data) && !("aiAccessCredential" in data);
});

// Writes that make AI do less, or only flip the investigation switch.
const TIGHTENING_WRITES: Array<[string, Record<string, unknown>]> = [
  [
    "turn AI remediation off",
    { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
  ],
  [
    "require approval",
    { aiRemediationMode: KubernetesAiRemediationMode.RequireApproval },
  ],
  ["clear the allowlist to an empty list", { aiKubectlCommandAllowlist: [] }],
  ["clear the allowlist to null", { aiKubectlCommandAllowlist: null }],
  ["clear the allowlist text field", { aiKubectlCommandAllowlist: "" }],
  ["clear the Runner by id", { aiAccessRunnerId: null }],
  ["clear the Runner relation", { aiAccessRunner: null }],
  ["clear the credential by id", { aiAccessCredentialId: null }],
  ["clear the credential relation", { aiAccessCredential: null }],
  ["turn AI investigation on", { isAiInvestigationEnabled: true }],
  ["turn AI investigation off", { isAiInvestigationEnabled: false }],
  ["rename the cluster", { name: "prod-us-east" }],
];

describe("KubernetesCluster AI access: who may make AI do more", () => {
  let clusterLookup: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;
  let credentialLookup: jest.SpyInstance;

  beforeEach(() => {
    clusterLookup = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([cluster()]);
    runnerLookup = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);
    credentialLookup = jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue({
        id: CREDENTIAL_ID,
        credentialType: RunbookCredentialType.Kubernetes,
      } as unknown as RunbookCredential);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("harness guard", () => {
    /*
     * If the props factory produced permissions nothing reads, every refusal
     * below would pass for the wrong reason. A project admin must be seen as
     * holding the permission, and a cluster editor must still be let
     * through for a tightening write.
     */
    it("builds props the permission helper reads", () => {
      expect(
        holdsAnyPermission({
          props: propsWith(Permission.ProjectAdmin),
          projectId: PROJECT_ID,
          allowed: [Permission.ProjectAdmin],
        }),
      ).toBe(true);
      expect(
        holdsAnyPermission({
          props: propsWith(Permission.SettingsMember),
          projectId: PROJECT_ID,
          allowed: [Permission.ProjectAdmin],
        }),
      ).toBe(false);
    });

    it("lets a Settings Member through for a tightening write", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("the column layer lets every cluster editor through, so the service is the guard", () => {
    /*
     * Deliberate: a column ACL cannot say "tightening is free", and turning
     * AI remediation off must never need more than editing the cluster.
     * This pins that the escalation is closed in the service and not by an
     * ACL someone could later widen back.
     */
    it.each(CLUSTER_EDITOR_ROLES)(
      "the table and column checks accept Bypass approval from %s",
      (role: Permission) => {
        const props: DatabaseCommonInteractionProps = propsWith(role);

        expect(() => {
          TablePermission.checkTableLevelPermissions(
            KubernetesCluster,
            props,
            DatabaseRequestType.Update,
          );
          ColumnPermissions.checkDataColumnPermissions(
            KubernetesCluster,
            {
              aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
            } as unknown as KubernetesCluster,
            props,
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      },
    );
  });

  describe.each(CLUSTER_EDITOR_ROLES)(
    "a caller holding only %s",
    (role: Permission) => {
      it.each(LOOSENING_WRITES)(
        "may not %s",
        async (_label: string, data: Record<string, unknown>) => {
          await expect(
            hooks().onBeforeUpdate(updateBy(data, propsWith(role))),
          ).rejects.toThrow(NotAuthorizedException);

          await expect(
            hooks().onBeforeUpdate(updateBy(data, propsWith(role))),
          ).rejects.toThrow(getAiAccessAdminRefusal());

          // Refused on who is asking, before any Runner/credential lookup.
          expect(runnerLookup).not.toHaveBeenCalled();
          expect(credentialLookup).not.toHaveBeenCalled();
        },
      );

      it.each(TIGHTENING_WRITES)(
        "may %s",
        async (_label: string, data: Record<string, unknown>) => {
          await expect(
            hooks().onBeforeUpdate(updateBy(data, propsWith(role))),
          ).resolves.toBeDefined();
        },
      );
    },
  );

  describe.each(AI_ACCESS_ADMIN_ROLES)(
    "a caller holding %s",
    (role: Permission) => {
      it.each(LOOSENING_WRITES_WITHOUT_CREDENTIAL)(
        "may %s",
        async (_label: string, data: Record<string, unknown>) => {
          await expect(
            hooks().onBeforeUpdate(updateBy(data, propsWith(role))),
          ).resolves.toBeDefined();
        },
      );

      it.each(TIGHTENING_WRITES)(
        "may %s",
        async (_label: string, data: Record<string, unknown>) => {
          await expect(
            hooks().onBeforeUpdate(updateBy(data, propsWith(role))),
          ).resolves.toBeDefined();
        },
      );
    },
  );

  it("names the permissions that would allow it, and what stays open", async () => {
    await expect(
      hooks().onBeforeUpdate(
        updateBy(
          { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
          propsWith(Permission.SettingsMember),
        ),
      ),
    ).rejects.toThrow(
      /You need one of these permissions .*: Project Owner, Project Admin, Edit Auto Remediation Rule\. Anyone who may edit the cluster can still turn AI remediation off/,
    );
  });

  describe("binding a credential", () => {
    it("needs credential read on top of Edit Auto Remediation Rule", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: CREDENTIAL_ID },
            propsWith(Permission.EditAutoRemediationRule),
          ),
        ),
      ).rejects.toThrow(getAiAccessCredentialRefusal());

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: CREDENTIAL_ID },
            propsWith(
              Permission.EditAutoRemediationRule,
              Permission.ReadRunbookCredential,
            ),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("is not enough with credential read alone", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: CREDENTIAL_ID },
            propsWith(Permission.ReadRunbookCredential),
          ),
        ),
      ).rejects.toThrow(getAiAccessAdminRefusal());
    });

    it.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
      "is allowed for %s, which covers both",
      async (role: Permission) => {
        await expect(
          hooks().onBeforeUpdate(
            updateBy(
              { aiAccessCredential: { _id: CREDENTIAL_ID.toString() } },
              propsWith(role),
            ),
          ),
        ).resolves.toBeDefined();
      },
    );
  });

  describe("judged against the cluster's current settings", () => {
    const configured: Record<string, unknown> = {
      aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      aiKubectlCommandAllowlist: [
        "kubectl set image deployment/web *",
        "kubectl patch deployment/web *",
      ],
      aiAccessRunnerId: RUNNER_ID,
      aiAccessCredentialId: CREDENTIAL_ID,
      isAiInvestigationEnabled: true,
    };

    beforeEach(() => {
      clusterLookup.mockResolvedValue([cluster(configured)]);
    });

    /*
     * The AI page's form posts every field, so a Settings Member who only
     * turns investigation off re-posts the mode, allowlist, Runner and
     * credential an admin chose. That save must go through.
     */
    it("lets a Settings Member re-post every unchanged setting while flipping investigation", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              isAiInvestigationEnabled: false,
              aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
              aiKubectlCommandAllowlist: [
                "kubectl set image deployment/web *",
                "kubectl patch deployment/web *",
              ],
              aiAccessRunner: { _id: RUNNER_ID.toString() },
              aiAccessCredential: { _id: CREDENTIAL_ID.toString() },
            },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("lets a Settings Member step Bypass approval down to Automatic", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("refuses a Settings Member stepping Automatic up to Bypass approval", async () => {
      clusterLookup.mockResolvedValue([
        cluster({
          ...configured,
          aiRemediationMode: KubernetesAiRemediationMode.Automatic,
        }),
      ]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("refuses Automatic from Ask for approval", async () => {
      clusterLookup.mockResolvedValue([
        cluster({
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
            propsWith(Permission.EditKubernetesCluster),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("reads an unknown stored mode as Disabled, the way the readers do", async () => {
      clusterLookup.mockResolvedValue([
        cluster({ aiRemediationMode: "automatic" }),
      ]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("lets a Settings Member remove or reorder allowlist patterns, but not add one", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              aiKubectlCommandAllowlist: ["kubectl patch deployment/web *"],
            },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              aiKubectlCommandAllowlist: [
                "kubectl patch deployment/web *",
                "kubectl set image deployment/web *",
              ],
            },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              aiKubectlCommandAllowlist: [
                "kubectl set image deployment/web *",
                "kubectl drain *",
              ],
            },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("compares patterns after trimming, so re-posting with padding is not an addition", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              aiKubectlCommandAllowlist: [
                "  kubectl set image deployment/web *  ",
              ],
            },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("refuses a Settings Member swapping in a different Runner or credential", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessRunnerId: OTHER_RUNNER_ID },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiAccessCredentialId: OTHER_CREDENTIAL_ID },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });
  });

  describe("block rows and other projects", () => {
    it("does not read a block row for Project Admin as a grant", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            userProps([permissionRow(Permission.ProjectAdmin, true)]),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("does not read a block row for Edit Auto Remediation Rule as a grant next to a cluster-edit grant", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            userProps([
              permissionRow(Permission.EditKubernetesCluster),
              permissionRow(Permission.EditAutoRemediationRule, true),
            ]),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("does not count an admin grant held in a different project", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            userProps([permissionRow(Permission.ProjectAdmin)], {
              tenantId: PROJECT_ID,
              permissionProjectId: OTHER_PROJECT_ID,
            }),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });
  });

  describe("callers the check does not apply to", () => {
    it("lets the in-cluster registration (root) write any mode, allowlist and binding without reading settings", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            {
              aiAccessRunnerId: RUNNER_ID,
              aiAccessCredentialId: CREDENTIAL_ID,
              isAiInvestigationEnabled: true,
              aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
              // Was "kubectl *", no longer a valid entry for anyone.
              aiKubectlCommandAllowlist: ["kubectl delete * * -n *"],
            },
            { isRoot: true },
          ),
        ),
      ).resolves.toBeDefined();

      const settingsReads: Array<unknown> = clusterLookup.mock.calls.filter(
        (call: Array<unknown>) => {
          return (
            "aiRemediationMode" in
            ((call[0] as { select: Record<string, unknown> }).select || {})
          );
        },
      );
      expect(settingsReads).toHaveLength(0);
    });

    it("lets a master admin loosen without any project permission rows", async () => {
      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            { isMasterAdmin: true, userId: ObjectID.generate() },
          ),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("updates that reach several clusters, or none", () => {
    it("refuses when the write loosens ANY matched cluster, even if another is already there", async () => {
      clusterLookup.mockResolvedValue([
        cluster({
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        }),
        cluster({
          id: OTHER_CLUSTER_ID,
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        }),
      ]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            propsWith(Permission.ProjectAdmin),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("needs the permission in each matched cluster's own project", async () => {
      clusterLookup.mockResolvedValue([
        cluster(),
        cluster({ id: OTHER_CLUSTER_ID, projectId: OTHER_PROJECT_ID }),
      ]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            userProps([permissionRow(Permission.ProjectAdmin)], {
              tenantId: null,
              permissionProjectId: PROJECT_ID,
            }),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    /*
     * An id that matches nothing (missing, or another project's) is judged
     * against the never-configured defaults in the caller's tenant, so the
     * answer does not reveal whether the id exists.
     */
    it("judges a write that matches no cluster against the defaults in the caller's tenant", async () => {
      clusterLookup.mockResolvedValue([]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            propsWith(Permission.ProjectAdmin),
          ),
        ),
      ).resolves.toBeDefined();

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
            propsWith(Permission.SettingsMember),
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("fails closed when nothing matched and the caller has no tenant", async () => {
      clusterLookup.mockResolvedValue([]);

      await expect(
        hooks().onBeforeUpdate(
          updateBy(
            { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
            userProps([permissionRow(Permission.ProjectAdmin)], {
              tenantId: null,
              permissionProjectId: PROJECT_ID,
            }),
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("scopes the settings read to the caller's project, as root, selecting the AI columns", async () => {
      await hooks().onBeforeUpdate(
        updateBy(
          { isAiInvestigationEnabled: true },
          propsWith(Permission.SettingsMember),
        ),
      );

      expect(clusterLookup).toHaveBeenCalledTimes(1);
      const args: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = clusterLookup.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(args.query).toEqual({
        _id: CLUSTER_ID.toString(),
        projectId: PROJECT_ID,
      });
      expect(args.props.isRoot).toBe(true);
      for (const column of [
        "projectId",
        "isAiInvestigationEnabled",
        "aiRemediationMode",
        "aiKubectlCommandAllowlist",
        "aiAccessRunnerId",
        "aiAccessCredentialId",
      ]) {
        expect(args.select[column]).toBe(true);
      }
    });
  });
});

/*
 * The same rule through updateOneById, the entry point BaseAPI's PUT
 * /kubernetes-cluster/:id takes. Only the surfaces that need Postgres are
 * stubbed: the internal find, the repository, and the model-level
 * permission checks (the table/column layer is pinned above and lets these
 * roles through by design).
 */
describe("KubernetesCluster AI access through updateOneById", () => {
  let repositoryUpdate: jest.Mock;
  let feedItems: jest.SpyInstance;

  beforeEach(() => {
    getJestSpyOn(KubernetesClusterService, "_findBy").mockResolvedValue([
      cluster({
        _id: CLUSTER_ID.toString(),
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    ]);
    repositoryUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    getJestSpyOn(KubernetesClusterService, "getRepository").mockReturnValue({
      update: repositoryUpdate,
      save: jest.fn(),
    });
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((_modelType: unknown, query: unknown) => {
        return Promise.resolve(query);
      }) as never);
    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined);
    feedItems = jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockResolvedValue(undefined);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("[Jane](https://oneuptime.example/user)");
    jest
      .spyOn(KubernetesClusterService, "getKubernetesClusterMarkdownLink")
      .mockResolvedValue("[Kubernetes Cluster prod-us](https://x)");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let i: number = 0; i < 100 && !predicate(); i++) {
      await new Promise((resolve: (value: unknown) => void) => {
        setImmediate(resolve);
      });
    }
  }

  it("refuses a Settings Member's Bypass approval before anything is written", async () => {
    await expect(
      KubernetesClusterService.updateOneById({
        id: CLUSTER_ID,
        data: {
          aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
        },
        props: propsWith(Permission.SettingsMember),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  it("writes a Project Admin's Bypass approval, marks the cluster configured and records who did it", async () => {
    const props: DatabaseCommonInteractionProps = propsWith(
      Permission.ProjectAdmin,
    );

    const updated: number = await KubernetesClusterService.updateOneById({
      id: CLUSTER_ID,
      data: {
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      },
      props,
    });

    expect(updated).toBe(1);

    const writes: Array<Record<string, unknown>> =
      repositoryUpdate.mock.calls.map((call: Array<unknown>) => {
        return call[1] as Record<string, unknown>;
      });

    expect(writes[0]!["aiRemediationMode"]).toBe(
      KubernetesAiRemediationMode.BypassApproval,
    );
    expect(writes[0]!["aiAccessConfiguredAt"]).toBeUndefined();
    // The marker is its own, server-side write after the operator's.
    expect(writes[1]!["aiAccessConfiguredAt"]).toBeInstanceOf(Date);

    await waitFor(() => {
      return feedItems.mock.calls.length > 0;
    });

    expect(feedItems).toHaveBeenCalledTimes(1);
    const item: {
      userId?: ObjectID;
      feedInfoInMarkdown: string;
    } = feedItems.mock.calls[0]![0] as {
      userId?: ObjectID;
      feedInfoInMarkdown: string;
    };
    expect(item.userId).toBe(props.userId);
    expect(item.feedInfoInMarkdown).toContain(
      "AI remediation changed from **Ask for approval** to **Bypass approval**",
    );
  });
});
