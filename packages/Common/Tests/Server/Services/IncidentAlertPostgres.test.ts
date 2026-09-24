import Entities from "../../../Models/DatabaseModels/Index";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentAlertService, {
  LinkAlertsToIncidentResult,
} from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_INCIDENT_ALERT_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INCIDENT_ALERT_TESTS=true \
 *   INCIDENT_ALERT_TEST_DATABASE_HOST=127.0.0.1 \
 *   INCIDENT_ALERT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/IncidentAlertPostgres.test.ts
 *
 * Two halves:
 *
 * - the migrated public."IncidentAlert" is inspected as it is: its unique
 *   index and the ON DELETE rule of every foreign key;
 * - behaviour runs in a uniquely named schema holding structure-only clones
 *   of Project, User, Incident, Alert and IncidentAlert. The clones carry the
 *   migrated indexes (LIKE ... INCLUDING ALL), and IncidentAlert's foreign
 *   keys are copied from the migrated table's own definitions, so a cascade
 *   observed here is the cascade the migration declared. No row is ever
 *   written outside that schema, and the schema is dropped afterwards.
 *
 * The production IncidentAlertService runs against the clones; only feed
 * delivery, dashboard links, realtime and workflow triggers are stubbed.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_INCIDENT_ALERT_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Incident",
  "Alert",
  "IncidentAlert",
];

const UNIQUE_INDEX_NAME: string = "IDX_b836b78cef9ce62e4d8f2cc586";

interface ForeignKeyRow {
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
  definition: string;
}

describePostgres("IncidentAlert against a migrated Postgres", () => {
  const schema: string = `incident_alert_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  let database: DataSource;
  let migratedForeignKeys: Array<ForeignKeyRow> = [];

  let incidentFeed: jest.SpyInstance;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INCIDENT_ALERT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["INCIDENT_ALERT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INCIDENT_ALERT_TEST_DATABASE_NAME"] ||
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
      `SELECT c.conname AS "name",
              a.attname AS "column",
              r.relname AS "referencedTable",
              c.confdeltype AS "onDelete",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE n.nspname = 'public' AND t.relname = 'IncidentAlert' AND c.contype = 'f'
        ORDER BY a.attname`,
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
        `ALTER TABLE "${schema}"."IncidentAlert" ADD CONSTRAINT "${foreignKey.name}" ${definition}`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(IncidentAlertService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentAlertService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/incident"));
    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/alert"));
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined);
    incidentFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);
    // The state sync has its own tests; here it would only read the switches.
    jest
      .spyOn(IncidentAlertService, "syncAlertWithLinkedIncidentState")
      .mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    incidentFeed.mockClear();
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
       VALUES ($1, 'Incident alert link test', $2, 1)`,
      [id.toString(), `incident-alert-${id.toString()}`],
    );
  }

  async function seedUser(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "email", "slug", "version")
       VALUES ($1, $2, $3, 1)`,
      [
        id.toString(),
        `incident-alert-${id.toString()}@example.com`,
        `incident-alert-${id.toString()}`,
      ],
    );
    return id;
  }

  async function seedIncident(
    options: { project?: ObjectID; isPrivate?: boolean } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident"
       ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "isPrivate", "version")
       VALUES ($1, $2, 'Checkout is failing', $3, $4, $5, $6, 1)`,
      [
        id.toString(),
        (options.project || projectId).toString(),
        `incident-${id.toString()}`,
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        Boolean(options.isPrivate),
      ],
    );
    return id;
  }

  async function seedAlert(
    options: { project?: ObjectID; isPrivate?: boolean } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Alert"
       ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "isPrivate", "version")
       VALUES ($1, $2, 'Checkout p95 latency is high', $3, $4, $5, 1)`,
      [
        id.toString(),
        (options.project || projectId).toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        Boolean(options.isPrivate),
      ],
    );
    return id;
  }

  async function insertLink(
    incidentId: ObjectID,
    alertId: ObjectID,
    createdByUserId: ObjectID | null = null,
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."IncidentAlert"
       ("_id", "projectId", "incidentId", "alertId", "createdByUserId", "version")
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [
        id.toString(),
        projectId.toString(),
        incidentId.toString(),
        alertId.toString(),
        createdByUserId ? createdByUserId.toString() : null,
      ],
    );
    return id;
  }

  async function linkRows(): Promise<
    Array<{ _id: string; createdByUserId: string | null }>
  > {
    return database.query(
      `SELECT "_id", "createdByUserId" FROM "${schema}"."IncidentAlert" ORDER BY "createdAt"`,
    );
  }

  async function linkCount(): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT count(*)::text AS "count" FROM "${schema}"."IncidentAlert"`,
    );
    return Number(rows[0]!.count);
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

  describe("the migrated table", () => {
    test("a pair is unique: (incidentId, alertId, projectId) has a unique index", async () => {
      const rows: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'IncidentAlert' AND indexname = $1`,
        [UNIQUE_INDEX_NAME],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.indexdef).toContain("CREATE UNIQUE INDEX");
      expect(rows[0]!.indexdef).toContain(
        '("incidentId", "alertId", "projectId")',
      );
    });

    test("a link goes with its project, incident or alert, and outlives its users", () => {
      expect(
        migratedForeignKeys.map((foreignKey: ForeignKeyRow) => {
          return [
            foreignKey.column,
            foreignKey.referencedTable,
            foreignKey.onDelete,
          ];
        }),
      ).toEqual([
        // confdeltype: c = CASCADE, n = SET NULL
        ["alertId", "Alert", "c"],
        ["createdByUserId", "User", "n"],
        ["deletedByUserId", "User", "n"],
        ["incidentId", "Incident", "c"],
        ["projectId", "Project", "c"],
      ]);
    });

    test("every existing project starts with both switches off", async () => {
      const rows: Array<{ column_name: string; column_default: string }> =
        await database.query(
          `SELECT column_name, column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'Project'
              AND column_name IN ('acknowledgeLinkedAlertsWhenIncidentAcknowledged', 'resolveLinkedAlertsWhenIncidentResolved')
              AND is_nullable = 'NO'
            ORDER BY column_name`,
        );

      expect(rows).toEqual([
        {
          column_name: "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
          column_default: "false",
        },
        {
          column_name: "resolveLinkedAlertsWhenIncidentResolved",
          column_default: "false",
        },
      ]);
    });
  });

  describe("the database keeps a pair unique", () => {
    test("a second row for the same incident and alert is rejected", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();

      await insertLink(incidentId, alertId);

      expect(
        await sqlState(() => {
          return insertLink(incidentId, alertId);
        }),
      ).toBe("23505");
      expect(await linkCount()).toBe(1);
    });

    test("one alert may be linked to several incidents, and one incident to several alerts", async () => {
      const incidentId: ObjectID = await seedIncident();
      const otherIncidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();
      const otherAlertId: ObjectID = await seedAlert();

      await insertLink(incidentId, alertId);
      await insertLink(otherIncidentId, alertId);
      await insertLink(incidentId, otherAlertId);

      expect(await linkCount()).toBe(3);
    });
  });

  describe("deleting either end removes the link", () => {
    test("deleting the alert deletes its links", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();
      const otherAlertId: ObjectID = await seedAlert();
      await insertLink(incidentId, alertId);
      const keptLinkId: ObjectID = await insertLink(incidentId, otherAlertId);

      await database.query(`DELETE FROM "${schema}"."Alert" WHERE "_id" = $1`, [
        alertId.toString(),
      ]);

      expect(
        (await linkRows()).map((row: { _id: string }) => {
          return row._id;
        }),
      ).toEqual([keptLinkId.toString()]);
    });

    test("deleting the incident deletes its links", async () => {
      const incidentId: ObjectID = await seedIncident();
      const otherIncidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();
      await insertLink(incidentId, alertId);
      const keptLinkId: ObjectID = await insertLink(otherIncidentId, alertId);

      await database.query(
        `DELETE FROM "${schema}"."Incident" WHERE "_id" = $1`,
        [incidentId.toString()],
      );

      expect(
        (await linkRows()).map((row: { _id: string }) => {
          return row._id;
        }),
      ).toEqual([keptLinkId.toString()]);
    });

    test("deleting the project deletes its links", async () => {
      await insertLink(await seedIncident(), await seedAlert());

      await database.query(
        `DELETE FROM "${schema}"."Project" WHERE "_id" = $1`,
        [projectId.toString()],
      );

      expect(await linkCount()).toBe(0);
    });

    test("deleting the user who linked it keeps the link and forgets the user", async () => {
      const userId: ObjectID = await seedUser();
      const linkId: ObjectID = await insertLink(
        await seedIncident(),
        await seedAlert(),
        userId,
      );

      expect((await linkRows())[0]!.createdByUserId).toBe(userId.toString());

      await database.query(`DELETE FROM "${schema}"."User" WHERE "_id" = $1`, [
        userId.toString(),
      ]);

      expect(await linkRows()).toEqual([
        { _id: linkId.toString(), createdByUserId: null },
      ]);
    });

    test("a link to an incident or alert that does not exist is rejected", async () => {
      const alertId: ObjectID = await seedAlert();

      expect(
        await sqlState(() => {
          return insertLink(ObjectID.generate(), alertId);
        }),
      ).toBe("23503");
    });
  });

  describe("IncidentAlertService on the real tables", () => {
    function link(incidentId: ObjectID, alertId: ObjectID): IncidentAlert {
      const row: IncidentAlert = new IncidentAlert();
      row.projectId = projectId;
      row.incidentId = incidentId;
      row.alertId = alertId;
      return row;
    }

    test("links an alert, and refuses to link it twice", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();

      await IncidentAlertService.create({
        data: link(incidentId, alertId),
        props: { isRoot: true },
      });

      let duplicate: unknown = null;
      try {
        await IncidentAlertService.create({
          data: link(incidentId, alertId),
          props: { isRoot: true },
        });
      } catch (error) {
        duplicate = error;
      }

      expect(PostgresErrorTranslator.isUniqueViolation(duplicate)).toBe(true);
      expect((duplicate as Error).message).toBe(
        "This alert is already linked to this incident.",
      );
      expect(await linkCount()).toBe(1);
    });

    test("linkAlertsToIncident links new alerts and counts linked ones as done", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();
      const otherAlertId: ObjectID = await seedAlert();
      await insertLink(incidentId, alertId);

      const result: LinkAlertsToIncidentResult =
        await IncidentAlertService.linkAlertsToIncident({
          projectId: projectId,
          incidentId: incidentId,
          alertIds: [alertId, otherAlertId],
          props: { isRoot: true },
        });

      expect(result.linkedAlertIds.map(String)).toEqual([
        otherAlertId.toString(),
      ]);
      expect(result.alreadyLinkedAlertIds.map(String)).toEqual([
        alertId.toString(),
      ]);
      expect(result.failed).toEqual([]);
      expect(await linkCount()).toBe(2);
    });

    test("refuses a link to another project's alert", async () => {
      const incidentId: ObjectID = await seedIncident();
      const foreignAlertId: ObjectID = await seedAlert({
        project: otherProjectId,
      });

      await expect(
        IncidentAlertService.create({
          data: link(incidentId, foreignAlertId),
          props: { isRoot: true },
        }),
      ).rejects.toThrow("belong to a different project");
      expect(await linkCount()).toBe(0);
    });

    test("unlinking deletes the row and reports it on the incident's feed", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();
      const linkId: ObjectID = await insertLink(incidentId, alertId);

      await IncidentAlertService.deleteOneById({
        id: linkId,
        props: { isRoot: true },
      });

      expect(await linkCount()).toBe(0);
      expect(incidentFeed).toHaveBeenCalledTimes(1);
      expect(incidentFeed.mock.calls[0]![0].incidentFeedEventType).toBe(
        IncidentFeedEventType.AlertUnlinked,
      );
    });

    test("a member only sees links whose incident and alert they can both see", async () => {
      const publicIncidentId: ObjectID = await seedIncident();
      const privateIncidentId: ObjectID = await seedIncident({
        isPrivate: true,
      });
      const publicAlertId: ObjectID = await seedAlert();
      const privateAlertId: ObjectID = await seedAlert({ isPrivate: true });

      const visibleLinkId: ObjectID = await insertLink(
        publicIncidentId,
        publicAlertId,
      );
      await insertLink(privateIncidentId, publicAlertId);
      await insertLink(publicIncidentId, privateAlertId);

      const tenantPermission: UserTenantAccessPermission = {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      };
      const memberProps: DatabaseCommonInteractionProps = {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: tenantPermission,
        },
      };

      const visible: Array<IncidentAlert> = await IncidentAlertService.findBy({
        query: {},
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: memberProps,
      });

      expect(
        visible.map((row: IncidentAlert) => {
          return row._id?.toString();
        }),
      ).toEqual([visibleLinkId.toString()]);

      const counted: number = (
        await IncidentAlertService.countBy({
          query: {},
          props: memberProps,
        })
      ).toNumber();

      expect(counted).toBe(1);

      // Root, which bypasses privacy, sees all three.
      const all: Array<IncidentAlert> = await IncidentAlertService.findBy({
        query: {},
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });

      expect(all).toHaveLength(3);
    });
  });
});
