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
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import logger from "../../../Server/Utils/Logger";
import {
  ArchivableValueDeleteEffect,
  ArchivableValueUsageItem,
  ArchivableValueUsageKind,
  ArchivableValuesUsage,
  ArchivableValuesUsagePurpose,
} from "../../../Types/ArchivableValue/ArchivableValueUsage";
import Exception from "../../../Types/Exception/Exception";
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
 *     with lists read through the records that own them and criteria in
 *     their JSON - and people's own on-call rules counted by person, members
 *     of the project only (the maintainer's "Notification Rules (22)" for a
 *     project with two rules), each record or person once across the ways a
 *     table reaches the value and the values asked about;
 *   - the refusal of a delete a real foreign key raises, said as "archive it
 *     instead" for the value's own delete only.
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

  /*
   * Every table the counts read, for every kind of value: the tables the
   * value's id is read from, the records that own a list's rows, and the
   * memberships people's own settings are narrowed by.
   */
  const tablesCounted: () => Array<string> = (): Array<string> => {
    const tables: Set<string> = new Set<string>(["TeamMember"]);

    for (const valueTable of ARCHIVABLE_VALUE_TABLE_NAMES) {
      for (const reference of ArchivableValueUsage.getReferences({
        dataSource: database,
        valueTable,
      })) {
        tables.add(reference.countTable);
        tables.add(reference.recordTable);
      }
    }

    for (const jsonColumn of JSON_USAGE_COLUMNS as Array<JsonUsageColumn>) {
      tables.add(jsonColumn.tableName);
    }

    return Array.from(tables).sort();
  };

  const countUses: (data: {
    valueTable: string;
    valueIds: Array<string>;
    projectId?: string | undefined;
  }) => Promise<Array<ArchivableValueUsageItem>> = async (data: {
    valueTable: string;
    valueIds: Array<string>;
    projectId?: string | undefined;
  }): Promise<Array<ArchivableValueUsageItem>> => {
    return await ArchivableValueUsage.countUses({
      dataSource: database,
      valueTable: data.valueTable,
      valueIds: data.valueIds,
      projectId: new ObjectID(data.projectId || projectId),
    });
  };

  const insert: (
    table: string,
    row: Record<string, unknown>,
  ) => Promise<void> = async (
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> => {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
  };

  const member: (data: {
    userId: string;
    projectId?: string | undefined;
    hasAcceptedInvitation?: boolean | undefined;
  }) => Promise<void> = async (data: {
    userId: string;
    projectId?: string | undefined;
    hasAcceptedInvitation?: boolean | undefined;
  }): Promise<void> => {
    await insert("TeamMember", {
      _id: ObjectID.generate().toString(),
      projectId: data.projectId || projectId,
      teamId: ObjectID.generate().toString(),
      userId: data.userId,
      hasAcceptedInvitation: data.hasAcceptedInvitation ?? true,
    });
  };

  // A person's on-call rule for an incident severity: one per kind and method.
  const rule: (data: {
    userId: string;
    severityId: string;
    projectId?: string | undefined;
  }) => Promise<void> = async (data: {
    userId: string;
    severityId: string;
    projectId?: string | undefined;
  }): Promise<void> => {
    await insert("UserNotificationRule", {
      _id: ObjectID.generate().toString(),
      projectId: data.projectId || projectId,
      userId: data.userId,
      incidentSeverityId: data.severityId,
      ruleType: "When incident is created",
    });
  };

  const peopleOf: (
    usage: Array<ArchivableValueUsageItem>,
  ) => ArchivableValueUsageItem | undefined = (
    usage: Array<ArchivableValueUsageItem>,
  ): ArchivableValueUsageItem | undefined => {
    return usage.find((item: ArchivableValueUsageItem): boolean => {
      return item.kind === ArchivableValueUsageKind.Personal;
    });
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

  beforeEach(async () => {
    // Each test reads only the rows it writes.
    for (const table of tablesCounted()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
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
        await countUses({
          valueTable,
          valueIds: [ObjectID.generate().toString()],
        }),
      ).toEqual([]);

      // Several at once, and the refusal checks a bulk Delete makes.
      expect(
        await ArchivableValueUsage.countValuesUsage({
          dataSource: database,
          valueTable,
          valueIds: [
            ObjectID.generate().toString(),
            ObjectID.generate().toString(),
          ],
          projectId: new ObjectID(projectId),
          purpose: ArchivableValuesUsagePurpose.Delete,
        }),
      ).toEqual({ usage: [], refusedValueIds: [], refusedUsage: [] });
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

    const usage: Array<ArchivableValueUsageItem> = await countUses({
      valueTable: "IncidentSeverity",
      valueIds: [severityId],
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

  /*
   * The maintainer's dialog: "Notification Rules (22)" in a project whose
   * owners set up two rules. Two members with eleven rules each for the
   * severity (one per kind and notification method, as OneUptime seeds
   * them) are two people.
   */
  test("people's own on-call rules: two people with eleven rules each are 2 people, not 22 rules", async () => {
    const maya: string = ObjectID.generate().toString();
    const deane: string = ObjectID.generate().toString();

    await member({ userId: maya });
    // A member of two teams of the project is one member.
    await member({ userId: deane });
    await member({ userId: deane });

    for (let index: number = 0; index < 11; index++) {
      await rule({ userId: maya, severityId: severityId });
      await rule({ userId: deane, severityId: severityId });
    }

    const usage: Array<ArchivableValueUsageItem> = await countUses({
      valueTable: "IncidentSeverity",
      valueIds: [severityId],
    });

    expect(usage).toEqual([
      {
        tableName: "UserNotificationRule",
        title: "Notification Rules",
        singularTitle: "Notification Rule",
        count: 2,
        isCountCapped: false,
        // Deleting the severity still deletes every one of their rules.
        effect: ArchivableValueDeleteEffect.Deleted,
        kind: ArchivableValueUsageKind.Personal,
      },
    ]);
  });

  test("people who left, who were only invited, or are another project's are not counted", async () => {
    const stays: string = ObjectID.generate().toString();
    const left: string = ObjectID.generate().toString();
    const invited: string = ObjectID.generate().toString();
    const elsewhere: string = ObjectID.generate().toString();

    await member({ userId: stays });
    // Never accepted the invitation: not a member yet.
    await member({ userId: invited, hasAcceptedInvitation: false });
    // A member of another project only.
    await member({ userId: elsewhere, projectId: otherProjectId });

    await rule({ userId: stays, severityId: severityId });
    // Rows a removed member left behind: no membership at all.
    await rule({ userId: left, severityId: severityId });
    await rule({ userId: invited, severityId: severityId });
    // Another project's rows never count, whoever they name.
    await rule({
      userId: elsewhere,
      severityId: severityId,
      projectId: otherProjectId,
    });

    const usage: Array<ArchivableValueUsageItem> = await countUses({
      valueTable: "IncidentSeverity",
      valueIds: [severityId],
    });

    expect(peopleOf(usage)?.count).toBe(1);
  });

  test("a person's rules for another severity are not counted for this one; asked about both, each person is counted once", async () => {
    const otherSeverityId: string = ObjectID.generate().toString();
    const both: string = ObjectID.generate().toString();
    const onlyOther: string = ObjectID.generate().toString();

    await member({ userId: both });
    await member({ userId: onlyOther });

    await rule({ userId: both, severityId: severityId });
    await rule({ userId: both, severityId: otherSeverityId });
    await rule({ userId: onlyOther, severityId: otherSeverityId });
    await rule({ userId: onlyOther, severityId: otherSeverityId });

    expect(
      peopleOf(
        await countUses({
          valueTable: "IncidentSeverity",
          valueIds: [severityId],
        }),
      )?.count,
    ).toBe(1);

    expect(
      peopleOf(
        await countUses({
          valueTable: "IncidentSeverity",
          valueIds: [otherSeverityId],
        }),
      )?.count,
    ).toBe(2);

    // Both severities, as a bulk dialog asks: two people, not three.
    expect(
      peopleOf(
        await countUses({
          valueTable: "IncidentSeverity",
          valueIds: [severityId, otherSeverityId],
        }),
      )?.count,
    ).toBe(2);
  });

  test("a label: the lists it is in, read through the records that own them - the project's, still there", async () => {
    const monitor: (values: {
      projectId: string;
      deletedAt?: Date | null;
    }) => Promise<string> = async (values: {
      projectId: string;
      deletedAt?: Date | null;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await insert("Monitor", {
        _id: id,
        projectId: values.projectId,
        deletedAt: values.deletedAt || null,
      });
      await insert("MonitorLabel", { monitorId: id, labelId: labelId });

      return id;
    };

    for (let index: number = 0; index < 3; index++) {
      await monitor({ projectId });
    }

    // Not the project's, and deleted: their join rows are not counted.
    await monitor({ projectId: otherProjectId });
    await monitor({ projectId, deletedAt: new Date() });

    // A join row whose monitor is gone names nothing.
    await insert("MonitorLabel", {
      monitorId: ObjectID.generate().toString(),
      labelId: labelId,
    });

    const ruleId: string = ObjectID.generate().toString();
    await insert("IncidentLabelRule", { _id: ruleId, projectId: projectId });
    await insert("IncidentLabelRuleLabelToAdd", {
      incidentLabelRuleId: ruleId,
      labelId: labelId,
    });

    const usage: Array<ArchivableValueUsageItem> = await countUses({
      valueTable: "Label",
      valueIds: [labelId],
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

  test("a rule that holds a label in two of its lists is one rule; two labels on one monitor are one monitor", async () => {
    const both: string = ObjectID.generate().toString();
    const episodesOnly: string = ObjectID.generate().toString();

    for (const id of [both, episodesOnly]) {
      await insert("IncidentGroupingRule", { _id: id, projectId: projectId });
    }

    await insert("IncidentGroupingRuleIncidentLabel", {
      incidentGroupingRuleId: both,
      labelId: labelId,
    });
    await insert("IncidentGroupingRuleMonitorLabel", {
      incidentGroupingRuleId: both,
      labelId: labelId,
    });
    await insert("IncidentGroupingRuleEpisodeLabel", {
      incidentGroupingRuleId: episodesOnly,
      labelId: labelId,
    });

    const groupingRules: ArchivableValueUsageItem | undefined = (
      await countUses({ valueTable: "Label", valueIds: [labelId] })
    ).find((item: ArchivableValueUsageItem): boolean => {
      return item.tableName === "IncidentGroupingRule";
    });

    // Three join rows, two rules.
    expect(groupingRules).toMatchObject({ count: 2 });

    // A monitor with both of the labels asked about is one monitor.
    const otherLabelId: string = ObjectID.generate().toString();
    const monitorId: string = ObjectID.generate().toString();

    await insert("Monitor", { _id: monitorId, projectId: projectId });
    await insert("MonitorLabel", { monitorId: monitorId, labelId: labelId });
    await insert("MonitorLabel", {
      monitorId: monitorId,
      labelId: otherLabelId,
    });

    expect(
      (
        await countUses({
          valueTable: "Label",
          valueIds: [labelId, otherLabelId],
        })
      ).find((item: ArchivableValueUsageItem): boolean => {
        return item.tableName === "Monitor";
      }),
    ).toMatchObject({ count: 1 });
  });

  test("a table reached with two effects: a line for each, and its total of monitors, every way together", async () => {
    const statusId: string = ObjectID.generate().toString();
    const criteria: string = JSON.stringify({
      monitorStepsInstanceArray: [
        {
          monitorCriteria: {
            monitorCriteriaInstanceArray: [
              {
                monitorStatusId: { _type: "ObjectID", value: statusId },
              },
            ],
          },
        },
      ],
    });

    const monitor: (values: {
      suppresses: boolean;
      criteria: boolean;
    }) => Promise<void> = async (values: {
      suppresses: boolean;
      criteria: boolean;
    }): Promise<void> => {
      const id: string = ObjectID.generate().toString();

      await insert("Monitor", {
        _id: id,
        projectId: projectId,
        monitorSteps: values.criteria ? criteria : null,
      });

      if (values.suppresses) {
        await insert("MonitorDependencySuppressionStatus", {
          monitorId: id,
          monitorStatusId: statusId,
        });
      }
    };

    // Both ways, criteria only, suppression only.
    await monitor({ suppresses: true, criteria: true });
    await monitor({ suppresses: false, criteria: true });
    await monitor({ suppresses: true, criteria: false });

    const monitors: Array<ArchivableValueUsageItem> = (
      await countUses({ valueTable: "MonitorStatus", valueIds: [statusId] })
    ).filter((item: ArchivableValueUsageItem): boolean => {
      return (
        item.tableName === "Monitor" &&
        item.kind === ArchivableValueUsageKind.Settings
      );
    });

    expect(monitors).toEqual([
      expect.objectContaining({
        effect: ArchivableValueDeleteEffect.RemovedFromList,
        count: 2,
        totalCount: 3,
        isTotalCountCapped: false,
      }),
      expect.objectContaining({
        effect: ArchivableValueDeleteEffect.LeftDangling,
        count: 2,
        totalCount: 3,
        isTotalCountCapped: false,
      }),
    ]);
  });

  test("a bulk Delete: the values records still have, what has them, and what deleting the rest changes", async () => {
    const inUse: string = ObjectID.generate().toString();
    const rulesOnly: string = ObjectID.generate().toString();
    const unused: string = ObjectID.generate().toString();
    const person: string = ObjectID.generate().toString();

    await insert("Incident", {
      _id: ObjectID.generate().toString(),
      projectId: projectId,
      incidentSeverityId: inUse,
    });
    // Another project's incident does not hold this project's delete up.
    await insert("Incident", {
      _id: ObjectID.generate().toString(),
      projectId: otherProjectId,
      incidentSeverityId: rulesOnly,
    });

    await member({ userId: person });
    await rule({ userId: person, severityId: inUse });
    await rule({ userId: person, severityId: rulesOnly });

    expect(
      await ArchivableValueUsage.getRefusedValueIds({
        dataSource: database,
        valueTable: "IncidentSeverity",
        valueIds: [unused, rulesOnly.toUpperCase(), inUse],
        projectId: new ObjectID(projectId),
      }),
    ).toEqual([inUse]);

    const answer: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: database,
        valueTable: "IncidentSeverity",
        valueIds: [inUse, rulesOnly, unused],
        projectId: new ObjectID(projectId),
        purpose: ArchivableValuesUsagePurpose.Delete,
      });

    expect(answer.refusedValueIds).toEqual([inUse]);
    expect(answer.refusedUsage).toEqual([
      expect.objectContaining({
        tableName: "Incident",
        count: 1,
        effect: ArchivableValueDeleteEffect.Refused,
      }),
    ]);
    // Deleting the rest takes the person's rules for the second one with it.
    expect(answer.usage).toEqual([
      expect.objectContaining({
        tableName: "UserNotificationRule",
        count: 1,
        kind: ArchivableValueUsageKind.Personal,
        effect: ArchivableValueDeleteEffect.Deleted,
      }),
    ]);

    // An archive of all three: everything any of them has, nothing refused.
    const archive: ArchivableValuesUsage =
      await ArchivableValueUsage.countValuesUsage({
        dataSource: database,
        valueTable: "IncidentSeverity",
        valueIds: [inUse, rulesOnly, unused],
        projectId: new ObjectID(projectId),
        purpose: ArchivableValuesUsagePurpose.Archive,
      });

    expect(archive.refusedValueIds).toEqual([]);
    expect(peopleOf(archive.usage)?.count).toBe(1);
    expect(
      archive.usage.find((item: ArchivableValueUsageItem): boolean => {
        return item.tableName === "Incident";
      })?.count,
    ).toBe(1);
  });

  test("the model behind every kind of value is the one the counts read", () => {
    expect(new IncidentSeverity().tableName).toBe("IncidentSeverity");
    expect(new Label().tableName).toBe("Label");
  });
});

/*
 * The refusal Postgres raises for deleting a value rows still have, through
 * a real foreign key, as the services answer it (DatabaseService passes its
 * own table): "archive it instead", only for the value's own delete.
 */
describePostgres(
  "a delete a foreign key refuses, said as Postgres raises it",
  () => {
    const schema: string = uniqueSchema("archive_values_refusal");
    const severityId: string = ObjectID.generate().toString();
    let database: DataSource;
    let refusal: unknown = null;

    beforeAll(async () => {
      database = await connect(schema);

      await database.query(
        `CREATE TABLE "${schema}"."IncidentSeverity" ("_id" uuid PRIMARY KEY)`,
      );
      await database.query(
        `CREATE TABLE "${schema}"."Incident" ("_id" uuid PRIMARY KEY, "incidentSeverityId" uuid REFERENCES "${schema}"."IncidentSeverity" ("_id"))`,
      );
      await database.query(
        `INSERT INTO "${schema}"."IncidentSeverity" ("_id") VALUES ($1)`,
        [severityId],
      );
      await database.query(
        `INSERT INTO "${schema}"."Incident" ("_id", "incidentSeverityId") VALUES ($1, $2)`,
        [ObjectID.generate().toString(), severityId],
      );

      try {
        await database.query(
          `DELETE FROM "${schema}"."IncidentSeverity" WHERE "_id" = $1`,
          [severityId],
        );
      } catch (error) {
        refusal = error;
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("the value's own delete: archive it instead", () => {
      expect(refusal).not.toBeNull();

      const translated: unknown = PostgresErrorTranslator.translate(refusal, {
        tableName: "IncidentSeverity",
      });

      expect((translated as Exception).message).toBe(
        "This incident severity can't be deleted while Incident records still have it. Archive it instead: nobody can pick it again, and everything that has it keeps it.",
      );
    });

    test("another model's delete that reached it - a project's - says what it always said", () => {
      const translated: unknown = PostgresErrorTranslator.translate(refusal, {
        tableName: "Project",
      });

      expect((translated as Exception).message).toBe(
        "This item cannot be deleted because Incident records still reference it. Please delete those records first, and then try again.",
      );
    });
  },
);
