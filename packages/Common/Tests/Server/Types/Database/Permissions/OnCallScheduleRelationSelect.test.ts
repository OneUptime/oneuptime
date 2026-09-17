import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AccessControlPermission from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import PublicPermission from "../../../../../Server/Types/Database/Permissions/PublicPermission";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import UserPermissions from "../../../../../Server/Types/Database/Permissions/UserPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isOwnerOnlyColumn } from "../../../../../Types/Database/AccessControl/OwnerOnlyColumn";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * THE BUG.
 *
 * Opening a policy's escalation rules failed outright with
 *
 *   Column currentUserIdOnRoster on On-Call Policy Schedule does not
 *   support read on relation query.
 *
 * The escalation rule page lists the schedules attached to each rule and marks
 * the ones that would currently page nobody. It reads that state off the join:
 *
 *   modelType: OnCallDutyPolicyEscalationRuleSchedule
 *   select: { onCallDutyPolicySchedule: { name, currentUserIdOnRoster } }
 *
 * `name` carries canReadOnRelationQuery. `currentUserIdOnRoster` did not, and
 * QueryPermission.checkRelationQueryPermission THROWS on the first unflagged
 * inner key rather than dropping that key from the select - so the one missing
 * flag failed the entire request, and the page rendered nothing at all. Every
 * caller hit it, up to and including ProjectOwner, which is why deleting the
 * schedule and re-creating it changed nothing: no row was ever the problem.
 *
 * WHAT THESE TESTS PIN.
 *
 * The two select shapes the UI actually sends, verbatim, so a select edited in
 * the components without a matching model flag fails here (first describe).
 * That the flag is the only thing that moved - the sibling columns on the same
 * model, deep relations and unknown columns all still refuse, and a direct
 * non-relation read is still governed by column permissions (third and fourth
 * describes). And the deliberate cost of the flag, stated rather than skipped
 * over: it bypasses the related column's own read list, exactly as `name`
 * already did (fifth describe).
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * Fresh props per assertion: DatabaseCommonInteractionPropsUtil MUTATES what it
 * is handed, pushing the auto-granted Public and CurrentUser onto the list, so
 * a shared object carries state between tests.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function checkRelationSelect(
  select: Select<OnCallDutyPolicyEscalationRuleSchedule>,
  props: DatabaseCommonInteractionProps,
): void {
  QueryPermission.checkRelationQueryPermission(
    OnCallDutyPolicyEscalationRuleSchedule,
    {} as Query<OnCallDutyPolicyEscalationRuleSchedule>,
    select,
    props,
  );
}

/*
 * The select copied out of
 * App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx.
 * Kept as a literal rather than imported so that changing the component
 * without changing the model surfaces here as a failure.
 */
const ESCALATION_RULES_SELECT: Select<OnCallDutyPolicyEscalationRuleSchedule> =
  {
    _id: true,
    onCallDutyPolicyEscalationRuleId: true,
    onCallDutyPolicySchedule: {
      _id: true,
      name: true,
      currentUserIdOnRoster: true,
    },
  } as Select<OnCallDutyPolicyEscalationRuleSchedule>;

/*
 * The select copied out of
 * App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicySummary.tsx.
 */
const POLICY_SUMMARY_SELECT: Select<OnCallDutyPolicyEscalationRuleSchedule> = {
  _id: true,
  onCallDutyPolicyEscalationRuleId: true,
  onCallDutyPolicySchedule: {
    _id: true,
    name: true,
    currentUserIdOnRoster: true,
  },
} as Select<OnCallDutyPolicyEscalationRuleSchedule>;

describe("On-call schedule relation select - the reported failure", () => {
  it("accepts the escalation rules page select", () => {
    expect(() => {
      return checkRelationSelect(
        ESCALATION_RULES_SELECT,
        makeProps([Permission.ProjectOwner]),
      );
    }).not.toThrow();
  });

  it("accepts the policy summary select", () => {
    expect(() => {
      return checkRelationSelect(
        POLICY_SUMMARY_SELECT,
        makeProps([Permission.ProjectOwner]),
      );
    }).not.toThrow();
  });

  it("no longer raises the reported message for any caller", () => {
    /*
     * The reporter was a project owner and re-created the schedule twice. The
     * throw was in the permission layer and had nothing to do with the row, so
     * pin it across the whole read list rather than for one role.
     */
    const readers: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ];

    for (const permission of readers) {
      expect(() => {
        return checkRelationSelect(
          ESCALATION_RULES_SELECT,
          makeProps([permission]),
        );
      }).not.toThrow();
    }
  });

  it("accepts the roster column selected on its own", () => {
    // Without `name` alongside it, in case the component drops the label later.
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            currentUserIdOnRoster: true,
          },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        makeProps([Permission.ProjectMember]),
      );
    }).not.toThrow();
  });
});

describe("On-call schedule relation select - through the full permission stack", () => {
  /*
   * checkRelationQueryPermission is one of several gates BasePermission runs
   * over a read, and the escalation rule page reaches it through all of them.
   * Tenant and user scoping need a database, so they are stubbed; every
   * permission gate on the select path is left real.
   */
  beforeEach(() => {
    jest
      .spyOn(PublicPermission, "checkIfUserIsLoggedIn")
      .mockImplementation(() => {});
    jest
      .spyOn(TenantPermission, "addTenantScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(UserPermissions, "addUserScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(TablePermission, "checkTableLevelPermissions")
      .mockImplementation(() => {});
    jest
      .spyOn(AccessControlPermission, "addAccessControlIdsToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
    jest
      .spyOn(OwnedScopePermission, "addOwnedScopeToQuery")
      .mockImplementation(async (_modelType: any, query: any) => {
        return query;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets the escalation rule read through checkPermissions", async () => {
    await expect(
      BasePermission.checkPermissions(
        OnCallDutyPolicyEscalationRuleSchedule,
        { onCallDutyPolicyId: ObjectID.generate() } as any,
        ESCALATION_RULES_SELECT,
        makeProps([Permission.ProjectOwner]),
        DatabaseRequestType.Read,
      ),
    ).resolves.toBeDefined();
  });

  it("actually reaches the relation gate on that path", async () => {
    /*
     * Guards the test above from passing because the gate was skipped rather
     * than because it allowed the select.
     */
    const spy: jest.SpyInstance = jest.spyOn(
      QueryPermission,
      "checkRelationQueryPermission",
    );

    await BasePermission.checkPermissions(
      OnCallDutyPolicyEscalationRuleSchedule,
      { onCallDutyPolicyId: ObjectID.generate() } as any,
      ESCALATION_RULES_SELECT,
      makeProps([Permission.ProjectOwner]),
      DatabaseRequestType.Read,
    );

    expect(spy).toHaveBeenCalled();
  });

  it("still runs the top-level select gate on that path", async () => {
    const spy: jest.SpyInstance = jest.spyOn(
      SelectPermission,
      "checkSelectPermission",
    );

    await BasePermission.checkPermissions(
      OnCallDutyPolicyEscalationRuleSchedule,
      { onCallDutyPolicyId: ObjectID.generate() } as any,
      ESCALATION_RULES_SELECT,
      makeProps([Permission.ProjectOwner]),
      DatabaseRequestType.Read,
    );

    expect(spy).toHaveBeenCalled();
  });
});

describe("On-call schedule relation select - the model flag itself", () => {
  const schedule: BaseModel = new OnCallDutyPolicySchedule();

  function metadata(columnName: string): TableColumnMetadata {
    return schedule.getTableColumnMetadata(columnName);
  }

  it("marks currentUserIdOnRoster readable through a relation", () => {
    expect(metadata("currentUserIdOnRoster").canReadOnRelationQuery).toBe(true);
  });

  it("keeps it an ObjectID column, not an entity", () => {
    /*
     * The relation traversal only recurses into Entity columns. If this column
     * ever became one, `currentUserIdOnRoster: true` would stop being a leaf
     * select and the flag would no longer be what is being tested.
     */
    expect(metadata("currentUserIdOnRoster").type).toBe(
      TableColumnType.ObjectID,
    );
  });

  it("puts it alongside the columns the join already exposed", () => {
    expect(metadata("name").canReadOnRelationQuery).toBe(true);
    expect(metadata("projectId").canReadOnRelationQuery).toBe(true);
  });

  it("does not mark it owner-only", () => {
    /*
     * canReadOnRelationQuery runs AFTER the owner-only gate in
     * checkRelationQueryPermission and cannot override it. Marking this column
     * @OwnerOnlyColumn later would silently re-break the page, so state the
     * expectation here.
     */
    expect(isOwnerOnlyColumn(schedule, "currentUserIdOnRoster")).toBe(false);
  });

  it("leaves the rest of the schedule's columns alone", () => {
    /*
     * The fix is one flag on one column, not a widening of the model. Every
     * column below is still unreadable through a relation.
     */
    const stillClosed: Array<string> = [
      "description",
      "timezone",
      "slug",
      "nextUserIdOnRoster",
      "rosterHandoffAt",
      "rosterNextHandoffAt",
      "rosterNextStartAt",
      "rosterStartAt",
      "createdByUserId",
      "deletedByUserId",
    ];

    for (const columnName of stillClosed) {
      expect(metadata(columnName)).toBeTruthy();
      expect(Boolean(metadata(columnName).canReadOnRelationQuery)).toBe(false);
    }
  });
});

describe("On-call schedule relation select - what still refuses", () => {
  const props: DatabaseCommonInteractionProps = makeProps([
    Permission.ProjectOwner,
  ]);

  it("refuses a sibling column that was never flagged", () => {
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            name: true,
            timezone: true,
          },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow(BadDataException);
  });

  it("refuses the next-on-roster column", () => {
    /*
     * The neighbouring column, same shape, same model, one line away in the
     * source. Only the column the page needs was opened.
     */
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            nextUserIdOnRoster: true,
          },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        makeProps([Permission.ProjectOwner]),
      );
    }).toThrow(
      "Column nextUserIdOnRoster on On-Call Policy Schedule does not support read on relation query.",
    );
  });

  it("refuses a deep relation hung off the roster user", () => {
    /*
     * currentUserOnRoster is the entity beside the id column. Walking into it
     * would reach the User table; deep relations are refused before any column
     * check happens.
     */
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            currentUserOnRoster: { email: true },
          },
        } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        props,
      );
    }).toThrow(
      "You cannot query deep relations. Querying deep relations is not supported.",
    );
  });

  it("refuses a column that does not exist on the schedule", () => {
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            currentUserIdOnRosterr: true,
          },
        } as unknown as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        props,
      );
    }).toThrow(BadDataException);
  });

  it("still refuses a direct read of the column without permission", () => {
    /*
     * The flag governs the relation gate only. Selecting the column at the top
     * level of a schedule query goes through SelectPermission, which reads the
     * column's own @ColumnAccessControl list - and a caller holding none of
     * those permissions is refused exactly as before.
     */
    expect(() => {
      return SelectPermission.checkSelectPermission(
        OnCallDutyPolicySchedule,
        { currentUserIdOnRoster: true } as Select<OnCallDutyPolicySchedule>,
        makeProps([Permission.ProjectUser]),
      );
    }).toThrow(NotAuthorizedException);
  });

  it("allows the direct read for a caller who does hold the permission", () => {
    expect(() => {
      return SelectPermission.checkSelectPermission(
        OnCallDutyPolicySchedule,
        { currentUserIdOnRoster: true } as Select<OnCallDutyPolicySchedule>,
        makeProps([Permission.ReadProjectOnCallDutyPolicySchedule]),
      );
    }).not.toThrow();
  });
});

describe("On-call schedule relation select - the cost of the flag", () => {
  /*
   * canReadOnRelationQuery short-circuits the related column's own read list -
   * that is what the flag DOES, and it is why the model comment argues the case
   * rather than leaving the flag bare. Pinned here so the tradeoff is visible
   * and deliberate instead of being discovered later.
   */

  it("exposes the roster id to a caller scoped only to the join table", () => {
    /*
     * ReadProjectOnCallDutyPolicyEscalationRuleSchedule is not on the schedule
     * column's own read list. Through the join it reads anyway - as it already
     * did for the schedule's name.
     */
    const joinOnlyProps: DatabaseCommonInteractionProps = makeProps([
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ]);

    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: {
            name: true,
            currentUserIdOnRoster: true,
          },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        joinOnlyProps,
      );
    }).not.toThrow();
  });

  it("is the same route the schedule name already took", () => {
    /*
     * If `name` alone ever started refusing for this caller, the paragraph
     * above stops being true and the flag would need re-arguing.
     */
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: { name: true },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        makeProps([
          Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
        ]),
      );
    }).not.toThrow();
  });

  it("does not let that caller reach anything else on the schedule", () => {
    expect(() => {
      return checkRelationSelect(
        {
          onCallDutyPolicySchedule: { description: true },
        } as Select<OnCallDutyPolicyEscalationRuleSchedule>,
        makeProps([
          Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
        ]),
      );
    }).toThrow(BadDataException);
  });
});
