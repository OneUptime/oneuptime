import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import { isReadByEveryReader } from "../../../TestingUtils/OwnedScopeKinds";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import PrivateRecordPermission from "../../../../../Server/Types/Database/Permissions/PrivateRecordPermission";

/*
 * A write of an incident, an alert or an episode - or of a part of one - is
 * narrowed to the teams that own it when the record is private
 * (PrivateRecordPermission), with a condition only SQL can answer. Its own
 * suites hold that rule (PrivateRecordPermission, PrivateRecordParts and
 * PrivateRecordOwnerTeamsPostgres); this one holds what the scope, labels
 * and blocks reach beside it, for records that are not private.
 */
beforeEach(() => {
  jest
    .spyOn(PrivateRecordPermission, "addPrivateRecordScopeToQuery")
    .mockImplementation(((_modelType: unknown, query: unknown): unknown => {
      return query;
    }) as never);
});

/*
 * A DELETE BY A CALLER LIMITED TO OWNED RECORDS REACHES ONLY OWNED RECORDS,
 * for every kind of record the Owned scope narrows.
 *
 * A team's permission scoped to Owned "only applies to resources where this
 * team, or the user acting, is listed as an owner" (permissions docs). A
 * read, an update and a delete keep to that one rule
 * (BasePermission.addRecordScopeToQuery, asked by
 * DeletePermission.checkDeletePermission for every delete a caller makes).
 * A delete was once narrowed by labels only, so the scope that kept a
 * member's list and changes to the monitors they or their teams own did not
 * hold for it.
 *
 * This sweeps every kind the Owned scope narrows, and holds the query a
 * delete runs with to the owned records only - for a member holding every
 * permission a scope can limit that lets them delete the kind and read it
 * (and read the record it is read through), each scoped to Owned:
 *
 *   - the kinds with owners of their own (OwnerTableRegistry: monitors,
 *     incidents, alerts, status pages, dashboards, services, hosts, clusters
 *     and the rest), by their id;
 *   - the records that belong to one of them (@OwnedThrough: a monitor's
 *     status timeline, an incident's notes), by the record they belong to;
 *   - the records read through one of them by a key column
 *     (@CanAccessIfCanReadOn: a monitor's owner rows, the resources a status
 *     page shows), by that record.
 *
 * The records the caller owns are stubbed (the owner tables are not read
 * here); RecordScopeCrudPostgres and OwnedRecordsDeletePostgres run the
 * same rule against Postgres, through the routes. The same member with the
 * same permissions over the whole project reaches every record: the scope
 * is what narrows. A kind no permission a scope can limit lets anyone
 * delete is refused to such a member outright.
 *
 * A change keeps to the same records, for every kind, and so does a read -
 * but of the kinds other records are set up with (a probe, a template, an
 * on-call schedule: TestingUtils/OwnedScopeKinds), which every reader of
 * them reads, and of the records that take their owners from those or are
 * read through one of them: a schedule's layers, a probe's owners.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PROJECT_ID: ObjectID = new ObjectID(
  "6a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
);
const USER_ID: ObjectID = new ObjectID("7b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e");
const TEAM_ID: ObjectID = new ObjectID("8c3d4e5f-6a7b-4c8d-ae9f-0a1b2c3d4e5f");

// The record (or the record it belongs to) the caller owns, and another.
const OWNED_ID: string = "9d4e5f6a-7b8c-4d9e-bf0a-1b2c3d4e5f6a";
const OTHER_ID: string = "ae5f6a7b-8c9d-4eaf-8a1b-2c3d4e5f6a7b";

/*
 * Records read through a kind the Owned scope narrows by a list of them
 * (a join table) rather than a key column: their condition is a subquery on
 * the join table, which only Postgres answers. OwnedRecordsDeletePostgres
 * deletes them ("... is deleted only when a status page it is on is one the
 * member or their team owns"). Exact: a new one is added here, with its
 * Postgres test.
 */
const READ_THROUGH_A_LIST: Array<string> = [
  "StatusPageAnnouncement",
  "StatusPageAnnouncementTemplate",
];

function modelNamed(name: string): ModelType {
  const modelType: ModelType | undefined = MODEL_TYPES.find(
    (each: ModelType): boolean => {
      return each.name === name;
    },
  );

  if (!modelType) {
    throw new Error(`No model named ${name}.`);
  }

  return modelType;
}

// The permissions of a model's list for an operation that a scope limits.
function scopeablePermissions(
  modelType: ModelType,
  type: DatabaseRequestType,
): Array<Permission> {
  return TablePermission.getTablePermission(modelType, type).filter(
    (permission: Permission): boolean => {
      return PermissionHelper.isScopeApplicable(permission);
    },
  );
}

// The relation a model is read through (@CanAccessIfCanReadOn), if any.
function readThroughColumnOf(modelType: ModelType): TableColumnMetadata | null {
  const model: BaseModel = new modelType();

  if (!model.canAccessIfCanReadOn) {
    return null;
  }

  const column: TableColumnMetadata | undefined = model.getTableColumnMetadata(
    model.canAccessIfCanReadOn,
  );

  if (
    !column ||
    !column.modelType ||
    (column.type !== TableColumnType.Entity &&
      column.type !== TableColumnType.EntityArray)
  ) {
    return null;
  }

  return column;
}

// A member whose team holds `permissions`, every row at `scope`.
function memberHolding(
  permissions: Array<Permission>,
  scope: PermissionScope,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = Array.from(new Set(permissions)).map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: scope,
      };
    },
  );

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_ID],
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

/*
 * The permissions a scope limits that let a member delete a kind: its own
 * delete and read permissions - a delete needs the read - and the read of
 * the record it is read through.
 */
function grantsToDelete(modelType: ModelType): Array<Permission> {
  const readThrough: TableColumnMetadata | null =
    readThroughColumnOf(modelType);

  return [
    ...scopeablePermissions(modelType, DatabaseRequestType.Delete),
    ...scopeablePermissions(modelType, DatabaseRequestType.Read),
    ...(readThrough
      ? scopeablePermissions(
          readThrough.modelType as ModelType,
          DatabaseRequestType.Read,
        )
      : []),
  ];
}

/*
 * The permissions a scope limits that let a member change a kind: its own
 * update and read permissions - a change needs the read - and the read of
 * the record it is read through.
 */
function grantsToUpdate(modelType: ModelType): Array<Permission> {
  const readThrough: TableColumnMetadata | null =
    readThroughColumnOf(modelType);

  return [
    ...scopeablePermissions(modelType, DatabaseRequestType.Update),
    ...scopeablePermissions(modelType, DatabaseRequestType.Read),
    ...(readThrough
      ? scopeablePermissions(
          readThrough.modelType as ModelType,
          DatabaseRequestType.Read,
        )
      : []),
  ];
}

// The permissions a scope limits that let a member read a kind.
function grantsToRead(modelType: ModelType): Array<Permission> {
  const readThrough: TableColumnMetadata | null =
    readThroughColumnOf(modelType);

  return [
    ...scopeablePermissions(modelType, DatabaseRequestType.Read),
    ...(readThrough
      ? scopeablePermissions(
          readThrough.modelType as ModelType,
          DatabaseRequestType.Read,
        )
      : []),
  ];
}

// The query a change of the kind runs with, after the table check.
async function updateScopeOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Promise<Dictionary<unknown>> {
  TablePermission.checkTableLevelPermissions(
    modelType,
    props,
    DatabaseRequestType.Update,
  );

  return (await BasePermission.addRecordScopeToQuery(
    modelType,
    {},
    null,
    props,
    DatabaseRequestType.Update,
  )) as Dictionary<unknown>;
}

// The query a read of the kind runs with, after the table check.
async function readScopeOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
): Promise<Dictionary<unknown>> {
  TablePermission.checkTableLevelPermissions(
    modelType,
    props,
    DatabaseRequestType.Read,
  );

  return (await BasePermission.addRecordScopeToQuery(
    modelType,
    {},
    null,
    props,
    DatabaseRequestType.Read,
  )) as Dictionary<unknown>;
}

// Whether a row whose `column` is `value` is one the query reaches.
function reaches(
  query: Dictionary<unknown>,
  column: string,
  value: string,
): boolean {
  // No condition on the column: every row is reached.
  if (query[column] === undefined) {
    return true;
  }

  return meetsCondition(query[column], value);
}

interface Kind {
  name: string;
  modelType: ModelType;
  // The column the caller's owned records are found by.
  column: string;
}

const REGISTERED: Array<string> = Array.from(OwnerTableRegistry.keys());

// Kinds with owners of their own, by their id.
const OWNING_KINDS: Array<Kind> = REGISTERED.map((name: string): Kind => {
  return { name: name, modelType: modelNamed(name), column: "_id" };
});

// Records that belong to one of them, by the record they belong to.
const BELONGING_KINDS: Array<Kind> = MODEL_TYPES.filter(
  (modelType: ModelType): boolean => {
    return Boolean(new modelType().ownedThrough);
  },
).map((modelType: ModelType): Kind => {
  return {
    name: modelType.name,
    modelType: modelType,
    column: new modelType().ownedThrough!.fkColumn,
  };
});

// Records read through one of them by a key column, by that record.
const READ_THROUGH_KINDS: Array<Kind> = [];
const READ_THROUGH_A_LIST_FOUND: Array<string> = [];

for (const modelType of MODEL_TYPES) {
  const model: BaseModel = new modelType();
  const column: TableColumnMetadata | null = readThroughColumnOf(modelType);

  if (
    model.ownedThrough ||
    !column ||
    !REGISTERED.includes((column.modelType as ModelType).name)
  ) {
    continue;
  }

  if (column.type === TableColumnType.EntityArray) {
    READ_THROUGH_A_LIST_FOUND.push(modelType.name);
    continue;
  }

  READ_THROUGH_KINDS.push({
    name: modelType.name,
    modelType: modelType,
    column: column.manyToOneRelationColumn!,
  });
}

const EVERY_KIND: Array<Kind> = [
  ...OWNING_KINDS,
  ...BELONGING_KINDS,
  ...READ_THROUGH_KINDS,
];

// Kinds a member may delete with a permission a scope limits.
const DELETABLE_KINDS: Array<Kind> = EVERY_KIND.filter(
  (kind: Kind): boolean => {
    return (
      scopeablePermissions(kind.modelType, DatabaseRequestType.Delete).length >
      0
    );
  },
);

// Kinds nobody deletes but a project owner or admin (or nobody at all).
const NOT_DELETABLE_KINDS: Array<Kind> = EVERY_KIND.filter(
  (kind: Kind): boolean => {
    return !DELETABLE_KINDS.includes(kind);
  },
);

// Kinds a member may change, or read, with a permission a scope limits.
const UPDATABLE_KINDS: Array<Kind> = EVERY_KIND.filter(
  (kind: Kind): boolean => {
    return (
      scopeablePermissions(kind.modelType, DatabaseRequestType.Update).length >
      0
    );
  },
);

const READABLE_KINDS: Array<Kind> = EVERY_KIND.filter((kind: Kind): boolean => {
  return (
    scopeablePermissions(kind.modelType, DatabaseRequestType.Read).length > 0
  );
});

/*
 * Whether every reader of a kind reads all of its records whatever the scope
 * of their grant: a kind other records are set up with
 * (TestingUtils/OwnedScopeKinds), a record that takes its owners only from
 * such kinds, or one read through such a kind.
 */
function isReadByEveryReaderOfIt(kind: Kind): boolean {
  if (OWNING_KINDS.includes(kind)) {
    return isReadByEveryReader(kind.name);
  }

  const model: BaseModel = new kind.modelType();
  const parents: Array<string> = (model.ownedThrough?.parentModels || []).map(
    (parentModel: unknown): string => {
      return (parentModel as ModelType).name;
    },
  );
  const readThrough: TableColumnMetadata | null = readThroughColumnOf(
    kind.modelType,
  );

  if (
    readThrough &&
    REGISTERED.includes((readThrough.modelType as ModelType).name)
  ) {
    parents.push((readThrough.modelType as ModelType).name);
  }

  return (
    parents.length > 0 &&
    parents.every((parent: string): boolean => {
      return isReadByEveryReader(parent);
    })
  );
}

describe("a delete by a caller limited to owned records, every kind the Owned scope narrows", () => {
  beforeEach(() => {
    withLabelJoinTables();

    // What the caller owns: OWNED_ID, of every kind.
    jest
      .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
      .mockResolvedValue([new ObjectID(OWNED_ID)] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the sweep finds the kinds", () => {
    expect(OWNING_KINDS.length).toBeGreaterThanOrEqual(27);
    expect(BELONGING_KINDS.length).toBeGreaterThan(50);
    expect(READ_THROUGH_KINDS.length).toBeGreaterThan(40);

    for (const name of [
      "Monitor",
      "Incident",
      "Alert",
      "StatusPage",
      "MonitorStatusTimeline",
      "MonitorTest",
      "IncidentInternalNote",
      "MonitorOwnerUser",
      "MonitorOwnerTeam",
      "IncidentOwnerTeam",
    ]) {
      expect([
        name,
        DELETABLE_KINDS.some((kind: Kind): boolean => {
          return kind.name === name;
        }),
      ]).toEqual([name, true]);
    }
  });

  test("the records read through a list of owned records are the known ones", () => {
    expect(READ_THROUGH_A_LIST_FOUND.sort()).toEqual(
      [...READ_THROUGH_A_LIST].sort(),
    );
  });

  test.each(DELETABLE_KINDS)(
    "$name: an owned-only grant reaches only the owned records, by $column",
    async (kind: Kind) => {
      const query: Dictionary<unknown> =
        (await DeletePermission.checkDeletePermission(
          kind.modelType,
          {},
          memberHolding(grantsToDelete(kind.modelType), PermissionScope.Owned),
        )) as Dictionary<unknown>;

      expect([kind.name, reaches(query, kind.column, OWNED_ID)]).toEqual([
        kind.name,
        true,
      ]);
      expect([kind.name, reaches(query, kind.column, OTHER_ID)]).toEqual([
        kind.name,
        false,
      ]);
    },
  );

  test.each(DELETABLE_KINDS)(
    "$name: the same grants over the whole project reach every record",
    async (kind: Kind) => {
      const query: Dictionary<unknown> =
        (await DeletePermission.checkDeletePermission(
          kind.modelType,
          {},
          memberHolding(grantsToDelete(kind.modelType), PermissionScope.All),
        )) as Dictionary<unknown>;

      expect([kind.name, reaches(query, kind.column, OTHER_ID)]).toEqual([
        kind.name,
        true,
      ]);
    },
  );

  test("the kinds the Owned scope narrows include every kind with owners, and the records that belong to them", () => {
    expect(OWNING_KINDS.length).toBe(OwnerTableRegistry.size);
    expect(OWNING_KINDS.length).toBeGreaterThanOrEqual(37);

    for (const name of [
      "MonitorGroup",
      "OnCallDutyPolicySchedule",
      "AlertEpisode",
      "IncidentEpisode",
      "IncomingCallPolicy",
      "IncidentTemplate",
      "ScheduledMaintenanceTemplate",
      "Probe",
      "Runner",
      "AIAgent",
      "MonitorGroupOwnerTeam",
      "ProbeOwnerUser",
      "OnCallDutyPolicyScheduleLayer",
      "OnCallDutyPolicyScheduleLayerUser",
      "OnCallDutyPolicyScheduleCalendarFeed",
      "IncomingCallPolicyEscalationRule",
      "IncidentEpisodeRoleMember",
    ]) {
      expect([
        name,
        DELETABLE_KINDS.some((kind: Kind): boolean => {
          return kind.name === name;
        }),
      ]).toEqual([name, true]);
    }
  });

  test.each(NOT_DELETABLE_KINDS)(
    "$name: no grant a scope limits deletes it",
    async (kind: Kind) => {
      await expect(
        DeletePermission.checkDeletePermission(
          kind.modelType,
          {},
          memberHolding(
            [
              ...scopeablePermissions(kind.modelType, DatabaseRequestType.Read),
              ...grantsToDelete(kind.modelType),
            ],
            PermissionScope.Owned,
          ),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );
});

describe("a change by a caller limited to owned records, every kind the Owned scope narrows", () => {
  beforeEach(() => {
    withLabelJoinTables();

    // What the caller owns: OWNED_ID, of every kind.
    jest
      .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
      .mockResolvedValue([new ObjectID(OWNED_ID)] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the sweep finds the kinds a member may change", () => {
    expect(UPDATABLE_KINDS.length).toBeGreaterThan(80);

    for (const name of [
      "Monitor",
      "MonitorGroup",
      "OnCallDutyPolicySchedule",
      "OnCallDutyPolicyScheduleLayer",
      "IncidentTemplate",
      "Probe",
      "Runner",
      "IncomingCallPolicyEscalationRule",
    ]) {
      expect([
        name,
        UPDATABLE_KINDS.some((kind: Kind): boolean => {
          return kind.name === name;
        }),
      ]).toEqual([name, true]);
    }
  });

  test.each(UPDATABLE_KINDS)(
    "$name: an owned-only grant changes only the owned records, by $column",
    async (kind: Kind) => {
      const query: Dictionary<unknown> = await updateScopeOf(
        kind.modelType,
        memberHolding(grantsToUpdate(kind.modelType), PermissionScope.Owned),
      );

      expect([
        kind.name,
        reaches(query, kind.column, OWNED_ID),
        reaches(query, kind.column, OTHER_ID),
      ]).toEqual([kind.name, true, false]);
    },
  );

  test.each(UPDATABLE_KINDS)(
    "$name: the same grants over the whole project change every record",
    async (kind: Kind) => {
      const query: Dictionary<unknown> = await updateScopeOf(
        kind.modelType,
        memberHolding(grantsToUpdate(kind.modelType), PermissionScope.All),
      );

      expect([kind.name, reaches(query, kind.column, OTHER_ID)]).toEqual([
        kind.name,
        true,
      ]);
    },
  );
});

describe("a read by a caller limited to owned records, every kind the Owned scope narrows", () => {
  beforeEach(() => {
    withLabelJoinTables();

    // What the caller owns: OWNED_ID, of every kind.
    jest
      .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
      .mockResolvedValue([new ObjectID(OWNED_ID)] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the kinds every reader reads in full are those other records are set up with, and what belongs to them", () => {
    expect(
      READABLE_KINDS.filter((kind: Kind): boolean => {
        return isReadByEveryReaderOfIt(kind);
      })
        .map((kind: Kind): string => {
          return kind.name;
        })
        .sort(),
    ).toEqual(
      [
        "AIAgent",
        "AIAgentOwnerTeam",
        "AIAgentOwnerUser",
        "IncidentTemplate",
        "IncidentTemplateOwnerTeam",
        "IncidentTemplateOwnerUser",
        "OnCallDutyPolicySchedule",
        "OnCallDutyPolicyScheduleCalendarFeed",
        "OnCallDutyPolicyScheduleLayer",
        "OnCallDutyPolicyScheduleLayerUser",
        "OnCallDutyPolicyScheduleOwnerTeam",
        "OnCallDutyPolicyScheduleOwnerUser",
        "Probe",
        "ProbeOwnerTeam",
        "ProbeOwnerUser",
        "Runner",
        "RunnerOwnerTeam",
        "RunnerOwnerUser",
        "ScheduledMaintenanceTemplate",
        "ScheduledMaintenanceTemplateOwnerTeam",
        "ScheduledMaintenanceTemplateOwnerUser",
      ].sort(),
    );
  });

  test.each(READABLE_KINDS)(
    "$name: an owned-only grant reads only the owned records, by $column - or every one of a kind other records are set up with",
    async (kind: Kind) => {
      const query: Dictionary<unknown> = await readScopeOf(
        kind.modelType,
        memberHolding(grantsToRead(kind.modelType), PermissionScope.Owned),
      );

      expect([
        kind.name,
        reaches(query, kind.column, OWNED_ID),
        reaches(query, kind.column, OTHER_ID),
      ]).toEqual([kind.name, true, isReadByEveryReaderOfIt(kind)]);
    },
  );

  test.each(READABLE_KINDS)(
    "$name: the same grants over the whole project read every record",
    async (kind: Kind) => {
      const query: Dictionary<unknown> = await readScopeOf(
        kind.modelType,
        memberHolding(grantsToRead(kind.modelType), PermissionScope.All),
      );

      expect([kind.name, reaches(query, kind.column, OTHER_ID)]).toEqual([
        kind.name,
        true,
      ]);
    },
  );
});
