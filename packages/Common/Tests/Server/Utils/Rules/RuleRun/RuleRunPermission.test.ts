import RuleRunPermission from "../../../../../Server/Utils/Rules/RuleRun/RuleRunPermission";
import RuleRunRegistry from "../../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import { RuleRunType } from "../../../../../Types/Rules/RuleRun";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteAssignmentRule from "../../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import fs from "fs";
import path from "path";
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

const BLOCKED_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function propsWith(data: {
  permissions?: Array<Permission> | undefined;
  blockedPermissions?: Array<Permission> | undefined;
  // Blocks limited to one label, beside the blocks with no labels.
  labelledBlockedPermissions?: Array<Permission> | undefined;
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
          ...(data.labelledBlockedPermissions || []).map(
            (permission: Permission) => {
              return {
                permission: permission,
                labelIds: [BLOCKED_LABEL_ID],
                isBlockPermission: true,
                _type: "UserPermission",
              } as UserPermission;
            },
          ),
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

/*
 * SLO label and owner rules walk every SLO in the project as root, so running
 * one needs the rule's edit permission, EditServiceLevelObjective, and - for
 * owner rules - create on both SLO owner tables. Read off the real models'
 * @TableAccessControl, like everything above.
 */
describe("RuleRunPermission.assertCanRun - SLO label and owner rules", () => {
  it("lets a caller who can edit the rule and every SLO run an SLO label rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveLabelRule,
        propsWith({
          permissions: [
            Permission.EditServiceLevelObjectiveLabelRule,
            Permission.EditServiceLevelObjective,
          ],
        }),
      );
    }).not.toThrow();
  });

  it("refuses a caller who can edit SLOs but not the rule", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveLabelRule,
        propsWith({
          permissions: [
            Permission.EditServiceLevelObjective,
            // Another SLO rule's permission is not this one's.
            Permission.EditServiceLevelObjectiveMonitorRule,
          ],
        }),
      );
    }).toThrow(
      "You do not have permission to edit this rule, which running it requires.",
    );
  });

  it("refuses a rule author who cannot edit SLOs, naming them", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveLabelRule,
        propsWith({
          permissions: [Permission.EditServiceLevelObjectiveLabelRule],
        }),
      );
    }).toThrow(
      "You do not have permission to edit every SLO in this project, which running this rule does.",
    );
  });

  it("does not let read access to the rule stand in for edit", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveOwnerRule,
        propsWith({
          permissions: [
            Permission.ReadServiceLevelObjectiveOwnerRule,
            Permission.EditServiceLevelObjective,
            Permission.CreateServiceLevelObjectiveOwnerUser,
            Permission.CreateServiceLevelObjectiveOwnerTeam,
          ],
        }),
      );
    }).toThrow(NotAuthorizedException);
  });

  it("requires create on both SLO owner tables for an SLO owner rule", () => {
    const ruleAndSlo: Array<Permission> = [
      Permission.EditServiceLevelObjectiveOwnerRule,
      Permission.EditServiceLevelObjective,
    ];

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveOwnerRule,
        propsWith({ permissions: ruleAndSlo }),
      );
    }).toThrow(
      "You do not have permission to add owners to SLOs, which running this rule does.",
    );

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveOwnerRule,
        propsWith({
          permissions: [
            ...ruleAndSlo,
            Permission.CreateServiceLevelObjectiveOwnerUser,
          ],
        }),
      );
    }).toThrow(NotAuthorizedException);

    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveOwnerRule,
        propsWith({
          permissions: [
            ...ruleAndSlo,
            Permission.CreateServiceLevelObjectiveOwnerUser,
            Permission.CreateServiceLevelObjectiveOwnerTeam,
          ],
        }),
      );
    }).not.toThrow();
  });

  /*
   * A run reaches every SLO, so an edit grant limited to the SLOs a user owns
   * cannot authorize one.
   */
  it("does not count an Owned-scoped SLO edit grant", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveLabelRule,
        propsWith({
          permissions: [
            Permission.EditServiceLevelObjectiveLabelRule,
            Permission.EditServiceLevelObjective,
          ],
          scope: PermissionScope.Owned,
        }),
      );
    }).toThrow(NotAuthorizedException);
  });

  it("honours a team's block list on SLOs, even over an admin grant", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.ServiceLevelObjectiveLabelRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          blockedPermissions: [Permission.EditServiceLevelObjective],
        }),
      );
    }).toThrow(/permission block list/);
  });

  it("lets a project admin run both", () => {
    for (const ruleType of [
      RuleRunType.ServiceLevelObjectiveLabelRule,
      RuleRunType.ServiceLevelObjectiveOwnerRule,
    ]) {
      expect(() => {
        assertCanRun(
          ruleType,
          propsWith({ permissions: [Permission.ProjectAdmin] }),
        );
      }).not.toThrow();
    }
  });
});

/*
 * A run changes every record of the project, those carrying a label a
 * team's block takes away included - where the CRUD path would leave them
 * out. So for a model whose records carry labels (a monitor, a network
 * device), a block on some labels takes the run away too; a model whose
 * records carry none (a rule, an owner row) is narrowed by no such block
 * anywhere, and is not here either.
 */
describe("RuleRunPermission.assertCanRun - blocks on some labels", () => {
  it("refuses a project admin whose team blocks monitor edit for some labels", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [Permission.EditProjectMonitor],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        "You do not have permission to edit every monitor in this project, which running this rule does. Edit Monitor is in your team's permission block list for some labels.",
      ),
    );
  });

  it("refuses an owner rule run the same way, before any owner row is asked about", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorOwnerRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [Permission.EditProjectMonitor],
        }),
      );
    }).toThrow(/block list for some labels/);
  });

  it("does not refuse a block on some labels of the rule's own permission", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [Permission.EditMonitorLabelRule],
        }),
      );
    }).not.toThrow();
  });

  it("does not refuse a block on some labels of owner rows, which carry none", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorOwnerRule,
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [
            Permission.CreateMonitorOwnerTeam,
            Permission.CreateMonitorOwnerUser,
          ],
        }),
      );
    }).not.toThrow();
  });

  it("refuses the operational wildcard when a block on some labels takes it away, saying so as for the permission itself", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [
            Permission.EditMonitorLabelRule,
            Permission.EditAllOperationalResources,
          ],
          labelledBlockedPermissions: [Permission.EditAllOperationalResources],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        "You do not have permission to edit every monitor in this project, which running this rule does. Edit All Operational Resources is in your team's permission block list for some labels.",
      ),
    );
  });

  it("names a block with no labels on the resource's own permission before the wildcard's block on some labels", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [
            Permission.EditMonitorLabelRule,
            Permission.EditAllOperationalResources,
          ],
          blockedPermissions: [Permission.EditProjectMonitor],
          labelledBlockedPermissions: [Permission.EditAllOperationalResources],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        `You are not authorized to update Monitor because ${Permission.EditProjectMonitor} is in your team's permission block list.`,
      ),
    );
  });

  it("still says what is missing when the wildcard is not held at all", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [Permission.EditMonitorLabelRule],
          labelledBlockedPermissions: [Permission.EditAllOperationalResources],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        "You do not have permission to edit every monitor in this project, which running this rule does.",
      ),
    );
  });

  it("counts the operational wildcard granted to the whole project", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          permissions: [
            Permission.EditMonitorLabelRule,
            Permission.EditAllOperationalResources,
          ],
        }),
      );
    }).not.toThrow();
  });

  it("lets a master admin run whatever blocks their rows carry", () => {
    expect(() => {
      assertCanRun(
        RuleRunType.MonitorLabelRule,
        propsWith({
          isMasterAdmin: true,
          labelledBlockedPermissions: [Permission.EditProjectMonitor],
        }),
      );
    }).not.toThrow();
  });
});

/*
 * The network automation rules' Run now (site assignment, device label and
 * auto import rules) is not in the registry - it lives in the App's
 * NetworkRuleRun API - but reaches every network device of the project the
 * same way, and asks the same question: assertMayChangeEveryRecord.
 */
describe("RuleRunPermission.assertMayChangeEveryRecord", () => {
  const MESSAGE: string =
    "You do not have permission to edit every network device in this project, which running site assignment rules does.";

  function assertMayEditEveryDevice(
    props: DatabaseCommonInteractionProps,
  ): void {
    RuleRunPermission.assertMayChangeEveryRecord({
      props: props,
      modelType: NetworkDevice,
      requestType: DatabaseRequestType.Update,
      message: MESSAGE,
    });
  }

  it("lets a caller whose grant reaches the whole project", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditNetworkDevice,
    ]) {
      expect(() => {
        assertMayEditEveryDevice(propsWith({ permissions: [permission] }));
      }).not.toThrow();
    }
  });

  it("counts a grant stored with the scope All", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          permissions: [Permission.EditNetworkDevice],
          scope: PermissionScope.All,
        }),
      );
    }).not.toThrow();
  });

  it("refuses a grant limited to some labels, with the run's own words", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          permissions: [Permission.EditNetworkDevice],
          labelIds: [ObjectID.generate()],
        }),
      );
    }).toThrow(new NotAuthorizedException(MESSAGE));
  });

  it("refuses a grant limited to owned devices", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          permissions: [Permission.EditNetworkDevice],
          scope: PermissionScope.Owned,
        }),
      );
    }).toThrow(new NotAuthorizedException(MESSAGE));
  });

  it("refuses a caller with no device permission at all", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({ permissions: [Permission.EditNetworkSiteAssignmentRule] }),
      );
    }).toThrow(new NotAuthorizedException(MESSAGE));
  });

  it("refuses a block with no labels, naming it", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          permissions: [Permission.ProjectAdmin],
          blockedPermissions: [Permission.EditNetworkDevice],
        }),
      );
    }).toThrow(/permission block list/);
  });

  it("refuses a block on some labels of a model whose records carry labels", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [Permission.EditNetworkDevice],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        `${MESSAGE} Edit Network Device is in your team's permission block list for some labels.`,
      ),
    );
  });

  it("does not refuse a block on some labels of a rule, which carries none", () => {
    expect(() => {
      RuleRunPermission.assertMayChangeEveryRecord({
        props: propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [
            Permission.EditNetworkSiteAssignmentRule,
          ],
        }),
        modelType: NetworkSiteAssignmentRule,
        requestType: DatabaseRequestType.Update,
        message: "You do not have permission to run site assignment rules.",
      });
    }).not.toThrow();
  });

  it("asks a create the same way: monitors created across the project", () => {
    const message: string =
      "You do not have permission to create monitors anywhere in this project, which running this auto-import rule does.";

    expect(() => {
      RuleRunPermission.assertMayChangeEveryRecord({
        props: propsWith({
          permissions: [Permission.CreateProjectMonitor],
          labelIds: [ObjectID.generate()],
        }),
        modelType: Monitor,
        requestType: DatabaseRequestType.Create,
        message: message,
      });
    }).toThrow(new NotAuthorizedException(message));

    expect(() => {
      RuleRunPermission.assertMayChangeEveryRecord({
        props: propsWith({
          permissions: [Permission.CreateAllOperationalResources],
        }),
        modelType: Monitor,
        requestType: DatabaseRequestType.Create,
        message: message,
      });
    }).not.toThrow();
  });

  it("names the permission to ask for when no grant reaches the whole project, and only then", () => {
    function withHint(props: DatabaseCommonInteractionProps): void {
      RuleRunPermission.assertMayChangeEveryRecord({
        props: props,
        modelType: NetworkDevice,
        requestType: DatabaseRequestType.Update,
        message: MESSAGE,
        missingPermission: Permission.EditNetworkDevice,
      });
    }

    expect(() => {
      withHint(
        propsWith({
          permissions: [Permission.EditNetworkDevice],
          labelIds: [ObjectID.generate()],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        `${MESSAGE} Missing permission: Edit Network Device, for all resources in the project.`,
      ),
    );

    // A block says what blocks, not what is missing.
    expect(() => {
      withHint(
        propsWith({
          permissions: [Permission.ProjectAdmin],
          labelledBlockedPermissions: [Permission.EditNetworkDevice],
        }),
      );
    }).toThrow(
      new NotAuthorizedException(
        `${MESSAGE} Edit Network Device is in your team's permission block list for some labels.`,
      ),
    );
  });

  it("lets a master admin through without reading their rows", () => {
    expect(() => {
      assertMayEditEveryDevice(
        propsWith({
          isMasterAdmin: true,
          blockedPermissions: [Permission.EditNetworkDevice],
        }),
      );
    }).not.toThrow();
  });

  /*
   * Pinned to the route's source: every permission a network rule's Run now
   * needs is asked through this one rule, never read off the caller's rows
   * by hand - which is how a grant limited to some labels used to pass.
   */
  it("is what every network automation rule's Run now asks", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../../App/FeatureSet/BaseAPI/API/NetworkRuleRun.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("CallerPermission");
    expect(source).not.toContain("TablePermission");

    const asks: Array<string> =
      source.match(/RuleRunPermission\.assertMayChangeEveryRecord\(/g) || [];

    // The rule, devices edited, devices created and monitors created.
    expect(asks.length).toBe(4);

    for (const modelType of [
      "modelType: data.ruleModelType",
      "modelType: NetworkDevice",
      "modelType: Monitor",
    ]) {
      expect(source).toContain(modelType);
    }

    for (const route of [
      "/network-site-assignment-rule/:ruleId/run",
      "/network-device-label-rule/:ruleId/run",
      "/network-device-auto-import-rule/:ruleId/run",
    ]) {
      expect(source).toContain(route);
    }

    expect((source.match(/assertCanRunRule\(\{/g) || []).length).toBe(3);
  });
});
