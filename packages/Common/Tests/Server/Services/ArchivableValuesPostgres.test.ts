/* eslint-disable @typescript-eslint/no-explicit-any */
import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { AddArchiveToValues1805800000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1805800000000-AddArchiveToValues";
import { AddArchiveToValuesUserKeys1805810000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1805810000000-AddArchiveToValuesUserKeys";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import ArchivableValueGuard from "../../../Server/Utils/Database/ArchivableValueGuard";
import ArchivableValueUsage, {
  JSON_USAGE_COLUMNS,
  JsonUsageColumn,
  ValueReference,
} from "../../../Server/Utils/Database/ArchivableValueUsage";
import { ArchivedValueRow } from "../../../Server/Utils/Database/ArchivedValueCheck";
import logger from "../../../Server/Utils/Logger";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import ObjectID from "../../../Types/ObjectID";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "../../../Utils/ArchivableValues";
import {
  ARCHIVABLE_VALUES_CREATED_LATER,
  ArchivableValueCreatedLater,
} from "../../Helpers/ArchivableValuesCreatedLater";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Archiving the values records pick from (Common/Utils/ArchivableValues),
 * EXECUTED against Postgres - not string matched:
 *
 *   - the two migrations on tables that already hold values: every existing
 *     value comes out live (NOT NULL DEFAULT false) with no stamps, the
 *     keys from who archived a value to the user are added online, under
 *     TypeORM's names, cleared when the user goes, safe to run twice, and
 *     both migrations undo cleanly;
 *   - the reads the server makes of archived values (DatabaseService
 *     .findArchivedValues, ArchivableValueGuard.getLiveIds), through the
 *     real services;
 *   - an archive written through the real update path, stamped with who and
 *     when;
 *   - the usage counts the Archive and Delete dialogs show
 *     (ArchivableValueUsage): every reference the models declare is counted
 *     by SQL Postgres runs, narrowed to the project, past deleted records,
 *     with lists counted in their join tables and criteria in their JSON.
 *
 * Opt in with RUN_POSTGRES_ARCHIVABLE_VALUES_TESTS=true against a Postgres
 * migrated to the current head (the clones copy public.<table>) - the
 * Postgres Schema Drift workflow's database right after its drift check.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * ARCHIVABLE_VALUES_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * ARCHIVABLE_VALUES_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 * Every table and row lives in a unique schema that is dropped afterwards;
 * search_path holds only that schema, so a statement naming a table that
 * was not cloned fails loudly instead of touching real data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ARCHIVABLE_VALUES_TESTS"] === "true"
    ? describe
    : describe.skip;

const connect: (schema: string) => Promise<DataSource> = async (
  schema: string,
): Promise<DataSource> => {
  const database: DataSource = new DataSource({
    type: "postgres",
    host: process.env["ARCHIVABLE_VALUES_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["ARCHIVABLE_VALUES_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["ARCHIVABLE_VALUES_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
    entities: Entities,
    schema,
    synchronize: false,
    extra: { options: `-c search_path=${schema}` },
  });

  await database.initialize();
  await database.query(`CREATE SCHEMA "${schema}"`);

  return database;
};

// Clones public.<table> - columns, defaults, NOT NULLs and indexes, no keys.
const clone: (
  database: DataSource,
  schema: string,
  tables: Array<string>,
) => Promise<void> = async (
  database: DataSource,
  schema: string,
  tables: Array<string>,
): Promise<void> => {
  for (const table of tables) {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );

    // A fixture names only what the SQL under test reads.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT c.column_name FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
        AND c.column_name NOT IN (
          SELECT a.attname FROM pg_index i
          INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass AND i.indisprimary
        )
        AND c.column_name <> 'isArchived'`,
      [schema, table],
    );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }
  }
};

/*
 * The value tables the two archive migrations alter: every archivable value
 * but those created archivable later by their own migration
 * (Tests/Helpers/ArchivableValuesCreatedLater - the postmortem statuses, the
 * security case statuses and priorities). AddArchiveToValuesMigration.test.ts
 * holds that list to ARCHIVABLE_VALUE_TABLE_NAMES.
 */
const CREATED_ARCHIVABLE_LATER: Array<string> =
  ARCHIVABLE_VALUES_CREATED_LATER.map(
    (later: ArchivableValueCreatedLater): string => {
      return later.table;
    },
  );

const MIGRATED_VALUE_TABLE_NAMES: Array<string> =
  ARCHIVABLE_VALUE_TABLE_NAMES.filter((table: string): boolean => {
    return !CREATED_ARCHIVABLE_LATER.includes(table);
  });

const uniqueSchema: (prefix: string) => string = (prefix: string): string => {
  return `${prefix}_${ObjectID.generate().toString().replace(/-/g, "")}`;
};

describePostgres("the archive migrations on tables that hold values", () => {
  const schema: string = uniqueSchema("archive_values_migration");
  const projectId: string = ObjectID.generate().toString();
  const userId: string = ObjectID.generate().toString();
  const severityId: string = ObjectID.generate().toString();
  const labelId: string = ObjectID.generate().toString();
  let database: DataSource;
  let queryRunner: QueryRunner;

  const columnsOf: (table: string) => Promise<
    Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  > = async (
    table: string,
  ): Promise<
    Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>
  > => {
    return await database.query(
      `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
        AND column_name IN ('isArchived', 'archivedAt', 'archivedByUserId')
      ORDER BY column_name`,
      [schema, table],
    );
  };

  const keysOf: (
    table: string,
  ) => Promise<
    Array<{ conname: string; convalidated: boolean; confdeltype: string }>
  > = async (
    table: string,
  ): Promise<
    Array<{ conname: string; convalidated: boolean; confdeltype: string }>
  > => {
    return await database.query(
      `SELECT con.conname, con.convalidated, con.confdeltype FROM pg_constraint con
        WHERE con.conrelid = format('%I.%I', $1::text, $2::text)::regclass
          AND con.contype = 'f'`,
      [schema, table],
    );
  };

  beforeAll(async () => {
    database = await connect(schema);
    await clone(database, schema, [...MIGRATED_VALUE_TABLE_NAMES, "User"]);

    // The tables as they were before the migration: no archive columns.
    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" DROP COLUMN "archivedByUserId", DROP COLUMN "archivedAt", DROP COLUMN "isArchived"`,
      );
    }

    // Values a project already has.
    await database.query(
      `INSERT INTO "${schema}"."IncidentSeverity" ("_id", "projectId", "name") VALUES ($1, $2, 'Critical')`,
      [severityId, projectId],
    );
    await database.query(
      `INSERT INTO "${schema}"."Label" ("_id", "projectId", "name") VALUES ($1, $2, 'legacy-db')`,
      [labelId, projectId],
    );
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "email") VALUES ($1, 'ada@example.com')`,
      [userId],
    );

    queryRunner = database.createQueryRunner();
  });

  afterAll(async () => {
    await queryRunner?.release();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("up() adds the columns: every existing value is live, with no stamps", async () => {
    await new AddArchiveToValues1805800000000().up(queryRunner);

    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      expect(await columnsOf(table)).toEqual([
        { column_name: "archivedAt", is_nullable: "YES", column_default: null },
        {
          column_name: "archivedByUserId",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "isArchived",
          is_nullable: "NO",
          column_default: "false",
        },
      ]);
    }

    expect(
      await database.query(
        `SELECT "isArchived", "archivedAt", "archivedByUserId" FROM "${schema}"."IncidentSeverity"`,
      ),
    ).toEqual([
      { isArchived: false, archivedAt: null, archivedByUserId: null },
    ]);
    expect(
      await database.query(
        `SELECT "isArchived" FROM "${schema}"."Label" WHERE "_id" = $1`,
        [labelId],
      ),
    ).toEqual([{ isArchived: false }]);
  });

  test("the keys migration adds each key online, validated, under its name, cleared when the user goes", async () => {
    const keys: AddArchiveToValuesUserKeys1805810000000 =
      new AddArchiveToValuesUserKeys1805810000000();

    expect(keys.transaction).toBe(false);

    await keys.up(queryRunner);

    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      const found: Array<{
        conname: string;
        convalidated: boolean;
        confdeltype: string;
      }> = await keysOf(table);

      expect(found).toHaveLength(1);
      expect(found[0]!.conname).toMatch(/^FK_[0-9a-f]{27}$/);
      expect(found[0]!.convalidated).toBe(true);
      // ON DELETE SET NULL.
      expect(found[0]!.confdeltype).toBe("n");
    }

    // A value archived by somebody whose account goes keeps being archived.
    await database.query(
      `UPDATE "${schema}"."Label" SET "isArchived" = true, "archivedAt" = now(), "archivedByUserId" = $1 WHERE "_id" = $2`,
      [userId, labelId],
    );
    await database.query(`DELETE FROM "${schema}"."User" WHERE "_id" = $1`, [
      userId,
    ]);

    const [label]: Array<{
      isArchived: boolean;
      archivedByUserId: string | null;
    }> = await database.query(
      `SELECT "isArchived", "archivedByUserId" FROM "${schema}"."Label" WHERE "_id" = $1`,
      [labelId],
    );

    expect(label).toEqual({ isArchived: true, archivedByUserId: null });
  });

  test("the keys migration is safe to run again", async () => {
    await new AddArchiveToValuesUserKeys1805810000000().up(queryRunner);

    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      expect(await keysOf(table)).toHaveLength(1);
    }
  });

  test("down() undoes both", async () => {
    await new AddArchiveToValuesUserKeys1805810000000().down(queryRunner);

    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      expect(await keysOf(table)).toEqual([]);
    }

    await new AddArchiveToValues1805800000000().down(queryRunner);

    for (const table of MIGRATED_VALUE_TABLE_NAMES) {
      expect(await columnsOf(table)).toEqual([]);
    }

    // The values themselves are untouched.
    expect(
      await database.query(`SELECT "name" FROM "${schema}"."IncidentSeverity"`),
    ).toEqual([{ name: "Critical" }]);
  });
});

describePostgres(
  "archived values, read and written through the services",
  () => {
    const schema: string = uniqueSchema("archive_values_reads");
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    let database: DataSource;

    const insertValue: (
      table: string,
      values: {
        id: ObjectID;
        projectId: ObjectID;
        name: string;
        isArchived: boolean;
      },
    ) => Promise<void> = async (
      table: string,
      values: {
        id: ObjectID;
        projectId: ObjectID;
        name: string;
        isArchived: boolean;
      },
    ): Promise<void> => {
      await database.query(
        `INSERT INTO "${schema}"."${table}" ("_id", "projectId", "name", "isArchived", "slug", "createdAt", "updatedAt", "version")
      VALUES ($1, $2, $3, $4, $5, now(), now(), 1)`,
        [
          values.id.toString(),
          values.projectId.toString(),
          values.name,
          values.isArchived,
          values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        ],
      );
    };

    beforeAll(async () => {
      database = await connect(schema);
      await clone(database, schema, ["IncidentSeverity", "Label", "User"]);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockResolvedValue(undefined as never);

      for (const service of [LabelService, IncidentSeverityService]) {
        jest
          .spyOn(service as any, "onTriggerRealtime")
          .mockResolvedValue(undefined);
        jest
          .spyOn(service as any, "onTriggerWorkflow")
          .mockResolvedValue(undefined);
      }

      await database.query(
        `DELETE FROM "${schema}"."IncidentSeverity"; DELETE FROM "${schema}"."Label"`,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the archived values among some ids, with their names and projects, as the write check reads them", async () => {
      const live: ObjectID = ObjectID.generate();
      const archived: ObjectID = ObjectID.generate();
      const elsewhere: ObjectID = ObjectID.generate();

      await insertValue("Label", {
        id: live,
        projectId,
        name: "payments",
        isArchived: false,
      });
      await insertValue("Label", {
        id: archived,
        projectId,
        name: "legacy-db",
        isArchived: true,
      });
      await insertValue("Label", {
        id: elsewhere,
        projectId: otherProjectId,
        name: "old",
        isArchived: true,
      });

      const rows: Array<ArchivedValueRow> = await (
        DatabaseService as unknown as {
          findArchivedValues: (data: {
            modelType: { new (): DatabaseBaseModel };
            ids: Array<string>;
          }) => Promise<Array<ArchivedValueRow>>;
        }
      ).findArchivedValues({
        modelType: Label,
        ids: [live.toString(), archived.toString(), elsewhere.toString()],
      });

      expect(
        rows
          .map((row: ArchivedValueRow) => {
            return [row.id, row.name, row.projectId];
          })
          .sort(),
      ).toEqual(
        [
          [archived.toString(), "legacy-db", projectId.toString()],
          [elsewhere.toString(), "old", otherProjectId.toString()],
        ].sort(),
      );
    });

    test("the live severities of a project, as the archive guard reads them", async () => {
      const critical: ObjectID = ObjectID.generate();
      const retired: ObjectID = ObjectID.generate();

      await insertValue("IncidentSeverity", {
        id: critical,
        projectId,
        name: "Critical",
        isArchived: false,
      });
      await insertValue("IncidentSeverity", {
        id: retired,
        projectId,
        name: "Very critical",
        isArchived: true,
      });
      await insertValue("IncidentSeverity", {
        id: ObjectID.generate(),
        projectId: otherProjectId,
        name: "Elsewhere",
        isArchived: false,
      });

      expect(
        await ArchivableValueGuard.getLiveIds({
          service: IncidentSeverityService,
          projectId,
        }),
      ).toEqual([critical.toString()]);
    });

    test("an archive written through the update path is stamped with who and when, and unarchiving clears them", async () => {
      const label: ObjectID = ObjectID.generate();

      await insertValue("Label", {
        id: label,
        projectId,
        name: "legacy-db",
        isArchived: false,
      });

      // OneUptime acting for a person keeps the person it names.
      await LabelService.updateOneById({
        id: label,
        data: { isArchived: true },
        props: { isRoot: true, userId: userId },
      });

      const [archived]: Array<{
        isArchived: boolean;
        archivedAt: Date | null;
        archivedByUserId: string | null;
      }> = await database.query(
        `SELECT "isArchived", "archivedAt", "archivedByUserId" FROM "${schema}"."Label" WHERE "_id" = $1`,
        [label.toString()],
      );

      expect(archived!.isArchived).toBe(true);
      expect(archived!.archivedAt).toBeInstanceOf(Date);
      expect(archived!.archivedByUserId).toBe(userId.toString());

      await LabelService.updateOneById({
        id: label,
        data: { isArchived: false },
        props: { isRoot: true, userId: userId },
      });

      const [unarchived]: Array<{
        isArchived: boolean;
        archivedAt: Date | null;
        archivedByUserId: string | null;
      }> = await database.query(
        `SELECT "isArchived", "archivedAt", "archivedByUserId" FROM "${schema}"."Label" WHERE "_id" = $1`,
        [label.toString()],
      );

      expect(unarchived).toEqual({
        isArchived: false,
        archivedAt: null,
        archivedByUserId: null,
      });
    });
  },
);

describePostgres("what uses a value, counted by Postgres", () => {
  const schema: string = uniqueSchema("archive_values_usage");
  const projectId: string = ObjectID.generate().toString();
  const otherProjectId: string = ObjectID.generate().toString();
  const severityId: string = ObjectID.generate().toString();
  const labelId: string = ObjectID.generate().toString();
  let database: DataSource;

  // Every table the counts read, for every kind of value.
  const tablesCounted: () => Array<string> = (): Array<string> => {
    const tables: Set<string> = new Set<string>();

    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      for (const reference of ArchivableValueUsage.getReferences({
        dataSource: database,
        valueTable,
      })) {
        tables.add(reference.countTable);
      }
    }

    for (const jsonColumn of JSON_USAGE_COLUMNS as Array<JsonUsageColumn>) {
      tables.add(jsonColumn.tableName);
    }

    return Array.from(tables).sort();
  };

  beforeAll(async () => {
    database = await connect(schema);
    await clone(database, schema, tablesCounted());
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("every count statement runs, for every kind of value", async () => {
    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      const references: Array<ValueReference> =
        ArchivableValueUsage.getReferences({
          dataSource: database,
          valueTable,
        });

      expect(references.length).toBeGreaterThan(0);

      expect(
        await ArchivableValueUsage.countUses({
          dataSource: database,
          valueTable,
          valueId: ObjectID.generate(),
          projectId: new ObjectID(projectId),
        }),
      ).toEqual([]);
    }
  });

  test("an incident severity: the project's incidents that have it, deleted ones left out, and the criteria that name it", async () => {
    const incident: (values: {
      projectId: string;
      deletedAt?: Date | null;
    }) => Promise<void> = async (values: {
      projectId: string;
      deletedAt?: Date | null;
    }): Promise<void> => {
      await database.query(
        `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "incidentSeverityId", "deletedAt") VALUES ($1, $2, $3, $4)`,
        [
          ObjectID.generate().toString(),
          values.projectId,
          severityId,
          values.deletedAt || null,
        ],
      );
    };

    await incident({ projectId });
    await incident({ projectId });
    await incident({ projectId, deletedAt: new Date() });
    await incident({ projectId: otherProjectId });

    // A monitor whose criteria open incidents with it, and one that does not.
    await database.query(
      `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "monitorSteps") VALUES ($1, $2, $3), ($4, $2, $5)`,
      [
        ObjectID.generate().toString(),
        projectId,
        JSON.stringify({
          monitorStepsInstanceArray: [
            {
              incidents: [
                {
                  incidentSeverityId: { _type: "ObjectID", value: severityId },
                },
              ],
            },
          ],
        }),
        ObjectID.generate().toString(),
        JSON.stringify({ monitorStepsInstanceArray: [] }),
      ],
    );

    const usage: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: database,
        valueTable: "IncidentSeverity",
        valueId: new ObjectID(severityId),
        projectId: new ObjectID(projectId),
      });

    expect(usage).toEqual(
      expect.arrayContaining([
        // The project's two live incidents: not the deleted one, not another project's.
        expect.objectContaining({
          tableName: "Incident",
          count: 2,
          effect: ArchivableValueDeleteEffect.Refused,
          kind: ArchivableValueUsageKind.Records,
        }),
        // The one monitor whose criteria name it.
        expect.objectContaining({
          tableName: "Monitor",
          count: 1,
          effect: ArchivableValueDeleteEffect.LeftDangling,
          kind: ArchivableValueUsageKind.Settings,
        }),
      ]),
    );
    expect(usage).toHaveLength(2);
  });

  test("a label: the lists it is in, counted in their join tables", async () => {
    for (let index: number = 0; index < 3; index++) {
      await database.query(
        `INSERT INTO "${schema}"."MonitorLabel" ("monitorId", "labelId") VALUES ($1, $2)`,
        [ObjectID.generate().toString(), labelId],
      );
    }

    await database.query(
      `INSERT INTO "${schema}"."IncidentLabelRuleLabelToAdd" ("incidentLabelRuleId", "labelId") VALUES ($1, $2)`,
      [ObjectID.generate().toString(), labelId],
    );

    const usage: Array<ArchivableValueUsageItem> =
      await ArchivableValueUsage.countUses({
        dataSource: database,
        valueTable: "Label",
        valueId: new ObjectID(labelId),
        projectId: new ObjectID(projectId),
      });

    expect(usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: "Monitor",
          count: 3,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
          kind: ArchivableValueUsageKind.Records,
        }),
        expect.objectContaining({
          tableName: "IncidentLabelRule",
          count: 1,
          effect: ArchivableValueDeleteEffect.RemovedFromList,
          kind: ArchivableValueUsageKind.Settings,
        }),
      ]),
    );
  });

  test("the model behind every kind of value is the one the counts read", () => {
    expect(new IncidentSeverity().tableName).toBe("IncidentSeverity");
    expect(new Label().tableName).toBe("Label");
  });
});
