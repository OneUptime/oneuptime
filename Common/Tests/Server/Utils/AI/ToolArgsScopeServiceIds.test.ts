import { ToolArgs } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * scopeServiceIds decides the `serviceIds` filter the aggregation tools hand to
 * the raw-SQL aggregation services. The aggregation services treat a
 * missing/empty serviceIds as "no filter" (whole project), so for a
 * label-restricted user this helper must NEVER return undefined or []. These
 * tests pin that invariant.
 */
describe("ToolArgs.scopeServiceIds", () => {
  test("unrestricted user, no requested service → no filter", () => {
    expect(ToolArgs.scopeServiceIds(null, undefined)).toBeUndefined();
  });

  test("unrestricted user with a requested service → just that service", () => {
    const requested: ObjectID = ObjectID.generate();
    const result: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      null,
      requested,
    );
    expect(
      result?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([requested.toString()]);
  });

  test("restricted user, no requested service → the accessible set", () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    const result: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      [a, b],
      undefined,
    );
    expect(
      result?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([a.toString(), b.toString()]);
  });

  test("restricted user requesting an accessible service → intersection", () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    const result: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      [a, b],
      b,
    );
    expect(
      result?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([b.toString()]);
  });

  test("restricted user requesting a forbidden service → no-match sentinel, never empty", () => {
    const accessible: ObjectID = ObjectID.generate();
    const forbidden: ObjectID = ObjectID.generate();
    const result: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      [accessible],
      forbidden,
    );
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.toString()).toBe(ObjectID.getZeroObjectID().toString());
  });

  test("restricted user with no accessible services → no-match sentinel, never empty", () => {
    const result: Array<ObjectID> | undefined = ToolArgs.scopeServiceIds(
      [],
      undefined,
    );
    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.toString()).toBe(ObjectID.getZeroObjectID().toString());
  });
});
