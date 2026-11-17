import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptProjectCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptProjectCredentials";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
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
 * The project credentials stored as written before their columns were kept
 * encrypted at rest (#8989): the SMTP configs' passwords and OAuth client
 * secrets, the Slack, Microsoft Teams and Mattermost bot tokens, the
 * members' chat sign-in tokens, the code repositories' webhook secrets and
 * the webhook notification methods' signing secrets. The upgrade's data
 * migration, EncryptProjectCredentials, leaves them as written (#9266), so
 * a server of the release before sends with them while the upgrade rolls
 * out; a day later the CredentialsAtRest:EncryptInPlace job encrypts them
 * in place. Pinned here, with the repositories stubbed so the real
 * migrate() and the job's real pass run without Postgres (on Postgres:
 * EncryptProjectCredentialsPostgres, CredentialsAtRestPostgres):
 *
 *   1. it is registered in DataMigrations/Index.ts, once, after the repair
 *      of the signing secrets a broken write wrapped and before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. the upgrade's run changes nothing: it sends no statement at all;
 *   3. every column the job encrypts is declared encrypted, so what it
 *      writes is read back decrypted, and every later write is encrypted by
 *      the service;
 *   4. the job's pass encrypts a value as written in each table, and each
 *      stored value decrypts back to exactly what the sender used before;
 *   5. each write holds to the value it read, so a credential saved
 *      meanwhile is left as its save stored it;
 *   6. it leaves an encrypted, empty or null value alone, so a second pass
 *      rewrites nothing;
 *   7. a table that cannot be read, or a row that cannot be written, costs
 *      the others nothing - and no credential is ever logged, not even the
 *      one a failed write's error carries in its parameters;
 *   8. rollback changes nothing.
 */

const MIGRATION_NAME: string = "EncryptProjectCredentials";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

// Credentials as the senders were configured with them: none is real.
const SMTP_PASSWORD: string = "smtp-password with spaces & symbols !#%";
const CLIENT_SECRET: string =
  "-----BEGIN PRIVATE KEY-----\nMIIEv-google-service-account-key\n-----END PRIVATE KEY-----\n";
const SLACK_BOT_TOKEN: string = "xoxb-1111111111-2222222222-slack-bot-token";
const MATTERMOST_CONNECTION: string = JSON.stringify({
  serverUrl: "https://chat.example.com",
  accessToken: "mattermost-bot-access-token",
  teamId: "a1b2c3d4e5f6g7h8i9j0k1l2m3",
});
const SLACK_USER_TOKEN: string = "xoxp-3333333333-4444444444-slack-user-token";
const REPOSITORY_SECRET: string = "github-webhook-secret-for-the-repository";
const SIGNING_SECRET: string = "webhook-signing-secret";

const EVERY_VALUE: Array<string> = [
  SMTP_PASSWORD,
  CLIENT_SECRET,
  SLACK_BOT_TOKEN,
  MATTERMOST_CONNECTION,
  SLACK_USER_TOKEN,
  REPOSITORY_SECRET,
  SIGNING_SECRET,
];

interface QueryCall {
  table: string;
  sql: string;
  params: Array<unknown> | undefined;
}

type StoredRow = Record<string, unknown>;

interface TableStub {
  rows: Array<StoredRow>;
  failRead?: boolean;
  failUpdateForId?: string;
}

type TableName =
  | "ProjectSMTPConfig"
  | "WorkspaceProjectAuthToken"
  | "WorkspaceUserAuthToken"
  | "CodeRepository"
  | "UserWebhook";

function stubTables(
  tables: Partial<Record<TableName, TableStub>>,
): Array<QueryCall> {
  const calls: Array<QueryCall> = [];

  const repositoryFor: (table: TableName) => unknown = (
    table: TableName,
  ): unknown => {
    const stub: TableStub = tables[table] || { rows: [] };

    return {
      metadata: { tableName: table },
      manager: {
        query: async (
          sql: string,
          params?: Array<unknown>,
        ): Promise<unknown> => {
          calls.push({ table, sql, params });

          if (SELECT_START.test(sql)) {
            if (stub.failRead) {
              throw new Error("read failed");
            }

            // Each column is read for itself: only the rows that hold one.
            const column: string = sql.match(
              /SELECT "_id", "([A-Za-z]+)"/,
            )![1]!;

            return stub.rows.filter((row: StoredRow): boolean => {
              return typeof row[column] === "string" && row[column] !== "";
            });
          }

          if (
            UPDATE_START.test(sql) &&
            stub.failUpdateForId &&
            params &&
            params[1] === stub.failUpdateForId
          ) {
            // As TypeORM's QueryFailedError carries the query's parameters.
            const error: Error & { parameters?: Array<unknown> } = new Error(
              `write failed for ${String(params[2])}`,
            );
            error.parameters = params;
            throw error;
          }

          return [];
        },
      },
    };
  };

  jest
    .spyOn(ProjectSmtpConfigService, "getRepository")
    .mockReturnValue(repositoryFor("ProjectSMTPConfig") as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getRepository")
    .mockReturnValue(repositoryFor("WorkspaceProjectAuthToken") as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "getRepository")
    .mockReturnValue(repositoryFor("WorkspaceUserAuthToken") as never);
  jest
    .spyOn(CodeRepositoryService, "getRepository")
    .mockReturnValue(repositoryFor("CodeRepository") as never);
  jest
    .spyOn(UserWebhookService, "getRepository")
    .mockReturnValue(repositoryFor("UserWebhook") as never);

  return calls;
}

function updateCalls(calls: Array<QueryCall>): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

// What every table holds before the migration: each credential as written.
function storedAsWritten(): Partial<Record<TableName, TableStub>> {
  return {
    ProjectSMTPConfig: {
      rows: [
        { _id: "smtp-password", password: SMTP_PASSWORD, clientSecret: null },
        { _id: "smtp-oauth", password: null, clientSecret: CLIENT_SECRET },
      ],
    },
    WorkspaceProjectAuthToken: {
      rows: [
        { _id: "slack", authToken: SLACK_BOT_TOKEN },
        { _id: "mattermost", authToken: MATTERMOST_CONNECTION },
      ],
    },
    WorkspaceUserAuthToken: {
      rows: [
        { _id: "slack-user", authToken: SLACK_USER_TOKEN },
        // Who installed the Slack app is linked with no token of their own.
        { _id: "slack-installer", authToken: "" },
      ],
    },
    CodeRepository: {
      rows: [{ _id: "repository", secretToken: REPOSITORY_SECRET }],
    },
    UserWebhook: {
      rows: [
        { _id: "webhook", secret: SIGNING_SECRET },
        { _id: "unsigned-webhook", secret: null },
      ],
    },
  };
}

describe("EncryptProjectCredentials", () => {
  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, after the signing secrets' repair and before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(NEW_MIGRATION_CALL),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    // The envelopes a broken write left are unwrapped before they are encrypted.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("RepairHashedStringEnvelopeSecrets"),
    );
    // The Twilio token, encrypted the same way, went first.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("EncryptProjectCallSMSConfigTwilioAuthToken"),
    );
  });

  test("has the name it is recorded under", () => {
    expect(new EncryptProjectCredentials().name).toBe(MIGRATION_NAME);
  });

  test("the upgrade's run changes nothing: a server of the release before reads every credential as written", async () => {
    const calls: Array<QueryCall> = stubTables(storedAsWritten());

    await new EncryptProjectCredentials().migrate();

    expect(calls).toHaveLength(0);
  });

  test("every column it encrypts is declared encrypted, so it is read back decrypted", () => {
    const expected: Array<[DatabaseBaseModel, string]> = [
      [new ProjectSmtpConfig(), "password"],
      [new ProjectSmtpConfig(), "clientSecret"],
      [new WorkspaceProjectAuthToken(), "authToken"],
      [new WorkspaceUserAuthToken(), "authToken"],
      [new CodeRepository(), "secretToken"],
      [new UserWebhook(), "secret"],
    ];

    for (const [model, column] of expected) {
      expect([
        model.tableName,
        column,
        model.getEncryptedColumns().columns,
      ]).toEqual([model.tableName, column, expect.arrayContaining([column])]);
    }
  });

  test("encrypts every credential column the models made encrypted for #8989, and only those", () => {
    stubTables({});

    expect(
      EncryptProjectCredentials.getTargets().map(
        (target: { repository: unknown; column: string }): string => {
          return `${(target.repository as { metadata: { tableName: string } }).metadata.tableName}.${target.column}`;
        },
      ),
    ).toEqual([
      "ProjectSMTPConfig.password",
      "ProjectSMTPConfig.clientSecret",
      "WorkspaceProjectAuthToken.authToken",
      "WorkspaceUserAuthToken.authToken",
      "CodeRepository.secretToken",
      "UserWebhook.secret",
    ]);
  });

  test("encrypts the credential as written in every table, and each decrypts back to it", async () => {
    const calls: Array<QueryCall> = stubTables(storedAsWritten());

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const updates: Array<QueryCall> = updateCalls(calls);

    expect(
      updates.map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual([
      "ProjectSMTPConfig:smtp-password",
      "ProjectSMTPConfig:smtp-oauth",
      "WorkspaceProjectAuthToken:slack",
      "WorkspaceProjectAuthToken:mattermost",
      "WorkspaceUserAuthToken:slack-user",
      "CodeRepository:repository",
      "UserWebhook:webhook",
    ]);

    const expected: Array<[string, string]> = [
      ["password", SMTP_PASSWORD],
      ["clientSecret", CLIENT_SECRET],
      ["authToken", SLACK_BOT_TOKEN],
      ["authToken", MATTERMOST_CONNECTION],
      ["authToken", SLACK_USER_TOKEN],
      ["secretToken", REPOSITORY_SECRET],
      ["secret", SIGNING_SECRET],
    ];

    for (const [index, [column, value]] of expected.entries()) {
      const [encrypted, , previous] = updates[index]!.params as [
        string,
        string,
        string,
      ];

      expect(updates[index]!.sql).toContain(`SET "${column}" = $1`);
      // Held to the value it read: a credential saved meanwhile is left alone.
      expect(updates[index]!.sql).toContain(`AND "${column}" = $3`);
      expect(previous).toBe(value);
      expect(encrypted).not.toBe(value);
      expect(Encryption.looksEncrypted(encrypted)).toBe(true);
      // Exactly as written: spaces, symbols and line breaks kept.
      expect(await Encryption.decrypt(encrypted)).toBe(value);
    }
  });

  test("reads only the values that are set and not encrypted yet, in every table", async () => {
    const calls: Array<QueryCall> = stubTables({});

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const selects: Array<QueryCall> = calls.filter(
      (call: QueryCall): boolean => {
        return SELECT_START.test(call.sql);
      },
    );

    expect(
      selects.map((call: QueryCall): string => {
        return call.table;
      }),
    ).toEqual([
      "ProjectSMTPConfig",
      "ProjectSMTPConfig",
      "WorkspaceProjectAuthToken",
      "WorkspaceUserAuthToken",
      "CodeRepository",
      "UserWebhook",
    ]);

    for (const [index, column] of [
      "password",
      "clientSecret",
      "authToken",
      "authToken",
      "secretToken",
      "secret",
    ].entries()) {
      expect(selects[index]!.sql).toContain(`"${column}" IS NOT NULL`);
      expect(selects[index]!.sql).toContain(`"${column}" <> ''`);
      expect(selects[index]!.sql).toContain(`"${column}" NOT LIKE $1`);
      expect(selects[index]!.params).toEqual([
        `${Encryption.CIPHERTEXT_PREFIX}%`,
      ]);
    }
  });

  test("leaves an already-encrypted, empty or null value alone (idempotent)", async () => {
    const calls: Array<QueryCall> = stubTables({
      ProjectSMTPConfig: {
        rows: [
          {
            _id: "already",
            password: await Encryption.encrypt(SMTP_PASSWORD),
            clientSecret: await Encryption.encrypt(CLIENT_SECRET),
          },
          { _id: "empty", password: "", clientSecret: "" },
          { _id: "null", password: null, clientSecret: null },
        ],
      },
      WorkspaceUserAuthToken: {
        rows: [{ _id: "slack-installer", authToken: "" }],
      },
      UserWebhook: {
        rows: [{ _id: "unsigned", secret: null }],
      },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(calls)).toHaveLength(0);
  });

  test("a second pass over the credentials it encrypted rewrites nothing, and is done", async () => {
    const first: Array<QueryCall> = stubTables(storedAsWritten());

    // It encrypted seven values: the next pass is to find none left.
    expect(await encryptInPlaceADayLater(MIGRATION_NAME)).toEqual({
      isDone: false,
      written: 7,
    });

    // The tables as the first run left them: every value encrypted.
    const after: Partial<Record<TableName, TableStub>> = storedAsWritten();

    for (const call of updateCalls(first)) {
      const [encrypted, id] = call.params as [string, string];
      const column: string = call.sql.match(/SET "([A-Za-z]+)"/)![1]!;
      const row: StoredRow = after[call.table as TableName]!.rows.find(
        (candidate: StoredRow): boolean => {
          return candidate["_id"] === id;
        },
      )!;

      row[column] = encrypted;
    }

    jest.restoreAllMocks();
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const second: Array<QueryCall> = stubTables(after);

    expect(await encryptInPlaceADayLater(MIGRATION_NAME)).toEqual({
      isDone: true,
      written: 0,
    });

    expect(updateCalls(second)).toHaveLength(0);
  });

  test("a table that cannot be read, or a row that cannot be written, costs the others nothing - and logs no credential", async () => {
    const tables: Partial<Record<TableName, TableStub>> = storedAsWritten();

    tables.ProjectSMTPConfig!.failUpdateForId = "smtp-password";
    tables.WorkspaceProjectAuthToken!.failRead = true;

    const calls: Array<QueryCall> = stubTables(tables);

    // Not done: the next run of the job goes on.
    await expect(encryptInPlaceADayLater(MIGRATION_NAME)).resolves.toEqual({
      isDone: false,
      written: 4,
    });

    expect(
      updateCalls(calls).map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual([
      "ProjectSMTPConfig:smtp-password",
      "ProjectSMTPConfig:smtp-oauth",
      "WorkspaceUserAuthToken:slack-user",
      "CodeRepository:repository",
      "UserWebhook:webhook",
    ]);

    // The row that failed, and the table that could not be read.
    expect(logger.error).toHaveBeenCalledTimes(2);

    const logged: string = JSON.stringify(
      (logger.error as unknown as jest.Mock).mock.calls,
    );

    for (const value of EVERY_VALUE) {
      expect(logged).not.toContain(JSON.stringify(value).slice(1, -1));
    }

    expect(logged).not.toContain("smtp-password with spaces");
    expect(logged).not.toContain("xoxb-");
    expect(logged).toContain("smtp-password");
    expect(logged).toContain("[REDACTED]");
  });

  test("rollback changes nothing", async () => {
    const calls: Array<QueryCall> = stubTables(storedAsWritten());

    await new EncryptProjectCredentials().rollback();

    expect(calls).toHaveLength(0);
  });
});
