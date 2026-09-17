import { AddTelemetryIngestionKeyType1791300000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1791300000000-AddTelemetryIngestionKeyType";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * The seven columns that split TelemetryIngestionKey into two credential
 * classes (Server and Browser), and the reason the DEFAULTS on three of them
 * are the entire backwards-compatibility story.
 *
 * Every ingestion key in existence the moment this migration runs is a live
 * credential sitting in a customer's collector config, CI secret or backend
 * process. The migration is only safe if those rows come out the other side
 * behaving EXACTLY as they did going in - Server, enabled, no expiry, no
 * origin check, no rate limit. Hence:
 *
 *   1. "keyType" is NOT NULL DEFAULT 'Server'. The ADD COLUMN itself
 *      backfills every existing row to what it already is, in one statement,
 *      with no separate UPDATE that could half-apply. NOT NULL with NO
 *      default is the failure this suite exists to catch: Postgres refuses
 *      such a column on a table that already holds rows, so the migration
 *      would abort on boot in every real installation and pass on every empty
 *      test database. Nullable would be survivable at runtime but pushes the
 *      question "what does NULL mean?" into the ingest guard, where both
 *      answers are bad - break every existing key, or treat an unknown key as
 *      the permissive class.
 *   2. "isEnabled" is NOT NULL DEFAULT true. The kill switch ships in the
 *      "on" position, so a key that worked yesterday keeps working.
 *   3. "allowedOrigins" is NOT NULL DEFAULT '[]', which is inert on the
 *      Server rows it backfills - the allowlist is only enforced on Browser
 *      keys, and no Browser key can exist until this migration has run.
 *   4. the remaining four are nullable with no default, and NULL carries the
 *      pre-existing meaning in each case: no pinned service name, no expiry,
 *      never seen used, no explicit rate limit.
 *
 * Registration is asserted too, because it fails silently: a migration absent
 * from SchemaMigrations/Index.ts never runs on boot, so the ingest path would
 * SELECT keyType/isEnabled/expiresAt off a table that does not have them and
 * 500 on the highest-traffic route in the product.
 *
 * The model half is asserted alongside the SQL, because a column that exists
 * in Postgres but not on the entity (or the reverse) is the same outage from
 * the customer's side - and because two of these columns carry access-control
 * decisions that are security properties rather than conventions. See the
 * access-control block at the bottom.
 */

const MIGRATION_NAME: string = "AddTelemetryIngestionKeyType1791300000000";

const TABLE_NAME: string = "TelemetryIngestionKey";

const ADDED_COLUMNS: Array<string> = [
  "keyType",
  "allowedOrigins",
  "pinnedServiceName",
  "isEnabled",
  "expiresAt",
  "lastUsedAt",
  "requestsPerMinuteLimit",
];

const EXPECTED_UP_STATEMENTS: Array<string> = [
  `ALTER TABLE "TelemetryIngestionKey" ADD "keyType" character varying(100) NOT NULL DEFAULT 'Server'`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "allowedOrigins" jsonb NOT NULL DEFAULT '[]'`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "pinnedServiceName" character varying(100)`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "isEnabled" boolean NOT NULL DEFAULT true`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "lastUsedAt" TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE "TelemetryIngestionKey" ADD "requestsPerMinuteLimit" integer`,
];

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

type RunMigrationFunction = () => Promise<Array<string>>;

const runUp: RunMigrationFunction = async (): Promise<Array<string>> => {
  const { runner, statements } = makeQueryRunner();

  await new AddTelemetryIngestionKeyType1791300000000().up(runner);

  return statements;
};

const runDown: RunMigrationFunction = async (): Promise<Array<string>> => {
  const { runner, statements } = makeQueryRunner();

  await new AddTelemetryIngestionKeyType1791300000000().down(runner);

  return statements;
};

type StatementForFunction = (
  statements: Array<string>,
  columnName: string,
) => string;

const statementFor: StatementForFunction = (
  statements: Array<string>,
  columnName: string,
): string => {
  const found: string | undefined = statements.find((statement: string) => {
    return statement.includes(`"${columnName}"`);
  });

  expect(found).toBeDefined();

  return found as string;
};

describe(`${MIGRATION_NAME} - SQL contract`, () => {
  test("up() adds all seven columns to the ingestion key table", async () => {
    const statements: Array<string> = await runUp();

    expect(statements).toEqual(EXPECTED_UP_STATEMENTS);
  });

  test("it adds seven columns and nothing else", async () => {
    const statements: Array<string> = await runUp();

    expect(statements).toHaveLength(ADDED_COLUMNS.length);

    for (const columnName of ADDED_COLUMNS) {
      expect(statementFor(statements, columnName)).toContain(
        `ALTER TABLE "${TABLE_NAME}" ADD "${columnName}"`,
      );
    }
  });

  /*
   * The backwards-compatibility guarantee, stated as an assertion.
   *
   * NOT NULL is what stops the ingest guard from ever having to decide what a
   * NULL key type means; the DEFAULT is what makes NOT NULL legal on a table
   * that already holds rows. Both halves are load-bearing, and the failure
   * mode of dropping the second one is invisible in CI and total in
   * production.
   */
  test("keyType is NOT NULL with a Server default, so every existing key backfills to what it already was", async () => {
    const statements: Array<string> = await runUp();
    const statement: string = statementFor(statements, "keyType");

    expect(statement).toContain("NOT NULL");
    expect(statement).toContain(
      `DEFAULT '${TelemetryIngestionKeyType.Server}'`,
    );
    expect(statement).toContain(`character varying(${ColumnLength.ShortText})`);
  });

  test("the backfilled key type is the Server enum value, not a lookalike string", async () => {
    const statements: Array<string> = await runUp();
    const statement: string = statementFor(statements, "keyType");

    /*
     * The ingest guard compares the stored string against this enum. A
     * default of 'server' or 'SERVER' would leave every pre-existing row
     * matching neither branch, and the browser-key restrictions would then
     * apply to nobody or to everybody depending on how that comparison
     * happens to be written.
     */
    const defaultValue: string = statement.split("DEFAULT ")[1]!.trim();

    expect(defaultValue).toBe(`'${TelemetryIngestionKeyType.Server}'`);
    expect(TelemetryIngestionKeyType.Server).toBe("Server");
  });

  test("isEnabled is NOT NULL DEFAULT true, so the upgrade switches no key off", async () => {
    const statements: Array<string> = await runUp();
    const statement: string = statementFor(statements, "isEnabled");

    expect(statement).toContain("NOT NULL");
    expect(statement).toContain("DEFAULT true");
    expect(statement).not.toContain("DEFAULT false");
  });

  test("allowedOrigins is NOT NULL DEFAULT '[]', which is inert on the Server keys it backfills", async () => {
    const statements: Array<string> = await runUp();
    const statement: string = statementFor(statements, "allowedOrigins");

    expect(statement).toContain("NOT NULL");
    expect(statement).toContain(`DEFAULT '[]'`);
    expect(statement).toContain("jsonb");
  });

  /*
   * NULL is a meaning on each of these four, and it is the meaning every key
   * had before this migration existed. A default on any of them would change
   * the behaviour of a deployed credential during an upgrade: an expiresAt
   * default would time out live keys, a requestsPerMinuteLimit default would
   * start throttling collectors that were never throttled, and a lastUsedAt
   * default would claim a key is in use when nothing has ever presented it.
   */
  test("the four optional columns are nullable with no default", async () => {
    const statements: Array<string> = await runUp();

    const nullableColumns: Array<string> = [
      "pinnedServiceName",
      "expiresAt",
      "lastUsedAt",
      "requestsPerMinuteLimit",
    ];

    for (const columnName of nullableColumns) {
      const statement: string = statementFor(statements, columnName);

      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    }
  });

  test("the two timestamps carry a timezone, so an expiry means the same in every region", async () => {
    const statements: Array<string> = await runUp();

    for (const columnName of ["expiresAt", "lastUsedAt"]) {
      expect(statementFor(statements, columnName)).toContain(
        "TIMESTAMP WITH TIME ZONE",
      );
    }
  });

  /*
   * The emitted SQL types have to be the ones the ORM emits for the same
   * ColumnType, or the entity and the table disagree the first time TypeORM
   * compares them.
   */
  test("the SQL types match the ORM column types the entity declares", async () => {
    const statements: Array<string> = await runUp();

    expect(statementFor(statements, "allowedOrigins")).toContain(
      ColumnType.JSON,
    );
    expect(statementFor(statements, "isEnabled")).toContain(ColumnType.Boolean);
    expect(statementFor(statements, "requestsPerMinuteLimit")).toContain(
      ColumnType.Number,
    );
  });

  /*
   * An ADD COLUMN with a constant default is a catalog-only change on modern
   * Postgres. A row-rewriting UPDATE in the same migration would hold a lock
   * proportional to the table size on an upgrade path nobody can pause.
   */
  test("up() only adds columns - it never rewrites, drops or retypes anything", async () => {
    const statements: Array<string> = await runUp();

    for (const statement of statements) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DELETE");
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("ALTER COLUMN");
    }
  });

  test("every statement touches only the TelemetryIngestionKey table", async () => {
    const upStatements: Array<string> = await runUp();
    const downStatements: Array<string> = await runDown();

    for (const statement of [...upStatements, ...downStatements]) {
      expect(statement).toContain(`ALTER TABLE "${TABLE_NAME}"`);
    }
  });

  test("down() drops exactly those seven columns, in reverse order", async () => {
    const statements: Array<string> = await runDown();

    expect(statements).toEqual([
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "requestsPerMinuteLimit"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "lastUsedAt"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "expiresAt"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "isEnabled"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "pinnedServiceName"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "allowedOrigins"`,
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "keyType"`,
    ]);
  });

  test("down() removes the same column set up() added - no more, no less", async () => {
    const upStatements: Array<string> = await runUp();
    const downStatements: Array<string> = await runDown();

    type ColumnsInFunction = (statements: Array<string>) => Array<string>;

    const columnsIn: ColumnsInFunction = (
      statements: Array<string>,
    ): Array<string> => {
      return statements
        .map((sql: string) => {
          const added: string | undefined = sql.split(`ADD "`)[1];

          if (added) {
            return added.split('"')[0]!;
          }

          return sql.split(`DROP COLUMN "`)[1]!.split('"')[0]!;
        })
        .sort();
    };

    expect(columnsIn(downStatements)).toEqual(columnsIn(upStatements));
    expect(columnsIn(upStatements)).toEqual([...ADDED_COLUMNS].sort());
  });
});

describe(`${MIGRATION_NAME} - registration`, () => {
  /*
   * The step that fails silently: an unregistered migration never runs, so
   * the columns are simply absent in a real deployment while the ingest path
   * selects keyType, isEnabled, expiresAt, allowedOrigins, pinnedServiceName
   * and requestsPerMinuteLimit on every request.
   */
  test("the migration is registered so it runs on boot", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return migration.name;
      },
    );

    expect(names).toContain(MIGRATION_NAME);
  });

  test("it is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: new () => MigrationInterface): boolean => {
        return migration.name === MIGRATION_NAME;
      },
    ).length;

    expect(occurrences).toBe(1);
  });
});

type ColumnSpec = [string, ColumnType, TableColumnType, boolean];

const columnSpecs: Array<ColumnSpec> = [
  ["keyType", ColumnType.ShortText, TableColumnType.ShortText, false],
  ["allowedOrigins", ColumnType.JSON, TableColumnType.JSON, false],
  ["pinnedServiceName", ColumnType.ShortText, TableColumnType.ShortText, true],
  ["isEnabled", ColumnType.Boolean, TableColumnType.Boolean, false],
  ["expiresAt", ColumnType.Date, TableColumnType.Date, true],
  ["lastUsedAt", ColumnType.Date, TableColumnType.Date, true],
  ["requestsPerMinuteLimit", ColumnType.Number, TableColumnType.Number, true],
];

type FindColumnFunction = (propertyName: string) => ColumnMetadataArgs;

const findColumn: FindColumnFunction = (
  propertyName: string,
): ColumnMetadataArgs => {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return (candidate.target as { name?: string })?.name === TABLE_NAME;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === propertyName;
    });

  expect(column).toBeDefined();

  return column as ColumnMetadataArgs;
};

type ColumnAccessControlView = {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
};

type AccessControlForFunction = (columnName: string) => ColumnAccessControlView;

const accessControlFor: AccessControlForFunction = (
  columnName: string,
): ColumnAccessControlView => {
  return new TelemetryIngestionKey().getColumnAccessControlFor(
    columnName,
  ) as ColumnAccessControlView;
};

describe.each(columnSpecs)(
  `${TABLE_NAME}.%s - entity declaration`,
  (
    propertyName: string,
    columnType: ColumnType,
    tableColumnType: TableColumnType,
    nullable: boolean,
  ) => {
    test("the entity declares the column the migration adds, with the same SQL type", () => {
      const column: ColumnMetadataArgs = findColumn(propertyName);

      expect(column.options.type).toBe(columnType);
      expect(Boolean(column.options.nullable)).toBe(nullable);
    });

    test("the dashboard-facing column metadata agrees with the database type", () => {
      const metadata: TableColumnMetadata =
        new TelemetryIngestionKey().getTableColumnMetadata(
          propertyName,
        ) as TableColumnMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.type).toBe(tableColumnType);
    });

    /*
     * All seven are readable by anyone who can read the key. These columns
     * ARE the answer to "why is my telemetry being refused?", and a control a
     * customer cannot see is a control they cannot fix.
     */
    test("anyone who can read the key can read the column", () => {
      const accessControl: ColumnAccessControlView =
        accessControlFor(propertyName);

      expect(accessControl.read).toContain(
        Permission.ReadTelemetryIngestionKey,
      );
      expect(accessControl.read).toContain(Permission.ProjectOwner);
      expect(accessControl.read).toContain(Permission.ProjectAdmin);
    });
  },
);

describe(`${TABLE_NAME} - entity defaults mirror the migration defaults`, () => {
  test("keyType defaults to Server on the entity as well as in the DDL", () => {
    const column: ColumnMetadataArgs = findColumn("keyType");

    expect(column.options.default).toBe(TelemetryIngestionKeyType.Server);
    expect(Number(column.options.length)).toBe(ColumnLength.ShortText);
  });

  test("isEnabled defaults to true on the entity as well as in the DDL", () => {
    const column: ColumnMetadataArgs = findColumn("isEnabled");

    expect(column.options.default).toBe(true);
  });

  /*
   * A jsonb default has to be written as a SQL expression rather than a JS
   * value: `default: []` makes TypeORM emit a Postgres array literal, and
   * every read of allowedOrigins would then have to cope with a shape that is
   * not a JSON list.
   */
  test("allowedOrigins defaults to the empty JSON array expression", () => {
    const column: ColumnMetadataArgs = findColumn("allowedOrigins");

    expect(typeof column.options.default).toBe("function");
    expect((column.options.default as () => string)()).toBe("'[]'");
  });
});

/*
 * ACCESS CONTROL. These are security assertions, not style ones: each empty
 * array below is the only thing standing between a form submission and a
 * control that stops working.
 */
describe(`${TABLE_NAME} - access control on the new columns`, () => {
  /*
   * keyType is IMMUTABLE: create + read, but `update: []`.
   *
   * The key type decides which surfaces the credential may reach, whether an
   * origin allowlist is enforced at all, and whether a default rate limit
   * applies. Editing it in place silently changes what an already-deployed
   * credential may do, in whichever direction is worse: Server -> Browser
   * breaks a collector that has been shipping for a year the moment it posts
   * with no Origin header, and Browser -> Server strips the origin binding
   * off a key that is still sitting in a public web page - the one control
   * stopping whoever scraped it from writing forged telemetry. The safe
   * alternative costs a minute: create a key of the right type, move traffic,
   * delete the old one.
   */
  test("keyType cannot be changed after the key is created", () => {
    const accessControl: ColumnAccessControlView = accessControlFor("keyType");

    expect(accessControl.update).toEqual([]);
    expect(accessControl.update).not.toContain(
      Permission.EditTelemetryIngestionKey,
    );
    expect(accessControl.create).toContain(
      Permission.CreateTelemetryIngestionKey,
    );
  });

  /*
   * lastUsedAt is written by the ingest path only: `create: []` AND
   * `update: []`. It exists to answer one question - "is anything still using
   * this key, so can I rotate or delete it?" - and an answer the customer can
   * type by hand answers nothing. Worse, a writable last-used stamp lets
   * whoever has been asked to prove a key is dead simply write that it is.
   */
  test("lastUsedAt is written only by the ingest path, never through the CRUD API", () => {
    const accessControl: ColumnAccessControlView =
      accessControlFor("lastUsedAt");

    expect(accessControl.create).toEqual([]);
    expect(accessControl.update).toEqual([]);
  });

  /*
   * The other five are deliberately editable, and that is the point of them:
   * the kill switch has to be flippable in one edit during an incident, and
   * an allowlist, expiry, pin or rate limit that could only be set at
   * creation time would force a key rotation just to tighten a control.
   */
  test("the five safety controls stay editable, so a leaked key can be contained without rotating it", () => {
    const editableColumns: Array<string> = [
      "allowedOrigins",
      "pinnedServiceName",
      "isEnabled",
      "expiresAt",
      "requestsPerMinuteLimit",
    ];

    for (const columnName of editableColumns) {
      const accessControl: ColumnAccessControlView =
        accessControlFor(columnName);

      expect(accessControl.update).toContain(
        Permission.EditTelemetryIngestionKey,
      );
      expect(accessControl.create).toContain(
        Permission.CreateTelemetryIngestionKey,
      );
    }
  });
});
