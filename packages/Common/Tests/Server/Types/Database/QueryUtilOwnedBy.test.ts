import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Query from "../../../../Server/Types/Database/Query";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import OwnedBy, { OwnedByMatch } from "../../../../Types/BaseDatabase/OwnedBy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, FindOperator } from "typeorm";

/*
 * A FILTER BY OWNERS ON ITS WAY TO THE DATABASE (QueryUtil.serializeQuery).
 *
 * `owners` is no column: it becomes a condition on the records' ids, added
 * beside whatever else the query asks of the id - a list a facet narrowed to,
 * the one record a page reads, a permission's condition - never in its place,
 * whatever order the keys come in. The same holds for a multi-field search,
 * which used to take the place of an id filter that was not yet a database
 * operator (a list of ids): a search on a list narrowed to some records
 * searched all of them.
 */

const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";
const SCHEDULE_A: string = "4b80df62-ae73-4c51-9fbb-60c9a2d5e7a4";
const SCHEDULE_B: string = "5c91e073-bf84-4d62-a0cc-71dab3e6f8b5";

type Serialized = Record<string, any>;

// The SQL of a serialized condition on the id, as a SELECT would run it.
const sqlOf: (condition: FindOperator<any>) => string = (
  condition: FindOperator<any>,
): string => {
  if (condition.type === "and") {
    return (condition.value as unknown as Array<FindOperator<any>>)
      .map((child: FindOperator<any>): string => {
        return sqlOf(child);
      })
      .join(" AND ");
  }

  return condition.getSql!("OnCallDutyPolicySchedule._id");
};

const ownedBySre: () => OwnedBy = (): OwnedBy => {
  return new OwnedBy({ teamIds: [SRE_TEAM] });
};

describe("QueryUtil.serializeQuery - a filter by owners", () => {
  test("is no column: the key goes, and the records' ids carry the condition", () => {
    const result: Serialized = QueryUtil.serializeQuery(
      OnCallDutyPolicySchedule,
      { owners: ownedBySre() } as Query<OnCallDutyPolicySchedule>,
    );

    expect(result["owners"]).toBeUndefined();
    expect(Object.keys(result)).toEqual(["_id"]);
    expect(result["_id"].type).toBe("and");
    expect(sqlOf(result["_id"])).toContain(
      'OnCallDutyPolicySchedule._id IN (SELECT "OnCallDutyPolicyScheduleOwnerTeam"."onCallDutyPolicyScheduleId"',
    );
  });

  test("keeps every other filter of the query as it was", () => {
    const projectId: ObjectID = ObjectID.generate();
    const result: Serialized = QueryUtil.serializeQuery(
      OnCallDutyPolicySchedule,
      {
        projectId: projectId,
        owners: ownedBySre(),
      } as Query<OnCallDutyPolicySchedule>,
    );

    expect(Object.keys(result).sort()).toEqual(["_id", "projectId"]);
    expect(
      Object.values(
        (result["projectId"] as FindOperator<any>).objectLiteralParameters ||
          {},
      ),
    ).toEqual([projectId.toString()]);
  });

  describe.each(["before", "after"])(
    "beside an id filter placed %s it",
    (position: string) => {
      const withIdFilter: (idFilter: unknown) => Serialized = (
        idFilter: unknown,
      ): Serialized => {
        const query: Record<string, unknown> =
          position === "before"
            ? { _id: idFilter, owners: ownedBySre() }
            : { owners: ownedBySre(), _id: idFilter };

        return QueryUtil.serializeQuery(
          OnCallDutyPolicySchedule,
          query as Query<OnCallDutyPolicySchedule>,
        );
      };

      test("one id, as text: that record, if the team owns it", () => {
        const result: Serialized = withIdFilter(SCHEDULE_A);

        expect(result["_id"].value).toHaveLength(2);
        expect(
          Object.values(result["_id"].value[0].objectLiteralParameters),
        ).toEqual([SCHEDULE_A]);
        expect(sqlOf(result["_id"])).toContain("OwnerTeam");
      });

      test("one id, as an ObjectID", () => {
        const result: Serialized = withIdFilter(new ObjectID(SCHEDULE_B));

        expect(result["_id"].value).toHaveLength(2);
        expect(
          Object.values(result["_id"].value[0].objectLiteralParameters),
        ).toEqual([SCHEDULE_B]);
      });

      test("a list of ids (a facet's Includes): both hold", () => {
        const result: Serialized = withIdFilter(
          new Includes([SCHEDULE_A, SCHEDULE_B]),
        );

        expect(result["_id"].value).toHaveLength(2);
        expect(sqlOf(result["_id"])).toMatch(IN_LIST_THEN_OWNERS);
        expect(
          Object.values(result["_id"].value[0].objectLiteralParameters),
        ).toEqual([[SCHEDULE_A, SCHEDULE_B]]);
      });

      test("ids left out (IncludesNone): both hold", () => {
        const result: Serialized = withIdFilter(new IncludesNone([SCHEDULE_A]));

        expect(result["_id"].value).toHaveLength(2);
        expect(sqlOf(result["_id"])).toContain(
          "OnCallDutyPolicySchedule._id NOT IN (",
        );
      });

      test("a condition a permission put on the id: both hold", () => {
        const permissionCondition: FindOperator<any> = QueryHelper.equalTo(
          SCHEDULE_A,
        ) as FindOperator<any>;
        const result: Serialized = withIdFilter(permissionCondition);

        expect(result["_id"].value[0]).toBe(permissionCondition);
        expect(result["_id"].value).toHaveLength(2);
      });
    },
  );

  test("as it arrives from the API (JSON), the same condition", () => {
    const payload: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          owners: new OwnedBy({ userIds: [ADA], teamIds: [SRE_TEAM] }),
        }),
      ),
    );
    const result: Serialized = QueryUtil.serializeQuery(
      OnCallDutyPolicySchedule,
      JSONFunctions.deserialize(payload) as Query<OnCallDutyPolicySchedule>,
    );

    const sql: string = sqlOf(result["_id"]);

    expect(sql).toContain('"OnCallDutyPolicyScheduleOwnerUser"."userId" IN (');
    expect(sql).toContain('"OnCallDutyPolicyScheduleOwnerTeam"."teamId" IN (');
  });

  test.each(Object.values(OwnedByMatch))(
    "%s reaches the database as the matching SQL",
    (match: OwnedByMatch) => {
      const result: Serialized = QueryUtil.serializeQuery(Monitor, {
        owners: new OwnedBy(
          match === OwnedByMatch.AnyOf || match === OwnedByMatch.NoneOf
            ? { match: match, userIds: [ADA] }
            : { match: match },
        ),
      } as Query<Monitor>);

      const sql: string = (result["_id"].value[0] as FindOperator<any>).getSql!(
        "Monitor._id",
      );

      if (match === OwnedByMatch.AnyOf || match === OwnedByMatch.AnyOwner) {
        expect(sql.startsWith("(Monitor._id IN (SELECT ")).toBe(true);
      } else {
        expect(sql.startsWith("(NOT EXISTS (SELECT 1 FROM ")).toBe(true);
      }
    },
  );

  test("under any key but owners, it is refused rather than read as a column", () => {
    let error: unknown = undefined;

    try {
      QueryUtil.serializeQuery(OnCallDutyPolicySchedule, {
        name: ownedBySre(),
      } as unknown as Query<OnCallDutyPolicySchedule>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      'A filter by owners goes under "owners", not "name".',
    );
  });

  test("on a kind without owners, it is refused rather than left out (which would list everything)", () => {
    let error: unknown = undefined;

    try {
      QueryUtil.serializeQuery(Label, {
        owners: ownedBySre(),
      } as unknown as Query<Label>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Labels have no owners, so they cannot be filtered by their owners.",
    );
  });
});

// A list of ids first, then the owners' subquery.
const IN_LIST_THEN_OWNERS: RegExp =
  /^\(OnCallDutyPolicySchedule\._id IN \(:\.\.\.\w+\)\) AND \(OnCallDutyPolicySchedule\._id IN \(SELECT /;

describe("QueryUtil.serializeQuery - a search beside a list of ids", () => {
  /*
   * A multi-field search needs the entity's columns to know what it may
   * search: the data source is stood in for with the schedule's.
   */
  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      getMetadata: () => {
        return {
          columns: [{ propertyName: "name" }, { propertyName: "description" }],
        };
      },
    } as unknown as DataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(["before", "after"])(
    "the list of ids placed %s the search still narrows the rows searched",
    (position: string) => {
      const search: MultiSearch = new MultiSearch({
        fields: ["name", "description"],
        value: "payments",
      });
      const ids: Includes = new Includes([SCHEDULE_A, SCHEDULE_B]);
      const query: Record<string, unknown> =
        position === "before"
          ? { _id: ids, _multiFieldSearch: search }
          : { _multiFieldSearch: search, _id: ids };

      const result: Serialized = QueryUtil.serializeQuery(
        OnCallDutyPolicySchedule,
        query as Query<OnCallDutyPolicySchedule>,
      );

      expect(result["_multiFieldSearch"]).toBeUndefined();
      expect(result["_id"].type).toBe("and");
      expect(result["_id"].value).toHaveLength(2);
      // The list, first.
      expect(
        Object.values(result["_id"].value[0].objectLiteralParameters),
      ).toEqual([[SCHEDULE_A, SCHEDULE_B]]);
      // Then the search.
      expect(
        Object.values(result["_id"].value[1].objectLiteralParameters),
      ).toContain("%payments%");
    },
  );

  test("a search, a list of ids and owners: all three hold", () => {
    const result: Serialized = QueryUtil.serializeQuery(
      OnCallDutyPolicySchedule,
      {
        _multiFieldSearch: new MultiSearch({
          fields: ["name"],
          value: "payments",
        }),
        owners: ownedBySre(),
        _id: new Includes([SCHEDULE_A]),
      } as unknown as Query<OnCallDutyPolicySchedule>,
    );

    expect(result["_id"].value).toHaveLength(3);
    const sql: string = sqlOf(result["_id"]);
    expect(sql).toContain("OwnerTeam");
    expect(sql).toContain("ILIKE");
  });

  test("a search alone is as it was: the search on the id", () => {
    const result: Serialized = QueryUtil.serializeQuery(
      OnCallDutyPolicySchedule,
      {
        _multiFieldSearch: new MultiSearch({
          fields: ["name"],
          value: "payments",
        }),
      } as unknown as Query<OnCallDutyPolicySchedule>,
    );

    expect(Object.keys(result)).toEqual(["_id"]);
    expect(sqlOf(result["_id"])).toContain("ILIKE");
  });
});
