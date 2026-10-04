import Entities from "../../../Models/DatabaseModels/Index";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import FormService from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import {
  FORM_LOGO_TYPE_MESSAGE,
  PublicFormImage,
} from "../../../Types/Form/FormBranding";
import { PublicForm } from "../../../Types/Form/FormPublic";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
 * Forms (which replaced incident forms) against a migrated Postgres.
 *
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
 * registered migration to an empty database - which is why the file and the
 * variables keep their incident-form names. The Common test job's Postgres
 * is not migrated, so the suite is skipped there.
 *
 * Two halves:
 *
 * - the migrated public tables are inspected as they are: every foreign
 *   key's ON DELETE rule, the link key's unique constraint, the columns'
 *   defaults, and that the incident form tables are gone;
 * - behaviour runs in a uniquely named schema holding structure-only clones
 *   of the tables involved. The clones carry the migrated indexes and
 *   constraints (LIKE ... INCLUDING ALL), and the two form tables' foreign
 *   keys are copied from the migrated definitions, so a cascade observed
 *   here is the cascade the migration declared. No row is ever written
 *   outside that schema, and the schema is dropped afterwards.
 *
 * The production FormService and FormSubmissionService run against the
 * clones; only realtime and workflow triggers are stubbed (and, for the
 * public read, the plan check, which reads billing this suite has none of).
 *
 * A form's branding - its logo and favicon, Files - runs here too: the
 * check of the File a write names, the public read that joins the form's
 * own files in the one lookup, and that deleting a file only takes it off
 * the form.
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INCIDENT_FORM_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "File",
  "Incident",
  "ScheduledMaintenance",
  "IncidentCustomField",
  "Form",
  "FormSubmission",
];

const NEW_TABLES: Array<string> = ["Form", "FormSubmission"];

interface ForeignKeyRow {
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
  definition: string;
}

describePostgres("Forms against a migrated Postgres", () => {
  const schema: string = `form_${ObjectID.generate()
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
      FormService,
      FormSubmissionService,
      IncidentCustomFieldService,
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
       VALUES ($1, 'Form test', $2, 1)`,
      [id.toString(), `form-${id.toString()}`],
    );
  }

  async function seedIncident(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version")
       VALUES ($1, $2, 'Checkout is failing', $3, $4, $5, 1)`,
      [
        id.toString(),
        projectId.toString(),
        `incident-${id.toString()}`,
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function seedEvent(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."ScheduledMaintenance"
       ("_id", "projectId", "title", "slug", "currentScheduledMaintenanceStateId", "startsAt", "endsAt", "version")
       VALUES ($1, $2, 'Database upgrade', $3, $4, now(), now() + interval '1 hour', 1)`,
      [
        id.toString(),
        projectId.toString(),
        `event-${id.toString()}`,
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function seedCustomField(
    project: ObjectID = projectId,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."IncidentCustomField"
       ("_id", "projectId", "name", "customFieldType", "variableKey", "sortOrder", "version")
       VALUES ($1, $2, $3, 'Text', $4, 1, 1)`,
      [
        id.toString(),
        project.toString(),
        `Impact ${id.toString().slice(0, 8)}`,
        `impact_${id.toString().replace(/-/g, "").slice(0, 8)}`,
      ],
    );
    return id;
  }

  async function createForm(data: Partial<Form> = {}): Promise<Form> {
    const form: Form = new Form();
    form.projectId = projectId;
    form.name = `Report ${ObjectID.generate().toString()}`;
    Object.assign(form, data);

    return FormService.create({
      data: form,
      props: { isRoot: true },
    });
  }

  // A File row, as an upload leaves it: private, with its bytes.
  async function seedFile(fileType: string, bytes: Buffer): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."File"
       ("_id", "name", "file", "fileType", "slug", "isPublic", "version")
       VALUES ($1, 'logo', $2, $3, $4, false, 1)`,
      [id.toString(), bytes, fileType, `logo-${id.toString()}`],
    );
    return id;
  }

  async function storedForm(id: ObjectID): Promise<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."Form" WHERE "_id" = $1`,
      [id.toString()],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  async function createSubmission(
    formId: ObjectID,
    data: Partial<FormSubmission> = {},
  ): Promise<FormSubmission> {
    const submission: FormSubmission = new FormSubmission();
    submission.projectId = projectId;
    submission.formId = formId;
    Object.assign(submission, data);

    return FormSubmissionService.create({
      data: submission,
      props: { isRoot: true },
    });
  }

  async function submissionRows(): Promise<
    Array<{
      _id: string;
      formId: string;
      incidentId: string | null;
      scheduledMaintenanceId: string | null;
    }>
  > {
    return database.query(
      `SELECT "_id", "formId", "incidentId", "scheduledMaintenanceId" FROM "${schema}"."FormSubmission" ORDER BY "createdAt"`,
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

  describe("the migrated tables", () => {
    test("a form goes with its project and outlives its users", () => {
      expect(
        migratedForeignKeys
          .filter((foreignKey: ForeignKeyRow): boolean => {
            return foreignKey.table === "Form";
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
        // A deleted logo or favicon only leaves the form without it.
        ["faviconFileId", "File", "n"],
        ["logoFileId", "File", "n"],
        ["projectId", "Project", "c"],
      ]);
    });

    test("a submission goes with its project and its form, and outlives what it created", () => {
      expect(
        migratedForeignKeys
          .filter((foreignKey: ForeignKeyRow): boolean => {
            return foreignKey.table === "FormSubmission";
          })
          .map((foreignKey: ForeignKeyRow): Array<string> => {
            return [
              foreignKey.column,
              foreignKey.referencedTable,
              foreignKey.onDelete,
            ];
          }),
      ).toEqual([
        ["formId", "Form", "c"],
        ["incidentId", "Incident", "n"],
        ["projectId", "Project", "c"],
        ["scheduledMaintenanceId", "ScheduledMaintenance", "n"],
      ]);
    });

    test("the link key is unique and never null", async () => {
      const constraints: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public' AND t.relname = 'Form' AND c.contype = 'u'`,
      );

      expect(constraints).toEqual([{ definition: 'UNIQUE ("shareKey")' }]);

      const columns: Array<{ is_nullable: string; data_type: string }> =
        await database.query(
          `SELECT is_nullable, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Form' AND column_name = 'shareKey'`,
        );

      expect(columns).toEqual([{ is_nullable: "NO", data_type: "uuid" }]);
    });

    test("the columns start where the model says they do", async () => {
      const rows: Array<{
        column_name: string;
        is_nullable: string;
        column_default: string | null;
        data_type: string;
      }> = await database.query(
        `SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'Form'
            AND column_name IN ('isEnabled', 'targetType', 'fields', 'targetSettings')
          ORDER BY column_name`,
      );

      expect(rows).toEqual([
        {
          column_name: "fields",
          is_nullable: "YES",
          column_default: null,
          data_type: "jsonb",
        },
        {
          column_name: "isEnabled",
          is_nullable: "NO",
          column_default: "true",
          data_type: "boolean",
        },
        {
          column_name: "targetSettings",
          is_nullable: "YES",
          column_default: null,
          data_type: "jsonb",
        },
        {
          column_name: "targetType",
          is_nullable: "NO",
          column_default: "'Incident'::character varying",
          data_type: "character varying",
        },
      ]);
    });

    test("the incident form tables are gone; the templates keep their custom field settings", async () => {
      const tables: Array<{ table_name: string }> = await database.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('IncidentForm', 'IncidentFormSubmission')`,
      );

      expect(tables).toEqual([]);

      const settings: Array<{ data_type: string }> = await database.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'IncidentTemplate' AND column_name = 'customFieldSettings'`,
      );

      expect(settings).toEqual([{ data_type: "jsonb" }]);
    });
  });

  describe("forms", () => {
    test("a new form gets its own link key, creates incidents and asks its target's questions", async () => {
      const clientKey: ObjectID = ObjectID.generate();

      const created: Form = await createForm({ shareKey: clientKey });
      const row: Record<string, unknown> = await storedForm(created.id!);

      expect(ObjectID.isValidUUID(String(row["shareKey"]))).toBe(true);
      expect(row["shareKey"]).not.toBe(clientKey.toString());
      expect(row["isEnabled"]).toBe(true);
      expect(row["targetType"]).toBe(FormTargetType.Incident);
      expect(
        (row["fields"] as Array<FormField>).map((field: FormField) => {
          return field.targetField || field.submitterField;
        }),
      ).toEqual(["title", "description", "Name", "Email"]);

      // Read back through the model, the key is an ObjectID again.
      const read: Form | null = await FormService.findOneById({
        id: created.id!,
        select: { shareKey: true, fields: true },
        props: { isRoot: true },
      });

      expect(read?.shareKey).toBeInstanceOf(ObjectID);
      expect(read?.shareKey?.toString()).toBe(row["shareKey"]);
    });

    test("keeps the questions and settings exactly as sent", async () => {
      const fields: Array<FormField> = getDefaultFormFields(
        FormTargetType.ScheduledMaintenance,
      );

      const created: Form = await createForm({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: fields as unknown as JSONArray,
        targetSettings: { showOnStatusPages: true },
      });

      const row: Record<string, unknown> = await storedForm(created.id!);

      expect(row["fields"]).toEqual(JSON.parse(JSON.stringify(fields)));
      expect(row["targetSettings"]).toEqual({ showOnStatusPages: true });
      expect(row["targetType"]).toBe(FormTargetType.ScheduledMaintenance);
    });

    test("no two forms share a key, and a key another form holds cannot be taken", async () => {
      const first: Form = await createForm();
      const second: Form = await createForm();

      const firstKey: string = String(
        (await storedForm(first.id!))["shareKey"],
      );
      const secondKey: string = String(
        (await storedForm(second.id!))["shareKey"],
      );

      expect(firstKey).not.toBe(secondKey);

      await expect(
        FormService.updateOneById({
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
            `UPDATE "${schema}"."Form" SET "shareKey" = $1 WHERE "_id" = $2`,
            [firstKey, second.id!.toString()],
          );
        }),
      ).toBe("23505");
    });

    test("resetting the link stores the new key, and the old one no longer finds the form", async () => {
      const form: Form = await createForm();
      const oldKey: string = String((await storedForm(form.id!))["shareKey"]);
      const newKey: ObjectID = ObjectID.generate();

      await FormService.updateOneById({
        id: form.id!,
        data: { shareKey: newKey },
        props: { isRoot: true },
      });

      expect((await storedForm(form.id!))["shareKey"]).toBe(newKey.toString());
      expect(
        await FormService.findOneBy({
          query: { shareKey: new ObjectID(oldKey) },
          select: { _id: true },
          props: { isRoot: true },
        }),
      ).toBeNull();
    });

    test("a null key is refused by the database too", async () => {
      const form: Form = await createForm();

      expect(
        await sqlState(() => {
          return database.query(
            `UPDATE "${schema}"."Form" SET "shareKey" = NULL WHERE "_id" = $1`,
            [form.id!.toString()],
          );
        }),
      ).toBe("23502");
    });

    test("two forms of one project cannot share a name; another project's can", async () => {
      await createForm({ name: "Report a Problem" });

      await expect(
        createForm({ name: "Report a Problem" }),
      ).rejects.toBeInstanceOf(BadDataException);
      await expect(
        createForm({ name: "Report a Problem", projectId: otherProjectId }),
      ).resolves.toBeDefined();
    });

    test("a question linked to another project's custom field is refused, and nothing is stored", async () => {
      const foreignFieldId: ObjectID = await seedCustomField(otherProjectId);

      await expect(
        createForm({
          fields: [
            {
              id: "impact",
              source: FormFieldSource.TargetCustomField,
              customFieldId: foreignFieldId.toString(),
              label: "Impact",
              isRequired: false,
            },
          ] as unknown as JSONArray,
        }),
      ).rejects.toBeInstanceOf(BadDataException);

      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${schema}"."Form"`,
      );
      expect(rows[0]!.count).toBe("0");
    });

    /*
     * Forms name a custom field by its id. Deleting the field leaves the
     * question where it is - the builder shows it as one to delete, and the
     * public page leaves it out - so the forms are not touched at all.
     */
    test("deleting a custom field leaves the forms that ask it untouched", async () => {
      const fieldId: ObjectID = await seedCustomField();

      const form: Form = await createForm({
        fields: [
          {
            id: "impact",
            source: FormFieldSource.TargetCustomField,
            customFieldId: fieldId.toString(),
            label: "Impact",
            isRequired: true,
          },
        ] as unknown as JSONArray,
      });

      const before: Record<string, unknown> = await storedForm(form.id!);

      await IncidentCustomFieldService.deleteOneById({
        id: fieldId,
        props: { isRoot: true },
      });

      const after: Record<string, unknown> = await storedForm(form.id!);

      expect(after["fields"]).toEqual(before["fields"]);
      expect(after["version"]).toBe(before["version"]);
    });
  });

  describe("branding", () => {
    const LOGO: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const FAVICON: Buffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );

    test("a form keeps its logo and favicon, and its public page gets them inside the form", async () => {
      jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true);

      const logoId: ObjectID = await seedFile("image/png", LOGO);
      const faviconId: ObjectID = await seedFile("image/svg+xml", FAVICON);

      const form: Form = await createForm({
        logoFileId: logoId,
        logoAltText: "Acme Inc.",
        faviconFileId: faviconId,
      });
      const row: Record<string, unknown> = await storedForm(form.id!);

      expect(row["logoFileId"]).toBe(logoId.toString());
      expect(row["faviconFileId"]).toBe(faviconId.toString());
      expect(row["logoAltText"]).toBe("Acme Inc.");

      // The real lookup: the form's own files, joined in the one query.
      const told: PublicForm = await FormService.getPublicForm({
        shareKey: String(row["shareKey"]),
        clientIp: "203.0.113.7",
      });

      expect(told.logo).toEqual({
        type: "image/png",
        data: LOGO.toString("base64"),
      } as PublicFormImage);
      expect(told.logoAltText).toBe("Acme Inc.");
      expect(told.favicon).toEqual({
        type: "image/svg+xml",
        data: FAVICON.toString("base64"),
      } as PublicFormImage);

      // The files themselves were never made public.
      const files: Array<{ isPublic: boolean }> = await database.query(
        `SELECT "isPublic" FROM "${schema}"."File" ORDER BY "createdAt"`,
      );
      expect(files).toEqual([{ isPublic: false }, { isPublic: false }]);
    });

    test("a form without branding tells its page nothing more than before", async () => {
      jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true);

      const form: Form = await createForm();
      const told: PublicForm = await FormService.getPublicForm({
        shareKey: String((await storedForm(form.id!))["shareKey"]),
        clientIp: "203.0.113.7",
      });

      expect(Object.keys(told).sort()).toEqual(
        ["fields", "isCaptchaRequired", "name"].sort(),
      );
    });

    test("a file that is not an image is refused as a logo, and nothing is stored", async () => {
      const pdfId: ObjectID = await seedFile(
        "application/pdf",
        Buffer.from("%PDF-1.7"),
      );

      await expect(createForm({ logoFileId: pdfId })).rejects.toThrow(
        FORM_LOGO_TYPE_MESSAGE,
      );

      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*)::text AS "count" FROM "${schema}"."Form"`,
      );
      expect(rows[0]!.count).toBe("0");
    });

    test("deleting the logo's file only takes it off the form", async () => {
      const logoId: ObjectID = await seedFile("image/png", LOGO);
      const form: Form = await createForm({ logoFileId: logoId });

      await database.query(`DELETE FROM "${schema}"."File" WHERE "_id" = $1`, [
        logoId.toString(),
      ]);

      const row: Record<string, unknown> = await storedForm(form.id!);

      expect(row["logoFileId"]).toBeNull();
      expect(row["name"]).toBe(form.name);
    });
  });

  describe("submissions", () => {
    test("the submitter's email is stored lowercased and read back as an Email", async () => {
      const form: Form = await createForm();
      const submission: FormSubmission = await createSubmission(form.id!, {
        submitterName: "Jane",
        submitterEmail: new Email("Jane@Example.com"),
        answers: [
          {
            fieldId: "title",
            label: "Title",
            value: "Down",
            displayValue: "Down",
          },
        ],
      });

      const read: FormSubmission | null =
        await FormSubmissionService.findOneById({
          id: submission.id!,
          select: { submitterEmail: true, answers: true },
          props: { isRoot: true },
        });

      expect(read?.submitterEmail).toBeInstanceOf(Email);
      expect(read?.submitterEmail?.toString()).toBe("jane@example.com");
      expect(read?.answers).toEqual([
        {
          fieldId: "title",
          label: "Title",
          value: "Down",
          displayValue: "Down",
        },
      ]);
    });

    test("deleting the incident keeps the submission, with no incident", async () => {
      const form: Form = await createForm();
      const incidentId: ObjectID = await seedIncident();
      await createSubmission(form.id!, {
        incidentId,
        targetType: FormTargetType.Incident,
      });

      await database.query(
        `DELETE FROM "${schema}"."Incident" WHERE "_id" = $1`,
        [incidentId.toString()],
      );

      expect(await submissionRows()).toEqual([
        expect.objectContaining({ incidentId: null }),
      ]);
    });

    test("deleting the scheduled maintenance event keeps the submission, with no event", async () => {
      const form: Form = await createForm();
      const eventId: ObjectID = await seedEvent();
      await createSubmission(form.id!, {
        scheduledMaintenanceId: eventId,
        targetType: FormTargetType.ScheduledMaintenance,
      });

      await database.query(
        `DELETE FROM "${schema}"."ScheduledMaintenance" WHERE "_id" = $1`,
        [eventId.toString()],
      );

      expect(await submissionRows()).toEqual([
        expect.objectContaining({ scheduledMaintenanceId: null }),
      ]);
    });

    test("deleting the form deletes its submissions, and only its own", async () => {
      const form: Form = await createForm();
      const other: Form = await createForm();
      await createSubmission(form.id!);
      await createSubmission(form.id!);
      await createSubmission(other.id!);

      await database.query(`DELETE FROM "${schema}"."Form" WHERE "_id" = $1`, [
        form.id!.toString(),
      ]);

      expect(
        (await submissionRows()).map((row: { formId: string }) => {
          return row.formId;
        }),
      ).toEqual([other.id!.toString()]);
    });
  });
});
