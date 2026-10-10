import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import DatabaseServerEndpointService from "../../../Server/Services/DatabaseServerEndpointService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyService from "../../../Server/Services/NetworkAlertPolicyService";
import NetworkDeviceAutoImportRuleService from "../../../Server/Services/NetworkDeviceAutoImportRuleService";
import NetworkDeviceOidTemplateService from "../../../Server/Services/NetworkDeviceOidTemplateService";
import NetworkSnmpCredentialProfileService from "../../../Server/Services/NetworkSnmpCredentialProfileService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { idsNamedBy } from "../TestingUtils/QueryConditions";
import {
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayDelete,
} from "../TestingUtils/RowsCallerMayWrite";

/*
 * EACH CHECK OF A DELETE'S ROWS JUDGES THE ROWS THE DELETE REMOVES, AND THE
 * DELETE REMOVES NO OTHER.
 *
 * For each service whose delete hook refuses a delete by what its rows hold
 * (DatabaseService.findRowsAndHoldDeleteToThem), a bulk delete is checked
 * the way the delete path runs it:
 *
 *   - OneUptime's delete, in a window larger than one page and beyond the
 *     first read's (skip 10000, more than LIMIT_MAX rows): the hook reads
 *     the rows in that window, in the request's project - not the first rows
 *     the query matches - refuses when one of them is refused, and holds the
 *     delete to the rows it read;
 *   - a teammate whose permissions reach only some of the rows (a team
 *     limited to some labels, say): a row outside their reach is neither
 *     judged nor removed, while one inside it is judged as any other; and
 *     a teammate who may delete none of them removes none.
 *
 * The rows the teammate may delete are the delete path's own read
 * (keepRowsCallerMayWrite), answered here by stubRowsCallerMayDelete.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const ROW_A: string = "5b000000-0000-4000-8000-00000000000a";
const ROW_B: string = "5b000000-0000-4000-8000-00000000000b";
const ROW_C: string = "5b000000-0000-4000-8000-00000000000c";
const TEAM_ID: ObjectID = new ObjectID("5c000000-0000-4000-8000-000000000001");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000002",
);
const DATABASE_SERVER_ID: ObjectID = new ObjectID(
  "5d000000-0000-4000-8000-000000000001",
);

const TEAMMATE: JSONObject = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("5f000000-0000-4000-8000-000000000001"),
};

// A delete as big as several pages, in a window beyond the first read's.
const BULK_WINDOW: { skip: number; limit: number } = {
  skip: 10000,
  limit: LIMIT_MAX + 50,
};

interface DeleteCase {
  name: string;
  service: DatabaseService<DatabaseBaseModel>;
  /*
   * What a row holds when the check lets the delete through, and when not.
   * A check that looks elsewhere (the devices still using a template, say)
   * refuses ROW_B, the refused row of every test, through `stub`.
   */
  accepted: JSONObject;
  refused: JSONObject;
  // The hook checks only a teammate's delete (OneUptime's is never refused).
  teammateOnly?: boolean;
  // What the check calls besides the service's own reads.
  stub?: () => void;
}

function asService<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<DatabaseBaseModel> {
  return service as unknown as DatabaseService<DatabaseBaseModel>;
}

// Whether the id a check looks something up by is ROW_B's.
function isRowB(id: unknown): boolean {
  return String(id).toLowerCase() === ROW_B.toLowerCase();
}

const MEASUREMENT_CASE: Omit<DeleteCase, "name" | "service"> = {
  accepted: { name: "Customer impact", isSystemDefined: false },
  refused: { name: "Time to acknowledge", isSystemDefined: true },
};

const CASES: Array<DeleteCase> = [
  {
    name: "IncidentRoleService: a required role is not deleted",
    service: asService(IncidentRoleService),
    accepted: { name: "Scribe", isDeleteable: true },
    refused: { name: "Incident Commander", isDeleteable: false },
  },
  {
    name: "IncidentMeasurementService: a built-in measurement is not deleted",
    service: asService(IncidentMeasurementService),
    ...MEASUREMENT_CASE,
  },
  {
    name: "AlertMeasurementService: a built-in measurement is not deleted",
    service: asService(AlertMeasurementService),
    ...MEASUREMENT_CASE,
  },
  {
    name: "ScheduledMaintenanceMeasurementService: a built-in measurement is not deleted",
    service: asService(ScheduledMaintenanceMeasurementService),
    ...MEASUREMENT_CASE,
  },
  {
    name: "TeamService: a critical team is not deleted",
    service: asService(TeamService),
    accepted: { name: "Engineering", isTeamDeleteable: true },
    refused: { name: "Owners", isTeamDeleteable: false },
    stub: (): void => {
      jest
        .spyOn(
          TeamService as unknown as {
            assertScimAllowsTeamMutation: () => Promise<void>;
          },
          "assertScimAllowsTeamMutation",
        )
        .mockResolvedValue(undefined as never);
      jest.spyOn(TeamMemberService, "deleteBy").mockResolvedValue(0 as never);
    },
  },
  {
    name: "TeamMemberService: a team that keeps a member is not left with none",
    service: asService(TeamMemberService),
    accepted: {
      teamId: OTHER_TEAM_ID,
      hasAcceptedInvitation: true,
      team: { _id: OTHER_TEAM_ID.toString(), shouldHaveAtLeastOneMember: false },
    },
    // The only accepted member of a team that keeps one.
    refused: {
      teamId: TEAM_ID,
      hasAcceptedInvitation: true,
      team: { _id: TEAM_ID.toString(), shouldHaveAtLeastOneMember: true },
    },
    stub: (): void => {
      jest
        .spyOn(
          TeamMemberService as unknown as {
            isSCIMPushGroupsEnabled: () => Promise<boolean>;
          },
          "isSCIMPushGroupsEnabled",
        )
        .mockResolvedValue(false as never);
      jest
        .spyOn(TeamMemberService, "countBy")
        .mockResolvedValue(new PositiveNumber(1) as never);
    },
  },
  {
    name: "TeamPermissionService: a permission of a team whose permissions are locked is not deleted",
    service: asService(TeamPermissionService),
    accepted: {
      teamId: OTHER_TEAM_ID,
      permission: Permission.ProjectMember,
      isBlockPermission: false,
      team: { isPermissionsEditable: true },
    },
    refused: {
      teamId: TEAM_ID,
      permission: Permission.ProjectMember,
      isBlockPermission: false,
      team: { isPermissionsEditable: false },
    },
    stub: (): void => {
      jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
    },
  },
  {
    name: "ApiKeyPermissionService: a block the caller could not grant is not removed",
    service: asService(ApiKeyPermissionService),
    accepted: {
      permission: Permission.ProjectMember,
      isBlockPermission: false,
    },
    refused: {
      permission: Permission.ProjectOwner,
      isBlockPermission: true,
    },
    teammateOnly: true,
    stub: (): void => {
      jest
        .spyOn(
          ApiKeyPermissionService as unknown as {
            assertCallerCanGrantPermission: () => void;
          },
          "assertCallerCanGrantPermission",
        )
        .mockImplementation((): void => {
          throw new NotAuthorizedException("Not within the caller's grant.");
        });
    },
  },
  {
    name: "DatabaseServerEndpointService: a database's primary endpoint is not removed",
    service: asService(DatabaseServerEndpointService),
    accepted: {
      databaseServerId: DATABASE_SERVER_ID,
      endpoint: "replica.db.internal",
      isPrimary: false,
    },
    refused: {
      databaseServerId: DATABASE_SERVER_ID,
      endpoint: "primary.db.internal",
      isPrimary: true,
    },
    teammateOnly: true,
    stub: (): void => {
      jest
        .spyOn(DatabaseServerEndpointService, "findEditableDatabaseServer")
        .mockResolvedValue({ _id: DATABASE_SERVER_ID.toString() } as never);
    },
  },
  {
    name: "UserService: a member of a project is not deleted",
    service: asService(UserService),
    accepted: {},
    refused: {},
    stub: (): void => {
      // ROW_B is still a member of a project.
      jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (read: {
        query: JSONObject;
      }): Promise<Array<JSONObject>> => {
        return isRowB(read.query["userId"])
          ? [{ _id: "5e000000-0000-4000-8000-000000000001" }]
          : [];
      }) as never);
    },
  },
  {
    name: "MonitorTemplateService: a template a network alert policy uses is not deleted",
    service: asService(MonitorTemplateService),
    accepted: { templateName: "Ping" },
    refused: { templateName: "Interface status" },
    stub: (): void => {
      // ROW_B is used by a policy.
      jest
        .spyOn(NetworkAlertPolicyService, "findBy")
        .mockImplementation((async (read: {
          query: JSONObject;
        }): Promise<Array<JSONObject>> => {
          return isRowB(read.query["monitorTemplateId"])
            ? [{ name: "Core switches" }]
            : [];
        }) as never);
      jest
        .spyOn(NetworkDeviceAutoImportRuleService, "findBy")
        .mockResolvedValue([] as never);
    },
  },
  {
    name: "NetworkDeviceOidTemplateService: a template devices collect with is not deleted",
    service: asService(NetworkDeviceOidTemplateService),
    accepted: { name: "Generic" },
    refused: { name: "Vendor" },
    stub: (): void => {
      // ROW_B is used by two devices.
      jest
        .spyOn(NetworkDeviceOidTemplateService, "countLinkedDevices")
        .mockImplementation((async (data: {
          templateId: ObjectID;
        }): Promise<number> => {
          return isRowB(data.templateId) ? 2 : 0;
        }) as never);
      jest
        .spyOn(NetworkDeviceAutoImportRuleService, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);
    },
  },
  {
    name: "NetworkSnmpCredentialProfileService: a profile devices use is not deleted",
    service: asService(NetworkSnmpCredentialProfileService),
    accepted: { name: "Read only" },
    refused: { name: "Core" },
    stub: (): void => {
      // ROW_B is used by a device.
      jest
        .spyOn(NetworkSnmpCredentialProfileService, "countLinkedDevices")
        .mockImplementation((async (data: {
          profileId: ObjectID;
        }): Promise<number> => {
          return isRowB(data.profileId) ? 1 : 0;
        }) as never);
      jest
        .spyOn(NetworkSnmpCredentialProfileService, "countLinkedSites")
        .mockResolvedValue(0 as never);
    },
  },
];

function rowOf(
  service: DatabaseService<DatabaseBaseModel>,
  id: string,
  fields: JSONObject,
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new service.modelType();

  Object.assign(row, {
    ...(row.getTenantColumn() ? { projectId: PROJECT_ID } : {}),
    ...fields,
  });
  row._id = id;

  return row;
}

interface Read {
  query: JSONObject;
  skip: number;
  limit: number;
}

/*
 * The service's own reads: a read by `_id` answers the rows of the pool it
 * names, and any other read - the delete's own query, as OneUptime's hook
 * reads it - the whole pool.
 */
function stubReads(
  service: DatabaseService<DatabaseBaseModel>,
  pool: Array<DatabaseBaseModel>,
): jest.SpyInstance {
  return jest.spyOn(service, "findBy").mockImplementation((async (
    findBy: Read,
  ): Promise<Array<DatabaseBaseModel>> => {
    const named: unknown = findBy.query?.["_id"];

    if (named === undefined) {
      return pool;
    }

    const ids: Array<string> = idsNamedBy(named).map((id: string): string => {
      return id.toLowerCase();
    });

    return pool.filter((row: DatabaseBaseModel): boolean => {
      return ids.includes(String(row._id).toLowerCase());
    });
  }) as never);
}

function deleteOf(
  props: JSONObject,
  window: { skip: number; limit: number },
): DeleteBy<DatabaseBaseModel> {
  return {
    query: {},
    props: props as unknown as DatabaseCommonInteractionProps,
    skip: window.skip,
    limit: window.limit,
  } as unknown as DeleteBy<DatabaseBaseModel>;
}

async function runHook(
  service: DatabaseService<DatabaseBaseModel>,
  deleteBy: DeleteBy<DatabaseBaseModel>,
): Promise<void> {
  await (
    service as unknown as {
      onBeforeDelete: (deleteBy: DeleteBy<DatabaseBaseModel>) => Promise<void>;
    }
  ).onBeforeDelete(deleteBy);
}

function idsDeleted(deleteBy: DeleteBy<DatabaseBaseModel>): Array<string> {
  return idsNamedBy((deleteBy.query as JSONObject)["_id"])
    .map((id: string): string => {
      return id.toLowerCase();
    })
    .sort();
}

describe.each(CASES)("$name", (deleteCase: DeleteCase) => {
  beforeEach(() => {
    if (deleteCase.stub) {
      deleteCase.stub();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const service: DatabaseService<DatabaseBaseModel> = deleteCase.service;

  if (!deleteCase.teammateOnly) {
    it("reads OneUptime's bulk delete in its own window, in one read, and holds the delete to the rows it read", async () => {
      const findBy: jest.SpyInstance = stubReads(service, [
        rowOf(service, ROW_A, deleteCase.accepted),
        rowOf(service, ROW_C, deleteCase.accepted),
      ]);

      const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(
        { isRoot: true, tenantId: PROJECT_ID },
        BULK_WINDOW,
      );

      await runHook(service, deleteBy);

      const windowReads: Array<Read> = (findBy.mock.calls as Array<[Read]>)
        .filter((call: [Read]): boolean => {
          return call[0].skip === BULK_WINDOW.skip;
        })
        .map((call: [Read]): Read => {
          return call[0];
        });

      // The whole window at once: not cut to one page of it.
      expect(windowReads).toHaveLength(1);
      expect(windowReads[0]!.limit).toBe(BULK_WINDOW.limit);

      // A delete made in a project removes that project's rows only.
      const tenantColumn: string | null = service.getModel().getTenantColumn();

      if (tenantColumn) {
        expect(String(windowReads[0]!.query[tenantColumn])).toBe(
          PROJECT_ID.toString(),
        );
      }

      expect(idsDeleted(deleteBy)).toEqual([ROW_A, ROW_C].sort());
      expect(deleteBy.skip).toBe(0);
      expect(deleteBy.limit).toBe(2);
    });

    it("refuses OneUptime's delete when a row it removes is refused", async () => {
      stubReads(service, [
        rowOf(service, ROW_A, deleteCase.accepted),
        rowOf(service, ROW_B, deleteCase.refused),
      ]);

      await expect(
        runHook(
          service,
          deleteOf({ isRoot: true, tenantId: PROJECT_ID }, BULK_WINDOW),
        ),
      ).rejects.toThrow();
    });
  }

  it("neither judges nor removes a row outside a teammate's reach", async () => {
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, deleteCase.accepted);
    const rowOutOfReach: DatabaseBaseModel = rowOf(
      service,
      ROW_B,
      deleteCase.refused,
    );

    // The teammate may delete A only; B matches the query but is not theirs.
    stubRowsCallerMayDelete(service, () => {
      return [rowA];
    });
    stubReads(service, [rowA, rowOutOfReach]);

    const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(TEAMMATE, {
      skip: 0,
      limit: 100,
    });

    await runHook(service, deleteBy);

    // The rows they may delete were read in the delete's own window.
    const reach: Read = readsOfRowsCallerMayWrite(service)[0] as Read;

    expect(reach.skip).toBe(0);
    expect(reach.limit).toBe(100);

    expect(idsDeleted(deleteBy)).toEqual([ROW_A]);
    expect(deleteBy.limit).toBe(1);
  });

  it("refuses a teammate's delete when a row they may delete is refused", async () => {
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, deleteCase.accepted);
    const rowB: DatabaseBaseModel = rowOf(service, ROW_B, deleteCase.refused);

    stubRowsCallerMayDelete(service, () => {
      return [rowA, rowB];
    });
    stubReads(service, [rowA, rowB]);

    await expect(
      runHook(service, deleteOf(TEAMMATE, { skip: 0, limit: 100 })),
    ).rejects.toThrow();
  });

  it("judges and removes nothing when a teammate may delete none of the rows", async () => {
    stubRowsCallerMayDelete(service, () => {
      return [];
    });
    const findBy: jest.SpyInstance = stubReads(service, [
      rowOf(service, ROW_B, deleteCase.refused),
    ]);

    const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(TEAMMATE, {
      skip: 0,
      limit: 100,
    });

    await runHook(service, deleteBy);

    expect(findBy).not.toHaveBeenCalled();
    expect(idsDeleted(deleteBy)).toEqual([]);
    expect(
      (
        (deleteBy.query as JSONObject)["_id"] as unknown as {
          getSql: (column: string) => string;
        }
      ).getSql("row._id"),
    ).toBe("TRUE = FALSE");
  });
});

describe("TeamService: a delete removes the memberships of the teams it removes, and no other", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("removes only the memberships of the teams within a teammate's reach", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(TeamService);

    jest
      .spyOn(
        TeamService as unknown as {
          assertScimAllowsTeamMutation: () => Promise<void>;
        },
        "assertScimAllowsTeamMutation",
      )
      .mockResolvedValue(undefined as never);
    const deleteMembers: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "deleteBy")
      .mockResolvedValue(0 as never);

    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, {
      name: "Engineering",
      isTeamDeleteable: true,
    });

    stubRowsCallerMayDelete(service, () => {
      return [rowA];
    });
    stubReads(service, [
      rowA,
      rowOf(service, ROW_B, { name: "Support", isTeamDeleteable: true }),
    ]);

    await runHook(service, deleteOf(TEAMMATE, { skip: 0, limit: 100 }));

    expect(deleteMembers).toHaveBeenCalledTimes(1);
    expect(
      idsNamedBy(
        (deleteMembers.mock.calls[0]![0] as { query: JSONObject }).query[
          "teamId"
        ],
      ),
    ).toEqual([ROW_A]);
  });
});

describe("TeamMemberService: one delete of several members is held to the rule several deletes of one are", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses OneUptime's delete of every accepted member of a team that keeps one, in a window beyond the first read's", async () => {
    const service: DatabaseService<DatabaseBaseModel> =
      asService(TeamMemberService);

    jest
      .spyOn(
        TeamMemberService as unknown as {
          isSCIMPushGroupsEnabled: () => Promise<boolean>;
        },
        "isSCIMPushGroupsEnabled",
      )
      .mockResolvedValue(false as never);
    // The team has two accepted members: the two this delete removes.
    jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const member: JSONObject = {
      teamId: TEAM_ID,
      hasAcceptedInvitation: true,
      team: { _id: TEAM_ID.toString(), shouldHaveAtLeastOneMember: true },
    };

    stubReads(service, [
      rowOf(service, ROW_A, member),
      rowOf(service, ROW_B, member),
    ]);

    await expect(
      runHook(
        service,
        deleteOf({ isRoot: true, tenantId: PROJECT_ID }, BULK_WINDOW),
      ),
    ).rejects.toThrow();
  });

  it("lets a teammate remove the member within their reach while the team keeps another", async () => {
    const service: DatabaseService<DatabaseBaseModel> =
      asService(TeamMemberService);

    jest
      .spyOn(
        TeamMemberService as unknown as {
          isSCIMPushGroupsEnabled: () => Promise<boolean>;
        },
        "isSCIMPushGroupsEnabled",
      )
      .mockResolvedValue(false as never);
    jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(2) as never);

    const member: JSONObject = {
      teamId: TEAM_ID,
      hasAcceptedInvitation: true,
      team: { _id: TEAM_ID.toString(), shouldHaveAtLeastOneMember: true },
    };
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, member);

    // B matches the query, but is outside the teammate's reach.
    stubRowsCallerMayDelete(service, () => {
      return [rowA];
    });
    stubReads(service, [rowA, rowOf(service, ROW_B, member)]);

    const deleteBy: DeleteBy<DatabaseBaseModel> = deleteOf(TEAMMATE, {
      skip: 0,
      limit: 100,
    });

    await runHook(service, deleteBy);

    expect(idsDeleted(deleteBy)).toEqual([ROW_A]);
  });
});
