import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import BillingPaymentMethod from "../../../../../Models/DatabaseModels/BillingPaymentMethod";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import LogSavedView from "../../../../../Models/DatabaseModels/LogSavedView";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import OnCallDutyPolicyOwnerRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyOwnerRule";
import RunbookLabelRule from "../../../../../Models/DatabaseModels/RunbookLabelRule";
import StatusPageOwnerRule from "../../../../../Models/DatabaseModels/StatusPageOwnerRule";
import TableView from "../../../../../Models/DatabaseModels/TableView";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import WorkflowOwnerRule from "../../../../../Models/DatabaseModels/WorkflowOwnerRule";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3305: a user whose team grants only "Monitor Viewer" could not open
 * Monitors -> All Monitors. Every ModelTable in the dashboard fetches the saved
 * views for its table on mount, and TableView's read list named only the
 * project-wide roles plus Settings — so the request came back
 *
 *   "You do not have permissions to read Table View. You need one of these
 *    permissions: Project Owner, Project Admin, Project Member, Viewer,
 *    Settings Admin, Settings Member, Settings Viewer, Read Table View"
 *
 * and the page rendered an error over itself. Granting the project-wide Viewer
 * role fixed it, which is exactly what scoped roles exist to avoid.
 *
 * The shape of the bug is not specific to saved views. Saved views, labels,
 * teams and team members are the furniture of the dashboard rather than a
 * capability anybody is trusted with; every domain page mounts them. They were
 * each filed under one arbitrary role family when the per-domain tiers landed,
 * so a member scoped to any single domain lost all four.
 *
 * The fix gives every project member Permission.ProjectUser and has those four
 * models read through it. These tests pin the outcome at both levels the API
 * checks — the table gate in TablePermission, and the per-column gate in
 * ColumnPermissions — for a principal holding nothing but MonitorViewer.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * The permission set AccessTokenService hands a signed-in member: whatever
 * their teams grant, plus the three the platform adds for anyone who has a
 * session inside a project. ProjectUser is the one this fix introduces.
 */
type MakePropsFunction = (
  grantedByTeams: Array<Permission>,
  options?: { isProjectMember?: boolean },
) => DatabaseCommonInteractionProps;

const makeProps: MakePropsFunction = (
  grantedByTeams: Array<Permission>,
  options?: { isProjectMember?: boolean },
): DatabaseCommonInteractionProps => {
  const isProjectMember: boolean = options?.isProjectMember ?? true;

  const permissions: Array<Permission> = [
    Permission.CurrentUser,
    Permission.UnAuthorizedSsoUser,
    ...(isProjectMember ? [Permission.ProjectUser] : []),
    ...grantedByTeams,
  ];

  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

type ModelType = { new (): any };

type CanReadFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
) => boolean;

const canRead: CanReadFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): boolean => {
  try {
    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Read,
    );
    return true;
  } catch {
    return false;
  }
};

type ReadableColumnsFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
) => Array<string>;

const readableColumns: ReadableColumnsFunction = (
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Array<string> => {
  return ColumnPermissions.getModelColumnsByPermissions(
    modelType,
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Allow,
    ),
    DatabaseRequestType.Read,
  ).columns;
};

describe("A domain-scoped role can use the dashboard it was granted", () => {
  const monitorViewer: DatabaseCommonInteractionProps = makeProps([
    Permission.MonitorViewer,
  ]);

  test("Monitor Viewer can read Table View - the exact request from issue #3305", () => {
    expect(canRead(TableView, monitorViewer)).toBe(true);
  });

  test("Monitor Viewer can read the shared workspace models every table mounts", () => {
    expect(canRead(Label, monitorViewer)).toBe(true);
    expect(canRead(Team, monitorViewer)).toBe(true);
    expect(canRead(TeamMember, monitorViewer)).toBe(true);
  });

  test("every other domain viewer reaches them too, not just Monitor", () => {
    const otherViewers: Array<Permission> = [
      Permission.IncidentViewer,
      Permission.AlertViewer,
      Permission.StatusPageViewer,
      Permission.OnCallViewer,
      Permission.ScheduledMaintenanceViewer,
      Permission.TelemetryViewer,
      Permission.WorkflowViewer,
      Permission.RunbookViewer,
    ];

    const blocked: Array<string> = [];

    for (const viewer of otherViewers) {
      const props: DatabaseCommonInteractionProps = makeProps([viewer]);

      for (const modelType of [TableView, Label, Team, TeamMember]) {
        if (!canRead(modelType, props)) {
          blocked.push(`${viewer} cannot read ${new modelType().singularName}`);
        }
      }
    }

    expect(blocked).toEqual([]);
  });

  /*
   * The table gate is only the first of two. A list request also has to survive
   * SelectPermission, which is driven by the per-column read lists — so a fix
   * that stopped at the table level would turn a 422 on the table into a 422 on
   * whichever column the dashboard selects. These are the columns
   * ModelTable/TableView.tsx asks for.
   */
  test("Monitor Viewer can select the saved-view columns the dashboard reads", () => {
    const columns: Array<string> = readableColumns(TableView, monitorViewer);

    for (const column of [
      "name",
      "tableId",
      "query",
      "sort",
      "itemsOnPage",
      "facets",
      "columns",
      "createdByUserId",
      "projectId",
    ]) {
      expect(columns).toContain(column);
    }
  });

  test("Monitor Viewer can select the columns the label and owner pickers read", () => {
    expect(readableColumns(Label, monitorViewer)).toEqual(
      expect.arrayContaining(["name", "color", "projectId"]),
    );
    expect(readableColumns(Team, monitorViewer)).toEqual(
      expect.arrayContaining(["name", "projectId"]),
    );
    /*
     * `user` is the one that mattered: TeamMember's table list already admitted
     * CurrentUser, so the request got through and then failed on the relation
     * the owner picker exists to show.
     */
    expect(readableColumns(TeamMember, monitorViewer)).toEqual(
      expect.arrayContaining(["user", "userId", "team", "teamId"]),
    );
  });

  /*
   * Every probe-backed monitor page - Criteria, Probes, Logs, Metrics - loads
   * the project's probes through ProbeUtil.getAllProbes, and it selects
   * shouldAutoEnableProbeOnNewMonitors. Probe's table list admits Public so the
   * request got in, then SelectPermission refused that one column, because the
   * probe catalogue was filed under Settings while the monitors that run on it
   * were not.
   */
  test("Monitor Viewer can select the probe columns the monitor pages read", () => {
    expect(canRead(Probe, monitorViewer)).toBe(true);

    expect(readableColumns(Probe, monitorViewer)).toEqual(
      expect.arrayContaining([
        "name",
        "shouldAutoEnableProbeOnNewMonitors",
        "connectionStatus",
        "lastAlive",
      ]),
    );
  });

  /*
   * The probe's own authentication key is not part of that. It is how a probe
   * proves who it is, and it stays with the two roles that can rotate it.
   */
  test("Monitor Viewer still cannot read a probe's key", () => {
    expect(readableColumns(Probe, monitorViewer)).not.toContain("key");
  });

  test("Telemetry roles can use their own saved log views", () => {
    for (const role of [
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
    ]) {
      expect(canRead(LogSavedView, makeProps([role]))).toBe(true);
    }
  });

  test("owner and label rules accept their own domain's roles", () => {
    expect(
      canRead(OnCallDutyPolicyOwnerRule, makeProps([Permission.OnCallViewer])),
    ).toBe(true);
    expect(
      canRead(StatusPageOwnerRule, makeProps([Permission.StatusPageViewer])),
    ).toBe(true);
    expect(
      canRead(RunbookLabelRule, makeProps([Permission.RunbookViewer])),
    ).toBe(true);
    expect(
      canRead(WorkflowOwnerRule, makeProps([Permission.WorkflowViewer])),
    ).toBe(true);
  });
});

describe("The shared-resource grant does not widen anything else", () => {
  const monitorViewer: DatabaseCommonInteractionProps = makeProps([
    Permission.MonitorViewer,
  ]);

  test("a Monitor Viewer still cannot read another domain's records", () => {
    expect(canRead(Incident, monitorViewer)).toBe(false);
  });

  /*
   * ProjectUser was added to read lists only. TeamMember is left out of this
   * sweep because its update list has always accepted CurrentUser so that a
   * member can accept their own invitation; TenantPermission narrows that to
   * their own row, which the last describe below pins.
   */
  test("a Monitor Viewer still cannot write the shared models", () => {
    for (const modelType of [TableView, Label, Team]) {
      for (const type of [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(() => {
          TablePermission.checkTableLevelPermissions(
            modelType,
            monitorViewer,
            type,
          );
        }).toThrow();
      }
    }

    for (const type of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Delete,
    ]) {
      expect(() => {
        TablePermission.checkTableLevelPermissions(
          TeamMember,
          monitorViewer,
          type,
        );
      }).toThrow();
    }
  });

  test("a Monitor Viewer still cannot write monitors", () => {
    expect(() => {
      TablePermission.checkTableLevelPermissions(
        Monitor,
        monitorViewer,
        DatabaseRequestType.Update,
      );
    }).toThrow();
  });

  /*
   * The columns a plain Project Member was never allowed to see stay hidden.
   * `invitationAcceptedAt` is admin-only on TeamMember and the deletion audit
   * columns are readable by nobody; a sweep that pasted ProjectUser into every
   * read list would have quietly opened all three.
   */
  test("restricted columns stay restricted", () => {
    const columns: Array<string> = readableColumns(TeamMember, monitorViewer);

    expect(columns).not.toContain("invitationAcceptedAt");
    expect(columns).not.toContain("deletedByUser");
    expect(columns).not.toContain("deletedByUserId");
  });

  /*
   * The dashboard shell counts this project's payment methods at boot, and a
   * refusal there replaces the whole app with an error page - so the table and
   * the column the count filters on have to be reachable. Nothing else about
   * the card does: the details stay with the billing roles.
   */
  test("a Monitor Viewer can count payment methods but cannot read the card", () => {
    expect(canRead(BillingPaymentMethod, monitorViewer)).toBe(true);

    const columns: Array<string> = readableColumns(
      BillingPaymentMethod,
      monitorViewer,
    );

    expect(columns).toContain("projectId");

    for (const column of [
      "last4Digits",
      "paymentMethodType",
      "paymentProviderPaymentMethodId",
      "paymentProviderCustomerId",
      "isDefault",
      "createdByUser",
    ]) {
      expect(columns).not.toContain(column);
    }
  });

  /*
   * ProjectUser is what being a member of the project means, so it must not
   * reach a caller who is not one. The SSO-unsatisfied path in
   * UserAuthorization hands out the default permission set alone, and that set
   * deliberately does not carry it.
   */
  test("a caller who is not a project member is still refused", () => {
    const notAMember: DatabaseCommonInteractionProps = makeProps([], {
      isProjectMember: false,
    });

    expect(canRead(TableView, notAMember)).toBe(false);
    expect(canRead(Label, notAMember)).toBe(false);
    expect(canRead(Team, notAMember)).toBe(false);
  });

  /*
   * Without the grant the original failure returns verbatim. This pins the
   * mechanism rather than the model list: if ProjectUser ever stops being
   * handed to members, this is the test that says why the dashboard broke.
   */
  test("the reported error is exactly what a member without the grant still gets", () => {
    const withoutGrant: DatabaseCommonInteractionProps = makeProps(
      [Permission.MonitorViewer],
      { isProjectMember: false },
    );

    expect(() => {
      TablePermission.checkTableLevelPermissions(
        TableView,
        withoutGrant,
        DatabaseRequestType.Read,
      );
    }).toThrow(
      "You do not have permissions to read Table View. You need one of these permissions: Project Owner, Project Admin, Project Member, Viewer, Project User, Settings Admin, Settings Member, Settings Viewer, Read Table View",
    );
  });
});

describe("ProjectUser is authority, not an auto-granted marker", () => {
  /*
   * TenantPermission narrows a query to the caller's own rows when
   * Permission.CurrentUser is the only thing letting them through, so that a
   * bare session cannot act on everybody's records. TeamMember is the model
   * where that matters here: it lists CurrentUser, and the owner picker needs
   * the whole member list rather than the caller's own row.
   *
   * Listing ProjectUser on a model is an explicit statement that the project
   * may read it, so it counts as a real grant and lifts that narrowing — while
   * a caller holding only the auto-granted trio stays pinned to their own rows.
   */
  test("a project member reading TeamMember is not narrowed to their own row", () => {
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        TeamMember,
        makeProps([Permission.MonitorViewer]),
        DatabaseRequestType.Read,
      ),
    ).toBe(false);
  });

  test("a caller with only the auto-granted permissions is still narrowed", () => {
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        TeamMember,
        makeProps([], { isProjectMember: false }),
        DatabaseRequestType.Read,
      ),
    ).toBe(true);
  });

  /*
   * Writes to TeamMember are unchanged: ProjectUser appears in no create,
   * update or delete list, so ownership narrowing on those operations is
   * exactly as it was.
   */
  test("updates to TeamMember are still narrowed to the caller's own row", () => {
    expect(
      TenantPermission.isAccessGrantedOnlyByCurrentUser(
        TeamMember,
        makeProps([Permission.MonitorViewer]),
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
  });
});
