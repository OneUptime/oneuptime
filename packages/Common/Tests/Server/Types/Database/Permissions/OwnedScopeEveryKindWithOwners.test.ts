import DatabaseService from "../../../../../Server/Services/DatabaseService";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import CreateScopeException from "../../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeFeed from "../../../../../Models/DatabaseModels/AlertEpisodeFeed";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeFeed from "../../../../../Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentEpisodeInternalNote from "../../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "../../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeRoleMember from "../../../../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentState from "../../../../../Models/DatabaseModels/IncidentState";
import IncomingCallLog from "../../../../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../../../../Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallPolicy from "../../../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "../../../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import Label from "../../../../../Models/DatabaseModels/Label";
import MonitorGroup from "../../../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import OnCallDutyPolicyScheduleLayer from "../../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import Team from "../../../../../Models/DatabaseModels/Team";
import WorkspaceUserGroup from "../../../../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { OwnedThroughMetadata } from "../../../../../Types/Database/AccessControl/OwnedThrough";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  isReadByEveryReader,
  KINDS_READ_BY_EVERY_READER,
} from "../../../TestingUtils/OwnedScopeKinds";
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

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * EVERY KIND OF RECORD WITH OWNERS IS NARROWED BY THE OWNED SCOPE.
 *
 * A team's permission scoped to Owned "only applies to resources where this
 * team, or the user acting, is listed as an owner" (permissions docs). The
 * scope knows which kinds carry owners from OwnerTableRegistry alone, so a
 * kind with owner tables (<Kind>OwnerUser and <Kind>OwnerTeam: an Owners
 * tab) that the registry left out would not be narrowed at all - not its
 * reads, changes or deletes, nor the adding and removing of its owners.
 * This sweeps every model and holds that rule:
 *
 *   - every kind with owner tables is in the registry, with both of them
 *     and the column they name it by; nothing else is;
 *   - the kinds other records are set up with - a probe, a runner, an AI
 *     agent, a template, an on-call schedule - are read by every reader of
 *     them, whatever the scope (TestingUtils/OwnedScopeKinds pins them, each
 *     with its reason), and so are the records that take their owners from
 *     them; every other kind with owners is narrowed on reads as well;
 *   - a member whose every grant on a kind is scoped to Owned creates one
 *     only as a person, who becomes its owner, and changes and deletes only
 *     the ones they or their teams own (OwnedRecordsDeleteEveryKind sweeps
 *     the reads, changes and deletes of every kind);
 *   - the records that are part of one of those kinds - a schedule's layers,
 *     the people in them and its shared calendar link, an incoming call
 *     policy's escalation rules and the calls it took, an episode's notes,
 *     state changes, feed and role members - take their owners from it:
 *     they are created, changed and deleted only on the ones the member
 *     owns, and read as the kind is.
 *
 * What the member owns is stubbed; OwnedRecordsDeletePostgres runs the rule
 * against Postgres, through the routes.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PROJECT_ID: ObjectID = new ObjectID(
  "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const USER_ID: ObjectID = new ObjectID("2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a");
const TEAM_ID: ObjectID = new ObjectID("3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b");

// The record (or the record it belongs to) the member owns, another, and one being created.
const OWNED_ID: string = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const OTHER_ID: string = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";
const PENDING_ID: string = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";

// What the Owned scope narrows a query to when nothing is owned.
const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

const OWNER_TABLE_NAME: RegExp = /^(.+)Owner(User|Team)$/;

/*
 * Kinds with owner tables the registry may leave out, by name, each with
 * why. Empty: every kind with owners is narrowed. A kind may be added only
 * with a reason a reviewer accepts - its records are then reachable by every
 * grant scoped to Owned - and the list may only shrink.
 */
const LEFT_OUT_OF_THE_REGISTRY: Record<string, string> = {};

/*
 * The records that are part of a kind with owners and take their owners
 * from it (@OwnedThrough): the key column that names it, and its model.
 */
interface PartOfAKind {
  modelType: ModelType;
  kind: ModelType;
  fkColumn: string;
}

const PARTS_OF_A_KIND: Array<PartOfAKind> = [
  {
    modelType: OnCallDutyPolicyScheduleLayer,
    kind: OnCallDutyPolicySchedule,
    fkColumn: "onCallDutyPolicyScheduleId",
  },
  {
    modelType: OnCallDutyPolicyScheduleLayerUser,
    kind: OnCallDutyPolicySchedule,
    fkColumn: "onCallDutyPolicyScheduleId",
  },
  {
    modelType: OnCallDutyPolicyScheduleCalendarFeed,
    kind: OnCallDutyPolicySchedule,
    fkColumn: "onCallDutyPolicyScheduleId",
  },
  {
    modelType: IncomingCallPolicyEscalationRule,
    kind: IncomingCallPolicy,
    fkColumn: "incomingCallPolicyId",
  },
  {
    modelType: IncomingCallLog,
    kind: IncomingCallPolicy,
    fkColumn: "incomingCallPolicyId",
  },
  // Who a call rang, at which number: each attempt goes with its call.
  {
    modelType: IncomingCallLogItem,
    kind: IncomingCallPolicy,
    fkColumn: "incomingCallPolicyId",
  },
  {
    modelType: IncidentEpisodeRoleMember,
    kind: IncidentEpisode,
    fkColumn: "incidentEpisodeId",
  },
  // An episode's notes, state changes and feed, as an incident's are.
  {
    modelType: IncidentEpisodeInternalNote,
    kind: IncidentEpisode,
    fkColumn: "incidentEpisodeId",
  },
  {
    modelType: IncidentEpisodePublicNote,
    kind: IncidentEpisode,
    fkColumn: "incidentEpisodeId",
  },
  {
    modelType: IncidentEpisodeStateTimeline,
    kind: IncidentEpisode,
    fkColumn: "incidentEpisodeId",
  },
  {
    modelType: IncidentEpisodeFeed,
    kind: IncidentEpisode,
    fkColumn: "incidentEpisodeId",
  },
  {
    modelType: AlertEpisodeInternalNote,
    kind: AlertEpisode,
    fkColumn: "alertEpisodeId",
  },
  {
    modelType: AlertEpisodeStateTimeline,
    kind: AlertEpisode,
    fkColumn: "alertEpisodeId",
  },
  {
    modelType: AlertEpisodeFeed,
    kind: AlertEpisode,
    fkColumn: "alertEpisodeId",
  },
  /*
   * The monitors a group holds are the group's: they make the status a
   * status page shows for it. Held to the group's owners, not to each
   * monitor's - a member who may read another team's group cannot put a
   * monitor of theirs in it, and the group's owners take out any monitor.
   */
  {
    modelType: MonitorGroupResource,
    kind: MonitorGroup,
    fkColumn: "monitorGroupId",
  },
];

function modelNamed(name: string): ModelType | undefined {
  return MODEL_TYPES.find((modelType: ModelType): boolean => {
    return modelType.name === name;
  });
}

// One owner table of the schema, found by its name, and the kind it owns.
interface OwnerTable {
  modelType: ModelType;
  kind: string;
  // The key column its rows name the kind by, if it names the kind at all.
  fkColumn: string | undefined;
}

function ownerTableOf(modelType: ModelType): OwnerTable {
  const model: BaseModel = new modelType();
  const kind: string = (model.tableName || "").replace(OWNER_TABLE_NAME, "$1");

  let fkColumn: string | undefined = undefined;

  for (const column of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (
      metadata &&
      metadata.type === TableColumnType.Entity &&
      metadata.modelType &&
      (metadata.modelType as ModelType).name === kind
    ) {
      fkColumn = metadata.manyToOneRelationColumn;
    }
  }

  return { modelType: modelType, kind: kind, fkColumn: fkColumn };
}

const OWNER_TABLES: Array<OwnerTable> = MODEL_TYPES.filter(
  (modelType: ModelType): boolean => {
    return OWNER_TABLE_NAME.test(new modelType().tableName || "");
  },
).map(ownerTableOf);

// Every kind that has owner tables, by name.
const KINDS_WITH_OWNER_TABLES: Array<string> = Array.from(
  new Set<string>(
    OWNER_TABLES.map((table: OwnerTable): string => {
      return table.kind;
    }),
  ),
).sort();

// The permissions of a model's list for an operation that a scope limits.
function scopeable(
  modelType: ModelType,
  type: DatabaseRequestType,
): Array<Permission> {
  return TablePermission.getTablePermission(modelType, type).filter(
    (permission: Permission): boolean => {
      return PermissionHelper.isScopeApplicable(permission);
    },
  );
}

function rowsAt(
  permissions: Array<Permission>,
  scope: PermissionScope,
): Array<UserPermission> {
  return Array.from(new Set<Permission>(permissions)).map(
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
}

// A member of the project whose team holds `rows`: a person.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
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

// The same rows held by no person: what an API key's request carries.
function noPersonWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = memberWith(rows);

  delete props.userId;
  delete props.userType;
  delete props.userTeamIds;

  return props;
}

// Every permission a scope limits that creates, reads, changes or deletes a model.
function everyGrantOn(modelType: ModelType): Array<Permission> {
  return [
    DatabaseRequestType.Create,
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ].flatMap((type: DatabaseRequestType): Array<Permission> => {
    return scopeable(modelType, type);
  });
}

// What a create of `modelType` with `data` passes, as DatabaseService asks it.
async function checkCreate(data: {
  modelType: ModelType;
  data: BaseModel;
  props: DatabaseCommonInteractionProps;
  ownedParentIds?: Array<string>;
}): Promise<void> {
  await CreateScopePermission.checkCreateScope({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    ownedParentIds: data.ownedParentIds,
    findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
      return {};
    },
    findLabelNames: async (): Promise<Array<string>> => {
      return [];
    },
  });
}

// Whether a row whose `column` is `value` is one the query reaches.
function reaches(
  query: Dictionary<unknown>,
  column: string,
  value: string | null,
): boolean {
  // The Owned scope's "nothing": the rows' own id held to the zero id.
  if (query["_id"] !== undefined && meetsCondition(query["_id"], ZERO_ID)) {
    return false;
  }

  if (query[column] === undefined) {
    return true;
  }

  return meetsCondition(query[column], value);
}

// The query a read, a change or a delete of `modelType` runs with.
async function recordScopeOf(
  modelType: ModelType,
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
): Promise<Dictionary<unknown>> {
  if (type === DatabaseRequestType.Delete) {
    return (await DeletePermission.checkDeletePermission(
      modelType,
      {},
      props,
    )) as Dictionary<unknown>;
  }

  TablePermission.checkTableLevelPermissions(modelType, props, type);

  return (await BasePermission.addRecordScopeToQuery(
    modelType,
    {},
    null,
    props,
    type,
  )) as Dictionary<unknown>;
}

// What the member owns: OWNED_ID, of every kind.
function ownsOnly(id: string): void {
  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockResolvedValue([new ObjectID(id)] as never);
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every kind with owners is one the Owned scope narrows", () => {
  test("the sweep finds the owner tables of every kind with owners", () => {
    expect(OWNER_TABLES.length).toBeGreaterThanOrEqual(74);
    expect(KINDS_WITH_OWNER_TABLES.length).toBe(OWNER_TABLES.length / 2);

    for (const kind of [
      "Monitor",
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
    ]) {
      expect([kind, KINDS_WITH_OWNER_TABLES.includes(kind)]).toEqual([
        kind,
        true,
      ]);
    }
  });

  test("every kind with owner tables is in OwnerTableRegistry, but the ones left out with a reason", () => {
    const missing: Array<string> = KINDS_WITH_OWNER_TABLES.filter(
      (kind: string): boolean => {
        return (
          !OwnerTableRegistry.has(kind) &&
          !Object.prototype.hasOwnProperty.call(LEFT_OUT_OF_THE_REGISTRY, kind)
        );
      },
    ).map((kind: string): string => {
      return `${kind} has owner tables but is not in OwnerTableRegistry: a grant scoped to Owned would reach every one of them. Register it, and decide whether its readers all read it (OwnerTablePair.ownedScopeLeavesReads).`;
    });

    expect(missing).toEqual([]);
  });

  test("the kinds left out of the registry are still left out, each for its reason: the list only shrinks", () => {
    for (const [kind, reason] of Object.entries(LEFT_OUT_OF_THE_REGISTRY)) {
      expect([kind, KINDS_WITH_OWNER_TABLES.includes(kind)]).toEqual([
        kind,
        true,
      ]);
      expect([kind, OwnerTableRegistry.has(kind)]).toEqual([kind, false]);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test("the registry holds the kinds with owner tables and nothing else", () => {
    expect(Array.from(OwnerTableRegistry.keys()).sort()).toEqual(
      KINDS_WITH_OWNER_TABLES.filter((kind: string): boolean => {
        return !Object.prototype.hasOwnProperty.call(
          LEFT_OUT_OF_THE_REGISTRY,
          kind,
        );
      }),
    );
  });

  test.each(KINDS_WITH_OWNER_TABLES)(
    "%s: the registry reads its owners from both of its owner tables, by the column they name it by",
    (kind: string) => {
      const pair: OwnerTablePair = OwnerTableRegistry.get(kind)!;
      const userTable: OwnerTable = OWNER_TABLES.find(
        (table: OwnerTable): boolean => {
          return table.modelType.name === `${kind}OwnerUser`;
        },
      )!;
      const teamTable: OwnerTable = OWNER_TABLES.find(
        (table: OwnerTable): boolean => {
          return table.modelType.name === `${kind}OwnerTeam`;
        },
      )!;

      expect(pair).toBeDefined();
      expect(Boolean(modelNamed(kind))).toBe(true);
      expect(pair.ownerUserService.modelType).toBe(userTable.modelType);
      expect(pair.ownerTeamService.modelType).toBe(teamTable.modelType);
      expect(userTable.fkColumn).toBe(pair.fkColumn);
      expect(teamTable.fkColumn).toBe(pair.fkColumn);
    },
  );
});

describe("what every reader of a kind reads in full", () => {
  test("the kinds whose readers all read them are exactly the pinned ones, each with its reason", () => {
    const flagged: Array<string> = Array.from(OwnerTableRegistry.entries())
      .filter(([, pair]: [string, OwnerTablePair]): boolean => {
        return Boolean(pair.ownedScopeLeavesReads);
      })
      .map(([kind]: [string, OwnerTablePair]): string => {
        return kind;
      })
      .sort();

    expect(flagged).toEqual(Object.keys(KINDS_READ_BY_EVERY_READER).sort());

    for (const reason of Object.values(KINDS_READ_BY_EVERY_READER)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test.each(Array.from(OwnerTableRegistry.keys()))(
    "%s: the Owned scope leaves its reads alone only if it is one other records are set up with",
    (kind: string) => {
      expect(OwnedScopePermission.leavesReadsAlone(modelNamed(kind)!)).toBe(
        isReadByEveryReader(kind),
      );
    },
  );

  test.each(OWNER_TABLES)(
    "$modelType.name: read as its $kind is",
    (table: OwnerTable) => {
      expect(OwnedScopePermission.leavesReadsAlone(table.modelType)).toBe(
        isReadByEveryReader(table.kind),
      );
    },
  );

  test("a record that takes its owners from a kind is read as the kind is, and one owned through several kinds only when all of them are", () => {
    for (const modelType of MODEL_TYPES) {
      const ownedThrough: OwnedThroughMetadata | null = new modelType()
        .ownedThrough;

      if (!ownedThrough) {
        continue;
      }

      const parents: Array<string> = ownedThrough.parentModels.map(
        (parentModel: unknown): string => {
          return (parentModel as ModelType).name;
        },
      );

      expect([
        modelType.name,
        OwnedScopePermission.leavesReadsAlone(modelType),
      ]).toEqual([
        modelType.name,
        parents.every((parent: string): boolean => {
          return isReadByEveryReader(parent);
        }),
      ]);
    }

    // The schedule's own records, by name.
    for (const modelType of [
      OnCallDutyPolicyScheduleLayer,
      OnCallDutyPolicyScheduleLayerUser,
      OnCallDutyPolicyScheduleCalendarFeed,
    ]) {
      expect([
        modelType.name,
        OwnedScopePermission.leavesReadsAlone(modelType),
      ]).toEqual([modelType.name, true]);
    }

    /*
     * And the records of a kind that is narrowed: a monitor's probes are
     * read as the monitor is, though they name a probe.
     */
    for (const modelType of [
      IncomingCallPolicyEscalationRule,
      IncomingCallLog,
      IncidentEpisodeRoleMember,
      MonitorGroupResource,
      MonitorProbe,
      OnCallDutyPolicyEscalationRuleSchedule,
    ]) {
      expect([
        modelType.name,
        OwnedScopePermission.leavesReadsAlone(modelType),
      ]).toEqual([modelType.name, false]);
    }
  });

  test("a record of no kind with owners has nothing for the scope to narrow, and no reads it leaves alone", () => {
    for (const modelType of [
      Label,
      Team,
      IncidentState,
      WorkspaceUserGroup,
    ] as Array<ModelType>) {
      expect([
        modelType.name,
        OwnedScopePermission.leavesReadsAlone(modelType),
        OwnedScopePermission.hasOwnerTables(modelType),
        OwnedScopePermission.getOwnedThrough(modelType),
      ]).toEqual([modelType.name, false, false, null]);
    }
  });

  test("a kind taken out of the registry is read as before it was in it: by its readers' scope", () => {
    const pair: OwnerTablePair = OwnerTableRegistry.get("Probe")!;

    try {
      OwnerTableRegistry.delete("Probe");

      expect(OwnedScopePermission.leavesReadsAlone(modelNamed("Probe")!)).toBe(
        false,
      );
      expect(
        OwnedScopePermission.isLimitedToOwnedRecords(
          modelNamed("Probe")!,
          memberWith(
            rowsAt(everyGrantOn(modelNamed("Probe")!), PermissionScope.Owned),
          ),
          DatabaseRequestType.Delete,
        ),
      ).toBe(false);
    } finally {
      OwnerTableRegistry.set("Probe", pair);
    }

    expect(OwnedScopePermission.leavesReadsAlone(modelNamed("Probe")!)).toBe(
      true,
    );
  });
});

describe.each(Array.from(OwnerTableRegistry.keys()))(
  "%s, by a member whose every grant on it is scoped to Owned",
  (kind: string) => {
    const kindType: ModelType = modelNamed(kind)!;

    test("creates one only as a person, who becomes its owner - never as a caller no one is", async () => {
      // Creates of the kind that a scope limits.
      const creates: Array<Permission> = scopeable(
        kindType,
        DatabaseRequestType.Create,
      );

      if (creates.length === 0) {
        return;
      }

      const rows: Array<UserPermission> = rowsAt(
        everyGrantOn(kindType),
        PermissionScope.Owned,
      );

      expect(
        CreateScopePermission.getCreateScope(kindType, memberWith(rows))
          .isOwnedOnly,
      ).toBe(true);

      const record: BaseModel = new kindType();
      record.setColumnValue("projectId", PROJECT_ID);

      await expect(
        checkCreate({
          modelType: kindType,
          data: record,
          props: memberWith(rows),
        }),
      ).resolves.toBeUndefined();

      await expect(
        checkCreate({
          modelType: kindType,
          data: record,
          props: noPersonWith(rows),
        }),
      ).rejects.toThrow(
        new CreateScopeException(
          `Your access lets you create only the ${new kindType().pluralName} you own, and only a person can own one.`,
        ),
      );
    });

    test("changes and deletes only the ones they or their teams own; reads only those too, unless every reader reads it", async () => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = memberWith(
        rowsAt(everyGrantOn(kindType), PermissionScope.Owned),
      );

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        if (scopeable(kindType, type).length === 0) {
          continue;
        }

        const query: Dictionary<unknown> = await recordScopeOf(
          kindType,
          props,
          type,
        );

        expect([
          kind,
          type,
          reaches(query, "_id", OWNED_ID),
          reaches(query, "_id", OTHER_ID),
        ]).toEqual([
          kind,
          type,
          true,
          type === DatabaseRequestType.Read && isReadByEveryReader(kind),
        ]);
      }
    });

    test("the same grants over the whole project reach every one", async () => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = memberWith(
        rowsAt(everyGrantOn(kindType), PermissionScope.All),
      );

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        if (scopeable(kindType, type).length === 0) {
          continue;
        }

        expect([
          kind,
          type,
          reaches(await recordScopeOf(kindType, props, type), "_id", OTHER_ID),
        ]).toEqual([kind, type, true]);
      }
    });
  },
);

describe.each(PARTS_OF_A_KIND)(
  "$modelType.name, part of its $kind.name",
  (part: PartOfAKind) => {
    const kindName: string = part.kind.name;

    // The member's every grant on the record and on its kind, at `scope`.
    const grantsAt: (
      scope: PermissionScope,
    ) => DatabaseCommonInteractionProps = (
      scope: PermissionScope,
    ): DatabaseCommonInteractionProps => {
      return memberWith(
        rowsAt(
          [...everyGrantOn(part.modelType), ...everyGrantOn(part.kind)],
          scope,
        ),
      );
    };

    // A record of the part naming `parentId` of its kind.
    const recordOn: (parentId: string) => BaseModel = (
      parentId: string,
    ): BaseModel => {
      const record: BaseModel = new part.modelType();

      record.setColumnValue("projectId", PROJECT_ID);
      record.setColumnValue(part.fkColumn, new ObjectID(parentId));

      return record;
    };

    test("takes its owners from its kind, by the column that names it", () => {
      const ownedThrough: OwnedThroughMetadata | null =
        OwnedScopePermission.getOwnedThrough(part.modelType);

      expect(ownedThrough?.fkColumn).toBe(part.fkColumn);
      expect(ownedThrough?.parentModels).toEqual([part.kind]);
      // Every one of them names its record: none is the project's alone.
      expect(ownedThrough?.includeUnattributed).toBe(false);
      expect(ownedThrough?.includeProjectScope).toBe(false);
      expect(
        new part.modelType().getTableColumnMetadata(part.fkColumn)?.required,
      ).toBe(true);
      expect(OwnerTableRegistry.has(kindName)).toBe(true);

      // The column names a record of that kind, and no other.
      const relation: TableColumnMetadata | undefined = new part.modelType()
        .getTableColumns()
        .columns.map((column: string): TableColumnMetadata | undefined => {
          return new part.modelType().getTableColumnMetadata(column);
        })
        .find((metadata: TableColumnMetadata | undefined): boolean => {
          return Boolean(
            metadata &&
              metadata.type === TableColumnType.Entity &&
              metadata.manyToOneRelationColumn === part.fkColumn,
          );
        });

      expect(relation?.modelType).toBe(part.kind);
    });

    test("a member whose grants are scoped to Owned changes and deletes it only on what they or their teams own, and reads it as its kind is read", async () => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = grantsAt(
        PermissionScope.Owned,
      );

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        if (scopeable(part.modelType, type).length === 0) {
          continue;
        }

        const query: Dictionary<unknown> = await recordScopeOf(
          part.modelType,
          props,
          type,
        );

        expect([
          part.modelType.name,
          type,
          reaches(query, part.fkColumn, OWNED_ID),
          reaches(query, part.fkColumn, OTHER_ID),
        ]).toEqual([
          part.modelType.name,
          type,
          true,
          type === DatabaseRequestType.Read && isReadByEveryReader(kindName),
        ]);
      }
    });

    test("is created only on a record of its kind the member owns, or is creating", async () => {
      if (scopeable(part.modelType, DatabaseRequestType.Create).length === 0) {
        /*
         * Written by OneUptime, or by a Project Owner or Admin, whom no
         * scope narrows: nobody's create to scope.
         */
        expect(
          TablePermission.getTablePermission(
            part.modelType,
            DatabaseRequestType.Create,
          ).filter((permission: Permission): boolean => {
            return (
              permission !== Permission.ProjectOwner &&
              permission !== Permission.ProjectAdmin
            );
          }),
        ).toEqual([]);
        return;
      }

      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = grantsAt(
        PermissionScope.Owned,
      );

      await expect(
        checkCreate({
          modelType: part.modelType,
          data: recordOn(OTHER_ID),
          props,
        }),
      ).rejects.toThrow(
        new CreateScopeException(
          `Your access lets you create ${new part.modelType().pluralName} only for the ${new part.kind().pluralName} you or your teams own.`,
        ),
      );

      await expect(
        checkCreate({
          modelType: part.modelType,
          data: recordOn(OWNED_ID),
          props,
        }),
      ).resolves.toBeUndefined();

      // The one the member is creating with it: theirs once it is saved.
      await expect(
        checkCreate({
          modelType: part.modelType,
          data: recordOn(PENDING_ID),
          props,
          ownedParentIds: [PENDING_ID],
        }),
      ).resolves.toBeUndefined();
    });

    test("the same grants over the whole project reach it on every record of its kind", async () => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = grantsAt(
        PermissionScope.All,
      );

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        if (scopeable(part.modelType, type).length === 0) {
          continue;
        }

        expect([
          part.modelType.name,
          type,
          reaches(
            await recordScopeOf(part.modelType, props, type),
            part.fkColumn,
            OTHER_ID,
          ),
        ]).toEqual([part.modelType.name, type, true]);
      }

      if (scopeable(part.modelType, DatabaseRequestType.Create).length > 0) {
        await expect(
          checkCreate({
            modelType: part.modelType,
            data: recordOn(OTHER_ID),
            props,
          }),
        ).resolves.toBeUndefined();
      }
    });
  },
);

/*
 * WHAT A MEMBER CREATES UNDER AN OWNED GRANT IS THEIRS. A create whose every
 * permission is scoped to Owned goes through only as one its creator will
 * own (CreateScopePermission), and DatabaseService makes the creator its
 * owner straight after the save, before anything else happens to the
 * record (makeCreatorOwnerOrUndo): for every kind with owners, in that
 * kind's own table of people who own it. With the same permission over the
 * whole project nobody is made the owner of a kind that is no operational
 * resource - its owners are set as before, by hand or by owner rules.
 */
describe.each(Array.from(OwnerTableRegistry.keys()))(
  "%s, created by a member",
  (kind: string) => {
    const kindType: ModelType = modelNamed(kind)!;
    const pair: OwnerTablePair = OwnerTableRegistry.get(kind)!;

    // The service's own steps of a create, as DatabaseService.create takes them.
    const service: {
      createReliesOnOwnership: (
        props: DatabaseCommonInteractionProps,
      ) => boolean;
      insertCreatorAsOwner: (
        createdItem: BaseModel,
        props: DatabaseCommonInteractionProps,
      ) => Promise<void>;
    } = new DatabaseService(kindType) as never;

    test("is theirs when every permission to create it is scoped to Owned, and in the kind's own table of owners", async () => {
      if (scopeable(kindType, DatabaseRequestType.Create).length === 0) {
        return;
      }

      const owned: DatabaseCommonInteractionProps = memberWith(
        rowsAt(everyGrantOn(kindType), PermissionScope.Owned),
      );
      const projectWide: DatabaseCommonInteractionProps = memberWith(
        rowsAt(everyGrantOn(kindType), PermissionScope.All),
      );

      expect(OwnedScopePermission.hasOwnerTables(kindType)).toBe(true);
      expect(service.createReliesOnOwnership(owned)).toBe(true);
      expect(service.createReliesOnOwnership(projectWide)).toBe(false);

      const written: Array<BaseModel> = [];

      jest
        .spyOn(pair.ownerUserService, "create")
        .mockImplementation((async (args: { data: BaseModel }) => {
          written.push(args.data);
          return args.data;
        }) as never);

      const record: BaseModel = new (kindType as unknown as {
        new (id: ObjectID): BaseModel;
      })(new ObjectID(PENDING_ID));
      record.setColumnValue("projectId", PROJECT_ID);

      await service.insertCreatorAsOwner(record, owned);

      expect(written).toHaveLength(1);
      expect(written[0]!).toBeInstanceOf(pair.ownerUserService.modelType);
      expect(written[0]!.getColumnValue(pair.fkColumn)?.toString()).toBe(
        PENDING_ID,
      );
      expect(written[0]!.getColumnValue("userId")?.toString()).toBe(
        USER_ID.toString(),
      );
      expect(written[0]!.getColumnValue("projectId")?.toString()).toBe(
        PROJECT_ID.toString(),
      );
    });
  },
);

/*
 * WHAT NAMES ONE OF THESE KINDS FOLLOWS ITS OWNERS, OR SAYS WHY IT IS LEFT
 * AS IT IS.
 *
 * The kinds swept here, and the records that take their owners from one of
 * them (@OwnedThrough). A model whose records name one of them is a kind
 * with owners itself, an owner table, takes its owners from a record
 * (@OwnedThrough), or is read through one (@CanAccessIfCanReadOn): the Owned
 * scope reaches it either way. Any other is listed below, by the column that
 * names the kind, with why it is left as it is - it picks a record of the
 * kind, which reading it allows, or it logs what OneUptime sent. A new model
 * that names one of these kinds and follows no owners fails here until it
 * does, or is listed with its reason; the list may only shrink, each entry
 * a line the sweep still finds.
 */
const KINDS_WHOSE_NAMERS_ARE_SWEPT: Array<string> = [
  "AlertEpisode",
  "IncidentEpisode",
  "MonitorGroup",
  "IncomingCallPolicy",
  "OnCallDutyPolicySchedule",
  "IncidentTemplate",
  "ScheduledMaintenanceTemplate",
  "Probe",
  "Runner",
  "AIAgent",
];

const PICKS_A_PROBE: string =
  "picks the probe it runs on: probes are read in full, so they can be picked";
const PICKS_RUNNERS: string =
  "picks the Runners it is handed to: Runners are read in full, so they can be picked";
const LOGS_A_NOTIFICATION: string =
  "a log of what OneUptime sent, written by OneUptime alone";

const NAMES_A_KIND_AS_IT_IS: Record<string, string> = {
  "AIAgentTaskPullRequest.aiAgent":
    "a pull request an AI agent's task opened: AI agents are read in full",
  "AutoRemediationRule.commandRunners": PICKS_RUNNERS,
  "AutoRemediationRule.runner":
    "picks the Runner OneUptime AI runs the rule's commands on: Runners are read in full, so they can be picked",
  "CallLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "CodeRepository.runner":
    "picks the Runner AI works in the repository on: Runners are read in full, so they can be picked",
  "EmailLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "NetworkDeviceDiagnostic.probe": PICKS_A_PROBE,
  "NetworkDeviceDiscoveryScan.probe": PICKS_A_PROBE,
  "NetworkSite.probe": PICKS_A_PROBE,
  "DataSecurityScan.probe": PICKS_A_PROBE,
  "PacketCapture.probe": PICKS_A_PROBE,
  "PushNotificationLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "RunbookVariable.runners": PICKS_RUNNERS,
  "RunnerJob.targetAgent":
    "work handed to a Runner, read with the runbook run or the AI run it is for",
  "SmsLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "TelegramLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "UserOnCallShiftReminderLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "VMwareVCenterConnectionTest.probe": PICKS_A_PROBE,
  "WebhookLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "WhatsAppLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "WorkspaceNotificationLog.alertEpisode": LOGS_A_NOTIFICATION,
  "WorkspaceNotificationLog.incidentEpisode": LOGS_A_NOTIFICATION,
  "WorkspaceNotificationLog.onCallDutyPolicySchedule": LOGS_A_NOTIFICATION,
  "WorkspaceUserGroup.onCallDutyPolicySchedules":
    "a Slack or Microsoft Teams user group kept in step with schedules: an integration setting that changes nothing about them",
};

// Whether the Owned scope reaches a model's records by owners of some record.
function followsOwners(modelType: ModelType): boolean {
  return Boolean(
    OwnerTableRegistry.has(modelType.name) ||
      OwnedScopePermission.getOwnedThrough(modelType) ||
      new modelType().canAccessIfCanReadOn,
  );
}

// The models whose records are the swept kinds' or take their owners from one.
function sweptKindsAndTheirParts(): Set<ModelType> {
  const kinds: Array<ModelType> = KINDS_WHOSE_NAMERS_ARE_SWEPT.map(
    (name: string): ModelType => {
      return modelNamed(name)!;
    },
  );

  return new Set<ModelType>([
    ...kinds,
    ...MODEL_TYPES.filter((modelType: ModelType): boolean => {
      const parents: Array<unknown> =
        OwnedScopePermission.getOwnedThrough(modelType)?.parentModels || [];

      return (
        parents.length > 0 &&
        parents.every((parent: unknown): boolean => {
          return kinds.includes(parent as ModelType);
        })
      );
    }),
  ]);
}

// Every `Model.column` naming a swept record, of a model that follows no owners.
function namersFollowingNoOwners(): Array<string> {
  const swept: Set<ModelType> = sweptKindsAndTheirParts();
  const lines: Array<string> = [];

  for (const modelType of MODEL_TYPES) {
    if (followsOwners(modelType)) {
      continue;
    }

    const model: BaseModel = new modelType();

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (
        metadata &&
        (metadata.type === TableColumnType.Entity ||
          metadata.type === TableColumnType.EntityArray) &&
        swept.has(metadata.modelType as ModelType)
      ) {
        lines.push(`${modelType.name}.${column}`);
      }
    }
  }

  return lines.sort();
}

describe("what names one of these kinds follows its owners, or is left as it is with a reason", () => {
  test("the swept kinds are kinds with owners, and their parts are found", () => {
    for (const name of KINDS_WHOSE_NAMERS_ARE_SWEPT) {
      expect([name, OwnerTableRegistry.has(name)]).toEqual([name, true]);
    }

    const swept: Set<ModelType> = sweptKindsAndTheirParts();

    for (const part of PARTS_OF_A_KIND) {
      expect([part.modelType.name, swept.has(part.modelType)]).toEqual([
        part.modelType.name,
        true,
      ]);
    }
  });

  test("every model naming a swept kind, or one of its parts, follows owners - but the ones left as they are, each with its reason", () => {
    expect(namersFollowingNoOwners()).toEqual(
      Object.keys(NAMES_A_KIND_AS_IT_IS).sort(),
    );
  });

  test("an attempt to reach someone during a call follows its call's policy, by the policy the call names", () => {
    expect(followsOwners(IncomingCallLogItem)).toBe(true);
    expect(
      OwnedScopePermission.getOwnedThrough(IncomingCallLogItem)?.parentModels,
    ).toEqual([IncomingCallPolicy]);
    expect(namersFollowingNoOwners()).not.toContain(
      "IncomingCallLogItem.incomingCallLog",
    );
  });

  test("every reason is said, and every entry still names a model and a column", () => {
    for (const [line, reason] of Object.entries(NAMES_A_KIND_AS_IT_IS)) {
      const [modelName, column] = line.split(".");
      const modelType: ModelType | undefined = modelNamed(modelName || "");

      expect([line, Boolean(modelType), reason.length > 20]).toEqual([
        line,
        true,
        true,
      ]);
      expect([
        line,
        Boolean(new modelType!().getTableColumnMetadata(column || "")),
      ]).toEqual([line, true]);
    }
  });
});

/*
 * Routes of their own that hold a record to its update rule before they act
 * as OneUptime: the numbers of an incoming call policy are reserved,
 * attached and released only on a policy the caller may edit
 * (Notification/API/PhoneNumber's assertCanEditIncomingCallPolicy), and a
 * schedule's shared link is published again or rotated only when the
 * caller's change of it reaches it (OnCallCalendarAPI). Both ask the update
 * rule with the caller's props, which keeps a member whose grants are
 * scoped to Owned to what they or their teams own.
 */
describe("the routes that check a record by its update rule keep to the owned ones", () => {
  test("an incoming call policy's numbers: only on the policies the member owns", async () => {
    ownsOnly(OWNED_ID);

    const props: DatabaseCommonInteractionProps = memberWith(
      rowsAt(everyGrantOn(IncomingCallPolicy), PermissionScope.Owned),
    );

    for (const [id, isReached] of [
      [OWNED_ID, true],
      [OTHER_ID, false],
    ] as Array<[string, boolean]>) {
      const query: Dictionary<unknown> =
        (await ModelPermission.checkUpdateQueryPermissions(
          IncomingCallPolicy,
          { _id: id, projectId: PROJECT_ID },
          {},
          props,
        )) as Dictionary<unknown>;

      expect([id, reaches(query, "_id", id)]).toEqual([id, isReached]);
    }
  });

  test("a schedule's shared link: only on the schedules the member owns", async () => {
    ownsOnly(OWNED_ID);

    const props: DatabaseCommonInteractionProps = memberWith(
      rowsAt(
        [
          ...everyGrantOn(OnCallDutyPolicyScheduleCalendarFeed),
          ...everyGrantOn(OnCallDutyPolicySchedule),
        ],
        PermissionScope.Owned,
      ),
    );

    // The change the rotate route makes first, of the link it found.
    const query: Dictionary<unknown> =
      (await ModelPermission.checkUpdateQueryPermissions(
        OnCallDutyPolicyScheduleCalendarFeed,
        { _id: PENDING_ID, projectId: PROJECT_ID },
        { isEnabled: true },
        props,
      )) as Dictionary<unknown>;

    expect(reaches(query, "onCallDutyPolicyScheduleId", OWNED_ID)).toBe(true);
    expect(reaches(query, "onCallDutyPolicyScheduleId", OTHER_ID)).toBe(false);
  });
});
