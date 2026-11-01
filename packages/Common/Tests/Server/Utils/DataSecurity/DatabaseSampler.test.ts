import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import * as mssql from "mssql";
import { createConnection } from "mysql2/promise";
import { Client } from "pg";
import {
  getConnectionSecrets,
  MAX_VALUE_LENGTH,
  parseSqlServerConnectionString,
  quoteMySqlIdentifier,
  quotePostgresIdentifier,
  quoteSqlServerIdentifier,
  sampleDatabase,
  sanitizeErrorMessage,
} from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";

jest.mock("pg", () => {
  return { __esModule: true, Client: jest.fn() };
});

jest.mock("mysql2/promise", () => {
  return { __esModule: true, createConnection: jest.fn() };
});

jest.mock("mssql", () => {
  return { __esModule: true, ConnectionPool: jest.fn() };
});

/*
 * A DATABASE, SAMPLED WITHOUT A WRITE AND WITHOUT A LEAK.
 *
 * The three drivers are replaced by one in-memory database that answers
 * the statements the sampler sends - its catalog queries and its SELECTs -
 * and records every one. What is held: each engine's read-only and timeout
 * statements are sent before anything is read; every name in a statement
 * is quoted the engine's way, a table named to break out of its quotes
 * included; the limits (rows, tables, the deadline) and the store's
 * exclusions are kept; columns are classified as schema.table.column; the
 * connection is closed whatever happens; and no error ever carries the
 * connection string's password.
 */

interface FakeTable {
  schema: string;
  table: string;
  estimatedRows: number;
  columns: Array<[string, string]>;
  rows: Array<Record<string, string | null>>;
}

interface FakeDatabase {
  tables: Array<FakeTable>;
  statements: Array<string>;
  // A statement containing this fails.
  failOn: string | null;
  // Called after each sampling SELECT is answered.
  afterSample: (() => void) | null;
  closed: number;
}

const database: FakeDatabase = {
  tables: [],
  statements: [],
  failOn: null,
  afterSample: null,
  closed: 0,
};

const PASSWORD: string = "S3cr3t-Passw0rd";

function people(count: number): Array<Record<string, string | null>> {
  const rows: Array<Record<string, string | null>> = [];

  for (let index: number = 0; index < count; index++) {
    rows.push({
      id: String(index + 1),
      email: `member${index}.lee@acme-corp.com`,
      ssn: `${536 + (index % 50)}-${40 + (index % 50)}-${4300 + index}`,
      password: index % 2 === 0 ? `letmein${index}` : `hunter${index}x`,
      is_admin: "false",
      note: "",
    });
  }

  return rows;
}

function standardTables(): Array<FakeTable> {
  return [
    {
      schema: "public",
      table: "users",
      estimatedRows: 1_000_000,
      columns: [
        ["id", "integer"],
        ["email", "character varying"],
        ["ssn", "text"],
        ["password", "text"],
        ["is_admin", "boolean"],
        ["avatar", "bytea"],
      ],
      rows: people(60),
    },
    {
      schema: "public",
      table: 'weird"name',
      estimatedRows: 10,
      columns: [["note", "text"]],
      rows: [{ note: "call me at member1.lee@acme-corp.com" }],
    },
    {
      schema: "audit",
      table: "events",
      estimatedRows: 0,
      columns: [["payload", "jsonb"]],
      rows: [],
    },
  ];
}

// One column of a sampler's SELECT: its quoted name, then its alias.
const SELECTED_COLUMN: RegExp =
  /([`"[][A-Za-z_]{1,64}[`"\]])(?: AS (?:text|CHAR)\)|\)|, 126\)), \d{1,6}\) AS [`"[]c(\d{1,4})/g;
const SQL_SERVER_PREFIX: string = "SET LOCK_TIMEOUT";

// A statement that could change something, which the sampler never sends.
const WRITING_STATEMENT: RegExp =
  /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/;

function unquote(identifier: string): string {
  const open: string = identifier[0]!;
  const close: string = open === "[" ? "]" : open;
  const inner: string = identifier.slice(1, -1);

  return inner.split(close + close).join(close);
}

// The rows a sampler's SELECT asks for, from the fake table it names.
function answerSelect(sql: string): Array<Record<string, unknown>> {
  const table: FakeTable | undefined = database.tables.find(
    (candidate: FakeTable) => {
      return (
        sql.includes(quotePostgresIdentifier(candidate.table)) ||
        sql.includes(quoteMySqlIdentifier(candidate.table)) ||
        sql.includes(quoteSqlServerIdentifier(candidate.table))
      );
    },
  );

  if (!table) {
    return [];
  }

  const aliases: Array<{ column: string; alias: string }> = [];

  for (const match of sql.matchAll(SELECTED_COLUMN)) {
    aliases.push({ column: unquote(match[1]!), alias: `c${match[2]}` });
  }

  const limit: RegExpMatchArray | null =
    sql.match(/LIMIT (\d+)/) || sql.match(/TOP \((\d+)\)/);
  const count: number = limit ? Number(limit[1]) : table.rows.length;

  return table.rows
    .slice(0, count)
    .map((row: Record<string, string | null>) => {
      const answer: Record<string, unknown> = {};

      for (const { column, alias } of aliases) {
        const value: string | null | undefined = row[column];

        answer[alias] =
          value === undefined || value === null
            ? null
            : value.slice(0, MAX_VALUE_LENGTH);
      }

      return answer;
    });
}

/*
 * What the fake database answers a statement with: SQL Server's come after
 * the SET statements that bound them, in one batch.
 */
function answer(
  batch: string,
  values: Array<unknown> = [],
): Array<Record<string, unknown>> {
  database.statements.push(batch);

  if (database.failOn && batch.includes(database.failOn)) {
    throw new Error(`relation is locked (while connected with ${PASSWORD})`);
  }

  const sql: string = batch.startsWith(SQL_SERVER_PREFIX)
    ? batch.slice(batch.lastIndexOf("; ") + 2)
    : batch;
  const lower: string = sql.toLowerCase();

  if (lower.includes("from information_schema.tables")) {
    return database.tables.map((table: FakeTable) => {
      return {
        table_schema: table.schema,
        table_name: table.table,
        estimated_rows: String(table.estimatedRows),
      };
    });
  }

  if (lower.includes("from information_schema.columns")) {
    const table: FakeTable | undefined = database.tables.find(
      (candidate: FakeTable) => {
        return candidate.schema === values[0] && candidate.table === values[1];
      },
    );

    return (table?.columns || []).map(([name, type]: [string, string]) => {
      return { column_name: name, data_type: type };
    });
  }

  if (lower.trimStart().startsWith("select")) {
    return answerSelect(sql);
  }

  return [];
}

const pgConfigs: Array<Record<string, unknown>> = [];
let pgConnectError: Error | null = null;

function usePostgres(): void {
  (Client as unknown as jest.Mock).mockImplementation((config: unknown) => {
    pgConfigs.push(config as Record<string, unknown>);

    return {
      connect: async (): Promise<void> => {
        if (pgConnectError) {
          throw pgConnectError;
        }
      },
      query: async (
        text: string,
        values?: Array<unknown>,
      ): Promise<{ rows: Array<Record<string, unknown>> }> => {
        const rows: Array<Record<string, unknown>> = answer(text, values);

        if (database.afterSample && text.startsWith("SELECT LEFT")) {
          database.afterSample();
        }

        return { rows };
      },
      end: async (): Promise<void> => {
        database.closed++;
      },
    };
  });
}

const mysqlOptions: Array<Record<string, unknown>> = [];
let mysqlRefuses: string | null = null;

function useMySql(): void {
  (createConnection as unknown as jest.Mock).mockImplementation(
    async (options: unknown): Promise<unknown> => {
      mysqlOptions.push(options as Record<string, unknown>);

      return {
        query: async (
          query: { sql: string; timeout?: number },
          values?: Array<unknown>,
        ): Promise<[unknown, unknown]> => {
          if (mysqlRefuses && query.sql.includes(mysqlRefuses)) {
            database.statements.push(query.sql);
            throw new Error("Unknown system variable");
          }

          return [answer(query.sql, values), []];
        },
        end: async (): Promise<void> => {
          database.closed++;
        },
        destroy: (): void => {
          database.closed++;
        },
      };
    },
  );
}

const mssqlConfigs: Array<Record<string, unknown>> = [];

function useSqlServer(): void {
  (mssql.ConnectionPool as unknown as jest.Mock).mockImplementation(
    (config: unknown) => {
      mssqlConfigs.push(config as Record<string, unknown>);

      return {
        connect: async (): Promise<void> => {},
        close: async (): Promise<void> => {
          database.closed++;
        },
        request: (): unknown => {
          const inputs: Array<unknown> = [];

          return {
            input: (_name: string, value: unknown): void => {
              inputs.push(value);
            },
            query: async (
              sql: string,
            ): Promise<{ recordset: Array<Record<string, unknown>> }> => {
              return { recordset: answer(sql, inputs) };
            },
          };
        },
      };
    },
  );
}

function options(
  limits: Partial<ContentScanOptions["limits"]> = {},
  rest: Partial<ContentScanOptions> = {},
): ContentScanOptions {
  return {
    limits: {
      maxObjects: 0,
      maxBytesPerObject: 0,
      maxBytesTotal: 64 * 1024 * 1024,
      maxRowsPerTable: 25,
      maxTables: 10,
      deadline: new Date(Date.now() + 60_000),
      ...limits,
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-project-key",
    ...rest,
  };
}

function selects(): Array<string> {
  return database.statements.filter((statement: string) => {
    return (
      statement.trimStart().startsWith("SELECT LEFT") ||
      statement.includes("SELECT TOP (25)") ||
      statement.includes("SELECT TOP (1)")
    );
  });
}

function locationOf(
  result: ContentScanResult,
  location: string,
): LocationFindings | undefined {
  return result.locations.find((found: LocationFindings) => {
    return found.location === location;
  });
}

function dataTypesAt(
  result: ContentScanResult,
  location: string,
): Array<string> {
  return (locationOf(result, location)?.classifications || []).map(
    (classification: FieldClassification) => {
      return classification.dataTypeId;
    },
  );
}

beforeEach(() => {
  database.tables = standardTables();
  database.statements = [];
  database.failOn = null;
  database.afterSample = null;
  database.closed = 0;
  pgConfigs.length = 0;
  pgConnectError = null;
  mysqlOptions.length = 0;
  mysqlRefuses = null;
  mssqlConfigs.length = 0;
  usePostgres();
  useMySql();
  useSqlServer();
});

const POSTGRES: { engine: "postgresql"; connectionString: string } = {
  engine: "postgresql",
  connectionString: `postgresql://reader:${PASSWORD}@db.internal:5432/app`,
};

describe("PostgreSQL", () => {
  test("reads inside read-only transactions with a statement and a lock timeout", async () => {
    await sampleDatabase(POSTGRES, options());

    expect(pgConfigs[0]).toMatchObject({
      connectionString: POSTGRES.connectionString,
      connectionTimeoutMillis: 10_000,
    });
    expect(database.statements[0]).toBe(
      "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
    );

    const firstSelect: number = database.statements.findIndex(
      (statement: string) => {
        return statement.startsWith("SELECT LEFT");
      },
    );

    expect(database.statements.slice(firstSelect - 4, firstSelect)).toEqual([
      "BEGIN",
      "SET TRANSACTION READ ONLY",
      expect.stringMatching(/^SET LOCAL statement_timeout = \d+$/),
      expect.stringMatching(/^SET LOCAL lock_timeout = \d+$/),
    ]);
    expect(database.statements[firstSelect + 1]).toBe("COMMIT");
    expect(
      database.statements.some((statement: string) => {
        return WRITING_STATEMENT.test(statement);
      }),
    ).toBe(false);
  });

  test("classifies each column as schema.table.column, and finds passwords kept as they are", async () => {
    const result: ContentScanResult = await sampleDatabase(POSTGRES, options());

    expect(locationOf(result, "public.users.email")?.locationKind).toBe(
      DataStoreLocationKind.Column,
    );
    expect(dataTypesAt(result, "public.users.email")).toEqual([
      "email-address",
    ]);
    expect(dataTypesAt(result, "public.users.ssn")).toEqual(["us-ssn"]);
    expect(result.plaintextPasswordFields).toEqual(["public.users.password"]);
    expect(result.fingerprints["email-address"]).toHaveLength(128);
    // The tables with rows first.
    expect(result.readLog).toEqual([
      "public.users",
      'public.weird"name',
      "audit.events",
    ]);
    expect(result.isComplete).toBe(true);
    // Every sampled row holds an email: the users table's million, and ten.
    expect(result.estimatedRecords).toBe(1_000_010);
  });

  test("quotes every name, one built to break out of its quotes included", async () => {
    await sampleDatabase(POSTGRES, options());

    const weird: string | undefined = selects().find((statement: string) => {
      return statement.includes("weird");
    });

    expect(weird).toContain('FROM "public"."weird""name"');
    expect(weird).toContain('LEFT(CAST("note" AS text), 2048) AS "c0"');
  });

  test("samples a large table with TABLESAMPLE, and holds every table to maxRowsPerTable", async () => {
    const result: ContentScanResult = await sampleDatabase(POSTGRES, options());
    const users: Array<string> = selects().filter((statement: string) => {
      return statement.includes('"public"."users"');
    });

    expect(users[0]).toMatch(/TABLESAMPLE SYSTEM \(\d+\.\d{4}\) LIMIT 25$/);
    for (const statement of selects()) {
      expect(statement).toMatch(/LIMIT 25$/);
    }
    expect(result.rowsRead).toBeLessThanOrEqual(25 * 3);
  });

  test("reads no column that cannot hold sensitive data", async () => {
    await sampleDatabase(POSTGRES, options());

    const users: string = selects().find((statement: string) => {
      return statement.includes('"public"."users"');
    })!;

    expect(users).not.toContain('"is_admin"');
    expect(users).not.toContain('"avatar"');
    expect(users).toContain('"email"');
  });

  test("reads at most maxTables tables, the ones with rows first, and says what it left", async () => {
    const result: ContentScanResult = await sampleDatabase(
      POSTGRES,
      options({ maxTables: 2 }),
    );

    expect(result.readLog).toEqual(["public.users", 'public.weird"name']);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      "1 tables were not sampled: the scan reads at most 2 tables.",
    );
  });

  test("leaves out the tables and columns the store excludes", async () => {
    const result: ContentScanResult = await sampleDatabase(
      POSTGRES,
      options({}, { exclusions: ["audit", "users.ssn", 'Public.Weird"Name'] }),
    );

    expect(result.readLog).toEqual(["public.users"]);
    expect(selects().join("\n")).not.toContain('"ssn"');
    expect(locationOf(result, "public.users.ssn")).toBeUndefined();
  });

  test("a table that cannot be read is a warning without the password, and the connection is closed", async () => {
    database.failOn = '"public"."users"';

    const result: ContentScanResult = await sampleDatabase(POSTGRES, options());

    expect(result.isComplete).toBe(false);
    expect(result.warnings.join("\n")).toContain(
      "Could not sample public.users",
    );
    expect(result.warnings.join("\n")).not.toContain(PASSWORD);
    expect(database.statements).toContain("ROLLBACK");
    expect(database.closed).toBe(1);
    // The other tables are still read.
    expect(result.readLog).toContain('public.weird"name');
  });

  test("a connection that cannot be made is thrown, without the password, and closed", async () => {
    pgConnectError = new Error(
      `password authentication failed for "reader" using ${PASSWORD}`,
    );

    await expect(sampleDatabase(POSTGRES, options())).rejects.toThrow(
      'Could not connect to the database: password authentication failed for "reader" using ****',
    );
    expect(database.closed).toBe(1);
  });

  test("past its deadline, does not even connect", async () => {
    const result: ContentScanResult = await sampleDatabase(
      POSTGRES,
      options({ deadline: new Date(Date.now() - 1) }),
    );

    expect(pgConfigs).toEqual([]);
    expect(database.statements).toEqual([]);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toEqual([
      "The scan reached its time limit before it could connect.",
    ]);
  });

  test("stops at the deadline between tables, and closes the connection", async () => {
    const scan: ContentScanOptions = options();
    const realNow: () => number = Date.now;
    let pastDeadline: boolean = false;

    /*
     * The clock passes the deadline while the first table is read - on the
     * test's own clock, so a busy runner cannot move it.
     */
    database.afterSample = (): void => {
      pastDeadline = true;
    };

    const clock: SpyInstance<() => number> = jest
      .spyOn(Date, "now")
      .mockImplementation((): number => {
        return pastDeadline ? scan.limits.deadline.getTime() + 1 : realNow();
      });

    let result: ContentScanResult;

    try {
      result = await sampleDatabase(POSTGRES, scan);
    } finally {
      clock.mockRestore();
    }

    expect(result.objectsRead).toBe(1);
    expect(result.isComplete).toBe(false);
    expect(result.warnings).toContain(
      "The scan reached its time limit after 1 of 3 tables.",
    );
    expect(database.closed).toBe(1);
  });
});

describe("MySQL and MariaDB", () => {
  const MYSQL: { engine: "mysql"; connectionString: string } = {
    engine: "mysql",
    connectionString: `mariadb://reader:${PASSWORD}@db.internal:3306/app`,
  };

  test("makes the session read-only and bounded, then reads each table in a READ ONLY transaction", async () => {
    database.tables[1]!.table = "odd`name";

    const result: ContentScanResult = await sampleDatabase(MYSQL, options());

    expect(mysqlOptions[0]).toMatchObject({
      uri: `mysql://reader:${PASSWORD}@db.internal:3306/app`,
      multipleStatements: false,
      connectTimeout: 10_000,
    });
    expect(database.statements.slice(0, 3)).toEqual([
      "SET SESSION TRANSACTION READ ONLY",
      "SET SESSION lock_wait_timeout = 5",
      "SET SESSION MAX_EXECUTION_TIME = 30000",
    ]);
    expect(database.statements).toContain("START TRANSACTION READ ONLY");

    const odd: string | undefined = selects().find((statement: string) => {
      return statement.includes("odd");
    });

    expect(odd).toContain("FROM `public`.`odd``name` LIMIT 25");
    expect(odd).toContain("LEFT(CAST(`note` AS CHAR), 2048) AS `c0`");
    expect(dataTypesAt(result, "public.users.email")).toEqual([
      "email-address",
    ]);
    expect(database.closed).toBe(1);
  });

  test("on MariaDB, bounds statements with max_statement_time instead", async () => {
    mysqlRefuses = "MAX_EXECUTION_TIME";

    await sampleDatabase(MYSQL, options());

    expect(database.statements).toContain(
      "SET SESSION max_statement_time = 30",
    );
  });
});

describe("SQL Server", () => {
  const SQL_SERVER: { engine: "sqlserver"; connectionString: string } = {
    engine: "sqlserver",
    connectionString: `mssql://reader:${encodeURIComponent(PASSWORD)}@db.internal:1433/app?encrypt=true`,
  };

  test("asks for a read-only replica, bounds every statement, and quotes names in brackets", async () => {
    database.tables = [
      {
        schema: "dbo",
        table: "odd]name",
        estimatedRows: 5,
        columns: [
          ["Email", "nvarchar"],
          ["Born", "date"],
          ["Id", "uniqueidentifier"],
        ],
        rows: [{ Email: "member1.lee@acme-corp.com", Born: "1984-03-12" }],
      },
    ];

    const result: ContentScanResult = await sampleDatabase(
      SQL_SERVER,
      options(),
    );

    expect(mssqlConfigs[0]).toMatchObject({
      server: "db.internal",
      port: 1433,
      user: "reader",
      password: PASSWORD,
      database: "app",
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
      pool: { max: 1 },
      options: { readOnlyIntent: true, encrypt: true },
    });

    for (const statement of database.statements) {
      expect(
        statement.startsWith(
          "SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW; SET TEXTSIZE",
        ),
      ).toBe(true);
    }

    const sample: string = database.statements.find((statement: string) => {
      return statement.includes("SELECT TOP (25)");
    })!;

    expect(sample).toContain("FROM [dbo].[odd]]name]");
    expect(sample).toContain(
      "LEFT(CONVERT(NVARCHAR(MAX), [Email]), 2048) AS [c0]",
    );
    expect(sample).toContain(
      "LEFT(CONVERT(NVARCHAR(MAX), [Born], 126), 2048) AS [c1]",
    );
    expect(sample).not.toContain("[Id]");
    expect(dataTypesAt(result, "dbo.odd]name.Email")).toEqual([
      "email-address",
    ]);
    expect(database.closed).toBe(1);
  });
});

describe("connection strings", () => {
  test("SQL Server's are read as a URL, JDBC's or ADO.NET's", () => {
    expect(
      parseSqlServerConnectionString(
        "sqlserver://db.internal:1433;databaseName=app;user=reader;password=pw;trustServerCertificate=true",
      ),
    ).toMatchObject({
      server: "db.internal",
      port: 1433,
      user: "reader",
      password: "pw",
      database: "app",
      options: { trustServerCertificate: true },
    });

    (
      mssql.ConnectionPool as unknown as { parseConnectionString: unknown }
    ).parseConnectionString = jest
      .fn()
      .mockReturnValue({ server: "ado.internal" });

    expect(
      parseSqlServerConnectionString(
        "Server=ado.internal;Database=app;User Id=reader;Password=pw",
      ),
    ).toEqual({ server: "ado.internal" });
  });

  test("a password is taken out of every message, as written and decoded", () => {
    const secrets: Array<string> = getConnectionSecrets(
      "postgresql://reader:p%40ss-w0rd@db.internal/app",
    );

    expect(
      sanitizeErrorMessage(
        new Error("failed for p@ss-w0rd and p%40ss-w0rd"),
        secrets,
      ),
    ).toBe("failed for **** and ****");
    expect(
      sanitizeErrorMessage(
        "login failed",
        getConnectionSecrets("Server=x;User Id=reader;Password=TopSecret1;"),
      ),
    ).toBe("login failed");
    expect(
      sanitizeErrorMessage(
        new Error("bad TopSecret1"),
        getConnectionSecrets("Server=x;User Id=reader;Password=TopSecret1;"),
      ),
    ).toBe("bad ****");
  });

  test("names are quoted the engine's way, and a name no catalog holds is refused", () => {
    expect(quotePostgresIdentifier('a"b')).toBe('"a""b"');
    expect(quoteMySqlIdentifier("a`b")).toBe("`a``b`");
    expect(quoteSqlServerIdentifier("a]b")).toBe("[a]]b]");
    expect(() => {
      return quotePostgresIdentifier("a\u0000b");
    }).toThrow();
    expect(() => {
      return quoteSqlServerIdentifier("x".repeat(129));
    }).toThrow();
  });
});
