import RuleRunPermission from "../../../../../Server/Utils/Rules/RuleRun/RuleRunPermission";
import RuleRunRegistry from "../../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import { RuleRunType } from "../../../../../Types/Rules/RuleRun";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - who may press "Run now".
 *
 * A run writes as root, so this check is the only thing between a role and
 * everything the run changes. It must hold the caller to the same ACLs a
 * direct API write would: the rule's own edit permission, edit on the
 * resources (a rule author must not edit every monitor by proxy), create on
 * owner rows for owner rules, and a team's block list over all of it. And
 * because a run reaches the whole project, a grant limited to some labels is
 * not enough.
 *
 * The permissions below are the real ones off the models' @TableAccessControl
 * - MonitorLabelRule and MonitorOwnerRule are editable by EditMonitor*Rule,
 * Monitor by EditProjectMonitor, owner rows are created by
 * CreateMonitorOwnerUser / CreateMonitorOwnerTeam.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function propsWith(data: {
  permissions?: Array<Permission> | undefined;
  blockedPermissions?: Array<Permission> | undefined;
  labelIds?: Array<ObjectID> | undefined;
  // The scope stored on every granted row; absent, as on legacy rows.
  scope?: PermissionScope | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const toUserPermission: (
    permission: Permission,
    isBlockPermission: boolean,
  ) => UserPermission = (
    permission: Permission,
    isBlockPermission: boolean,
  ): UserPermission => {
    return {
      permission: permission,
      labelIds: isBlockPermission ? [] : data.labelIds || [],
      isBlockPermission: isBlockPermission,
      ...(data.scope && !isBlockPermission ? { scope: data.scope } : {}),
      _type: "UserPermission",
    } as UserPermission;
  };

  return {
    tenantId: PROJECT_ID,
    isMasterAdmin: data.isMasterAdmin || false,
    userId: ObjectID.generate(),
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          ...(data.permissions || []).map((permission: Permission) => {
            return toUserPermission(permission, false);
          }),
          ...(data.blockedPermissions || []).map((permission: Permission) => {
            return toUserPermission(permission, true);
          }),
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function assertCanRun(
  ruleType: RuleRunType,
  props: DatabaseCommonInteractionProps,
): void {
  RuleRunPermission.assertCanRun({ props: props, ruleType: ruleType });
}

describe("RuleRunPermission.assertCanRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets a master admin run any rule", () => {
    for (const ruleType of [
      RuleRunType.MonitorLabelRule,
      RuleRunType.MonitorOwnerRule,
      RuleRunType.StatusPageMonitorRule,
    ]) {
      expect(() => {
        assertCanRun(ruleType, propsWith({ isMasterAdmin: true }));
      }).not.toThrow();
    }
  });

  it("lets a project admin run any rule", () => {
    for (const ruleType of [
      RuleRunType.MonitorLabelRule,
      RuleRunType.MonitorOwnerRule,
      RuleRunType.StatusPageMonitorRule,
    ]) {
      expect(() => {
        assertCanRun(
          ruleType,
          propsWith({ permissions: [Permission.ProjectAdmin] }),
        );
      }).not.toThrow();
    }
  });

  it("refuses a caller who cannot edit the rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({ permissions: [Permission.EditProjectMonitor] }),
      );
    }).toThrow(
      new NotAuthorizedException(
        "You do not have permission to edit this rule, which running it requires.",
      ),
    );
  });

  it("refuses a rule author who cannot edit the resources the rule changes", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({ permissions: [Permission.EditMonitorLabelRule] }),
      );
    }).toThrow(
      "You do not have permission to edit every monitor in this project, which running this rule does.",
    );
  });

  it("lets a caller who can edit both the rule and the resources run a label rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [
            Permission.EditMonitorLabelRule,
            Permission.EditProjectMonitor,
          ],
        }),
      );
    }).not.toThrow();
  });

  it("requires owner-create permissions for an owner rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorOwnerRule,
        propsWith({
          permissions: [
            Permission.EditMonitorOwnerRule,
            Permission.EditProjectMonitor,
          ],
        }),
      );
    }).toThrow(
      "You do not have permission to add owners to monitors, which running this rule does.",
    );

    expect(() => {
      assertCanRun(
        RuleRunType.MonitorOwnerRule,
        propsWith({
          permissions: [
            Permission.EditMonitorOwnerRule,
            Permission.EditProjectMonitor,
            Permission.CreateMonitorOwnerUser,
            Permission.CreateMonitorOwnerTeam,
          ],
        }),
      );
    }).not.toThrow();
  });

  it("does not count a grant limited to labels, since a run reaches every resource", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelIds: [ObjectID.generate()],
        }),
      );
    }).toThrow(NotAuthorizedException);
  });

  it("honours a team's block list on the resources, even over an admin grant", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          blockedPermissions: [Permission.EditProjectMonitor],
        }),
      );
    }).toThrow(/permission block list/);
  });

  it("only needs the rule's own edit permission to re-sync a status page", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.StatusPageMonitorRule,
        propsWith({ permissions: [Permission.EditStatusPageMonitorRule] }),
      );
    }).not.toThrow();

    expect(() => {
      assertCanRun(
        RuleRunType.StatusPageMonitorRule,
        propsWith({ permissions: [Permission.EditProjectMonitor] }),
      );
    }).toThrow(NotAuthorizedException);
  });

  /*
   * Saving an SLO monitor rule already re-syncs its SLO as root, so running
   * one needs exactly what saving it needs - the rule's own edit permission,
   * read off ServiceLevelObjectiveMonitorRule's @TableAccessControl - and
   * editing the SLO itself is neither required nor enough.
   */
  it("only needs the rule's own edit permission to re-sync an SLO's monitors", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.EditServiceLevelObjectiveMonitorRule],
        }),
      );
    }).not.toThrow();

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({ permissions: [Permission.EditServiceLevelObjective] }),
      );
    }).toThrow(
      new NotAuthorizedException(
        "You do not have permission to edit this rule, which running it requires.",
      ),
    );

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.ReadServiceLevelObjectiveMonitorRule],
        }),
      );
    }).toThrow(NotAuthorizedException);
  });

  it("lets master admins and project admins re-sync an SLO's monitors", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({ isMasterAdmin: true }),
      );
    }).not.toThrow();

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({ permissions: [Permission.ProjectAdmin] }),
      );
    }).not.toThrow();
  });

  it("honours a team's block list on SLO monitor rules, even over an admin grant", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          blockedPermissions: [Permission.EditServiceLevelObjectiveMonitorRule],
        }),
      );
    }).toThrow(/permission block list/);
  });

  it("does not count a grant limited to labels for an SLO monitor rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.EditServiceLevelObjectiveMonitorRule],
          labelIds: [ObjectID.generate()],
        }),
      );
    }).toThrow(NotAuthorizedException);
  });

  /*
   * ServiceLevelObjectiveMonitorRule is @OwnedThrough its SLO: an Owned-scoped
   * edit grant reaches only the rules of SLOs the user owns. The run reads the
   * rule as root, so counting that grant would let it re-sync any SLO.
   */
  it("does not count an Owned-scoped grant, which reaches only owned SLOs' rules", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.EditServiceLevelObjectiveMonitorRule],
          scope: PermissionScope.Owned,
        }),
      );
    }).toThrow(NotAuthorizedException);

    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [
            Permission.EditMonitorLabelRule,
            Permission.EditProjectMonitor,
          ],
          scope: PermissionScope.Owned,
        }),
      );
    }).toThrow(NotAuthorizedException);

    // The same grants scoped to the whole project are enough.
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.EditServiceLevelObjectiveMonitorRule],
          scope: PermissionScope.All,
        }),
      );
    }).not.toThrow();
  });

  it("keeps counting scope-exempt admin roles whatever scope is stored on them", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveMonitorRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          scope: PermissionScope.Owned,
        }),
      );
    }).not.toThrow();
  });

  it("refuses a rule type with no registered engine, even for a master admin", () => {
    jest.spyOn(RuleRunRegistry, "getDefinition").mockReturnValue(null);

    expect(() => {
      assertCanRun(
        RuleRunType.HostLabelRule,
        propsWith({ isMasterAdmin: true }),
      );
    }).toThrow(new BadDataException("This rule cannot be run."));
  });
});
