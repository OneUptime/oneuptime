import HostOwnerUser from "../../../../Models/DatabaseModels/HostOwnerUser";
import IncidentTemplateOwnerUser from "../../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import MonitorOwnerUser from "../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import HostOwnerUserService from "../../../../Server/Services/HostOwnerUserService";
import IncidentTemplateOwnerUserService from "../../../../Server/Services/IncidentTemplateOwnerUserService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import ColumnWriteRefusedException from "../../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import CreatePermission from "../../../../Server/Types/Database/Permissions/CreatePermission";
import ServerSetColumns from "../../../../Server/Utils/Database/ServerSetColumns";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ONEUPTIME'S OWN WRITES THAT FILL IN A SERVER-SET COLUMN AS A PERSON.
 *
 * A create's value in a computed column is held to the column's create list
 * before the hooks run (ColumnPermission.checkComputedColumnsSentOnCreate):
 * a person's own value never reaches the record. Two of OneUptime's own
 * writes are made as the person they act for, so that the person's
 * permissions are asked, and fill in such a column while they do. Each marks
 * the record (ServerSetColumns), so the value is OneUptime's and is kept:
 *
 *   - the owners picked in the form that created a resource, added quietly
 *     for its creator (OwnerRuleAssignment.buildOwner): whether the owner is
 *     told;
 *   - the status rows an incident a person declares or edits gives its
 *     monitors (MonitorService.changeMonitorStatus): whether the owners are
 *     told, and the evidence of the change.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "65410000-0000-4000-8000-00000000c001",
);
const USER_ID: ObjectID = new ObjectID("65410000-0000-4000-8000-00000000c002");
const RESOURCE_ID: ObjectID = new ObjectID(
  "65410000-0000-4000-8000-00000000c003",
);
const OWNER_ID: ObjectID = new ObjectID("65410000-0000-4000-8000-00000000c004");

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an owner row OneUptime adds for the person who picked the owner", () => {
  // Who may add a host owner: the table's create list.
  const HOST_OWNER_ADDERS: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateHostOwnerUser,
  ];

  function hostOwner(isOwnerNotified: boolean | undefined): HostOwnerUser {
    return OwnerRuleAssignment.buildOwner({
      ownerService: HostOwnerUserService,
      ownerColumn: "userId",
      ownerId: OWNER_ID,
      resourceIdColumn: "hostId",
      resourceId: RESOURCE_ID,
      projectId: PROJECT_ID,
      isOwnerNotified: isOwnerNotified,
    });
  }

  test("is built with whether the owner is told, marked as OneUptime's", () => {
    const owner: HostOwnerUser = hostOwner(true);

    expect(owner.isOwnerNotified).toBe(true);
    expect(ServerSetColumns.isMarked(owner, "isOwnerNotified")).toBe(true);
    // Nobody may create the column: the mark is what lets the value stand.
    expect(owner.getColumnAccessControlFor("isOwnerNotified")!.create).toEqual(
      [],
    );
    expect(owner.getTableColumnMetadata("isOwnerNotified").computed).toBe(true);
  });

  test("is built with no flag, and no mark, when it is not given", () => {
    const owner: HostOwnerUser = hostOwner(undefined);

    expect(owner.isOwnerNotified).toBeUndefined();
    expect(ServerSetColumns.getMarked(owner)).toEqual([]);
  });

  // An incident template's owner rows have no such column (a service's do since #9700).
  test("on an owner table with no such column, writes and marks nothing", () => {
    const owner: IncidentTemplateOwnerUser = OwnerRuleAssignment.buildOwner({
      ownerService: IncidentTemplateOwnerUserService,
      ownerColumn: "userId",
      ownerId: OWNER_ID,
      resourceIdColumn: "incidentTemplateId",
      resourceId: RESOURCE_ID,
      projectId: PROJECT_ID,
      isOwnerNotified: true,
    });

    expect(owner.isTableColumn("isOwnerNotified")).toBe(false);
    expect(
      (owner as unknown as Record<string, unknown>)["isOwnerNotified"],
    ).toBeUndefined();
    expect(ServerSetColumns.getMarked(owner)).toEqual([]);
  });

  test("where the person may create the flag, it is theirs to set and nothing changes", () => {
    const owner: MonitorOwnerUser = OwnerRuleAssignment.buildOwner({
      ownerService: MonitorOwnerUserService,
      ownerColumn: "userId",
      ownerId: OWNER_ID,
      resourceIdColumn: "monitorId",
      resourceId: RESOURCE_ID,
      projectId: PROJECT_ID,
      isOwnerNotified: true,
    });

    expect(
      owner.getColumnAccessControlFor("isOwnerNotified")!.create,
    ).toContain(Permission.ProjectMember);
    expect(() => {
      CreatePermission.checkCreatePermissions(
        MonitorOwnerUser,
        owner,
        member([Permission.ProjectMember]),
      );
    }).not.toThrow();
  });

  test.each(HOST_OWNER_ADDERS)(
    "keeps the flag through the ask before the hooks and the check of the record, for a person holding %s",
    (permission: Permission) => {
      const owner: HostOwnerUser = hostOwner(true);
      const props: DatabaseCommonInteractionProps = member([permission]);

      expect(
        ColumnPermissions.checkComputedColumnsSentOnCreate(
          HostOwnerUser,
          owner,
          props,
        ),
      ).toEqual([]);
      expect(owner.isOwnerNotified).toBe(true);

      expect(() => {
        CreatePermission.checkCreatePermissions(HostOwnerUser, owner, props);
      }).not.toThrow();
    },
  );

  /*
   * The same flag on a row the person built - an owner they add through the
   * API, say - is theirs, not OneUptime's: they may not make an owner quiet.
   * It is dropped for one who may read the column, and refused to one who
   * may not, before any hook runs.
   */
  test("on a row the person built themselves, the flag never reaches the row", () => {
    const fromAReader: HostOwnerUser = new HostOwnerUser();
    fromAReader.hostId = RESOURCE_ID;
    fromAReader.userId = OWNER_ID;
    fromAReader.isOwnerNotified = true;

    expect(
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        HostOwnerUser,
        fromAReader,
        member([Permission.ProjectMember]),
      ),
    ).toEqual([]);
    expect(fromAReader.isOwnerNotified).toBeUndefined();

    const fromAnAdderOnly: HostOwnerUser = new HostOwnerUser();
    fromAnAdderOnly.hostId = RESOURCE_ID;
    fromAnAdderOnly.userId = OWNER_ID;
    fromAnAdderOnly.isOwnerNotified = true;

    expect(() => {
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        HostOwnerUser,
        fromAnAdderOnly,
        member([Permission.CreateHostOwnerUser]),
      );
    }).toThrow(ColumnWriteRefusedException);
  });
});

describe("a monitor's status row an incident writes as the person", () => {
  const MONITOR_ID: ObjectID = new ObjectID(
    "65410000-0000-4000-8000-00000000c005",
  );
  const STATUS_ID: ObjectID = new ObjectID(
    "65410000-0000-4000-8000-00000000c006",
  );

  // The rows changeMonitorStatus hands the status timeline's create.
  function captureCreates(): Array<CreateBy<MonitorStatusTimeline>> {
    const creates: Array<CreateBy<MonitorStatusTimeline>> = [];

    getJestSpyOn(MonitorStatusTimelineService, "findOneBy").mockResolvedValue(
      null as never,
    );
    getJestSpyOn(MonitorStatusTimelineService, "create").mockImplementation(
      (async (
        createBy: CreateBy<MonitorStatusTimeline>,
      ): Promise<MonitorStatusTimeline> => {
        creates.push(createBy);
        return createBy.data;
      }) as never,
    );

    return creates;
  }

  const AS_THE_DECLARER: DatabaseCommonInteractionProps = member([
    Permission.ProjectMember,
  ]);

  test("marks whether the owners are told, and the evidence, as OneUptime's", async () => {
    const creates: Array<CreateBy<MonitorStatusTimeline>> = captureCreates();
    const evidence: JSONObject = { reason: "declared by hand" };

    await MonitorService.changeMonitorStatus(
      PROJECT_ID,
      [MONITOR_ID],
      STATUS_ID,
      true,
      "Status was changed because Incident #12 was created.",
      evidence,
      AS_THE_DECLARER,
    );

    expect(creates).toHaveLength(1);

    const row: MonitorStatusTimeline = creates[0]!.data;

    expect(creates[0]!.props).toBe(AS_THE_DECLARER);
    expect(row.isOwnerNotified).toBe(false);
    expect(row.statusChangeLog).toBe(evidence);
    expect(ServerSetColumns.getMarked(row)).toEqual([
      "isOwnerNotified",
      "statusChangeLog",
    ]);

    // And the values stand through the ask before the hooks, as OneUptime's.
    expect(
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        MonitorStatusTimeline,
        row,
        AS_THE_DECLARER,
      ),
    ).toEqual([]);
    expect(row.isOwnerNotified).toBe(false);
    expect(row.statusChangeLog).toBe(evidence);
  });

  test("with no evidence, marks only whether the owners are told", async () => {
    const creates: Array<CreateBy<MonitorStatusTimeline>> = captureCreates();

    await MonitorService.changeMonitorStatus(
      PROJECT_ID,
      [MONITOR_ID],
      STATUS_ID,
      false,
      undefined,
      undefined,
      AS_THE_DECLARER,
    );

    const row: MonitorStatusTimeline = creates[0]!.data;

    expect(row.isOwnerNotified).toBe(true);
    expect(row.statusChangeLog).toBeUndefined();
    expect(ServerSetColumns.getMarked(row)).toEqual(["isOwnerNotified"]);
  });

  /*
   * Unmarked, the same values would be the person's: the evidence of a
   * change, which nobody may create, is no value they may give a row.
   */
  test("the same values on a row the person built are not taken as OneUptime's", () => {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    row.monitorId = MONITOR_ID;
    row.monitorStatusId = STATUS_ID;
    row.isOwnerNotified = true;
    row.statusChangeLog = { reason: "made up" };

    expect(
      ColumnPermissions.checkComputedColumnsSentOnCreate(
        MonitorStatusTimeline,
        row,
        AS_THE_DECLARER,
      ),
    ).toEqual([]);
    expect(row.isOwnerNotified).toBeUndefined();
    expect(row.statusChangeLog).toBeUndefined();
  });
});
