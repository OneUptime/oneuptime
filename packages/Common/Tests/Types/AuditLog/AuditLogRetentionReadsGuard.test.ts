import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AuditLogRetentionRead,
  findAuditLogRetentionReads,
} from "../../Helpers/AuditLogRetentionReadScan";
import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";

/*
 * EVERY READ OF A PROJECT'S AUDIT LOG RETENTION GOES THROUGH THE ONE RULE.
 *
 * The recorder clamped a project's auditLogsRetentionInDays to 1 to 180
 * days, and a failing audit log export took any value <= 0 as 7: for a
 * stored -3 the recorder deleted entries after a day, while the export's
 * "will start losing entries" email was due six days after they were gone
 * (#6383). Both read it through Common/Types/AuditLog/AuditLogRetention now,
 * and this guard holds every reader in packages/ to it: a read of the column
 * in product code goes into one of the rule's functions, or is listed below
 * with its reason. A new reader with a fallback of its own (`?? 7`, `|| 7`,
 * a clamp) fails here, before it disagrees with the recorder.
 *
 * ee/'s readers - the recorder, the export, the settings page - are held to
 * it by ee/Tests/Server/AuditLogRetentionReadsGuard.test.ts, since the
 * Common Test job removes ee/ before it runs.
 */

// Thousands of files are walked; few name the column, so few are parsed.
const SCAN_TIMEOUT_IN_MS: number = 300000;

interface ListedRead {
  file: string;
  within: string;
  reason: string;
}

// Reads the rule does not take, each for its reason. The list only shrinks.
const LISTED: ReadonlyArray<ListedRead> = [
  {
    file: "packages/Common/Server/Services/ProjectService.ts",
    within: "widensAuditLogging",
    reason:
      "The value a write sends: one that is not a number counts as widening, and a number is compared by the rule.",
  },
  {
    file: "packages/Common/Server/Services/ProjectService.ts",
    within: "applyAuditLogRetentionRules",
    reason:
      "The write check itself: it refuses what the rule would not save, and stores the rest as numbers.",
  },
  {
    file: "packages/Common/Server/Services/ProjectService.ts",
    within: "findAuditLogSettingsInCallerScope",
    reason:
      "Carries each stored value to widensAuditLogging, which reads it by the rule.",
  },
];

const isListed: (read: AuditLogRetentionRead) => boolean = (
  read: AuditLogRetentionRead,
): boolean => {
  return LISTED.some((listed: ListedRead): boolean => {
    return listed.file === read.file && listed.within === read.within;
  });
};

const CODE_FILE: RegExp = /\.tsx?$/;

let reads: Array<AuditLogRetentionRead> | null = null;

// Every read of the column in packages/, read once for the suite.
const readsInPackages: () => Array<AuditLogRetentionRead> = (): Array<AuditLogRetentionRead> => {
  if (!reads) {
    reads = listProductFiles(REPOSITORY_DIRECTORY, ["packages"])
      .filter((file: string): boolean => {
        return CODE_FILE.test(file);
      })
      .flatMap((file: string): Array<AuditLogRetentionRead> => {
        return findAuditLogRetentionReads(
          file,
          fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
        );
      });
  }

  return reads;
};

const describeRead: (read: AuditLogRetentionRead) => string = (
  read: AuditLogRetentionRead,
): string => {
  return `${read.file}:${read.line} (${read.within || "top level"}): ${read.text}`;
};

describe("every read of a project's audit log retention goes through the one rule", () => {
  test(
    "the walk reads the product code of packages/",
    () => {
      const files: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
        "packages",
      ]);

      // Guards the guard: a broken walk would leave it reading nothing.
      expect(files.length).toBeGreaterThan(1000);
      expect(files).toEqual(
        expect.arrayContaining([
          "packages/Common/Server/Services/ProjectService.ts",
          "packages/Common/Types/AuditLog/AuditLogRetention.ts",
          "packages/Common/Models/DatabaseModels/Project.ts",
        ]),
      );
      expect(files).not.toContain(
        "packages/Common/Tests/Types/AuditLog/AuditLogRetentionReadsGuard.test.ts",
      );
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test(
    "each read goes into the rule, or is listed with its reason",
    () => {
      const unruled: Array<string> = readsInPackages()
        .filter((read: AuditLogRetentionRead): boolean => {
          return !read.throughRule && !isListed(read);
        })
        .map(describeRead);

      expect(unruled).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test(
    "the listed reads are still there: the list only shrinks",
    () => {
      for (const listed of LISTED) {
        expect({
          listed: `${listed.file} (${listed.within})`,
          stillReads: readsInPackages().some(
            (read: AuditLogRetentionRead): boolean => {
              return (
                read.file === listed.file &&
                read.within === listed.within &&
                !read.throughRule
              );
            },
          ),
        }).toEqual({
          listed: `${listed.file} (${listed.within})`,
          stillReads: true,
        });
      }
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test(
    "ProjectService compares the stored retention by the rule",
    () => {
      expect(
        readsInPackages().some((read: AuditLogRetentionRead): boolean => {
          return (
            read.file === "packages/Common/Server/Services/ProjectService.ts" &&
            read.within === "widensAuditLogging" &&
            read.throughRule &&
            read.text.includes("current.auditLogsRetentionInDays")
          );
        }),
      ).toBe(true);
    },
    SCAN_TIMEOUT_IN_MS,
  );
});

describe("what the scan counts as a read, and whether the rule takes it", () => {
  const readsOf: (
    text: string,
    file?: string,
  ) => Array<Pick<AuditLogRetentionRead, "line" | "within" | "throughRule">> = (
    text: string,
    file: string = "Example.ts",
  ): Array<Pick<AuditLogRetentionRead, "line" | "within" | "throughRule">> => {
    return findAuditLogRetentionReads(file, text).map(
      (
        read: AuditLogRetentionRead,
      ): Pick<AuditLogRetentionRead, "line" | "within" | "throughRule"> => {
        return {
          line: read.line,
          within: read.within,
          throughRule: read.throughRule,
        };
      },
    );
  };

  test("a fallback or a clamp of its own is a read the rule does not take", () => {
    expect(
      readsOf(
        [
          "const days = (project) => project.auditLogsRetentionInDays ?? 7;",
          "function clamp(project) {",
          "  return Math.max(1, Math.min(project.auditLogsRetentionInDays || 7, 180));",
          "}",
          'const named = project["auditLogsRetentionInDays"] || 7;',
          "const optional = project?.auditLogsRetentionInDays;",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 1, within: "days", throughRule: false },
      { line: 3, within: "clamp", throughRule: false },
      { line: 5, within: "named", throughRule: false },
      { line: 6, within: "optional", throughRule: false },
    ]);
  });

  test("a read inside one of the rule's calls is taken by it, over as many lines as it runs", () => {
    expect(
      readsOf(
        [
          "const a = readAuditLogRetentionInDays(project.auditLogsRetentionInDays);",
          "const b = {",
          "  retentionInDays: readAuditLogRetentionInDays(",
          "    project?.auditLogsRetentionInDays,",
          "  ),",
          "};",
          "const c = getAuditLogRetentionDate({",
          "  recordedAt: now,",
          '  retentionInDays: project["auditLogsRetentionInDays"],',
          "});",
          "const d = Rule.getAuditLogRetentionError(data.auditLogsRetentionInDays);",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 1, within: "a", throughRule: true },
      { line: 4, within: "b", throughRule: true },
      { line: 9, within: "c", throughRule: true },
      { line: 11, within: "d", throughRule: true },
    ]);
  });

  test("whatever a read becomes inside the rule's call, the rule reads it; one that reaches the rule only as a callback's item is not counted", () => {
    expect(
      readsOf(
        "const e = readAuditLogRetentionInDays(Number(String(project.auditLogsRetentionInDays)) || 1);\nconst f = [project.auditLogsRetentionInDays].map(readAuditLogRetentionInDays);",
      ),
    ).toEqual([
      // Wrapped, but inside the call: the rule clamps whatever it is handed.
      { line: 1, within: "e", throughRule: true },
      // Not an argument of the rule's call: counted as a read of its own.
      { line: 2, within: "f", throughRule: false },
    ]);
  });

  test("a write, a select, a sort, a type and the column's declaration are no reads", () => {
    expect(
      readsOf(
        [
          "project.auditLogsRetentionInDays = 7;",
          'project["auditLogsRetentionInDays"] = 30;',
          "const select = { auditLogsRetentionInDays: true };",
          "const sort = { auditLogsRetentionInDays: SortOrder.Ascending };",
          "type Settings = { auditLogsRetentionInDays?: number };",
          "class Project { public auditLogsRetentionInDays?: number = undefined; }",
          'const columns = ["auditLogsRetentionInDays"];',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a write that reads the stored value through the rule is one read, taken by it", () => {
    expect(
      readsOf(
        "project.auditLogsRetentionInDays = readAuditLogRetentionInDays(project.auditLogsRetentionInDays);",
      ),
    ).toEqual([{ line: 1, within: "", throughRule: true }]);
  });

  test("a component's read, in TSX", () => {
    expect(
      readsOf(
        [
          "const Card = (props) => {",
          "  return <span>{readAuditLogRetentionInDays(props.project.auditLogsRetentionInDays)}</span>;",
          "};",
          "const Raw = (props) => {",
          "  return <span>{props.project.auditLogsRetentionInDays}</span>;",
          "};",
        ].join("\n"),
        "Example.tsx",
      ),
    ).toEqual([
      { line: 2, within: "Card", throughRule: true },
      { line: 5, within: "Raw", throughRule: false },
    ]);
  });

  test("a file that never names the column is not parsed", () => {
    expect(readsOf("const days = project.retention ?? 7;")).toEqual([]);
  });
});
