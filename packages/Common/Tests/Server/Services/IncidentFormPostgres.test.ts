import Entities from "../../../Models/DatabaseModels/Index";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import IncidentFormService from "../../../Server/Services/IncidentFormService";
import IncidentFormSubmissionService from "../../../Server/Services/IncidentFormSubmissionService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import { IncidentFormFieldSetting } from "../../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_INCIDENT_FORM_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_FORM_TESTS=true \
 *   INCIDENT_FORM_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_FORM_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/IncidentFormPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test incident
 * forms on migrated Postgres"), right after that job has applied every
 * registered migration to an empty database. The Common test job's Postgres
 * is not migrated, so the suite is skipped there.
 *
 * Two halves:
 *
 * - the migrated public tables are inspected as they are: every foreign
 *   key's ON DELETE rule, the link key's unique constraint, and the columns
 *   a fake QueryRunner cannot prove are what Postgres ended up with;
 * - behaviour runs in a uniquely named schema holding structure-only clones
 *   of the tables involved. The clones carry the migrated indexes and
 *   constraints (LIKE ... INCLUDING ALL), and the two new tables' foreign
 *   keys are copied from the migrated definitions, so a cascade observed
 *   here is the cascade the migration declared. No row is ever written
 *   outside that schema, and the schema is dropped afterwards.
 *
 * The production IncidentFormService and IncidentFormSubmissionService run
 * against the clones; only realtime and workflow triggers are stubbed.
 * Privacy clauses reference the owner and team tables, which are not
 * cloned: they resolve to the migrated public tables through the search
 * path, where a member with a freshly generated id owns nothing.
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INCIDENT_FORM_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "IncidentSeverity",
  "IncidentTemplate",
  "Incident",
  "IncidentForm",
  "IncidentFormSubmission",
];

const NEW_TABLES: Array<string> = ["IncidentForm", "IncidentFormSubmission"];

interface ForeignKeyRow {
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
  definition: string;
}

describePostgres("Incident forms against a migrated Postgres", () => {
  const schema: string = `incident_form_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  let database: DataSource;
  let migratedForeignKeys: Array<ForeignKeyRow> = [];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INCIDENT_FORM_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["INCIDENT_FORM_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INCIDENT_FORM_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    /*
     * Read the migrated foreign keys before the clones exist, so their
     * definitions name the referenced tables without a schema.
     */
    migratedForeignKeys = await database.query(
      `SELECT t.relname AS "table",
              c.conname AS "name",
              a.attname AS "column",
              r.relname AS "referencedTable",
              c.confdeltype AS "onDelete",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'
        ORDER BY t.relname, a.attname`,
      [NEW_TABLES],
    );

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const foreignKey of migratedForeignKeys) {
      const definition: string = foreignKey.definition.replace(
        /REFERENCES public\./g,
        "REFERENCES ",
      );
      await database.query(
        `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${definition}`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const service of [
      IncidentFormService,
      IncidentFormSubmissionService,
    ] as Array<{
      onTriggerRealtime: unknown;
      onTriggerWorkflow: unknown;
    }>) {
      jest
        .spyOn(service as never, "onTriggerRealtime" as never)
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(service as never, "onTriggerWorkflow" as never)
        .mockResolvedValue(undefined as never);
    }
  });

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      })
        .reverse()
        .join("; "),
    );
    await seedProject(projectId);
    await seedProject(otherProjectId);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seedProject(id: ObjectID): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
       VALUES ($1, 'Incident form test', $2, 1)`,
      [id.toString(), `incident-form-${id.toString()}`],
    );
  }

  async function seedSeverity(
    project: ObjectID = projectId,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."IncidentSeverity" ("_id", "projectId", "name", "slug", "color", "order", "version")
       VALUES ($1, $2, 'High', $3, '#ff0000', 1, 1)`,
      [id.toString(), project.toString(), `severity-${id.toString()}`],
    );
    return id;
  }

  async function seedTemplate(
    project: ObjectID = projectId,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."IncidentTemplate" ("_id", "projectId", "title", "templateName", "templateDescription", "slug", "version")
       VALUES ($1, $2, 'Possible data breach', 'Data breach', 'For security reports', $3, 1)`,
      [id.toString(), project.toString(), `template-${id.toString()}`],
    );
    return id;
  }

  async function seedIncident(
    options: { isPrivate?: boolean } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "isPrivate", "version")
       VALUES ($1, $2, 'Checkout is failing', $3, $4, $5, $6, 1)`,
      [
        id.toString(),
        projectId.toString(),
        `incident-${id.toString()}`,
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        Boolean(options.isPrivate),
      ],
    );
    return id;
  }

  async function createForm(
    data: Partial<IncidentForm> = {},
  ): Promise<IncidentForm> {
    const form: IncidentForm = new IncidentForm();
    form.projectId = projectId;
    form.name = `Report ${ObjectID.generate().toString()}`;
    form.incidentSeverityId = await seedSeverity();
    Object.assign(form, data);

    return IncidentFormService.create({
      data: form,
      props: { isRoot: true },
    });
  }

  async function storedForm(id: ObjectID): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."IncidentForm" WHERE "_id" = $1`,
      [id.toString()],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  async function createSubmission(
    formId: ObjectID,
    data: Partial<IncidentFormSubmission> = {},
  ): Promise<IncidentFormSubmission> {
    const submission: IncidentFormSubmission = new IncidentFormSubmission();
    submission.projectId = projectId;
    submission.incidentFormId = formId;
    Object.assign(submission, data);

    return IncidentFormSubmissionService.create({
      data: submission,
      props: { isRoot: true },
    });
  }

  async function submissionRows(): Promise<
    Array<{ _id: string; incidentId: string | null }>
  > {
    return database.query(
      `SELECT "_id", "incidentId" FROM "${schema}"."IncidentFormSubmission" ORDER BY "createdAt"`,
    );
  }

  async function sqlState(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return String(
        (error as { code?: string; driverError?: { code?: string } }).code ||
          (error as { driverError?: { code?: string } }).driverError?.code,
      );
    }
    return "no error";
  }

  // An incident viewer of the test project, who owns nothing.
  function viewerProps(): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      projectId: projectId,
      _type: "UserTenantAccessPermission",
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.IncidentViewer,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    };

    return {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  describe("the migrated tables", () => {
    test("a form goes with its project and outlives its severity, template and users", () => {
      expect(
        migratedForeignKeys
          .filter((foreignKey: ForeignKeyRow): boolean => {
            return foreignKey.table === "IncidentForm";
          })
          .map((foreignKey: ForeignKeyRow): Array<string> => {
            return [
              foreignKey.column,
              foreignKey.referencedTable,
              foreignKey.onDelete,
            ];
          }),
      ).toEqual([
        // confdeltype: c = CASCADE, n = SET NULL
        ["createdByUserId", "User", "n"],
        ["deletedByUserId", "User", "n"],
        ["incidentSeverityId", "IncidentSeverity", "n"],
        ["incidentTemplateId", "IncidentTemplate", "n"],
        ["projectId", "Project", "c"],
      ]);
    });

    test("a submission goes with its project and its form, and outlives its incident", () => {
      expect(
        migratedForeignKeys
          .filter((foreignKey: ForeignKeyRow): boolean => {
            return foreignKey.table === "IncidentFormSubmission";
          })
          .map((foreignKey: ForeignKeyRow): Array<string> => {
            return [
              foreignKey.column,
              foreignKey.referencedTable,
              foreignKey.onDelete,
            ];
          }),
      ).toEqual([
        ["incidentFormId", "IncidentForm", "c"],
        ["incidentId", "Incident", "n"],
        ["projectId", "Project", "c"],
      ]);
    });

    test("the link key is unique and never null", async () => {
      const constraints: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'IncidentForm' AND c.contype = 'u'`,
      );

      expect(constraints).toEqual([{ definition: 'UNIQUE ("shareKey")' }]);

      const columns: Array<{ is_nullable: string; data_type: string }> =
        await database.query(
          `SELECT is_nullable, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'IncidentForm' AND column_name = 'shareKey'`,
        );

      expect(columns).toEqual([{ is_nullable: "NO", data_type: "uuid" }]);
    });

    test("the columns start where the models say they do", async () => {
      const rows: Array<{
        column_name: string;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'IncidentForm'
            AND column_name IN ('isEnabled', 'allowReporterToChooseSeverity', 'isReporterDetailsRequired', 'descriptionSetting', 'incidentSeverityId', 'incidentTemplateId', 'customFieldSettings')
          ORDER BY column_name`,
      );

      expect(rows).toEqual([
        {
          column_name: "allowReporterToChooseSeverity",
          is_nullable: "NO",
          column_default: "false",
        },
        {
          column_name: "customFieldSettings",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "descriptionSetting",
          is_nullable: "NO",
          column_default: "'Optional'::character varying",
        },
        {
          column_name: "incidentSeverityId",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "incidentTemplateId",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "isEnabled",
          is_nullable: "NO",
          column_default: "true",
        },
        {
          column_name: "isReporterDetailsRequired",
          is_nullable: "NO",
          column_default: "true",
        },
      ]);
    });

    test("every existing template gets a nullable settings column with no default", async () => {
      const rows: Array<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'IncidentTemplate' AND column_name = 'customFieldSettings'`,
      );

      expect(rows).toEqual([
        { data_type: "jsonb", is_nullable: "YES", column_default: null },
      ]);
    });
  });

  describe("forms", () => {
    test("a form is given its own link key, keeps its questions exactly as sent and starts with the column defaults", async () => {
      const clientKey: ObjectID = ObjectID.generate();
      const templateId: ObjectID = await seedTemplate();

      const created: IncidentForm = await createForm({
        shareKey: clientKey,
        incidentTemplateId: templateId,
        customFieldSettings: {
          impact: "Required",
          affected_location: "Optional",
          customer: "Default",
        },
      });

      const row: Record<string, unknown> = await storedForm(created.id!);

      expect(ObjectID.isValidUUID(String(row["shareKey"]))).toBe(true);
      expect(row["shareKey"]).not.toBe(clientKey.toString());
      expect(row["customFieldSettings"]).toEqual({
        impact: "Required",
        affected_location: "Optional",
        customer: "Default",
      });
      expect(row["incidentTemplateId"]).toBe(templateId.toString());
      expect(row["isEnabled"]).toBe(true);
      expect(row["allowReporterToChooseSeverity"]).toBe(false);
      expect(row["isReporterDetailsRequired"]).toBe(true);
      expect(row["descriptionSetting"]).toBe(IncidentFormFieldSetting.Optional);

      // Read back through the model, the key is an ObjectID again.
      const read: IncidentForm | null = await IncidentFormService.findOneById({
        id: created.id!,
        select: { shareKey: true, customFieldSettings: true },
        props: { isRoot: true },
      });

      expect(read?.shareKey).toBeInstanceOf(ObjectID);
      expect(read?.shareKey?.toString()).toBe(row["shareKey"]);
    });

    test("no two forms share a key, and a key another form holds cannot be taken", async () => {
      const first: IncidentForm = await createForm();
      const second: IncidentForm = await createForm();

      const firstKey: string = String(
        (await storedForm(first.id!))["shareKey"],
      );
      const secondKey: string = String(
        (await storedForm(second.id!))["shareKey"],
      );

      expect(firstKey).not.toBe(secondKey);

      await expect(
        IncidentFormService.updateOneById({
          id: second.id!,
          data: { shareKey: new ObjectID(firstKey) },
          props: { isRoot: true },
        }),
      ).rejects.toBeDefined();

      expect((await storedForm(second.id!))["shareKey"]).toBe(secondKey);

      // And the database itself refuses a duplicate, whatever writes it.
      expect(
        await sqlState(() => {
          return database.query(
            `UPDATE "${schema}"."IncidentForm" SET "shareKey" = $1 WHERE "_id" = $2`,
            [firstKey, second.id!.toString()],
          );
        }),
      ).toBe("23505");
    });

    test("resetting the link stores the new key, and the old one no longer finds the form", async () => {
      const form: IncidentForm = await createForm();
      const oldKey: string = String((await storedForm(form.id!))["shareKey"]);
      const newKey: ObjectID = ObjectID.generate();

      await IncidentFormService.updateOneById({
        id: form.id!,
        data: { shareKey: newKey },
        props: { isRoot: true },
      });

      expect((await storedForm(form.id!))["shareKey"]).toBe(newKey.toString());
      expect(
        await IncidentFormService.findOneBy({
          query: { shareKey: new ObjectID(oldKey) },
          select: { _id: true },
          props: { isRoot: true },
        }),
      ).toBeNull();
      expect(
        (
          await IncidentFormService.findOneBy({
            query: { shareKey: newKey },
            select: { _id: true },
            props: { isRoot: true },
          })
        )?.id?.toString(),
      ).toBe(form.id!.toString());
    });

    test("a null key is refused by the database too", async () => {
      const form: IncidentForm = await createForm();

      expect(
        await sqlState(() => {
          return database.query(
            `UPDATE "${schema}"."IncidentForm" SET "shareKey" = NULL WHERE "_id" = $1`,
            [form.id!.toString()],
          );
        }),
      ).toBe("23502");
    });

    test("a severity or template from another project is refused", async () => {
      const foreignSeverityId: ObjectID = await seedSeverity(otherProjectId);
      const foreignTemplateId: ObjectID = await seedTemplate(otherProjectId);

      await expect(
        createForm({ incidentSeverityId: foreignSeverityId }),
      ).rejects.toBeInstanceOf(BadDataException);
      await expect(
        createForm({ incidentTemplateId: foreignTemplateId }),
      ).rejects.toBeInstanceOf(BadDataException);

      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${schema}"."IncidentForm"`,
      );
      expect(rows[0]!.count).toBe("0");
    });

    test("deleting its severity clears it, and the form stays", async () => {
      const form: IncidentForm = await createForm();
      const severityId: string = String(
        (await storedForm(form.id!))["incidentSeverityId"],
      );

      await database.query(
        `DELETE FROM "${schema}"."IncidentSeverity" WHERE "_id" = $1`,
        [severityId],
      );

      expect((await storedForm(form.id!))["incidentSeverityId"]).toBeNull();
    });

    test("deleting its template clears it, and the form stays", async () => {
      const templateId: ObjectID = await seedTemplate();
      const form: IncidentForm = await createForm({
        incidentTemplateId: templateId,
      });

      await database.query(
        `DELETE FROM "${schema}"."IncidentTemplate" WHERE "_id" = $1`,
        [templateId.toString()],
      );

      expect((await storedForm(form.id!))["incidentTemplateId"]).toBeNull();
    });
  });

  describe("submissions", () => {
    test("the reporter's email is stored lowercased and read back as an Email", async () => {
      const form: IncidentForm = await createForm();

      const created: IncidentFormSubmission = await createSubmission(form.id!, {
        reporterName: "Jane Doe",
        reporterEmail: new Email("Jane.Doe@Example.COM"),
      });

      const read: IncidentFormSubmission | null =
        await IncidentFormSubmissionService.findOneById({
          id: created.id!,
          select: { reporterName: true, reporterEmail: true },
          props: { isRoot: true },
        });

      expect(read?.reporterName).toBe("Jane Doe");
      expect(read?.reporterEmail).toBeInstanceOf(Email);
      expect(read?.reporterEmail?.toString()).toBe("jane.doe@example.com");
    });

    test("deleting the incident keeps the submission, with no incident", async () => {
      const form: IncidentForm = await createForm();
      const incidentId: ObjectID = await seedIncident();
      const submission: IncidentFormSubmission = await createSubmission(
        form.id!,
        { incidentId: incidentId },
      );

      await database.query(
        `DELETE FROM "${schema}"."Incident" WHERE "_id" = $1`,
        [incidentId.toString()],
      );

      expect(await submissionRows()).toEqual([
        { _id: submission.id!.toString(), incidentId: null },
      ]);
    });

    test("deleting the form deletes its submissions, and only its own", async () => {
      const form: IncidentForm = await createForm();
      const otherForm: IncidentForm = await createForm();
      await createSubmission(form.id!);
      await createSubmission(form.id!);
      const kept: IncidentFormSubmission = await createSubmission(
        otherForm.id!,
      );

      await IncidentFormService.deleteOneById({
        id: form.id!,
        props: { isRoot: true },
      });

      expect(
        (await submissionRows()).map((row: { _id: string }): string => {
          return row._id;
        }),
      ).toEqual([kept.id!.toString()]);
    });

    test("a viewer sees the submissions of incidents they can see - and of deleted ones - never of a private incident", async () => {
      const form: IncidentForm = await createForm();
      const publicIncidentId: ObjectID = await seedIncident();
      const privateIncidentId: ObjectID = await seedIncident({
        isPrivate: true,
      });

      const ofPublic: IncidentFormSubmission = await createSubmission(
        form.id!,
        { incidentId: publicIncidentId },
      );
      await createSubmission(form.id!, { incidentId: privateIncidentId });
      const ofDeleted: IncidentFormSubmission = await createSubmission(
        form.id!,
      );

      const viewer: DatabaseCommonInteractionProps = viewerProps();

      const visible: Array<IncidentFormSubmission> =
        await IncidentFormSubmissionService.findBy({
          query: { incidentFormId: form.id! },
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: viewer,
        });

      expect(
        visible
          .map((row: IncidentFormSubmission): string => {
            return row._id!.toString();
          })
          .sort(),
      ).toEqual([ofPublic.id!.toString(), ofDeleted.id!.toString()].sort());

      expect(
        (
          await IncidentFormSubmissionService.countBy({
            query: { incidentFormId: form.id! },
            props: viewer,
          })
        ).toNumber(),
      ).toBe(2);

      // Root, which bypasses privacy, sees all three.
      expect(
        await IncidentFormSubmissionService.findBy({
          query: { incidentFormId: form.id! },
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        }),
      ).toHaveLength(3);
    });
  });
});
