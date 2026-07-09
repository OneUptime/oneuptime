import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
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
