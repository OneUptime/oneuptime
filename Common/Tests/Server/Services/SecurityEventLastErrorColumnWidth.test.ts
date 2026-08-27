import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import GoogleSecOpsConnection from "../../../Models/DatabaseModels/GoogleSecOpsConnection";
import { AddDetectionRuleAndGoogleSecOpsConnection1788000000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1788000000000-AddDetectionRuleAndGoogleSecOpsConnection";
import { WidenSecurityEventLastErrorColumns1789600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1789600000000-WidenSecurityEventLastErrorColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import GoogleSecOpsConnectionService from "../../../Server/Services/GoogleSecOpsConnectionService";
import ConnectorErrorMessage, {
  MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
} from "../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import GoogleSecOpsClient, {
  FetchLike,
  FetchResponseLike,
} from "../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * GoogleSecOpsConnection.lastError and DetectionRule.lastError must stay
 * unbounded text. This file exists because narrowing either of them back
 * is not a cosmetic regression — it silently stops the connector polling
 * loops altogether.
 *
 * What happened: both columns were declared TableColumnType.LongText, i.e.
 * varchar(500), and DatabaseService.checkMaxLengthOfFields rejects any
 * string longer than a column's declared max with a BadDataException. The
 * poller's catch block writes { lastPolledAt, lastError } to record a
 * failed poll, and a Google SecOps client error is a ~46 character prefix
 * plus up to 500 characters of echoed response body — 546, past the bound.
 * So the write that was recording the failure became a second failure,
 * threw out of the catch block, and took pollAllDueConnections down with
 * it: nothing stamped, every remaining connection in that tick skipped,
 * repeated every minute forever. The customer's row read lastPolledAt =
 * null AND lastError = null, because the two columns meant to explain the
 * outage were exactly the ones the outage prevented from being written.
 * DetectionRuleEvaluator had the identical pattern on DetectionRule
 * .lastError, where ClickHouse errors echo the whole compiled query.
 *
 * Four things have to line up, and a regression in any one of them brings
 * the silent outage back:
 *   1. both entities declare VeryLongText / `text` with no length, so
 *      getMaxLengthFromTableColumnType returns undefined and the length
 *      check cannot reject a stored error at all,
 *   2. the widest message the producers can actually emit really is
 *      accepted — pinned end to end, from the client's own error
 *      templates through ConnectorErrorMessage.toMessage to the real
 *      DatabaseService length check,
 *   3. the migration widens the live Postgres columns with ALTER COLUMN
 *      ... TYPE text rather than DROP + ADD, which would discard every
 *      error already stored, and
 *   4. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration never runs, so production would stay on
 *      varchar(500) while every entity-level assertion here still passed.
 *      That combination is precisely how this failure comes back.
 *
 * Pure metadata, source text, mocked query runners and an injected fetch —
 * no Postgres and no network anywhere.
 */

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_SOURCE: string = fs.readFileSync(
  path.join(
    SCHEMA_MIGRATIONS_DIRECTORY,
    "1789600000000-WidenSecurityEventLastErrorColumns.ts",
  ),
  "utf8",
);

const MIGRATIONS_INDEX_SOURCE: string = fs.readFileSync(
  path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
  "utf8",
);

const GOOGLE_SECOPS_CLIENT_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Utils",
    "SecurityEvent",
    "GoogleSecOps",
    "GoogleSecOpsClient.ts",
  ),
  "utf8",
);

/*
 * How many characters of the Chronicle response body each client error
 * template echoes, read out of the client itself rather than restated
 * here. Restating it would let the client widen its echo without a single
 * test noticing that the stored value grew with it.
 */
function responseBodyEchoLimits(): Array<number> {
  const pattern: RegExp = /responseText\.slice\(0,\s*(\d+)\)/g;
  const limits: Array<number> = [];

  let match: RegExpExecArray | null = pattern.exec(GOOGLE_SECOPS_CLIENT_SOURCE);
  while (match) {
    limits.push(Number(match[1]));
    match = pattern.exec(GOOGLE_SECOPS_CLIENT_SOURCE);
  }

  return limits;
}

function responseBodyEchoLimit(): number {
  const limits: Array<number> = responseBodyEchoLimits();

  if (limits.length === 0) {
    throw new Error(
      "GoogleSecOpsClient no longer echoes the response body with responseText.slice(0, N) — this file's premise needs revisiting",
    );
  }

  return Math.max(...limits);
}

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.example.com/token",
});

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

/*
 * Comfortably longer than anything the client will keep, so both templates
 * echo a full-width body and the resulting message is the widest possible.
 */
const OVERSIZED_RESPONSE_BODY: string = "x".repeat(responseBodyEchoLimit() * 4);

function makeFetch(
  responses: Array<{ status: number; body: string }>,
): FetchLike {
  let callIndex: number = 0;

  return (): Promise<FetchResponseLike> => {
    const response: { status: number; body: string } =
      responses[Math.min(callIndex, responses.length - 1)]!;
    callIndex++;

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: (): Promise<string> => {
        return Promise.resolve(response.body);
      },
    });
  };
}

function successfulTokenResponse(): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

/*
 * Drives the REAL client so the error under test is the one the poller
 * would actually catch, not a hand-written approximation of it.
 */
async function thrownClientError(
  responses: Array<{ status: number; body: string }>,
): Promise<Error> {
  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: makeFetch(responses),
  });

  try {
    await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected GoogleSecOpsClient to throw, but it did not");
}

interface LastErrorColumn {
  label: string;
  table: string;
  target: unknown;
  propertyName: string;
  newInstance: () => DatabaseBaseModel;
  /*
   * Runs the real DatabaseService length check over a row whose lastError
   * is `value`. This is the exact call the poller's recovery write makes
   * on its way to the database.
   */
  checkLastError: (value: string) => void;
  /*
   * A sibling column on the same model that is still declared LongText —
   * the shape lastError used to have. Used to prove the length check
   * really does reject at 500, so the tests above are falsifiable.
   */
  longTextSibling: string;
  checkLongTextSibling: (value: string) => void;
}

const LAST_ERROR_COLUMNS: Array<LastErrorColumn> = [
  {
    label: "GoogleSecOpsConnection.lastError",
    table: "GoogleSecOpsConnection",
    target: GoogleSecOpsConnection,
    propertyName: "lastError",
    newInstance: (): DatabaseBaseModel => {
      return new GoogleSecOpsConnection();
    },
    checkLastError: (value: string): void => {
      const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
      connection.lastError = value;
      GoogleSecOpsConnectionService["checkMaxLengthOfFields"](connection);
    },
    longTextSibling: "cursor",
    checkLongTextSibling: (value: string): void => {
      const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
      connection.cursor = value;
      GoogleSecOpsConnectionService["checkMaxLengthOfFields"](connection);
    },
  },
  {
    label: "DetectionRule.lastError",
    table: "DetectionRule",
    target: DetectionRule,
    propertyName: "lastError",
    newInstance: (): DatabaseBaseModel => {
      return new DetectionRule();
    },
    checkLastError: (value: string): void => {
      const rule: DetectionRule = new DetectionRule();
      rule.lastError = value;
      DetectionRuleService["checkMaxLengthOfFields"](rule);
    },
    longTextSibling: "description",
    checkLongTextSibling: (value: string): void => {
      const rule: DetectionRule = new DetectionRule();
      rule.description = value;
      DetectionRuleService["checkMaxLengthOfFields"](rule);
    },
  },
];

function columnArgs(column: LastErrorColumn): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === column.target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === column.propertyName;
    });

  if (!args) {
    throw new Error(`${column.label} has no TypeORM @Column metadata`);
  }

  return args;
}

function metadataFor(column: LastErrorColumn): TableColumnMetadata {
  return column.newInstance().getTableColumnMetadata(column.propertyName);
}

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("security-event lastError entity declarations", () => {
  test.each(LAST_ERROR_COLUMNS)(
    "$label is a text column, not a bounded varchar",
    (column: LastErrorColumn) => {
      // ColumnType.VeryLongText is what makes TypeORM emit Postgres `text`.
      expect(columnArgs(column).options.type).toBe(ColumnType.VeryLongText);
      expect(ColumnType.VeryLongText).toBe("text");
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label declares no length — a length on a text column is what regenerates drift",
    (column: LastErrorColumn) => {
      expect(columnArgs(column).options.length).toBeUndefined();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label stays nullable, so a connector that has never failed stores nothing",
    (column: LastErrorColumn) => {
      expect(columnArgs(column).options.nullable).toBe(true);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label reports TableColumnType.VeryLongText",
    (column: LastErrorColumn) => {
      expect(metadataFor(column).type).toBe(TableColumnType.VeryLongText);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label has no max length, so checkMaxLengthOfFields cannot reject a value written to it",
    (column: LastErrorColumn) => {
      /*
       * The invariant the outage turned on. checkMaxLengthOfFields only
       * validates a column when getMaxLengthFromTableColumnType returns a
       * number; undefined means the guard is skipped entirely, so the
       * poller's own error-recording write can never be the thing that
       * throws. Back when this was LongText it returned 500, the write
       * threw, and the poll loop died with it.
       */
      expect(
        getMaxLengthFromTableColumnType(metadataFor(column).type),
      ).toBeUndefined();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label stays readable on relation queries and optional",
    (column: LastErrorColumn) => {
      const metadata: TableColumnMetadata = metadataFor(column);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(metadata.required).toBeFalsy();
    },
  );

  test("the old LongText declaration really was the 500-character bound", () => {
    /*
     * Guards the premise of the whole fix. If LongText ever stopped
     * meaning 500, every "this used to overflow" claim below would be
     * describing a bound that no longer exists.
     */
    expect(getMaxLengthFromTableColumnType(TableColumnType.LongText)).toBe(
      ColumnLength.LongText,
    );
    expect(ColumnLength.LongText).toBe(500);
  });
});

describe("the widest error the producers can emit is storable", () => {
  let tokenExchangeError: Error;
  let alertsFetchError: Error;
  let widestClientError: Error;

  beforeAll(async () => {
    // Fails at the JWT-bearer token exchange: the first template.
    tokenExchangeError = await thrownClientError([
      { status: 503, body: OVERSIZED_RESPONSE_BODY },
    ]);

    // Token succeeds, the alerts call fails: the second template.
    alertsFetchError = await thrownClientError([
      successfulTokenResponse(),
      { status: 500, body: OVERSIZED_RESPONSE_BODY },
    ]);

    widestClientError =
      alertsFetchError.message.length >= tokenExchangeError.message.length
        ? alertsFetchError
        : tokenExchangeError;
  });

  test("the client has exactly two error templates and both echo the body under the same cap", () => {
    const limits: Array<number> = responseBodyEchoLimits();

    expect(limits).toHaveLength(2);
    for (const limit of limits) {
      expect(limit).toBe(responseBodyEchoLimit());
    }
  });

  test("each template is a fixed prefix plus a full-width echo of the response body", () => {
    const echoLimit: number = responseBodyEchoLimit();

    for (const error of [tokenExchangeError, alertsFetchError]) {
      // The tail is the echoed body, clipped to the client's own cap.
      expect(error.message.endsWith("x".repeat(echoLimit))).toBe(true);
      expect(error.message.endsWith("x".repeat(echoLimit + 1))).toBe(false);

      // ...and ahead of it, a non-empty prefix naming the HTTP status.
      const prefix: string = error.message.slice(
        0,
        error.message.length - echoLimit,
      );
      expect(prefix.length).toBeGreaterThan(0);
      expect(prefix).toContain("HTTP");
    }
  });

  test("the widest client error overflows the bound lastError used to carry", () => {
    /*
     * This is the string that killed the poller. Prefix + echoed body is
     * larger than varchar(500), so writing it back onto the row raised
     * BadDataException from inside the catch block.
     */
    const oldMaxLength: number = getMaxLengthFromTableColumnType(
      TableColumnType.LongText,
    )!;

    expect(widestClientError.message.length).toBeGreaterThan(oldMaxLength);

    // The overflow is not marginal: the echoed body alone fills the old column.
    expect(responseBodyEchoLimit()).toBe(oldMaxLength);
  });

  test("toMessage keeps the widest client error intact and under the connector cap", () => {
    const stored: string = ConnectorErrorMessage.toMessage(widestClientError);

    // Prefix + 500 still fits in 1000, so nothing is lost from an API error.
    expect(stored).toBe(widestClientError.message);
    expect(stored.length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
  });

  test.each(LAST_ERROR_COLUMNS)(
    "$label accepts the widest client error — the real length check does not reject it",
    (column: LastErrorColumn) => {
      /*
       * The end-to-end guard: the same value the poller would store, run
       * through the same DatabaseService validation that used to throw.
       * Pre-fix (LongText/varchar(500)) this raised BadDataException, the
       * throw escaped pollAllDueConnections, and the tick died.
       */
      const stored: string = ConnectorErrorMessage.toMessage(widestClientError);

      expect(() => {
        return column.checkLastError(stored);
      }).not.toThrow();
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$longTextSibling on the same model still rejects that very string, so the check is real",
    (column: LastErrorColumn) => {
      /*
       * Falsifies the test above. checkMaxLengthOfFields is not a no-op:
       * hand the identical string to a sibling column that is still
       * LongText and it throws exactly as lastError used to. The only
       * thing that changed is the declared column type.
       */
      const stored: string = ConnectorErrorMessage.toMessage(widestClientError);

      expect(
        getMaxLengthFromTableColumnType(
          column.newInstance().getTableColumnMetadata(column.longTextSibling)
            .type,
        ),
      ).toBe(ColumnLength.LongText);

      expect(() => {
        return column.checkLongTextSibling(stored);
      }).toThrow(`${column.longTextSibling} length cannot be more than`);
    },
  );

  test.each(LAST_ERROR_COLUMNS)(
    "$label accepts a clamped ClickHouse-sized error too",
    (column: LastErrorColumn) => {
      /*
       * The evaluator's side: a ClickHouse error echoes the whole
       * compiled query, so it has no natural bound. toMessage clamps it
       * to exactly MAX_CONNECTOR_ERROR_MESSAGE_LENGTH — still double the
       * old varchar(500), so widening the column is what makes even the
       * clamped value storable.
       */
      const clickhouseError: Error = new Error(
        `Code: 47. DB::Exception: Missing columns while processing query: ${"SELECT ".repeat(
          MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
        )}`,
      );

      const stored: string = ConnectorErrorMessage.toMessage(clickhouseError);

      expect(stored.length).toBe(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
      expect(stored.length).toBeGreaterThan(
        getMaxLengthFromTableColumnType(TableColumnType.LongText)!,
      );
      expect(() => {
        return column.checkLastError(stored);
      }).not.toThrow();
    },
  );

  test("the connector cap is the ceiling on anything that reaches these columns", () => {
    /*
     * Ties the clamp to the column: whatever the producers throw, what is
     * actually written is at most MAX_CONNECTOR_ERROR_MESSAGE_LENGTH, and
     * a text column has no bound to compare that against.
     */
    for (const error of [
      tokenExchangeError,
      alertsFetchError,
      new Error("y".repeat(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH * 10)),
    ]) {
      expect(ConnectorErrorMessage.toMessage(error).length).toBeLessThanOrEqual(
        MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
      );
    }
  });
});

describe("WidenSecurityEventLastErrorColumns1789600000000 SQL contract", () => {
  const migration: WidenSecurityEventLastErrorColumns1789600000000 =
    new WidenSecurityEventLastErrorColumns1789600000000();

  test("up() widens both tables' lastError to text", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(LAST_ERROR_COLUMNS.length);

    for (const column of LAST_ERROR_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE text`,
      );
    }
  });

  test("up() alters in place and never drops the column", async () => {
    /*
     * The DDL TypeORM generates for varchar -> text is DROP COLUMN +
     * ADD COLUMN, which would throw away every error already stored on
     * upgrade — including the ones a customer is mid-investigation on.
     * varchar -> text is binary-coercible, so ALTER ... TYPE is enough.
     */
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const sql of executedSql(query)) {
      expect(sql).toContain("ALTER COLUMN");
      expect(sql).toContain("TYPE text");
      expect(sql).not.toContain("DROP");
      expect(sql).not.toContain("DELETE");
    }

    expect(MIGRATION_SOURCE).not.toContain("DROP COLUMN");
  });

  test("up() touches no column other than the two lastError columns", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const altered: Array<string> = executedSql(query)
      .map((sql: string) => {
        const match: RegExpMatchArray | null = sql.match(
          /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)"/,
        );
        return match ? `${match[1]}.${match[2]}` : sql;
      })
      .sort();

    expect(altered).toEqual(
      LAST_ERROR_COLUMNS.map((column: LastErrorColumn) => {
        return `${column.table}.${column.propertyName}`;
      }).sort(),
    );
  });

  test("the migration widens exactly the columns the entities declare as text", async () => {
    /*
     * Catches the half-applied fix: widening the entity but not the
     * migration (or vice versa) leaves Postgres rejecting values the
     * model claims fit.
     */
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);
    const statements: Array<string> = executedSql(query);

    for (const column of LAST_ERROR_COLUMNS) {
      expect(columnArgs(column).options.type).toBe(ColumnType.VeryLongText);
      expect(statements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE ${ColumnType.VeryLongText}`,
      );
    }
  });

  test("down() truncates oversized rows BEFORE narrowing, so the revert cannot fail", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);

    /*
     * Per table, not globally: down() finishes one table before starting
     * the next, so what matters is that each table's clipping UPDATE
     * lands ahead of that same table's narrowing ALTER.
     */
    for (const column of LAST_ERROR_COLUMNS) {
      const clipIndex: number = statements.findIndex((sql: string) => {
        return (
          sql.startsWith(`UPDATE "${column.table}"`) &&
          sql.includes(`SET "${column.propertyName}" = LEFT(`) &&
          sql.includes(String(ColumnLength.LongText))
        );
      });
      const narrowIndex: number = statements.indexOf(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${ColumnLength.LongText})`,
      );

      expect(clipIndex).toBeGreaterThanOrEqual(0);
      expect(narrowIndex).toBeGreaterThanOrEqual(0);
      expect(clipIndex).toBeLessThan(narrowIndex);
    }
  });

  test("down() restores exactly the width the creating migration used", async () => {
    const createTables: AddDetectionRuleAndGoogleSecOpsConnection1788000000000 =
      new AddDetectionRuleAndGoogleSecOpsConnection1788000000000();
    const { runner: createRunner, query: createQuery } = makeQueryRunner();
    await createTables.up(createRunner);

    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    const createStatements: Array<string> = executedSql(createQuery);
    const downStatements: Array<string> = executedSql(downQuery);

    for (const column of LAST_ERROR_COLUMNS) {
      /*
       * Scope the search to the statement that creates THIS table — a
       * bare substring match would be satisfied by any of the other
       * varchar(500) columns in the same migration.
       */
      const declaringStatement: string | undefined = createStatements.find(
        (sql: string) => {
          return (
            sql.startsWith(`CREATE TABLE "${column.table}" (`) &&
            sql.includes(
              `"${column.propertyName}" character varying(${ColumnLength.LongText})`,
            )
          );
        },
      );

      // Production really is on varchar(500) until this migration runs.
      expect(declaringStatement).toBeDefined();

      expect(downStatements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${ColumnLength.LongText})`,
      );
    }
  });

  test("the class name carries its own timestamp, matching the file name", () => {
    expect(migration.name).toBe(
      "WidenSecurityEventLastErrorColumns1789600000000",
    );
  });
});

describe("WidenSecurityEventLastErrorColumns1789600000000 registration", () => {
  /*
   * The nastiest way this bug comes back: everything above passes on an
   * unregistered migration, because entity metadata does not care whether
   * the DDL ever ran. Postgres would stay at varchar(500), the poller's
   * recovery write would keep throwing, and the loop would keep dying —
   * with a green test suite.
   */
  test("is imported in SchemaMigrations/Index.ts", () => {
    expect(MIGRATIONS_INDEX_SOURCE).toContain(
      `import { WidenSecurityEventLastErrorColumns1789600000000 } from "./1789600000000-WidenSecurityEventLastErrorColumns";`,
    );
  });

  test("is listed in the exported migration array", () => {
    expect(SchemaMigrations).toContain(
      WidenSecurityEventLastErrorColumns1789600000000,
    );
    expect(MIGRATIONS_INDEX_SOURCE).toContain(
      "  WidenSecurityEventLastErrorColumns1789600000000,",
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === WidenSecurityEventLastErrorColumns1789600000000;
      },
    ).length;
    expect(occurrences).toBe(1);
  });

  test("runs after the migration that created both tables", () => {
    /*
     * TypeORM executes registered migrations in array order, and widening
     * a column on a table that does not exist yet fails outright.
     */
    const createIndex: number = SchemaMigrations.indexOf(
      AddDetectionRuleAndGoogleSecOpsConnection1788000000000,
    );
    const widenIndex: number = SchemaMigrations.indexOf(
      WidenSecurityEventLastErrorColumns1789600000000,
    );

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(widenIndex).toBeGreaterThan(createIndex);
  });
});
