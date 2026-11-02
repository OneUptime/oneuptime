import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import CreateScopeException from "../../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission, {
  CreateScope,
} from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "../../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../../Models/DatabaseModels/IncidentOwnerUser";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import Exception from "../../../../../Types/Exception/Exception";
import HeldPermissionsUtil from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
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
 * EACH TEAM'S OWNED GRANT REACHES WHAT THAT TEAM OWNS.
 *
 * A customer reported a member of two teams - one that may change the
 * resources it owns, one that may only view the resources it owns - changing
 * an incident only the viewing team owned. A permission row scoped to Owned
 * is a team's permission on the resources that team owns
 * (UserPermission.teamId), and on the ones the member owns themselves: never
 * on what the member's other teams own. Here, with the owner tables stood in
 * for by a fixed map of who owns what:
 *
 *   - which teams an operation's Owned grants reach (getOwningTeamIds), and
 *     the lists of teams a query is narrowed by (getTeamListsToNarrowBy);
 *   - every combination of read, change and delete grants - none, over the
 *     whole project, or Owned - on two teams, against an independent
 *     statement of the rule: an operation reaches what one of its grants
 *     reaches, and a change or a delete only what a read reaches as well;
 *   - an incident's notes, read through it, follow the incident's grants
 *     team by team;
 *   - a create limited to owned records names a parent the granting team
 *     (or the member) owns - an incident's note, an owner of an incident;
 *   - a column only those who may change a kind read (a Runner's key) is
 *     read on what the teams of those grants own;
 *   - the owner tables are asked about the granting teams only.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c6d",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "4b5c6d7e-8f9a-4b0c-9d1e-2f3a4b5c6d7e",
);

// The member's two teams, and a team they are not on.
const EDITORS: ObjectID = new ObjectID("5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f");
const VIEWERS: ObjectID = new ObjectID("6d7e8f9a-0b1c-4d2e-9f3a-4b5c6d7e8f9a");
const OTHERS: ObjectID = new ObjectID("7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b");

// Incidents, by who owns them.
const OWNED_BY_EDITORS: string = "8f9a0b1c-2d3e-4f4a-9b5c-6d7e8f9a0b1c";
const OWNED_BY_VIEWERS: string = "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const OWNED_BY_BOTH: string = "0b1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e";
const OWNED_BY_MEMBER: string = "1c2d3e4f-5a6b-4c7d-8e8f-9a0b1c2d3e4f";
const OWNED_BY_OTHERS: string = "2d3e4f5a-6b7c-4d8e-9f9a-0b1c2d3e4f5a";
const OWNED_BY_NOBODY: string = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";

const INCIDENTS: Array<string> = [
  OWNED_BY_EDITORS,
  OWNED_BY_VIEWERS,
  OWNED_BY_BOTH,
  OWNED_BY_MEMBER,
  OWNED_BY_OTHERS,
  OWNED_BY_NOBODY,
];

// Who owns each incident: the member, and teams.
const OWNERS: Dictionary<{ member: boolean; teams: Array<ObjectID> }> = {
  [OWNED_BY_EDITORS]: { member: false, teams: [EDITORS] },
  [OWNED_BY_VIEWERS]: { member: false, teams: [VIEWERS] },
  [OWNED_BY_BOTH]: { member: false, teams: [EDITORS, VIEWERS] },
  [OWNED_BY_MEMBER]: { member: true, teams: [] },
  [OWNED_BY_OTHERS]: { member: false, teams: [OTHERS] },
  [OWNED_BY_NOBODY]: { member: false, teams: [] },
};

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

type TeamGrant = "none" | "all" | "owned";

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope | undefined;
    teamId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
    isBlock?: boolean | undefined;
  },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    ...(data.scope ? { scope: data.scope } : {}),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function owned(permission: Permission, teamId: ObjectID): UserPermission {
  return row(permission, { scope: PermissionScope.Owned, teamId: teamId });
}

function everywhere(permission: Permission, teamId: ObjectID): UserPermission {
  return row(permission, { scope: PermissionScope.All, teamId: teamId });
}

// The member, acting in the project with these rows from their teams.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    // Every team they are on: the Owned scope does not read it.
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

// The incidents the member or one of `teamIds` owns.
function ownedBy(teamIds: ReadonlyArray<ObjectID>): Array<ObjectID> {
  const teams: Set<string> = new Set<string>(
    teamIds.map((teamId: ObjectID): string => {
      return teamId.toString();
    }),
  );

  return INCIDENTS.filter((incidentId: string): boolean => {
    const owners: { member: boolean; teams: Array<ObjectID> } =
      OWNERS[incidentId]!;

    return (
      owners.member ||
      owners.teams.some((teamId: ObjectID): boolean => {
        return teams.has(teamId.toString());
      })
    );
  }).map((incidentId: string): ObjectID => {
    return new ObjectID(incidentId);
  });
}

// Every lookup of owned records, and the teams it was asked about.
let lookups: Array<Array<string>> = [];

function sortedIds(ids: ReadonlyArray<ObjectID | string>): Array<string> {
  return ids
    .map((id: ObjectID | string): string => {
      return id.toString();
    })
    .sort();
}

beforeEach(() => {
  lookups = [];
  withLabelJoinTables();

  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockImplementation((async (
      _modelType: { new (): BaseModel },
      _props: DatabaseCommonInteractionProps,
      teamIds: ReadonlyArray<ObjectID>,
    ): Promise<Array<ObjectID>> => {
      lookups.push(sortedIds(teamIds));
      return ownedBy(teamIds);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Whether a record whose `column` is `value` is one the query reaches.
function reaches(
  query: Dictionary<unknown>,
  column: string,
  value: string,
): boolean {
  if (query["_id"] !== undefined && meetsCondition(query["_id"], ZERO_ID)) {
    return false;
  }

  if (query[column] === undefined) {
    return true;
  }

  return meetsCondition(query[column], value);
}

// The query a request of the member's runs with, through the pipeline.
async function scopeOf(
  modelType: { new (): BaseModel },
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
  query: Dictionary<unknown> = {},
): Promise<Dictionary<unknown>> {
  TablePermission.checkTableLevelPermissions(modelType, props, type);

  return (await BasePermission.addRecordScopeToQuery(
    modelType,
    { ...query },
    null,
    props,
    type,
  )) as Dictionary<unknown>;
}

// The incidents a request of the member's reaches, or null when refused.
async function incidentsReached(
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
): Promise<Array<string> | null> {
  let query: Dictionary<unknown>;

  try {
    query = await scopeOf(Incident, props, type);
  } catch (error) {
    expect(error).toBeInstanceOf(Exception);
    return null;
  }

  return INCIDENTS.filter((incidentId: string): boolean => {
    return reaches(query, "_id", incidentId);
  }).sort();
}

// The customer's teams: Project Member on owned, Viewer on owned.
const CUSTOMER_ROWS: Array<UserPermission> = [
  owned(Permission.ProjectMember, EDITORS),
  owned(Permission.Viewer, VIEWERS),
];

describe("which teams an operation's Owned grants reach", () => {
  test("each operation reaches the teams of the rows that grant it", () => {
    const props: DatabaseCommonInteractionProps = memberWith(CUSTOMER_ROWS);

    expect(
      sortedIds(
        OwnedScopePermission.getOwningTeamIds(
          Incident,
          props,
          DatabaseRequestType.Read,
        ),
      ),
    ).toEqual(sortedIds([EDITORS, VIEWERS]));

    for (const type of [
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(
        OwnedScopePermission.isLimitedToOwnedRecords(Incident, props, type),
      ).toBe(true);
      expect(
        sortedIds(OwnedScopePermission.getOwningTeamIds(Incident, props, type)),
      ).toEqual(sortedIds([EDITORS]));
    }
  });

  test("an operation granted over the whole project by one team reaches no team's records in particular", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      owned(Permission.ProjectMember, EDITORS),
      everywhere(Permission.Viewer, VIEWERS),
    ]);

    expect(
      OwnedScopePermission.isLimitedToOwnedRecords(
        Incident,
        props,
        DatabaseRequestType.Read,
      ),
    ).toBe(false);
    expect(
      OwnedScopePermission.getOwningTeamIds(
        Incident,
        props,
        DatabaseRequestType.Read,
      ),
    ).toEqual([]);
    expect(
      sortedIds(
        OwnedScopePermission.getOwningTeamIds(
          Incident,
          props,
          DatabaseRequestType.Update,
        ),
      ),
    ).toEqual(sortedIds([EDITORS]));
  });

  test("a create is never limited to owned records here", () => {
    expect(
      OwnedScopePermission.getOwningTeamIds(
        Incident,
        memberWith(CUSTOMER_ROWS),
        DatabaseRequestType.Create,
      ),
    ).toEqual([]);
  });

  test("an operational resource's wildcard counts with its own team", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      owned(Permission.ReadAllOperationalResources, VIEWERS),
      owned(Permission.EditAllOperationalResources, EDITORS),
    ]);

    expect(
      sortedIds(
        OwnedScopePermission.getOwningTeamIds(
          Incident,
          props,
          DatabaseRequestType.Update,
        ),
      ),
    ).toEqual(sortedIds([EDITORS]));
    expect(
      sortedIds(
        OwnedScopePermission.getOwningTeamIds(
          Incident,
          props,
          DatabaseRequestType.Read,
        ),
      ),
    ).toEqual(sortedIds([VIEWERS]));
  });

  test("a row no team grants reaches only what the member owns", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
    ]);

    expect(
      OwnedScopePermission.isLimitedToOwnedRecords(
        Incident,
        props,
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
    expect(
      OwnedScopePermission.getOwningTeamIds(
        Incident,
        props,
        DatabaseRequestType.Update,
      ),
    ).toEqual([]);
  });

  test("the same team named twice, in any case, is one team", () => {
    expect(
      sortedIds(
        HeldPermissionsUtil.getTeamIdsOfRows([
          owned(Permission.ProjectMember, EDITORS),
          owned(
            Permission.Viewer,
            new ObjectID(EDITORS.toString().toUpperCase()),
          ),
          owned(Permission.Viewer, VIEWERS),
          row(Permission.Viewer, { scope: PermissionScope.Owned }),
        ]),
      ),
    ).toEqual(sortedIds([EDITORS, VIEWERS]));
  });
});

describe("the lists of teams a query is narrowed by", () => {
  test("a list that holds every team of another adds nothing to it", () => {
    expect(
      OwnedScopePermission.getTeamListsToNarrowBy([
        [EDITORS, VIEWERS],
        [EDITORS],
      ]),
    ).toEqual([[EDITORS]]);
    expect(
      OwnedScopePermission.getTeamListsToNarrowBy([
        [EDITORS],
        [EDITORS, VIEWERS],
      ]),
    ).toEqual([[EDITORS]]);
  });

  test("lists of different teams each narrow", () => {
    expect(
      OwnedScopePermission.getTeamListsToNarrowBy([[EDITORS], [VIEWERS]]),
    ).toEqual([[EDITORS], [VIEWERS]]);
  });

  test("two lists of the same teams narrow once", () => {
    expect(
      OwnedScopePermission.getTeamListsToNarrowBy([
        [EDITORS, VIEWERS],
        [VIEWERS, EDITORS],
      ]),
    ).toEqual([[EDITORS, VIEWERS]]);
  });

  test("no team at all - what the member owns - is the narrowest", () => {
    expect(
      OwnedScopePermission.getTeamListsToNarrowBy([[EDITORS], []]),
    ).toEqual([[]]);
    expect(OwnedScopePermission.getTeamListsToNarrowBy([])).toEqual([]);
  });

  test("a list is within another when every team of it is", () => {
    expect(OwnedScopePermission.isTeamListWithin([], [EDITORS])).toBe(true);
    expect(
      OwnedScopePermission.isTeamListWithin([EDITORS], [EDITORS, VIEWERS]),
    ).toBe(true);
    expect(
      OwnedScopePermission.isTeamListWithin([EDITORS, VIEWERS], [EDITORS]),
    ).toBe(false);
    expect(OwnedScopePermission.isTeamListWithin([VIEWERS], [EDITORS])).toBe(
      false,
    );
  });
});

describe("the customer's report, on the record rule", () => {
  test("the member reads what either team owns, and their own", async () => {
    expect(
      await incidentsReached(
        memberWith(CUSTOMER_ROWS),
        DatabaseRequestType.Read,
      ),
    ).toEqual(
      [
        OWNED_BY_EDITORS,
        OWNED_BY_VIEWERS,
        OWNED_BY_BOTH,
        OWNED_BY_MEMBER,
      ].sort(),
    );
  });

  test("the member changes and deletes only what the editors own, and their own", async () => {
    for (const type of [
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect([
        type,
        await incidentsReached(memberWith(CUSTOMER_ROWS), type),
      ]).toEqual([
        type,
        [OWNED_BY_EDITORS, OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
      ]);
    }
  });

  test("the owner tables are asked about the editors only, for a change", async () => {
    await scopeOf(
      Incident,
      memberWith(CUSTOMER_ROWS),
      DatabaseRequestType.Update,
    );

    // The change's read reaches more teams, and adds nothing to it.
    expect(lookups).toEqual([sortedIds([EDITORS])]);
  });

  test("a viewer's Owned grant beside the editors' grant over the whole project", async () => {
    expect(
      await incidentsReached(
        memberWith([
          everywhere(Permission.ProjectMember, EDITORS),
          owned(Permission.Viewer, VIEWERS),
        ]),
        DatabaseRequestType.Update,
      ),
    ).toEqual(INCIDENTS.slice().sort());
  });
});

/*
 * Every combination of read, change and delete grants on two teams, against
 * the rule stated on its own: an operation reaches what one of its grants
 * reaches - everything for a grant over the whole project, what the member
 * and the grant's own team own for an Owned one - and a change or a delete
 * reaches only what a read reaches as well. An operation no grant gives is
 * refused.
 */
describe("every combination of grants on two teams", () => {
  const GRANTS: Array<TeamGrant> = ["none", "all", "owned"];

  const PERMISSIONS: Record<
    | DatabaseRequestType.Read
    | DatabaseRequestType.Update
    | DatabaseRequestType.Delete,
    Permission
  > = {
    [DatabaseRequestType.Read]: Permission.ReadProjectIncident,
    [DatabaseRequestType.Update]: Permission.EditProjectIncident,
    [DatabaseRequestType.Delete]: Permission.DeleteProjectIncident,
  };

  type Operation =
    | DatabaseRequestType.Read
    | DatabaseRequestType.Update
    | DatabaseRequestType.Delete;

  const OPERATIONS: Array<Operation> = [
    DatabaseRequestType.Read,
    DatabaseRequestType.Update,
    DatabaseRequestType.Delete,
  ];

  interface Combination {
    // What each team grants, for each operation.
    editors: Record<Operation, TeamGrant>;
    viewers: Record<Operation, TeamGrant>;
  }

  const combinations: Array<Combination> = [];

  for (const editorsRead of GRANTS) {
    for (const editorsChange of GRANTS) {
      for (const editorsDelete of GRANTS) {
        for (const viewersRead of GRANTS) {
          for (const viewersChange of GRANTS) {
            for (const viewersDelete of GRANTS) {
              combinations.push({
                editors: {
                  [DatabaseRequestType.Read]: editorsRead,
                  [DatabaseRequestType.Update]: editorsChange,
                  [DatabaseRequestType.Delete]: editorsDelete,
                },
                viewers: {
                  [DatabaseRequestType.Read]: viewersRead,
                  [DatabaseRequestType.Update]: viewersChange,
                  [DatabaseRequestType.Delete]: viewersDelete,
                },
              });
            }
          }
        }
      }
    }
  }

  function rowsOf(combination: Combination): Array<UserPermission> {
    const rows: Array<UserPermission> = [];

    for (const [teamId, grants] of [
      [EDITORS, combination.editors],
      [VIEWERS, combination.viewers],
    ] as Array<[ObjectID, Record<Operation, TeamGrant>]>) {
      for (const operation of OPERATIONS) {
        if (grants[operation] === "all") {
          rows.push(everywhere(PERMISSIONS[operation], teamId));
        } else if (grants[operation] === "owned") {
          rows.push(owned(PERMISSIONS[operation], teamId));
        }
      }
    }

    return rows;
  }

  // What one operation's own grants reach, or null when none gives it.
  function grantReach(
    combination: Combination,
    operation: Operation,
  ): Set<string> | null {
    const grants: Array<[ObjectID, TeamGrant]> = [
      [EDITORS, combination.editors[operation]],
      [VIEWERS, combination.viewers[operation]],
    ];

    if (
      grants.every(([, grant]: [ObjectID, TeamGrant]): boolean => {
        return grant === "none";
      })
    ) {
      return null;
    }

    if (
      grants.some(([, grant]: [ObjectID, TeamGrant]): boolean => {
        return grant === "all";
      })
    ) {
      return new Set<string>(INCIDENTS);
    }

    return new Set<string>(
      sortedIds(
        ownedBy(
          grants
            .filter(([, grant]: [ObjectID, TeamGrant]): boolean => {
              return grant === "owned";
            })
            .map(([teamId]: [ObjectID, TeamGrant]): ObjectID => {
              return teamId;
            }),
        ),
      ),
    );
  }

  // What the rule says an operation reaches, or null when it is refused.
  function expectedReach(
    combination: Combination,
    operation: Operation,
  ): Array<string> | null {
    const own: Set<string> | null = grantReach(combination, operation);

    if (!own) {
      return null;
    }

    if (operation === DatabaseRequestType.Read) {
      return Array.from(own).sort();
    }

    const read: Set<string> | null = grantReach(
      combination,
      DatabaseRequestType.Read,
    );

    if (!read) {
      return null;
    }

    return Array.from(own)
      .filter((incidentId: string): boolean => {
        return read.has(incidentId);
      })
      .sort();
  }

  test(`each of the ${combinations.length} combinations reaches what the rule says`, async () => {
    const mismatches: Array<string> = [];

    for (const combination of combinations) {
      const props: DatabaseCommonInteractionProps = memberWith(
        rowsOf(combination),
      );

      for (const operation of OPERATIONS) {
        const expected: Array<string> | null = expectedReach(
          combination,
          operation,
        );
        const actual: Array<string> | null = await incidentsReached(
          props,
          operation,
        );

        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          mismatches.push(
            `${operation} with editors ${JSON.stringify(
              combination.editors,
            )} and viewers ${JSON.stringify(
              combination.viewers,
            )}: expected ${JSON.stringify(expected)}, reached ${JSON.stringify(
              actual,
            )}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe("an incident's notes follow the incident's grants, team by team", () => {
  // A note on each incident, by the incident it is on.
  async function notesReached(
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Array<string> | null> {
    let query: Dictionary<unknown>;

    try {
      query = await scopeOf(IncidentInternalNote, props, type);
    } catch (error) {
      expect(error).toBeInstanceOf(Exception);
      return null;
    }

    return INCIDENTS.filter((incidentId: string): boolean => {
      return reaches(query, "incidentId", incidentId);
    }).sort();
  }

  test("the customer's teams: notes of what either team owns are read, of what the editors own are changed", async () => {
    const props: DatabaseCommonInteractionProps = memberWith(CUSTOMER_ROWS);

    expect(await notesReached(props, DatabaseRequestType.Read)).toEqual(
      [
        OWNED_BY_EDITORS,
        OWNED_BY_VIEWERS,
        OWNED_BY_BOTH,
        OWNED_BY_MEMBER,
      ].sort(),
    );

    for (const type of [
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect([type, await notesReached(props, type)]).toEqual([
        type,
        [OWNED_BY_EDITORS, OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
      ]);
    }
  });

  test("a note permission of one team and an incident read of another reach only what both teams' grants reach", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      owned(Permission.ReadIncidentInternalNote, EDITORS),
      owned(Permission.ReadProjectIncident, VIEWERS),
    ]);

    // Notes of incidents the editors own, of incidents the viewers own.
    expect(await notesReached(props, DatabaseRequestType.Read)).toEqual(
      [OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
    );

    // Two lookups: the notes' own teams, and the incidents' read.
    expect(lookups.sort()).toEqual(
      [sortedIds([EDITORS]), sortedIds([VIEWERS])].sort(),
    );
  });

  test("an Owned grant beside one over the whole project narrows no note", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      everywhere(Permission.IncidentMember, EDITORS),
      owned(Permission.EditProjectIncident, VIEWERS),
    ]);

    /*
     * Incident Member over the whole project reads and changes every note
     * and every incident, so the viewers' Owned grant to change incidents
     * takes nothing away.
     */
    expect(await notesReached(props, DatabaseRequestType.Update)).toEqual(
      INCIDENTS.slice().sort(),
    );
  });

  test("an update of a note keeps to the incidents an Owned change of incidents reaches", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      everywhere(Permission.ReadIncidentInternalNote, EDITORS),
      everywhere(Permission.EditIncidentInternalNote, EDITORS),
      everywhere(Permission.ReadProjectIncident, EDITORS),
      owned(Permission.EditProjectIncident, VIEWERS),
    ]);

    expect(await notesReached(props, DatabaseRequestType.Update)).toEqual(
      [OWNED_BY_VIEWERS, OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
    );
  });
});

describe("a create limited to owned records names what the granting team owns", () => {
  const findRecordLabels: () => Promise<
    Dictionary<Array<string>>
  > = async (): Promise<Dictionary<Array<string>>> => {
    return {};
  };
  const findLabelNames: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    return [];
  };

  async function mayCreate(
    modelType: { new (): BaseModel },
    record: BaseModel,
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    try {
      await CreateScopePermission.checkCreateScope({
        modelType: modelType,
        data: record,
        props: props,
        findRecordLabels: findRecordLabels,
        findLabelNames: findLabelNames,
      });

      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(CreateScopeException);
      return false;
    }
  }

  test("the create's scope names the teams of its grants", () => {
    const scope: CreateScope = CreateScopePermission.getCreateScope(
      IncidentInternalNote,
      memberWith(CUSTOMER_ROWS),
    );

    expect(scope.isOwnedOnly).toBe(true);
    expect(sortedIds(scope.ownedTeamIds)).toEqual(sortedIds([EDITORS]));
  });

  test("a note goes only on an incident the editors or the member own", async () => {
    const created: Array<string> = [];

    for (const incidentId of INCIDENTS) {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.incidentId = new ObjectID(incidentId);
      note.note = "A note";

      if (
        await mayCreate(IncidentInternalNote, note, memberWith(CUSTOMER_ROWS))
      ) {
        created.push(incidentId);
      }
    }

    expect(created.sort()).toEqual(
      [OWNED_BY_EDITORS, OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
    );
  });

  test("an owner is added only to an incident the editors or the member own", async () => {
    for (const [modelType, make] of [
      [
        IncidentOwnerTeam,
        (incidentId: string): BaseModel => {
          const ownerRow: IncidentOwnerTeam = new IncidentOwnerTeam();
          ownerRow.incidentId = new ObjectID(incidentId);
          ownerRow.teamId = EDITORS;
          return ownerRow;
        },
      ],
      [
        IncidentOwnerUser,
        (incidentId: string): BaseModel => {
          const ownerRow: IncidentOwnerUser = new IncidentOwnerUser();
          ownerRow.incidentId = new ObjectID(incidentId);
          ownerRow.userId = MEMBER_ID;
          return ownerRow;
        },
      ],
    ] as Array<[{ new (): BaseModel }, (incidentId: string) => BaseModel]>) {
      const added: Array<string> = [];

      for (const incidentId of INCIDENTS) {
        if (
          await mayCreate(
            modelType,
            make(incidentId),
            memberWith(CUSTOMER_ROWS),
          )
        ) {
          added.push(incidentId);
        }
      }

      expect([new modelType().tableName, added.sort()]).toEqual([
        new modelType().tableName,
        [OWNED_BY_EDITORS, OWNED_BY_BOTH, OWNED_BY_MEMBER].sort(),
      ]);
    }
  });

  test("an owner is added anywhere with a grant to add owners over the whole project", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      owned(Permission.ProjectMember, EDITORS),
      everywhere(Permission.CreateIncidentOwnerTeam, VIEWERS),
    ]);

    for (const incidentId of INCIDENTS) {
      const ownerRow: IncidentOwnerTeam = new IncidentOwnerTeam();
      ownerRow.incidentId = new ObjectID(incidentId);
      ownerRow.teamId = EDITORS;

      expect([
        incidentId,
        await mayCreate(IncidentOwnerTeam, ownerRow, props),
      ]).toEqual([incidentId, true]);
    }
  });
});

describe("a column only those who may change a kind read follows the teams of those grants", () => {
  // A Runner the editors own, and one the viewers own.
  const EDITORS_RUNNER: string = OWNED_BY_EDITORS;
  const VIEWERS_RUNNER: string = OWNED_BY_VIEWERS;

  test("the key is read on the Runners the team of the grant to change them owns", async () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      owned(Permission.RunbookAdmin, EDITORS),
      owned(Permission.RunbookViewer, VIEWERS),
    ]);

    expect(
      OwnedScopePermission.getColumnsKeptToOwnersWithTeams(Runner, props).map(
        (kept: { column: string; teamIds: Array<ObjectID> }) => {
          return [kept.column, sortedIds(kept.teamIds)];
        },
      ),
    ).toEqual([["key", sortedIds([EDITORS])]]);

    const runners: Array<Runner> = [EDITORS_RUNNER, VIEWERS_RUNNER].map(
      (id: string): Runner => {
        const runner: Runner = new Runner();
        runner._id = id;
        runner.key = `key of ${id}`;
        return runner;
      },
    );

    await OwnedScopePermission.withholdColumnsKeptToOwners({
      modelType: Runner,
      rows: runners,
      select: { _id: true, key: true },
      props: props,
    });

    expect(
      runners.map((runner: Runner): [string, string | undefined] => {
        return [runner._id!.toString(), runner.key];
      }),
    ).toEqual([
      [EDITORS_RUNNER, `key of ${EDITORS_RUNNER}`],
      [VIEWERS_RUNNER, undefined],
    ]);
  });

  test("a filter on the key reaches only the Runners the team of the grant owns", async () => {
    const query: Dictionary<unknown> = await scopeOf(
      Runner,
      memberWith([
        owned(Permission.RunbookAdmin, EDITORS),
        owned(Permission.RunbookViewer, VIEWERS),
      ]),
      DatabaseRequestType.Read,
      { key: "a guess" },
    );

    expect(lookups).toEqual([sortedIds([EDITORS])]);
    expect(reaches(query, "_id", EDITORS_RUNNER)).toBe(true);
    expect(reaches(query, "_id", VIEWERS_RUNNER)).toBe(false);
  });
});

describe("the owner tables are asked about the granting teams only", () => {
  let userQueries: Array<Dictionary<unknown>> = [];
  let teamQueries: Array<Dictionary<unknown>> = [];

  beforeEach(() => {
    userQueries = [];
    teamQueries = [];

    // The real lookup this time: the owner tables are stood in for.
    (
      OwnedScopePermission as unknown as {
        getAllowedResourceIds: SpyInstance<(...args: never) => never>;
      }
    ).getAllowedResourceIds.mockRestore();

    const pair: OwnerTablePair = OwnerTableRegistry.get("Incident")!;

    jest
      .spyOn(pair.ownerUserService, "findBy")
      .mockImplementation((async (data: {
        query: Dictionary<unknown>;
      }): Promise<Array<BaseModel>> => {
        userQueries.push(data.query);
        return [];
      }) as never);

    jest
      .spyOn(pair.ownerTeamService, "findBy")
      .mockImplementation((async (data: {
        query: Dictionary<unknown>;
      }): Promise<Array<BaseModel>> => {
        teamQueries.push(data.query);
        return [];
      }) as never);
  });

  // The team ids an owner-team lookup asked about.
  function teamsAskedAbout(query: Dictionary<unknown>): Array<string> {
    const condition: unknown = query["teamId"];

    return [EDITORS, VIEWERS, OTHERS]
      .filter((teamId: ObjectID): boolean => {
        return meetsCondition(condition, teamId.toString());
      })
      .map((teamId: ObjectID): string => {
        return teamId.toString();
      })
      .sort();
  }

  test("a change asks about the editors, never the viewers", async () => {
    await scopeOf(
      Incident,
      memberWith(CUSTOMER_ROWS),
      DatabaseRequestType.Update,
    );

    expect(userQueries).toHaveLength(1);
    expect(String(userQueries[0]!["userId"])).toBe(MEMBER_ID.toString());
    expect(teamQueries.map(teamsAskedAbout)).toEqual([sortedIds([EDITORS])]);
  });

  test("a read asks about both teams", async () => {
    await scopeOf(
      Incident,
      memberWith(CUSTOMER_ROWS),
      DatabaseRequestType.Read,
    );

    expect(teamQueries.map(teamsAskedAbout)).toEqual([
      sortedIds([EDITORS, VIEWERS]),
    ]);
  });

  test("rows no team grants ask about what the member owns alone", async () => {
    await scopeOf(
      Incident,
      memberWith([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
      ]),
      DatabaseRequestType.Update,
    );

    expect(userQueries).toHaveLength(1);
    expect(teamQueries).toHaveLength(0);
  });
});
