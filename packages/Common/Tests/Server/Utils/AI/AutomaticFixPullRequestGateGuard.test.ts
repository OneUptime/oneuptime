import {
  getAutomaticFixPullRequestColumns,
  AUTOMATIC_FIX_SWITCH_COLUMNS,
} from "../../../../Types/AI/AutomaticFixSwitches";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * The pull requests OneUptime AI opens on its own - a fix when an
 * investigation finds a code change, missing telemetry when one cannot find
 * a cause - are part of fixing: one opens only while its own switch AND
 * "Fix new incidents automatically" (or alerts) are on. That is one rule,
 * in Types/AI/AutomaticFixSwitches, and this guard keeps it the only way
 * code decides it:
 *
 *  - no source outside the rule reads a pull-request switch column itself
 *    (project.enableAutomaticIncidentCodeFixes, project["..."]): a check
 *    written that way would leave the fixing switch out, and a pull request
 *    would open with fixing off;
 *  - both triggers decide through getAutomaticFixPullRequestBlocker, and
 *    read the project through getAutomaticFixPullRequestSelect - so they
 *    read the fixing switch too;
 *  - negative controls: the scan finds a direct read in a snippet, and a
 *    select or a model declaration is not one.
 *
 * Only real syntax is read, through the TypeScript AST. ee/ is scanned when
 * it is there (Common Test runs without it).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/Common/UI",
  "packages/App/FeatureSet",
  "ee",
];

// Never source: dependencies, builds, tests and generated output.
const SKIPPED_DIRECTORY_NAMES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
  "public",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

const RULE_FILE: string = "packages/Common/Types/AI/AutomaticFixSwitches.ts";

const TRIGGERS: Array<string> = [
  "packages/Common/Server/Utils/AI/SRE/FixFromIncidentTaskTrigger.ts",
  "packages/Common/Server/Utils/AI/SRE/InstrumentationTaskTrigger.ts",
];

const PULL_REQUEST_COLUMNS: Set<string> = new Set<string>([
  ...getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Incident),
  ...getAutomaticFixPullRequestColumns(AutoRemediationTriggerEntity.Alert),
]);

function listSources(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.includes(entry.name)) {
        found.push(...listSources(full));
      }
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      found.push(full);
    }
  }

  return found;
}

// Every direct read of a pull-request switch column in the source.
function findDirectReads(fileName: string, sourceText: string): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<string> = [];

  const where: (node: ts.Node) => string = (node: ts.Node): string => {
    const line: number =
      sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    return `${fileName}:${line}: ${node.getText()}`;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      PULL_REQUEST_COLUMNS.has(node.name.text)
    ) {
      found.push(where(node));
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      PULL_REQUEST_COLUMNS.has(node.argumentExpression.text)
    ) {
      found.push(where(node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

describe("the pull-request switches are read only through the one rule", () => {
  test("the scan covers the server, the shared code and the apps", () => {
    const files: Array<string> = SCANNED_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listSources(path.join(REPOSITORY_ROOT, directory));
      },
    );

    // A walk that found nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(1000);
    for (const trigger of TRIGGERS) {
      expect(files).toContain(path.join(REPOSITORY_ROOT, trigger));
    }
  });

  test("no source reads a pull-request switch column itself", () => {
    const reads: Array<string> = SCANNED_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listSources(path.join(REPOSITORY_ROOT, directory));
      },
    )
      .filter((file: string): boolean => {
        return file !== path.join(REPOSITORY_ROOT, RULE_FILE);
      })
      .flatMap((file: string): Array<string> => {
        return findDirectReads(
          path.relative(REPOSITORY_ROOT, file),
          fs.readFileSync(file, "utf8"),
        );
      });

    expect(reads).toEqual([]);
    // Parsing every source takes a while on a busy runner.
  }, 300000);

  test.each(TRIGGERS)(
    "%s decides through the rule, and reads the project through its select",
    (trigger: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, trigger),
        "utf8",
      );

      expect(source).toContain(
        'from "../../../../Types/AI/AutomaticFixSwitches"',
      );
      expect(source).toContain("getAutomaticFixPullRequestBlocker({");
      expect(source).toContain("...getAutomaticFixPullRequestSelect(");
      expect(source).toContain(
        "blocker === AutomaticFixPullRequestBlocker.FixOff",
      );
      expect(source).toContain(
        "blocker === AutomaticFixPullRequestBlocker.PullRequestOff",
      );

      // The fixing switches are never named by hand in a trigger.
      for (const signal of [
        AutoRemediationTriggerEntity.Incident,
        AutoRemediationTriggerEntity.Alert,
      ]) {
        expect(source).not.toContain(AUTOMATIC_FIX_SWITCH_COLUMNS[signal].fix);
      }
    },
  );
});

describe("negative controls: the scan itself", () => {
  test("it finds a direct read, by property or by name", () => {
    expect(
      findDirectReads(
        "Snippet.ts",
        [
          "const a = project.enableAutomaticIncidentCodeFixes === true;",
          'const b = project["enableAlertInstrumentationFixTasks"];',
          "const c = input.project?.enableAutomaticAlertCodeFixes;",
        ].join("\n"),
      ),
    ).toEqual([
      "Snippet.ts:1: project.enableAutomaticIncidentCodeFixes",
      'Snippet.ts:2: project["enableAlertInstrumentationFixTasks"]',
      "Snippet.ts:3: input.project?.enableAutomaticAlertCodeFixes",
    ]);
  });

  test("a select, a write, a model declaration or a string is not a read", () => {
    expect(
      findDirectReads(
        "Snippet.ts",
        [
          "const select = { enableAutomaticIncidentCodeFixes: true };",
          "update({ data: { enableIncidentInstrumentationFixTasks: false } });",
          "class Project { public enableAutomaticAlertCodeFixes?: boolean = undefined; }",
          'const column: string = "enableAlertInstrumentationFixTasks";',
          "const other = project.enableAutomaticIncidentRemediation;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
