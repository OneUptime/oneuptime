import QueryPermission from "../../../../Server/Types/Database/Permissions/QueryPermission";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import Search from "../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import ObjectID from "../../../../Types/ObjectID";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * The server half of "filter users and projects by ID" in the admin
 * dashboard.
 *
 * `_id` is not an ordinary text column - it is a Postgres `uuid`, and uuid has
 * no ILIKE. A partial-match filter on it only works because QueryHelper.search
 * wraps the column in `CAST(... AS TEXT)` first; emit the ILIKE against the
 * raw column and Postgres rejects the whole statement with
 * `operator does not exist: uuid ~~* unknown`. That cast is invisible from the
 * UI - the filter looks identical either way and simply errors at fetch time -
 * so it is asserted here rather than inferred.
 *
 * The other half is the permission layer: every queried column is checked
 * against what the caller may read, and a column it does not recognise is
 * rejected outright. `_id` passes as an always-readable column, which is what
 * lets the filter reach the database at all.
 */

const A_UUID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";

type SerializeFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
) => Record<string, any>;

const serialize: SerializeFunction = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
): Record<string, any> => {
  return QueryUtil.serializeQuery(modelType, query as any) as unknown as Record<
    string,
    any
  >;
};

type RawSqlFunction = (operator: unknown, aliasPath: string) => string;

const rawSql: RawSqlFunction = (
  operator: unknown,
  aliasPath: string,
): string => {
  const getSql: ((aliasPath: string) => string) | undefined = (
    operator as FindOperator<unknown>
  ).getSql;

  if (!getSql) {
    throw new Error("Expected a Raw FindOperator with a SQL generator.");
  }

  return getSql(aliasPath);
};

type ParamsFunction = (operator: unknown) => Array<unknown>;

const params: ParamsFunction = (operator: unknown): Array<unknown> => {
  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters: Record<string, unknown>;
      }
    ).objectLiteralParameters,
  );
};

describe("QueryUtil.serializeQuery — filtering on the _id column", () => {
  describe("User", () => {
    /*
     * The default operator in the ID filter. A Search that reached TypeORM
     * un-serialized would silently degrade into an exact equality, so pasting
     * a fragment of an id would quietly match nothing at all.
     */
    it("turns a partial-id Search into an ILIKE over the id cast to text", () => {
      const result: Record<string, any> = serialize(User, {
        _id: new Search("5f0e8e3a"),
      });

      expect(result["_id"]).toBeInstanceOf(FindOperator);
      expect(result["_id"]).not.toBeInstanceOf(Search);
      expect(result["_id"].type).toBe("raw");

      const sql: string = rawSql(result["_id"], "User._id");

      // Without the cast this is invalid SQL against a uuid column.
      expect(sql).toContain("CAST(User._id AS TEXT)");
      expect(sql).toContain("ILIKE");
      expect(params(result["_id"])).toEqual(["%5f0e8e3a%"]);
    });

    it("turns a whole-id EqualTo into a plain equality", () => {
      const result: Record<string, any> = serialize(User, {
        _id: new EqualTo(A_UUID),
      });

      expect(result["_id"].type).toBe("raw");
      expect(rawSql(result["_id"], "User._id")).toContain("User._id = :");
      expect(params(result["_id"])).toEqual([A_UUID]);
    });

    it("turns a NotEqual into an inequality", () => {
      const result: Record<string, any> = serialize(User, {
        _id: new NotEqual(A_UUID),
      });

      expect(rawSql(result["_id"], "User._id")).toContain("User._id != :");
      expect(params(result["_id"])).toEqual([A_UUID]);
    });

    /*
     * Prefix matching is the operator an admin reaches for with a truncated
     * id, so it needs the same cast as `contains` - and an anchored pattern,
     * not a floating one.
     */
    it("anchors a StartsWith to the front of the id", () => {
      const result: Record<string, any> = serialize(User, {
        _id: new StartsWith("5f0e8e3a"),
      });

      expect(rawSql(result["_id"], "User._id")).toContain(
        "CAST(User._id AS TEXT)",
      );
      expect(params(result["_id"])).toEqual(["5f0e8e3a%"]);
    });

    /*
     * Ids are copied out of the UI with whatever case the source used, and
     * ILIKE is case-insensitive anyway - but the bound parameter has to be
     * lower-cased consistently or a mixed-case paste behaves differently from
     * the same id typed in lower case.
     */
    it("matches an id regardless of the case it was pasted in", () => {
      expect(
        params(
          serialize(User, { _id: new Search(A_UUID.toUpperCase()) })["_id"],
        ),
      ).toEqual([`%${A_UUID}%`]);
    });

    it("leaves a bare id string as a plain equality value", () => {
      expect(serialize(User, { _id: A_UUID })["_id"]).toBe(A_UUID);
    });

    it("unwraps an ObjectID into an equality on the id", () => {
      const result: Record<string, any> = serialize(User, {
        _id: new ObjectID(A_UUID),
      });

      expect(result["_id"].type).toBe("raw");
      expect(params(result["_id"])).toEqual([A_UUID]);
    });
  });

  /*
   * Project is a different model with a different column set, and the admin
   * dashboard filters it the same way. Nothing about the _id handling is
   * per-model, and this is what says so.
   */
  describe("Project", () => {
    it("turns a partial-id Search into an ILIKE over the id cast to text", () => {
      const result: Record<string, any> = serialize(Project, {
        _id: new Search("5f0e8e3a"),
      });

      expect(result["_id"].type).toBe("raw");
      expect(rawSql(result["_id"], "Project._id")).toContain(
        "CAST(Project._id AS TEXT)",
      );
      expect(params(result["_id"])).toEqual(["%5f0e8e3a%"]);
    });

    it("turns a whole-id EqualTo into a plain equality", () => {
      const result: Record<string, any> = serialize(Project, {
        _id: new EqualTo(A_UUID),
      });

      expect(rawSql(result["_id"], "Project._id")).toContain("Project._id = :");
      expect(params(result["_id"])).toEqual([A_UUID]);
    });
  });
});

/*
 * `checkQueryPermission` walks every key of the incoming query and rejects
 * anything the caller cannot read. An id filter arrives as a query key like
 * any other, so it has to survive that walk.
 */
describe("QueryPermission.checkQueryPermission — querying by _id", () => {
  /*
   * No permissions at all: the weakest caller there is. `_id` is one of the
   * always-readable columns, so even this caller may filter on it - which is
   * what keeps the ID filter working for every table that offers one, without
   * a per-model permission grant.
   */
  const noPermissions: DatabaseCommonInteractionProps = {
    userGlobalAccessPermission: {
      projectIds: [],
      globalPermissions: [],
      _type: "UserGlobalAccessPermission",
    },
  } as unknown as DatabaseCommonInteractionProps;

  it("allows filtering users by _id", () => {
    expect(() => {
      QueryPermission.checkQueryPermission<User>(
        User,
        { _id: new Search("5f0e8e3a") } as any,
        noPermissions,
      );
    }).not.toThrow();
  });

  it("allows filtering projects by _id", () => {
    expect(() => {
      QueryPermission.checkQueryPermission<Project>(
        Project,
        { _id: new Search("5f0e8e3a") } as any,
        noPermissions,
      );
    }).not.toThrow();
  });

  /*
   * The counter-case. Without it the two tests above would pass just as well
   * against a permission check that waves everything through.
   */
  it("still rejects a column that does not exist", () => {
    expect(() => {
      QueryPermission.checkQueryPermission<User>(
        User,
        { notAColumn: new Search("x") } as any,
        noPermissions,
      );
    }).toThrow(/Invalid column on User/);
  });

  /*
   * ...and a real column that this caller has no permission to read, which is
   * the check `_id` is deliberately exempt from.
   */
  it("still rejects a real column the caller cannot read", () => {
    expect(() => {
      QueryPermission.checkQueryPermission<User>(
        User,
        { isMasterAdmin: true } as any,
        noPermissions,
      );
    }).toThrow();
  });
});
