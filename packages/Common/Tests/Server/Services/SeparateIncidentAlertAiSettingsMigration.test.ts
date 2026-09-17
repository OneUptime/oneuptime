import { MigrationName1786101798351 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786101798351-MigrationName";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

type QueryRunnerCapture = {
  runner: QueryRunner;
  statements: Array<string>;
};

const makeQueryRunner: () => QueryRunnerCapture = (): QueryRunnerCapture => {
  const statements: Array<string> = [];

  return {
    runner: {
      query: (statement: string): Promise<undefined> => {
        statements.push(statement);
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner,
    statements,
  };
};

const NEW_COLUMNS: Array<string> = [
  "enableIncidentInstrumentationFixTasks",
  "enableAlertInstrumentationFixTasks",
  "enableAutomaticIncidentCodeFixes",
  "enableAutomaticAlertCodeFixes",
  "incidentAiDailyAutonomousTokenLimit",
  "alertAiDailyAutonomousTokenLimit",
  "incidentAiDailyFixTaskLimit",
  "alertAiDailyFixTaskLimit",
  "incidentAiMaxConcurrentInvestigations",
  "alertAiMaxConcurrentInvestigations",
];

describe("separate incident and alert AI settings migration", () => {
  test("adds all ten lane-specific columns before copying existing settings", async () => {
    const capture: QueryRunnerCapture = makeQueryRunner();

    await new MigrationName1786101798351().up(capture.runner);

    const updateIndex: number = capture.statements.findIndex(
      (statement: string): boolean => {
        return statement.startsWith('UPDATE "Project"');
      },
    );

    expect(updateIndex).toBe(NEW_COLUMNS.length);

    for (const column of NEW_COLUMNS) {
      const addIndex: number = capture.statements.findIndex(
        (statement: string): boolean => {
          return statement.includes(`ADD "${column}"`);
        },
      );

      expect(addIndex).toBeGreaterThanOrEqual(0);
      expect(addIndex).toBeLessThan(updateIndex);
    }
  });

  test("copies every legacy shared value into both lanes", async () => {
    const capture: QueryRunnerCapture = makeQueryRunner();

    await new MigrationName1786101798351().up(capture.runner);

    const update: string = capture.statements.find((statement: string) => {
      return statement.startsWith('UPDATE "Project"');
    })!;

    expect(update).toContain(
      '"enableIncidentInstrumentationFixTasks" = "enableInstrumentationFixTasks"',
    );
    expect(update).toContain(
      '"enableAlertInstrumentationFixTasks" = "enableInstrumentationFixTasks"',
    );
    expect(update).toContain(
      '"enableAutomaticIncidentCodeFixes" = "enableAutomaticCodeFixes"',
    );
    expect(update).toContain(
      '"enableAutomaticAlertCodeFixes" = "enableAutomaticCodeFixes"',
    );
    expect(update).toContain(
      '"incidentAiDailyAutonomousTokenLimit" = "aiDailyAutonomousTokenLimit"',
    );
    expect(update).toContain(
      '"alertAiDailyAutonomousTokenLimit" = "aiDailyAutonomousTokenLimit"',
    );
    expect(update).toContain(
      '"incidentAiDailyFixTaskLimit" = "aiDailyFixTaskLimit"',
    );
    expect(update).toContain(
      '"alertAiDailyFixTaskLimit" = "aiDailyFixTaskLimit"',
    );
    expect(update).toContain(
      '"incidentAiMaxConcurrentInvestigations" = "aiMaxConcurrentInvestigations"',
    );
    expect(update).toContain(
      '"alertAiMaxConcurrentInvestigations" = "aiMaxConcurrentInvestigations"',
    );
  });

  test("drops legacy toggles only after their values are copied", async () => {
    const capture: QueryRunnerCapture = makeQueryRunner();

    await new MigrationName1786101798351().up(capture.runner);

    const updateIndex: number = capture.statements.findIndex(
      (statement: string): boolean => {
        return statement.startsWith('UPDATE "Project"');
      },
    );

    for (const legacyToggle of [
      "enableInstrumentationFixTasks",
      "enableAutomaticCodeFixes",
    ]) {
      const dropIndex: number = capture.statements.findIndex(
        (statement: string): boolean => {
          return statement.includes(`DROP COLUMN "${legacyToggle}"`);
        },
      );

      expect(dropIndex).toBeGreaterThan(updateIndex);
    }

    expect(capture.statements.join("\n")).not.toMatch(
      /DROP COLUMN "ai(DailyAutonomousTokenLimit|DailyFixTaskLimit|MaxConcurrentInvestigations)"/,
    );
  });

  test("down migration conservatively merges either enabled lane", async () => {
    const capture: QueryRunnerCapture = makeQueryRunner();

    await new MigrationName1786101798351().down(capture.runner);

    const updateIndex: number = capture.statements.findIndex(
      (statement: string): boolean => {
        return statement.startsWith('UPDATE "Project"');
      },
    );
    const update: string = capture.statements[updateIndex]!;

    expect(update).toContain(
      '"enableInstrumentationFixTasks" = "enableIncidentInstrumentationFixTasks" OR "enableAlertInstrumentationFixTasks"',
    );
    expect(update).toContain(
      '"enableAutomaticCodeFixes" = "enableAutomaticIncidentCodeFixes" OR "enableAutomaticAlertCodeFixes"',
    );

    for (const legacyToggle of [
      "enableInstrumentationFixTasks",
      "enableAutomaticCodeFixes",
    ]) {
      const addIndex: number = capture.statements.findIndex(
        (statement: string): boolean => {
          return statement.includes(`ADD "${legacyToggle}"`);
        },
      );

      expect(addIndex).toBeGreaterThanOrEqual(0);
      expect(addIndex).toBeLessThan(updateIndex);
    }
  });

  test("down removes exactly the ten lane-specific columns", async () => {
    const capture: QueryRunnerCapture = makeQueryRunner();

    await new MigrationName1786101798351().down(capture.runner);

    const droppedColumns: Array<string> = capture.statements
      .map((statement: string): string | undefined => {
        return statement.match(/DROP COLUMN "([^"]+)"/)?.[1];
      })
      .filter((column: string | undefined): column is string => {
        return Boolean(column);
      })
      .sort();

    expect(droppedColumns).toEqual([...NEW_COLUMNS].sort());
  });

  test("is registered exactly once with its generated timestamp", () => {
    expect(MigrationName1786101798351.name).toBe("MigrationName1786101798351");
    expect(SchemaMigrations).toContain(MigrationName1786101798351);
    expect(
      SchemaMigrations.filter((migration: { name: string }): boolean => {
        return migration.name === "MigrationName1786101798351";
      }),
    ).toHaveLength(1);
  });
});
