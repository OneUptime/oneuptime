import QueryHelper, {
  OwnerTableColumns,
} from "../../../../Server/Types/Database/QueryHelper";
import { OwnedByMatch } from "../../../../Types/BaseDatabase/OwnedBy";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * THE SQL A FILTER BY OWNERS BECOMES (QueryHelper.ownedBy), held on a
 * record's id: what the server runs when a list is narrowed to the records
 * some people or teams own. OwnedByFilterPostgres runs it against Postgres;
 * this pins its shape:
 *
 *   - "any of them" and "someone" are ONE uncorrelated IN over both owner
 *     tables (UNION ALL), which Postgres answers as a semi-join through the
 *     owner tables' indexes, never a list of ids sent from the browser;
 *   - "none of them" and "nobody" are a correlated NOT EXISTS per owner
 *     table (an anti-join through the index on the record's id), not NOT IN,
 *     which hashes every owned id and degrades past the planner's memory;
 *   - in an UPDATE or a DELETE, which name the id bare, the negative ones
 *     fall back to NOT IN, so the subquery never reads its own table's _id;
 *   - each table is read only for what it is asked: the people's table for
 *     people, the teams' for teams;
 *   - every value is a bound parameter, every identifier quoted.
 */

const USERS: OwnerTableColumns = {
  tableName: "OnCallDutyPolicyScheduleOwnerUser",
  resourceColumnName: "onCallDutyPolicyScheduleId",
  ownerColumnName: "userId",
};

const TEAMS: OwnerTableColumns = {
  tableName: "OnCallDutyPolicyScheduleOwnerTeam",
  resourceColumnName: "onCallDutyPolicyScheduleId",
  ownerColumnName: "teamId",
};

const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";

// The alias TypeORM hands a condition on the id in a SELECT, and bare.
const SELECT_ALIAS: string = "OnCallDutyPolicySchedule._id";
const BARE_ALIAS: string = "_id";

const PEOPLE_ROWS: string =
  'SELECT "OnCallDutyPolicyScheduleOwnerUser"."onCallDutyPolicyScheduleId" FROM "OnCallDutyPolicyScheduleOwnerUser" WHERE "OnCallDutyPolicyScheduleOwnerUser"."onCallDutyPolicyScheduleId" IS NOT NULL AND ';
const TEAM_ROWS: string =
  'SELECT "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" FROM "OnCallDutyPolicyScheduleOwnerTeam" WHERE "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" IS NOT NULL AND ';

interface Built {
  sql: string;
  parameters: Record<string, Array<string>>;
  // The bound parameter names, in the order the SQL names them.
  names: Array<string>;
}

const PARAMETER_NAME: RegExp = /:\.\.\.(\w+)/g;

// Where the SQL reads a subquery of owned ids.
const SUBQUERY_IN: RegExp = / IN \(SELECT /g;

const build: (
  data: {
    match: OwnedByMatch;
    userIds?: Array<string | ObjectID>;
    teamIds?: Array<string | ObjectID>;
  },
  alias?: string,
) => Built = (
  data: {
    match: OwnedByMatch;
    userIds?: Array<string | ObjectID>;
    teamIds?: Array<string | ObjectID>;
  },
  alias: string = SELECT_ALIAS,
): Built => {
  const operator: FindOperator<unknown> = QueryHelper.ownedBy({
    match: data.match,
    userIds: data.userIds || [],
    teamIds: data.teamIds || [],
    userTable: USERS,
    teamTable: TEAMS,
  }) as FindOperator<unknown>;

  expect(operator.type).toBe("raw");

  const sql: string = operator.getSql!(alias);

  return {
    sql: sql,
    parameters: (operator.objectLiteralParameters || {}) as Record<
      string,
      Array<string>
    >,
    names: Array.from(sql.matchAll(PARAMETER_NAME)).map(
      (found: RegExpMatchArray): string => {
        return found[1]!;
      },
    ),
  };
};

describe("QueryHelper.ownedBy - the SQL of a filter by owners", () => {
  test("a person: one IN over the people's table, through userId, with the id bound", () => {
    const built: Built = build({
      match: OwnedByMatch.AnyOf,
      userIds: [ADA],
    });

    expect(built.names).toHaveLength(1);
    expect(built.sql).toBe(
      `(${SELECT_ALIAS} IN (${PEOPLE_ROWS}"OnCallDutyPolicyScheduleOwnerUser"."userId" IN (:...${built.names[0]}) AND "OnCallDutyPolicyScheduleOwnerUser"."deletedAt" IS NULL))`,
    );
    expect(built.parameters).toEqual({ [built.names[0]!]: [ADA] });
    // The teams' table is not read for a person.
    expect(built.sql).not.toContain("OwnerTeam");
  });

  test("a team: one IN over the teams' table, through teamId", () => {
    const built: Built = build({
      match: OwnedByMatch.AnyOf,
      teamIds: [new ObjectID(SRE_TEAM)],
    });

    expect(built.sql).toBe(
      `(${SELECT_ALIAS} IN (${TEAM_ROWS}"OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (:...${built.names[0]}) AND "OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
    // ObjectIDs are bound as their text.
    expect(built.parameters).toEqual({ [built.names[0]!]: [SRE_TEAM] });
    expect(built.sql).not.toContain("OwnerUser");
  });

  test("people and teams: still one IN, the two tables joined by UNION ALL", () => {
    const built: Built = build({
      match: OwnedByMatch.AnyOf,
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });

    expect(built.names).toHaveLength(2);
    expect(new Set(built.names).size).toBe(2);
    expect(built.sql).toBe(
      `(${SELECT_ALIAS} IN (${PEOPLE_ROWS}"OnCallDutyPolicyScheduleOwnerUser"."userId" IN (:...${built.names[0]}) AND "OnCallDutyPolicyScheduleOwnerUser"."deletedAt" IS NULL UNION ALL ${TEAM_ROWS}"OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (:...${built.names[1]}) AND "OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
    expect(built.parameters).toEqual({
      [built.names[0]!]: [ADA],
      [built.names[1]!]: [SRE_TEAM],
    });
    expect(built.sql.match(SUBQUERY_IN)).toHaveLength(1);
  });

  test("someone: one IN over every owner row of both tables", () => {
    const built: Built = build({ match: OwnedByMatch.AnyOwner });

    expect(built.names).toEqual([]);
    expect(built.parameters).toEqual({});
    expect(built.sql).toBe(
      `(${SELECT_ALIAS} IN (${PEOPLE_ROWS}"OnCallDutyPolicyScheduleOwnerUser"."deletedAt" IS NULL UNION ALL ${TEAM_ROWS}"OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
  });

  test("none of them: a NOT EXISTS per table, correlated with the record's id", () => {
    const built: Built = build({
      match: OwnedByMatch.NoneOf,
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });

    expect(built.sql).toBe(
      `(NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicyScheduleOwnerUser" WHERE "OnCallDutyPolicyScheduleOwnerUser"."onCallDutyPolicyScheduleId" = ${SELECT_ALIAS} AND "OnCallDutyPolicyScheduleOwnerUser"."userId" IN (:...${built.names[0]}) AND "OnCallDutyPolicyScheduleOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicyScheduleOwnerTeam" WHERE "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" = ${SELECT_ALIAS} AND "OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (:...${built.names[1]}) AND "OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
    expect(built.sql).not.toContain("NOT IN");
  });

  test("none of a team: only the teams' table is read", () => {
    const built: Built = build({
      match: OwnedByMatch.NoneOf,
      teamIds: [SRE_TEAM],
    });

    expect(built.sql).toBe(
      `(NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicyScheduleOwnerTeam" WHERE "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" = ${SELECT_ALIAS} AND "OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (:...${built.names[0]}) AND "OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
  });

  test("nobody: no owner row in either table", () => {
    const built: Built = build({ match: OwnedByMatch.NoOwner });

    expect(built.sql).toBe(
      `(NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicyScheduleOwnerUser" WHERE "OnCallDutyPolicyScheduleOwnerUser"."onCallDutyPolicyScheduleId" = ${SELECT_ALIAS} AND "OnCallDutyPolicyScheduleOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "OnCallDutyPolicyScheduleOwnerTeam" WHERE "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" = ${SELECT_ALIAS} AND "OnCallDutyPolicyScheduleOwnerTeam"."deletedAt" IS NULL))`,
    );
    expect(built.parameters).toEqual({});
  });

  test.each([OwnedByMatch.NoneOf, OwnedByMatch.NoOwner])(
    "%s in an UPDATE or a DELETE (a bare id): NOT IN, never a subquery that could read its own _id",
    (match: OwnedByMatch) => {
      const built: Built = build(
        match === OwnedByMatch.NoneOf
          ? { match: match, userIds: [ADA], teamIds: [SRE_TEAM] }
          : { match: match },
        BARE_ALIAS,
      );

      expect(built.sql).not.toContain("EXISTS");
      expect(built.sql.startsWith(`(${BARE_ALIAS} NOT IN (${PEOPLE_ROWS}`)).toBe(
        true,
      );
      expect(built.sql).toContain(` AND ${BARE_ALIAS} NOT IN (${TEAM_ROWS}`);
      // Owner ids that are null never make NOT IN answer nothing.
      expect(built.sql).toContain(
        '"OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId" IS NOT NULL',
      );
    },
  );

  test.each([OwnedByMatch.AnyOf, OwnedByMatch.AnyOwner])(
    "%s in an UPDATE or a DELETE is the same uncorrelated IN",
    (match: OwnedByMatch) => {
      const built: Built = build(
        match === OwnedByMatch.AnyOf
          ? { match: match, teamIds: [SRE_TEAM] }
          : { match: match },
        BARE_ALIAS,
      );

      expect(built.sql.startsWith(`(${BARE_ALIAS} IN (`)).toBe(true);
      expect(built.sql).not.toContain("EXISTS");
    },
  );

  test("every call binds its own parameter names, so two filters never share one", () => {
    const first: Built = build({
      match: OwnedByMatch.AnyOf,
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });
    const second: Built = build({
      match: OwnedByMatch.AnyOf,
      userIds: [ADA],
      teamIds: [SRE_TEAM],
    });

    expect(
      first.names.filter((name: string): boolean => {
        return second.names.includes(name);
      }),
    ).toEqual([]);
  });

  test("an owner id is a bound value, never part of the SQL", () => {
    const hostile: string = `${ADA}') OR 1=1 --`;
    const built: Built = build({
      match: OwnedByMatch.AnyOf,
      userIds: [hostile],
    });

    expect(built.sql).not.toContain("1=1");
    expect(Object.values(built.parameters)).toEqual([[hostile]]);
  });

  test("table and column names are quoted, a quote inside them doubled", () => {
    const operator: FindOperator<unknown> = QueryHelper.ownedBy({
      match: OwnedByMatch.NoOwner,
      userIds: [],
      teamIds: [],
      userTable: {
        tableName: 'Odd"Users',
        resourceColumnName: "recordId",
        ownerColumnName: "userId",
      },
      teamTable: TEAMS,
    }) as FindOperator<unknown>;

    expect(operator.getSql!(SELECT_ALIAS)).toContain(
      'FROM "Odd""Users" WHERE "Odd""Users"."recordId" =',
    );
  });

  test("nobody named (the operator refuses it before this): no record, or every record", () => {
    expect(build({ match: OwnedByMatch.AnyOf }).sql).toBe("(FALSE)");
    expect(build({ match: OwnedByMatch.NoneOf }).sql).toBe("(TRUE)");
  });
});
