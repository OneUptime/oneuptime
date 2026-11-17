import Encryption from "Common/Server/Utils/Encryption";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import EncryptColumnInPlace, {
  EncryptColumnPass,
  ModelRepository,
} from "../../../FeatureSet/Workers/Utils/EncryptColumnInPlace";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EncryptColumnInPlace encrypts the values a column held before it was kept
 * encrypted at rest - the private keys of custom domains' uploaded
 * certificates and of Let's Encrypt certificates - for the data migrations
 * that encrypt them. Pinned here, against a table
 * kept in memory that answers the SQL the way Postgres would:
 *
 *   1. it reads a page at a time, in _id order, only the values that are set
 *      and not our ciphertext, and reaches every row however many pages;
 *   2. it writes each value encrypted, and only while the row still holds
 *      the value read, so a value replaced meanwhile is left alone;
 *   3. it leaves an encrypted, empty or null value alone, so a second run
 *      writes nothing, and every value decrypts back to what was stored;
 *   4. a page that cannot be read ends the column's run, a row that cannot
 *      be written costs the others nothing, and a page that does not move
 *      on is not read for ever;
 *   5. no log line carries a value: not when the driver's error quotes it,
 *      and not when the error carries the query's parameters.
 */

const TABLE: string = "AcmeCertificate";
const COLUMN: string = "certificateKey";

const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;
const LIMIT_CLAUSE: RegExp = /LIMIT (\d+)/;

type Row = { _id: string; value: string | null };

interface QueryCall {
  sql: string;
  params: Array<unknown>;
}

interface Table {
  rows: Array<Row>;
  calls: Array<QueryCall>;
  repository: ModelRepository;
}

function keyOf(index: number): string {
  return `-----BEGIN PRIVATE KEY-----\nkey-number-${index}\n-----END PRIVATE KEY-----`;
}

function idOf(index: number): string {
  // Sorts as Postgres sorts uuids: by its hex digits.
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

/*
 * A table in memory that answers the two statements as Postgres would:
 * the SELECT's filters, order and limit, and the UPDATE's WHERE.
 */
function makeTable(
  rows: Array<Row>,
  options?: {
    failRead?: (call: QueryCall) => boolean;
    failWriteFor?: (id: string) => Error | null;
    // A table that answers every page with the first one.
    ignoreKeyset?: boolean;
  },
): Table {
  const table: Table = {
    rows: rows.map((row: Row): Row => {
      return { ...row };
    }),
    calls: [],
    repository: undefined as unknown as ModelRepository,
  };

  const query: (
    sql: string,
    params?: Array<unknown>,
  ) => Promise<unknown> = async (
    sql: string,
    params?: Array<unknown>,
  ): Promise<unknown> => {
    const call: QueryCall = { sql, params: params || [] };
    table.calls.push(call);

    if (SELECT_START.test(sql)) {
      if (options?.failRead?.(call)) {
        throw new Error("read failed");
      }

      const pattern: string = String(call.params[0]);
      const prefix: string = pattern.replace(/%$/, "");
      const afterId: string | undefined =
        options?.ignoreKeyset || call.params.length < 2
          ? undefined
          : String(call.params[1]);
      const limit: number = Number(LIMIT_CLAUSE.exec(sql)?.[1] || "0");

      return table.rows
        .filter((row: Row): boolean => {
          return (
            row.value !== null &&
            row.value !== "" &&
            !row.value.startsWith(prefix) &&
            (afterId === undefined || row._id > afterId)
          );
        })
        .sort((a: Row, b: Row): number => {
          return a._id < b._id ? -1 : 1;
        })
        .slice(0, limit)
        .map((row: Row): Record<string, unknown> => {
          return { _id: row._id, [COLUMN]: row.value };
        });
    }

    if (UPDATE_START.test(sql)) {
      const [encrypted, id, previous] = call.params as [string, string, string];

      const failure: Error | null = options?.failWriteFor?.(id) || null;

      if (failure) {
        throw failure;
      }

      for (const row of table.rows) {
        if (row._id === id && row.value === previous) {
          row.value = encrypted;
        }
      }

      return [];
    }

    throw new Error(`unexpected statement: ${sql}`);
  };

  table.repository = {
    metadata: { tableName: TABLE },
    manager: { query },
  } as unknown as ModelRepository;

  return table;
}

async function encrypt(
  table: Table,
  pageSize?: number | undefined,
): Promise<void> {
  await EncryptColumnInPlace.encrypt({
    migrationName: "TestMigration",
    target: {
      kind: "Let's Encrypt certificate",
      repository: table.repository,
      column: COLUMN,
    },
    pageSize: pageSize,
  });
}

function selects(table: Table): Array<QueryCall> {
  return table.calls.filter((call: QueryCall): boolean => {
    return SELECT_START.test(call.sql);
  });
}

function updates(table: Table): Array<QueryCall> {
  return table.calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

function loggedText(): string {
  return JSON.stringify([
    (logger.error as unknown as jest.Mock).mock.calls,
    (logger.info as unknown as jest.Mock).mock.calls,
    (logger.debug as unknown as jest.Mock).mock.calls,
    (logger.warn as unknown as jest.Mock).mock.calls,
  ]);
}

describe("EncryptColumnInPlace", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads only the values that are set and not our ciphertext, a page at a time in _id order", async () => {
    const table: Table = makeTable([{ _id: idOf(1), value: keyOf(1) }]);

    await encrypt(table);

    const [select] = selects(table);

    expect(select!.sql).toContain(`FROM "${TABLE}"`);
    expect(select!.sql).toContain(`"${COLUMN}" IS NOT NULL`);
    expect(select!.sql).toContain(`"${COLUMN}" <> ''`);
    expect(select!.sql).toContain(`"${COLUMN}" NOT LIKE $1`);
    expect(select!.sql).toContain(`ORDER BY "_id" ASC`);
    expect(select!.sql).toContain(`LIMIT ${EncryptColumnInPlace.PAGE_SIZE}`);
    // Our ciphertext's prefix, so what is encrypted already is never read.
    expect(select!.params).toEqual([`${Encryption.CIPHERTEXT_PREFIX}%`]);
    // Soft-deleted rows keep keys too: nothing narrows the read by them.
    expect(select!.sql).not.toContain("deletedAt");
  });

  test("encrypts every value, and each decrypts back to what was stored", async () => {
    const table: Table = makeTable([
      { _id: idOf(1), value: keyOf(1) },
      { _id: idOf(2), value: keyOf(2) },
    ]);

    await encrypt(table);

    for (const [index, row] of table.rows.entries()) {
      expect(row.value).not.toBe(keyOf(index + 1));
      expect(Encryption.looksEncrypted(row.value!)).toBe(true);
      expect(await Encryption.decrypt(row.value!)).toBe(keyOf(index + 1));
    }
  });

  test("writes each value only while the row still holds the value it read", async () => {
    const table: Table = makeTable([{ _id: idOf(1), value: keyOf(1) }]);

    await encrypt(table);

    const [update] = updates(table);

    expect(update!.sql).toBe(
      `UPDATE "${TABLE}" SET "${COLUMN}" = $1 WHERE "_id" = $2 AND "${COLUMN}" = $3`,
    );
    expect(update!.params[1]).toBe(idOf(1));
    expect(update!.params[2]).toBe(keyOf(1));
  });

  test("a value replaced between the read and the write is left as its new write stored it", async () => {
    const renewed: string = await Encryption.encrypt(keyOf(99));
    const table: Table = makeTable([{ _id: idOf(1), value: keyOf(1) }]);
    const query: (sql: string, params?: Array<unknown>) => Promise<unknown> = (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query;

    // A renewal writes the row, encrypted, right after the page is read.
    (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query = async (
      sql: string,
      params?: Array<unknown>,
    ): Promise<unknown> => {
      const answer: unknown = await query(sql, params);

      if (SELECT_START.test(sql)) {
        table.rows[0]!.value = renewed;
      }

      return answer;
    };

    await encrypt(table);

    expect(updates(table)).toHaveLength(1);
    expect(table.rows[0]!.value).toBe(renewed);
    expect(await Encryption.decrypt(table.rows[0]!.value!)).toBe(keyOf(99));
  });

  test("reaches every row across pages, and reads each page after the last id it read", async () => {
    const rows: Array<Row> = Array.from(
      { length: 7 },
      (_: unknown, i: number) => {
        return { _id: idOf(i + 1), value: keyOf(i + 1) };
      },
    );
    const table: Table = makeTable(rows);

    await encrypt(table, 3);

    // Pages of 3, 3 and 1: the short one is the last.
    expect(selects(table)).toHaveLength(3);
    expect(selects(table)[0]!.params).toHaveLength(1);
    expect(selects(table)[1]!.params[1]).toBe(idOf(3));
    expect(selects(table)[1]!.sql).toContain(`AND "_id" > $2`);
    expect(selects(table)[2]!.params[1]).toBe(idOf(6));

    expect(updates(table)).toHaveLength(7);

    for (const row of table.rows) {
      expect(Encryption.looksEncrypted(row.value!)).toBe(true);
    }
  });

  test("a full last page is followed by one more read, which finds nothing", async () => {
    const table: Table = makeTable([
      { _id: idOf(1), value: keyOf(1) },
      { _id: idOf(2), value: keyOf(2) },
    ]);

    await encrypt(table, 2);

    expect(selects(table)).toHaveLength(2);
    expect(updates(table)).toHaveLength(2);
  });

  test("a page that does not move on is not read for ever", async () => {
    const table: Table = makeTable(
      [
        { _id: idOf(1), value: keyOf(1) },
        { _id: idOf(2), value: keyOf(2) },
      ],
      { ignoreKeyset: true },
    );

    // The filter on our ciphertext would end it; take that away too.
    const query: (sql: string, params?: Array<unknown>) => Promise<unknown> = (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query;

    (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query = async (
      sql: string,
      params?: Array<unknown>,
    ): Promise<unknown> => {
      if (SELECT_START.test(sql)) {
        await query(sql, params);
        return [
          { _id: idOf(1), [COLUMN]: keyOf(1) },
          { _id: idOf(2), [COLUMN]: keyOf(2) },
        ];
      }

      return await query(sql, params);
    };

    await encrypt(table, 2);

    expect(selects(table).length).toBeLessThanOrEqual(2);
  });

  test("leaves an encrypted, empty or null value alone, so a second run writes nothing", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt(keyOf(1));
    const table: Table = makeTable([
      { _id: idOf(1), value: alreadyEncrypted },
      { _id: idOf(2), value: "" },
      { _id: idOf(3), value: null },
      { _id: idOf(4), value: keyOf(4) },
    ]);

    await encrypt(table);

    expect(updates(table)).toHaveLength(1);
    expect(table.rows[0]!.value).toBe(alreadyEncrypted);
    expect(table.rows[1]!.value).toBe("");
    expect(table.rows[2]!.value).toBeNull();

    const encryptedOnce: string = table.rows[3]!.value!;
    table.calls = [];

    await encrypt(table);

    expect(updates(table)).toHaveLength(0);
    expect(table.rows[3]!.value).toBe(encryptedOnce);
  });

  test("a value the read hands back already encrypted is never encrypted twice", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt(keyOf(1));
    const table: Table = makeTable([{ _id: idOf(1), value: alreadyEncrypted }]);

    // A read that ignores the filter, as a stand-in might.
    (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query = async (sql: string): Promise<unknown> => {
      table.calls.push({ sql, params: [] });
      return SELECT_START.test(sql)
        ? [{ _id: idOf(1), [COLUMN]: alreadyEncrypted }]
        : [];
    };

    await encrypt(table);

    expect(updates(table)).toHaveLength(0);
  });

  test("a row that cannot be written costs the others nothing", async () => {
    const table: Table = makeTable(
      [
        { _id: idOf(1), value: keyOf(1) },
        { _id: idOf(2), value: keyOf(2) },
        { _id: idOf(3), value: keyOf(3) },
      ],
      {
        failWriteFor: (id: string): Error | null => {
          return id === idOf(2) ? new Error("write failed") : null;
        },
      },
    );

    await encrypt(table);

    expect(updates(table)).toHaveLength(3);
    expect(Encryption.looksEncrypted(table.rows[0]!.value!)).toBe(true);
    // Still read as itself until a later write encrypts it.
    expect(table.rows[1]!.value).toBe(keyOf(2));
    expect(Encryption.looksEncrypted(table.rows[2]!.value!)).toBe(true);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain(idOf(2));
    expect(loggedText()).toContain("write failed");
  });

  test("a page that cannot be read ends the run, and says so", async () => {
    const table: Table = makeTable(
      [
        { _id: idOf(1), value: keyOf(1) },
        { _id: idOf(2), value: keyOf(2) },
        { _id: idOf(3), value: keyOf(3) },
      ],
      {
        failRead: (call: QueryCall): boolean => {
          return call.params.length > 1;
        },
      },
    );

    await expect(encrypt(table, 2)).resolves.toBeUndefined();

    // The first page was encrypted; the second could not be read.
    expect(updates(table)).toHaveLength(2);
    expect(table.rows[2]!.value).toBe(keyOf(3));
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain("failed to read");
  });

  test("no log line carries a value: not when the driver's error quotes it, nor when it holds the query's parameters", async () => {
    const table: Table = makeTable(
      [
        { _id: idOf(1), value: keyOf(1) },
        { _id: idOf(2), value: keyOf(2) },
      ],
      {
        failWriteFor: (id: string): Error | null => {
          const value: string = id === idOf(1) ? keyOf(1) : keyOf(2);

          // As TypeORM's QueryFailedError carries them.
          const error: Error & {
            query?: string;
            parameters?: Array<unknown>;
            code?: string;
            driverError?: unknown;
          } = new Error(`invalid value "${value}" for the column`);
          error.name = "QueryFailedError";
          error.query = `UPDATE "${TABLE}" SET ...`;
          error.parameters = ["ciphertext", id, value];
          error.code = "22P02";
          error.driverError = { parameters: [value] };

          return error;
        },
      },
    );

    await encrypt(table);

    expect(logger.error).toHaveBeenCalledTimes(2);

    const logged: string = loggedText();

    for (const value of [keyOf(1), keyOf(2)]) {
      expect(logged).not.toContain(value);
      expect(logged).not.toContain(JSON.stringify(value).slice(1, -1));
    }

    expect(logged).not.toContain("key-number-1");
    expect(logged).not.toContain("key-number-2");
    // Still enough to tell what failed, and where.
    expect(logged).toContain("QueryFailedError (22P02)");
    expect(logged).toContain(idOf(1));
    expect(logged).toContain("[REDACTED]");

    // Only text is logged, never the error with its fields.
    for (const call of (logger.error as unknown as jest.Mock).mock.calls) {
      for (const argument of call) {
        expect(typeof argument).toBe("string");
      }
    }
  });

  test("an error is described by its class, its code and its message", () => {
    const error: Error & { code?: string } = new Error("canceling statement");
    error.name = "QueryFailedError";
    error.code = "57014";

    expect(EncryptColumnInPlace.describeError(error)).toBe(
      "QueryFailedError (57014): canceling statement",
    );
    expect(EncryptColumnInPlace.describeError("plain words")).toBe(
      "Error: plain words",
    );
    expect(EncryptColumnInPlace.describeError({ parameters: ["x"] })).toBe(
      "Error: unknown error",
    );
    expect(
      EncryptColumnInPlace.describeError(
        new Error("bad secret-value here and secret-value there"),
        "secret-value",
      ),
    ).toBe("Error: bad [REDACTED] here and [REDACTED] there");
  });
});

/*
 * What a pass comes to, for the CredentialsAtRest:EncryptInPlace job, which
 * records a migration's values as protected only once a whole pass finds
 * nothing left (#9266), and which a run's deadline stops between pages.
 */
describe("EncryptColumnInPlace's pass", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function pass(
    table: Table,
    options?: {
      pageSize?: number | undefined;
      deadline?: JobDeadline | undefined;
    },
  ): Promise<EncryptColumnPass> {
    return await EncryptColumnInPlace.encrypt({
      migrationName: "TestJob",
      target: {
        kind: "Let's Encrypt certificate",
        repository: table.repository,
        column: COLUMN,
      },
      pageSize: options?.pageSize,
      deadline: options?.deadline,
    });
  }

  test("says what it read and wrote, and finds nothing on the pass after", async () => {
    const table: Table = makeTable([
      { _id: idOf(1), value: keyOf(1) },
      { _id: idOf(2), value: keyOf(2) },
      { _id: idOf(3), value: null },
    ]);

    expect(await pass(table)).toEqual({
      read: 2,
      written: 2,
      failed: 0,
      isCutShort: false,
    });
    expect(await pass(table)).toEqual({
      read: 0,
      written: 0,
      failed: 0,
      isCutShort: false,
    });
  });

  test("counts a row it could not write, and a page it could not read, as failed", async () => {
    const unwritable: Table = makeTable(
      [
        { _id: idOf(1), value: keyOf(1) },
        { _id: idOf(2), value: keyOf(2) },
      ],
      {
        failWriteFor: (id: string): Error | null => {
          return id === idOf(1) ? new Error("write failed") : null;
        },
      },
    );

    expect(await pass(unwritable)).toEqual({
      read: 2,
      written: 1,
      failed: 1,
      isCutShort: false,
    });

    const unreadable: Table = makeTable([{ _id: idOf(1), value: keyOf(1) }], {
      failRead: (): boolean => {
        return true;
      },
    });

    expect(await pass(unreadable)).toEqual({
      read: 0,
      written: 0,
      failed: 1,
      isCutShort: false,
    });
  });

  test("a deadline passed reads nothing, and says it stopped short", async () => {
    const table: Table = makeTable([{ _id: idOf(1), value: keyOf(1) }]);
    const deadline: JobDeadline = new JobDeadline();

    deadline.end(new Error("the run's time limit"));

    expect(await pass(table, { deadline: deadline })).toEqual({
      read: 0,
      written: 0,
      failed: 0,
      isCutShort: true,
    });
    expect(table.calls).toHaveLength(0);
    expect(table.rows[0]!.value).toBe(keyOf(1));
  });

  test("a deadline that passes between pages stops there: what it wrote stays, the next pass reads the rest", async () => {
    const table: Table = makeTable([
      { _id: idOf(1), value: keyOf(1) },
      { _id: idOf(2), value: keyOf(2) },
      { _id: idOf(3), value: keyOf(3) },
    ]);
    const deadline: JobDeadline = new JobDeadline();
    const query: (sql: string, params?: Array<unknown>) => Promise<unknown> = (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query;

    // The time limit runs out once the first page is written.
    (
      table.repository.manager as unknown as {
        query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
      }
    ).query = async (
      sql: string,
      params?: Array<unknown>,
    ): Promise<unknown> => {
      const answer: unknown = await query(sql, params);

      if (UPDATE_START.test(sql) && params?.[1] === idOf(2)) {
        deadline.end(new Error("the run's time limit"));
      }

      return answer;
    };

    expect(await pass(table, { pageSize: 2, deadline: deadline })).toEqual({
      read: 2,
      written: 2,
      failed: 0,
      isCutShort: true,
    });
    expect(table.rows[2]!.value).toBe(keyOf(3));

    expect(await pass(table, { pageSize: 2 })).toEqual({
      read: 1,
      written: 1,
      failed: 0,
      isCutShort: false,
    });
    expect(await Encryption.decrypt(table.rows[2]!.value!)).toBe(keyOf(3));
  });

  /*
   * A JSON column's read takes encrypted rows too - only its fields say -
   * so an install that ran the migration in place reads page after page of
   * rows with nothing to write: the deadline stops it there all the same.
   */
  test("a JSON column's pass stops at the deadline between pages too, though nothing it read was left to write", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const rows: Array<{ _id: string; snmpConfigs: Array<JSONObject> }> = [];

    for (let index: number = 1; index <= 3; index++) {
      rows.push({
        _id: idOf(index),
        snmpConfigs: [
          { communityString: await Encryption.encrypt(`community-${index}`) },
        ],
      });
    }

    const calls: Array<QueryCall> = [];
    const repository: ModelRepository = {
      metadata: { tableName: "NetworkDeviceDiscoveryScan" },
      manager: {
        query: async (
          sql: string,
          params: Array<unknown> = [],
        ): Promise<unknown> => {
          calls.push({ sql, params });

          if (!SELECT_START.test(sql)) {
            throw new Error(`unexpected statement: ${sql}`);
          }

          const afterId: string | undefined =
            params.length > 0 ? String(params[0]) : undefined;
          const limit: number = Number(LIMIT_CLAUSE.exec(sql)?.[1] || "0");

          // The time limit runs out as the first page is read.
          deadline.end(new Error("the run's time limit"));

          return rows
            .filter((row: { _id: string }): boolean => {
              return afterId === undefined || row._id > afterId;
            })
            .slice(0, limit);
        },
      },
    } as unknown as ModelRepository;

    expect(
      await EncryptColumnInPlace.encrypt({
        migrationName: "TestJob",
        target: {
          kind: "network device discovery scan",
          repository: repository,
          column: "snmpConfigs",
          jsonFields: ["communityString"],
        },
        pageSize: 2,
        deadline: deadline,
      }),
    ).toEqual({ read: 0, written: 0, failed: 0, isCutShort: true });
    expect(calls).toHaveLength(1);
  });
});
