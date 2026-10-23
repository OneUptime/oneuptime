import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { withLabelJoinTables } from "../TestingUtils/LabelJoinTables";

/*
 * Contract under test - KubernetesClusterAiAccessService
 * .assertCallerMayChangeCluster, the gate in front of every action on one
 * cluster that only someone who may edit it may cause outside an update of
 * it: the AI access test (POST /kubernetes-cluster/ai-access/test),
 * resetting its Kubernetes AI agent (/reset-agent) and approving an AI plan
 * whose kubectl commands change it (/auto-remediation/approve). It decides
 * exactly what an update of the cluster through the API would, for the
 * cluster's own row (DatabaseService.findOneUpdatableById):
 *
 * - the cluster's update permissions (a grant of one of them);
 * - a team's block on a label the cluster carries (a block of Edit
 *   Kubernetes Cluster for "prod" refuses the prod cluster, not the staging
 *   one), and a block with no labels;
 * - a grant limited to labels reaches only clusters carrying one of them
 *   (an edit grant limited to "staging" does not reach the prod cluster,
 *   nor one with no labels);
 * - a change needs a read: a cluster the caller may not read is refused;
 * - a credential issued for reading only is refused;
 * - a cluster of another project, or none, is refused like one the caller
 *   may not edit, and every refusal reads `refusal`;
 * - root and master admins are not gated.
 *
 * The cluster's table is a stand-in that answers every lookup with the row;
 * the owner scope and the label SQL are held on a real Postgres
 * (Tests/Server/API/KubernetesClusterEditScopePostgres).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROD_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STAGING_LABEL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const REFUSAL: string =
  "You need permission to edit this Kubernetes cluster to run its AI access test.";

function label(id: ObjectID, name: string): Label {
  const model: Label = new Label();
  model.id = id;
  model.name = name;
  return model;
}

function cluster(
  labels: Array<Label>,
  projectId: ObjectID = PROJECT_ID,
): KubernetesCluster {
  const model: KubernetesCluster = new KubernetesCluster();
  model.id = CLUSTER_ID;
  // Read with its project, as the label lookup selects it.
  model.projectId = projectId;
  model.labels = labels;
  return model;
}

function userProps(
  permissions: Array<Partial<UserPermission>>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map(
      (permission: Partial<UserPermission>): UserPermission => {
        return {
          _type: "UserPermission",
          labelIds: [],
          isBlockPermission: false,
          ...permission,
        } as UserPermission;
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...extra,
  };
}

// A role that may edit clusters: an edit reads the row too.
const CLUSTER_EDITOR: Array<Partial<UserPermission>> = [
  { permission: Permission.ReadKubernetesCluster },
  { permission: Permission.EditKubernetesCluster },
];

// Every lookup of the cluster's table answers with `row`.
function serveCluster(row: KubernetesCluster | null): jest.SpyInstance {
  return jest
    .spyOn(KubernetesClusterService, "findOneBy")
    .mockResolvedValue(row as never);
}

function assertMayChange(
  props: DatabaseCommonInteractionProps,
  projectId: ObjectID = PROJECT_ID,
): Promise<void> {
  return KubernetesClusterAiAccessService.assertCallerMayChangeCluster({
    props,
    projectId,
    clusterId: CLUSTER_ID,
    refusal: REFUSAL,
  });
}

describe("KubernetesClusterAiAccessService.assertCallerMayChangeCluster", () => {
  /*
   * A team's block with labels narrows the editable lookup itself, against
   * the cluster's label join table.
   */
  beforeEach(() => {
    withLabelJoinTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who may edit the cluster passes", () => {
    it.each([
      ["a project owner", [{ permission: Permission.ProjectOwner }]],
      ["a project admin", [{ permission: Permission.ProjectAdmin }]],
      ["a project member", [{ permission: Permission.ProjectMember }]],
      ["a settings admin", [{ permission: Permission.SettingsAdmin }]],
      ["a settings member", [{ permission: Permission.SettingsMember }]],
      ["someone holding Edit and Read Kubernetes Cluster", CLUSTER_EDITOR],
    ])(
      "%s, on a labelled cluster",
      async (_who: string, permissions: Array<Partial<UserPermission>>) => {
        serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

        await expect(
          assertMayChange(userProps(permissions)),
        ).resolves.toBeUndefined();
      },
    );

    it("an edit grant limited to a label the cluster carries", async () => {
      serveCluster(cluster([label(STAGING_LABEL_ID, "staging")]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ReadKubernetesCluster },
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [STAGING_LABEL_ID],
            },
          ]),
        ),
      ).resolves.toBeUndefined();
    });

    it("a cluster carrying several labels, one of them the grant's", async () => {
      serveCluster(
        cluster([
          label(PROD_LABEL_ID, "prod"),
          label(STAGING_LABEL_ID, "staging"),
        ]),
      );

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ReadKubernetesCluster },
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [STAGING_LABEL_ID],
            },
          ]),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("labels: decided from the cluster's own", () => {
    it("refuses an edit grant limited to another label, in the caller's words", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

      const attempt: Promise<void> = assertMayChange(
        userProps([
          { permission: Permission.ReadKubernetesCluster },
          {
            permission: Permission.EditKubernetesCluster,
            labelIds: [STAGING_LABEL_ID],
          },
        ]),
      );

      await expect(attempt).rejects.toThrow(NotAuthorizedException);
      await expect(attempt).rejects.toThrow(REFUSAL);
    });

    it("refuses an edit grant limited to labels on a cluster that carries none", async () => {
      serveCluster(cluster([]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ReadKubernetesCluster },
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [STAGING_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a role limited to another label (Project Member for staging) on the prod cluster", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

      await expect(
        assertMayChange(
          userProps([
            {
              permission: Permission.ProjectMember,
              labelIds: [STAGING_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a project member blocked from editing a label the cluster carries", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.EditKubernetesCluster,
              isBlockPermission: true,
              labelIds: [PROD_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("negative control: the same block does not touch a cluster without that label", async () => {
      serveCluster(cluster([label(STAGING_LABEL_ID, "staging")]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.EditKubernetesCluster,
              isBlockPermission: true,
              labelIds: [PROD_LABEL_ID],
            },
          ]),
        ),
      ).resolves.toBeUndefined();
    });

    it("refuses a project admin blocked from editing a label the cluster carries", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ProjectAdmin },
            {
              permission: Permission.EditKubernetesCluster,
              isBlockPermission: true,
              labelIds: [PROD_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a caller blocked from reading a label the cluster carries: a change needs a read", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.ReadKubernetesCluster,
              isBlockPermission: true,
              labelIds: [PROD_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);
    });
  });

  describe("the table: who may edit no cluster at all", () => {
    it.each([
      ["a viewer", [{ permission: Permission.Viewer }]],
      ["a settings viewer", [{ permission: Permission.SettingsViewer }]],
      [
        "someone who may only read clusters",
        [{ permission: Permission.ReadKubernetesCluster }],
      ],
      [
        "someone who may start runbooks and read clusters",
        [
          { permission: Permission.RunbookMember },
          { permission: Permission.ReadKubernetesCluster },
        ],
      ],
      [
        "an AI admin who may read clusters (Edit AI Rule)",
        [
          { permission: Permission.EditAutoRemediationRule },
          { permission: Permission.ReadKubernetesCluster },
        ],
      ],
      [
        "someone who may edit but not read clusters",
        [{ permission: Permission.EditKubernetesCluster }],
      ],
      [
        "a project member whose edit of clusters is blocked outright",
        [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.EditKubernetesCluster,
            isBlockPermission: true,
          },
        ],
      ],
    ])(
      "refuses %s",
      async (_who: string, permissions: Array<Partial<UserPermission>>) => {
        serveCluster(cluster([]));

        await expect(assertMayChange(userProps(permissions))).rejects.toThrow(
          REFUSAL,
        );
      },
    );

    it("refuses a credential issued for reading only, whatever it holds", async () => {
      serveCluster(cluster([]));

      await expect(
        assertMayChange(
          userProps([{ permission: Permission.ProjectOwner }], {
            isReadOnlyCredential: true,
          }),
        ),
      ).rejects.toThrow(REFUSAL);
    });
  });

  describe("the cluster: in the project, or refused alike", () => {
    it("refuses a cluster that is not in the project", async () => {
      serveCluster(null);

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectOwner }])),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a row of another project, should a lookup ever answer one", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockResolvedValue(cluster([], OTHER_PROJECT_ID));

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectOwner }])),
      ).rejects.toThrow(REFUSAL);
    });

    it("refuses a row read without its project", async () => {
      const row: KubernetesCluster = new KubernetesCluster();
      row.id = CLUSTER_ID;

      jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockResolvedValue(row);

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectOwner }])),
      ).rejects.toThrow(REFUSAL);
    });

    it("answers a record the check finds missing with the same refusal", async () => {
      serveCluster(cluster([label(PROD_LABEL_ID, "prod")]));
      jest
        .spyOn(ModelPermission, "checkUpdatePermissionByModel")
        .mockRejectedValue(
          new NotFoundException("Kubernetes Cluster not found."),
        );

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
      ).rejects.toThrow(REFUSAL);
    });

    it("answers a caller with no credentials with the same refusal", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockRejectedValue(new NotAuthenticatedException("Sign in."));

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
      ).rejects.toThrow(REFUSAL);
    });

    it("lets any other failure through as it is, never dressed up as a refusal", async () => {
      jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockRejectedValue(new Error("database down"));

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
      ).rejects.toThrow("database down");

      jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockRejectedValue(new PaymentRequiredException("Upgrade your plan."));

      await expect(
        assertMayChange(userProps([{ permission: Permission.ProjectMember }])),
      ).rejects.toThrow(PaymentRequiredException);
    });
  });

  describe("the lookup", () => {
    it("asks the one shared lookup of what an update reaches, with the caller's props in the cluster's project", async () => {
      const lookup: jest.SpyInstance = jest
        .spyOn(KubernetesClusterService, "findOneUpdatableById")
        .mockResolvedValue(cluster([]));

      await assertMayChange(
        userProps([{ permission: Permission.ProjectMember }], {
          // Whatever the request said, the cluster's project is asked.
          tenantId: OTHER_PROJECT_ID,
          isMultiTenantRequest: true,
        }),
      );

      expect(lookup).toHaveBeenCalledTimes(1);

      const args: {
        id: ObjectID;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = lookup.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(args.id.toString()).toBe(CLUSTER_ID.toString());
      expect(args.select).toEqual({ _id: true, projectId: true });
      expect(args.props.isRoot).toBeFalsy();
      expect(args.props.userId?.toString()).toBe(USER_ID.toString());
      expect(args.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
      expect(args.props.isMultiTenantRequest).toBe(false);
    });

    it("reads the cluster's labels as OneUptime, in the cluster's project only", async () => {
      const reads: jest.SpyInstance = serveCluster(
        cluster([label(PROD_LABEL_ID, "prod")]),
      );

      await expect(
        assertMayChange(
          userProps([
            { permission: Permission.ReadKubernetesCluster },
            {
              permission: Permission.EditKubernetesCluster,
              labelIds: [STAGING_LABEL_ID],
            },
          ]),
        ),
      ).rejects.toThrow(REFUSAL);

      const labelRead: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = reads.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(labelRead.props.isRoot).toBe(true);
      expect(labelRead.select["labels"]).toEqual({ _id: true, name: true });
      expect(String(labelRead.query["_id"])).toBe(CLUSTER_ID.toString());
      expect(String(labelRead.query["projectId"])).toBe(PROJECT_ID.toString());
    });

    it("does not gate root or master admins, and reads nothing for them", async () => {
      const reads: jest.SpyInstance = serveCluster(null);

      await expect(assertMayChange({ isRoot: true })).resolves.toBeUndefined();
      await expect(
        assertMayChange({ isMasterAdmin: true, userId: USER_ID }),
      ).resolves.toBeUndefined();
      expect(reads).not.toHaveBeenCalled();
    });
  });
});
