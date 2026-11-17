import CredentialsAtRest, {
  CREDENTIALS_AT_REST_JOB_NAME,
  CredentialsAtRestGroup,
  CredentialsAtRestOutcome,
  CredentialsAtRestRun,
  CredentialsGroupPass,
  getProtectedMarkerName,
} from "../../../FeatureSet/Workers/Utils/CredentialsAtRest";
import DataMigrations from "../../../FeatureSet/Workers/DataMigrations/Index";
import MaskWebhookAddressesInLogs from "../../../FeatureSet/Workers/DataMigrations/MaskWebhookAddressesInLogs";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  EncryptColumnPass,
  ModelRepository,
} from "../../../FeatureSet/Workers/Utils/EncryptColumnInPlace";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Encryption from "Common/Server/Utils/Encryption";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import {
  SETTLE_PERIOD_MS,
  SqlRunner,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE CREDENTIALSATREST:ENCRYPTINPLACE JOB (#9266).
 *
 * The data migrations that used to encrypt a project's mail, chat and
 * webhook credentials, the webhook addresses, the SNMP credentials, the
 * certificate keys, the server's own credentials and the Twilio tokens in
 * place at the upgrade now change nothing there: a server of the release
 * before, still running while the upgrade rolls out, reads each column as
 * it is stored, and would send with a ciphertext. A day after each ran, the
 * job encrypts what is still stored as written. With the DataMigrations
 * table and a credentials table in memory:
 *
 *   - before the upgrade's migration ran, and within the day after it, a run
 *     changes nothing: every value stays as the release before reads it;
 *   - a day after, it encrypts every value stored as written - those a
 *     server of the release before saved meanwhile too - and once a pass
 *     finds nothing left, records the migration's marker, once;
 *   - on an install that ran the migration when it still encrypted at once,
 *     its pass comes at once and encrypts only what is left: no ciphertext
 *     is encrypted twice;
 *   - a value it cannot write, a page it cannot read, a run's deadline
 *     (before a group's pass, or before a column of it is read): nothing
 *     recorded, and the next run goes on;
 *   - its groups are every data migration that encrypted in place, each
 *     one's pass over every column of its migration, and each column one
 *     its model keeps encrypted;
 *   - the job is registered, every 15 minutes and at startup.
 */

const MIGRATION: string = "EncryptSomeCredentials";
const UPGRADED_AT: Date = new Date("2026-11-17T08:00:00.000Z");
const A_DAY_LATER: Date = new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS);

const TABLE: string = "SomeCredential";
const COLUMN: string = "secret";

const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;
const LIMIT_CLAUSE: RegExp = /LIMIT (\d+)/;

// The DataMigrations table: the rows it holds, by name.
let recorded: Map<string, Date>;

const runner: SqlRunner = {
  query: async (
    _sql: string,
    parameters?: Array<unknown>,
  ): Promise<unknown> => {
    const executedAt: Date | undefined = recorded.get(String(parameters?.[0]));
    return [{ executedAt: executedAt || null }];
  },
};

type Row = { _id: string; secret: string | null };

interface Table {
  rows: Array<Row>;
  statements: Array<{ sql: string; params: Array<unknown> }>;
  failWriteFor: Set<string>;
  // Whether a page's read fails, as a lost connection's would.
  failRead: boolean;
  // Run when a page has been read, before its rows are written.
  afterRead: (() => void) | null;
  repository: ModelRepository;
}

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function secretOf(index: number): string {
  return `smtp-password-${index} with spaces & symbols !#%`;
}

// A table in memory that answers EncryptColumnInPlace's two statements as Postgres would.
function makeTable(rows: Array<Row>): Table {
  const table: Table = {
    rows: rows.map((row: Row): Row => {
      return { ...row };
    }),
    statements: [],
    failWriteFor: new Set<string>(),
    failRead: false,
    afterRead: null,
    repository: undefined as unknown as ModelRepository,
  };

  const query: (
    sql: string,
    params?: Array<unknown>,
  ) => Promise<unknown> = async (
    sql: string,
    params: Array<unknown> = [],
  ): Promise<unknown> => {
    table.statements.push({ sql: sql, params: [...params] });

    if (SELECT_START.test(sql)) {
      if (table.failRead) {
        throw new Error("the connection was lost");
      }

      const prefix: string = String(params[0]).replace(/%$/, "");
      const afterId: string | undefined =
        params.length > 1 ? String(params[1]) : undefined;
      const limit: number = Number(LIMIT_CLAUSE.exec(sql)?.[1] || "0");

      const page: Array<Record<string, unknown>> = table.rows
        .filter((row: Row): boolean => {
          return (
            row.secret !== null &&
            row.secret !== "" &&
            !row.secret.startsWith(prefix) &&
            (afterId === undefined || row._id > afterId)
          );
        })
        .sort((left: Row, right: Row): number => {
          return left._id < right._id ? -1 : 1;
        })
        .slice(0, limit)
        .map((row: Row): Record<string, unknown> => {
          return { _id: row._id, [COLUMN]: row.secret };
        });

      if (table.afterRead) {
        table.afterRead();
      }

      return page;
    }

    if (UPDATE_START.test(sql)) {
      const [encrypted, id, previous] = params as [string, string, string];

      if (table.failWriteFor.has(id)) {
        throw new Error(`could not write ${previous}`);
      }

      for (const row of table.rows) {
        if (row._id === id && row.secret === previous) {
          row.secret = encrypted;
        }
      }

      return [];
    }

    throw new Error(`an unexpected statement: ${sql}`);
  };

  table.repository = {
    metadata: { tableName: TABLE },
    manager: { query: query },
  } as unknown as ModelRepository;

  return table;
}

function groupOver(table: Table): CredentialsAtRestGroup {
  return CredentialsAtRest.columnsGroup({
    migrationName: MIGRATION,
    description: "some credentials",
    getTargets: (): Array<ColumnToEncrypt> => {
      return [
        { kind: "credential", repository: table.repository, column: COLUMN },
      ];
    },
  });
}

async function runAt(
  table: Table,
  now: Date,
  deadline?: JobDeadline | undefined,
): Promise<CredentialsAtRestOutcome> {
  return await CredentialsAtRest.runGroup({
    runner: runner,
    now: now,
    group: groupOver(table),
    deadline: deadline,
  });
}

function updates(table: Table): Array<{ sql: string; params: Array<unknown> }> {
  return table.statements.filter((statement: { sql: string }): boolean => {
    return UPDATE_START.test(statement.sql);
  });
}

let create: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  recorded = new Map<string, Date>();
  create = jest
    .spyOn(DataMigrationService, "create")
    .mockImplementation((async (createBy: {
      data: { name: string; executedAt: Date };
    }) => {
      recorded.set(createBy.data.name, createBy.data.executedAt);
      return createBy.data;
    }) as never);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run, for one data migration's credentials", () => {
  test("before the upgrade's data migration ran, changes nothing", async () => {
    const table: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);

    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.NotUpgradedYet,
    );
    expect(table.statements).toHaveLength(0);
  });

  test("within the day after it, changes nothing: the release before reads every value as written", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);

    expect(await runAt(table, new Date(A_DAY_LATER.getTime() - 1))).toBe(
      CredentialsAtRestOutcome.Waiting,
    );
    expect(table.statements).toHaveLength(0);
    expect(table.rows[0]!.secret).toBe(secretOf(1));
    expect(create).not.toHaveBeenCalled();
  });

  test("a day after, encrypts every value stored as written, the ones the release before saved meanwhile too, and records it once", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([
      { _id: idOf(1), secret: secretOf(1) },
      { _id: idOf(2), secret: null },
      { _id: idOf(3), secret: "" },
    ]);

    // Within the day, a server of the release before saves one as written.
    expect(
      await runAt(table, new Date(UPGRADED_AT.getTime() + 60 * 60 * 1000)),
    ).toBe(CredentialsAtRestOutcome.Waiting);
    table.rows.push({ _id: idOf(4), secret: secretOf(4) });

    // The run that encrypts them is not yet the one that finds none left.
    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );
    expect(create).not.toHaveBeenCalled();

    for (const index of [1, 4]) {
      const stored: string = table.rows.find((row: Row): boolean => {
        return row._id === idOf(index);
      })!.secret!;

      expect(Encryption.looksEncrypted(stored)).toBe(true);
      expect(await Encryption.decrypt(stored)).toBe(secretOf(index));
    }

    expect(table.rows[1]!.secret).toBeNull();
    expect(table.rows[2]!.secret).toBe("");

    // The next run finds nothing left, and records it.
    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.Protected,
    );
    expect(recorded.get(getProtectedMarkerName(MIGRATION))).toEqual(
      A_DAY_LATER,
    );
    expect(create).toHaveBeenCalledTimes(1);

    // Once recorded, a run reads no value at all.
    const statementsBefore: number = table.statements.length;

    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.AlreadyProtected,
    );
    expect(table.statements).toHaveLength(statementsBefore);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("on an install that ran the migration when it still encrypted at once, encrypts only what is left: never a ciphertext twice", async () => {
    // Ran in place long ago (15.0.0, a build of main): no wait is left.
    recorded.set(
      MIGRATION,
      new Date(UPGRADED_AT.getTime() - 7 * SETTLE_PERIOD_MS),
    );
    const ciphertext: string = await Encryption.encrypt(secretOf(1));
    const table: Table = makeTable([
      { _id: idOf(1), secret: ciphertext },
      // Saved as written by a server of the release before during that upgrade.
      { _id: idOf(2), secret: secretOf(2) },
    ]);

    expect(await runAt(table, UPGRADED_AT)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );

    // Byte for byte the ciphertext it held: decrypted once, it is the value.
    expect(table.rows[0]!.secret).toBe(ciphertext);
    expect(await Encryption.decrypt(table.rows[0]!.secret!)).toBe(secretOf(1));
    expect(await Encryption.decrypt(table.rows[1]!.secret!)).toBe(secretOf(2));
    expect(updates(table)).toHaveLength(1);

    expect(await runAt(table, UPGRADED_AT)).toBe(
      CredentialsAtRestOutcome.Protected,
    );
  });

  test("a value it cannot write is not recorded as protected, and the next run goes on", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([
      { _id: idOf(1), secret: secretOf(1) },
      { _id: idOf(2), secret: secretOf(2) },
    ]);
    table.failWriteFor.add(idOf(1));

    for (let run: number = 0; run < 3; run++) {
      expect(await runAt(table, A_DAY_LATER)).toBe(
        CredentialsAtRestOutcome.NotDoneYet,
      );
    }

    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
    // It still reads as itself, and the other was encrypted.
    expect(table.rows[0]!.secret).toBe(secretOf(1));
    expect(Encryption.looksEncrypted(table.rows[1]!.secret!)).toBe(true);

    // No value in any log line.
    expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toContain(
      secretOf(1),
    );

    table.failWriteFor.clear();

    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );
    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.Protected,
    );
  });

  test("a page it cannot read is not recorded as protected, though it read no value", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);
    table.failRead = true;

    for (let run: number = 0; run < 2; run++) {
      expect(await runAt(table, A_DAY_LATER)).toBe(
        CredentialsAtRestOutcome.NotDoneYet,
      );
    }

    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
    expect(table.rows[0]!.secret).toBe(secretOf(1));

    table.failRead = false;

    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );
    expect(Encryption.looksEncrypted(table.rows[0]!.secret!)).toBe(true);
    expect(await runAt(table, A_DAY_LATER)).toBe(
      CredentialsAtRestOutcome.Protected,
    );
  });

  test("a run whose deadline has passed changes nothing and records nothing", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);
    const deadline: JobDeadline = new JobDeadline();

    deadline.end(new Error("the run's time limit"));

    expect(await runAt(table, A_DAY_LATER, deadline)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );
    expect(table.statements).toHaveLength(0);
    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
  });

  test("a run whose deadline has passed starts no group's pass, whatever the pass would make of it", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const deadline: JobDeadline = new JobDeadline();
    let passes: number = 0;

    deadline.end(new Error("the run's time limit"));

    expect(
      await CredentialsAtRest.runGroup({
        runner: runner,
        now: A_DAY_LATER,
        deadline: deadline,
        group: {
          migrationName: MIGRATION,
          description: "some credentials",
          // A pass that would call the group done, had it started.
          pass: async (): Promise<CredentialsGroupPass> => {
            passes++;
            return { isDone: true, written: 0 };
          },
        },
      }),
    ).toBe(CredentialsAtRestOutcome.NotDoneYet);
    expect(passes).toBe(0);
    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
  });

  test("a deadline that passes before a column is read leaves the group not done, though no column read held a value", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    // The first column holds only a ciphertext: its read finds nothing.
    const first: Table = makeTable([
      { _id: idOf(1), secret: await Encryption.encrypt(secretOf(1)) },
    ]);
    // The second still holds a value as written.
    const second: Table = makeTable([{ _id: idOf(2), secret: secretOf(2) }]);
    const deadline: JobDeadline = new JobDeadline();

    // The time limit runs out as the first column's page is read.
    first.afterRead = (): void => {
      deadline.end(new Error("the run's time limit"));
    };

    const group: CredentialsAtRestGroup = CredentialsAtRest.columnsGroup({
      migrationName: MIGRATION,
      description: "some credentials",
      getTargets: (): Array<ColumnToEncrypt> => {
        return [
          { kind: "credential", repository: first.repository, column: COLUMN },
          {
            kind: "credential",
            repository: second.repository,
            column: COLUMN,
          },
        ];
      },
    });

    expect(
      await CredentialsAtRest.runGroup({
        runner: runner,
        now: A_DAY_LATER,
        deadline: deadline,
        group: group,
      }),
    ).toBe(CredentialsAtRestOutcome.NotDoneYet);
    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
    expect(second.statements).toHaveLength(0);
    expect(second.rows[0]!.secret).toBe(secretOf(2));

    // The next run, with time to go, reads the second column.
    expect(
      await CredentialsAtRest.runGroup({
        runner: runner,
        now: A_DAY_LATER,
        group: group,
      }),
    ).toBe(CredentialsAtRestOutcome.NotDoneYet);
    expect(Encryption.looksEncrypted(second.rows[0]!.secret!)).toBe(true);
  });

  test("a pass cut short by the deadline is not done: what it wrote stays, the next run goes on", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);
    const deadline: JobDeadline = new JobDeadline();

    // The time limit runs out as the first page is read.
    table.afterRead = (): void => {
      deadline.end(new Error("the run's time limit"));
    };

    expect(await runAt(table, A_DAY_LATER, deadline)).toBe(
      CredentialsAtRestOutcome.NotDoneYet,
    );
    expect(recorded.has(getProtectedMarkerName(MIGRATION))).toBe(false);
  });

  test("two runs at once encrypt each value once", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    const table: Table = makeTable([
      { _id: idOf(1), secret: secretOf(1) },
      { _id: idOf(2), secret: secretOf(2) },
    ]);

    await Promise.all([runAt(table, A_DAY_LATER), runAt(table, A_DAY_LATER)]);

    for (const [index, row] of table.rows.entries()) {
      // Decrypted once, each is the value: not a ciphertext of a ciphertext.
      expect(await Encryption.decrypt(row.secret!)).toBe(secretOf(index + 1));
    }
  });

  test("run goes through every group, and one that fails costs the others nothing", async () => {
    recorded.set(MIGRATION, UPGRADED_AT);
    recorded.set("EncryptOtherCredentials", UPGRADED_AT);
    const broken: Table = makeTable([{ _id: idOf(1), secret: secretOf(1) }]);
    const other: Table = makeTable([{ _id: idOf(2), secret: secretOf(2) }]);
    broken.failWriteFor.add(idOf(1));

    const otherGroup: CredentialsAtRestGroup = CredentialsAtRest.columnsGroup({
      migrationName: "EncryptOtherCredentials",
      description: "other credentials",
      getTargets: (): Array<ColumnToEncrypt> => {
        return [
          { kind: "credential", repository: other.repository, column: COLUMN },
        ];
      },
    });

    const runs: Array<CredentialsAtRestRun> = await CredentialsAtRest.run({
      runner: runner,
      now: A_DAY_LATER,
      groups: [groupOver(broken), otherGroup],
    });

    expect(runs).toEqual([
      {
        migrationName: MIGRATION,
        outcome: CredentialsAtRestOutcome.NotDoneYet,
      },
      {
        migrationName: "EncryptOtherCredentials",
        outcome: CredentialsAtRestOutcome.NotDoneYet,
      },
    ]);
    expect(Encryption.looksEncrypted(other.rows[0]!.secret!)).toBe(true);
  });

  test("the webhook logs' mask, a day after it ran, masks what was logged since the day before it", async () => {
    const maskedAt: Date = UPGRADED_AT;
    recorded.set("MaskWebhookAddressesInLogs", maskedAt);
    const maskLogs: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MaskWebhookAddressesInLogs.prototype, "maskLogs")
      .mockResolvedValue(true as never);

    const group: CredentialsAtRestGroup = CredentialsAtRest.getGroups().find(
      (candidate: CredentialsAtRestGroup): boolean => {
        return candidate.migrationName === "MaskWebhookAddressesInLogs";
      },
    )!;

    expect(
      await CredentialsAtRest.runGroup({
        runner: runner,
        now: new Date(maskedAt.getTime() + 60 * 1000),
        group: group,
      }),
    ).toBe(CredentialsAtRestOutcome.Waiting);
    expect(maskLogs).not.toHaveBeenCalled();

    expect(
      await CredentialsAtRest.runGroup({
        runner: runner,
        now: new Date(maskedAt.getTime() + SETTLE_PERIOD_MS),
        group: group,
      }),
    ).toBe(CredentialsAtRestOutcome.Protected);

    expect(maskLogs).toHaveBeenCalledTimes(1);
    expect(
      (maskLogs.mock.calls[0]![0] as { since: Date }).since.getTime(),
    ).toBe(maskedAt.getTime() - SETTLE_PERIOD_MS);
  });
});

describe("the groups", () => {
  const groups: Array<CredentialsAtRestGroup> = CredentialsAtRest.getGroups();

  // Every data migration that encrypted values in place, or masked them, when it ran.
  const EVERY_IN_PLACE_MIGRATION: Array<string> = [
    "EncryptProjectCallSMSConfigTwilioAuthToken",
    "EncryptGlobalConfigCredentials",
    "EncryptUploadedCertificateKeys",
    "EncryptLetsEncryptKeys",
    "EncryptProjectCredentials",
    "EncryptWebhookAddresses",
    "EncryptSnmpCredentials",
    "MaskWebhookAddressesInLogs",
  ];

  test("are every data migration that changed values in place, in the order they run", () => {
    const registered: Array<string> = DataMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      groups.map((group: CredentialsAtRestGroup): string => {
        return group.migrationName;
      }),
    ).toEqual(EVERY_IN_PLACE_MIGRATION);

    const positions: Array<number> = EVERY_IN_PLACE_MIGRATION.map(
      (name: string): number => {
        return registered.indexOf(name);
      },
    );

    expect(
      positions.every((position: number): boolean => {
        return position > -1;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);
  });

  test("each records a marker of its own, which no data migration is named", () => {
    const markers: Array<string> = groups.map(
      (group: CredentialsAtRestGroup): string => {
        return getProtectedMarkerName(group.migrationName);
      },
    );
    const registered: Set<string> = new Set(
      DataMigrations.map((migration: { name: string }): string => {
        return migration.name;
      }),
    );

    expect(new Set(markers).size).toBe(markers.length);

    for (const marker of markers) {
      expect(marker.startsWith("CredentialsAtRest:")).toBe(true);
      expect(registered.has(marker)).toBe(false);
    }
  });

  // Each service's repository, as a table name and a query that finds nothing.
  function mockRepositories(): void {
    jest
      .spyOn(DatabaseService.prototype, "getRepository")
      .mockImplementation(function (this: DatabaseService<DatabaseBaseModel>) {
        return {
          metadata: { tableName: this.getModel().tableName },
          manager: {
            query: async (): Promise<unknown> => {
              return [];
            },
          },
        } as never;
      });
  }

  function columnsOf(targets: Array<ColumnToEncrypt>): Array<string> {
    return targets.map((target: ColumnToEncrypt): string => {
      return `${
        (target.repository as unknown as { metadata: { tableName: string } })
          .metadata.tableName
      }.${target.column}${target.jsonFields ? ` (${target.jsonFields.join(", ")})` : ""}`;
    });
  }

  test("each one's pass goes over every column its data migration names, in order", async () => {
    mockRepositories();

    let passed: Array<ColumnToEncrypt> = [];

    jest
      .spyOn(EncryptColumnInPlace, "encrypt")
      .mockImplementation(async (data: { target: ColumnToEncrypt }) => {
        passed.push(data.target);
        return {
          read: 0,
          written: 0,
          failed: 0,
          isCutShort: false,
        } as EncryptColumnPass;
      });

    for (const group of groups) {
      if (group.migrationName === "MaskWebhookAddressesInLogs") {
        continue;
      }

      const migration: { getTargets: () => Array<ColumnToEncrypt> } =
        DataMigrations.find((candidate: { name: string }): boolean => {
          return candidate.name === group.migrationName;
        })!.constructor as unknown as {
          getTargets: () => Array<ColumnToEncrypt>;
        };

      passed = [];

      expect(await group.pass({ startedAt: UPGRADED_AT })).toEqual({
        isDone: true,
        written: 0,
      });
      expect([group.migrationName, columnsOf(passed)]).toEqual([
        group.migrationName,
        columnsOf(migration.getTargets()),
      ]);
    }
  });

  test("every column one encrypts is one its model keeps encrypted, a JSON one by its model's fields", () => {
    mockRepositories();

    const modelsByTable: Map<string, DatabaseBaseModel> = new Map();

    for (const modelType of AllModelTypes as Array<{
      new (): DatabaseBaseModel;
    }>) {
      const model: DatabaseBaseModel = new modelType();
      modelsByTable.set(String(model.tableName), model);
    }

    const columns: Array<string> = [];

    for (const migrationName of EVERY_IN_PLACE_MIGRATION.slice(0, -1)) {
      const migration: { getTargets?: () => Array<ColumnToEncrypt> } | null =
        (DataMigrations.find((candidate: { name: string }): boolean => {
          return candidate.name === migrationName;
        })?.constructor as unknown as {
          getTargets?: () => Array<ColumnToEncrypt>;
        }) || null;

      expect([migrationName, typeof migration?.getTargets]).toEqual([
        migrationName,
        "function",
      ]);

      for (const target of migration!.getTargets!()) {
        const tableName: string = (
          target.repository as unknown as { metadata: { tableName: string } }
        ).metadata.tableName;
        const model: DatabaseBaseModel | undefined =
          modelsByTable.get(tableName);

        columns.push(`${tableName}.${target.column}`);

        expect([
          tableName,
          target.column,
          model?.getEncryptedColumns().columns.includes(target.column),
        ]).toEqual([tableName, target.column, true]);
        expect([
          tableName,
          target.column,
          target.jsonFields ? [...target.jsonFields] : undefined,
        ]).toEqual([
          tableName,
          target.column,
          model!.getTableColumnMetadata(target.column).encryptedFields,
        ]);
      }
    }

    /*
     * Every column of the Twilio token (1), #7739 (12), #8933 (3), #8920
     * (1), #8989 (6), #9013 (8) and #9014 (8).
     */
    expect(new Set(columns).size).toBe(columns.length);
    expect(columns).toHaveLength(39);
  });

  test("the job is the encrypting one: no data migration it waits on encrypts anything itself", () => {
    const directory: string = path.resolve(
      __dirname,
      "../../../FeatureSet/Workers/DataMigrations",
    );

    for (const migrationName of EVERY_IN_PLACE_MIGRATION.slice(0, -1)) {
      const source: string = fs.readFileSync(
        path.join(directory, `${migrationName}.ts`),
        "utf8",
      );

      expect([migrationName, source.includes("Encryption.encrypt(")]).toEqual([
        migrationName,
        false,
      ]);
      expect([
        migrationName,
        source.includes("EncryptColumnInPlace.encrypt("),
      ]).toEqual([migrationName, false]);
    }
  });
});

describe("the job", () => {
  const JOB_FILE: string = path.resolve(
    __dirname,
    "../../../FeatureSet/Workers/Jobs/CredentialsAtRest/EncryptInPlace.ts",
  );

  test("runs every 15 minutes and at startup, one run at a time, under its name", () => {
    const source: string = fs.readFileSync(JOB_FILE, "utf8");

    expect(CREDENTIALS_AT_REST_JOB_NAME).toBe(
      "CredentialsAtRest:EncryptInPlace",
    );
    expect(source).toContain("CREDENTIALS_AT_REST_JOB_NAME");
    expect(source).toContain(
      "schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE",
    );
    expect(source).toContain("runOnStartup: true");
    expect(source).toContain("deadline: deadline");
    expect(source).not.toContain("allowOverlap");
  });

  test("is registered with the Workers", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import "./Jobs/CredentialsAtRest/EncryptInPlace";`,
    );
  });

  test("waits the day the keys presented to OneUptime wait", () => {
    expect(SETTLE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
  });
});
