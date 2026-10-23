import { AddAiRuleInvestigation1806800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806800000000-AddAiRuleInvestigation";
import {
  ADDED_RULE_DESCRIPTIONS,
  ADDED_RULE_NAMES,
  AI_RULE_JOIN_TABLES,
  AI_RULE_LANES,
  COPY_INVESTIGATION_RULES,
  CONVERT_REMEDIATION_RULES,
  FIX_SWITCH_COLUMNS,
  MERGE_PAIRS,
  MergeInvestigationRulesIntoAiRules1806810000000,
  RULE_LIST_TABLES,
  RuleListTable,
  getAddFixEveryOneStatement,
  getAddInvestigateEveryOneStatement,
  getCopyListStatements,
  getDownStatements,
  getUpStatements,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806810000000-MergeInvestigationRulesIntoAiRules";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import { AUTOMATIC_FIX_SWITCH_COLUMNS } from "../../../../Types/AI/AutomaticFixPullRequests";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * Investigation rules move into the AI rules (the auto remediation rules'
 * table): AddAiRuleInvestigation adds the columns, and
 * MergeInvestigationRulesIntoAiRules moves the rules.
 *
 * Fake QueryRunner only: this pins the statements, their order and what
 * each one may touch. MergeInvestigationRulesIntoAiRulesPostgres.test.ts
 * runs them against real rows, and proves no project's AI does anything
 * different afterwards.
 */

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

const COLUMNS_CLASS_NAME: string = "AddAiRuleInvestigation1806800000000";
const MERGE_CLASS_NAME: string =
  "MergeInvestigationRulesIntoAiRules1806810000000";

// A class name's 13-digit stamp.
const STAMP: RegExp = /(\d{13})$/;

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOf(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(STAMP);
  return match ? Number(match[1]) : null;
}

async function recordQueries(
  migration: {
    up: (queryRunner: QueryRunner) => Promise<void>;
    down: (queryRunner: QueryRunner) => Promise<void>;
  },
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

// The join tables the AutoRemediationRule model declares, by property.
function getModelJoinTables(): Map<string, string> {
  const joinTables: Map<string, string> = new Map();

  for (const joinTable of getMetadataArgsStorage().joinTables) {
    if (joinTable.target !== AutoRemediationRule) {
      continue;
    }

    const args: JoinTableMetadataArgs = joinTable;
    joinTables.set(args.propertyName, args.name || "");
  }

  return joinTables;
}

describe("AI rule migrations - identity and registration", () => {
  test("live at round stamps, with classes and names that carry them", () => {
    for (const [fileName, className, migration] of [
      [
        "1806800000000-AddAiRuleInvestigation.ts",
        COLUMNS_CLASS_NAME,
        new AddAiRuleInvestigation1806800000000(),
      ],
      [
        "1806810000000-MergeInvestigationRulesIntoAiRules.ts",
        MERGE_CLASS_NAME,
        new MergeInvestigationRulesIntoAiRules1806810000000(),
      ],
    ] as Array<[string, string, { name: string }]>) {
      const source: string = fs.readFileSync(
        path.join(MIGRATIONS_DIRECTORY, fileName),
        "utf8",
      );

      expect(source).toContain(`export class ${className}`);
      expect(migration.name).toBe(className);
    }
  });

  test("each is registered exactly once, the columns right before the move, both after every migration stamped before them", () => {
    for (const className of [COLUMNS_CLASS_NAME, MERGE_CLASS_NAME]) {
      expect(
        registeredNames.filter((name: string): boolean => {
          return name === className;
        }),
      ).toHaveLength(1);

      const ownIndex: number = registeredNames.indexOf(className);
      const ownTimestamp: number = timestampOf(className)!;

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
    }

    expect(registeredNames.indexOf(MERGE_CLASS_NAME)).toBe(
      registeredNames.indexOf(COLUMNS_CLASS_NAME) + 1,
    );
  });

  test("run after the migrations that added what they read", () => {
    const ownIndex: number = registeredNames.indexOf(COLUMNS_CLASS_NAME);

    for (const earlier of [
      // The investigation rules and the per-signal fixing switches.
      "AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000",
      // The rules' MCP servers.
      "AddExternalMcpServers1805000000000",
      // The investigation rules' wait.
      "AddInvestigationRuleWait1805030000000",
      // Both kinds' code repositories, and the pull request switches.
      "MoveFixPullRequestSwitchesIntoRules1805830000000",
      // Both kinds' LLM provider.
      "AddRuleLlmProviders1806030000000",
      "AddRuleLlmProviderIndexesAndKeys1806040000000",
    ]) {
      const index: number = registeredNames.indexOf(earlier);
      expect([earlier, index >= 0 && index < ownIndex]).toEqual([
        earlier,
        true,
      ]);
    }
  });

  test("both run in a transaction, so a stop rolls all of a migration back", () => {
    for (const migration of [
      new AddAiRuleInvestigation1806800000000(),
      new MergeInvestigationRulesIntoAiRules1806810000000(),
    ]) {
      expect(
        (migration as unknown as { transaction?: boolean }).transaction,
      ).not.toBe(false);
    }
  });
});

describe("AddAiRuleInvestigation - the columns", () => {
  test("adds the three columns as the model declares them, and nothing else", async () => {
    const statements: Array<string> = await recordQueries(
      new AddAiRuleInvestigation1806800000000(),
      "up",
    );
    const rule: AutoRemediationRule = new AutoRemediationRule();

    expect(statements).toEqual([
      `ALTER TABLE "AutoRemediationRule" ADD "investigates" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "AutoRemediationRule" ADD "onlyIfOpenAfterMinutes" integer`,
      `ALTER TABLE "AutoRemediationRule" ADD "fixes" boolean NOT NULL DEFAULT true`,
    ]);

    // An older API client's rule fixes and does not investigate.
    expect(rule.getTableColumnMetadata("investigates").defaultValue).toBe(
      false,
    );
    expect(rule.getTableColumnMetadata("fixes").defaultValue).toBe(true);
    expect(rule.getTableColumnMetadata("onlyIfOpenAfterMinutes").required).toBe(
      false,
    );
  });

  test("builds no index and no key on the busy rule table", async () => {
    const statements: Array<string> = await recordQueries(
      new AddAiRuleInvestigation1806800000000(),
      "up",
    );

    for (const statement of statements) {
      expect(statement).not.toContain("CREATE INDEX");
      expect(statement).not.toContain("FOREIGN KEY");
    }
  });

  test("down() drops the three columns", async () => {
    const statements: Array<string> = await recordQueries(
      new AddAiRuleInvestigation1806800000000(),
      "down",
    );

    expect(statements).toEqual([
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "fixes"`,
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "onlyIfOpenAfterMinutes"`,
      `ALTER TABLE "AutoRemediationRule" DROP COLUMN "investigates"`,
    ]);
  });
});

describe("MergeInvestigationRulesIntoAiRules - up()", () => {
  test("merges the pairs, copies the rest with their lists, converts, then adds the two rules, in that order", async () => {
    const statements: Array<string> = await recordQueries(
      new MergeInvestigationRulesIntoAiRules1806810000000(),
      "up",
    );

    expect(statements).toEqual(getUpStatements());
    expect(statements).toEqual([
      MERGE_PAIRS,
      COPY_INVESTIGATION_RULES,
      ...getCopyListStatements(),
      CONVERT_REMEDIATION_RULES,
      getAddInvestigateEveryOneStatement("Incident"),
      getAddInvestigateEveryOneStatement("Alert"),
      getAddFixEveryOneStatement("Incident"),
      getAddFixEveryOneStatement("Alert"),
    ]);
  });

  test("never changes an investigation rule: it reads them, and every step decides the same each time it runs", () => {
    for (const statement of getUpStatements()) {
      expect(statement).not.toContain(`UPDATE "AIInvestigationRule"`);
      expect(statement).not.toContain(`DELETE FROM "AIInvestigationRule`);
      expect(statement).not.toContain(`INSERT INTO "AIInvestigationRule`);
      expect(statement).not.toContain("DROP ");
      expect(statement).not.toContain("TRUNCATE");
    }
  });

  test("every insert skips a row that is there, so a second run adds nothing", () => {
    const inserts: Array<string> = getUpStatements().filter(
      (statement: string) => {
        return statement.includes("INSERT INTO");
      },
    );

    expect(inserts).toHaveLength(1 + RULE_LIST_TABLES.length + 4);

    for (const statement of inserts) {
      expect(statement).toContain("ON CONFLICT");
    }
  });

  test("the copies keep the investigation rules' ids, and the added rules have ids made from their project and lane", () => {
    expect(COPY_INVESTIGATION_RULES).toContain(
      `SELECT investigation."_id", investigation."createdAt"`,
    );

    for (const lane of AI_RULE_LANES) {
      expect(getAddInvestigateEveryOneStatement(lane)).toContain(
        `md5('oneuptime-ai-rule-merge:InvestigateEveryOne:' || project."_id"::text || ':' || '${lane}')::uuid`,
      );
      expect(getAddFixEveryOneStatement(lane)).toContain(
        `md5('oneuptime-ai-rule-merge:FixEveryOne:' || project."_id"::text || ':' || '${lane}')::uuid`,
      );
    }
  });

  test("a copy investigates and does not fix; a merged pair and a converted rule investigate; the added rules are one of each", () => {
    expect(COPY_INVESTIGATION_RULES).toContain(
      `investigation."createdByUserId", true, false, 'Suggest', 'OneUptimeAI'`,
    );
    expect(MERGE_PAIRS).toContain(`SET "investigates" = true`);
    expect(CONVERT_REMEDIATION_RULES).toContain(`SET "investigates" = true`);

    for (const lane of AI_RULE_LANES) {
      // Investigates every one, fixes nothing.
      expect(getAddInvestigateEveryOneStatement(lane)).toContain(
        `true, '${lane}', true, false, 'Suggest', 'OneUptimeAI'`,
      );
      // Fixes every one as with no rule - without asking, naming nothing - and investigates nothing.
      expect(getAddFixEveryOneStatement(lane)).toContain(
        `true, '${lane}', false, true, 'FullAuto', 'OneUptimeAI'`,
      );
    }
  });

  test("a converted rule picks no LLM provider, and lives in a project that is not deleted", () => {
    expect(CONVERT_REMEDIATION_RULES).toContain(`rule."llmProviderId" IS NULL`);
    expect(CONVERT_REMEDIATION_RULES).toContain(`project."deletedAt" IS NULL`);
  });

  test("the rule that keeps fixing is added only where fixing is on, and reads each lane's own switch", () => {
    expect(FIX_SWITCH_COLUMNS).toEqual({
      Incident:
        AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Incident],
      Alert: AUTOMATIC_FIX_SWITCH_COLUMNS[AutoRemediationTriggerEntity.Alert],
    });

    for (const lane of AI_RULE_LANES) {
      expect(getAddFixEveryOneStatement(lane)).toContain(
        `project."${FIX_SWITCH_COLUMNS[lane]}" = true`,
      );
      expect(getAddInvestigateEveryOneStatement(lane)).not.toContain(
        FIX_SWITCH_COLUMNS[lane],
      );
    }
  });

  test("the lanes are the AI rules' kinds of signal", () => {
    expect([...AI_RULE_LANES].sort()).toEqual(
      Object.values(AutoRemediationTriggerEntity).sort(),
    );
  });

  test("the added rules' names and descriptions fit the rule's columns", () => {
    for (const kind of ["InvestigateEveryOne", "FixEveryOne"] as const) {
      for (const lane of AI_RULE_LANES) {
        expect(ADDED_RULE_NAMES[kind][lane].length).toBeLessThanOrEqual(
          ColumnLength.ShortText,
        );
        expect(ADDED_RULE_DESCRIPTIONS[kind][lane].length).toBeLessThanOrEqual(
          ColumnLength.LongText,
        );
        expect(ADDED_RULE_NAMES[kind][lane]).toContain(
          lane === "Incident" ? "incident" : "alert",
        );
      }
    }
  });

  test("the lists it reads are every list the AI rule declares but the runbooks and Runners, which only fixing uses", () => {
    const modelJoinTables: Map<string, string> = getModelJoinTables();

    expect(
      RULE_LIST_TABLES.map((table: RuleListTable): [string, string] => {
        return [table.key, table.aiRuleTable];
      }),
    ).toEqual(
      [...modelJoinTables.entries()]
        .filter(([property]: [string, string]): boolean => {
          return property !== "runbooks" && property !== "commandRunners";
        })
        .sort(([first]: [string, string], [second]: [string, string]) => {
          return (
            RULE_LIST_TABLES.findIndex((table: RuleListTable) => {
              return table.key === first;
            }) -
            RULE_LIST_TABLES.findIndex((table: RuleListTable) => {
              return table.key === second;
            })
          );
        }),
    );
  });
});

describe("MergeInvestigationRulesIntoAiRules - down()", () => {
  test("deletes the lists of the rules it takes back before the rules, then makes every rule left one that only fixes", async () => {
    const statements: Array<string> = await recordQueries(
      new MergeInvestigationRulesIntoAiRules1806810000000(),
      "down",
    );

    expect(statements).toEqual(getDownStatements());
    expect(statements).toHaveLength(AI_RULE_JOIN_TABLES.length + 2);

    AI_RULE_JOIN_TABLES.forEach((table: string, index: number) => {
      expect(statements[index]).toContain(`DELETE FROM "${table}"`);
    });

    expect(statements[AI_RULE_JOIN_TABLES.length]).toContain(
      `DELETE FROM "AutoRemediationRule"`,
    );
    // Every rule that does not fix goes: the code before would read it as one that fixes.
    expect(statements[AI_RULE_JOIN_TABLES.length]).toContain(
      `rule."fixes" = false`,
    );
    expect(statements[AI_RULE_JOIN_TABLES.length + 1]).toContain(
      `SET "investigates" = false, "onlyIfOpenAfterMinutes" = NULL`,
    );
  });

  test("never touches the investigation rules", () => {
    for (const statement of getDownStatements()) {
      expect(statement).not.toContain(`DELETE FROM "AIInvestigationRule`);
      expect(statement).not.toContain(`UPDATE "AIInvestigationRule"`);
    }
  });
});
