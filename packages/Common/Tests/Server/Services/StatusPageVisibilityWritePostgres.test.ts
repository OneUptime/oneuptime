import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import { VISIBLE_UNLESS_PRIVATE_SQL } from "../../../Server/Utils/StatusPage/StatusPageVisibilityQuery";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Visible on Status Page, written on, is stored on only while the incident
 * or episode is not private - decided by Postgres in the row's own write,
 * on the row as it is when the write reaches it (getRowWriteSql), and handed
 * back by that write. Against a migrated Postgres, through the production
 * IncidentService and IncidentEpisodeService:
 *
 *   - the expression itself, on every value Private can hold;
 *   - one write to many incidents shows those that are not private;
 *   - a privacy change that commits while the write waits for the row
 *     (holding its lock) is not overtaken: the incident is stored hidden,
 *     never both private and visible, and its workflow trigger and images
 *     are told so.
 *
 * Opt in with RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS=true \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_STATUS_PAGE_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/StatusPageVisibilityWritePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml with the other
 * incident status page scope tests. The tables written are cloned, structure
 * only (LIKE ... INCLUDING ALL), into a uniquely named schema that
 * search_path puts first; no row is written outside it, and it is dropped
 * afterwards. Feeds, dashboard links, custom field mapping, the audit log,
 * realtime events and workflow triggers are stubbed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INCIDENT_STATUS_PAGE_SCOPE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "File",
  "Incident",
  "IncidentEpisode",
  "IncidentPublicNote",
  "IncidentEpisodePublicNote",
];

describePostgres(
  "Visible on Status Page is decided in each row's own write, against a migrated Postgres",
  () => {
    const schema: string = `visibility_write_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();

    let database: DataSource;

    // What each update's workflow trigger was told, by record id.
    const workflowFields: Map<string, Record<string, unknown>> = new Map();

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

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const service of [IncidentService, IncidentEpisodeService]) {
        jest
          .spyOn(service, "onTriggerWorkflow")
          .mockImplementation(
            async (
              id: ObjectID,
              _tenantId: ObjectID,
              _trigger: string,
              data?: { updatedFields?: unknown },
            ): Promise<void> => {
              workflowFields.set(
                id.toString(),
                (data?.updatedFields || {}) as Record<string, unknown>,
              );
            },
          );
        jest.spyOn(service, "onTriggerRealtime").mockResolvedValue();
      }

      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue();
      jest
        .spyOn(IncidentService, "getIncidentLinkInDashboard")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example/incident"),
        );
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined);
      jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined);
      jest
        .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
        .mockResolvedValue(undefined);
      jest
        .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
        .mockReturnValue(undefined);
      // Not what this is about; Redis is not there.
      jest
        .spyOn(StatusPageOverviewCache, "forgetProjects")
        .mockResolvedValue(undefined);
    });

    beforeEach(async () => {
      workflowFields.clear();

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version")
       VALUES ($1, 'Visibility write test', $2, 1)`,
        [projectId.toString(), `visibility-${projectId.toString()}`],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedIncident(data: {
      isPrivate: boolean | null;
      description?: string;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version", "isVisibleOnStatusPage", "isPrivate", "description")
       VALUES ($1, $2, 'Checkout errors', $3, $4, $5, 1, false, $6, $7)`,
        [
          id.toString(),
          projectId.toString(),
          `incident-${id.toString()}`,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          data.isPrivate,
          data.description || null,
        ],
      );
      return id;
    }

    async function seedEpisode(isPrivate: boolean): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentEpisode"
       ("_id", "projectId", "title", "currentIncidentStateId", "version", "isVisibleOnStatusPage", "isPrivate")
       VALUES ($1, $2, 'Checkout errors', $3, 1, false, $4)`,
        [
          id.toString(),
          projectId.toString(),
          ObjectID.generate().toString(),
          isPrivate,
        ],
      );
      return id;
    }

    async function switchesOf(
      table: string,
      id: ObjectID,
    ): Promise<{ isVisibleOnStatusPage: boolean; isPrivate: boolean | null }> {
      const rows: Array<{
        isVisibleOnStatusPage: boolean;
        isPrivate: boolean | null;
      }> = await database.query(
        `SELECT "isVisibleOnStatusPage", "isPrivate" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    test("the expression stores the switch on only while the row is not private", async () => {
      for (const [isPrivate, stored] of [
        [false, true],
        [null, true],
        [true, false],
      ] as Array<[boolean | null, boolean]>) {
        const id: ObjectID = await seedIncident({ isPrivate });

        const result: Array<{ isVisibleOnStatusPage: boolean }> =
          await database.query(
            `WITH "written" AS (UPDATE "${schema}"."Incident" SET "isVisibleOnStatusPage" = ${VISIBLE_UNLESS_PRIVATE_SQL} WHERE "_id" = $1 RETURNING "isVisibleOnStatusPage") SELECT "isVisibleOnStatusPage" FROM "written"`,
            [id.toString()],
          );

        expect(result).toEqual([{ isVisibleOnStatusPage: stored }]);
      }
    });

    test("one write to many incidents shows the ones that are not private, and leaves each private one hidden", async () => {
      const privateId: ObjectID = await seedIncident({ isPrivate: true });
      const publicId: ObjectID = await seedIncident({ isPrivate: false });
      const neverSetId: ObjectID = await seedIncident({ isPrivate: null });

      const updated: number = await IncidentService.updateBy({
        query: { projectId: projectId },
        data: { isVisibleOnStatusPage: true },
        limit: new PositiveNumber(100),
        skip: new PositiveNumber(0),
        props: { isRoot: true, tenantId: projectId },
      });

      expect(updated).toBe(3);
      expect(await switchesOf("Incident", privateId)).toEqual({
        isVisibleOnStatusPage: false,
        isPrivate: true,
      });
      expect(await switchesOf("Incident", publicId)).toEqual({
        isVisibleOnStatusPage: true,
        isPrivate: false,
      });
      expect(await switchesOf("Incident", neverSetId)).toEqual({
        isVisibleOnStatusPage: true,
        isPrivate: null,
      });

      // Each workflow is told what was stored.
      expect(
        workflowFields.get(publicId.toString())?.["isVisibleOnStatusPage"],
      ).toBe(true);
      expect(
        workflowFields.get(privateId.toString())?.["isVisibleOnStatusPage"],
      ).not.toBe(true);
    });

    test("an episode the same way", async () => {
      const privateId: ObjectID = await seedEpisode(true);
      const publicId: ObjectID = await seedEpisode(false);

      await IncidentEpisodeService.updateBy({
        query: { projectId: projectId },
        data: { isVisibleOnStatusPage: true },
        limit: new PositiveNumber(100),
        skip: new PositiveNumber(0),
        props: { isRoot: true, tenantId: projectId },
      });

      expect(await switchesOf("IncidentEpisode", privateId)).toEqual({
        isVisibleOnStatusPage: false,
        isPrivate: true,
      });
      expect(await switchesOf("IncidentEpisode", publicId)).toEqual({
        isVisibleOnStatusPage: true,
        isPrivate: false,
      });
    });

    test("a privacy change that commits while the write waits for the row is not overtaken", async () => {
      const imageToken: string = `${ObjectID.generate()
        .toString()
        .replace(/-/g, "")}${ObjectID.generate().toString().replace(/-/g, "")}`;
      const id: ObjectID = await seedIncident({
        isPrivate: false,
        description: `![shot](https://oneuptime.example/file/image/access-token/${imageToken})`,
      });

      const asked: Array<string> = [];
      jest
        .spyOn(PublishedImages, "setImagesVisibility")
        .mockImplementation(
          async (data: {
            publish: Iterable<string>;
            unpublish: Iterable<string>;
          }): Promise<void> => {
            for (const token of data.publish) {
              asked.push(`${token}:public`);
            }
            for (const token of data.unpublish) {
              asked.push(`${token}:private`);
            }
          },
        );

      // Another writer makes it private and holds the row until it commits.
      const other: QueryRunner = database.createQueryRunner();
      await other.connect();
      await other.startTransaction();
      await other.query(
        `UPDATE "${schema}"."Incident" SET "isPrivate" = true, "isVisibleOnStatusPage" = false WHERE "_id" = $1`,
        [id.toString()],
      );

      // The update reads the incident as not private, then waits for its row.
      const written: Promise<number> = IncidentService.updateOneById({
        id: id,
        data: { isVisibleOnStatusPage: true },
        props: { isRoot: true, tenantId: projectId },
      });

      let waiting: number = 0;

      for (let attempt: number = 0; attempt < 200 && waiting === 0; attempt++) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 25);
        });

        const rows: Array<{ waiting: string }> = await database.query(
          `SELECT count(*) AS "waiting" FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE %' AND query LIKE '%"${schema}"."Incident"%'`,
        );
        waiting = Number(rows[0]!.waiting);
      }

      expect(waiting).toBe(1);

      await other.commitTransaction();
      await other.release();

      await written;

      // Never both private and visible.
      expect(await switchesOf("Incident", id)).toEqual({
        isVisibleOnStatusPage: false,
        isPrivate: true,
      });

      // Told as stored, and its image is not made public.
      expect(
        workflowFields.get(id.toString())?.["isVisibleOnStatusPage"],
      ).not.toBe(true);
      expect(asked).not.toContain(`${imageToken}:public`);
    });
  },
);
