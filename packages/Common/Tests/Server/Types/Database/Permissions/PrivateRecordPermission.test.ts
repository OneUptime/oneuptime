import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordPermission, {
  PRIVATE_RECORD_KINDS,
  PrivateRecordColumn,
  PrivateRecordKind,
  PrivateRecordReach,
} from "../../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import Query from "../../../../../Server/Types/Database/Query";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "../../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * A PRIVATE RECORD IS CHANGED ONLY THROUGH THE TEAMS THAT OWN IT.
 *
 * The maintainer's report (block 33): Test User 2, in Team 1 and Team 2,
 * updated a private incident only Team 2 owns, and Team 2 may only view -
 * with Team 1's permission, which reaches no private incident Team 1 does
 * not own. Here, without a database: which rows reach which private records
 * (getReach), the SQL that holds an update or a delete to them, and where
 * the rule applies and where it does not. The real-Postgres matrix
 * (Tests/Server/API/PrivateRecordOwnerTeamsPostgres) runs the SQL.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c6d",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "4b5c6d7e-8f9a-4b0c-9d1e-2f3a4b5c6d7e",
);
const TEAM_1: ObjectID = new ObjectID("5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f");
const TEAM_2: ObjectID = new ObjectID("6d7e8f9a-0b1c-4d2e-9f3a-4b5c6d7e8f9a");
const PRODUCTION: ObjectID = new ObjectID(
  "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b",
);
const STAGING: ObjectID = new ObjectID("8f9a0b1c-2d3e-4f4a-9b5c-6d7e8f9a0b1c");
const INCIDENT_ID: string = "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";

function row(
  permission: Permission,
  data: {
    teamId?: ObjectID | undefined;
    scope?: PermissionScope | undefined;
    labelIds?: Array<ObjectID> | undefined;
    isBlock?: boolean | undefined;
  } = {},
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

// The member, acting in the project with these rows from their teams.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_1, TEAM_2],
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

// The maintainer's member: Team 1 may change incidents, Team 2 only view.
const maintainersMember: DatabaseCommonInteractionProps = memberWith([
  row(Permission.ProjectMember, { teamId: TEAM_1, scope: PermissionScope.All }),
  row(Permission.Viewer, { teamId: TEAM_2, scope: PermissionScope.All }),
]);

// Pulls the SQL and bound values out of a typeorm Raw() FindOperator.
/* eslint-disable @typescript-eslint/no-explicit-any */
interface RawParts {
  sql: string;
  params: Record<string, string | Array<string>>;
}

function rawParts(clause: unknown): RawParts {
  const operator: any = clause as any;

  return {
    sql: String(operator._getSql("COLUMN")),
    params: (operator._objectLiteralParameters || {}) as Record<
      string,
      string | Array<string>
    >,
  };
}

/*
 * The rule's Raw operator, of an And(...) it was combined into beside the
 * caller's own filter (combineWithPrivacyClause puts it last), or itself.
 */
function rawOf(value: unknown): unknown {
  const operator: any = value as any;

  if (operator instanceof FindOperator && operator.type === "and") {
    const operands: Array<unknown> = operator.value as Array<unknown>;
    return operands[operands.length - 1];
  }

  return value;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function sortedTeams(teamIds: Array<ObjectID>): Array<string> {
  return teamIds
    .map((teamId: ObjectID): string => {
      return teamId.toString();
    })
    .sort();
}

describe("the kinds of record that can be private", () => {
  test("are the incident, the alert and the two kinds of episode", () => {
    expect(
      PRIVATE_RECORD_KINDS.map((kind: PrivateRecordKind): string => {
        return kind.tableName;
      }),
    ).toEqual(["Incident", "Alert", "IncidentEpisode", "AlertEpisode"]);

    for (const modelType of [Incident, Alert, IncidentEpisode, AlertEpisode]) {
      expect(PrivateRecordPermission.isPrivateRecordModel(modelType)).toBe(
        true,
      );
    }

    expect(PrivateRecordPermission.isPrivateRecordModel(Monitor)).toBe(false);
    expect(
      PrivateRecordPermission.isPrivateRecordModel(IncidentInternalNote),
    ).toBe(false);
  });

  test("a table that is no kind, or none at all, is no kind", () => {
    expect(PrivateRecordPermission.getKind("Monitor")).toBeNull();
    expect(PrivateRecordPermission.getKind(null)).toBeNull();
    expect(PrivateRecordPermission.getKind(undefined)).toBeNull();
    expect(PrivateRecordPermission.getKind("")).toBeNull();
    expect(PrivateRecordPermission.getKind("Incident")?.ownerKey).toBe(
      "incidentId",
    );
  });
});

describe("the column a model's rows name a private record by", () => {
  test("a private kind's own rows: their id", () => {
    const column: PrivateRecordColumn | null =
      PrivateRecordPermission.getPrivateRecordColumn(Incident);

    expect(column?.column).toBe("_id");
    expect(column?.isRecord).toBe(true);
    expect(column?.kind.tableName).toBe("Incident");
    expect(column?.recordModelType).toBe(Incident);
  });

  test("a part read through one: the key naming it", () => {
    for (const [modelType, key] of [
      [IncidentInternalNote, "incidentId"],
      [IncidentOwnerTeam, "incidentId"],
      [IncidentStateTimeline, "incidentId"],
    ] as Array<[{ new (): BaseModel }, string]>) {
      const column: PrivateRecordColumn | null =
        PrivateRecordPermission.getPrivateRecordColumn(modelType);

      expect(column?.column).toBe(key);
      expect(column?.isRecord).toBe(false);
      expect(column?.kind.tableName).toBe("Incident");
      expect(column?.recordModelType).toBe(Incident);
    }
  });

  test("anything else: none", () => {
    expect(PrivateRecordPermission.getPrivateRecordColumn(Monitor)).toBeNull();
  });
});

describe("what one operation's rows reach of the private records (getReachOfRows)", () => {
  const reachOf: (rows: Array<UserPermission>) => PrivateRecordReach = (
    rows: Array<UserPermission>,
  ): PrivateRecordReach => {
    return PrivateRecordPermission.getReachOfRows({
      rows: rows,
      userId: MEMBER_ID,
    });
  };

  test("the person's own records, always", () => {
    expect(reachOf([]).userId?.toString()).toBe(MEMBER_ID.toString());
    expect(
      PrivateRecordPermission.getReachOfRows({ rows: [], userId: null }).userId,
    ).toBeNull();
  });

  test("a team's unscoped row reaches every private record that team owns", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.All,
      }),
    ]);

    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_1.toString()]);
    expect(reach.labelledTeams).toEqual([]);
  });

  test("a row scoped to Owned reaches the same: on a private record, owning it is what lets anyone in", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.Owned,
      }),
    ]);

    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_1.toString()]);
  });

  test("a row limited to labels reaches its team's records carrying one of them", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.Labels,
        labelIds: [PRODUCTION],
      }),
    ]);

    expect(reach.teamIds).toEqual([]);
    expect(reach.labelledTeams).toHaveLength(1);
    expect(reach.labelledTeams[0]!.teamId.toString()).toBe(TEAM_1.toString());
    expect(
      reach.labelledTeams[0]!.labelIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([PRODUCTION.toString()]);
  });

  test("a row stored as All with labels - an older install's - is limited to them too", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.All,
        labelIds: [PRODUCTION],
      }),
    ]);

    expect(reach.teamIds).toEqual([]);
    expect(reach.labelledTeams).toHaveLength(1);
  });

  test("one team's rows together: any row beyond labels makes it reach all it owns", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.Labels,
        labelIds: [PRODUCTION],
      }),
      row(Permission.EditProjectIncident, {
        teamId: TEAM_1,
        scope: PermissionScope.All,
      }),
    ]);

    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_1.toString()]);
    expect(reach.labelledTeams).toEqual([]);
  });

  test("one team's labelled rows together: their labels, each once whatever its case", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        labelIds: [PRODUCTION],
      }),
      row(Permission.EditProjectIncident, {
        teamId: TEAM_1,
        labelIds: [new ObjectID(PRODUCTION.toString().toUpperCase()), STAGING],
      }),
    ]);

    expect(reach.labelledTeams).toHaveLength(1);
    expect(
      reach.labelledTeams[0]!.labelIds.map((id: ObjectID) => {
        return id.toString().toLowerCase();
      }).sort(),
    ).toEqual(
      [PRODUCTION.toString(), STAGING.toString()]
        .map((id: string) => {
          return id.toLowerCase();
        })
        .sort(),
    );
  });

  test("each team on its own: one's labels never narrow the other's reach, nor widen it", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        labelIds: [PRODUCTION],
      }),
      row(Permission.IncidentMember, {
        teamId: TEAM_2,
        scope: PermissionScope.All,
      }),
    ]);

    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_2.toString()]);
    expect(reach.labelledTeams).toHaveLength(1);
    expect(reach.labelledTeams[0]!.teamId.toString()).toBe(TEAM_1.toString());
  });

  test("a role that cannot be scoped reaches all its team owns, whatever its row says", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.ProjectAdmin, {
        teamId: TEAM_1,
        scope: PermissionScope.Owned,
      }),
    ]);

    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_1.toString()]);
  });

  test("a row no team grants reaches no team's records; a block reaches nothing", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, { scope: PermissionScope.All }),
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.All,
        isBlock: true,
      }),
    ]);

    expect(reach.teamIds).toEqual([]);
    expect(reach.labelledTeams).toEqual([]);
  });

  test("a row stored as Labels that carries none reaches all its team owns, as every check reads it", () => {
    const reach: PrivateRecordReach = reachOf([
      row(Permission.IncidentMember, {
        teamId: TEAM_1,
        scope: PermissionScope.Labels,
      }),
    ]);

    // Stored as Labels with none: isLimitedToLabels reads it as unscoped.
    expect(sortedTeams(reach.teamIds)).toEqual([TEAM_1.toString()]);
  });
});

describe("what an operation reaches, read off the caller's rows (getReach)", () => {
  test("the maintainer's case: changing incidents is Team 1's alone, reading them both teams'", () => {
    const update: PrivateRecordReach = PrivateRecordPermission.getReach(
      Incident,
      maintainersMember,
      DatabaseRequestType.Update,
    );

    expect(sortedTeams(update.teamIds)).toEqual([TEAM_1.toString()]);

    const read: PrivateRecordReach = PrivateRecordPermission.getReach(
      Incident,
      maintainersMember,
      DatabaseRequestType.Read,
    );

    expect(sortedTeams(read.teamIds)).toEqual(sortedTeams([TEAM_1, TEAM_2]));
  });

  test("a part's own permission decides: a note's create, not the incident's edit", () => {
    const member: DatabaseCommonInteractionProps = memberWith([
      row(Permission.EditProjectIncident, {
        teamId: TEAM_1,
        scope: PermissionScope.All,
      }),
      row(Permission.CreateIncidentInternalNote, {
        teamId: TEAM_2,
        scope: PermissionScope.All,
      }),
    ]);

    expect(
      sortedTeams(
        PrivateRecordPermission.getReach(
          IncidentInternalNote,
          member,
          DatabaseRequestType.Create,
        ).teamIds,
      ),
    ).toEqual([TEAM_2.toString()]);

    expect(
      sortedTeams(
        PrivateRecordPermission.getReach(
          Incident,
          member,
          DatabaseRequestType.Update,
        ).teamIds,
      ),
    ).toEqual([TEAM_1.toString()]);
  });

  test("the operational-resource wildcard grants as the table check reads it", () => {
    const member: DatabaseCommonInteractionProps = memberWith([
      row(Permission.EditAllOperationalResources, {
        teamId: TEAM_2,
        scope: PermissionScope.All,
      }),
    ]);

    expect(
      sortedTeams(
        PrivateRecordPermission.getReach(
          Incident,
          member,
          DatabaseRequestType.Update,
        ).teamIds,
      ),
    ).toEqual([TEAM_2.toString()]);
  });
});

describe("the SQL a write is held to", () => {
  const kind: PrivateRecordKind = PrivateRecordPermission.getKind("Incident")!;

  test("every record that is not private, and the private ones the person or the reach's teams own", () => {
    const { sql, params }: RawParts = rawParts(
      PrivateRecordPermission.getReachableCondition({
        kind: kind,
        reach: {
          userId: MEMBER_ID,
          teamIds: [TEAM_1],
          labelledTeams: [{ teamId: TEAM_2, labelIds: [PRODUCTION] }],
        },
        allowsNoRecord: false,
      }),
    );

    expect(sql.startsWith(`(COLUMN IN (SELECT r."_id" FROM "Incident" r`)).toBe(
      true,
    );
    expect(sql).toContain(`r."deletedAt" IS NULL`);
    expect(sql).toContain(`r."isPrivate" IS NULL OR r."isPrivate" = FALSE`);
    expect(sql).toContain(
      `SELECT pou."incidentId" FROM "IncidentOwnerUser" pou WHERE pou."userId" = :`,
    );
    expect(sql).toContain(`pou."deletedAt" IS NULL`);
    expect(sql).toContain(
      `SELECT pot."incidentId" FROM "IncidentOwnerTeam" pot WHERE pot."teamId" IN (:...`,
    );
    expect(sql).toContain(`pot."deletedAt" IS NULL`);
    // A labelled team: owned by it AND carrying one of its labels.
    expect(sql).toContain(`"IncidentOwnerTeam" plt WHERE plt."teamId" = :`);
    expect(sql).toContain(
      `SELECT pl."incidentId" FROM "IncidentLabel" pl WHERE pl."labelId" IN (:...`,
    );
    expect(sql).not.toContain("TeamMember");
    expect(sql.includes("COLUMN IS NULL")).toBe(false);

    const values: Array<string | Array<string>> = Object.values(params);
    expect(values).toContainEqual(MEMBER_ID.toString());
    expect(values).toContainEqual([TEAM_1.toString()]);
    expect(values).toContainEqual(TEAM_2.toString());
    expect(values).toContainEqual([PRODUCTION.toString()]);
    expect(values).toHaveLength(4);
  });

  test("a part whose key names no record is no part of a private one: let through", () => {
    const { sql }: RawParts = rawParts(
      PrivateRecordPermission.getReachableCondition({
        kind: kind,
        reach: { userId: MEMBER_ID, teamIds: [], labelledTeams: [] },
        allowsNoRecord: true,
      }),
    );

    expect(sql.startsWith("(COLUMN IS NULL OR COLUMN IN (")).toBe(true);
  });

  test("a caller who owns nothing - an API key - reaches only records that are not private", () => {
    const { sql, params }: RawParts = rawParts(
      PrivateRecordPermission.getReachableCondition({
        kind: kind,
        reach: { userId: null, teamIds: [], labelledTeams: [] },
        allowsNoRecord: false,
      }),
    );

    expect(sql).toContain(`(r."isPrivate" IS NULL OR r."isPrivate" = FALSE)`);
    expect(sql).not.toContain("IncidentOwner");
    expect(Object.keys(params)).toHaveLength(0);
  });

  test("the records a write does not reach: private, owned by none of it", () => {
    const { sql }: RawParts = rawParts(
      PrivateRecordPermission.getUnreachableCondition({
        kind: kind,
        reach: { userId: MEMBER_ID, teamIds: [TEAM_1], labelledTeams: [] },
      }),
    );

    expect(sql).toContain(`r."isPrivate" = TRUE AND NOT (`);
    expect(sql).toContain(`"IncidentOwnerTeam"`);

    const nothingOwned: RawParts = rawParts(
      PrivateRecordPermission.getUnreachableCondition({
        kind: kind,
        reach: { userId: null, teamIds: [], labelledTeams: [] },
      }),
    );

    expect(nothingOwned.sql).toContain(`r."isPrivate" = TRUE)`);
    expect(nothingOwned.sql).not.toContain("NOT (");
  });

  test("each kind names its own tables", () => {
    for (const each of PRIVATE_RECORD_KINDS) {
      const { sql }: RawParts = rawParts(
        PrivateRecordPermission.getReachableCondition({
          kind: each,
          reach: {
            userId: MEMBER_ID,
            teamIds: [TEAM_1],
            labelledTeams: [{ teamId: TEAM_2, labelIds: [PRODUCTION] }],
          },
          allowsNoRecord: false,
        }),
      );

      expect(sql).toContain(`FROM "${each.tableName}" r`);
      expect(sql).toContain(`FROM "${each.ownerUserTable}" pou`);
      expect(sql).toContain(`FROM "${each.ownerTeamTable}" pot`);
      expect(sql).toContain(`FROM "${each.labelTable}" pl`);
      expect(sql).toContain(`pou."${each.ownerKey}"`);
    }
  });

  test("every clause binds names of its own, so two in one query never collide", () => {
    const reach: PrivateRecordReach = {
      userId: MEMBER_ID,
      teamIds: [TEAM_1],
      labelledTeams: [{ teamId: TEAM_2, labelIds: [PRODUCTION] }],
    };

    const first: RawParts = rawParts(
      PrivateRecordPermission.getReachableCondition({
        kind: kind,
        reach: reach,
        allowsNoRecord: false,
      }),
    );
    const second: RawParts = rawParts(
      PrivateRecordPermission.getReachableCondition({
        kind: kind,
        reach: reach,
        allowsNoRecord: false,
      }),
    );

    for (const name of Object.keys(first.params)) {
      expect(Object.keys(second.params)).not.toContain(name);
    }
  });
});

describe("where the rule narrows (narrows)", () => {
  test("an update and a delete of a private kind, or of a part of one, by a member", () => {
    for (const type of [
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(
        PrivateRecordPermission.narrows(Incident, maintainersMember, type),
      ).toBe(true);
      expect(
        PrivateRecordPermission.narrows(
          IncidentInternalNote,
          maintainersMember,
          type,
        ),
      ).toBe(true);
    }
  });

  test("not a read - who sees a private record is decided by the privacy filters - nor a create, held under its parent", () => {
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        maintainersMember,
        DatabaseRequestType.Read,
      ),
    ).toBe(false);
    expect(
      PrivateRecordPermission.narrows(
        IncidentInternalNote,
        maintainersMember,
        DatabaseRequestType.Create,
      ),
    ).toBe(false);
  });

  test("not a kind that cannot be private", () => {
    expect(
      PrivateRecordPermission.narrows(
        Monitor,
        maintainersMember,
        DatabaseRequestType.Update,
      ),
    ).toBe(false);
  });

  test("not OneUptime itself, a server admin, nor a project owner or admin", () => {
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        { isRoot: true },
        DatabaseRequestType.Update,
      ),
    ).toBe(false);
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        { ...maintainersMember, isMasterAdmin: true },
        DatabaseRequestType.Update,
      ),
    ).toBe(false);

    for (const role of [Permission.ProjectOwner, Permission.ProjectAdmin]) {
      expect(
        PrivateRecordPermission.narrows(
          Incident,
          memberWith([
            row(role, { teamId: TEAM_1, scope: PermissionScope.All }),
          ]),
          DatabaseRequestType.Delete,
        ),
      ).toBe(false);
    }
  });

  test("a project admin limited to labels is no project admin of every private record", () => {
    expect(
      PrivateRecordPermission.narrows(
        Incident,
        memberWith([
          row(Permission.ProjectAdmin, {
            teamId: TEAM_1,
            scope: PermissionScope.Labels,
            labelIds: [PRODUCTION],
          }),
        ]),
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
  });
});

describe("the record rule's step (addPrivateRecordScopeToQuery)", () => {
  test("an incident's update keeps to the incidents it reaches, by their id, beside the caller's own filter", () => {
    const query: Query<Incident> =
      PrivateRecordPermission.addPrivateRecordScopeToQuery(
        Incident,
        { _id: INCIDENT_ID } as Query<Incident>,
        maintainersMember,
        DatabaseRequestType.Update,
      );

    const value: unknown = (query as Record<string, unknown>)["_id"];
    expect(value).toBeInstanceOf(FindOperator);
    expect((value as FindOperator<unknown>).type).toBe("and");

    const { sql, params }: RawParts = rawParts(rawOf(value));
    expect(sql).toContain(`FROM "Incident" r`);
    // Team 1 changes incidents; Team 2 only views them.
    expect(Object.values(params)).toContainEqual([TEAM_1.toString()]);
    expect(Object.values(params)).not.toContainEqual([TEAM_2.toString()]);
  });

  test("a note's delete keeps to the notes of the incidents it reaches, by their key", () => {
    const query: Query<IncidentInternalNote> =
      PrivateRecordPermission.addPrivateRecordScopeToQuery(
        IncidentInternalNote,
        {} as Query<IncidentInternalNote>,
        memberWith([
          row(Permission.IncidentMember, {
            teamId: TEAM_1,
            scope: PermissionScope.All,
          }),
        ]),
        DatabaseRequestType.Delete,
      );

    expect((query as Record<string, unknown>)["_id"]).toBeUndefined();

    const { sql }: RawParts = rawParts(
      (query as Record<string, unknown>)["incidentId"],
    );

    expect(sql.startsWith("(COLUMN IS NULL OR COLUMN IN (")).toBe(true);
    expect(sql).toContain(`FROM "Incident" r`);
  });

  test("a read and a bypassing caller's write are left as they are", () => {
    const read: Query<Incident> =
      PrivateRecordPermission.addPrivateRecordScopeToQuery(
        Incident,
        { _id: INCIDENT_ID } as Query<Incident>,
        maintainersMember,
        DatabaseRequestType.Read,
      );
    expect(read).toEqual({ _id: INCIDENT_ID });

    const asAdmin: Query<Incident> =
      PrivateRecordPermission.addPrivateRecordScopeToQuery(
        Incident,
        { _id: INCIDENT_ID } as Query<Incident>,
        memberWith([
          row(Permission.ProjectAdmin, {
            teamId: TEAM_1,
            scope: PermissionScope.All,
          }),
        ]),
        DatabaseRequestType.Update,
      );
    expect(asAdmin).toEqual({ _id: INCIDENT_ID });
  });
});

describe("the parents a create puts a part under (getUnreachableParentIds)", () => {
  test("asks, as OneUptime, which named private parents the part's create does not reach", async () => {
    const findIdsInProject: Mock<
      (data: {
        modelType: { new (): BaseModel };
        ids: Array<string>;
        query: Query<BaseModel>;
      }) => Promise<Array<string>>
    > = jest.fn(async () => {
      return [INCIDENT_ID];
    });

    const unreachable: Array<string> =
      await PrivateRecordPermission.getUnreachableParentIds({
        modelType: IncidentInternalNote,
        parentModelType: Incident,
        parentIds: [INCIDENT_ID, "not-an-id"],
        props: maintainersMember,
        type: DatabaseRequestType.Create,
        findIdsInProject: findIdsInProject as never,
      });

    expect(unreachable).toEqual([INCIDENT_ID]);
    expect(findIdsInProject).toHaveBeenCalledTimes(1);

    const asked: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
      query: Query<BaseModel>;
    } = findIdsInProject.mock.calls[0]![0];

    // A malformed id names no record and is not looked up.
    expect(asked.ids).toEqual([INCIDENT_ID]);
    expect(asked.modelType).toBe(Incident);

    const { sql }: RawParts = rawParts(
      rawOf((asked.query as Record<string, unknown>)["_id"]),
    );
    expect(sql).toContain(`r."isPrivate" = TRUE AND NOT (`);
  });

  test("asks nothing of a caller who acts on every private record, or of a parent that cannot be private", async () => {
    const findIdsInProject: Mock<() => Promise<Array<string>>> = jest.fn(
      async () => {
        return [INCIDENT_ID];
      },
    );

    expect(
      await PrivateRecordPermission.getUnreachableParentIds({
        modelType: IncidentInternalNote,
        parentModelType: Incident,
        parentIds: [INCIDENT_ID],
        props: memberWith([
          row(Permission.ProjectOwner, {
            teamId: TEAM_1,
            scope: PermissionScope.All,
          }),
        ]),
        type: DatabaseRequestType.Create,
        findIdsInProject: findIdsInProject as never,
      }),
    ).toEqual([]);

    expect(
      await PrivateRecordPermission.getUnreachableParentIds({
        modelType: IncidentInternalNote,
        parentModelType: Monitor,
        parentIds: [INCIDENT_ID],
        props: maintainersMember,
        type: DatabaseRequestType.Create,
        findIdsInProject: findIdsInProject as never,
      }),
    ).toEqual([]);

    expect(
      await PrivateRecordPermission.getUnreachableParentIds({
        modelType: IncidentInternalNote,
        parentModelType: Incident,
        parentIds: [INCIDENT_ID],
        props: { isRoot: true },
        type: DatabaseRequestType.Create,
        findIdsInProject: findIdsInProject as never,
      }),
    ).toEqual([]);

    expect(findIdsInProject).not.toHaveBeenCalled();
  });

  test("the query names exactly the ids, combined with the rule", () => {
    const query: Query<BaseModel> | null =
      PrivateRecordPermission.getUnreachableRecordsQuery({
        modelType: Incident,
        recordModelType: Incident,
        recordIds: [INCIDENT_ID],
        props: maintainersMember,
        type: DatabaseRequestType.Delete,
      });

    const value: unknown = (query as Record<string, unknown>)["_id"];
    expect(value).toBeInstanceOf(FindOperator);
    expect((value as FindOperator<unknown>).type).toBe("and");

    expect(
      PrivateRecordPermission.getUnreachableRecordsQuery({
        modelType: Incident,
        recordModelType: Incident,
        recordIds: [],
        props: maintainersMember,
        type: DatabaseRequestType.Delete,
      }),
    ).toBeNull();
  });
});
