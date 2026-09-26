import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { DataSource } from "typeorm";

/*
 * Incident status page scope (Incident.statusPages) against a migrated
 * Postgres.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/IncidentStatusPageScopePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 *
 * What it pins down is the promise that deleting a status page never widens
 * an incident's reach. Deletes are hard deletes (DatabaseService deletes rows
 * with a plain DELETE), so an incident's join row to a deleted page goes with
 * the page through the foreign key's ON DELETE CASCADE. isScopedToStatusPages
 * stays true: nothing recomputes it from the join table. An incident whose
 * only scoped page is deleted is therefore scoped to nothing - hidden from
 * every page - rather than unscoped and broadcast to every page its monitors
 * reach. Only an explicit write of the list moves it.
 *
 * Two halves, as in IncidentAlertPostgres.test.ts:
 *
 * - the migrated public tables are inspected as they are: the new columns and
 *   the ON DELETE rule of every foreign key of the two join tables;
 * - behaviour runs in a uniquely named schema holding structure-only clones
 *   of the tables involved. The clones carry the migrated indexes (LIKE ...
 *   INCLUDING ALL), and the join tables' foreign keys are copied from the
 *   migrated tables' own definitions, so a cascade observed here is the
 *   cascade the migration declared. No row is ever written outside that
 *   schema, and the schema is dropped afterwards.
 *
 * The production IncidentService writes the scope through the real hooks,
 * permission checks and join-table save, as a non-root incident member; only
 * the feed, dashboard links, custom field mapping, audit log, realtime and
 * workflow triggers are stubbed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "StatusPage",
  "Incident",
  "IncidentStatusPage",
  "IncidentTemplate",
  "IncidentTemplateStatusPage",
];

const JOIN_TABLES: Array<string> = [
  "IncidentStatusPage",
  "IncidentTemplateStatusPage",
];

interface ForeignKeyRow {
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
  definition: string;
}

describePostgres(
  "Incident status page scope against a migrated Postgres",
  () => {
    const schema: string = `incident_scope_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let migratedForeignKeys: Array<ForeignKeyRow> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_NAME"] ||
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
        [JOIN_TABLES],
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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      jest.spyOn(IncidentService, "onTriggerWorkflow").mockResolvedValue();
      jest.spyOn(IncidentService, "onTriggerRealtime").mockResolvedValue();
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue();
      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example/incident"),
        );
      jest
        .spyOn(StatusPageService, "getStatusPageLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example/status-page"),
        );
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined);
      // Custom field mapping reads definition tables that are not cloned.
      jest
        .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
        .mockResolvedValue(undefined);
      jest
        .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
        .mockReturnValue(undefined);
    });

    beforeEach(async () => {
      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
       VALUES ($1, 'Status page scope test', $2, 1)`,
        [projectId.toString(), `scope-${projectId.toString()}`],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedStatusPage(name: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "version")
       VALUES ($1, $2, $3, $4, 1)`,
        [id.toString(), projectId.toString(), name, `page-${id.toString()}`],
      );
      return id;
    }

    async function seedIncident(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version")
       VALUES ($1, $2, 'Shared uplink down', $3, $4, $5, 1)`,
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

    async function seedTemplate(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentTemplate"
       ("_id", "projectId", "title", "templateName", "templateDescription", "slug", "version")
       VALUES ($1, $2, 'Region East outage', 'Region East outage', 'East sites', $3, 1)`,
        [id.toString(), projectId.toString(), `template-${id.toString()}`],
      );
      return id;
    }

    async function deleteStatusPage(id: ObjectID): Promise<void> {
      // What DatabaseService.deleteBy issues once a delete is permitted.
      await database.query(
        `DELETE FROM "${schema}"."StatusPage" WHERE "_id" = $1`,
        [id.toString()],
      );
    }

    async function scopeRows(incidentId: ObjectID): Promise<Array<string>> {
      const rows: Array<{ statusPageId: string }> = await database.query(
        `SELECT "statusPageId" FROM "${schema}"."IncidentStatusPage" WHERE "incidentId" = $1 ORDER BY "statusPageId"`,
        [incidentId.toString()],
      );
      return rows.map((row: { statusPageId: string }) => {
        return row.statusPageId;
      });
    }

    async function isScoped(incidentId: ObjectID): Promise<boolean> {
      const rows: Array<{ isScopedToStatusPages: boolean }> =
        await database.query(
          `SELECT "isScopedToStatusPages" FROM "${schema}"."Incident" WHERE "_id" = $1`,
          [incidentId.toString()],
        );
      return rows[0]!.isScopedToStatusPages;
    }

    // An incident member who may also read status pages, owning nothing.
    function memberProps(): DatabaseCommonInteractionProps {
      const tenantPermission: UserTenantAccessPermission = {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [
          Permission.IncidentMember,
          Permission.StatusPageViewer,
        ].map((permission: Permission) => {
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

    async function setScope(
      incidentId: ObjectID,
      statusPageIds: Array<ObjectID>,
    ): Promise<void> {
      await IncidentService.updateOneById({
        id: incidentId,
        data: {
          statusPages: statusPageIds.map((id: ObjectID) => {
            const statusPage: StatusPage = new StatusPage();
            statusPage.id = id;
            return statusPage;
          }),
        },
        props: memberProps(),
      });
    }

    function sorted(ids: Array<ObjectID>): Array<string> {
      return ids
        .map((id: ObjectID) => {
          return id.toString();
        })
        .sort();
    }

    describe("the migrated tables", () => {
      test("a scope row goes with its incident or its status page, and so does a template's", () => {
        expect(
          migratedForeignKeys.map((foreignKey: ForeignKeyRow) => {
            return [
              foreignKey.table,
              foreignKey.column,
              foreignKey.referencedTable,
              foreignKey.onDelete,
            ];
          }),
        ).toEqual([
          // confdeltype: c = CASCADE
          ["IncidentStatusPage", "incidentId", "Incident", "c"],
          ["IncidentStatusPage", "statusPageId", "StatusPage", "c"],
          [
            "IncidentTemplateStatusPage",
            "incidentTemplateId",
            "IncidentTemplate",
            "c",
          ],
          ["IncidentTemplateStatusPage", "statusPageId", "StatusPage", "c"],
        ]);
      });

      test("every existing incident starts unscoped, and every status page shows unscoped incidents", async () => {
        const rows: Array<{
          table_name: string;
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }> = await database.query(
          `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND ((table_name = 'Incident' AND column_name IN ('isScopedToStatusPages', 'statusPagesNotifiedOnCreation'))
              OR (table_name = 'StatusPage' AND column_name = 'onlyShowScopedIncidents'))
          ORDER BY table_name, column_name`,
        );

        expect(rows).toEqual([
          {
            table_name: "Incident",
            column_name: "isScopedToStatusPages",
            data_type: "boolean",
            is_nullable: "NO",
            column_default: "false",
          },
          {
            table_name: "Incident",
            column_name: "statusPagesNotifiedOnCreation",
            data_type: "jsonb",
            is_nullable: "YES",
            column_default: null,
          },
          {
            table_name: "StatusPage",
            column_name: "onlyShowScopedIncidents",
            data_type: "boolean",
            is_nullable: "NO",
            column_default: "false",
          },
        ]);
      });

      test("the status page queries can filter on the scope flag by index", async () => {
        const rows: Array<{ indexdef: string }> = await database.query(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Incident' AND indexdef LIKE '%("isScopedToStatusPages")%'`,
        );

        expect(rows).toHaveLength(1);
      });
    });

    describe("an incident member scopes an incident through IncidentService", () => {
      test("the join rows and the flag are written together", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");
        const site07: ObjectID = await seedStatusPage("Site 07");

        expect(await isScoped(incidentId)).toBe(false);

        await setScope(incidentId, [site03, site07]);

        expect(await scopeRows(incidentId)).toEqual(sorted([site03, site07]));
        expect(await isScoped(incidentId)).toBe(true);

        const incident: Incident | null = await IncidentService.findOneById({
          id: incidentId,
          select: {
            isScopedToStatusPages: true,
            statusPages: { _id: true, name: true },
          },
          props: { isRoot: true },
        });

        expect(
          (incident?.statusPages || [])
            .map((page: StatusPage) => {
              return page.name;
            })
            .sort(),
        ).toEqual(["Site 03", "Site 07"]);
        expect(incident?.isScopedToStatusPages).toBe(true);
      });

      test("clearing the list is the way back to unscoped", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");

        await setScope(incidentId, [site03]);
        await setScope(incidentId, []);

        expect(await scopeRows(incidentId)).toEqual([]);
        expect(await isScoped(incidentId)).toBe(false);
      });
    });

    describe("deleting a status page never widens an incident's reach", () => {
      test("deleting one of two scoped pages leaves the incident scoped to the other", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");
        const site07: ObjectID = await seedStatusPage("Site 07");

        await setScope(incidentId, [site03, site07]);
        await deleteStatusPage(site03);

        expect(await scopeRows(incidentId)).toEqual([site07.toString()]);
        expect(await isScoped(incidentId)).toBe(true);
      });

      test("deleting the only scoped page hides the incident instead of broadcasting it", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");
        // A page the incident was never scoped to, which must stay out of reach.
        await seedStatusPage("Site 05");

        await setScope(incidentId, [site03]);
        await deleteStatusPage(site03);

        // The join row went with the page; the flag did not follow it.
        expect(await scopeRows(incidentId)).toEqual([]);
        expect(await isScoped(incidentId)).toBe(true);

        /*
         * As the status page queries will read it: scoped, and to no page -
         * so no page shows it, instead of every page that lists its monitors.
         */
        const incident: Incident | null = await IncidentService.findOneById({
          id: incidentId,
          select: {
            isScopedToStatusPages: true,
            statusPages: { _id: true },
          },
          props: { isRoot: true },
        });

        expect(incident?.isScopedToStatusPages).toBe(true);
        expect(incident?.statusPages || []).toEqual([]);
      });

      test("a later edit that does not touch the scope keeps the incident hidden", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");

        await setScope(incidentId, [site03]);
        await deleteStatusPage(site03);

        await IncidentService.updateOneById({
          id: incidentId,
          data: { title: "Shared uplink down - investigating" },
          props: memberProps(),
        });

        expect(await isScoped(incidentId)).toBe(true);
      });

      test("an unscoped incident stays unscoped when a status page is deleted", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");

        await deleteStatusPage(site03);

        expect(await isScoped(incidentId)).toBe(false);
      });

      test("deleting an incident takes its scope rows, and leaves the status pages", async () => {
        const incidentId: ObjectID = await seedIncident();
        const site03: ObjectID = await seedStatusPage("Site 03");

        await setScope(incidentId, [site03]);
        await database.query(
          `DELETE FROM "${schema}"."Incident" WHERE "_id" = $1`,
          [incidentId.toString()],
        );

        expect(await scopeRows(incidentId)).toEqual([]);
        const pages: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."StatusPage" WHERE "_id" = $1`,
          [site03.toString()],
        );
        expect(pages[0]!.count).toBe("1");
      });

      test("deleting a template's status page takes the template's row with it", async () => {
        const templateId: ObjectID = await seedTemplate();
        const site03: ObjectID = await seedStatusPage("Site 03");
        const site07: ObjectID = await seedStatusPage("Site 07");

        for (const statusPageId of [site03, site07]) {
          await database.query(
            `INSERT INTO "${schema}"."IncidentTemplateStatusPage" ("incidentTemplateId", "statusPageId") VALUES ($1, $2)`,
            [templateId.toString(), statusPageId.toString()],
          );
        }

        await deleteStatusPage(site03);

        const rows: Array<{ statusPageId: string }> = await database.query(
          `SELECT "statusPageId" FROM "${schema}"."IncidentTemplateStatusPage" WHERE "incidentTemplateId" = $1`,
          [templateId.toString()],
        );

        expect(
          rows.map((row: { statusPageId: string }) => {
            return row.statusPageId;
          }),
        ).toEqual([site07.toString()]);
      });
    });
  },
);
