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
import { INCIDENT_ALERT_ALREADY_LINKED_MESSAGE } from "../../../Types/Incident/IncidentAlertLink";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test
 * IncidentAlert link table on migrated Postgres"), right after that job has
 * applied every registered migration to an empty database. The Common test
 * job's Postgres is not migrated, so the suite is skipped there.
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
 * Privacy clauses reference the owner and team tables, which are not cloned:
 * they resolve to the migrated public tables through the search path, where a
 * member with a freshly generated id owns nothing.
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

  // A ProjectMember of the test project, who owns nothing.
  function memberProps(
    userId: ObjectID = ObjectID.generate(),
  ): DatabaseCommonInteractionProps {
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

    return {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: tenantPermission,
      },
    };
  }

  async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error("expected the call to fail");
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
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
      expect(await linkCount()).toBe(1);
    });

    test("two requests racing past the unique-together check: the unique index answers 'already linked'", async () => {
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();

      await IncidentAlertService.create({
        data: link(incidentId, alertId),
        props: { isRoot: true },
      });

      /*
       * The second request's check ran before the first request's insert
       * committed, so it found nothing: the INSERT itself hits the index.
       */
      const uniqueTogetherCheck: jest.SpyInstance = jest
        .spyOn(IncidentAlertService, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

      try {
        const duplicate: unknown = await failureOf(() => {
          return IncidentAlertService.create({
            data: link(incidentId, alertId),
            props: { isRoot: true },
          });
        });

        expect(uniqueTogetherCheck).toHaveBeenCalled();
        expect((duplicate as Error).message).toBe(
          INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
        );
        expect(PostgresErrorTranslator.isUniqueViolation(duplicate)).toBe(true);

        // ...and a bulk link counts it as done, not as a failure.
        const result: LinkAlertsToIncidentResult =
          await IncidentAlertService.linkAlertsToIncident({
            projectId: projectId,
            incidentId: incidentId,
            alertIds: [alertId],
            props: { isRoot: true },
          });

        expect(result.alreadyLinkedAlertIds.map(String)).toEqual([
          alertId.toString(),
        ]);
        expect(result.failed).toEqual([]);
      } finally {
        uniqueTogetherCheck.mockRestore();
      }

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

      const member: DatabaseCommonInteractionProps = memberProps();

      const visible: Array<IncidentAlert> = await IncidentAlertService.findBy({
        query: {},
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: member,
      });

      expect(
        visible.map((row: IncidentAlert) => {
          return row._id?.toString();
        }),
      ).toEqual([visibleLinkId.toString()]);

      const counted: number = (
        await IncidentAlertService.countBy({
          query: {},
          props: member,
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

    /*
     * The queries the two dashboard pages send: an incident's Linked Alerts
     * list ({ incidentId }) and an alert's Linked Incidents list
     * ({ alertId }). Each carries the caller's own filter on the same column
     * the privacy clause narrows, so the two must be ANDed, not replaced.
     */
    test("each page's list shows a member only the links whose other end they can see", async () => {
      const publicIncidentId: ObjectID = await seedIncident();
      const privateIncidentId: ObjectID = await seedIncident({
        isPrivate: true,
      });
      const otherIncidentId: ObjectID = await seedIncident();
      const publicAlertId: ObjectID = await seedAlert();
      const privateAlertId: ObjectID = await seedAlert({ isPrivate: true });
      const otherAlertId: ObjectID = await seedAlert();

      const visibleLinkId: ObjectID = await insertLink(
        publicIncidentId,
        publicAlertId,
      );
      await insertLink(publicIncidentId, privateAlertId);
      await insertLink(privateIncidentId, publicAlertId);
      // Links of other records, which neither page may show.
      await insertLink(otherIncidentId, otherAlertId);

      const member: DatabaseCommonInteractionProps = memberProps();

      async function listed(
        query: Record<string, ObjectID>,
        props: DatabaseCommonInteractionProps,
      ): Promise<Array<string>> {
        const rows: Array<IncidentAlert> = await IncidentAlertService.findBy({
          query: { ...query, projectId: projectId },
          select: { _id: true },
          limit: 10,
          skip: 0,
          props: props,
        });

        return rows.map((row: IncidentAlert) => {
          return row._id!.toString();
        });
      }

      async function counted(
        query: Record<string, ObjectID>,
        props: DatabaseCommonInteractionProps,
      ): Promise<number> {
        return (
          await IncidentAlertService.countBy({
            query: { ...query, projectId: projectId },
            props: props,
          })
        ).toNumber();
      }

      // The incident's Linked Alerts: the private alert's link is hidden.
      expect(await listed({ incidentId: publicIncidentId }, member)).toEqual([
        visibleLinkId.toString(),
      ]);
      expect(await counted({ incidentId: publicIncidentId }, member)).toBe(1);

      // The alert's Linked Incidents: the private incident's link is hidden.
      expect(await listed({ alertId: publicAlertId }, member)).toEqual([
        visibleLinkId.toString(),
      ]);
      expect(await counted({ alertId: publicAlertId }, member)).toBe(1);

      // A private end's own page shows the member nothing.
      expect(await listed({ incidentId: privateIncidentId }, member)).toEqual(
        [],
      );
      expect(await listed({ alertId: privateAlertId }, member)).toEqual([]);

      // Root sees both links on each page.
      expect(
        await counted({ incidentId: publicIncidentId }, { isRoot: true }),
      ).toBe(2);
      expect(await counted({ alertId: publicAlertId }, { isRoot: true })).toBe(
        2,
      );
    });
  });

  describe("a project member linking through the service", () => {
    function link(incidentId: ObjectID, alertId: ObjectID): IncidentAlert {
      const row: IncidentAlert = new IncidentAlert();
      row.incidentId = incidentId;
      row.alertId = alertId;
      return row;
    }

    test("a member links a pair they can see, and is recorded as the one who linked it", async () => {
      const userId: ObjectID = await seedUser();
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();

      await IncidentAlertService.create({
        data: link(incidentId, alertId),
        props: memberProps(userId),
      });

      const rows: Array<{
        projectId: string;
        incidentId: string;
        alertId: string;
        createdByUserId: string | null;
      }> = await database.query(
        `SELECT "projectId", "incidentId", "alertId", "createdByUserId" FROM "${schema}"."IncidentAlert"`,
      );

      expect(rows).toEqual([
        {
          projectId: projectId.toString(),
          incidentId: incidentId.toString(),
          alertId: alertId.toString(),
          createdByUserId: userId.toString(),
        },
      ]);

      // The incident's entry names the member.
      expect(incidentFeed).toHaveBeenCalledTimes(1);
      expect(String(incidentFeed.mock.calls[0]![0].userId)).toBe(
        userId.toString(),
      );
    });

    test("a member linking the same pair twice is told it is already linked", async () => {
      const userId: ObjectID = await seedUser();
      const incidentId: ObjectID = await seedIncident();
      const alertId: ObjectID = await seedAlert();

      await IncidentAlertService.create({
        data: link(incidentId, alertId),
        props: memberProps(userId),
      });

      const duplicate: unknown = await failureOf(() => {
        return IncidentAlertService.create({
          data: link(incidentId, alertId),
          props: memberProps(userId),
        });
      });

      expect((duplicate as Error).message).toBe(
        INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
      );
      expect(await linkCount()).toBe(1);
    });

    test("a member cannot link a private alert they do not own", async () => {
      const userId: ObjectID = await seedUser();
      const incidentId: ObjectID = await seedIncident();
      const privateAlertId: ObjectID = await seedAlert({ isPrivate: true });

      await expect(
        IncidentAlertService.create({
          data: link(incidentId, privateAlertId),
          props: memberProps(userId),
        }),
      ).rejects.toThrow(
        "The alert to link does not exist in this project, or you do not have access to it.",
      );
      expect(await linkCount()).toBe(0);
      expect(incidentFeed).not.toHaveBeenCalled();
    });

    test("a member cannot link to a private incident they do not own", async () => {
      const userId: ObjectID = await seedUser();
      const privateIncidentId: ObjectID = await seedIncident({
        isPrivate: true,
      });
      const alertId: ObjectID = await seedAlert();

      await expect(
        IncidentAlertService.create({
          data: link(privateIncidentId, alertId),
          props: memberProps(userId),
        }),
      ).rejects.toThrow(
        "The incident to link does not exist in this project, or you do not have access to it.",
      );
      expect(await linkCount()).toBe(0);
    });

    test("a member cannot link another project's alert, and is not told it exists", async () => {
      const userId: ObjectID = await seedUser();
      const incidentId: ObjectID = await seedIncident();
      const foreignAlertId: ObjectID = await seedAlert({
        project: otherProjectId,
      });

      await expect(
        IncidentAlertService.create({
          data: link(incidentId, foreignAlertId),
          props: memberProps(userId),
        }),
      ).rejects.toThrow(
        "The alert to link does not exist in this project, or you do not have access to it.",
      );
      expect(await linkCount()).toBe(0);
    });
  });
});
