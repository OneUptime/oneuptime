import {
  MoveFixPullRequestSwitchesIntoRules1805820000000,
  SIGNAL_COLUMNS,
  getAddRuleKeepingChoiceStatements,
  getCarryOverStatements,
  getRestoreProjectSwitchesStatement,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805820000000-MoveFixPullRequestSwitchesIntoRules";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS,
  REMEDIATION_RULE_PULL_REQUEST_DEFAULT,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner } from "typeorm";

/*
 * The fix and telemetry pull request switches move from the project into
 * its auto remediation rules, and both kinds of rule get a list of code
 * repositories. Every project keeps its choice: the carry-over runs after
 * the rules' columns exist and before the project's columns go.
 *
 * Fake QueryRunner only: this pins the statements, their order and what
 * each one may touch. MoveFixPullRequestSwitchesIntoRulesPostgres.test.ts
 * runs them against real rows.
 */

const OWN_CLASS_NAME: string =
  "MoveFixPullRequestSwitchesIntoRules1805820000000";

const MIGRATION_FILE_NAME: string =
  "1805820000000-MoveFixPullRequestSwitchesIntoRules.ts";

const MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const PROJECT_SWITCHES: Array<string> = [
  "enableIncidentInstrumentationFixTasks",
  "enableAlertInstrumentationFixTasks",
  "enableAutomaticIncidentCodeFixes",
  "enableAutomaticAlertCodeFixes",
];

// A class name's 13-digit stamp.
const STAMP: RegExp = /(\d{13})$/;

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new MoveFixPullRequestSwitchesIntoRules1805820000000()[direction](
    queryRunner,
  );

  return statements;
}

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOf(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(STAMP);
  return match ? Number(match[1]) : null;
}

function indexOfStatement(
  statements: Array<string>,
  startsWith: string,
): number {
  const index: number = statements.findIndex((statement: string): boolean => {
    return statement.startsWith(startsWith);
  });

  expect([startsWith, index >= 0]).toEqual([startsWith, true]);
  return index;
}

describe("MoveFixPullRequestSwitchesIntoRules migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, MIGRATION_FILE_NAME),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(new MoveFixPullRequestSwitchesIntoRules1805820000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered exactly once, after every migration stamped before it", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOf(OWN_CLASS_NAME)!;

    expect(
      registeredNames.slice(0, ownIndex).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp !== null && timestamp >= ownTimestamp;
      }),
    ).toEqual([]);
    expect(
      registeredNames.slice(ownIndex + 1).filter((name: string): boolean => {
        const timestamp: number | null = timestampOf(name);
        return timestamp === null || timestamp <= ownTimestamp;
      }),
    ).toEqual([]);
  });

  test("runs after the migrations that added what it reads", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    for (const earlier of [
      // The project's per-signal fixing and pull request switches.
      "AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000",
      // The rule's Runner, beside which the new columns sit.
      "AddAutoRemediationRuleRunner1804750000000",
      // Runbook credentials went just before (#5162).
      "RemoveRunbookCredentials1805780000000",
    ]) {
      const index: number = registeredNames.indexOf(earlier);
      expect([earlier, index >= 0 && index < ownIndex]).toEqual([
        earlier,
        true,
      ]);
    }
  });

  test("no other migration's up() drops the project's switches", () => {
    const droppers: Array<string> = fs
      .readdirSync(MIGRATIONS_DIRECTORY)
      .filter((fileName: string): boolean => {
        if (fileName === MIGRATION_FILE_NAME || !fileName.endsWith(".ts")) {
          return false;
        }

        const source: string = fs.readFileSync(
          path.join(MIGRATIONS_DIRECTORY, fileName),
          "utf8",
        );
        const upBody: string = source.slice(
          source.indexOf("public async up("),
          source.indexOf("public async down("),
        );

        return PROJECT_SWITCHES.some((column: string): boolean => {
          return upBody.includes(`DROP COLUMN "${column}"`);
        });
      });

    expect(droppers).toEqual([]);
  });
});

describe("MoveFixPullRequestSwitchesIntoRules migration - up()", () => {
  test("adds the rule columns on by default, as the model declares them", async () => {
    const statements: Array<string> = await recordQueries("up");
    const rule: AutoRemediationRule = new AutoRemediationRule();

    for (const column of Object.values(REMEDIATION_RULE_PULL_REQUEST_COLUMNS)) {
      expect(statements).toContain(
        `ALTER TABLE "AutoRemediationRule" ADD "${column}" boolean NOT NULL DEFAULT true`,
      );
      expect(rule.getTableColumnMetadata(column).defaultValue).toBe(
        REMEDIATION_RULE_PULL_REQUEST_DEFAULT,
      );
    }

    expect(REMEDIATION_RULE_PULL_REQUEST_DEFAULT).toBe(true);
  });

  test("the join tables come first, the carry-over before the project's columns go, the foreign keys last", async () => {
    const statements: Array<string> = await recordQueries("up");

    const firstRuleColumn: number = indexOfStatement(
      statements,
      `ALTER TABLE "AutoRemediationRule" ADD "openCodeFixPullRequests"`,
    );
    const firstCarryOver: number = indexOfStatement(
      statements,
      `UPDATE "AutoRemediationRule"`,
    );
    const firstInsert: number = indexOfStatement(
      statements,
      `INSERT INTO "AutoRemediationRule"`,
    );
    const firstDrop: number = indexOfStatement(
      statements,
      `ALTER TABLE "Project" DROP COLUMN`,
    );
    const firstForeignKey: number = statements.findIndex(
      (statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      },
    );

    expect(statements[0]).toContain(
      `CREATE TABLE "AutoRemediationRuleCodeRepository"`,
    );
    expect(firstRuleColumn).toBeLessThan(firstCarryOver);
    expect(firstCarryOver).toBeLessThan(firstInsert);
    expect(firstInsert).toBeLessThan(firstDrop);
    expect(firstDrop).toBeLessThan(firstForeignKey);

    // Every project switch goes, once, after everything that reads it.
    for (const column of PROJECT_SWITCHES) {
      const drops: Array<number> = statements
        .map((statement: string, index: number): number => {
          return statement === `ALTER TABLE "Project" DROP COLUMN "${column}"`
            ? index
            : -1;
        })
        .filter((index: number): boolean => {
          return index >= 0;
        });

      expect([column, drops.length]).toEqual([column, 1]);

      const lastRead: number = statements.reduce(
        (last: number, statement: string, index: number): number => {
          return !statement.startsWith("ALTER TABLE") &&
            statement.includes(`"${column}"`)
            ? index
            : last;
        },
        -1,
      );

      expect(lastRead).toBeLessThan(drops[0]!);
    }
  });

  test("the join tables name the rule and the repository, and go with either", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const [table, ruleColumn, ruleTable] of [
      [
        "AutoRemediationRuleCodeRepository",
        "autoRemediationRuleId",
        "AutoRemediationRule",
      ],
      [
        "AIInvestigationRuleCodeRepository",
        "aiInvestigationRuleId",
        "AIInvestigationRule",
      ],
    ] as Array<[string, string, string]>) {
      const create: string | undefined = statements.find(
        (statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "${table}"`);
        },
      );

      expect(create).toContain(`"${ruleColumn}" uuid NOT NULL`);
      expect(create).toContain(`"codeRepositoryId" uuid NOT NULL`);
      expect(create).toContain(
        `PRIMARY KEY ("${ruleColumn}", "codeRepositoryId")`,
      );

      const keys: Array<string> = statements.filter(
        (statement: string): boolean => {
          return (
            statement.startsWith(`ALTER TABLE "${table}"`) &&
            statement.includes("FOREIGN KEY")
          );
        },
      );

      expect(keys).toHaveLength(2);
      expect(keys.join("\n")).toContain(`REFERENCES "${ruleTable}"("_id")`);
      expect(keys.join("\n")).toContain(`REFERENCES "CodeRepository"("_id")`);
      for (const key of keys) {
        expect(key).toContain("ON DELETE CASCADE");
      }
    }
  });

  test("the carry-over touches only rules of the signal's kind, in projects with fixing on and that switch off", () => {
    const statements: Array<string> = getCarryOverStatements();

    expect(statements).toHaveLength(4);

    for (const signal of SIGNAL_COLUMNS) {
      const ofSignal: Array<string> = statements.filter(
        (statement: string): boolean => {
          return statement.includes(
            `rule."triggerEntityType" = '${signal.triggerEntityType}'`,
          );
        },
      );

      expect(ofSignal).toHaveLength(2);

      for (const statement of ofSignal) {
        expect(statement).toContain(`project."${signal.fix}" = true`);
        expect(statement).toContain(`rule."projectId" = project."_id"`);
      }

      expect(ofSignal[0]).toContain(`SET "openCodeFixPullRequests" = false`);
      expect(ofSignal[0]).toContain(`project."${signal.codeFix}" = false`);
      expect(ofSignal[1]).toContain(`SET "openTelemetryPullRequests" = false`);
      expect(ofSignal[1]).toContain(`project."${signal.telemetry}" = false`);
    }
  });

  test("the rule that keeps a choice: only where no enabled rule holds it, fixing as no rule did", () => {
    const statements: Array<string> = getAddRuleKeepingChoiceStatements();

    expect(statements).toHaveLength(2);

    statements.forEach((statement: string, index: number): void => {
      const signal: (typeof SIGNAL_COLUMNS)[number] = SIGNAL_COLUMNS[index]!;

      expect(statement).toContain(`'${signal.ruleName}'`);
      expect(statement).toContain(
        `'${signal.triggerEntityType}', 'FullAuto', 'OneUptimeAI'`,
      );
      expect(statement).toContain(
        `project."${signal.codeFix}", project."${signal.telemetry}" FROM "Project"`,
      );
      expect(statement).toContain(`project."deletedAt" IS NULL`);
      expect(statement).toContain(`project."${signal.fix}" = true`);
      expect(statement).toContain(
        `(project."${signal.codeFix}" = false OR project."${signal.telemetry}" = false)`,
      );
      expect(statement).toContain(
        `NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = '${signal.triggerEntityType}' AND rule."isEnabled" = true AND rule."deletedAt" IS NULL)`,
      );
      // The table's own defaults give its id and timestamps.
      expect(statement).not.toContain("uuid_generate_v4");
      // Its description's quote is written twice, as SQL wants.
      expect(statement).toContain("this project''s choice");
    });

    expect(
      SIGNAL_COLUMNS.map((signal: { ruleName: string }) => {
        return signal.ruleName;
      }),
    ).toEqual(["All incidents", "All alerts"]);
  });

  test("names the fixing switches the server reads", () => {
    expect(SIGNAL_COLUMNS[0]!.fix).toBe(
      AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Incident],
    );
    expect(SIGNAL_COLUMNS[1]!.fix).toBe(
      AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Alert],
    );

    const project: Project = new Project();

    for (const signal of SIGNAL_COLUMNS) {
      expect(project.hasColumn(signal.fix)).toBe(true);
      expect(project.hasColumn(signal.codeFix)).toBe(false);
      expect(project.hasColumn(signal.telemetry)).toBe(false);
    }
  });
});

describe("MoveFixPullRequestSwitchesIntoRules migration - down()", () => {
  test("puts the project's switches back as they were added, then fills them from the rules before the rules' columns go", async () => {
    const statements: Array<string> = await recordQueries("down");

    for (const column of PROJECT_SWITCHES) {
      expect(statements).toContain(
        `ALTER TABLE "Project" ADD "${column}" boolean NOT NULL DEFAULT false`,
      );
    }

    const restores: Array<number> = SIGNAL_COLUMNS.map(
      (signal: (typeof SIGNAL_COLUMNS)[number]): number => {
        return statements.indexOf(getRestoreProjectSwitchesStatement(signal));
      },
    );
    const ruleColumnDrop: number = indexOfStatement(
      statements,
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN`,
    );
    const lastProjectAdd: number = Math.max(
      ...PROJECT_SWITCHES.map((column: string): number => {
        return statements.indexOf(
          `ALTER TABLE "Project" ADD "${column}" boolean NOT NULL DEFAULT false`,
        );
      }),
    );

    for (const restore of restores) {
      expect(restore).toBeGreaterThan(lastProjectAdd);
      expect(restore).toBeLessThan(ruleColumnDrop);
    }

    expect(statements[statements.length - 1]).toBe(
      `DROP TABLE "AutoRemediationRuleCodeRepository"`,
    );
  });

  test("a switch is back on only while fixing is on and no rule of the kind has it off", () => {
    const statement: string = getRestoreProjectSwitchesStatement(
      SIGNAL_COLUMNS[0]!,
    );

    expect(statement).toContain(
      `"enableAutomaticIncidentCodeFixes" = (project."enableAutomaticIncidentRemediation" = true AND NOT EXISTS`,
    );
    expect(statement).toContain(`rule."openCodeFixPullRequests" = false`);
    expect(statement).toContain(`rule."openTelemetryPullRequests" = false`);
    expect(statement).toContain(`rule."triggerEntityType" = 'Incident'`);
    expect(statement).toContain(`rule."deletedAt" IS NULL`);
  });
});
