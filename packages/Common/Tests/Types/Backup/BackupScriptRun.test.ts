import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  BACKUP_SCRIPT_RUN_PATH,
  BACKUP_SCRIPT_RUN_URL_PATH,
  BackupScriptRun,
  readBackupScriptCheckIn,
  readBackupScriptRun,
  toBackupScriptRun,
} from "../../../Types/Backup/BackupScriptRun";

/*
 * WHAT `npm run backup` TELLS THE SERVER, AND WHAT THE SERVER KEEPS (#7026).
 *
 * The script says whether pg_dump finished and the size of its dump; the
 * server keeps that with the time it was told, and nothing else the body
 * holds. What is kept is read back whole, or not at all.
 */

const NOW: Date = new Date("2026-11-17T02:00:00.000Z");

describe("what the script says", () => {
  test("whether the backup succeeded, and the dump's size", () => {
    expect(
      readBackupScriptCheckIn({ succeeded: true, sizeInBytes: 4096 }),
    ).toEqual({
      succeeded: true,
      sizeInBytes: 4096,
    });
    expect(readBackupScriptCheckIn({ succeeded: false })).toEqual({
      succeeded: false,
      sizeInBytes: null,
    });
  });

  test("a body that does not say whether it succeeded is no check-in", () => {
    for (const body of [
      null,
      undefined,
      "succeeded",
      [],
      {},
      { succeeded: "true" },
      { succeeded: 1 },
      { sizeInBytes: 10 },
    ]) {
      expect(readBackupScriptCheckIn(body)).toBeNull();
    }
  });

  test("a size that is not a whole number of bytes is left out, and a failed run has none", () => {
    for (const size of [-1, 1.5, "10", Number.NaN, Infinity, 2 ** 60]) {
      expect(
        readBackupScriptCheckIn({ succeeded: true, sizeInBytes: size }),
      ).toEqual({ succeeded: true, sizeInBytes: null });
    }

    expect(
      readBackupScriptCheckIn({ succeeded: false, sizeInBytes: 4096 }),
    ).toEqual({ succeeded: false, sizeInBytes: null });
  });

  test("nothing else the body holds is read: no path, host, time or credential", () => {
    const checkIn: unknown = readBackupScriptCheckIn({
      succeeded: true,
      sizeInBytes: 1,
      at: "1999-01-01T00:00:00.000Z",
      file: "/home/ada/oneuptime/Backups/db-17.backup",
      password: "secret",
    });

    expect(Object.keys(checkIn as Record<string, unknown>).sort()).toEqual(
      ["sizeInBytes", "succeeded"].sort(),
    );
  });
});

describe("what the server keeps", () => {
  test("the time it was told, not a time the script sent", () => {
    const run: BackupScriptRun = toBackupScriptRun({
      checkIn: { succeeded: true, sizeInBytes: 10 },
      now: NOW,
    });

    expect(run).toEqual({
      at: NOW.toISOString(),
      succeeded: true,
      sizeInBytes: 10,
    });
  });

  test("is read back whole", () => {
    const run: BackupScriptRun = toBackupScriptRun({
      checkIn: { succeeded: false, sizeInBytes: null },
      now: NOW,
    });

    expect(readBackupScriptRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
  });

  test("anything that is not a run reads as none: a server never told, or a damaged value", () => {
    for (const value of [
      null,
      undefined,
      {},
      "x",
      { succeeded: true },
      { succeeded: true, at: "yesterday" },
      { succeeded: "yes", at: NOW.toISOString() },
      { at: NOW.toISOString() },
    ]) {
      expect(readBackupScriptRun(value)).toBeNull();
    }

    expect(
      readBackupScriptRun({
        succeeded: false,
        at: NOW.toISOString(),
        sizeInBytes: 99,
      }),
    ).toEqual({ succeeded: false, at: NOW.toISOString(), sizeInBytes: null });
  });
});

describe("where the script tells it", () => {
  test("under the app's OneUptime Health router, beside the doctor's POST", () => {
    expect(BACKUP_SCRIPT_RUN_PATH).toBe("/backup-run");
    expect(BACKUP_SCRIPT_RUN_URL_PATH).toBe("/api/admin/health/backup-run");

    const repository: string = path.join(__dirname, "../../../../..");
    const route: string = fs.readFileSync(
      path.join(repository, "packages/App/API/AdminHealth.ts"),
      "utf8",
    );
    const tool: string = fs.readFileSync(
      path.join(repository, "Scripts/Install/BackupScriptRun.js"),
      "utf8",
    );

    expect(route).toContain(`"${BACKUP_SCRIPT_RUN_PATH}",`);
    expect(tool).toContain(
      `const BACKUP_SCRIPT_RUN_PATH = "${BACKUP_SCRIPT_RUN_URL_PATH}";`,
    );
  });
});
