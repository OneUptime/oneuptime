import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentAlertService, {
  AcknowledgeDeclaredAlertsResult,
  AlertsToAcknowledgeOnDeclare,
  LinkAlertsToIncidentResult,
} from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AlertStateChangeAuthorization from "../../../Server/Utils/Alert/AlertStateChangeAuthorization";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_ALREADY_LINKED_MESSAGE,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
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

  /*
   * Declaring an incident from alerts and asking, in the same request, for
   * the alerts to be acknowledged (miscDataProps.acknowledgeAlertsToLink):
   * the real IncidentService.create, the real links, and the real
   * acknowledgement - AlertService.changeAlertState writing an
   * AlertStateTimeline row and moving the alert's current state - against
   * the clones. This block adds clones of the tables that path reads and
   * writes: the alert and incident states, the incident severities, the
   * alert state timeline, and the label / monitor / SLO relations the new
   * incident is re-read with (and the alerts' labels, which the permission
   * check reads). They live in the same schema and are dropped with it.
   *
   * Stubbed, beyond the stubs above: the Redis locks (there is no Redis
   * here), and what surrounds the declaration without being about the
   * alerts' state - the un-awaited onCreateSuccess chain (workspace
   * channels, feeds, rules, SLA, reminders, AI), metrics, custom field
   * mappings, auto-ownership, workflows and realtime.
   */
  describe("declaring an incident from alerts and acknowledging them, through IncidentService", () => {
    const DECLARE_TABLES: Array<string> = [
      "AlertState",
      "AlertStateTimeline",
      "IncidentState",
      "IncidentSeverity",
      "Label",
      "AlertLabel",
      "IncidentLabel",
      "Monitor",
      "IncidentMonitor",
      "ServiceLevelObjective",
      "IncidentServiceLevelObjective",
    ];

    // The create does not wait for the acknowledgement: how long a test does.
    const ACKNOWLEDGEMENT_TIMEOUT_MS: number = 15000;

    const NO_ACKNOWLEDGED_STATE_MESSAGE: string =
      "This project has no Acknowledged alert state, so the alerts cannot be acknowledged. Declare the incident without acknowledging them, or add an Acknowledged state in the alert settings.";

    const NO_PERMISSION_TO_ACKNOWLEDGE_MESSAGE: string =
      "You do not have permission to acknowledge one or more of these alerts. Declare the incident without acknowledging them, or ask a project admin for permission.";

    const PRIVATE_INCIDENT_CAUSE: string =
      "Acknowledged because a private incident was declared from this alert.";

    const NOT_VISIBLE_ALERTS_MESSAGE: string =
      "One or more of the selected alerts do not exist in this project, or you do not have access to them.";

    type AcknowledgeArguments = Parameters<
      typeof IncidentAlertService.acknowledgeAlertsDeclaredWithIncident
    >[0];

    type SyncArguments = Parameters<
      typeof IncidentAlertService.syncAlertWithLinkedIncidentState
    >[0];

    type AlertFeedItem = Parameters<
      typeof AlertFeedService.createAlertFeedItem
    >[0];

    type StateFlag =
      | "isCreatedState"
      | "isAcknowledgedState"
      | "isResolvedState";

    interface ProjectStates {
      created: ObjectID;
      acknowledged: ObjectID;
      resolved: ObjectID;
    }

    interface TimelineRow {
      alertStateId: string;
      createdByUserId: string | null;
      rootCause: string | null;
      isOwnerNotified: boolean;
      startsAt: Date;
      endsAt: Date | null;
    }

    interface IncidentRow {
      _id: string;
      incidentNumber: number | null;
      currentIncidentStateId: string;
      isPrivate: boolean;
    }

    // What validateAcknowledgeAlertsForNewIncident settled, as strings.
    interface CheckedAcknowledgement {
      acknowledgedAlertStateId: string;
      alertIdsToAcknowledge: Array<string>;
    }

    const ownSpies: Array<jest.SpyInstance> = [];

    let alertFeed: jest.SpyInstance;
    let acknowledge: jest.SpyInstance;
    let linksWhenAcknowledging: Array<number> = [];

    let alertStates: ProjectStates;
    let incidentStates: ProjectStates;
    let incidentSeverityId: ObjectID;

    beforeAll(async () => {
      for (const table of DECLARE_TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const own: (spy: jest.SpyInstance) => void = (
        spy: jest.SpyInstance,
      ): void => {
        ownSpies.push(spy);
      };

      // No Redis here, and one request at a time.
      own(
        jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex),
      );
      own(jest.spyOn(Semaphore, "release").mockResolvedValue(undefined));

      own(
        jest
          .spyOn(ProductAnalytics, "captureForUser")
          .mockImplementation((): void => {
            // No analytics in tests.
          }),
      );
      own(
        jest
          .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
          .mockResolvedValue(undefined),
      );

      // Workflows and realtime of every model the declaration writes.
      own(
        jest
          .spyOn(IncidentService, "onTriggerWorkflow")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(IncidentService, "onTriggerRealtime")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AlertService, "onTriggerWorkflow")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AlertService, "onTriggerRealtime")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AlertStateTimelineService, "onTriggerWorkflow")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AlertStateTimelineService, "onTriggerRealtime")
          .mockResolvedValue(undefined),
      );

      // The un-awaited onCreateSuccess chain: none of it moves an alert.
      const incidentInternals: Record<string, () => Promise<void>> =
        IncidentService as unknown as Record<string, () => Promise<void>>;
      for (const method of [
        "handleIncidentWorkspaceOperationsAsync",
        "createIncidentFeedAsync",
        "handleIncidentStateChangeAsync",
        "disableActiveMonitoringIfManualIncident",
        "refreshReminderSchedule",
      ]) {
        own(jest.spyOn(incidentInternals, method).mockResolvedValue(undefined));
      }
      own(
        jest
          .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(false),
      );
      own(
        jest
          .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AutoRemediationRuleEngineService, "applyRulesToIncident")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(IncidentGroupingEngineService, "processIncident")
          .mockResolvedValue({ grouped: false }),
      );
      own(
        jest
          .spyOn(IncidentSlaService, "createSlaForIncident")
          .mockResolvedValue(null),
      );
      own(
        jest
          .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
          .mockResolvedValue(false),
      );
      own(
        jest
          .spyOn(IncidentAlertService, "createDeclaredFromAlertsFeedItem")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(IncidentAlertService, "copyAlertOwnersToIncident")
          .mockResolvedValue({ userIds: [], teamIds: [] }),
      );
      // A member who declares becomes its owner: owner tables are not cloned.
      own(
        jest
          .spyOn(IncidentOwnerUserService, "create")
          .mockResolvedValue(undefined as never),
      );

      // What an alert state change sets off besides the change itself.
      own(
        jest
          .spyOn(AlertService, "refreshAlertMetrics")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(AlertMeasurementValueService, "recomputeForAlert")
          .mockResolvedValue(undefined),
      );
      own(
        jest
          .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
          .mockResolvedValue(undefined),
      );

      // The stub set up for the whole suite: the alerts' feed entries.
      alertFeed = jest.spyOn(AlertFeedService, "createAlertFeedItem");

      /*
       * The real acknowledgement, recording how many links the table held
       * when it started. Its promise is kept by the spy (mock.results), so a
       * test can wait for the un-awaited work to finish.
       */
      const acknowledgeForReal: (
        data: AcknowledgeArguments,
      ) => Promise<AcknowledgeDeclaredAlertsResult> =
        IncidentAlertService.acknowledgeAlertsDeclaredWithIncident.bind(
          IncidentAlertService,
        );
      acknowledge = jest
        .spyOn(IncidentAlertService, "acknowledgeAlertsDeclaredWithIncident")
        .mockImplementation(
          async (
            data: AcknowledgeArguments,
          ): Promise<AcknowledgeDeclaredAlertsResult> => {
            linksWhenAcknowledging.push(await linkCount());
            return acknowledgeForReal(data);
          },
        );
      own(acknowledge);
    });

    beforeEach(async () => {
      await database.query(
        DECLARE_TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        }).join("; "),
      );

      alertFeed.mockClear();
      acknowledge.mockClear();
      linksWhenAcknowledging = [];

      alertStates = {
        created: await seedAlertState("Created", 1, "isCreatedState"),
        acknowledged: await seedAlertState(
          "Acknowledged",
          2,
          "isAcknowledgedState",
        ),
        resolved: await seedAlertState("Resolved", 3, "isResolvedState"),
      };

      incidentStates = {
        created: await seedIncidentState("Identified", 1, "isCreatedState"),
        acknowledged: await seedIncidentState(
          "Acknowledged",
          2,
          "isAcknowledgedState",
        ),
        resolved: await seedIncidentState("Resolved", 3, "isResolvedState"),
      };

      incidentSeverityId = await seedIncidentSeverity();
    });

    afterAll(() => {
      for (const spy of ownSpies) {
        spy.mockRestore();
      }
    });

    async function seedAlertState(
      name: string,
      order: number,
      flag: StateFlag,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."AlertState"
         ("_id", "projectId", "name", "color", "order", "isCreatedState", "isAcknowledgedState", "isResolvedState", "version")
         VALUES ($1, $2, $3, '#6b7280', $4, $5, $6, $7, 1)`,
        [
          id.toString(),
          projectId.toString(),
          name,
          order,
          flag === "isCreatedState",
          flag === "isAcknowledgedState",
          flag === "isResolvedState",
        ],
      );
      return id;
    }

    async function seedIncidentState(
      name: string,
      order: number,
      flag: StateFlag,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentState"
         ("_id", "projectId", "name", "slug", "color", "order", "isCreatedState", "isAcknowledgedState", "isResolvedState", "version")
         VALUES ($1, $2, $3, $4, '#6b7280', $5, $6, $7, $8, 1)`,
        [
          id.toString(),
          projectId.toString(),
          name,
          `${name.toLowerCase()}-${id.toString()}`,
          order,
          flag === "isCreatedState",
          flag === "isAcknowledgedState",
          flag === "isResolvedState",
        ],
      );
      return id;
    }

    async function seedIncidentSeverity(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentSeverity"
         ("_id", "projectId", "name", "slug", "color", "order", "version")
         VALUES ($1, $2, 'Critical', $3, '#dc2626', 1, 1)`,
        [id.toString(), projectId.toString(), `critical-${id.toString()}`],
      );
      return id;
    }

    /*
     * An alert that went through the given states, the last one current:
     * ten minutes apart, the last one starting ten minutes ago, each row
     * ending where the next begins - as AlertStateTimelineService writes
     * them.
     */
    async function seedAlertThrough(
      states: Array<ObjectID>,
      options: { project?: ObjectID; isPrivate?: boolean } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const alertProjectId: ObjectID = options.project || projectId;

      await database.query(
        `INSERT INTO "${schema}"."Alert"
         ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "isPrivate", "version")
         VALUES ($1, $2, 'Checkout p95 latency is high', $3, $4, $5, 1)`,
        [
          id.toString(),
          alertProjectId.toString(),
          states[states.length - 1]!.toString(),
          ObjectID.generate().toString(),
          Boolean(options.isPrivate),
        ],
      );

      const tenMinutes: number = 10 * 60 * 1000;
      const now: number = Date.now();

      for (let index: number = 0; index < states.length; index++) {
        const startsAt: Date = new Date(
          now - (states.length - index) * tenMinutes,
        );
        const endsAt: Date | null =
          index < states.length - 1
            ? new Date(startsAt.getTime() + tenMinutes)
            : null;

        await database.query(
          `INSERT INTO "${schema}"."AlertStateTimeline"
           ("_id", "projectId", "alertId", "alertStateId", "startsAt", "endsAt", "isOwnerNotified", "version")
           VALUES ($1, $2, $3, $4, $5, $6, true, 1)`,
          [
            ObjectID.generate().toString(),
            alertProjectId.toString(),
            id.toString(),
            states[index]!.toString(),
            startsAt,
            endsAt,
          ],
        );
      }

      return id;
    }

    async function currentAlertStateOf(alertId: ObjectID): Promise<string> {
      const rows: Array<{ currentAlertStateId: string }> = await database.query(
        `SELECT "currentAlertStateId" FROM "${schema}"."Alert" WHERE "_id" = $1`,
        [alertId.toString()],
      );
      return rows[0]!.currentAlertStateId;
    }

    async function timelineOf(alertId: ObjectID): Promise<Array<TimelineRow>> {
      return database.query(
        `SELECT "alertStateId", "createdByUserId", "rootCause", "isOwnerNotified", "startsAt", "endsAt"
           FROM "${schema}"."AlertStateTimeline"
          WHERE "alertId" = $1
          ORDER BY "startsAt"`,
        [alertId.toString()],
      );
    }

    async function incidentRows(): Promise<Array<IncidentRow>> {
      return database.query(
        `SELECT "_id", "incidentNumber", "currentIncidentStateId", "isPrivate"
           FROM "${schema}"."Incident"
          ORDER BY "incidentNumber"`,
      );
    }

    async function incidentCounter(): Promise<number> {
      const rows: Array<{ incidentCounter: number | string }> =
        await database.query(
          `SELECT "incidentCounter" FROM "${schema}"."Project" WHERE "_id" = $1`,
          [projectId.toString()],
        );
      return Number(rows[0]!.incidentCounter);
    }

    // Polls, because the create does not wait for the acknowledgement.
    async function waitForAlertState(
      alertId: ObjectID,
      stateId: ObjectID,
    ): Promise<void> {
      const deadline: number = Date.now() + ACKNOWLEDGEMENT_TIMEOUT_MS;
      let current: string = await currentAlertStateOf(alertId);

      while (current !== stateId.toString()) {
        if (Date.now() > deadline) {
          throw new Error(
            `alert ${alertId.toString()} is in state ${current}, not ${stateId.toString()}, ${ACKNOWLEDGEMENT_TIMEOUT_MS}ms after the incident was declared`,
          );
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 50);
        });

        current = await currentAlertStateOf(alertId);
      }
    }

    // The one acknowledgement the declaration started, once it has finished.
    async function acknowledgement(): Promise<AcknowledgeDeclaredAlertsResult> {
      expect(acknowledge).toHaveBeenCalledTimes(1);
      return (await acknowledge.mock.results[0]!
        .value) as AcknowledgeDeclaredAlertsResult;
    }

    function acknowledgementArguments(): AcknowledgeArguments {
      return acknowledge.mock.calls[0]![0] as AcknowledgeArguments;
    }

    function ids(values: Array<ObjectID>): Array<string> {
      return values.map((value: ObjectID): string => {
        return value.toString();
      });
    }

    // The alert feed entries of state changes (links write their own).
    function stateChangeFeedItems(): Array<AlertFeedItem> {
      return alertFeed.mock.calls
        .map((call: Array<unknown>): AlertFeedItem => {
          return call[0] as AlertFeedItem;
        })
        .filter((item: AlertFeedItem): boolean => {
          return (
            item.alertFeedEventType === AlertFeedEventType.AlertStateChanged
          );
        });
    }

    function newIncident(
      options: {
        createdByUserId?: ObjectID;
        isPrivate?: boolean;
        currentIncidentStateId?: ObjectID;
      } = {},
    ): Incident {
      const incident: Incident = new Incident();
      incident.projectId = projectId;
      incident.title = "Checkout is failing";
      incident.incidentSeverityId = incidentSeverityId;

      if (options.createdByUserId) {
        incident.createdByUserId = options.createdByUserId;
      }

      if (options.isPrivate) {
        incident.isPrivate = true;
      }

      if (options.currentIncidentStateId) {
        incident.currentIncidentStateId = options.currentIncidentStateId;
      }

      return incident;
    }

    // miscDataProps of a declaration from these alerts.
    function declaredFrom(
      alertIds: Array<ObjectID>,
      acknowledgeAlerts?: boolean,
    ): JSONObject {
      const miscDataProps: JSONObject = {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: ids(alertIds),
      };

      if (acknowledgeAlerts !== undefined) {
        miscDataProps[INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY] =
          acknowledgeAlerts;
      }

      return miscDataProps;
    }

    // A user of the test project holding exactly these permissions.
    function userProps(
      userId: ObjectID,
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      const tenantPermission: UserTenantAccessPermission = {
        projectId: projectId,
        _type: "UserTenantAccessPermission",
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
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

    /*
     * A responder who can read every alert (Viewer) and declare incidents
     * and link alerts to them (IncidentMember), but may change only the
     * alerts carrying one label (AlertMember scoped to that label).
     */
    function labelScopedMemberProps(
      userId: ObjectID,
      alertLabelId: ObjectID,
    ): DatabaseCommonInteractionProps {
      const props: DatabaseCommonInteractionProps = userProps(userId, [
        Permission.Viewer,
        Permission.IncidentMember,
      ]);

      const tenantPermission: UserTenantAccessPermission =
        props.userTenantAccessPermission![projectId.toString()]!;

      tenantPermission.permissions.push({
        _type: "UserPermission",
        permission: Permission.AlertMember,
        labelIds: [alertLabelId],
        isBlockPermission: false,
        scope: PermissionScope.Labels,
      });

      return props;
    }

    async function seedLabel(name: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Label" ("_id", "projectId", "name", "slug", "color", "version")
         VALUES ($1, $2, $3, $4, '#2563eb', 1)`,
        [
          id.toString(),
          projectId.toString(),
          name,
          `${name.toLowerCase()}-${id.toString()}`,
        ],
      );
      return id;
    }

    async function labelAlert(
      alertId: ObjectID,
      labelId: ObjectID,
    ): Promise<ObjectID> {
      await database.query(
        `INSERT INTO "${schema}"."AlertLabel" ("alertId", "labelId") VALUES ($1, $2)`,
        [alertId.toString(), labelId.toString()],
      );
      return alertId;
    }

    async function validateAcknowledge(
      alertIds: Array<ObjectID>,
      props: DatabaseCommonInteractionProps,
    ): Promise<CheckedAcknowledgement | null> {
      const checked: AlertsToAcknowledgeOnDeclare | null =
        await IncidentAlertService.validateAcknowledgeAlertsForNewIncident({
          projectId: projectId,
          acknowledgeAlerts: true,
          alertIds: alertIds,
          props: props,
        });

      if (!checked) {
        return null;
      }

      return {
        acknowledgedAlertStateId: checked.acknowledgedAlertStateId.toString(),
        alertIdsToAcknowledge: ids(checked.alertIdsToAcknowledge),
      };
    }

    function timelineStates(timeline: Array<TimelineRow>): Array<string> {
      return timeline.map((row: TimelineRow): string => {
        return row.alertStateId;
      });
    }

    test("root declares with acknowledgeAlertsToLink: once linked, the alert is acknowledged as the declaring user", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      const incident: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId }),
        miscDataProps: declaredFrom([alertId], true),
        props: { isRoot: true },
      });

      expect(incident.incidentNumber).toBe(1);
      expect(incident.incidentNumberWithPrefix).toBe("#1");

      await waitForAlertState(alertId, alertStates.acknowledged);

      const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();

      expect(ids(result.acknowledgedAlertIds)).toEqual([alertId.toString()]);
      expect(result.alreadyAcknowledgedAlertIds).toEqual([]);
      expect(result.leftToLinkedAlertSyncAlertIds).toEqual([]);
      expect(result.failed).toEqual([]);

      const args: AcknowledgeArguments = acknowledgementArguments();
      expect(args.projectId.toString()).toBe(projectId.toString());
      expect(args.incidentId.toString()).toBe(incident.id!.toString());
      expect(ids(args.alertIds)).toEqual([alertId.toString()]);
      expect(ids(args.linkedAlertIds)).toEqual([alertId.toString()]);
      expect(String(args.acknowledgedByUserId)).toBe(userId.toString());

      // It started once the link was in the table, which names the user too.
      expect(linksWhenAcknowledging).toEqual([1]);
      expect(await linkRows()).toEqual([
        { _id: expect.any(String), createdByUserId: userId.toString() },
      ]);

      const timeline: Array<TimelineRow> = await timelineOf(alertId);

      expect(
        timeline.map((row: TimelineRow): string => {
          return row.alertStateId;
        }),
      ).toEqual([
        alertStates.created.toString(),
        alertStates.acknowledged.toString(),
      ]);
      expect(timeline[1]).toMatchObject({
        createdByUserId: userId.toString(),
        rootCause:
          "Acknowledged because Incident #1 was declared from this alert.",
        // The owners are told, as when Acknowledge is pressed on the alert.
        isOwnerNotified: false,
        endsAt: null,
      });
      // The Created row now ends where the acknowledgement begins.
      expect(timeline[0]!.endsAt?.getTime()).toBe(
        timeline[1]!.startsAt.getTime(),
      );

      // The alert's feed says who and why.
      const feedItems: Array<AlertFeedItem> = stateChangeFeedItems();
      expect(feedItems).toHaveLength(1);
      expect(feedItems[0]!.alertId.toString()).toBe(alertId.toString());
      expect(String(feedItems[0]!.userId)).toBe(userId.toString());
      expect(String(feedItems[0]!.workspaceNotification?.notifyUserId)).toBe(
        userId.toString(),
      );
      expect(feedItems[0]!.moreInformationInMarkdown).toContain(
        "Acknowledged because Incident #1 was declared from this alert.",
      );

      // The incident itself is left in the state it was declared in.
      expect(await incidentRows()).toEqual([
        {
          _id: incident.id!.toString(),
          incidentNumber: 1,
          currentIncidentStateId: incidentStates.created.toString(),
          isPrivate: false,
        },
      ]);
    });

    test("alerts already acknowledged or resolved are left as they are: only the one still open is handed to the acknowledgement, and acknowledged", async () => {
      await database.query(
        `UPDATE "${schema}"."Project" SET "incidentNumberPrefix" = 'INC-' WHERE "_id" = $1`,
        [projectId.toString()],
      );

      const userId: ObjectID = await seedUser();
      const openAlertId: ObjectID = await seedAlertThrough([
        alertStates.created,
      ]);
      const acknowledgedAlertId: ObjectID = await seedAlertThrough([
        alertStates.created,
        alertStates.acknowledged,
      ]);
      const resolvedAlertId: ObjectID = await seedAlertThrough([
        alertStates.created,
        alertStates.resolved,
      ]);

      const acknowledgedTimeline: Array<TimelineRow> =
        await timelineOf(acknowledgedAlertId);
      const resolvedTimeline: Array<TimelineRow> =
        await timelineOf(resolvedAlertId);

      const incident: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId }),
        miscDataProps: declaredFrom(
          [acknowledgedAlertId, openAlertId, resolvedAlertId],
          true,
        ),
        props: { isRoot: true },
      });

      expect(incident.incidentNumberWithPrefix).toBe("INC-1");

      await waitForAlertState(openAlertId, alertStates.acknowledged);

      const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();

      /*
       * The two already past Created were settled when the declaration was
       * checked: only the open alert is handed on to be written, while all
       * three are passed as linked (the sync decides on those).
       */
      const args: AcknowledgeArguments = acknowledgementArguments();
      expect(ids(args.alertIds)).toEqual([openAlertId.toString()]);
      expect(ids(args.linkedAlertIds)).toEqual([
        acknowledgedAlertId.toString(),
        openAlertId.toString(),
        resolvedAlertId.toString(),
      ]);

      expect(ids(result.acknowledgedAlertIds)).toEqual([
        openAlertId.toString(),
      ]);
      expect(result.alreadyAcknowledgedAlertIds).toEqual([]);
      expect(result.leftToLinkedAlertSyncAlertIds).toEqual([]);
      expect(result.failed).toEqual([]);

      // All three are linked; nothing is moved backwards, or written twice.
      expect(await linkCount()).toBe(3);
      expect(await currentAlertStateOf(acknowledgedAlertId)).toBe(
        alertStates.acknowledged.toString(),
      );
      expect(await currentAlertStateOf(resolvedAlertId)).toBe(
        alertStates.resolved.toString(),
      );
      expect(await timelineOf(acknowledgedAlertId)).toEqual(
        acknowledgedTimeline,
      );
      expect(await timelineOf(resolvedAlertId)).toEqual(resolvedTimeline);

      const openTimeline: Array<TimelineRow> = await timelineOf(openAlertId);
      expect(openTimeline).toHaveLength(2);
      expect(openTimeline[1]).toMatchObject({
        alertStateId: alertStates.acknowledged.toString(),
        createdByUserId: userId.toString(),
        rootCause:
          "Acknowledged because Incident INC-1 was declared from this alert.",
      });

      const feedItems: Array<AlertFeedItem> = stateChangeFeedItems();
      expect(
        feedItems.map((item: AlertFeedItem): string => {
          return item.alertId.toString();
        }),
      ).toEqual([openAlertId.toString()]);
    });

    test("without acknowledgeAlertsToLink (absent or false) the alerts are linked and left in their state", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      const first: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId }),
        miscDataProps: declaredFrom([alertId]),
        props: { isRoot: true },
      });

      const second: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId }),
        miscDataProps: declaredFrom([alertId], false),
        props: { isRoot: true },
      });

      expect(first.incidentNumber).toBe(1);
      expect(second.incidentNumber).toBe(2);

      /*
       * The acknowledgement is started before create() returns (only its
       * result is not waited for), so not having started by now is final.
       */
      expect(acknowledge).not.toHaveBeenCalled();
      expect(await linkCount()).toBe(2);
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );
      expect(await timelineOf(alertId)).toHaveLength(1);
      expect(stateChangeFeedItems()).toEqual([]);
    });

    test("a project without an Acknowledged alert state: the declaration is refused before the incident, its number or its links exist", async () => {
      await database.query(
        `DELETE FROM "${schema}"."AlertState" WHERE "_id" = $1`,
        [alertStates.acknowledged.toString()],
      );

      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      const refusal: unknown = await failureOf(() => {
        return IncidentService.create({
          data: newIncident({ createdByUserId: userId }),
          miscDataProps: declaredFrom([alertId], true),
          props: { isRoot: true },
        });
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(NO_ACKNOWLEDGED_STATE_MESSAGE);

      expect(await incidentRows()).toEqual([]);
      expect(await incidentCounter()).toBe(0);
      expect(await linkCount()).toBe(0);
      expect(acknowledge).not.toHaveBeenCalled();
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );

      // Declared without asking, it goes through - and takes number 1.
      const incident: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId }),
        miscDataProps: declaredFrom([alertId]),
        props: { isRoot: true },
      });

      expect(incident.incidentNumber).toBe(1);
      expect(await linkCount()).toBe(1);
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );
    });

    test("a private incident is not named in the acknowledgement's cause", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      const incident: Incident = await IncidentService.create({
        data: newIncident({ createdByUserId: userId, isPrivate: true }),
        miscDataProps: declaredFrom([alertId], true),
        props: { isRoot: true },
      });

      expect(incident.incidentNumberWithPrefix).toBe("#1");

      await waitForAlertState(alertId, alertStates.acknowledged);

      const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();
      expect(ids(result.acknowledgedAlertIds)).toEqual([alertId.toString()]);

      expect((await incidentRows())[0]!.isPrivate).toBe(true);

      const timeline: Array<TimelineRow> = await timelineOf(alertId);
      expect(timeline).toHaveLength(2);
      expect(timeline[1]).toMatchObject({
        alertStateId: alertStates.acknowledged.toString(),
        createdByUserId: userId.toString(),
        rootCause: PRIVATE_INCIDENT_CAUSE,
      });

      // The feed entry goes to the alert's channels: no incident number.
      const feedItems: Array<AlertFeedItem> = stateChangeFeedItems();
      expect(feedItems).toHaveLength(1);
      expect(feedItems[0]!.moreInformationInMarkdown).toContain(
        PRIVATE_INCIDENT_CAUSE,
      );
      expect(feedItems[0]!.moreInformationInMarkdown).not.toContain("#1");
    });

    test("a member who may acknowledge alerts declares, and the acknowledgement is credited to them", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      const incident: Incident = await IncidentService.create({
        data: newIncident(),
        miscDataProps: declaredFrom([alertId], true),
        props: userProps(userId, [
          Permission.IncidentMember,
          Permission.AlertMember,
        ]),
      });

      expect(incident.incidentNumber).toBe(1);

      await waitForAlertState(alertId, alertStates.acknowledged);

      const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();
      expect(ids(result.acknowledgedAlertIds)).toEqual([alertId.toString()]);
      expect(result.failed).toEqual([]);

      expect(String(acknowledgementArguments().acknowledgedByUserId)).toBe(
        userId.toString(),
      );

      const timeline: Array<TimelineRow> = await timelineOf(alertId);
      expect(timeline).toHaveLength(2);
      expect(timeline[1]).toMatchObject({
        alertStateId: alertStates.acknowledged.toString(),
        createdByUserId: userId.toString(),
        rootCause:
          "Acknowledged because Incident #1 was declared from this alert.",
      });
      expect(await linkRows()).toEqual([
        { _id: expect.any(String), createdByUserId: userId.toString() },
      ]);
    });

    test("a member who may not change alert states is refused before the incident exists", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      // May declare incidents and link alerts, and only read alerts.
      const viewer: DatabaseCommonInteractionProps = userProps(userId, [
        Permission.IncidentMember,
        Permission.AlertViewer,
      ]);

      const refusal: unknown = await failureOf(() => {
        return IncidentService.create({
          data: newIncident(),
          miscDataProps: declaredFrom([alertId], true),
          props: viewer,
        });
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        NO_PERMISSION_TO_ACKNOWLEDGE_MESSAGE,
      );

      expect(await incidentRows()).toEqual([]);
      expect(await incidentCounter()).toBe(0);
      expect(await linkCount()).toBe(0);
      expect(acknowledge).not.toHaveBeenCalled();
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );
      expect(await timelineOf(alertId)).toHaveLength(1);

      // The same declaration without asking to acknowledge is theirs to make.
      const incident: Incident = await IncidentService.create({
        data: newIncident(),
        miscDataProps: declaredFrom([alertId]),
        props: viewer,
      });

      expect(incident.incidentNumber).toBe(1);
      expect(await linkRows()).toEqual([
        { _id: expect.any(String), createdByUserId: userId.toString() },
      ]);
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );
    });

    test("the permission check runs on the real tables: a member's update scope leaves out a private alert they do not own, and another project's alert is never one to acknowledge", async () => {
      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);
      const privateAlertId: ObjectID = await seedAlertThrough(
        [alertStates.created],
        { isPrivate: true },
      );
      const foreignAlertId: ObjectID = await seedAlertThrough(
        [alertStates.created],
        { project: otherProjectId },
      );

      const member: DatabaseCommonInteractionProps = userProps(userId, [
        Permission.IncidentMember,
        Permission.AlertMember,
      ]);

      expect(await validateAcknowledge([alertId], member)).toEqual({
        acknowledgedAlertStateId: alertStates.acknowledged.toString(),
        alertIdsToAcknowledge: [alertId.toString()],
      });

      await expect(
        validateAcknowledge([alertId, privateAlertId], member),
      ).rejects.toThrow(NO_PERMISSION_TO_ACKNOWLEDGE_MESSAGE);

      /*
       * Read for this project only, another project's alert is not found, so
       * it is not one of the alerts to acknowledge: it can never be written.
       */
      expect(
        await validateAcknowledge([alertId, foreignAlertId], member),
      ).toEqual({
        acknowledgedAlertStateId: alertStates.acknowledged.toString(),
        alertIdsToAcknowledge: [alertId.toString()],
      });

      // Declaring from it is refused earlier, while the ids are checked.
      const refusal: unknown = await failureOf(() => {
        return IncidentService.create({
          data: newIncident(),
          miscDataProps: declaredFrom([alertId, foreignAlertId], true),
          props: member,
        });
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(NOT_VISIBLE_ALERTS_MESSAGE);
      expect(await incidentRows()).toEqual([]);
      expect(await incidentCounter()).toBe(0);
      expect(await linkCount()).toBe(0);
      expect(acknowledge).not.toHaveBeenCalled();

      // Root is not asked: the ids were validated before this, as root.
      expect(
        await validateAcknowledge([alertId, privateAlertId], { isRoot: true }),
      ).toEqual({
        acknowledgedAlertStateId: alertStates.acknowledged.toString(),
        alertIdsToAcknowledge: [alertId.toString(), privateAlertId.toString()],
      });

      // Checking writes nothing.
      expect(await timelineOf(privateAlertId)).toHaveLength(1);
      expect(await timelineOf(foreignAlertId)).toHaveLength(1);
      expect(await currentAlertStateOf(alertId)).toBe(
        alertStates.created.toString(),
      );
    });

    test("an incident declared straight into Acknowledged with the project's switch on: the linked-alert sync acknowledges the alert, and the declaration leaves it to the sync", async () => {
      await database.query(
        `UPDATE "${schema}"."Project" SET "acknowledgeLinkedAlertsWhenIncidentAcknowledged" = true WHERE "_id" = $1`,
        [projectId.toString()],
      );

      const userId: ObjectID = await seedUser();
      const alertId: ObjectID = await seedAlertThrough([alertStates.created]);

      /*
       * The suite stubs the sync; this test runs the real one, held until
       * the declaration's own acknowledgement has decided, so the order the
       * two would race in is fixed: the sync always moves the alert last.
       */
      const sync: jest.SpyInstance = jest.spyOn(
        IncidentAlertService,
        "syncAlertWithLinkedIncidentState",
      );
      const syncForReal: (data: SyncArguments) => Promise<void> =
        Object.getPrototypeOf(
          IncidentAlertService,
        ).syncAlertWithLinkedIncidentState.bind(IncidentAlertService);

      // Assigned by the executor, which runs straight away.
      let releaseSync: () => void = (): void => {
        // Replaced below.
      };
      const syncReleased: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          releaseSync = resolve;
        },
      );

      sync.mockClear();
      sync.mockImplementation(async (data: SyncArguments): Promise<void> => {
        await syncReleased;
        return syncForReal(data);
      });

      try {
        const incident: Incident = await IncidentService.create({
          data: newIncident({
            createdByUserId: userId,
            currentIncidentStateId: incidentStates.acknowledged,
          }),
          miscDataProps: declaredFrom([alertId], true),
          props: { isRoot: true },
        });

        expect(incident.currentIncidentStateId?.toString()).toBe(
          incidentStates.acknowledged.toString(),
        );

        const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();

        expect(ids(result.leftToLinkedAlertSyncAlertIds)).toEqual([
          alertId.toString(),
        ]);
        expect(result.acknowledgedAlertIds).toEqual([]);
        expect(result.alreadyAcknowledgedAlertIds).toEqual([]);
        expect(result.failed).toEqual([]);

        // The declaration wrote nothing on the alert.
        expect(await timelineOf(alertId)).toHaveLength(1);
        expect(await currentAlertStateOf(alertId)).toBe(
          alertStates.created.toString(),
        );

        expect(sync).toHaveBeenCalledTimes(1);
        releaseSync();
        await sync.mock.results[0]!.value;

        // The sync moved it, once.
        expect(await currentAlertStateOf(alertId)).toBe(
          alertStates.acknowledged.toString(),
        );

        const timeline: Array<TimelineRow> = await timelineOf(alertId);
        expect(
          timeline.map((row: TimelineRow): string => {
            return row.alertStateId;
          }),
        ).toEqual([
          alertStates.created.toString(),
          alertStates.acknowledged.toString(),
        ]);
        expect(timeline[1]!.rootCause).toBe(
          "Acknowledged because linked Incident #1 was acknowledged.",
        );
        expect(stateChangeFeedItems()).toHaveLength(1);
      } finally {
        releaseSync();
        sync.mockResolvedValue(undefined);
      }
    });

    /*
     * A responder may change only some alerts: a Viewer who is also an
     * AlertMember for one label. Only the alerts that will be written are
     * theirs to be allowed to change - one already resolved is left alone,
     * whatever its label.
     */
    describe("a member who may change only one label's alerts", () => {
      const DECLARED_CAUSE: string =
        "Acknowledged because Incident #1 was declared from this alert.";

      let userId: ObjectID;
      let labelA: ObjectID;
      let labelB: ObjectID;
      let member: DatabaseCommonInteractionProps;

      beforeEach(async () => {
        userId = await seedUser();
        labelA = await seedLabel("Payments");
        labelB = await seedLabel("Search");
        member = labelScopedMemberProps(userId, labelA);
      });

      async function timelineRowCount(): Promise<number> {
        const rows: Array<{ count: string }> = await database.query(
          `SELECT count(*)::text AS "count" FROM "${schema}"."AlertStateTimeline"`,
        );
        return Number(rows[0]!.count);
      }

      // The member's own right to change these alerts' states, on its own.
      function checkMayChange(alertIds: Array<ObjectID>): Promise<void> {
        return AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
          projectId: projectId,
          alertIds: alertIds,
          props: member,
        });
      }

      test("declaring from A1 (label A, Created) and B1 (label B, Resolved) with acknowledgeAlertsToLink goes through, and only A1 is acknowledged", async () => {
        const alertA1: ObjectID = await labelAlert(
          await seedAlertThrough([alertStates.created]),
          labelA,
        );
        const alertB1: ObjectID = await labelAlert(
          await seedAlertThrough([alertStates.created, alertStates.resolved]),
          labelB,
        );

        const resolvedTimeline: Array<TimelineRow> = await timelineOf(alertB1);

        // The member may change A1, and not B1.
        await expect(checkMayChange([alertA1])).resolves.toBeUndefined();
        await expect(checkMayChange([alertB1])).rejects.toThrow(
          NotAuthorizedException,
        );

        // B1 is not one to acknowledge, so it is not checked, nor written.
        expect(await validateAcknowledge([alertA1, alertB1], member)).toEqual({
          acknowledgedAlertStateId: alertStates.acknowledged.toString(),
          alertIdsToAcknowledge: [alertA1.toString()],
        });

        const incident: Incident = await IncidentService.create({
          data: newIncident(),
          miscDataProps: declaredFrom([alertA1, alertB1], true),
          props: member,
        });

        expect(incident.incidentNumber).toBe(1);

        await waitForAlertState(alertA1, alertStates.acknowledged);

        const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();

        expect(ids(result.acknowledgedAlertIds)).toEqual([alertA1.toString()]);
        expect(result.alreadyAcknowledgedAlertIds).toEqual([]);
        expect(result.leftToLinkedAlertSyncAlertIds).toEqual([]);
        expect(result.failed).toEqual([]);

        const args: AcknowledgeArguments = acknowledgementArguments();
        expect(ids(args.alertIds)).toEqual([alertA1.toString()]);
        expect(ids(args.linkedAlertIds)).toEqual([
          alertA1.toString(),
          alertB1.toString(),
        ]);
        expect(String(args.acknowledgedByUserId)).toBe(userId.toString());

        // Both are linked, by the member.
        expect(await linkRows()).toEqual([
          { _id: expect.any(String), createdByUserId: userId.toString() },
          { _id: expect.any(String), createdByUserId: userId.toString() },
        ]);

        const timeline: Array<TimelineRow> = await timelineOf(alertA1);
        expect(timelineStates(timeline)).toEqual([
          alertStates.created.toString(),
          alertStates.acknowledged.toString(),
        ]);
        expect(timeline[1]).toMatchObject({
          createdByUserId: userId.toString(),
          rootCause: DECLARED_CAUSE,
          endsAt: null,
        });

        // B1 is untouched.
        expect(await currentAlertStateOf(alertB1)).toBe(
          alertStates.resolved.toString(),
        );
        expect(await timelineOf(alertB1)).toEqual(resolvedTimeline);

        expect(
          stateChangeFeedItems().map((item: AlertFeedItem): string => {
            return item.alertId.toString();
          }),
        ).toEqual([alertA1.toString()]);
      });

      test("declaring from A1 and B2 (label B, Created) with acknowledgeAlertsToLink is refused before the incident, its number or its links exist", async () => {
        const alertA1: ObjectID = await labelAlert(
          await seedAlertThrough([alertStates.created]),
          labelA,
        );
        const alertB2: ObjectID = await labelAlert(
          await seedAlertThrough([alertStates.created]),
          labelB,
        );

        const refusal: unknown = await failureOf(() => {
          return IncidentService.create({
            data: newIncident(),
            miscDataProps: declaredFrom([alertA1, alertB2], true),
            props: member,
          });
        });

        expect(refusal).toBeInstanceOf(BadDataException);
        expect((refusal as Error).message).toBe(
          NO_PERMISSION_TO_ACKNOWLEDGE_MESSAGE,
        );

        expect(await incidentRows()).toEqual([]);
        expect(await incidentCounter()).toBe(0);
        expect(await linkCount()).toBe(0);
        expect(acknowledge).not.toHaveBeenCalled();

        for (const alertId of [alertA1, alertB2]) {
          expect(await currentAlertStateOf(alertId)).toBe(
            alertStates.created.toString(),
          );
          expect(await timelineOf(alertId)).toHaveLength(1);
        }

        expect(stateChangeFeedItems()).toEqual([]);

        /*
         * Not a refusal to link: declared without asking to acknowledge, the
         * member may declare from both - and it takes number 1.
         */
        const incident: Incident = await IncidentService.create({
          data: newIncident(),
          miscDataProps: declaredFrom([alertA1, alertB2]),
          props: member,
        });

        expect(incident.incidentNumber).toBe(1);
        expect(await linkCount()).toBe(2);
        expect(acknowledge).not.toHaveBeenCalled();
        expect(await currentAlertStateOf(alertA1)).toBe(
          alertStates.created.toString(),
        );
        expect(await currentAlertStateOf(alertB2)).toBe(
          alertStates.created.toString(),
        );
      });

      test("every alert already acknowledged or resolved: the declaration goes through with nothing to acknowledge, even outside the member's labels, and writes no timeline row", async () => {
        const acknowledgedA: ObjectID = await labelAlert(
          await seedAlertThrough([
            alertStates.created,
            alertStates.acknowledged,
          ]),
          labelA,
        );
        const acknowledgedB: ObjectID = await labelAlert(
          await seedAlertThrough([
            alertStates.created,
            alertStates.acknowledged,
          ]),
          labelB,
        );
        const resolvedB: ObjectID = await labelAlert(
          await seedAlertThrough([alertStates.created, alertStates.resolved]),
          labelB,
        );

        const declaredAlertIds: Array<ObjectID> = [
          acknowledgedA,
          acknowledgedB,
          resolvedB,
        ];

        const timelinesBefore: Array<Array<TimelineRow>> = [];
        for (const alertId of declaredAlertIds) {
          timelinesBefore.push(await timelineOf(alertId));
        }

        expect(await timelineRowCount()).toBe(6);

        // The member may not change the label-B alerts.
        await expect(checkMayChange([acknowledgedA])).resolves.toBeUndefined();
        await expect(checkMayChange([acknowledgedB])).rejects.toThrow(
          NotAuthorizedException,
        );
        await expect(checkMayChange([resolvedB])).rejects.toThrow(
          NotAuthorizedException,
        );

        // Nothing to acknowledge, so nothing the member must be allowed.
        expect(await validateAcknowledge(declaredAlertIds, member)).toEqual({
          acknowledgedAlertStateId: alertStates.acknowledged.toString(),
          alertIdsToAcknowledge: [],
        });

        const incident: Incident = await IncidentService.create({
          data: newIncident(),
          miscDataProps: declaredFrom(declaredAlertIds, true),
          props: member,
        });

        expect(incident.incidentNumber).toBe(1);
        expect(await linkCount()).toBe(3);

        /*
         * The acknowledgement is started before create() returns when there
         * is anything to acknowledge, so not having started by now is final.
         */
        expect(acknowledge).not.toHaveBeenCalled();

        expect(await timelineRowCount()).toBe(6);

        for (let index: number = 0; index < declaredAlertIds.length; index++) {
          expect(await timelineOf(declaredAlertIds[index]!)).toEqual(
            timelinesBefore[index],
          );
        }

        expect(await currentAlertStateOf(acknowledgedA)).toBe(
          alertStates.acknowledged.toString(),
        );
        expect(await currentAlertStateOf(acknowledgedB)).toBe(
          alertStates.acknowledged.toString(),
        );
        expect(await currentAlertStateOf(resolvedB)).toBe(
          alertStates.resolved.toString(),
        );
        expect(stateChangeFeedItems()).toEqual([]);
      });
    });

    test("seven alerts declared at once are all acknowledged, five written at a time, each with one new timeline row", async () => {
      const userId: ObjectID = await seedUser();

      const alertIds: Array<ObjectID> = [];
      for (let index: number = 0; index < 7; index++) {
        alertIds.push(await seedAlertThrough([alertStates.created]));
      }

      type ChangeAlertStateArguments = Parameters<
        typeof AlertService.changeAlertState
      >[0];

      // The real state change, recording when each write starts and ends.
      const changeAlertStateForReal: (
        data: ChangeAlertStateArguments,
      ) => Promise<void> = AlertService.changeAlertState.bind(AlertService);

      const events: Array<string> = [];
      let inFlight: number = 0;
      let mostInFlight: number = 0;

      const changeAlertState: jest.SpyInstance = jest
        .spyOn(AlertService, "changeAlertState")
        .mockImplementation(
          async (data: ChangeAlertStateArguments): Promise<void> => {
            events.push(`start ${data.alertId.toString()}`);
            inFlight++;
            mostInFlight = Math.max(mostInFlight, inFlight);

            try {
              return await changeAlertStateForReal(data);
            } finally {
              inFlight--;
              events.push(`end ${data.alertId.toString()}`);
            }
          },
        );

      try {
        const incident: Incident = await IncidentService.create({
          data: newIncident({ createdByUserId: userId }),
          miscDataProps: declaredFrom(alertIds, true),
          props: { isRoot: true },
        });

        expect(incident.incidentNumber).toBe(1);

        const result: AcknowledgeDeclaredAlertsResult = await acknowledgement();

        // All seven, in the order they were declared from.
        expect(ids(result.acknowledgedAlertIds)).toEqual(ids(alertIds));
        expect(result.alreadyAcknowledgedAlertIds).toEqual([]);
        expect(result.leftToLinkedAlertSyncAlertIds).toEqual([]);
        expect(result.failed).toEqual([]);
        expect(ids(acknowledgementArguments().alertIds)).toEqual(ids(alertIds));

        // Five written together, the last two once those five had finished.
        const firstBatch: Array<string> = ids(alertIds.slice(0, 5));
        const secondBatch: Array<string> = ids(alertIds.slice(5));

        function eventsFor(kind: string, batch: Array<string>): Array<string> {
          return batch.map((alertId: string): string => {
            return `${kind} ${alertId}`;
          });
        }

        expect(changeAlertState).toHaveBeenCalledTimes(7);
        expect(mostInFlight).toBe(5);
        expect(events).toHaveLength(14);
        expect(events.slice(0, 5)).toEqual(eventsFor("start", firstBatch));
        expect([...events.slice(5, 10)].sort()).toEqual(
          eventsFor("end", firstBatch).sort(),
        );
        expect(events.slice(10, 12)).toEqual(eventsFor("start", secondBatch));
        expect([...events.slice(12)].sort()).toEqual(
          eventsFor("end", secondBatch).sort(),
        );

        for (const alertId of alertIds) {
          expect(await currentAlertStateOf(alertId)).toBe(
            alertStates.acknowledged.toString(),
          );

          const timeline: Array<TimelineRow> = await timelineOf(alertId);
          expect(timelineStates(timeline)).toEqual([
            alertStates.created.toString(),
            alertStates.acknowledged.toString(),
          ]);
          expect(timeline[1]).toMatchObject({
            createdByUserId: userId.toString(),
            rootCause:
              "Acknowledged because Incident #1 was declared from this alert.",
            endsAt: null,
          });
          expect(timeline[0]!.endsAt?.getTime()).toBe(
            timeline[1]!.startsAt.getTime(),
          );
        }

        // One feed entry per alert, and every alert linked.
        expect(
          stateChangeFeedItems()
            .map((item: AlertFeedItem): string => {
              return item.alertId.toString();
            })
            .sort(),
        ).toEqual([...ids(alertIds)].sort());
        expect(await linkCount()).toBe(7);
      } finally {
        changeAlertState.mockRestore();
      }
    });
  });
});
