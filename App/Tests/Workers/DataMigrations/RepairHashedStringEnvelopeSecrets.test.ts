import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import logger from "Common/Server/Utils/Logger";
import HashedString from "Common/Types/HashedString";
import TableColumnType from "Common/Types/Database/TableColumnType";
import RepairHashedStringEnvelopeSecrets, {
  HASHED_STRING_ENVELOPE_PREFIX,
  SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS,
  SecretColumns,
} from "../../../FeatureSet/Workers/DataMigrations/RepairHashedStringEnvelopeSecrets";
import fs from "fs";
import path from "path";

/*
 * The at-rest half of github.com/OneUptime/oneuptime/issues/3807.
 *
 * Secrets typed into dashboard Password fields were stored as
 * '{"_type":"HashedString","value":"..."}'. DatabaseService no longer writes
 * that, and reads through it for encrypted columns; this migration rewrites
 * the envelopes already in the table to the string they hold — including
 * the unencrypted webhook signing secret, which nothing else can repair.
 *
 * No Postgres here: what is pinned is which columns are repaired, the exact
 * statement each one gets, and that one failure does not stop the rest. The
 * statement itself was exercised against Postgres when it was written (see
 * the pull request): envelopes of ciphertexts, of secrets containing quotes,
 * backslashes and non-ASCII text, look-alike values, NULLs, and a second run.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "RepairHashedStringEnvelopeSecrets";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

interface StubbedRepository {
  query: jest.Mock;
  tableName: string;
}

type QueryResponder = (sql: unknown) => Promise<unknown>;

// A repository manager.query stub.
function mockQuery(respond: QueryResponder): jest.Mock {
  return jest.fn(respond) as unknown as jest.Mock;
}

function modelOf(service: DatabaseService<BaseModel>): BaseModel {
  return service.getModel();
}

/*
 * Stubs every listed service's repository with the table and column names
 * the real model declares, and one query mock shared by all of them, so the
 * statements come back in the order they were issued.
 */
function stubRepositories(query: jest.Mock): Array<StubbedRepository> {
  const stubs: Array<StubbedRepository> = [];

  for (const secretColumns of SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS) {
    const model: BaseModel = modelOf(secretColumns.service);
    const tableName: string = model.tableName as string;

    jest.spyOn(secretColumns.service, "getRepository").mockReturnValue({
      metadata: {
        tableName,
        findColumnWithPropertyName: (propertyName: string) => {
          return model.getTableColumns().columns.includes(propertyName)
            ? { databaseName: propertyName }
            : undefined;
        },
      },
      manager: { query },
    } as never);

    stubs.push({ query, tableName });
  }

  return stubs;
}

describe("RepairHashedStringEnvelopeSecrets", () => {
  const migration: RepairHashedStringEnvelopeSecrets =
    new RepairHashedStringEnvelopeSecrets();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    /*
     * The runner decides what to run by position. Pinned is the index this
     * migration was appended at; appending later migrations leaves it alone,
     * inserting one above it does not.
     */
    const REGISTERED_POSITION: number = 110;

    test("was appended at the end of the list, and keeps that position", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations.length).toBeGreaterThan(REGISTERED_POSITION);
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("what it looks for", () => {
    test("the prefix is what the broken write actually stored", () => {
      /*
       * node-postgres binds an object as JSON.stringify(value), which goes
       * through HashedString.toJSON().
       */
      const stored: string = JSON.stringify(
        new HashedString("U2FsdGVkX1+ciphertext=="),
      );

      expect(stored.startsWith(HASHED_STRING_ENVELOPE_PREFIX)).toBe(true);
      expect(stored).toBe(
        `${HASHED_STRING_ENVELOPE_PREFIX}U2FsdGVkX1+ciphertext=="}`,
      );
    });

    test("the prefix only matches an envelope that holds a string", () => {
      expect(HASHED_STRING_ENVELOPE_PREFIX.endsWith('"value":"')).toBe(true);
      expect(
        JSON.stringify({ _type: "HashedString", value: 42 }).startsWith(
          HASHED_STRING_ENVELOPE_PREFIX,
        ),
      ).toBe(false);
    });

    test("covers the secret columns written from dashboard Password fields", () => {
      const listed: Array<string> =
        SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS.flatMap(
          (secretColumns: SecretColumns): Array<string> => {
            const tableName: string = modelOf(secretColumns.service)
              .tableName as string;
            return secretColumns.columns.map((column: string): string => {
              return `${tableName}.${column}`;
            });
          },
        );

      expect(listed.sort()).toEqual(
        [
          "DataSource.apiToken",
          "DataSource.password",
          "RunbookCredential.sshPassphrase",
          "RunbookCredential.sshPassword",
          "ThreatIntelFeed.apiToken",
          "ThreatIntelFeed.basicAuthPassword",
          "UserWebhook.secret",
        ].sort(),
      );
    });

    test("every listed column is a real, unhashed column of its model", () => {
      for (const secretColumns of SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS) {
        const model: BaseModel = modelOf(secretColumns.service);

        for (const column of secretColumns.columns) {
          expect(model.getTableColumns().columns).toContain(column);
          expect(model.isHashedStringColumn(column)).toBe(false);
          expect(model.getTableColumnMetadata(column).type).not.toBe(
            TableColumnType.JSON,
          );
        }
      }
    });

    test("all but the webhook signing secret are encrypted columns", () => {
      for (const secretColumns of SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS) {
        const model: BaseModel = modelOf(secretColumns.service);

        for (const column of secretColumns.columns) {
          expect(model.getEncryptedColumns().columns.includes(column)).toBe(
            !(model.tableName === "UserWebhook" && column === "secret"),
          );
        }
      }
    });
  });

  describe("the repair", () => {
    test("issues one literal-prefix UPDATE per column, moving the envelope's string into the column", async () => {
      const query: jest.Mock = mockQuery(() => {
        return Promise.resolve([[], 0]);
      });
      stubRepositories(query);

      await migration.migrate();

      const expectedStatements: Array<string> =
        SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS.flatMap(
          (secretColumns: SecretColumns): Array<string> => {
            const tableName: string = modelOf(secretColumns.service)
              .tableName as string;
            return secretColumns.columns.map((column: string): string => {
              return `UPDATE "${tableName}" SET "${column}" = ("${column}"::json ->> 'value') WHERE left("${column}", char_length($1)) = $1`;
            });
          },
        );

      expect(
        query.mock.calls.map((call: Array<unknown>) => {
          return call[0];
        }),
      ).toEqual(expectedStatements);

      for (const call of query.mock.calls) {
        expect(call[1]).toEqual([HASHED_STRING_ENVELOPE_PREFIX]);
      }

      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    test("never uses LIKE, where the underscore in _type is a wildcard", async () => {
      const query: jest.Mock = mockQuery(() => {
        return Promise.resolve([[], 0]);
      });
      stubRepositories(query);

      await migration.migrate();

      for (const call of query.mock.calls) {
        expect(String(call[0]).toUpperCase()).not.toContain("LIKE");
      }
    });

    test("reports how many values it repaired, and stays quiet when there were none", async () => {
      const query: jest.Mock = mockQuery((sql: unknown) => {
        return Promise.resolve([
          [],
          String(sql).startsWith('UPDATE "ThreatIntelFeed" SET "apiToken"')
            ? 3
            : 0,
        ]);
      });
      stubRepositories(query);

      await migration.migrate();

      expect(mockedLogger.info).toHaveBeenCalledTimes(1);
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "RepairHashedStringEnvelopeSecrets: repaired 3 ThreatIntelFeed.apiToken value(s).",
      );
    });

    test("a column that fails is logged and the remaining columns are still repaired", async () => {
      const query: jest.Mock = mockQuery((sql: unknown) => {
        if (String(sql).startsWith('UPDATE "ThreatIntelFeed"')) {
          return Promise.reject(
            new Error("invalid input syntax for type json"),
          );
        }
        return Promise.resolve([[], 0]);
      });
      stubRepositories(query);

      await expect(migration.migrate()).resolves.toBeUndefined();

      const tablesQueried: Set<string> = new Set(
        query.mock.calls.map((call: Array<unknown>) => {
          return String(call[0]).split('"')[1]!;
        }),
      );

      expect(tablesQueried).toEqual(
        new Set([
          "ThreatIntelFeed",
          "DataSource",
          "RunbookCredential",
          "UserWebhook",
        ]),
      );
      expect(query).toHaveBeenCalledTimes(7);
      // Both ThreatIntelFeed columns failed and were each reported.
      expect(mockedLogger.error).toHaveBeenCalledTimes(4);
    });

    test("an unknown column is reported without issuing any SQL for it", async () => {
      const query: jest.Mock = mockQuery(() => {
        return Promise.resolve([[], 0]);
      });
      stubRepositories(query);

      const threatIntel: SecretColumns =
        SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS[0]!;
      const originalColumns: Array<string> = threatIntel.columns;
      threatIntel.columns = ["apiToken", "columnThatDoesNotExist"];

      try {
        await migration.migrate();
      } finally {
        threatIntel.columns = originalColumns;
      }

      expect(
        query.mock.calls.some((call: Array<unknown>) => {
          return String(call[0]).includes("columnThatDoesNotExist");
        }),
      ).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        "RepairHashedStringEnvelopeSecrets: failed to repair columnThatDoesNotExist:",
      );
    });

    test("rollback is a no-op: an envelope is never the value anyone meant to store", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
    });
  });
});
