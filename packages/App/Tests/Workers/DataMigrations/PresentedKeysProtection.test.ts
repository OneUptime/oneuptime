import PresentedKeysInPlace, {
  PresentedKeyProtection,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import PresentedKeysProtection, {
  PresentedKeysProtectionOutcome,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysProtection";
import { keyTable, KeyTable } from "./Fixtures/PresentedKeysSql";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import Encryption from "Common/Server/Utils/Encryption";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";
import {
  LOOKUP_HASH_MIGRATION_NAME,
  PROTECTED_AT_REST_MARKER,
  SETTLE_PERIOD_MS,
  SqlRunner,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import TableColumnType from "Common/Types/Database/TableColumnType";
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
 * THE PRESENTEDKEYS:PROTECTATREST JOB (#9012).
 *
 * A key stored as written is protected in place only a day after the
 * upgrade wrote the lookup hashes - once no server of the release before,
 * which compares a key as written, can still be running. Until then a run
 * keeps the lookup hashes up to date for the keys such a server made or
 * changed. With the DataMigrations table and a table of keys in memory:
 *
 *   - before the upgrade's migration ran, a run does nothing;
 *   - within the day, it writes lookup hashes and changes no key;
 *   - after it, it encrypts (or hashes) every key stored as written, and
 *     records that every key is protected - once;
 *   - a run that could not protect every key records nothing, and the next
 *     run goes on;
 *   - once recorded, a run does nothing at all;
 *   - the job is registered, every 15 minutes and at startup.
 */

jest.mock("Common/Server/Utils/Logger");

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const TOKEN: string = "a".repeat(64);
const UPGRADED_AT: Date = new Date("2026-11-16T08:00:00.000Z");

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

function monitorKeys(): KeyTable {
  return keyTable({
    target: {
      kind: "monitor",
      column: "incomingRequestSecretKey",
      protection: PresentedKeyProtection.Encrypt,
      lookupHashColumn: "incomingRequestSecretKeyHash",
      columnType: TableColumnType.ObjectID,
    },
    rows: [
      {
        _id: "0f000000-0000-4000-8000-000000000001",
        incomingRequestSecretKey: KEY,
      },
    ],
  });
}

function scimTokens(): KeyTable {
  return keyTable({
    target: {
      kind: "project SCIM connection",
      column: "bearerToken",
      protection: PresentedKeyProtection.Hash,
      columnType: TableColumnType.HashedString,
    },
    rows: [{ _id: "0f000000-0000-4000-8000-000000000002", bearerToken: TOKEN }],
  });
}

async function run(
  tables: Array<KeyTable>,
  now: Date,
): Promise<PresentedKeysProtectionOutcome> {
  return await PresentedKeysProtection.run({
    runner: runner,
    now: now,
    targets: tables.map((table: KeyTable) => {
      return table.target;
    }),
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a run of PresentedKeys:ProtectAtRest", () => {
  test("before the upgrade wrote the lookup hashes, does nothing", async () => {
    const keys: KeyTable = monitorKeys();

    expect(await run([keys], new Date())).toBe(
      PresentedKeysProtectionOutcome.NotUpgradedYet,
    );
    expect(keys.calls).toHaveLength(0);
  });

  test("within the day after, writes lookup hashes and changes no key", async () => {
    recorded.set(LOOKUP_HASH_MIGRATION_NAME, UPGRADED_AT);
    const keys: KeyTable = monitorKeys();
    const tokens: KeyTable = scimTokens();

    expect(
      await run(
        [keys, tokens],
        new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS - 1),
      ),
    ).toBe(PresentedKeysProtectionOutcome.Waiting);

    expect(keys.rows[0]!["incomingRequestSecretKey"]).toBe(KEY);
    expect(keys.rows[0]!["incomingRequestSecretKeyHash"]).toBe(
      PresentedKey.hash(KEY, TableColumnType.ObjectID),
    );
    expect(tokens.rows[0]!["bearerToken"]).toBe(TOKEN);
    expect(create).not.toHaveBeenCalled();
  });

  test("a day after, encrypts or hashes every key stored as written, and records it, once", async () => {
    recorded.set(LOOKUP_HASH_MIGRATION_NAME, UPGRADED_AT);
    const keys: KeyTable = monitorKeys();
    const tokens: KeyTable = scimTokens();
    const now: Date = new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS);

    expect(await run([keys, tokens], now)).toBe(
      PresentedKeysProtectionOutcome.Protected,
    );

    expect(
      await Encryption.decrypt(
        keys.rows[0]!["incomingRequestSecretKey"] as string,
      ),
    ).toBe(KEY);
    expect(tokens.rows[0]!["bearerToken"]).toBe(
      PresentedKey.toStoredHash(TOKEN),
    );
    expect(recorded.get(PROTECTED_AT_REST_MARKER)).toEqual(now);
    expect(create).toHaveBeenCalledTimes(1);

    // Once recorded, a run reads no key at all.
    const callsBefore: number = keys.calls.length;

    expect(await run([keys, tokens], now)).toBe(
      PresentedKeysProtectionOutcome.AlreadyProtected,
    );
    expect(keys.calls).toHaveLength(callsBefore);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a run that could not protect every key records nothing, and the next goes on", async () => {
    recorded.set(LOOKUP_HASH_MIGRATION_NAME, UPGRADED_AT);
    const keys: KeyTable = monitorKeys();
    keys.failingIds = new Set<string>([String(keys.rows[0]!["_id"])]);
    const now: Date = new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS + 1);

    expect(await run([keys], now)).toBe(
      PresentedKeysProtectionOutcome.NotDoneYet,
    );
    expect(recorded.has(PROTECTED_AT_REST_MARKER)).toBe(false);

    keys.failingIds = undefined;

    expect(await run([keys], now)).toBe(
      PresentedKeysProtectionOutcome.Protected,
    );
  });

  test("the targets it protects by default are every presented key", async () => {
    const getTargets: ReturnType<typeof jest.spyOn> = jest
      .spyOn(PresentedKeysInPlace, "getTargets")
      .mockReturnValue([]);
    recorded.set(LOOKUP_HASH_MIGRATION_NAME, UPGRADED_AT);

    await PresentedKeysProtection.run({ runner: runner, now: UPGRADED_AT });

    expect(getTargets).toHaveBeenCalledTimes(1);
  });
});

describe("the job", () => {
  const JOB_FILE: string = path.resolve(
    __dirname,
    "../../../FeatureSet/Workers/Jobs/PresentedKeys/ProtectAtRest.ts",
  );

  test("runs every 15 minutes and at startup, one run at a time", () => {
    const source: string = fs.readFileSync(JOB_FILE, "utf8");

    expect(source).toContain(`"PresentedKeys:ProtectAtRest"`);
    expect(source).toContain(
      "schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE",
    );
    expect(source).toContain("runOnStartup: true");
    expect(source).not.toContain("allowOverlap");
  });

  test("is registered with the Workers", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../FeatureSet/Workers/Index.ts"),
      "utf8",
    );

    expect(index).toContain(`import "./Jobs/PresentedKeys/ProtectAtRest";`);
  });
});
