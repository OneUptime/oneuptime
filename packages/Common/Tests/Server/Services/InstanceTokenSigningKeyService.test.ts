import {
  OPERATOR_ENCRYPTION_SECRET,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * InstanceTokenSigningKeyService.loadTokenSigningKey, which every App process
 * awaits at boot right after it connects to Postgres, against a recorded
 * database (InstanceTokenSigningKeyPostgres.test.ts runs the same statements
 * on a real one):
 *
 *   - an installation whose operator set ENCRYPTION_SECRET touches no table
 *     and keeps signing with that secret;
 *   - one whose ENCRYPTION_SECRET is shipped offers a fresh 256-bit key with
 *     INSERT ... ON CONFLICT DO NOTHING on the one fixed row, then signs with
 *     whatever key the row holds - its own, or the one another process stored
 *     first;
 *   - a missing or malformed row, or a failing query, fails the boot rather
 *     than leaving the process signing with a key nobody else shares.
 */

jest.mock("../../../Server/Utils/Logger");

const ZERO_ID: string = "00000000-0000-0000-0000-000000000000";
const HEX_KEY: RegExp = /^[0-9a-f]{64}$/;

type ServiceClass =
  typeof import("../../../Server/Services/InstanceTokenSigningKeyService").default;
type TokenSigningKeyClass =
  typeof import("../../../Server/Utils/TokenSigningKey").default;

interface RecordedQuery {
  sql: string;
  parameters: Array<unknown>;
}

interface Booted {
  service: ServiceClass;
  TokenSigningKey: TokenSigningKeyClass;
  queries: Array<RecordedQuery>;
}

/*
 * A process booting with this ENCRYPTION_SECRET, connected to a database that
 * answers the key read with `storedRows` (or fails every query).
 */
async function boot(data: {
  encryptionSecret: string | undefined;
  storedRows?: (offeredKey: string) => Array<Record<string, unknown>>;
  failWith?: Error;
}): Promise<Booted> {
  setEncryptionSecret(data.encryptionSecret);
  jest.resetModules();

  const queries: Array<RecordedQuery> = [];
  let offeredKey: string = "";

  const PostgresAppInstance: {
    isConnected: () => boolean;
    getDataSource: () => unknown;
  } = (await import("../../../Server/Infrastructure/PostgresDatabase"))
    .default as never;

  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    getRepository: () => {
      return {
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<Array<Record<string, unknown>>> => {
            queries.push({ sql, parameters });

            if (data.failWith) {
              throw data.failWith;
            }

            if (sql.trim().startsWith("INSERT")) {
              offeredKey = parameters[1] as string;
              return [];
            }

            return data.storedRows
              ? data.storedRows(offeredKey)
              : [{ signingKey: offeredKey }];
          },
        },
      };
    },
  });

  return {
    service: (
      await import("../../../Server/Services/InstanceTokenSigningKeyService")
    ).default,
    TokenSigningKey: (await import("../../../Server/Utils/TokenSigningKey"))
      .default,
    queries,
  };
}

afterEach(() => {
  restoreEncryptionSecret();
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("an installation whose operator set ENCRYPTION_SECRET", () => {
  test("loads nothing and keeps signing with that secret", async () => {
    const booted: Booted = await boot({
      encryptionSecret: OPERATOR_ENCRYPTION_SECRET,
    });

    await booted.service.loadTokenSigningKey();

    expect(booted.queries).toEqual([]);
    expect(booted.TokenSigningKey.isInstallationKeyLoaded()).toBe(false);
    expect(booted.TokenSigningKey.get()).toBe(OPERATOR_ENCRYPTION_SECRET);
  });
});

describe("an installation whose ENCRYPTION_SECRET is shipped", () => {
  test("offers a fresh 256-bit key for the one fixed row, without overwriting one that is stored", async () => {
    const booted: Booted = await boot({
      encryptionSecret: "please-change-this-to-random-value",
    });

    await booted.service.loadTokenSigningKey();

    expect(booted.queries).toHaveLength(2);

    const [insert, select] = booted.queries as [RecordedQuery, RecordedQuery];

    expect(insert.sql).toContain('INSERT INTO "InstanceTokenSigningKey"');
    expect(insert.sql).toContain('ON CONFLICT ("_id") DO NOTHING');
    expect(insert.parameters[0]).toBe(ZERO_ID);
    expect(insert.parameters[1]).toMatch(HEX_KEY);
    expect(insert.parameters).toHaveLength(2);

    expect(select.sql).toContain(
      'SELECT "signingKey" FROM "InstanceTokenSigningKey"',
    );
    expect(select.parameters).toEqual([ZERO_ID]);
  });

  test("signs with the key it stored when it was first", async () => {
    const booted: Booted = await boot({ encryptionSecret: undefined });

    await booted.service.loadTokenSigningKey();

    const offered: string = booted.queries[0]!.parameters[1] as string;

    expect(booted.TokenSigningKey.isInstallationKeyLoaded()).toBe(true);
    expect(booted.TokenSigningKey.get()).toBe(offered);
  });

  test("signs with the key another process stored first, not the one it offered", async () => {
    const storedFirst: string = "ab".repeat(32);
    const booted: Booted = await boot({
      encryptionSecret: "secret",
      storedRows: () => {
        return [{ signingKey: storedFirst }];
      },
    });

    await booted.service.loadTokenSigningKey();

    expect(booted.queries[0]!.parameters[1]).not.toBe(storedFirst);
    expect(booted.TokenSigningKey.get()).toBe(storedFirst);
  });

  test("offers a different key every time it boots, so no two installations can share one by chance", async () => {
    const offered: Set<string> = new Set();

    for (let index: number = 0; index < 5; index++) {
      const booted: Booted = await boot({ encryptionSecret: undefined });

      await booted.service.loadTokenSigningKey();
      offered.add(booted.queries[0]!.parameters[1] as string);
    }

    expect(offered.size).toBe(5);
  });

  const BROKEN_ROWS: Array<[string, Array<Record<string, unknown>>]> = [
    ["no row at all", []],
    ["an empty key", [{ signingKey: "" }]],
    ["a shipped placeholder", [{ signingKey: "please-change-this-to-random-value" }]],
    ["a short key", [{ signingKey: "ab".repeat(16) }]],
    ["a key that is not hex", [{ signingKey: "zz".repeat(32) }]],
    ["no key column", [{ somethingElse: "ab".repeat(32) }]],
  ];

  test.each(BROKEN_ROWS)(
    "fails the boot when the table holds %s, and signs with nothing it read",
    async (_label: string, rows: Array<Record<string, unknown>>) => {
      const booted: Booted = await boot({
        encryptionSecret: "please-change-this-to-random-value",
        storedRows: () => {
          return rows;
        },
      });

      await expect(booted.service.loadTokenSigningKey()).rejects.toThrow(
        "no well-formed token signing key",
      );
      expect(booted.TokenSigningKey.isInstallationKeyLoaded()).toBe(false);
      expect(booted.TokenSigningKey.get()).toMatch(HEX_KEY);
    },
  );

  test("fails the boot when the database cannot be read", async () => {
    const booted: Booted = await boot({
      encryptionSecret: "please-change-this-to-random-value",
      failWith: new Error("connection refused"),
    });

    await expect(booted.service.loadTokenSigningKey()).rejects.toThrow(
      "connection refused",
    );
    expect(booted.TokenSigningKey.isInstallationKeyLoaded()).toBe(false);
  });
});
