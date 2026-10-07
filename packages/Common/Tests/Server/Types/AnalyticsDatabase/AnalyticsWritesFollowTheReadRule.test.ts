import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Log from "../../../../Models/AnalyticsModels/Log";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AnalyticsQuery from "../../../../Server/Types/AnalyticsDatabase/Query";
import OwnerTableRegistry from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";

/*
 * A CHANGE OR A DELETE OF TELEMETRY KEEPS TO WHAT ITS CALLER MAY READ, as on
 * the database models (BasePermission.addRecordScopeToQuery): the rows of
 * the resources both the operation's own grants and the read's reach -
 * their labels and owners, less what a block with labels on either takes
 * away - in one condition; a caller who may read none of the table's rows
 * changes and deletes none; and a write is made in one project at a time.
 *
 * The real owner table registry and permission rules run; only the
 * Postgres lookups behind the registry's services are answered here.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const READ_LABEL_ID: ObjectID = ObjectID.generate();
const WRITE_LABEL_ID: ObjectID = ObjectID.generate();
const BLOCKED_LABEL_ID: ObjectID = ObjectID.generate();

const READ_SERVICE_ID: ObjectID = ObjectID.generate();
const WRITE_SERVICE_ID: ObjectID = ObjectID.generate();
const BOTH_SERVICE_ID: ObjectID = ObjectID.generate();
const BLOCKED_SERVICE_ID: ObjectID = ObjectID.generate();

interface LookupRequest {
  query: Record<string, unknown>;
}

// Which services carry which label.
const SERVICES_BY_LABEL: Map<string, Array<ObjectID>> = new Map<
  string,
  Array<ObjectID>
>([
  [READ_LABEL_ID.toString(), [READ_SERVICE_ID, BOTH_SERVICE_ID]],
  [WRITE_LABEL_ID.toString(), [WRITE_SERVICE_ID, BOTH_SERVICE_ID]],
  [BLOCKED_LABEL_ID.toString(), [BLOCKED_SERVICE_ID]],
]);

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    scope: data.scope,
    labelIds: data.labelIds || [],
    isBlockPermission: data.isBlockPermission || false,
  };
}

function everywhere(permission: Permission): UserPermission {
  return row(permission, { scope: PermissionScope.All });
}

function labelled(
  permission: Permission,
  labelIds: Array<ObjectID>,
): UserPermission {
  return row(permission, { scope: PermissionScope.Labels, labelIds });
}

function propsFor(
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions,
      },
    },
  };
}

function idsOf(...ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    })
    .sort();
}

function valuesOf(operator: unknown): Array<string> {
  return [...(operator as Includes | IncludesNone).values]
    .map((value: string | ObjectID | number): string => {
      return value.toString();
    })
    .sort();
}

async function deleteQuery(
  props: DatabaseCommonInteractionProps,
  query: AnalyticsQuery<Log> = {},
): Promise<AnalyticsQuery<Log>> {
  return await AnalyticsModelPermission.checkDeletePermission(
    Log,
    query,
    props,
  );
}

async function updateQuery(
  props: DatabaseCommonInteractionProps,
  query: AnalyticsQuery<Log> = {},
): Promise<AnalyticsQuery<Log>> {
  return await AnalyticsModelPermission.checkUpdatePermissions(
    Log,
    query,
    new Log(),
    props,
  );
}

beforeEach(() => {
  for (const [name, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }

    jest.spyOn(entry.ownerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(entry.ownerTeamService, "findBy").mockResolvedValue([]);

    // Only services carry labels here.
    jest.spyOn(entry.modelService, "findBy").mockImplementation((async (
      request: LookupRequest,
    ) => {
      if (name !== "Service") {
        return [];
      }

      const labelIds: Array<ObjectID> =
        (request.query["labels"] as Array<ObjectID>) || [];
      const found: Set<string> = new Set<string>();

      for (const labelId of labelIds) {
        for (const id of SERVICES_BY_LABEL.get(labelId.toString()) || []) {
          found.add(id.toString());
        }
      }

      return Array.from(found).map((id: string) => {
        return { _id: id };
      });
    }) as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A delete of telemetry keeps to what its caller may read", () => {
  test("a delete over the whole project keeps to the resources a read limited to labels reaches", async () => {
    const query: AnalyticsQuery<Log> = await deleteQuery(
      propsFor([
        labelled(Permission.ReadTelemetryServiceLog, [READ_LABEL_ID]),
        everywhere(Permission.DeleteTelemetryServiceLog),
      ]),
    );

    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect(valuesOf(query.primaryEntityId)).toEqual(
      idsOf(READ_SERVICE_ID, BOTH_SERVICE_ID),
    );
    expect(query.projectId).toEqual(PROJECT_ID);
  });

  test("a delete limited to labels keeps to the resources both its labels and the read's reach", async () => {
    const query: AnalyticsQuery<Log> = await deleteQuery(
      propsFor([
        labelled(Permission.ReadTelemetryServiceLog, [READ_LABEL_ID]),
        labelled(Permission.DeleteTelemetryServiceLog, [WRITE_LABEL_ID]),
      ]),
    );

    expect(valuesOf(query.primaryEntityId)).toEqual(idsOf(BOTH_SERVICE_ID));
  });

  test("a block with labels on reading leaves its resources out of a delete", async () => {
    const query: AnalyticsQuery<Log> = await deleteQuery(
      propsFor([
        everywhere(Permission.ReadTelemetryServiceLog),
        everywhere(Permission.DeleteTelemetryServiceLog),
        row(Permission.ReadTelemetryServiceLog, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(query.primaryEntityId).toBeInstanceOf(IncludesNone);
    expect(valuesOf(query.primaryEntityId)).toEqual(idsOf(BLOCKED_SERVICE_ID));
  });

  test("a delete naming a resource outside the read reaches nothing of it", async () => {
    const query: AnalyticsQuery<Log> = await deleteQuery(
      propsFor([
        labelled(Permission.ReadTelemetryServiceLog, [READ_LABEL_ID]),
        everywhere(Permission.DeleteTelemetryServiceLog),
      ]),
      { primaryEntityId: WRITE_SERVICE_ID },
    );

    expect(valuesOf(query.primaryEntityId)).toEqual([
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    ]);
  });

  test("a caller who may delete but not read deletes nothing", async () => {
    await expect(
      deleteQuery(propsFor([everywhere(Permission.DeleteTelemetryServiceLog)])),
    ).rejects.toThrow(
      "changing or deleting a record needs permission to read it too",
    );
  });

  test("a block with no labels on reading takes deleting away", async () => {
    await expect(
      deleteQuery(
        propsFor([
          everywhere(Permission.ReadTelemetryServiceLog),
          everywhere(Permission.DeleteTelemetryServiceLog),
          row(Permission.ReadTelemetryServiceLog, {
            isBlockPermission: true,
          }),
        ]),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a delete across the caller's projects is refused", async () => {
    await expect(
      deleteQuery({
        ...propsFor([
          everywhere(Permission.ReadTelemetryServiceLog),
          everywhere(Permission.DeleteTelemetryServiceLog),
        ]),
        isMultiTenantRequest: true,
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("root deletes in its project and is not narrowed", async () => {
    const query: AnalyticsQuery<Log> = await deleteQuery({
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    expect(query).toEqual({ projectId: PROJECT_ID });
  });
});

describe("An update of telemetry keeps to what its caller may read", () => {
  test("an update limited to labels keeps to its labels inside a read over the whole project", async () => {
    const query: AnalyticsQuery<Log> = await updateQuery(
      propsFor([
        everywhere(Permission.ReadTelemetryServiceLog),
        labelled(Permission.EditTelemetryServiceLog, [WRITE_LABEL_ID]),
      ]),
    );

    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect(valuesOf(query.primaryEntityId)).toEqual(
      idsOf(WRITE_SERVICE_ID, BOTH_SERVICE_ID),
    );
  });

  test("an update over the whole project keeps to the read's labels", async () => {
    const query: AnalyticsQuery<Log> = await updateQuery(
      propsFor([
        labelled(Permission.ReadTelemetryServiceLog, [READ_LABEL_ID]),
        everywhere(Permission.EditTelemetryServiceLog),
      ]),
    );

    expect(valuesOf(query.primaryEntityId)).toEqual(
      idsOf(READ_SERVICE_ID, BOTH_SERVICE_ID),
    );
  });

  test("a block with labels on the update leaves its resources out of it", async () => {
    const query: AnalyticsQuery<Log> = await updateQuery(
      propsFor([
        everywhere(Permission.ReadTelemetryServiceLog),
        everywhere(Permission.EditTelemetryServiceLog),
        row(Permission.EditTelemetryServiceLog, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(query.primaryEntityId).toBeInstanceOf(IncludesNone);
    expect(valuesOf(query.primaryEntityId)).toEqual(idsOf(BLOCKED_SERVICE_ID));
  });

  test("a caller who may update but not read changes nothing", async () => {
    await expect(
      updateQuery(propsFor([everywhere(Permission.EditTelemetryServiceLog)])),
    ).rejects.toThrow(
      "changing or deleting a record needs permission to read it too",
    );
  });

  test("an update across the caller's projects is refused", async () => {
    await expect(
      updateQuery({
        ...propsFor([
          everywhere(Permission.ReadTelemetryServiceLog),
          everywhere(Permission.EditTelemetryServiceLog),
        ]),
        isMultiTenantRequest: true,
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("The resources two scopes both reach", () => {
  const scope: (
    readableIds: Array<ObjectID> | null,
    blockedIds?: Array<ObjectID>,
  ) => TelemetryReadScope = (
    readableIds: Array<ObjectID> | null,
    blockedIds: Array<ObjectID> = [],
  ): TelemetryReadScope => {
    return {
      readableIds: readableIds ? idsOf(...readableIds) : null,
      blockedIds: idsOf(...blockedIds),
    };
  };

  test("two scopes over the whole project reach every resource, less every block", () => {
    expect(
      TelemetryReadScopeUtil.getScopeOfBoth(
        scope(null, [BLOCKED_SERVICE_ID]),
        scope(null, [READ_SERVICE_ID]),
      ),
    ).toEqual({
      readableIds: null,
      blockedIds: expect.arrayContaining(
        idsOf(BLOCKED_SERVICE_ID, READ_SERVICE_ID),
      ),
    });
  });

  test("one scope over the whole project leaves the other's resources, less every block", () => {
    const both: TelemetryReadScope = TelemetryReadScopeUtil.getScopeOfBoth(
      scope(null, [READ_SERVICE_ID]),
      scope([READ_SERVICE_ID, BOTH_SERVICE_ID]),
    );

    expect(both.readableIds).toEqual(idsOf(BOTH_SERVICE_ID));
    expect(both.blockedIds).toEqual(idsOf(READ_SERVICE_ID));
  });

  test("two scopes limited to resources reach the resources on both lists", () => {
    const both: TelemetryReadScope = TelemetryReadScopeUtil.getScopeOfBoth(
      scope([READ_SERVICE_ID, BOTH_SERVICE_ID]),
      scope([WRITE_SERVICE_ID, BOTH_SERVICE_ID]),
    );

    expect(both.readableIds).toEqual(idsOf(BOTH_SERVICE_ID));
    expect(both.blockedIds).toEqual([]);
  });

  test("two scopes with nothing in common reach nothing, never every resource", () => {
    const both: TelemetryReadScope = TelemetryReadScopeUtil.getScopeOfBoth(
      scope([READ_SERVICE_ID]),
      scope([WRITE_SERVICE_ID]),
    );

    expect(both.readableIds).toEqual([]);
  });
});
