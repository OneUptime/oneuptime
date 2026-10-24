import {
  AddSecurityCasePrioritiesAndStatuses1807200000000,
  LEGACY_PRIORITY_FLAGS,
  LEGACY_STATUS_FLAGS,
  SEEDED_PRIORITIES,
  SEEDED_STATUSES,
  SeededValue,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807200000000-AddSecurityCasePrioritiesAndStatuses";
import { AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807210000000-AddSecurityCasePriorityAndStatusIndexesAndKeys";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * AddSecurityCasePrioritiesAndStatuses against a real Postgres, on every old
 * value: each project gets the scale it had, and every case, playbook, run,
 * setting, Slack or Teams rule and saved view that named a priority or a
 * status by its text names the project's own by id - then down() gives the
 * text back.
 *
 * Opt in with RUN_POSTGRES_SECURITY_CASE_VALUES_TESTS=true and the normal
 * database credentials; SECURITY_CASE_VALUES_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. The
 * tables are built in a uniquely named schema as they were before the
 * migration - only the columns it reads and writes, under the index names
 * it drops - so nothing outside the schema is read or written, and the
 * schema is dropped afterwards. The migrations name a few indexes as
 * "public"."..."; their statements are pointed at the schema instead.
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SECURITY_CASE_VALUES_TESTS"] === "true"
    ? describe
    : describe.skip;

const PRIORITIES: Array<string> = Object.keys(LEGACY_PRIORITY_FLAGS);
const STATUSES: Array<string> = Object.keys(LEGACY_STATUS_FLAGS);

interface CaseSeed {
  id: string;
  projectId: string;
  status: string;
  priority: string;
  notifiedPriority: string | null;
  aiSuggestedPriority: string | null;
}

interface ValueRow {
  _id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  order: number;
  isArchived: boolean;
  [flag: string]: unknown;
}

describePostgres(
  "AddSecurityCasePrioritiesAndStatuses against Postgres",
  () => {
    const schema: string = `security_case_values_test_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;
    let database: DataSource;

    const projects: Record<"first" | "second" | "deleted", string> = {
      first: ObjectID.generate().toString(),
      second: ObjectID.generate().toString(),
      deleted: ObjectID.generate().toString(),
    };

    const cases: Array<CaseSeed> = [];
    const playbookIds: Record<string, string> = {};
    const settingIds: Record<string, string> = {};
    const ids: {
      stepsPlaybook: string;
      run: string;
      rule: string;
      incidentRule: string;
      view: string;
      otherView: string;
    } = {
      stepsPlaybook: ObjectID.generate().toString(),
      run: ObjectID.generate().toString(),
      rule: ObjectID.generate().toString(),
      incidentRule: ObjectID.generate().toString(),
      view: ObjectID.generate().toString(),
      otherView: ObjectID.generate().toString(),
    };

    const OLD_STEPS: Array<Record<string, unknown>> = [
      {
        id: "a",
        action: "Set Case Priority",
        config: { priority: "Critical" },
      },
      {
        id: "b",
        action: "Set Case Status",
        config: { status: "Closed", verdict: "False Positive" },
      },
      {
        id: "c",
        action: "Set Case Status",
        config: { status: "Investigating" },
      },
      {
        id: "d",
        action: "Check Threat Intel",
        config: { raisePriorityTo: "High" },
      },
      { id: "e", action: "Add Case Note", config: { note: "Critical first." } },
    ];

    // A query runner whose statements name the schema where they name public.
    function inSchema(queryRunner: QueryRunner): QueryRunner {
      return new Proxy(queryRunner, {
        get: (target: QueryRunner, property: string | symbol): unknown => {
          if (property === "query") {
            return (statement: string, parameters?: Array<unknown>) => {
              return target.query(
                statement.split(`"public".`).join(`"${schema}".`),
                parameters,
              );
            };
          }

          const value: unknown = Reflect.get(target, property, target);

          return typeof value === "function"
            ? (value as (...args: Array<unknown>) => unknown).bind(target)
            : value;
        },
      });
    }

    async function run(
      step: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await step(inSchema(queryRunner));
      } finally {
        await queryRunner.release();
      }
    }

    async function rows<T>(
      sql: string,
      parameters: Array<unknown> = [],
    ): Promise<Array<T>> {
      return (await database.query(sql, parameters)) as Array<T>;
    }

    async function valuesOf(
      table: "SecurityCasePriority" | "SecurityCaseStatus",
      projectId: string,
    ): Promise<Array<ValueRow>> {
      return rows<ValueRow>(
        `SELECT * FROM "${schema}"."${table}" WHERE "projectId" = $1 ORDER BY "order"`,
        [projectId],
      );
    }

    // The id of a project's value carrying a flag.
    async function idOf(
      table: "SecurityCasePriority" | "SecurityCaseStatus",
      projectId: string,
      flag: string,
    ): Promise<string> {
      const found: Array<{ _id: string }> = await rows<{ _id: string }>(
        `SELECT "_id" FROM "${schema}"."${table}" WHERE "projectId" = $1 AND "${flag}" = true`,
        [projectId],
      );

      expect(found).toHaveLength(1);

      return found[0]!._id;
    }

    async function columnsOf(table: string): Promise<Array<string>> {
      return (
        await rows<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
          [schema, table],
        )
      ).map((row: { column_name: string }): string => {
        return row.column_name;
      });
    }

    function seedCase(seed: Omit<CaseSeed, "id">): void {
      cases.push({ id: ObjectID.generate().toString(), ...seed });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SECURITY_CASE_VALUES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SECURITY_CASE_VALUES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SECURITY_CASE_VALUES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // The tables as they were before the migration: the columns it reads and writes.
      for (const statement of [
        `CREATE TABLE "${schema}"."Project" ("_id" uuid PRIMARY KEY, "deletedAt" TIMESTAMP WITH TIME ZONE)`,
        `CREATE TABLE "${schema}"."User" ("_id" uuid PRIMARY KEY)`,
        `CREATE TABLE "${schema}"."SecurityCase" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL REFERENCES "${schema}"."Project"("_id") ON DELETE CASCADE, "status" character varying(100) NOT NULL DEFAULT 'New', "priority" character varying(100) NOT NULL DEFAULT 'Medium', "notifiedPriority" character varying(100), "aiSuggestedPriority" character varying(100))`,
        `CREATE INDEX "IDX_b845ed92cfae3be744524365ad" ON "${schema}"."SecurityCase" ("status")`,
        `CREATE INDEX "IDX_d861cfa4e61db2db02aeaf7908" ON "${schema}"."SecurityCase" ("priority")`,
        `CREATE INDEX "IDX_18bfa595b4bb4f4c15745b0f07" ON "${schema}"."SecurityCase" ("projectId", "status")`,
        `CREATE TABLE "${schema}"."SecurityPlaybook" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "minimumPriority" character varying(100), "steps" jsonb)`,
        `CREATE TABLE "${schema}"."SecurityPlaybookRun" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "steps" jsonb)`,
        `CREATE TABLE "${schema}"."UserNotificationSetting" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "minimumSecurityCasePriority" character varying(100))`,
        `CREATE TABLE "${schema}"."WorkspaceNotificationRule" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "eventType" character varying NOT NULL, "notificationRule" jsonb NOT NULL)`,
        `CREATE TABLE "${schema}"."TableView" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "tableId" character varying NOT NULL, "query" jsonb NOT NULL, "sort" jsonb NOT NULL)`,
      ]) {
        await database.query(statement);
      }

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "deletedAt") VALUES ($1, NULL), ($2, NULL), ($3, now())`,
        [projects.first, projects.second, projects.deleted],
      );

      // Every status at every priority, each told about and suggested at each priority.
      for (const status of STATUSES) {
        for (const priority of PRIORITIES) {
          seedCase({
            projectId: projects.first,
            status,
            priority,
            notifiedPriority: priority,
            aiSuggestedPriority: priority,
          });
        }
      }

      // Text that names none of them, and none at all.
      seedCase({
        projectId: projects.first,
        status: "Resolved",
        priority: "Urgent",
        notifiedPriority: "Urgent",
        aiSuggestedPriority: null,
      });
      seedCase({
        projectId: projects.first,
        status: "New",
        priority: "Medium",
        notifiedPriority: null,
        aiSuggestedPriority: null,
      });
      // Another project's cases, and a deleted project's: each its own values.
      seedCase({
        projectId: projects.second,
        status: "Contained",
        priority: "High",
        notifiedPriority: "Medium",
        aiSuggestedPriority: "Low",
      });
      seedCase({
        projectId: projects.deleted,
        status: "Closed",
        priority: "Informational",
        notifiedPriority: null,
        aiSuggestedPriority: null,
      });

      for (const seed of cases) {
        await database.query(
          `INSERT INTO "${schema}"."SecurityCase" ("_id", "projectId", "status", "priority", "notifiedPriority", "aiSuggestedPriority") VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            seed.id,
            seed.projectId,
            seed.status,
            seed.priority,
            seed.notifiedPriority,
            seed.aiSuggestedPriority,
          ],
        );
      }

      for (const minimum of [...PRIORITIES, "none", "Urgent"]) {
        playbookIds[minimum] = ObjectID.generate().toString();
        await database.query(
          `INSERT INTO "${schema}"."SecurityPlaybook" ("_id", "projectId", "minimumPriority", "steps") VALUES ($1, $2, $3, '[]'::jsonb)`,
          [
            playbookIds[minimum],
            projects.first,
            minimum === "none" ? null : minimum,
          ],
        );

        settingIds[minimum] = ObjectID.generate().toString();
        await database.query(
          `INSERT INTO "${schema}"."UserNotificationSetting" ("_id", "projectId", "minimumSecurityCasePriority") VALUES ($1, $2, $3)`,
          [
            settingIds[minimum],
            projects.first,
            minimum === "none" ? null : minimum,
          ],
        );
      }

      await database.query(
        `INSERT INTO "${schema}"."SecurityPlaybook" ("_id", "projectId", "minimumPriority", "steps") VALUES ($1, $2, NULL, $3::jsonb)`,
        [ids.stepsPlaybook, projects.second, JSON.stringify(OLD_STEPS)],
      );
      await database.query(
        `INSERT INTO "${schema}"."SecurityPlaybookRun" ("_id", "projectId", "steps") VALUES ($1, $2, $3::jsonb)`,
        [ids.run, projects.second, JSON.stringify(OLD_STEPS)],
      );

      const filters: Array<Record<string, unknown>> = [
        {
          checkOn: "Security Case Priority",
          conditionType: "Contains Any",
          value: ["Critical", "High"],
        },
        {
          checkOn: "Security Case Status",
          conditionType: "Not Contains",
          value: ["Closed"],
        },
      ];

      await database.query(
        `INSERT INTO "${schema}"."WorkspaceNotificationRule" ("_id", "projectId", "eventType", "notificationRule") VALUES ($1, $2, 'Security Case', $3::jsonb), ($4, $2, 'Incident', $3::jsonb)`,
        [
          ids.rule,
          projects.first,
          JSON.stringify({ _type: "SecurityCaseNotificationRule", filters }),
          ids.incidentRule,
        ],
      );

      const query: Record<string, unknown> = {
        priority: { _type: "Includes", value: ["Critical", "Low"] },
        status: "Investigating",
      };
      const sort: Record<string, unknown> = {
        priority: "Ascending",
        lastDetectedAt: "Descending",
      };

      await database.query(
        `INSERT INTO "${schema}"."TableView" ("_id", "projectId", "tableId", "query", "sort") VALUES ($1, $2, 'security-cases-table', $3::jsonb, $4::jsonb), ($5, $2, 'incidents-table', $3::jsonb, $4::jsonb)`,
        [
          ids.view,
          projects.first,
          JSON.stringify(query),
          JSON.stringify(sort),
          ids.otherView,
        ],
      );

      await run(async (queryRunner: QueryRunner) => {
        await queryRunner.startTransaction();
        await new AddSecurityCasePrioritiesAndStatuses1807200000000().up(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      });

      await run(async (queryRunner: QueryRunner) => {
        await new AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000().up(
          queryRunner,
        );
      });
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test.each(["first", "second", "deleted"] as const)(
      "the %s project has its five priorities and four statuses, as cases always had them",
      async (which: "first" | "second" | "deleted") => {
        const projectId: string = projects[which];

        for (const [table, seeded] of [
          ["SecurityCasePriority", SEEDED_PRIORITIES],
          ["SecurityCaseStatus", SEEDED_STATUSES],
        ] as Array<
          [
            "SecurityCasePriority" | "SecurityCaseStatus",
            ReadonlyArray<SeededValue>,
          ]
        >) {
          const values: Array<ValueRow> = await valuesOf(table, projectId);

          expect(
            values.map((value: ValueRow) => {
              return [
                value.name,
                value.description,
                value.color,
                value.order,
                value.isArchived,
                seeded.filter((other: SeededValue): boolean => {
                  return value[other.flag] === true;
                }).length,
              ];
            }),
          ).toEqual(
            seeded.map((value: SeededValue) => {
              return [
                value.name,
                value.description,
                value.color,
                value.order,
                false,
                1,
              ];
            }),
          );

          for (const [index, value] of values.entries()) {
            expect(value[seeded[index]!.flag]).toBe(true);
            expect(value.slug).toBe(
              `${seeded[index]!.slug}-${projectId.split("-").join("")}`,
            );
          }
        }
      },
    );

    test("every case points at its project's status and priority its text named", async () => {
      const after: Array<{
        _id: string;
        projectId: string;
        securityCaseStatusId: string;
        securityCasePriorityId: string;
        notifiedSecurityCasePriorityId: string | null;
        aiSuggestedSecurityCasePriorityId: string | null;
      }> = await rows(`SELECT * FROM "${schema}"."SecurityCase"`);

      expect(after).toHaveLength(cases.length);

      for (const seed of cases) {
        const row: (typeof after)[number] = after.find(
          (candidate: (typeof after)[number]): boolean => {
            return candidate._id === seed.id;
          },
        )!;

        const statusFlag: string =
          LEGACY_STATUS_FLAGS[seed.status] || "isNewStatus";
        const priorityFlag: string =
          LEGACY_PRIORITY_FLAGS[seed.priority] || "isMediumPriority";

        expect([seed.status, row.securityCaseStatusId]).toEqual([
          seed.status,
          await idOf("SecurityCaseStatus", seed.projectId, statusFlag),
        ]);
        expect([seed.priority, row.securityCasePriorityId]).toEqual([
          seed.priority,
          await idOf("SecurityCasePriority", seed.projectId, priorityFlag),
        ]);

        // Told about and suggested at: a priority, or nothing for a text that named none.
        for (const [text, id] of [
          [seed.notifiedPriority, row.notifiedSecurityCasePriorityId],
          [seed.aiSuggestedPriority, row.aiSuggestedSecurityCasePriorityId],
        ] as Array<[string | null, string | null]>) {
          expect([text, id]).toEqual([
            text,
            text && LEGACY_PRIORITY_FLAGS[text]
              ? await idOf(
                  "SecurityCasePriority",
                  seed.projectId,
                  LEGACY_PRIORITY_FLAGS[text]!,
                )
              : null,
          ]);
        }
      }
    });

    test("the text columns are gone, the id columns required, and the old indexes dropped", async () => {
      const columns: Array<string> = await columnsOf("SecurityCase");

      for (const gone of [
        "status",
        "priority",
        "notifiedPriority",
        "aiSuggestedPriority",
      ]) {
        expect(columns).not.toContain(gone);
      }

      const required: Array<{ column_name: string; is_nullable: string }> =
        await rows(
          `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'SecurityCase' AND column_name IN ('securityCaseStatusId', 'securityCasePriorityId', 'notifiedSecurityCasePriorityId', 'aiSuggestedSecurityCasePriorityId') ORDER BY column_name`,
          [schema],
        );

      expect(required).toEqual([
        {
          column_name: "aiSuggestedSecurityCasePriorityId",
          is_nullable: "YES",
        },
        { column_name: "notifiedSecurityCasePriorityId", is_nullable: "YES" },
        { column_name: "securityCasePriorityId", is_nullable: "NO" },
        { column_name: "securityCaseStatusId", is_nullable: "NO" },
      ]);

      const indexes: Array<{ indexname: string }> = await rows(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'SecurityCase'`,
        [schema],
      );
      const names: Array<string> = indexes.map(
        (index: { indexname: string }) => {
          return index.indexname;
        },
      );

      expect(names).not.toContain("IDX_b845ed92cfae3be744524365ad");
      expect(names).not.toContain("IDX_d861cfa4e61db2db02aeaf7908");
      expect(names).not.toContain("IDX_18bfa595b4bb4f4c15745b0f07");
      // Built online, valid.
      expect(names).toEqual(
        expect.arrayContaining([
          "IDX_f2af4ab7b126b96515175e07ee",
          "IDX_32920766651c575ace350e8fc3",
          "IDX_3c5930a265457719de7441c839",
        ]),
      );
    });

    test("the keys are added and validated: a case can't point at a status nobody has", async () => {
      const keys: Array<{ conname: string; convalidated: boolean }> =
        await rows(
          `SELECT con.conname, con.convalidated FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = $1 AND con.contype = 'f' AND con.conname IN ('FK_f2af4ab7b126b96515175e07eec', 'FK_32920766651c575ace350e8fc3e', 'FK_38871ef4c6f43f8daef0c886d9d', 'FK_076708cc1ac24b0fa5f5cc184fe') ORDER BY con.conname`,
          [schema],
        );

      expect(keys).toEqual([
        { conname: "FK_076708cc1ac24b0fa5f5cc184fe", convalidated: true },
        { conname: "FK_32920766651c575ace350e8fc3e", convalidated: true },
        { conname: "FK_38871ef4c6f43f8daef0c886d9d", convalidated: true },
        { conname: "FK_f2af4ab7b126b96515175e07eec", convalidated: true },
      ]);

      await expect(
        database.query(
          `UPDATE "${schema}"."SecurityCase" SET "securityCaseStatusId" = $1 WHERE "_id" = $2`,
          [ObjectID.generate().toString(), cases[0]!.id],
        ),
      ).rejects.toThrow(/foreign key/);
    });

    test("each playbook's minimum and each person's notification minimum is the priority it named, or none", async () => {
      for (const minimum of [...PRIORITIES, "none", "Urgent"]) {
        const expected: string | null = LEGACY_PRIORITY_FLAGS[minimum]
          ? await idOf(
              "SecurityCasePriority",
              projects.first,
              LEGACY_PRIORITY_FLAGS[minimum]!,
            )
          : null;

        const playbook: Array<{
          minimumSecurityCasePriorityId: string | null;
        }> = await rows(
          `SELECT "minimumSecurityCasePriorityId" FROM "${schema}"."SecurityPlaybook" WHERE "_id" = $1`,
          [playbookIds[minimum]],
        );
        const setting: Array<{ minimumSecurityCasePriorityId: string | null }> =
          await rows(
            `SELECT "minimumSecurityCasePriorityId" FROM "${schema}"."UserNotificationSetting" WHERE "_id" = $1`,
            [settingIds[minimum]],
          );

        expect([minimum, playbook[0]!.minimumSecurityCasePriorityId]).toEqual([
          minimum,
          expected,
        ]);
        expect([minimum, setting[0]!.minimumSecurityCasePriorityId]).toEqual([
          minimum,
          expected,
        ]);
      }

      expect(await columnsOf("SecurityPlaybook")).not.toContain(
        "minimumPriority",
      );
      expect(await columnsOf("UserNotificationSetting")).not.toContain(
        "minimumSecurityCasePriority",
      );
    });

    test("a playbook's steps, and a run's copy of them, name the project's values by id", async () => {
      const expected: Array<Record<string, unknown>> = [
        {
          id: "a",
          action: "Set Case Priority",
          config: {
            priorityId: await idOf(
              "SecurityCasePriority",
              projects.second,
              "isCriticalPriority",
            ),
          },
        },
        {
          id: "b",
          action: "Set Case Status",
          config: {
            statusId: await idOf(
              "SecurityCaseStatus",
              projects.second,
              "isClosedStatus",
            ),
            verdict: "False Positive",
          },
        },
        {
          id: "c",
          action: "Set Case Status",
          config: {
            statusId: await idOf(
              "SecurityCaseStatus",
              projects.second,
              "isAcknowledgedStatus",
            ),
          },
        },
        {
          id: "d",
          action: "Check Threat Intel",
          config: {
            raisePriorityToId: await idOf(
              "SecurityCasePriority",
              projects.second,
              "isHighPriority",
            ),
          },
        },
        {
          id: "e",
          action: "Add Case Note",
          config: { note: "Critical first." },
        },
      ];

      for (const table of ["SecurityPlaybook", "SecurityPlaybookRun"]) {
        const found: Array<{ steps: unknown }> = await rows(
          `SELECT "steps" FROM "${schema}"."${table}" WHERE "_id" = ANY($1)`,
          [[ids.stepsPlaybook, ids.run]],
        );

        expect(found).toHaveLength(1);
        expect([table, found[0]!.steps]).toEqual([table, expected]);
      }
    });

    test("a Security Case rule's conditions match by id; an incident rule is left as it was", async () => {
      const found: Array<{ _id: string; notificationRule: unknown }> =
        await rows(
          `SELECT "_id", "notificationRule" FROM "${schema}"."WorkspaceNotificationRule"`,
        );
      const rule: unknown = found.find((row: { _id: string }): boolean => {
        return row._id === ids.rule;
      })!.notificationRule;
      const incidentRule: unknown = found.find(
        (row: { _id: string }): boolean => {
          return row._id === ids.incidentRule;
        },
      )!.notificationRule;

      expect(rule).toEqual({
        _type: "SecurityCaseNotificationRule",
        filters: [
          {
            checkOn: "Security Case Priority",
            conditionType: "Contains Any",
            value: [
              await idOf(
                "SecurityCasePriority",
                projects.first,
                "isCriticalPriority",
              ),
              await idOf(
                "SecurityCasePriority",
                projects.first,
                "isHighPriority",
              ),
            ],
          },
          {
            checkOn: "Security Case Status",
            conditionType: "Not Contains",
            value: [
              await idOf(
                "SecurityCaseStatus",
                projects.first,
                "isClosedStatus",
              ),
            ],
          },
        ],
      });
      expect(
        (incidentRule as { filters: Array<{ value: unknown }> }).filters[0]!
          .value,
      ).toEqual(["Critical", "High"]);
    });

    test("a saved view of the case lists filters by id and loses the sort on the old text; another list's view is left", async () => {
      const found: Array<{ _id: string; query: unknown; sort: unknown }> =
        await rows(
          `SELECT "_id", "query", "sort" FROM "${schema}"."TableView"`,
        );
      const view: { query: unknown; sort: unknown } = found.find(
        (row: { _id: string }): boolean => {
          return row._id === ids.view;
        },
      )!;
      const other: { query: unknown; sort: unknown } = found.find(
        (row: { _id: string }): boolean => {
          return row._id === ids.otherView;
        },
      )!;

      expect(view.query).toEqual({
        securityCasePriorityId: {
          _type: "Includes",
          value: [
            await idOf(
              "SecurityCasePriority",
              projects.first,
              "isCriticalPriority",
            ),
            await idOf("SecurityCasePriority", projects.first, "isLowPriority"),
          ],
        },
        securityCaseStatusId: await idOf(
          "SecurityCaseStatus",
          projects.first,
          "isAcknowledgedStatus",
        ),
      });
      expect(view.sort).toEqual({ lastDetectedAt: "Descending" });
      expect(other.query).toEqual({
        priority: { _type: "Includes", value: ["Critical", "Low"] },
        status: "Investigating",
      });
    });

    test("down() gives every case, playbook and setting its text back", async () => {
      // The online migration's keys and indexes go first, as its own down() would.
      for (const statement of [
        `ALTER TABLE "${schema}"."UserNotificationSetting" DROP CONSTRAINT "FK_076708cc1ac24b0fa5f5cc184fe"`,
        `ALTER TABLE "${schema}"."SecurityPlaybook" DROP CONSTRAINT "FK_38871ef4c6f43f8daef0c886d9d"`,
        `ALTER TABLE "${schema}"."SecurityCase" DROP CONSTRAINT "FK_32920766651c575ace350e8fc3e"`,
        `ALTER TABLE "${schema}"."SecurityCase" DROP CONSTRAINT "FK_f2af4ab7b126b96515175e07eec"`,
        `DROP INDEX "${schema}"."IDX_3c5930a265457719de7441c839"`,
        `DROP INDEX "${schema}"."IDX_32920766651c575ace350e8fc3"`,
        `DROP INDEX "${schema}"."IDX_f2af4ab7b126b96515175e07ee"`,
      ]) {
        await database.query(statement);
      }

      await run(async (queryRunner: QueryRunner) => {
        await queryRunner.startTransaction();
        await new AddSecurityCasePrioritiesAndStatuses1807200000000().down(
          queryRunner,
        );
        await queryRunner.commitTransaction();
      });

      const after: Array<{
        _id: string;
        status: string;
        priority: string;
        notifiedPriority: string | null;
        aiSuggestedPriority: string | null;
      }> = await rows(
        `SELECT "_id", "status", "priority", "notifiedPriority", "aiSuggestedPriority" FROM "${schema}"."SecurityCase"`,
      );

      for (const seed of cases) {
        const row: (typeof after)[number] = after.find(
          (candidate: (typeof after)[number]): boolean => {
            return candidate._id === seed.id;
          },
        )!;

        expect(row).toEqual({
          _id: seed.id,
          // What named nothing came back as the old defaults.
          status: LEGACY_STATUS_FLAGS[seed.status] ? seed.status : "New",
          priority: LEGACY_PRIORITY_FLAGS[seed.priority]
            ? seed.priority
            : "Medium",
          notifiedPriority:
            seed.notifiedPriority &&
            LEGACY_PRIORITY_FLAGS[seed.notifiedPriority]
              ? seed.notifiedPriority
              : null,
          aiSuggestedPriority:
            seed.aiSuggestedPriority &&
            LEGACY_PRIORITY_FLAGS[seed.aiSuggestedPriority]
              ? seed.aiSuggestedPriority
              : null,
        });
      }

      const playbooks: Array<{ _id: string; minimumPriority: string | null }> =
        await rows(
          `SELECT "_id", "minimumPriority" FROM "${schema}"."SecurityPlaybook"`,
        );

      for (const minimum of [...PRIORITIES, "none", "Urgent"]) {
        expect([
          minimum,
          playbooks.find((row: { _id: string }): boolean => {
            return row._id === playbookIds[minimum];
          })!.minimumPriority,
        ]).toEqual([minimum, LEGACY_PRIORITY_FLAGS[minimum] ? minimum : null]);
      }

      for (const table of ["SecurityCasePriority", "SecurityCaseStatus"]) {
        expect(
          await rows(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
            [schema, table],
          ),
        ).toEqual([]);
      }
    });
  },
);
