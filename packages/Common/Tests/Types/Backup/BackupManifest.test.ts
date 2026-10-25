import { describe, expect, test } from "@jest/globals";
import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BackupManifest,
  getBackupName,
  isBackupName,
  parseBackupManifest,
} from "../../../Types/Backup/BackupManifest";
import { BackupRunTrigger } from "../../../Types/Backup/BackupRunTypes";

/*
 * A backup's manifest.json: what a new installation finds a backup by, and
 * what a restore checks before it replaces anything. A manifest that does
 * not hold what a restore relies on is refused with what is wrong, never
 * half read.
 */

const SHA: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function manifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    backupId: "3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293",
    name: "20261024T020000Z-3f2a9c1b",
    trigger: "scheduled",
    startedAt: "2026-10-24T02:00:00.000Z",
    finishedAt: "2026-10-24T02:00:06.000Z",
    oneuptimeVersion: "14.0.90",
    encryptionCheck: "abc:def",
    postgres: {
      file: "postgres.dump",
      format: "pg_dump-custom",
      sizeInBytes: 4300000,
      sha256: SHA,
      database: "oneuptimedb",
      serverVersion: "16.4",
      toolVersion: "16.4",
      lastMigration: "AddBackups1807220000000",
      counts: {
        projects: 3,
        users: 12,
        monitors: 140,
        incidents: 9,
        statusPages: 2,
      },
    },
    clickhouse: {
      folder: "clickhouse/",
      database: "oneuptime",
      serverVersion: "25.3.2.39",
      sizeInBytes: 2200000,
      fileCount: 410,
    },
    ...overrides,
  };
}

describe("parseBackupManifest", () => {
  test("reads a whole manifest, from JSON text or an object", () => {
    const parsed: BackupManifest = parseBackupManifest(
      JSON.stringify(manifest()),
    );

    expect(parsed).toEqual({
      schemaVersion: 1,
      backupId: "3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293",
      name: "20261024T020000Z-3f2a9c1b",
      trigger: BackupRunTrigger.Scheduled,
      startedAt: "2026-10-24T02:00:00.000Z",
      finishedAt: "2026-10-24T02:00:06.000Z",
      oneuptimeVersion: "14.0.90",
      encryptionCheck: "abc:def",
      postgres: {
        file: "postgres.dump",
        format: "pg_dump-custom",
        sizeInBytes: 4300000,
        sha256: SHA,
        database: "oneuptimedb",
        serverVersion: "16.4",
        toolVersion: "16.4",
        lastMigration: "AddBackups1807220000000",
        counts: {
          projects: 3,
          users: 12,
          monitors: 140,
          incidents: 9,
          statusPages: 2,
        },
      },
      clickhouse: {
        folder: "clickhouse/",
        database: "oneuptime",
        serverVersion: "25.3.2.39",
        sizeInBytes: 2200000,
        fileCount: 410,
      },
    });
    expect(parseBackupManifest(manifest())).toEqual(parsed);
  });

  test("a backup of PostgreSQL alone, or of ClickHouse alone, is a backup", () => {
    expect(
      parseBackupManifest(manifest({ clickhouse: undefined })).clickhouse,
    ).toBeUndefined();
    expect(
      parseBackupManifest(manifest({ postgres: undefined })).postgres,
    ).toBeUndefined();
  });

  test("a manifest of neither is refused", () => {
    expect(() => {
      return parseBackupManifest(
        manifest({ postgres: undefined, clickhouse: undefined }),
      );
    }).toThrow("The manifest names no database.");
  });

  test("a manifest a newer OneUptime wrote is refused, not misread", () => {
    expect(() => {
      return parseBackupManifest(
        manifest({ schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION + 1 }),
      );
    }).toThrow(
      "The manifest was written by a newer OneUptime (schema 2). Update OneUptime to restore it.",
    );
  });

  test.each<[string, unknown, string]>([
    ["text that is not JSON", "{not json", "The manifest is not JSON."],
    ["a list", "[]", "The manifest is not a JSON object."],
    ["null", null, "The manifest is not a JSON object."],
    [
      "no schema",
      { ...manifest(), schemaVersion: undefined },
      "The manifest has no schemaVersion.",
    ],
    ["no id", { ...manifest(), backupId: "" }, "The manifest has no backupId."],
    [
      "no name",
      { ...manifest(), name: undefined },
      "The manifest has no name.",
    ],
    [
      "no start",
      { ...manifest(), startedAt: undefined },
      "The manifest has no startedAt.",
    ],
    [
      "a start that is no date",
      { ...manifest(), startedAt: "yesterday" },
      "The manifest's startedAt is not a date.",
    ],
    [
      "no version",
      { ...manifest(), oneuptimeVersion: 14 },
      "The manifest has no oneuptimeVersion.",
    ],
  ])("%s is refused", (_case: string, value: unknown, message: string) => {
    expect(() => {
      return parseBackupManifest(value);
    }).toThrow(message);
  });

  test.each<[string, Record<string, unknown>, string]>([
    [
      "a checksum that is not SHA-256",
      { sha256: "abc" },
      "The manifest's PostgreSQL checksum is not a SHA-256.",
    ],
    [
      "an upper-case checksum",
      { sha256: SHA.toUpperCase() },
      "The manifest's PostgreSQL checksum is not a SHA-256.",
    ],
    [
      "a negative size",
      { sizeInBytes: -1 },
      "The manifest's sizeInBytes is not a size.",
    ],
    [
      "a size in parts",
      { sizeInBytes: 1.5 },
      "The manifest's sizeInBytes is not a size.",
    ],
    [
      "a size as text",
      { sizeInBytes: "4300000" },
      "The manifest's sizeInBytes is not a size.",
    ],
    ["no file", { file: "" }, "The manifest has no file."],
    [
      "no tool version",
      { toolVersion: undefined },
      "The manifest has no toolVersion.",
    ],
  ])(
    "a PostgreSQL part with %s is refused",
    (_case: string, change: Record<string, unknown>, message: string) => {
      const value: Record<string, unknown> = manifest();
      value["postgres"] = {
        ...(value["postgres"] as Record<string, unknown>),
        ...change,
      };

      expect(() => {
        return parseBackupManifest(value);
      }).toThrow(message);
    },
  );

  test("a ClickHouse part without its file count is refused", () => {
    const value: Record<string, unknown> = manifest();
    value["clickhouse"] = {
      ...(value["clickhouse"] as Record<string, unknown>),
      fileCount: undefined,
    };

    expect(() => {
      return parseBackupManifest(value);
    }).toThrow("The manifest's fileCount is not a size.");
  });

  test("counts it cannot read are left out, not guessed", () => {
    const value: Record<string, unknown> = manifest();
    value["postgres"] = {
      ...(value["postgres"] as Record<string, unknown>),
      counts: { projects: -1, users: "12", monitors: 7.5, incidents: 4 },
    };

    expect(parseBackupManifest(value).postgres!.counts).toEqual({
      incidents: 4,
    });
  });

  test("a trigger it does not know reads as a manual backup", () => {
    expect(parseBackupManifest(manifest({ trigger: "nightly" })).trigger).toBe(
      BackupRunTrigger.Manual,
    );
  });

  test("text runs no longer than a thousand characters", () => {
    expect(
      parseBackupManifest(manifest({ oneuptimeVersion: "1".repeat(5000) }))
        .oneuptimeVersion,
    ).toHaveLength(1000);
  });
});

describe("a backup's name", () => {
  test("is its start time in UTC, to the second, and the first eight characters of its id", () => {
    expect(
      getBackupName({
        startedAt: new Date("2026-10-24T02:00:00.000Z"),
        id: "3f2a9c1b-7d4e-4b8a-9c3d-4e5f60718293",
      }),
    ).toBe("20261024T020000Z-3f2a9c1b");
  });

  test("pads months, days, hours, minutes and seconds", () => {
    expect(
      getBackupName({
        startedAt: new Date("2027-01-02T03:04:05.678Z"),
        id: "ABCDEF12-0000-0000-0000-000000000000",
      }),
    ).toBe("20270102T030405Z-abcdef12");
  });

  test("lists backups oldest first when sorted as text", () => {
    const names: Array<string> = [
      "2026-10-24T02:00:00.000Z",
      "2026-09-30T23:59:59.000Z",
      "2027-01-01T00:00:00.000Z",
    ].map((at: string): string => {
      return getBackupName({ startedAt: new Date(at), id: "00000000-1111" });
    });

    expect([...names].sort()).toEqual([names[1], names[0], names[2]]);
  });

  test.each(["20261024T020000Z-3f2a9c1b", "20270102T030405Z-abcdef12"])(
    "%s is a backup's name",
    (name: string) => {
      expect(isBackupName(name)).toBe(true);
    },
  );

  test.each([
    "",
    "manifest.json",
    "20261024T020000Z-3f2a9c1",
    "20261024T020000Z-3f2a9c1bb",
    "20261024X020000Z-3f2a9c1b",
    "20261024T020000Y-3f2a9c1b",
    "20261024T020000Z_3f2a9c1b",
    "2026102aT020000Z-3f2a9c1b",
    "20261024T020000Z-3F2A9C1B",
    "20261024T020000Z-3f2a9c1-",
    "test-0b0f7c4e2a",
  ])("%s is not", (name: string) => {
    expect(isBackupName(name)).toBe(false);
  });

  test("every name getBackupName writes is one isBackupName reads", () => {
    for (let index: number = 0; index < 200; index++) {
      const name: string = getBackupName({
        startedAt: new Date(
          Date.UTC(
            2026,
            index % 12,
            (index % 28) + 1,
            index % 24,
            index % 60,
            (index * 7) % 60,
          ),
        ),
        id: `${index.toString(16).padStart(8, "0")}-1234-5678`,
      });

      expect([name, isBackupName(name)]).toEqual([name, true]);
    }
  });
});
