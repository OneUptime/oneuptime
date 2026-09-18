import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../Models/DatabaseModels/Incident";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import Search from "../../../../Types/BaseDatabase/Search";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";

/*
 * serializeQuery historically only visited top-level query keys. A search
 * operator nested under a single-entity relation (e.g. filtering TeamMember by
 * `user.name`) therefore reached TypeORM as a raw Search instance, which
 * TypeORM silently degrades to an exact equality (`user.name = 'foo'`) instead
 * of an ILIKE. That is what made the Owner / user picker "search" appear to do
 * nothing once a project had more than a page of members. These tests lock in
 * the recursion that converts nested relation operators into real SQL.
 */
describe("QueryUtil.serializeQuery — nested relation operators", () => {
  it("converts a Search nested under a single-entity relation into a raw ILIKE", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      user: { name: new Search("alice") },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      TeamMember,
      query as any,
    ) as unknown as Record<string, any>;

    /*
     * The nested Search must become a TypeORM Raw ILIKE, never survive as a
     * Search instance.
     */
    expect(result["user"].name).toBeInstanceOf(FindOperator);
    expect(result["user"].name).not.toBeInstanceOf(Search);
    expect(result["user"].name.type).toBe("raw");
    // QueryHelper.search wraps the (lower-cased) term as an ILIKE parameter.
    expect(Object.values(result["user"].name.objectLiteralParameters)).toEqual([
      "%alice%",
    ]);
  });

  it("also converts a Search on a relation's email column", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      user: { email: new Search("alice@example.com") },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      TeamMember,
      query as any,
    ) as unknown as Record<string, any>;

    expect(result["user"].email).toBeInstanceOf(FindOperator);
    expect(result["user"].email.type).toBe("raw");
    expect(Object.values(result["user"].email.objectLiteralParameters)).toEqual(
      ["%alice@example.com%"],
    );
  });

  it("leaves a plain id equality nested under a relation untouched", () => {
    const userId: ObjectID = ObjectID.generate();
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      user: { _id: userId.toString() },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      TeamMember,
      query as any,
    ) as unknown as Record<string, any>;

    // Plain id equality must NOT be rewritten into an ILIKE — it stays a value.
    expect(result["user"]._id).toBe(userId.toString());
  });
});

/*
 * Custom field filters ride the `customFields` jsonb column, so they reach the
 * database through serializeQuery's JSON branch. These pin the routing: the
 * branch has to fire for an operator-valued object (the new custom-field
 * chips) exactly as it always has for a plain one, and the branches above it
 * have to keep winning for a whole-column IsNull.
 */
describe("QueryUtil.serializeQuery — customFields jsonb column", () => {
  type RawOperatorSqlFunction = (operator: unknown) => string;

  const rawOperatorSql: RawOperatorSqlFunction = (
    operator: unknown,
  ): string => {
    const getSql: ((aliasPath: string) => string) | undefined = (
      operator as FindOperator<unknown>
    ).getSql;

    if (!getSql) {
      throw new Error("Expected a Raw FindOperator with a SQL generator.");
    }

    return getSql("Incident.customFields");
  };

  it("compiles a plain key/value object into a raw jsonb predicate", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      customFields: { Team: "Payments" },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      Incident,
      query as any,
    ) as unknown as Record<string, any>;

    expect(result["customFields"]).toBeInstanceOf(FindOperator);
    expect(result["customFields"].type).toBe("raw");
    expect(rawOperatorSql(result["customFields"])).toContain(
      '"Incident"."customFields" ->>',
    );
    expect(
      Object.values(result["customFields"].objectLiteralParameters),
    ).toContain("Payments");
  });

  it("compiles an operator nested under a key into the same raw predicate", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      customFields: { Team: new Includes(["Payments", "Billing"]) },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      Incident,
      query as any,
    ) as unknown as Record<string, any>;

    const sql: string = rawOperatorSql(result["customFields"]);

    // Two values means two OR-ed equality arms, each with a containment check.
    expect(sql).toContain(" OR ");
    expect(sql).toContain("@> CAST(");
    expect(
      Object.values(result["customFields"].objectLiteralParameters),
    ).toEqual(expect.arrayContaining(["Team", "Payments", "Billing"]));
  });

  it("never leaves a custom field name in the statement text", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      customFields: { "x' OR 1=1 --": "v" },
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      Incident,
      query as any,
    ) as unknown as Record<string, any>;

    expect(rawOperatorSql(result["customFields"])).not.toContain("OR 1=1");
  });

  it("still routes a whole-column IsNull to the branch above the JSON one", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      customFields: new IsNull(),
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      Incident,
      query as any,
    ) as unknown as Record<string, any>;

    expect(rawOperatorSql(result["customFields"])).toContain("IS NULL");
    expect(rawOperatorSql(result["customFields"])).not.toContain("->>");
  });

  it("still routes an explicit null to isNull", () => {
    const query: Record<string, unknown> = {
      projectId: ObjectID.generate(),
      customFields: null,
    };

    const result: Record<string, any> = QueryUtil.serializeQuery(
      Incident,
      query as any,
    ) as unknown as Record<string, any>;

    expect(rawOperatorSql(result["customFields"])).toContain("IS NULL");
  });
});
