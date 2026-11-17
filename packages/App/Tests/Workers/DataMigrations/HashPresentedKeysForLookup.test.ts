import HashPresentedKeysForLookup from "../../../FeatureSet/Workers/DataMigrations/HashPresentedKeysForLookup";
import PresentedKeysInPlace, {
  PresentedKeyTarget,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import { LOOKUP_HASH_MIGRATION_NAME } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE LOOKUP HASHES OF THE KEYS PRESENTED TO ONEUPTIME, WRITTEN AT THE
 * UPGRADE (#9012).
 *
 * The keys a request names its record by alone - an ingestion key, a
 * monitor's three keys, a workflow's webhook and email keys - are found by
 * their lookup hash now. This data migration writes the hash of each key
 * stored as written, and changes no key: a server of the release before
 * keeps finding every key as it was written, while the upgrade rolls out.
 * When it ran starts the day's wait before the keys are encrypted in place
 * (PresentedKeys:ProtectAtRest).
 *
 * Pinned here:
 *   1. its name is the one the protection job reads the time it ran by;
 *   2. it is registered once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   3. it writes the lookup hashes of exactly the keys that have one, and
 *      never protects a key in place (PresentedKeysInPlace.protect);
 *   4. rollback changes nothing.
 * PresentedKeysInPlace.test.ts holds the pass itself, and
 * PresentedKeysAtRestPostgres.test.ts runs it on a real Postgres.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

function registeredInOrder(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  return Array.from(source.matchAll(NEW_MIGRATION_CALL)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("HashPresentedKeysForLookup", () => {
  test("is named as the protection job reads it", () => {
    expect(new HashPresentedKeysForLookup().name).toBe(
      LOOKUP_HASH_MIGRATION_NAME,
    );
  });

  test("is registered once, before the last slot", () => {
    const names: Array<string> = registeredInOrder();

    expect(
      names.filter((name: string): boolean => {
        return name === "HashPresentedKeysForLookup";
      }),
    ).toHaveLength(1);
    expect(names.indexOf("HashPresentedKeysForLookup")).toBeLessThan(
      names.indexOf("AddAuditLogMcpClientColumns"),
    );
    expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
  });

  test("writes the lookup hashes of the keys that have one, and protects no key in place", async () => {
    const written: Array<string> = [];

    jest
      .spyOn(PresentedKeysInPlace, "writeLookupHashes")
      .mockImplementation(async (data: { target: PresentedKeyTarget }) => {
        written.push(`${data.target.tableName}.${data.target.column}`);
        return { read: 0, written: 0, failed: 0, isCutShort: false };
      });
    const protect: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PresentedKeysInPlace,
      "protect",
    );

    await new HashPresentedKeysForLookup().migrate();

    expect(written.sort()).toEqual(
      [
        "Monitor.incomingEmailSecretKey",
        "Monitor.incomingRequestSecretKey",
        "Monitor.serverMonitorSecretKey",
        "TelemetryIngestionKey.secretKey",
        "Workflow.incomingEmailSecretKey",
        "Workflow.webhookSecretKey",
      ].sort(),
    );
    expect(protect).not.toHaveBeenCalled();
  });

  test("rollback changes nothing", async () => {
    const writeLookupHashes: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PresentedKeysInPlace,
      "writeLookupHashes",
    );

    await new HashPresentedKeysForLookup().rollback();

    expect(writeLookupHashes).not.toHaveBeenCalled();
  });
});
