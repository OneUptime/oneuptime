import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateScopePermission from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import UpdateScopeException from "../../../../../Server/Types/Database/Permissions/UpdateScopeException";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN UPDATE LIMITED TO OWNED RECORDS KEEPS A RECORD UNDER WHAT ITS EDITOR
 * OWNS (CreateScopePermission.checkOwnedUpdate).
 *
 * A record that takes its owners from a parent - a metric pipeline rule
 * from its service, an incident's note from its incident - is reached by an
 * update limited to owned records only under a parent its editor, or the
 * team of their permission to update, owns. A create may name only such a
 * parent; an update could name any parent it may read: a rule of one
 * team's service moved to another team's service, or to no service at all
 * - a rule of the whole project, dropping every service's metrics. Now an
 * update keeps to the same terms as a create.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
);
const EDITORS: ObjectID = new ObjectID("3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f");
const VIEWERS: ObjectID = new ObjectID("4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a");

// Parents (services, incidents), by who owns them.
const EDITORS_PARENT: string = "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8a9b";
const VIEWERS_PARENT: string = "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8a9b0c";
const MEMBERS_PARENT: string = "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d";

function row(
  permission: Permission,
  scope: PermissionScope,
  teamId: ObjectID,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: scope,
    teamId: teamId,
  };
}

function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [EDITORS, VIEWERS],
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

// The parents the member, or one of `teamIds`, owns.
function ownedBy(teamIds: ReadonlyArray<ObjectID>): Array<ObjectID> {
  const teams: Array<string> = teamIds.map((teamId: ObjectID): string => {
    return teamId.toString();
  });

  return [
    MEMBERS_PARENT,
    ...(teams.includes(EDITORS.toString()) ? [EDITORS_PARENT] : []),
    ...(teams.includes(VIEWERS.toString()) ? [VIEWERS_PARENT] : []),
  ].map((id: string): ObjectID => {
    return new ObjectID(id);
  });
}

let lookups: Array<Array<string>> = [];

beforeEach(() => {
  lookups = [];

  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockImplementation((async (
      _modelType: { new (): BaseModel },
      _props: DatabaseCommonInteractionProps,
      teamIds: ReadonlyArray<ObjectID>,
    ): Promise<Array<ObjectID>> => {
      lookups.push(
        teamIds
          .map((teamId: ObjectID): string => {
            return teamId.toString();
          })
          .sort(),
      );
      return ownedBy(teamIds);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Whether the update of `data` on `modelType` passes the check.
async function mayUpdate(
  modelType: { new (): BaseModel },
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<boolean> {
  try {
    await CreateScopePermission.checkOwnedUpdate({
      modelType: modelType,
      data: data,
      props: props,
    });

    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(UpdateScopeException);
    return false;
  }
}

// The editors may change the rules of what they own; the viewers read all.
const RULE_EDITOR: Array<UserPermission> = [
  row(Permission.EditProjectMetricPipelineRule, PermissionScope.Owned, EDITORS),
  row(Permission.ReadProjectMetricPipelineRule, PermissionScope.All, VIEWERS),
  row(Permission.ReadService, PermissionScope.All, VIEWERS),
];

describe("a metric pipeline rule, owned through its service", () => {
  test("is moved to a service the editors or the member own", async () => {
    for (const serviceId of [EDITORS_PARENT, MEMBERS_PARENT]) {
      expect([
        serviceId,
        await mayUpdate(
          MetricPipelineRule,
          { serviceId: new ObjectID(serviceId) },
          memberWith(RULE_EDITOR),
        ),
      ]).toEqual([serviceId, true]);
    }

    // The editors' own team only: the viewers' read lends them nothing.
    expect(lookups).toEqual([[EDITORS.toString()], [EDITORS.toString()]]);
  });

  test("is not moved to a service only another team of the member's owns", async () => {
    expect(
      await mayUpdate(
        MetricPipelineRule,
        { serviceId: new ObjectID(VIEWERS_PARENT) },
        memberWith(RULE_EDITOR),
      ),
    ).toBe(false);
  });

  test("is not made a rule of the whole project", async () => {
    expect(
      await mayUpdate(
        MetricPipelineRule,
        { serviceId: null },
        memberWith(RULE_EDITOR),
      ),
    ).toBe(false);
  });

  test("names its service by the relation just the same", async () => {
    expect(
      await mayUpdate(
        MetricPipelineRule,
        { service: { _id: VIEWERS_PARENT } },
        memberWith(RULE_EDITOR),
      ),
    ).toBe(false);

    expect(
      await mayUpdate(
        MetricPipelineRule,
        { service: { _id: EDITORS_PARENT } },
        memberWith(RULE_EDITOR),
      ),
    ).toBe(true);
  });

  test("a change that leaves its service alone is not asked about", async () => {
    expect(
      await mayUpdate(
        MetricPipelineRule,
        { name: "Renamed" },
        memberWith(RULE_EDITOR),
      ),
    ).toBe(true);
    expect(lookups).toEqual([]);
  });

  test("a permission to change rules over the whole project moves one anywhere", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(
        Permission.EditProjectMetricPipelineRule,
        PermissionScope.All,
        EDITORS,
      ),
      row(
        Permission.ReadProjectMetricPipelineRule,
        PermissionScope.All,
        EDITORS,
      ),
    ]);

    for (const serviceId of [VIEWERS_PARENT, null]) {
      expect(
        await mayUpdate(MetricPipelineRule, { serviceId: serviceId }, props),
      ).toBe(true);
    }

    expect(lookups).toEqual([]);
  });

  test("OneUptime's own writes are left alone", async () => {
    expect(
      await mayUpdate(
        MetricPipelineRule,
        { serviceId: new ObjectID(VIEWERS_PARENT) },
        { isRoot: true },
      ),
    ).toBe(true);
  });
});

describe("an incident's note, owned through its incident", () => {
  const NOTE_EDITOR: Array<UserPermission> = [
    row(Permission.ProjectMember, PermissionScope.Owned, EDITORS),
    row(Permission.Viewer, PermissionScope.Owned, VIEWERS),
  ];

  test("is not moved to an incident only the viewers own", async () => {
    expect(
      await mayUpdate(
        IncidentInternalNote,
        { incidentId: new ObjectID(VIEWERS_PARENT) },
        memberWith(NOTE_EDITOR),
      ),
    ).toBe(false);
  });

  test("is moved to an incident the editors own", async () => {
    expect(
      await mayUpdate(
        IncidentInternalNote,
        { incidentId: new ObjectID(EDITORS_PARENT) },
        memberWith(NOTE_EDITOR),
      ),
    ).toBe(true);
  });

  test("is not left with no incident", async () => {
    expect(
      await mayUpdate(
        IncidentInternalNote,
        { incidentId: null },
        memberWith(NOTE_EDITOR),
      ),
    ).toBe(false);
  });
});

describe("the check DatabaseService asks of every update", () => {
  test("refuses as the permission facade refuses, and passes what it passes", async () => {
    await expect(
      ModelPermission.checkOwnedUpdatePermission({
        modelType: MetricPipelineRule,
        data: { serviceId: new ObjectID(VIEWERS_PARENT) },
        props: memberWith(RULE_EDITOR),
      }),
    ).rejects.toBeInstanceOf(UpdateScopeException);

    await expect(
      ModelPermission.checkOwnedUpdatePermission({
        modelType: MetricPipelineRule,
        data: { serviceId: new ObjectID(EDITORS_PARENT) },
        props: memberWith(RULE_EDITOR),
      }),
    ).resolves.toBeUndefined();
  });

  test("an update limited to owned records is what is asked about", () => {
    expect(
      OwnedScopePermission.isLimitedToOwnedRecords(
        MetricPipelineRule,
        memberWith(RULE_EDITOR),
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
  });
});
