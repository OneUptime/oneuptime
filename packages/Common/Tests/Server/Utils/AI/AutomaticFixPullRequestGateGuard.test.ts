import {
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import { INCIDENT_AND_ALERT_TRIGGER_ENTITIES } from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * The pull requests OneUptime AI opens on its own - a fix when an
 * investigation finds a code change, missing telemetry when one cannot find
 * a cause - are part of fixing, and each auto remediation rule says whether
 * it opens them (on by default; on with no rule). That is one rule, in
 * Types/AI/AutomaticFixPullRequests, and this guard keeps it the only way
 * code decides it:
 *
 *  - no source outside the rule reads a rule's pull request switch itself
 *    (rule.openCodeFixPullRequests, rule["..."]): a check written that way
 *    would leave the fixing switch, the matching and the no-rule default out;
 *  - the project's four switches the rules replaced are named nowhere but
 *    the migrations that added and removed them;
 *  - both triggers decide through decideAutomaticFixPullRequest, read the
 *    project through getAutomaticFixSwitchSelect - so they read the fixing
 *    switch - and read the rules through RemediationRulePullRequests;
 *  - negative controls: the scan finds a direct read in a snippet, and a
 *    select, a field or a model declaration is not one.
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

// The migrations that added the project's switches, and removed them.
const MIGRATIONS_DIRECTORY: string =
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations";

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

const RULE_FILE: string =
  "packages/Common/Types/AI/AutomaticFixPullRequests.ts";

const TRIGGERS: Array<string> = [
  "packages/Common/Server/Utils/AI/SRE/FixFromIncidentTaskTrigger.ts",
  "packages/Common/Server/Utils/AI/SRE/InstrumentationTaskTrigger.ts",
];

const RULE_PULL_REQUEST_COLUMNS: Set<string> = new Set<string>(
  Object.values(REMEDIATION_RULE_PULL_REQUEST_COLUMNS),
);

// The project's switches the rules replaced (MoveFixPullRequestSwitchesIntoRules).
const RETIRED_PROJECT_COLUMNS: Array<string> = [
  "enableAutomaticIncidentCodeFixes",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "enableAlertInstrumentationFixTasks",
];

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

function allSources(): Array<string> {
  return SCANNED_DIRECTORIES.flatMap((directory: string): Array<string> => {
    return listSources(path.join(REPOSITORY_ROOT, directory));
  });
}

// Every direct read of one of the columns in the source.
function findDirectReads(
  fileName: string,
  sourceText: string,
  columns: Set<string>,
): Array<string> {
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
    if (ts.isPropertyAccessExpression(node) && columns.has(node.name.text)) {
      found.push(where(node));
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      columns.has(node.argumentExpression.text)
    ) {
      found.push(where(node));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

describe("the rules' pull request switches are read only through the one rule", () => {
  test("the scan covers the server, the shared code and the apps", () => {
    const files: Array<string> = allSources();

    // A walk that found nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(1000);
    for (const trigger of TRIGGERS) {
      expect(files).toContain(path.join(REPOSITORY_ROOT, trigger));
    }
  });

  test("no source reads a rule's pull request switch itself", () => {
    const reads: Array<string> = allSources()
      .filter((file: string): boolean => {
        return file !== path.join(REPOSITORY_ROOT, RULE_FILE);
      })
      .flatMap((file: string): Array<string> => {
        return findDirectReads(
          path.relative(REPOSITORY_ROOT, file),
          fs.readFileSync(file, "utf8"),
          RULE_PULL_REQUEST_COLUMNS,
        );
      });

    expect(reads).toEqual([]);
    // Parsing every source takes a while on a busy runner.
  }, 300000);

  test("the project's retired switches are named nowhere but the migrations", () => {
    const naming: Array<string> = allSources()
      .filter((file: string): boolean => {
        return !path
          .relative(REPOSITORY_ROOT, file)
          .startsWith(`${MIGRATIONS_DIRECTORY}/`);
      })
      .filter((file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return RETIRED_PROJECT_COLUMNS.some((column: string): boolean => {
          return text.includes(column);
        });
      })
      .map((file: string): string => {
        return path.relative(REPOSITORY_ROOT, file);
      });

    expect(naming).toEqual([]);
  }, 300000);

  test.each(TRIGGERS)(
    "%s decides through the rule, reads the project through its select, and the rules through RemediationRulePullRequests",
    (trigger: string) => {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, trigger),
        "utf8",
      );

      expect(source).toContain(
        'from "../../../../Types/AI/AutomaticFixPullRequests"',
      );
      expect(source).toContain("decideAutomaticFixPullRequest({");
      expect(source).toContain("...getAutomaticFixSwitchSelect(signal)");
      expect(source).toContain(
        "await RemediationRulePullRequests.getRulesForSignal({",
      );
      // The run is held to the repositories the rules allow.
      expect(source).toContain(
        "toStoredCodeRepositoryIds(decision.repositories)",
      );

      // The fixing switches are never named by hand in a trigger.
      for (const signal of INCIDENT_AND_ALERT_TRIGGER_ENTITIES) {
        expect(source).not.toContain(AUTOMATIC_FIX_SWITCH_COLUMNS[signal]);
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
          "const a = rule.openCodeFixPullRequests === true;",
          'const b = rule["openTelemetryPullRequests"];',
          "const c = input.rule?.openCodeFixPullRequests;",
        ].join("\n"),
        RULE_PULL_REQUEST_COLUMNS,
      ),
    ).toEqual([
      "Snippet.ts:1: rule.openCodeFixPullRequests",
      'Snippet.ts:2: rule["openTelemetryPullRequests"]',
      "Snippet.ts:3: input.rule?.openCodeFixPullRequests",
    ]);
  });

  test("a select, a field, a write, a model declaration or a string is not a read", () => {
    expect(
      findDirectReads(
        "Snippet.ts",
        [
          "const select = { openCodeFixPullRequests: true };",
          "const field = { field: { openTelemetryPullRequests: true } };",
          "update({ data: { openCodeFixPullRequests: false } });",
          "class AutoRemediationRule { public openTelemetryPullRequests?: boolean = undefined; }",
          'const column: string = "openCodeFixPullRequests";',
          "const other = rule.enableAutomaticIncidentRemediation;",
        ].join("\n"),
        RULE_PULL_REQUEST_COLUMNS,
      ),
    ).toEqual([]);
  });
});
