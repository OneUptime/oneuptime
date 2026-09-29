import UserEmailService from "../../../Server/Services/UserEmailService";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * atomicIncrementColumnValueByOneAndGetValue, the primitive that makes the
 * verification attempt limit safe under concurrency (GHSA-5cr8-vph4-3hrf).
 *
 * The property that matters is that the increment and the observation are ONE
 * statement. A read-modify-write lets N racing requests all see the same
 * pre-increment value and all conclude they are inside the limit — which is
 * the exact shape of a brute-force loop, so a counter with that hole is not a
 * counter. These tests pin the statement shape and the reply parsing; the
 * behaviour it buys is exercised end to end in
 * Tests/Server/Utils/ChannelVerification.test.ts.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

const buildRepository: (data: {
  reply: unknown;
  captured: Array<CapturedQuery>;
}) => unknown = (data: { reply: unknown; captured: Array<CapturedQuery> }) => {
  return {
    metadata: {
      tableName: "UserEmail",
      primaryColumns: [{ databaseName: "_id" }],
      findColumnWithPropertyName: (propertyName: string) => {
        if (propertyName === "verificationFailedAttempts") {
          return { databaseName: "verificationFailedAttempts" };
        }

        return undefined;
      },
    },
    manager: {
      query: (sql: string, params: Array<unknown>) => {
        data.captured.push({ sql, params });
        return Promise.resolve(data.reply);
      },
    },
  };
};

const ITEM_ID: ObjectID = new ObjectID("6b2a1f00-1111-4111-8111-111111111111");

describe("DatabaseService.atomicIncrementColumnValueByOneAndGetValue", () => {
  let captured: Array<CapturedQuery>;

  const run: (reply: unknown) => Promise<number> = (reply: unknown) => {
    UserEmailService.getRepository = jest
      .fn()
      .mockReturnValue(buildRepository({ reply, captured })) as never;

    return UserEmailService.atomicIncrementColumnValueByOneAndGetValue({
      id: ITEM_ID,
      columnName: "verificationFailedAttempts",
    });
  };

  beforeEach(() => {
    captured = [];
  });

  it("increments and reads back in a single statement", async () => {
    await run([[{ verificationFailedAttempts: 3 }], 1]);

    expect(captured).toHaveLength(1);

    const sql: string = captured[0]?.sql as string;

    expect(sql).toContain('UPDATE "UserEmail"');
    expect(sql).toContain(
      '"verificationFailedAttempts" = COALESCE("verificationFailedAttempts", 0) + 1',
    );
    expect(sql).toContain('RETURNING "verificationFailedAttempts"');
  });

  it("binds the id rather than interpolating it", async () => {
    await run([[{ verificationFailedAttempts: 1 }], 1]);

    expect(captured[0]?.sql).toContain('WHERE "_id" = $1');
    expect(captured[0]?.params).toEqual([ITEM_ID.toString()]);
  });

  it("returns the post-increment value", async () => {
    expect(await run([[{ verificationFailedAttempts: 4 }], 1])).toBe(4);
  });

  /*
   * TypeORM wraps UPDATE replies as [rows, affectedCount]; other shapes come
   * back as a bare row array. Both have to parse.
   */
  it("understands a bare row array too", async () => {
    expect(await run([{ verificationFailedAttempts: 7 }])).toBe(7);
  });

  it("parses a count the driver returned as a string", async () => {
    expect(await run([[{ verificationFailedAttempts: "9" }], 1])).toBe(9);
  });

  /*
   * A missing row must be an error, never a zero — the caller gates on this
   * number, and a zero reads as a fresh attempt budget.
   */
  it("throws when the row does not exist", async () => {
    await expect(run([[], 0])).rejects.toThrow("not found");
    await expect(run([])).rejects.toThrow("not found");
  });

  it("throws when the reply carries no usable number", async () => {
    await expect(
      run([[{ verificationFailedAttempts: "not-a-number" }], 1]),
    ).rejects.toThrow("did not return a number");
  });

  it("refuses a column that is not on the entity", async () => {
    UserEmailService.getRepository = jest
      .fn()
      .mockReturnValue(buildRepository({ reply: [], captured })) as never;

    await expect(
      UserEmailService.atomicIncrementColumnValueByOneAndGetValue({
        id: ITEM_ID,
        columnName: "notAColumn" as never,
      }),
    ).rejects.toThrow("unknown column");

    expect(captured).toHaveLength(0);
  });

  it("requires an id", async () => {
    await expect(
      UserEmailService.atomicIncrementColumnValueByOneAndGetValue({
        id: undefined as unknown as ObjectID,
        columnName: "verificationFailedAttempts",
      }),
    ).rejects.toThrow("id is required");
  });
});
