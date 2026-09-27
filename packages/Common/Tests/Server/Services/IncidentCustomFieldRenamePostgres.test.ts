import Entities from "../../../Models/DatabaseModels/Index";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import { backfillIncidentCustomFieldVariableKeys } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1795800000000-AddIncidentCustomFieldCreateAndNotificationSettings";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import TableViewService from "../../../Server/Services/TableViewService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * Incident custom field keys and renames against a migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_CUSTOM_FIELD_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_CUSTOM_FIELD_TESTS=true \
 *   INCIDENT_CUSTOM_FIELD_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_CUSTOM_FIELD_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/IncidentCustomFieldRenamePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works
 * on structure-only clones (LIKE ... INCLUDING ALL, so the unique
 * (projectId, variableKey) index comes along) of IncidentCustomField,
 * Incident, IncidentTemplate and TableView in a uniquely named schema that is
 * dropped afterwards; every row is synthetic.
 *
 * What it pins:
 *   - a project admin renaming a field through IncidentCustomFieldService
 *     moves its values in Incident and IncidentTemplate, and rewrites the
 *     incidents list's saved views, for that project only - without the
 *     "On Update" workflow of any incident, template or view, and without
 *     touching their version or updatedAt;
 *   - bags that are not objects, and other projects, are left alone;
 *   - a rename onto another field's name is refused and moves nothing;
 *   - a new field gets a unique template key, and the index refuses a
 *     duplicate however it is written;
 *   - the migration's backfill gives every existing field a key, oldest
 *     first, and does nothing the second time.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INCIDENT_CUSTOM_FIELD_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "IncidentCustomField",
  "Incident",
  "IncidentTemplate",
  "TableView",
];

describePostgres(
  "incident custom field keys and renames against Postgres",
  () => {
    const schema: string = `incident_custom_field_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    function adminProps(): DatabaseCommonInteractionProps {
      const tenantPermission: UserTenantAccessPermission = {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [Permission.ProjectAdmin].map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
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

    async function createField(name: string): Promise<IncidentCustomField> {
      const field: IncidentCustomField = new IncidentCustomField();
      field.name = name;
      field.customFieldType = CustomFieldType.Text;

      return await IncidentCustomFieldService.create({
        data: field,
        props: adminProps(),
      });
    }

    async function seedIncident(
      customFields: unknown,
      project: ObjectID = projectId,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "customFields", "version", "updatedAt")
       VALUES ($1, $2, 'Shared uplink down', $3, $4, $5, $6::jsonb, 3, '2026-01-01T00:00:00Z')`,
        [
          id.toString(),
          project.toString(),
          `incident-${id.toString()}`,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          customFields === null ? null : JSON.stringify(customFields),
        ],
      );
      return id;
    }

    async function seedTemplate(
      customFields: unknown,
      project: ObjectID = projectId,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentTemplate"
       ("_id", "projectId", "title", "templateName", "templateDescription", "slug", "customFields", "version")
       VALUES ($1, $2, 'Site outage', 'Site outage', 'A site is down', $3, $4::jsonb, 1)`,
        [
          id.toString(),
          project.toString(),
          `template-${id.toString()}`,
          JSON.stringify(customFields),
        ],
      );
      return id;
    }

    async function seedTableView(data: {
      tableId: string;
      columns?: JSONObject;
      facets?: JSONObject;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."TableView"
       ("_id", "projectId", "name", "tableId", "query", "sort", "columns", "facets", "version", "updatedAt")
       VALUES ($1, $2, 'My view', $3, '{}'::jsonb, '{}'::jsonb, $4::jsonb, $5::jsonb, 1, '2026-01-01T00:00:00Z')`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          data.tableId,
          data.columns ? JSON.stringify(data.columns) : null,
          data.facets ? JSON.stringify(data.facets) : null,
        ],
      );
      return id;
    }

    async function readRow(
      table: string,
      id: ObjectID,
    ): Promise<{
      customFields: unknown;
      version: number;
      updatedAt: Date;
      columns?: unknown;
      facets?: unknown;
    }> {
      const rows: Array<{
        customFields: unknown;
        version: number;
        updatedAt: Date;
        columns?: unknown;
        facets?: unknown;
      }> = await database.query(
        `SELECT * FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );
      return rows[0]!;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["INCIDENT_CUSTOM_FIELD_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["INCIDENT_CUSTOM_FIELD_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["INCIDENT_CUSTOM_FIELD_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      jest
        .spyOn(IncidentCustomFieldService, "onTriggerRealtime")
        .mockResolvedValue();
      jest
        .spyOn(IncidentCustomFieldService, "onTriggerWorkflow")
        .mockResolvedValue();
      // The mapping backfill after a save has no mapping to apply here.
      jest
        .spyOn(CustomFieldMappingService, "backfillProject")
        .mockResolvedValue();
    });

    let incidentWorkflow: jest.SpiedFunction<
      typeof IncidentService.onTriggerWorkflow
    >;
    let templateWorkflow: jest.SpiedFunction<
      typeof IncidentTemplateService.onTriggerWorkflow
    >;
    let tableViewWorkflow: jest.SpiedFunction<
      typeof TableViewService.onTriggerWorkflow
    >;

    beforeEach(async () => {
      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      incidentWorkflow = jest
        .spyOn(IncidentService, "onTriggerWorkflow")
        .mockResolvedValue();
      templateWorkflow = jest
        .spyOn(IncidentTemplateService, "onTriggerWorkflow")
        .mockResolvedValue();
      tableViewWorkflow = jest
        .spyOn(TableViewService, "onTriggerWorkflow")
        .mockResolvedValue();
      incidentWorkflow.mockClear();
      templateWorkflow.mockClear();
      tableViewWorkflow.mockClear();
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("renaming a field moves its values, and its saved views, and starts no workflow", async () => {
      const impact: IncidentCustomField = await createField("Impact");

      const withValue: ObjectID = await seedIncident({
        Impact: "High",
        Region: "East",
      });
      const withStaleNewKey: ObjectID = await seedIncident({
        Impact: "Low",
        "Business Impact": "stale",
      });
      const withoutValue: ObjectID = await seedIncident({ Region: "West" });
      const withNoBag: ObjectID = await seedIncident(null);
      const withArrayBag: ObjectID = await seedIncident(["Impact"]);
      const otherProjects: ObjectID = await seedIncident(
        { Impact: "High" },
        otherProjectId,
      );

      const template: ObjectID = await seedTemplate({ Impact: "Medium" });
      const otherProjectsTemplate: ObjectID = await seedTemplate(
        { Impact: "Medium" },
        otherProjectId,
      );

      const incidentsView: ObjectID = await seedTableView({
        tableId: "all-incidents-table",
        columns: { order: ["title", "customFields.Impact"], hidden: [] },
        facets: {
          facetSelections: { "customField:Impact": ["High"] },
          facetOperators: { "customField:Impact": "is" },
        },
      });
      const monitorsView: ObjectID = await seedTableView({
        tableId: "all-monitors-table",
        columns: { order: ["customFields.Impact"], hidden: [] },
      });
      const otherProjectsView: ObjectID = await seedTableView({
        tableId: "all-incidents-table",
        columns: { order: ["customFields.Impact"], hidden: [] },
        project: otherProjectId,
      });

      await IncidentCustomFieldService.updateOneById({
        id: impact.id!,
        data: { name: "Business Impact" },
        props: adminProps(),
      });

      const moved: {
        customFields: unknown;
        version: number;
        updatedAt: Date;
      } = await readRow("Incident", withValue);

      expect(moved.customFields).toEqual({
        "Business Impact": "High",
        Region: "East",
      });
      // Not an edit of the incident: no version bump, updatedAt as it was.
      expect(moved.version).toBe(3);
      expect(new Date(moved.updatedAt).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      // The renamed field's value wins over a stale one under the new name.
      expect((await readRow("Incident", withStaleNewKey)).customFields).toEqual(
        {
          "Business Impact": "Low",
        },
      );
      expect((await readRow("Incident", withoutValue)).customFields).toEqual({
        Region: "West",
      });
      expect((await readRow("Incident", withNoBag)).customFields).toBeNull();
      expect((await readRow("Incident", withArrayBag)).customFields).toEqual([
        "Impact",
      ]);
      expect((await readRow("Incident", otherProjects)).customFields).toEqual({
        Impact: "High",
      });

      expect(
        (await readRow("IncidentTemplate", template)).customFields,
      ).toEqual({ "Business Impact": "Medium" });
      expect(
        (await readRow("IncidentTemplate", otherProjectsTemplate)).customFields,
      ).toEqual({ Impact: "Medium" });

      const view: { columns?: unknown; facets?: unknown; updatedAt: Date } =
        await readRow("TableView", incidentsView);
      expect(view.columns).toEqual({
        order: ["title", "customFields.Business Impact"],
        hidden: [],
      });
      expect(view.facets).toEqual({
        facetSelections: { "customField:Business Impact": ["High"] },
        facetOperators: { "customField:Business Impact": "is" },
      });
      expect(new Date(view.updatedAt).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );

      // A monitors table's field of the same name is a different field.
      expect((await readRow("TableView", monitorsView)).columns).toEqual({
        order: ["customFields.Impact"],
        hidden: [],
      });
      expect((await readRow("TableView", otherProjectsView)).columns).toEqual({
        order: ["customFields.Impact"],
        hidden: [],
      });

      expect(incidentWorkflow).not.toHaveBeenCalled();
      expect(templateWorkflow).not.toHaveBeenCalled();
      expect(tableViewWorkflow).not.toHaveBeenCalled();

      // The key stays what it was made from.
      const stored: IncidentCustomField | null =
        await IncidentCustomFieldService.findOneById({
          id: impact.id!,
          select: { name: true, variableKey: true },
          props: { isRoot: true },
        });
      expect(stored?.name).toBe("Business Impact");
      expect(stored?.variableKey).toBe("impact");
    });

    test("renaming back moves the values back", async () => {
      const impact: IncidentCustomField = await createField("Impact");
      const incident: ObjectID = await seedIncident({ Impact: "High" });

      await IncidentCustomFieldService.updateOneById({
        id: impact.id!,
        data: { name: "Severity" },
        props: adminProps(),
      });
      await IncidentCustomFieldService.updateOneById({
        id: impact.id!,
        data: { name: "Impact" },
        props: adminProps(),
      });

      expect((await readRow("Incident", incident)).customFields).toEqual({
        Impact: "High",
      });
    });

    test("a rename onto another field's name is refused and moves nothing", async () => {
      await createField("Region");
      const impact: IncidentCustomField = await createField("Impact");
      const incident: ObjectID = await seedIncident({
        Impact: "High",
        Region: "East",
      });

      await expect(
        IncidentCustomFieldService.updateOneById({
          id: impact.id!,
          data: { name: " region " },
          props: adminProps(),
        }),
      ).rejects.toThrow("Another incident custom field already has this name.");

      expect((await readRow("Incident", incident)).customFields).toEqual({
        Impact: "High",
        Region: "East",
      });
    });

    test("new fields get unique template keys, and the index refuses a duplicate", async () => {
      const first: IncidentCustomField = await createField(
        "Expected Resolution",
      );
      const second: IncidentCustomField = await createField(
        "expected-resolution",
      );
      const third: IncidentCustomField = await createField("影响");

      const keys: Array<{ name: string; variableKey: string }> =
        await database.query(
          `SELECT "name", "variableKey" FROM "${schema}"."IncidentCustomField" WHERE "_id" = ANY($1::uuid[]) ORDER BY "createdAt"`,
          [[first.id!.toString(), second.id!.toString(), third.id!.toString()]],
        );

      expect(keys).toEqual([
        { name: "Expected Resolution", variableKey: "expected_resolution" },
        { name: "expected-resolution", variableKey: "expected_resolution_2" },
        { name: "影响", variableKey: "field" },
      ]);

      await expect(
        database.query(
          `INSERT INTO "${schema}"."IncidentCustomField" ("_id", "projectId", "name", "variableKey", "version")
         VALUES ($1, $2, 'Sneaky', 'expected_resolution', 1)`,
          [ObjectID.generate().toString(), projectId.toString()],
        ),
      ).rejects.toThrow(/duplicate key value/);

      // The same key in another project is fine.
      await database.query(
        `INSERT INTO "${schema}"."IncidentCustomField" ("_id", "projectId", "name", "variableKey", "version")
       VALUES ($1, $2, 'Expected Resolution', 'expected_resolution', 1)`,
        [ObjectID.generate().toString(), otherProjectId.toString()],
      );
    });

    test("an update cannot change a field's template key", async () => {
      const impact: IncidentCustomField = await createField("Impact");

      await IncidentCustomFieldService.updateOneById({
        id: impact.id!,
        data: { variableKey: "hijacked", description: "Business impact" },
        props: adminProps(),
      });

      const rows: Array<{ variableKey: string; description: string }> =
        await database.query(
          `SELECT "variableKey", "description" FROM "${schema}"."IncidentCustomField" WHERE "_id" = $1`,
          [impact.id!.toString()],
        );

      expect(rows[0]).toEqual({
        variableKey: "impact",
        description: "Business impact",
      });
    });

    test("the migration's backfill keys every existing field, oldest first, once", async () => {
      const seed: (
        name: string,
        project: ObjectID,
        daysAgo: number,
        variableKey?: string,
      ) => Promise<string> = async (
        name: string,
        project: ObjectID,
        daysAgo: number,
        variableKey?: string,
      ): Promise<string> => {
        const id: string = ObjectID.generate().toString();
        await database.query(
          `INSERT INTO "${schema}"."IncidentCustomField" ("_id", "projectId", "name", "variableKey", "createdAt", "version")
         VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval, 1)`,
          [id, project.toString(), name, variableKey ?? null, String(daysAgo)],
        );
        return id;
      };

      const newest: string = await seed("Impact", projectId, 1);
      const oldest: string = await seed("impact!", projectId, 5);
      const keyed: string = await seed("Region", projectId, 3, "impact_2");
      const accented: string = await seed("Größe", projectId, 2);
      const elsewhere: string = await seed("Impact", otherProjectId, 1);

      // Enough rows to span several UPDATE batches.
      const many: Array<string> = [];
      for (let i: number = 0; i < 1200; i++) {
        many.push(await seed(`Field ${i % 3}`, otherProjectId, 10));
      }

      const given: number =
        await backfillIncidentCustomFieldVariableKeys(database);

      expect(given).toBe(4 + 1200);

      const keyOf: (id: string) => Promise<string> = async (
        id: string,
      ): Promise<string> => {
        const rows: Array<{ variableKey: string }> = await database.query(
          `SELECT "variableKey" FROM "${schema}"."IncidentCustomField" WHERE "_id" = $1`,
          [id],
        );
        return rows[0]!.variableKey;
      };

      expect(await keyOf(oldest)).toBe("impact");
      expect(await keyOf(keyed)).toBe("impact_2");
      expect(await keyOf(newest)).toBe("impact_3");
      expect(await keyOf(accented)).toBe("grosse");
      expect(await keyOf(elsewhere)).toBe("impact");

      const manyKeys: Array<{ count: number }> = await database.query(
        `SELECT COUNT(DISTINCT "variableKey")::int AS "count" FROM "${schema}"."IncidentCustomField" WHERE "_id" = ANY($1::uuid[])`,
        [many],
      );
      expect(manyKeys[0]!.count).toBe(1200);

      // A second run finds nothing to do and changes nothing.
      expect(await backfillIncidentCustomFieldVariableKeys(database)).toBe(0);
      expect(await keyOf(newest)).toBe("impact_3");
    });
  },
);
