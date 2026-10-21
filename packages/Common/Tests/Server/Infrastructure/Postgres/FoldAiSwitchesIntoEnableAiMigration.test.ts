import {
  FoldAiSwitchesIntoEnableAi1796800000000,
  IS_KUBERNETES_AGENT_RUNNER_SQL,
  TABLES_WITH_AI_REMEDIATION_MODE,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796800000000-FoldAiSwitchesIntoEnableAi";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Entities from "../../../../Models/DatabaseModels/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import ColumnType from "../../../../Types/Database/ColumnType";
import {
  KUBERNETES_AGENT_RUNNER_NAME_PREFIX,
  KubernetesAiRemediationMode,
  UNATTENDED_REMEDIATION_MODES,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  ResourceAiRemediationMode,
  UNATTENDED_RESOURCE_REMEDIATION_MODES,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";

/*
 * Enable AI becomes the project's only AI switch: the migration drops
 * Project.enableAutoRemediation and Project.enableAiCommandExecution, after
 * moving every unattended rule, cluster and resource that one of them was
 * holding back to asking first.
 *
 * Fake QueryRunner only: this pins the statements, their order and what
 * each one may touch. FoldAiSwitchesIntoEnableAiPostgres.test.ts runs them
 * against real rows.
 */

const OWN_CLASS_NAME: string = "FoldAiSwitchesIntoEnableAi1796800000000";

const MIGRATION_FILE_NAME: string =
  "1796800000000-FoldAiSwitchesIntoEnableAi.ts";

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

// Exactly what `npm run generate-postgres-migration` produced.
const DROP_AUTO_REMEDIATION: string = `ALTER TABLE "Project" DROP COLUMN "enableAutoRemediation"`;
const DROP_AI_COMMAND_EXECUTION: string = `ALTER TABLE "Project" DROP COLUMN "enableAiCommandExecution"`;
const ADD_AI_COMMAND_EXECUTION: string = `ALTER TABLE "Project" ADD "enableAiCommandExecution" boolean NOT NULL DEFAULT false`;
const ADD_AUTO_REMEDIATION: string = `ALTER TABLE "Project" ADD "enableAutoRemediation" boolean NOT NULL DEFAULT true`;

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: (statement: string): Promise<void> => {
      statements.push(statement);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;

  await new FoldAiSwitchesIntoEnableAi1796800000000()[direction](queryRunner);

  return statements;
};

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

type TimestampOfFunction = (className: string) => number | null;

const timestampOf: TimestampOfFunction = (className: string): number | null => {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
};

type UpdatesFunction = () => Promise<Array<string>>;

const updates: UpdatesFunction = async (): Promise<Array<string>> => {
  return (await recordQueries("up")).filter((statement: string): boolean => {
    return statement.startsWith("UPDATE ");
  });
};

type TableOfFunction = (statement: string) => string;

// The table an UPDATE writes: UPDATE "<table>" <alias> SET ...
const tableOf: TableOfFunction = (statement: string): string => {
  const match: RegExpMatchArray | null = statement.match(/^UPDATE "([^"]+)" /);
  expect(match).not.toBeNull();
  return match![1]!;
};

type SetClauseOfFunction = (statement: string) => string;

const setClauseOf: SetClauseOfFunction = (statement: string): string => {
  return statement.slice(
    statement.indexOf(" SET ") + 5,
    statement.indexOf(" FROM "),
  );
};

type WhereClauseOfFunction = (statement: string) => string;

const whereClauseOf: WhereClauseOfFunction = (statement: string): string => {
  return statement.slice(statement.indexOf(" WHERE ") + 7);
};

type TableNameOfModelFunction = (propertyTarget: unknown) => string | null;

// The Postgres table a model class maps to, from its @Entity.
const tableNameOfModel: TableNameOfModelFunction = (
  propertyTarget: unknown,
): string | null => {
  const table: TableMetadataArgs | undefined =
    getMetadataArgsStorage().tables.find(
      (candidate: TableMetadataArgs): boolean => {
        return candidate.target === propertyTarget;
      },
    );

  return table?.name || null;
};

describe("FoldAiSwitchesIntoEnableAi migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, MIGRATION_FILE_NAME),
      "utf8",
    );

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    // However prettier wraps it.
    expect(source).toMatch(
      new RegExp(`public name: string =\\s*"${OWN_CLASS_NAME}";`),
    );
    expect(new FoldAiSwitchesIntoEnableAi1796800000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered exactly once, last among the migrations registered before it", () => {
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

  test("runs after every migration that added a column it reads or writes", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    const earlier: Array<string> = [
      // Project.enableAutoRemediation
      "AddAutoRemediation1785763818197",
      // Project.enableAiCommandExecution, AutoRemediationRule.aiComposesCommands
      "AddAiCommandRemediation1785870000000",
      // KubernetesCluster.aiRemediationMode and aiAccessRunnerId
      "AddKubernetesClusterAiAccess1794400000000",
      // The last migration that read enableAiCommandExecution
      "AddKubernetesAiAgentAndAiDefaults1796100000000",
      // aiRemediationMode on every other resource table
      "AddResourceAiAgents1796300000000",
    ];

    expect(
      earlier.filter((name: string): boolean => {
        const index: number = registeredNames.indexOf(name);
        return index < 0 || index >= ownIndex;
      }),
    ).toEqual([]);
  });

  test("no other migration file drops either column - the wall-clock one typeorm generated was not left behind", () => {
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

        // up() only: the migrations that added the columns drop them in down().
        const upBody: string = source.slice(
          source.indexOf("public async up("),
          source.indexOf("public async down("),
        );

        return (
          upBody.includes(`DROP COLUMN "enableAutoRemediation"`) ||
          upBody.includes(`DROP COLUMN "enableAiCommandExecution"`)
        );
      });

    expect(droppers).toEqual([]);

    expect(
      fs
        .readdirSync(MIGRATIONS_DIRECTORY)
        .filter((fileName: string): boolean => {
          return fileName.endsWith("-FoldAiSwitchesIntoEnableAi.ts");
        }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });
});

describe("FoldAiSwitchesIntoEnableAi migration - up()", () => {
  test("ends with the two generated drops, in the generator's order", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements.slice(-2)).toEqual([
      DROP_AUTO_REMEDIATION,
      DROP_AI_COMMAND_EXECUTION,
    ]);
  });

  test("every other statement is a data update that runs before the drops it reads", async () => {
    const statements: Array<string> = await recordQueries("up");
    const firstDrop: number = statements.indexOf(DROP_AUTO_REMEDIATION);

    expect(firstDrop).toBe(statements.length - 2);

    for (const statement of statements.slice(0, firstDrop)) {
      expect(statement).toMatch(/^UPDATE "/);
    }

    // Twelve updates: one rule and nine resource tables for step 1, one rule and one cluster for step 2.
    expect(statements).toHaveLength(12 + 2);
  });

  test("never writes the Project table, and never drops or adds anything but the two columns", async () => {
    for (const statement of await recordQueries("up")) {
      if (statement.startsWith("UPDATE ")) {
        expect(tableOf(statement)).not.toBe("Project");
      } else {
        expect([DROP_AUTO_REMEDIATION, DROP_AI_COMMAND_EXECUTION]).toContain(
          statement,
        );
      }
    }
  });

  test("only ever moves a row from an unattended mode to asking first", async () => {
    for (const statement of await updates()) {
      const setClause: string = setClauseOf(statement);
      const whereClause: string = whereClauseOf(statement);

      if (tableOf(statement) === "AutoRemediationRule") {
        expect(setClause).toBe(
          `"executionMode" = '${AutoRemediationExecutionMode.Suggest}'`,
        );
        expect(whereClause).toContain(
          `r."executionMode" = '${AutoRemediationExecutionMode.FullAuto}'`,
        );
      } else {
        expect(setClause).toBe(
          `"aiRemediationMode" = '${KubernetesAiRemediationMode.RequireApproval}'`,
        );
        expect(whereClause).toMatch(
          /\."aiRemediationMode" IN \('Automatic','BypassApproval'\)/,
        );
      }

      // Nothing is switched off: no rule disabled, no mode set to Disabled.
      expect(setClause).not.toContain("isEnabled");
      expect(setClause).not.toContain("Disabled");
    }
  });

  test("the literals it writes and matches are the enums' own values", () => {
    expect(
      [...UNATTENDED_REMEDIATION_MODES].map((mode: string): string => {
        return `'${mode}'`;
      }),
    ).toEqual(["'Automatic'", "'BypassApproval'"]);
    expect(
      [...UNATTENDED_RESOURCE_REMEDIATION_MODES].map((mode: string): string => {
        return `'${mode}'`;
      }),
    ).toEqual(["'Automatic'", "'BypassApproval'"]);
    expect(String(ResourceAiRemediationMode.RequireApproval)).toBe(
      String(KubernetesAiRemediationMode.RequireApproval),
    );
    expect(String(AutoRemediationExecutionMode.Suggest)).toBe("Suggest");
    expect(String(AutoRemediationExecutionMode.FullAuto)).toBe("FullAuto");
  });

  describe("step 1: a project that had switched auto-remediation off", () => {
    test("its Full Auto rules - every kind, AI or not - go to Suggest", async () => {
      const ruleUpdates: Array<string> = (await updates()).filter(
        (statement: string): boolean => {
          return (
            tableOf(statement) === "AutoRemediationRule" &&
            statement.includes(`p."enableAutoRemediation" = false`)
          );
        },
      );

      expect(ruleUpdates).toEqual([
        `UPDATE "AutoRemediationRule" r SET "executionMode" = 'Suggest' FROM "Project" p WHERE r."projectId" = p."_id" AND p."enableAutoRemediation" = false AND r."executionMode" = 'FullAuto'`,
      ]);
    });

    test("every table with a Fixes mode - the cluster and each resource - asks first", async () => {
      const modeUpdates: Array<string> = (await updates()).filter(
        (statement: string): boolean => {
          return (
            tableOf(statement) !== "AutoRemediationRule" &&
            statement.includes(`p."enableAutoRemediation" = false`)
          );
        },
      );

      expect(modeUpdates.map(tableOf)).toEqual(TABLES_WITH_AI_REMEDIATION_MODE);

      for (const statement of modeUpdates) {
        expect(statement).toBe(
          `UPDATE "${tableOf(statement)}" t SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p WHERE t."projectId" = p."_id" AND p."enableAutoRemediation" = false AND t."aiRemediationMode" IN ('Automatic','BypassApproval')`,
        );
      }
    });

    test("the table list is exactly the models that declare a Fixes mode today", () => {
      const declaring: Array<string> = getMetadataArgsStorage()
        .columns.filter((column: ColumnMetadataArgs): boolean => {
          return (
            column.propertyName === "aiRemediationMode" &&
            (Entities as Array<unknown>).includes(column.target)
          );
        })
        .map((column: ColumnMetadataArgs): string => {
          return tableNameOfModel(column.target) || "";
        });

      expect([...declaring].sort()).toEqual(
        [...TABLES_WITH_AI_REMEDIATION_MODE].sort(),
      );
      expect(new Set(TABLES_WITH_AI_REMEDIATION_MODE).size).toBe(
        TABLES_WITH_AI_REMEDIATION_MODE.length,
      );
    });
  });

  describe("step 2: a project that never opted into AI command execution", () => {
    test("only its Full Auto rules that compose commands go to Suggest", async () => {
      const ruleUpdates: Array<string> = (await updates()).filter(
        (statement: string): boolean => {
          return (
            tableOf(statement) === "AutoRemediationRule" &&
            statement.includes(`"enableAiCommandExecution"`)
          );
        },
      );

      expect(ruleUpdates).toEqual([
        `UPDATE "AutoRemediationRule" r SET "executionMode" = 'Suggest' FROM "Project" p WHERE r."projectId" = p."_id" AND p."enableAiCommandExecution" IS NOT TRUE AND r."aiComposesCommands" = true AND r."executionMode" = 'FullAuto'`,
      ]);
    });

    test("only clusters reached through a Runner an operator bound ask first", async () => {
      const clusterUpdates: Array<string> = (await updates()).filter(
        (statement: string): boolean => {
          return (
            tableOf(statement) === "KubernetesCluster" &&
            statement.includes(`"enableAiCommandExecution"`)
          );
        },
      );

      expect(clusterUpdates).toEqual([
        `UPDATE "KubernetesCluster" c SET "aiRemediationMode" = 'RequireApproval' FROM "Project" p, "Runner" runner WHERE c."projectId" = p."_id" AND runner."_id" = c."aiAccessRunnerId" AND p."enableAiCommandExecution" IS NOT TRUE AND c."aiRemediationMode" IN ('Automatic','BypassApproval') AND NOT ${IS_KUBERNETES_AGENT_RUNNER_SQL}`,
      ]);
    });

    test("resources are left alone: their rounds never needed the opt-in", async () => {
      for (const statement of await updates()) {
        if (statement.includes(`"enableAiCommandExecution"`)) {
          expect(["AutoRemediationRule", "KubernetesCluster"]).toContain(
            tableOf(statement),
          );
        }
      }
    });

    test("the opt-in counts as off unless it was explicitly true (IS NOT TRUE, not = false)", async () => {
      for (const statement of await updates()) {
        if (statement.includes(`"enableAiCommandExecution"`)) {
          expect(statement).toContain(
            `p."enableAiCommandExecution" IS NOT TRUE`,
          );
        }
      }
    });
  });

  describe("the kubernetes-agent Runner predicate", () => {
    test("uses the same name prefix as the TypeScript marker", () => {
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toContain(
        `LIKE '${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/%'`,
      );
      expect(KUBERNETES_AGENT_RUNNER_NAME_PREFIX).toBe("kubernetes-agent");
      // Case-insensitive and blind to leading whitespace, like name.trim().toLowerCase().
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toContain(
        `lower(regexp_replace(COALESCE(runner."name", ''), '^\\s+', ''))`,
      );
    });

    test("reads the posture where the Runner stores it: hostInfo.kubernetes", () => {
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toContain(
        `runner."hostInfo" -> 'kubernetes' -> 'inCluster' = 'true'::jsonb`,
      );
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toContain(
        `runner."hostInfo" -> 'kubernetes' ->> 'clusterIdentifier'`,
      );
    });

    test("is one parenthesised expression that can never be NULL (a NULL under NOT would skip the row)", () => {
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL.startsWith("(")).toBe(true);
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL.endsWith(")")).toBe(true);
      // The posture half is wrapped in COALESCE(..., false); the name half COALESCEs its input.
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toContain(
        `COALESCE(runner."name", '')`,
      );
      expect(IS_KUBERNETES_AGENT_RUNNER_SQL).toMatch(/, false\)\)$/);

      let depth: number = 0;
      for (const character of IS_KUBERNETES_AGENT_RUNNER_SQL) {
        depth += character === "(" ? 1 : character === ")" ? -1 : 0;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    });
  });
});

describe("FoldAiSwitchesIntoEnableAi migration - down()", () => {
  test("puts both columns back as the generator wrote them, and does nothing else", async () => {
    expect(await recordQueries("down")).toEqual([
      ADD_AI_COMMAND_EXECUTION,
      ADD_AUTO_REMEDIATION,
    ]);
  });

  test("with the definitions the migrations that first added them used", () => {
    const addAutoRemediation: string = fs.readFileSync(
      path.join(MIGRATIONS_DIRECTORY, "1785763818197-AddAutoRemediation.ts"),
      "utf8",
    );
    const addAiCommandRemediation: string = fs.readFileSync(
      path.join(
        MIGRATIONS_DIRECTORY,
        "1785870000000-AddAiCommandRemediation.ts",
      ),
      "utf8",
    );

    expect(addAutoRemediation).toContain(ADD_AUTO_REMEDIATION);
    expect(addAiCommandRemediation).toContain(ADD_AI_COMMAND_EXECUTION);
  });

  test("does not revert the data steps: those rows now read as an operator's choice", async () => {
    for (const statement of await recordQueries("down")) {
      expect(statement).not.toMatch(/^UPDATE /);
    }
  });
});

describe("the Project model after the migration", () => {
  const project: Project = new Project();

  test.each(["enableAutoRemediation", "enableAiCommandExecution"])(
    "no longer declares %s - no column, no access control, no property",
    (column: string) => {
      expect(project.hasColumn(column)).toBe(false);
      expect(project.getColumnAccessControlFor(column)).toBeNull();
      expect(column in project).toBe(false);
      expect(
        getMetadataArgsStorage().columns.filter(
          (declared: ColumnMetadataArgs): boolean => {
            return (
              declared.target === Project && declared.propertyName === column
            );
          },
        ),
      ).toEqual([]);
    },
  );

  test("keeps Enable AI as a NOT NULL boolean that defaults on", () => {
    const declared: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (column: ColumnMetadataArgs): boolean => {
          return (
            column.target === Project && column.propertyName === "enableAi"
          );
        },
      );

    expect(declared?.options.type).toBe(ColumnType.Boolean);
    expect(declared?.options.nullable).toBe(false);
    expect(declared?.options.default).toBe(true);
    expect(project.getTableColumnMetadata("enableAi").defaultValue).toBe(true);
  });
});
