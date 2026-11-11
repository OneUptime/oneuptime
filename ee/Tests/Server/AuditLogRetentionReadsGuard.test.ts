import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AuditLogRetentionRead,
  findAuditLogRetentionReads,
} from "Common/Tests/Helpers/AuditLogRetentionReadScan";
import { listProductFiles } from "Common/Tests/Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "Common/Tests/Helpers/TagStripScan";

/*
 * ee/'s readers of a project's audit log retention go through the one rule.
 *
 * The recorder (Server/AuditLog/AuditLogRecorder) clamped
 * auditLogsRetentionInDays to 1 to 180 days, and a failing export
 * (Server/AuditLogExport/AuditLogExportNotifications) took any value <= 0 as
 * 7: for a stored -3 the recorder deleted entries after a day, while the
 * export's "will start losing entries" email was due six days after they
 * were gone (#6383). Both read it through Common/Types/AuditLog/AuditLogRetention
 * now, as does the settings page (Dashboard/AuditLogs/AuditLogsSettings).
 *
 * packages/Common/Tests/Types/AuditLog/AuditLogRetentionReadsGuard.test.ts
 * holds packages/ to it, but the Common Test job removes ee/ before it runs.
 * This suite runs the same scan (Common/Tests/Helpers/AuditLogRetentionReadScan)
 * over ee/'s product code, from ee's own jest run: every read goes into one
 * of the rule's functions, and none is excused.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

const CODE_FILE: RegExp = /\.tsx?$/;

// The readers ee/ has: each reads the column, and only through the rule.
const KNOWN_READERS: ReadonlyArray<string> = [
  "ee/Server/AuditLog/AuditLogRecorder.ts",
  "ee/Server/AuditLogExport/AuditLogExportNotifications.ts",
  "ee/Dashboard/AuditLogs/AuditLogsSettings.tsx",
];

describe("ee/'s reads of a project's audit log retention go through the one rule", () => {
  const files: Array<string> = listProductFiles(REPOSITORY_ROOT, ["ee"]).filter(
    (file: string): boolean => {
      return CODE_FILE.test(file);
    },
  );
  const reads: Array<AuditLogRetentionRead> = files.flatMap(
    (file: string): Array<AuditLogRetentionRead> => {
      return findAuditLogRetentionReads(
        file,
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      );
    },
  );

  test("the shared scan reads this checkout, and the walk reads ee/'s product code", () => {
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
    // Guards the guard: a broken walk would leave it reading nothing.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining([...KNOWN_READERS]));
    expect(files).not.toContain(
      "ee/Tests/Server/AuditLogRetentionReadsGuard.test.ts",
    );
  });

  test("each read goes into the rule", () => {
    expect(
      reads
        .filter((read: AuditLogRetentionRead): boolean => {
          return !read.throughRule;
        })
        .map((read: AuditLogRetentionRead): string => {
          return `${read.file}:${read.line} (${read.within || "top level"}): ${read.text}`;
        }),
    ).toEqual([]);
  });

  test.each(KNOWN_READERS)("%s reads it, through the rule", (file: string) => {
    const inFile: Array<AuditLogRetentionRead> = reads.filter(
      (read: AuditLogRetentionRead): boolean => {
        return read.file === file;
      },
    );

    expect(inFile.length).toBeGreaterThan(0);
    expect(
      inFile.every((read: AuditLogRetentionRead): boolean => {
        return read.throughRule;
      }),
    ).toBe(true);
  });

  test("the recorder stamps each entry's retentionDate by the rule, and the export reckons the same moment by it", () => {
    const recorder: string = fs.readFileSync(
      path.join(EE_DIR, "Server/AuditLog/AuditLogRecorder.ts"),
      "utf8",
    );
    const notifications: string = fs.readFileSync(
      path.join(EE_DIR, "Server/AuditLogExport/AuditLogExportNotifications.ts"),
      "utf8",
    );

    expect(recorder).toContain("return getAuditLogRetentionDate({");
    expect(notifications).toContain("return getAuditLogRetentionDate({");
  });
});
