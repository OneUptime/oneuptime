import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  AddSecurityCasePrioritiesAndStatuses1807200000000,
  CASE_LIST_TABLE_IDS,
  FALLBACK_PRIORITY_FLAG,
  FALLBACK_STATUS_FLAG,
  LEGACY_PRIORITY_FLAGS,
  LEGACY_STATUS_FLAGS,
  LegacyValueIds,
  PRIORITY_FLAGS,
  SEEDED_PRIORITIES,
  SEEDED_STATUSES,
  STATUS_FLAGS,
  SeededValue,
  convertCaseListView,
  convertNotificationRule,
  convertPlaybookSteps,
  getBackfillSql,
  getSeedSql,
  quoteLiteral,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807200000000-AddSecurityCasePrioritiesAndStatuses";
import { AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807210000000-AddSecurityCasePriorityAndStatusIndexesAndKeys";
import {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
} from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SECURITY_CASE_STAGE_FLAGS } from "../../../../Types/SecurityCase/SecurityCaseStage";
import {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "../../../../Utils/SecurityCase/SecurityCasePriorities";
import {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "../../../../Utils/SecurityCase/SecurityCaseStatuses";
import { QueryRunner } from "typeorm";

/*
 * The two migrations that make a security case's priority and status the
 * project's own (Security Events > Settings): the tables, every project's
 * scale as it had it, every case's text turned into an id, then the text
 * columns dropped; and the references held in JSON - playbook steps, runs,
 * Slack and Teams rules, saved views - converted the same way. Pinned here
 * without a database: what each statement does and in what order, and that
 * each converter turns every old value into the id it names. They run on
 * real Postgres, on every old value, in
 * AddSecurityCasePrioritiesAndStatusesPostgres.test.ts.
 */

const MIGRATIONS_DIR: string = path.join(
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

const VALUES_NAME: string = "AddSecurityCasePrioritiesAndStatuses1807200000000";
const KEYS_NAME: string =
  "AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000";

const IDS: LegacyValueIds = {
  priorities: {
    Critical: "p-critical",
    High: "p-high",
    Medium: "p-medium",
    Low: "p-low",
    Informational: "p-informational",
  },
  statuses: {
    New: "s-new",
    Investigating: "s-investigating",
    Contained: "s-contained",
    Closed: "s-closed",
  },
};

type MigrationClass = { name: string };

const registeredNames: Array<string> = (
  Migrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

// What up() or down() runs, on a database that answers every read with nothing.
async function recordQueries(
  migration: { up: Function; down: Function },
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await (migration as unknown as Record<string, (q: QueryRunner) => Promise<void>>)[
    direction
  ]!(queryRunner);

  return statements;
}

function indexOfStatement(
  statements: Array<string>,
  part: string,
): number {
  const index: number = statements.findIndex((statement: string): boolean => {
    return statement.includes(part);
  });

  expect({ part, found: index >= 0 }).toEqual({ part, found: true });

  return index;
}

describe("registration", () => {
  test("both are registered once, the keys right after the values, after every migration before them", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === VALUES_NAME || name === KEYS_NAME;
      }),
    ).toEqual([VALUES_NAME, KEYS_NAME]);

    const valuesIndex: number = registeredNames.indexOf(VALUES_NAME);

    expect(registeredNames.indexOf(KEYS_NAME)).toBe(valuesIndex + 1);

    for (const name of registeredNames.slice(0, valuesIndex)) {
      const stamp: RegExpMatchArray | null = name.match(/(\d{13})$/);

      if (stamp) {
        expect([name, Number(stamp[1]) < 1807200000000]).toEqual([name, true]);
      }
    }
  });

  test("their names and files carry their timestamps", () => {
    expect(new AddSecurityCasePrioritiesAndStatuses1807200000000().name).toBe(
      VALUES_NAME,
    );
    expect(
      new AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000().name,
    ).toBe(KEYS_NAME);

    const files: Array<string> = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file: string): boolean => {
        return file.startsWith("18072");
      })
      .sort();

    expect(files).toEqual([
      "1807200000000-AddSecurityCasePrioritiesAndStatuses.ts",
      "1807210000000-AddSecurityCasePriorityAndStatusIndexesAndKeys.ts",
    ]);
  });

  test("the values in one transaction; the indexes and keys outside one, online", () => {
    expect(
      (
        new AddSecurityCasePrioritiesAndStatuses1807200000000() as unknown as {
          transaction?: boolean;
        }
      ).transaction,
    ).toBeUndefined();
    expect(
      new AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000()
        .transaction,
    ).toBe(false);
  });
});

describe("every project's scale, as it had it", () => {
  test("the seeded priorities are a new project's: names, descriptions, order, colours and flags", () => {
    expect(
      SEEDED_PRIORITIES.map((value: SeededValue) => {
        return [
          value.name,
          value.description,
          value.order,
          value.color,
          value.flag,
        ];
      }),
    ).toEqual(
      DEFAULT_SECURITY_CASE_PRIORITIES.map(
        (priority: DefaultSecurityCasePriority) => {
          return [
            priority.name,
            priority.description,
            priority.order,
            priority.color.toString().toLowerCase(),
            SECURITY_CASE_PRIORITY_LEVEL_FLAGS[priority.level],
          ];
        },
      ),
    );
  });

  test("the seeded statuses are a new project's: names, descriptions, order, colours and flags", () => {
    expect(
      SEEDED_STATUSES.map((value: SeededValue) => {
        return [
          value.name,
          value.description,
          value.order,
          value.color,
          value.flag,
        ];
      }),
    ).toEqual(
      DEFAULT_SECURITY_CASE_STATUSES.map(
        (status: DefaultSecurityCaseStatus) => {
          return [
            status.name,
            status.description,
            status.order,
            status.color.toString().toLowerCase(),
            SECURITY_CASE_STAGE_FLAGS[status.stage],
          ];
        },
      ),
    );
  });

  test("every old text becomes the value of its flag; anything else the old column's default", () => {
    expect(Object.keys(LEGACY_PRIORITY_FLAGS)).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);
    expect(Object.keys(LEGACY_STATUS_FLAGS)).toEqual([
      "New",
      "Investigating",
      "Contained",
      "Closed",
    ]);
    expect(PRIORITY_FLAGS).toEqual(
      Object.values(SECURITY_CASE_PRIORITY_LEVEL_FLAGS),
    );
    expect(STATUS_FLAGS).toEqual(Object.values(SECURITY_CASE_STAGE_FLAGS));
    // The old columns' defaults: Medium and New.
    expect(FALLBACK_PRIORITY_FLAG).toBe("isMediumPriority");
    expect(FALLBACK_STATUS_FLAG).toBe("isNewStatus");
  });

  test("seeds every project with each value, its slug made unique by the project's id", () => {
    const sql: string = getSeedSql({
      table: "SecurityCaseStatus",
      values: SEEDED_STATUSES,
      flags: STATUS_FLAGS,
    });

    expect(sql).toContain(`INSERT INTO "SecurityCaseStatus"`);
    expect(sql).toContain(`FROM "Project" AS p CROSS JOIN (VALUES`);
    expect(sql).toContain(`d."slug" || '-' || REPLACE(p."_id"::text, '-', '')`);
    // One row per value, each true for its own flag only.
    expect(sql).toContain(
      `('Investigating', 'investigating', 'Someone is working out what happened.', '#ffbf53', 2, false, true, false, false)`,
    );
    expect(sql).not.toContain(`"deletedAt" IS NULL`);
  });

  test("quotes a value's text as an SQL literal", () => {
    expect(quoteLiteral("It's")).toBe("'It''s'");
  });
});

describe("every case's priority and status, by id", () => {
  test("a backfill matches the text to the value carrying its flag, in the row's project", () => {
    const sql: string = getBackfillSql({
      table: "SecurityCase",
      fromColumn: "status",
      toColumn: "securityCaseStatusId",
      valueTable: "SecurityCaseStatus",
      legacy: LEGACY_STATUS_FLAGS,
      fallbackFlag: FALLBACK_STATUS_FLAG,
    });

    expect(sql).toBe(
      `UPDATE "SecurityCase" AS r SET "securityCaseStatusId" = v."_id" FROM "SecurityCaseStatus" AS v WHERE v."projectId" = r."projectId" AND (CASE r."status" WHEN 'New' THEN v."isNewStatus" WHEN 'Investigating' THEN v."isAcknowledgedStatus" WHEN 'Contained' THEN v."isContainedStatus" WHEN 'Closed' THEN v."isClosedStatus" ELSE v."isNewStatus" END)`,
    );
  });

  test("without a fallback, a text that names nothing is left empty", () => {
    expect(
      getBackfillSql({
        table: "SecurityCase",
        fromColumn: "notifiedPriority",
        toColumn: "notifiedSecurityCasePriorityId",
        valueTable: "SecurityCasePriority",
        legacy: LEGACY_PRIORITY_FLAGS,
      }),
    ).toContain(`ELSE false END`);
  });

  test("up() adds the columns nullable, fills them, then makes the case's two NOT NULL before the text goes", async () => {
    const statements: Array<string> = await recordQueries(
      new AddSecurityCasePrioritiesAndStatuses1807200000000(),
      "up",
    );

    const added: number = indexOfStatement(
      statements,
      `ALTER TABLE "SecurityCase" ADD "securityCaseStatusId" uuid`,
    );
    const filled: number = indexOfStatement(
      statements,
      `SET "securityCaseStatusId" = v."_id"`,
    );
    const required: number = indexOfStatement(
      statements,
      `ALTER COLUMN "securityCaseStatusId" SET NOT NULL`,
    );
    const dropped: number = indexOfStatement(
      statements,
      `ALTER TABLE "SecurityCase" DROP COLUMN "status"`,
    );
    const seeded: number = indexOfStatement(
      statements,
      `INSERT INTO "SecurityCaseStatus"`,
    );

    expect(seeded).toBeLessThan(added);
    expect(added).toBeLessThan(filled);
    expect(filled).toBeLessThan(required);
    expect(required).toBeLessThan(dropped);

    // The playbook's and the setting's minimums are filled before their text goes.
    expect(
      indexOfStatement(statements, `SET "minimumSecurityCasePriorityId" = v."_id" FROM "SecurityCasePriority" AS v WHERE v."projectId" = r."projectId" AND (CASE r."minimumPriority"`),
    ).toBeLessThan(
      indexOfStatement(
        statements,
        `ALTER TABLE "SecurityPlaybook" DROP COLUMN "minimumPriority"`,
      ),
    );
    expect(
      indexOfStatement(
        statements,
        `(CASE r."minimumSecurityCasePriority"`,
      ),
    ).toBeLessThan(
      indexOfStatement(
        statements,
        `ALTER TABLE "UserNotificationSetting" DROP COLUMN "minimumSecurityCasePriority"`,
      ),
    );

    // The JSON references are read after the values exist.
    expect(
      indexOfStatement(statements, `FROM "WorkspaceNotificationRule"`),
    ).toBeGreaterThan(seeded);
    expect(indexOfStatement(statements, `FROM "TableView"`)).toBeGreaterThan(
      seeded,
    );
  });

  test("up() builds no index or key on the tables cases are written to: the online migration does", async () => {
    const statements: Array<string> = await recordQueries(
      new AddSecurityCasePrioritiesAndStatuses1807200000000(),
      "up",
    );

    for (const statement of statements) {
      if (
        statement.startsWith("CREATE INDEX") ||
        statement.includes("ADD CONSTRAINT")
      ) {
        expect(statement).toMatch(
          /ON "SecurityCase(Priority|Status)"|ALTER TABLE "SecurityCase(Priority|Status)"/,
        );
      }
    }
  });

  test("the model declares the case's two id columns NOT NULL, as up() leaves them", () => {
    for (const column of ["securityCaseStatusId", "securityCasePriorityId"]) {
      const declared: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (candidate: ColumnMetadataArgs): boolean => {
            return (
              candidate.target === SecurityCase &&
              candidate.propertyName === column
            );
          },
        );

      expect([column, declared?.options.nullable]).toEqual([column, false]);
    }
  });

  test("down() gives every row the text of the built-in value it is at, then drops the tables last", async () => {
    const statements: Array<string> = await recordQueries(
      new AddSecurityCasePrioritiesAndStatuses1807200000000(),
      "down",
    );

    expect(
      indexOfStatement(
        statements,
        `SET "priority" = COALESCE((CASE WHEN v."isCriticalPriority" THEN 'Critical'`,
      ),
    ).toBeLessThan(
      indexOfStatement(
        statements,
        `ALTER TABLE "SecurityCase" DROP COLUMN "securityCasePriorityId"`,
      ),
    );
    expect(statements[statements.length - 1]).toBe(
      `DROP TABLE "SecurityCasePriority"`,
    );
  });
});

describe("the references held in JSON", () => {
  test("a playbook's steps name the priority and status by id, the verdict kept", () => {
    const result: { steps: unknown; changed: boolean } = convertPlaybookSteps(
      [
        { action: "Set Case Priority", config: { priority: "Critical" } },
        {
          action: "Set Case Status",
          config: { status: "Closed", verdict: "False Positive" },
        },
        { action: "Check Threat Intel", config: { raisePriorityTo: "High" } },
        { action: "Check Threat Intel", config: {} },
        { action: "Add Case Note", config: { note: "priority: Critical" } },
      ],
      IDS,
    );

    expect(result.changed).toBe(true);
    expect(result.steps).toEqual([
      { action: "Set Case Priority", config: { priorityId: "p-critical" } },
      {
        action: "Set Case Status",
        config: { statusId: "s-closed", verdict: "False Positive" },
      },
      {
        action: "Check Threat Intel",
        config: { raisePriorityToId: "p-high" },
      },
      { action: "Check Threat Intel", config: {} },
      { action: "Add Case Note", config: { note: "priority: Critical" } },
    ]);
  });

  test.each(Object.keys(LEGACY_PRIORITY_FLAGS))(
    "Set priority %s becomes that priority's id",
    (priority: string) => {
      expect(
        convertPlaybookSteps(
          [{ action: "Set Case Priority", config: { priority } }],
          IDS,
        ).steps,
      ).toEqual([
        {
          action: "Set Case Priority",
          config: { priorityId: IDS.priorities[priority] },
        },
      ]);
    },
  );

  test.each(Object.keys(LEGACY_STATUS_FLAGS))(
    "Set status %s becomes that status's id",
    (status: string) => {
      expect(
        convertPlaybookSteps(
          [{ action: "Set Case Status", config: { status } }],
          IDS,
        ).steps,
      ).toEqual([
        {
          action: "Set Case Status",
          config: { statusId: IDS.statuses[status] },
        },
      ]);
    },
  );

  test("a text that names none of them is dropped, as the step's own check would refuse it", () => {
    expect(
      convertPlaybookSteps(
        [{ action: "Set Case Priority", config: { priority: "Urgent" } }],
        IDS,
      ).steps,
    ).toEqual([{ action: "Set Case Priority", config: {} }]);
  });

  test("steps with nothing to convert are left as they are", () => {
    const steps: Array<unknown> = [
      { action: "Add Case Note", config: { note: "x" } },
    ];

    expect(convertPlaybookSteps(steps, IDS)).toEqual({
      steps,
      changed: false,
    });
    expect(convertPlaybookSteps("not a list", IDS)).toEqual({
      steps: "not a list",
      changed: false,
    });
  });

  test("a rule's priority and status conditions match by id, one value or a list", () => {
    expect(
      convertNotificationRule(
        {
          _type: "SecurityCaseNotificationRule",
          filters: [
            {
              checkOn: "Security Case Priority",
              conditionType: "Contains Any",
              value: ["Critical", "High", "Urgent"],
            },
            {
              checkOn: "Security Case Status",
              conditionType: "Not Contains",
              value: "Closed",
            },
            {
              checkOn: "Security Case Title",
              conditionType: "Contains",
              value: "Critical",
            },
          ],
        },
        IDS,
      ),
    ).toEqual({
      changed: true,
      rule: {
        _type: "SecurityCaseNotificationRule",
        filters: [
          {
            checkOn: "Security Case Priority",
            conditionType: "Contains Any",
            value: ["p-critical", "p-high"],
          },
          {
            checkOn: "Security Case Status",
            conditionType: "Not Contains",
            value: "s-closed",
          },
          {
            checkOn: "Security Case Title",
            conditionType: "Contains",
            value: "Critical",
          },
        ],
      },
    });
  });

  test("a rule with no priority or status condition is left as it is", () => {
    const rule: Record<string, unknown> = {
      filters: [{ checkOn: "Security Case Source", value: ["Manual"] }],
    };

    expect(convertNotificationRule(rule, IDS)).toEqual({
      rule,
      changed: false,
    });
  });

  test("a saved view filters by the id columns, and drops a sort on the old text", () => {
    expect(
      convertCaseListView(
        {
          query: {
            priority: { _type: "Includes", value: ["Critical", "High"] },
            status: "Closed",
            title: "brute force",
          },
          sort: { priority: "Descending", lastDetectedAt: "Descending" },
        },
        IDS,
      ),
    ).toEqual({
      changed: true,
      query: {
        securityCasePriorityId: {
          _type: "Includes",
          value: ["p-critical", "p-high"],
        },
        securityCaseStatusId: "s-closed",
        title: "brute force",
      },
      sort: { lastDetectedAt: "Descending" },
    });
  });

  test("a filter whose values name none of them is dropped: no case was ever at them", () => {
    expect(
      convertCaseListView(
        {
          query: { status: { _type: "Includes", value: ["Archived"] } },
          sort: null,
        },
        IDS,
      ).query,
    ).toEqual({});
  });

  test("the case lists' saved views are the case table's", () => {
    expect([...CASE_LIST_TABLE_IDS]).toEqual(["security-cases-table"]);
  });
});
