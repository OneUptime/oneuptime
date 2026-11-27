import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import { DataSource } from "typeorm";
import Entities from "../../../../Models/DatabaseModels/Index";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import ResourceAiAgent from "../../../../Models/DatabaseModels/ResourceAiAgent";
import Queue from "../../../../Server/Infrastructure/Queue";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DataDataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataWarehouseJobService from "../../../../Server/Services/DataWarehouseJobService";
import DataObservabilityStoreSettings, {
  CONNECTION_CHANGE_REFUSAL,
  DATA_OBSERVABILITY_FOUND_FROM,
  DELETE_REFUSAL,
} from "../../../../Server/Utils/DataObservability/DataObservabilityStoreSettings";
import DataObservabilityAgentCollect, {
  claimDueTableHealthStoresForAgent,
} from "../../../../Server/Utils/DataObservability/DataObservabilityAgentCollect";
import DataObservabilityRunner from "../../../../Server/Utils/DataObservability/DataObservabilityRunner";
import { claimDueTableHealthStoresForProbe } from "../../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import DataSourceSuggestions from "../../../../Server/Utils/DataObservability/DataSourceSuggestions";
import TableHealthIngest from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import DataCheckIngest from "../../../../Server/Utils/DataObservability/DataCheckIngest";
import DataSecurityIssueAlerts from "../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import { DATA_OBSERVABILITY_COLLECT_STORE_JOB } from "../../../../Server/Utils/DataObservability/DataObservabilityJobs";
import logger from "../../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataObservabilityAgentState,
  DataObservabilityCollector,
  DataObservabilitySourceOrigin,
  DataObservabilitySourceSuggestion,
  DataObservabilityStoreRefusal,
  DataObservabilityStoreSettings as StoreSettings,
  DataObservabilityStoreSummary,
} from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../../Types/DataSecurity/DataStoreKind";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import UserType from "../../../../Types/UserType";
import {
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentWork,
} from "../../../../Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";

/*
 * A DATABASE'S WHOLE LIFE IN DATA OBSERVABILITY, AGAINST A MIGRATED
 * POSTGRES (#11147, #11148).
 *
 * With the production services, hooks and permission layer running, on
 * clones of the migrated tables with the foreign keys the migrations
 * declare - so a cascade seen here is the one production runs:
 *
 *   - a database's settings say how it is reached, never its connection
 *     string, what else uses it, and what the caller may do;
 *   - renaming it and changing how it is reached; the connection Data
 *     Security samples with changes only for someone who may edit Data
 *     Security's stores, through Data Security's own path, while a Database
 *     Agent leaves it as it is for anyone who may connect a database;
 *   - Remove from Data Observability takes its tables, their checks and its
 *     warehouse jobs, and leaves Data Security's store, connection, issues
 *     and findings; the database leaves the list, comes back as a
 *     suggestion, and is connected again keeping its saved connection;
 *   - Delete: Data Observability's to make for a database it added that
 *     Data Security holds nothing of; refused to someone who may only use
 *     Data Observability while Data Security relies on it, and made through
 *     Data Security's delete by someone who may;
 *   - a Database Agent is handed only its own server's due databases, as
 *     typed work with no statement, and heard only about them; the workers
 *     and the probes leave its databases alone.
 *
 * Opt in with RUN_POSTGRES_DATA_OBSERVABILITY_LIFECYCLE_TESTS=true against
 * a Postgres migrated to the current head (CI: the Postgres Schema Drift
 * workflow's database after its drift check). Credentials come from
 * DATABASE_USERNAME / DATABASE_PASSWORD, the database from DATABASE_NAME,
 * the endpoint from DATA_OBSERVABILITY_LIFECYCLE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400). The tables are cloned into a unique schema and
 * dropped afterwards. Only the audit log (ClickHouse), the job queue and the
 * workflow and realtime side effects are stood in for.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DATA_OBSERVABILITY_LIFECYCLE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "User",
  "Probe",
  "DatabaseServer",
  "ResourceAiAgent",
  "Monitor",
  "DataObservabilitySetting",
  "DataStore",
  "DataStoreLabel",
  "DataAsset",
  "DataAssetFeed",
  "DataAssetLineage",
  "DataCheck",
  "DataReconciliation",
  "DataAlert",
  "DataWarehouseJob",
  "DataSecurityIssue",
  "DataSecurityScan",
  "DataStoreFinding",
  "DataStoreOwnerUser",
  "DataStoreOwnerTeam",
  "DataStoreAccess",
  "DataStoreFeed",
];

const REFERENCES_PUBLIC: RegExp = /REFERENCES (?:public\.)?/;
const DASHES: RegExp = /-/g;

interface ForeignKeyRow {
  table: string;
  name: string;
  referencedTable: string;
  definition: string;
}

describePostgres(
  "A database's life in Data Observability, against Postgres",
  () => {
    const schema: string = `data_observability_lifecycle_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const probeId: ObjectID = ObjectID.generate();
    const serverId: ObjectID = ObjectID.generate();
    const otherServerId: ObjectID = ObjectID.generate();
    const mysqlServerId: ObjectID = ObjectID.generate();
    const agentId: ObjectID = ObjectID.generate();
    let queued: Array<unknown> = [];

    function propsWith(
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      return {
        tenantId: projectId,
        userId,
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId,
            permissions: permissions.map((permission: Permission) => {
              return {
                _type: "UserPermission",
                permission,
                labelIds: [],
                isBlockPermission: false,
              };
            }),
          },
        },
      } as unknown as DatabaseCommonInteractionProps;
    }

    // Someone who may use Data Observability and nothing else.
    const DATA_OBSERVABILITY_ADMIN: () => DatabaseCommonInteractionProps =
      () => {
        return propsWith([Permission.DataObservabilityAdmin]);
      };
    // Someone who may also edit and delete Data Security's stores.
    const BOTH_ADMIN: () => DatabaseCommonInteractionProps = () => {
      return propsWith([
        Permission.DataObservabilityAdmin,
        Permission.SecurityAdmin,
      ]);
    };
    const DATA_OBSERVABILITY_VIEWER: () => DatabaseCommonInteractionProps =
      () => {
        return propsWith([Permission.DataObservabilityViewer]);
      };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["DATA_OBSERVABILITY_LIFECYCLE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["DATA_OBSERVABILITY_LIFECYCLE_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database: process.env["DATABASE_NAME"] || "oneuptimedb",
        entities: Entities,
        synchronize: false,
        logging: ["error"],
        // Unqualified names: the clones first, the migrated (empty) tables for any other join.
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const foreignKeys: Array<ForeignKeyRow> = await database.query(
        `SELECT t.relname AS "table", c.conname AS "name", r.relname AS "referencedTable",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
        WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'
        ORDER BY t.relname, c.conname`,
        [TABLES],
      );

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // Only the keys between cloned tables; User holds no rows.
      for (const foreignKey of foreignKeys) {
        if (
          !TABLES.includes(foreignKey.referencedTable) ||
          foreignKey.referencedTable === "User"
        ) {
          continue;
        }

        await database.query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            REFERENCES_PUBLIC,
            "REFERENCES ",
          )}`,
        );
      }

      // A fixture names only what a statement reads; keys stay NOT NULL.
      const columns: Array<{ table_name: string; column_name: string }> =
        await database.query(
          `SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.is_nullable = 'NO' AND c.column_name <> '_id'
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.key_column_usage k
             JOIN information_schema.table_constraints tc
               ON tc.constraint_name = k.constraint_name AND tc.table_schema = k.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_schema = c.table_schema
               AND k.table_name = c.table_name AND k.column_name = c.column_name
           )`,
          [schema],
        );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);
      jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
      jest.spyOn(AuditLogService, "recordDelete").mockResolvedValue(undefined);
      queued = [];
      // Only the table health collections a change asks the workers for.
      jest.spyOn(Queue, "addJob").mockImplementation((async (
        ...args: Array<unknown>
      ) => {
        if (args[2] === DATA_OBSERVABILITY_COLLECT_STORE_JOB) {
          queued.push(args);
        }
      }) as never);
      jest
        .spyOn(DataSecurityIssueAlerts, "resolveForClosedIssues")
        .mockResolvedValue(undefined as never);

      for (const service of [
        DataStoreService,
        DataAssetService,
        DataAlertService,
        DataWarehouseJobService,
      ] as Array<unknown>) {
        jest
          .spyOn(
            service as { onTriggerWorkflow: () => Promise<void> },
            "onTriggerWorkflow",
          )
          .mockResolvedValue(undefined);
        jest
          .spyOn(
            service as { onTriggerRealtime: () => Promise<void> },
            "onTriggerRealtime",
          )
          .mockResolvedValue(undefined);
      }

      for (const table of [...TABLES].reverse()) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      for (const id of [projectId, otherProjectId]) {
        await database.query(
          `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, false, now(), now(), 1)`,
          [id.toString(), `Project ${id.toString()}`],
        );
      }

      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, 'Network probe', false, now(), now(), 1)`,
        [probeId.toString(), projectId.toString()],
      );

      for (const server of [
        {
          id: serverId,
          project: projectId,
          name: "orders-db",
          system: "postgresql",
        },
        {
          id: otherServerId,
          project: projectId,
          name: "billing-db",
          system: "postgresql",
        },
        {
          id: mysqlServerId,
          project: projectId,
          name: "shop-db",
          system: "mysql",
        },
      ]) {
        await database.query(
          `INSERT INTO "${schema}"."DatabaseServer" ("_id", "projectId", "name", "slug", "dbSystem", "isArchived", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, $3, $4, false, now(), now(), 1)`,
          [
            server.id.toString(),
            server.project.toString(),
            server.name,
            server.system,
          ],
        );
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    let storeCount: number = 0;

    async function insertStore(
      data: {
        kind?: DataStoreKind;
        foundFrom?: string;
        createdByUserId?: ObjectID | null;
        contentScan?: boolean;
        scanProbe?: ObjectID | null;
        probeVariable?: string | null;
        agentServer?: ObjectID | null;
        agentDatabase?: string | null;
        tableHealth?: boolean;
        removedAt?: Date | null;
        next?: Date | null;
        project?: ObjectID;
        findingCount?: number;
        purpose?: string | null;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      storeCount++;

      await database.query(
        `INSERT INTO "${schema}"."DataStore"
        ("_id", "projectId", "name", "storeKey", "kind", "provider", "family", "discoveredFrom", "createdByUserId",
         "isContentScanEnabled", "isTableHealthEnabled", "isArchived", "scanProbeId", "probeConnectionVariable",
         "tableHealthDatabaseServerId", "tableHealthDatabaseName", "tableHealthRemovedAt", "nextTableHealthCollectionAt",
         "findingCount", "openIssueCount", "purpose", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, 'Database', $7, $8, $9, $10, false, $11, $12, $13, $14, $15, $16, $17, 0, $18, now(), now(), 1)`,
        [
          id.toString(),
          (data.project || projectId).toString(),
          `Store ${storeCount}`,
          `manual:${id.toString()}`,
          data.kind || DataStoreKind.PostgreSql,
          DataStoreProvider.SelfManaged,
          data.foundFrom || DATA_OBSERVABILITY_FOUND_FROM,
          data.createdByUserId ? data.createdByUserId.toString() : null,
          data.contentScan ?? false,
          data.tableHealth ?? true,
          data.scanProbe ? data.scanProbe.toString() : null,
          data.probeVariable || null,
          data.agentServer ? data.agentServer.toString() : null,
          data.agentDatabase || null,
          data.removedAt || null,
          data.next === undefined ? new Date(Date.now() - 60_000) : data.next,
          data.findingCount || 0,
          data.purpose || null,
        ],
      );

      return id;
    }

    // A connection string, written as Data Observability's routes write one: encrypted by the service.
    async function saveConnectionString(
      id: ObjectID,
      connectionString: string,
    ): Promise<void> {
      await DataStoreService.updateColumnsByIdWithoutHooks({
        id,
        data: { connectionString } as never,
      });
    }

    async function readStoreRow(id: ObjectID): Promise<DataStore | null> {
      return await DataStoreService.findOneBy({
        query: { _id: id },
        select: {
          _id: true,
          name: true,
          connectionString: true,
          scanProbeId: true,
          probeConnectionVariable: true,
          isTableHealthEnabled: true,
          isContentScanEnabled: true,
          tableHealthRemovedAt: true,
          tableHealthDatabaseServerId: true,
          tableHealthDatabaseName: true,
          nextTableHealthCollectionAt: true,
        },
        props: { isRoot: true },
      });
    }

    async function insertAsset(
      store: ObjectID,
      name: string,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."DataAsset" ("_id", "projectId", "dataStoreId", "dataStoreName", "assetKey", "assetKind", "schemaName", "name", "isDropped", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, 'store', $4, 'Table', 'public', $5, false, now(), now(), 1)`,
        [
          id.toString(),
          projectId.toString(),
          store.toString(),
          `public.${name}`,
          name,
        ],
      );

      return id;
    }

    async function insertCheck(
      store: ObjectID,
      asset: ObjectID,
      fields: {
        type?: DataCheckType;
        column?: string | null;
        customSql?: string | null;
      } = {},
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."DataCheck" ("_id", "projectId", "dataAssetId", "dataStoreId", "name", "checkType", "columnName", "customSql", "isEnabled", "nextRunAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, $8, $5, $6, $7, true, NULL, now(), now(), 1)`,
        [
          id.toString(),
          projectId.toString(),
          asset.toString(),
          store.toString(),
          fields.type || DataCheckType.RowCount,
          fields.column === undefined ? null : fields.column,
          fields.customSql || null,
          `Check ${id.toString()}`,
        ],
      );

      return id;
    }

    async function insertIssue(store: ObjectID): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."DataSecurityIssue" ("_id", "projectId", "dataStoreId", "title", "status", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, 'Public bucket', 'Resolved', now(), now(), 1)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          store.toString(),
        ],
      );
    }

    async function count(table: string, store: ObjectID): Promise<number> {
      const [row] = await database.query(
        `SELECT COUNT(*)::int AS n FROM "${schema}"."${table}" WHERE "dataStoreId" = $1`,
        [store.toString()],
      );

      return row.n;
    }

    async function insertAgent(data: {
      server: ObjectID;
      dataObservability?: JSONObject | null;
      online?: boolean;
    }): Promise<ResourceAiAgent> {
      const posture: JSONObject = {
        resourceType: AiResourceType.DatabaseServer,
        resourceIdentifier: "postgresql://orders-db:5432",
        allowWrites: false,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
        ...(data.dataObservability === null
          ? {}
          : {
              dataObservability: data.dataObservability || {
                isOn: true,
                setting: "true",
                offReason: null,
                engine: "postgresql",
                runsChecks: true,
                runsCustomSql: false,
                workVersion: DATABASE_AGENT_WORK_VERSION,
              },
            }),
      };

      await database.query(
        `INSERT INTO "${schema}"."ResourceAiAgent" ("_id", "projectId", "resourceType", "resourceId", "resourceIdentifier", "posture", "connectionStatus", "lastAliveAt", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, $3, $4, 'postgresql://orders-db:5432', $5, 'connected', $6, now(), now(), 1)`,
        [
          agentId.toString(),
          projectId.toString(),
          AiResourceType.DatabaseServer,
          data.server.toString(),
          JSON.stringify(posture),
          data.online === false
            ? new Date(Date.now() - 24 * 60 * 60 * 1000)
            : new Date(),
        ],
      );

      const agent: ResourceAiAgent = new ResourceAiAgent();
      agent.id = agentId;
      agent.projectId = projectId;
      agent.resourceType = AiResourceType.DatabaseServer;
      agent.resourceId = data.server;
      agent.posture = posture;
      return agent;
    }

    // ---- Settings --------------------------------------------------------------

    describe("a database's settings", () => {
      test("say how it is reached and what uses it, and never its connection string", async () => {
        const store: ObjectID = await insertStore();
        await saveConnectionString(
          store,
          "postgres://reader:Secret-Pw-1@db.internal/orders",
        );
        const asset: ObjectID = await insertAsset(store, "orders");
        await insertCheck(store, asset);
        await insertCheck(store, asset, {
          type: DataCheckType.NullPercent,
          column: "id",
        });

        const settings: StoreSettings =
          await DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_ADMIN(),
          });

        expect(JSON.stringify(settings)).not.toContain("Secret-Pw-1");
        expect(settings.connection).toEqual({
          collector: DataObservabilityCollector.OneUptime,
          hasConnectionString: true,
          probe: null,
          probeConnectionVariable: null,
          databaseServer: null,
          databaseName: null,
          agentState: null,
        });
        expect(settings.uses).toMatchObject({
          tableCount: 1,
          checkCount: 2,
          issueCount: 0,
          scanCount: 0,
          ownerCount: 0,
          isContentScanned: false,
          foundFrom: DATA_OBSERVABILITY_FOUND_FROM,
        });
        // Added here, and Data Security holds nothing of it: Data Observability's to delete.
        expect(settings.isDataSecurityRelyingOnIt).toBe(false);
        expect(settings.canEdit).toBe(true);
        expect(settings.canRemove).toBe(true);
        expect(settings.deleteRefusal).toBeNull();
        expect(settings.connectionRefusal).toBeNull();
      });

      test("a reader may read them and change nothing", async () => {
        const store: ObjectID = await insertStore();
        const settings: StoreSettings =
          await DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_VIEWER(),
          });

        expect(settings.canEdit).toBe(false);
        expect(settings.canRemove).toBe(false);
        expect(settings.deleteRefusal).toBe(
          DataObservabilityStoreRefusal.NotPermitted,
        );

        await expect(
          DataObservabilityStoreSettings.update({
            projectId,
            dataStoreId: store,
            body: { name: "Renamed" },
            props: DATA_OBSERVABILITY_VIEWER(),
          }),
        ).rejects.toThrow(NotAuthorizedException);
        await expect(
          DataObservabilityStoreSettings.delete({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_VIEWER(),
          }),
        ).rejects.toThrow(NotAuthorizedException);
        expect((await readStoreRow(store))?.name).toBe(`Store ${storeCount}`);
      });

      test("say Data Security relies on a store it found, added or holds anything of", async () => {
        const cases: Array<{ why: string; store: () => Promise<ObjectID> }> = [
          {
            why: "found by Database Monitoring",
            store: () => {
              return insertStore({ foundFrom: "Database product" });
            },
          },
          {
            why: "added by hand in Data Security",
            store: () => {
              return insertStore({
                foundFrom: "Manual",
                createdByUserId: userId,
              });
            },
          },
          {
            why: "its content sampled",
            store: () => {
              return insertStore({ contentScan: true });
            },
          },
          {
            why: "findings of it",
            store: () => {
              return insertStore({ findingCount: 3 });
            },
          },
          {
            why: "a record of processing",
            store: () => {
              return insertStore({ purpose: "Order fulfilment" });
            },
          },
          {
            why: "an issue of it, resolved",
            store: async () => {
              const id: ObjectID = await insertStore();
              await insertIssue(id);
              return id;
            },
          },
        ];

        for (const item of cases) {
          const store: ObjectID = await item.store();
          const onlyHere: StoreSettings =
            await DataObservabilityStoreSettings.read({
              projectId,
              dataStoreId: store,
              props: DATA_OBSERVABILITY_ADMIN(),
            });
          const withSecurity: StoreSettings =
            await DataObservabilityStoreSettings.read({
              projectId,
              dataStoreId: store,
              props: BOTH_ADMIN(),
            });

          expect([item.why, onlyHere.isDataSecurityRelyingOnIt]).toEqual([
            item.why,
            true,
          ]);
          expect([item.why, onlyHere.deleteRefusal]).toEqual([
            item.why,
            DataObservabilityStoreRefusal.DataSecurityReliesOnIt,
          ]);
          expect([item.why, withSecurity.deleteRefusal]).toEqual([
            item.why,
            null,
          ]);
        }

        // Added by OneUptime by hand, before connecting said so: Data Observability's.
        const legacy: ObjectID = await insertStore({ foundFrom: "Manual" });

        expect(
          (
            await DataObservabilityStoreSettings.read({
              projectId,
              dataStoreId: legacy,
              props: DATA_OBSERVABILITY_ADMIN(),
            })
          ).isDataSecurityRelyingOnIt,
        ).toBe(false);
      });

      test("another project's database is not found", async () => {
        const foreign: ObjectID = await insertStore({
          project: otherProjectId,
        });

        await expect(
          DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: foreign,
            props: BOTH_ADMIN(),
          }),
        ).rejects.toThrow("Database not found.");
      });
    });

    // ---- Rename and reconnect ----------------------------------------------------

    describe("renaming and reconnecting", () => {
      test("renames it, as the person who did, in both products", async () => {
        const store: ObjectID = await insertStore();

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: { name: "  Orders  " },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        expect((await readStoreRow(store))?.name).toBe("Orders");
        expect(AuditLogService.recordUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            updatedFields: { name: "Orders" },
            props: expect.objectContaining({ userId }),
          }),
        );
        await expect(
          DataObservabilityStoreSettings.update({
            projectId,
            dataStoreId: store,
            body: { name: "   " },
            props: DATA_OBSERVABILITY_ADMIN(),
          }),
        ).rejects.toThrow("Give the database a name.");
      });

      test("a new login is saved and read at once; none given keeps the saved one", async () => {
        const store: ObjectID = await insertStore({
          scanProbe: probeId,
          probeVariable: "ORDERS_DB_URL",
        });

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: {
              collector: DataObservabilityCollector.OneUptime,
              connectionString: "postgres://reader:New-Pw-2@db.internal/orders",
            },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        let row: DataStore | null = await readStoreRow(store);

        expect(row?.connectionString).toBe(
          "postgres://reader:New-Pw-2@db.internal/orders",
        );
        expect(row?.scanProbeId).toBeFalsy();
        expect(row?.probeConnectionVariable).toBeFalsy();
        expect(queued.length).toBe(1);

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: { collector: DataObservabilityCollector.OneUptime },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        row = await readStoreRow(store);
        expect(row?.connectionString).toBe(
          "postgres://reader:New-Pw-2@db.internal/orders",
        );
      });

      test("a Snowflake store takes its JSON connection: the root write is not held to Data Security's URLs", async () => {
        const store: ObjectID = await insertStore({
          kind: DataStoreKind.Snowflake,
        });
        const snowflake: string = JSON.stringify({
          account: "acme-xy12345",
          user: "reader",
          privateKey: "-----BEGIN PRIVATE KEY-----x",
        });

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: {
              collector: DataObservabilityCollector.OneUptime,
              connectionString: snowflake,
            },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        expect((await readStoreRow(store))?.connectionString).toBe(snowflake);

        // And connecting a known Snowflake store, which failed before (DataStoreService.onBeforeUpdate).
        const known: ObjectID = await insertStore({
          kind: DataStoreKind.Snowflake,
          foundFrom: "Cloud inventory",
        });

        await DataDataObservabilityAPI.connectStore(projectId, {
          name: "Warehouse",
          kind: DataStoreKind.Snowflake,
          dataStoreId: known.toString(),
          connectionString: snowflake,
        });

        expect((await readStoreRow(known))?.connectionString).toBe(snowflake);
      });

      test("a probe takes it: the connection string leaves OneUptime", async () => {
        const store: ObjectID = await insertStore();
        await saveConnectionString(store, "postgres://reader:Old-Pw@db/orders");

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: {
              collector: DataObservabilityCollector.Probe,
              probeId: probeId.toString(),
              probeConnectionVariable: " ORDERS_DB_URL ",
            },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        const row: DataStore | null = await readStoreRow(store);

        expect(row?.scanProbeId?.toString()).toBe(probeId.toString());
        expect(row?.probeConnectionVariable).toBe("ORDERS_DB_URL");
        expect(row?.connectionString).toBeFalsy();
        // A probe's database is read at its next poll, not queued.
        expect(queued.length).toBe(0);
      });

      test("a Database Agent takes it: no login stays saved, unless Data Security samples with it", async () => {
        const store: ObjectID = await insertStore();
        await saveConnectionString(store, "postgres://reader:Old-Pw@db/orders");

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: {
              collector: DataObservabilityCollector.DatabaseAgent,
              databaseServerId: serverId.toString(),
              databaseName: "orders",
            },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        let row: DataStore | null = await readStoreRow(store);

        expect(row?.tableHealthDatabaseServerId?.toString()).toBe(
          serverId.toString(),
        );
        expect(row?.tableHealthDatabaseName).toBe("orders");
        expect(row?.connectionString).toBeFalsy();

        // Data Security samples this one: its connection stays, for anyone who may connect.
        const sampled: ObjectID = await insertStore({ contentScan: true });
        await saveConnectionString(
          sampled,
          "postgres://reader:Sampled-Pw@db/orders",
        );

        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: sampled,
          body: {
            connection: {
              collector: DataObservabilityCollector.DatabaseAgent,
              databaseServerId: serverId.toString(),
              databaseName: "orders",
            },
          },
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        row = await readStoreRow(sampled);
        expect(row?.tableHealthDatabaseServerId?.toString()).toBe(
          serverId.toString(),
        );
        expect(row?.connectionString).toBe(
          "postgres://reader:Sampled-Pw@db/orders",
        );
      });

      test("a Database Agent of another engine, another project's server or a bad name is refused", async () => {
        const store: ObjectID = await insertStore();
        const attempts: Array<[JSONObject, string]> = [
          [
            {
              databaseServerId: mysqlServerId.toString(),
              databaseName: "orders",
            },
            "That Database Agent reads another engine",
          ],
          [
            {
              databaseServerId: ObjectID.generate().toString(),
              databaseName: "orders",
            },
            "Choose the database server whose Database Agent reads this database.",
          ],
          [
            { databaseServerId: serverId.toString(), databaseName: "../etc" },
            "Name the database on that server",
          ],
        ];

        for (const [connection, message] of attempts) {
          await expect(
            DataObservabilityStoreSettings.update({
              projectId,
              dataStoreId: store,
              body: {
                connection: {
                  collector: DataObservabilityCollector.DatabaseAgent,
                  ...connection,
                },
              },
              props: DATA_OBSERVABILITY_ADMIN(),
            }),
          ).rejects.toThrow(message);
        }

        const snowflake: ObjectID = await insertStore({
          kind: DataStoreKind.Snowflake,
        });

        await expect(
          DataObservabilityStoreSettings.update({
            projectId,
            dataStoreId: snowflake,
            body: {
              connection: {
                collector: DataObservabilityCollector.DatabaseAgent,
                databaseServerId: serverId.toString(),
                databaseName: "orders",
              },
            },
            props: DATA_OBSERVABILITY_ADMIN(),
          }),
        ).rejects.toThrow("reads PostgreSQL and MySQL databases");
      });

      test("the connection Data Security samples with changes only for someone who may edit its stores", async () => {
        const store: ObjectID = await insertStore({ contentScan: true });
        await saveConnectionString(
          store,
          "postgres://reader:Sampled-Pw@db/orders",
        );

        const settings: StoreSettings =
          await DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_ADMIN(),
          });

        expect(settings.connectionRefusal).toBe(
          DataObservabilityStoreRefusal.DataSecuritySamplesIt,
        );

        await expect(
          DataObservabilityStoreSettings.update({
            projectId,
            dataStoreId: store,
            body: {
              connection: {
                collector: DataObservabilityCollector.OneUptime,
                connectionString: "postgres://reader:Taken-Pw@db/orders",
              },
            },
            props: DATA_OBSERVABILITY_ADMIN(),
          }),
        ).rejects.toThrow(CONNECTION_CHANGE_REFUSAL);
        expect((await readStoreRow(store))?.connectionString).toBe(
          "postgres://reader:Sampled-Pw@db/orders",
        );

        // Someone who may edit Data Security's stores changes it, through Data Security's path.
        await DataObservabilityStoreSettings.update({
          projectId,
          dataStoreId: store,
          body: {
            connection: {
              collector: DataObservabilityCollector.OneUptime,
              connectionString: "postgresql://reader:Rotated-Pw@db/orders",
            },
          },
          props: BOTH_ADMIN(),
        });

        expect((await readStoreRow(store))?.connectionString).toBe(
          "postgresql://reader:Rotated-Pw@db/orders",
        );
      });
    });

    // ---- Remove ------------------------------------------------------------------

    describe("Remove from Data Observability", () => {
      test("takes its tables, checks and warehouse jobs, and leaves Data Security everything", async () => {
        const store: ObjectID = await insertStore({ findingCount: 2 });
        await saveConnectionString(
          store,
          "postgres://reader:Kept-Pw@db/orders",
        );
        const asset: ObjectID = await insertAsset(store, "orders");
        await insertAsset(store, "customers");
        await insertCheck(store, asset);
        await insertIssue(store);
        await database.query(
          `INSERT INTO "${schema}"."DataWarehouseJob" ("_id", "projectId", "dataStoreId", "jobKey", "createdAt", "updatedAt", "version")
         VALUES ($1, $2, $3, 'job-1', now(), now(), 1)`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            store.toString(),
          ],
        );

        await DataObservabilityStoreSettings.remove({
          projectId,
          dataStoreId: store,
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        expect(await count("DataAsset", store)).toBe(0);
        expect(await count("DataCheck", store)).toBe(0);
        expect(await count("DataWarehouseJob", store)).toBe(0);
        // Data Security's part stays.
        expect(await count("DataSecurityIssue", store)).toBe(1);

        const row: DataStore | null = await readStoreRow(store);

        expect(row?.connectionString).toBe(
          "postgres://reader:Kept-Pw@db/orders",
        );
        expect(row?.isTableHealthEnabled).toBe(false);
        expect(row?.tableHealthRemovedAt).toBeTruthy();
        expect(row?.nextTableHealthCollectionAt).toBeFalsy();
        expect(AuditLogService.recordUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            includeColumns: ["tableHealthRemovedAt"],
            props: expect.objectContaining({ userId }),
          }),
        );

        // Gone from Data Observability's list and settings, offered again as a suggestion.
        const listed: Array<DataObservabilityStoreSummary> =
          await DataDataObservabilityAPI.getStoreSummaries(
            projectId,
            new Date(),
          );

        expect(
          listed.find((summary: DataObservabilityStoreSummary) => {
            return summary.dataStoreId === store.toString();
          }),
        ).toBeUndefined();
        await expect(
          DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_ADMIN(),
          }),
        ).rejects.toThrow("Database not found.");

        const suggestion: DataObservabilitySourceSuggestion | undefined = (
          await DataSourceSuggestions.read(projectId)
        ).find((candidate: DataObservabilitySourceSuggestion) => {
          return candidate.dataStoreId === store.toString();
        });

        expect(suggestion).toMatchObject({
          origin: DataObservabilitySourceOrigin.Removed,
          hasSavedConnection: true,
        });

        // Connected again, keeping the connection string Data Security kept.
        await DataDataObservabilityAPI.connectStore(projectId, {
          name: "Orders",
          kind: DataStoreKind.PostgreSql,
          dataStoreId: store.toString(),
        });

        const back: DataStore | null = await readStoreRow(store);

        expect(back?.tableHealthRemovedAt).toBeFalsy();
        expect(back?.isTableHealthEnabled).toBe(true);
        expect(back?.connectionString).toBe(
          "postgres://reader:Kept-Pw@db/orders",
        );
        expect(
          (
            await DataDataObservabilityAPI.getStoreSummaries(
              projectId,
              new Date(),
            )
          ).some((summary: DataObservabilityStoreSummary) => {
            return summary.dataStoreId === store.toString();
          }),
        ).toBe(true);
      });

      test("no collection reads a removed database", async () => {
        const store: ObjectID = await insertStore();
        await saveConnectionString(store, "postgres://reader:pw@db/orders");

        await DataObservabilityStoreSettings.remove({
          projectId,
          dataStoreId: store,
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        const claimed: Array<{ dataStoreId: ObjectID }> =
          await DataObservabilityRunner.claimDueStores(100);

        expect(
          claimed.some((item: { dataStoreId: ObjectID }) => {
            return item.dataStoreId.toString() === store.toString();
          }),
        ).toBe(false);
      });
    });

    // ---- Delete ------------------------------------------------------------------

    describe("Delete", () => {
      test("a database Data Observability added, that Data Security holds nothing of, is its to delete", async () => {
        const store: ObjectID = await insertStore();
        const asset: ObjectID = await insertAsset(store, "orders");
        await insertCheck(store, asset);

        await DataObservabilityStoreSettings.delete({
          projectId,
          dataStoreId: store,
          props: DATA_OBSERVABILITY_ADMIN(),
        });

        expect(await readStoreRow(store)).toBeNull();
        expect(await count("DataAsset", store)).toBe(0);
        expect(await count("DataCheck", store)).toBe(0);
        expect(AuditLogService.recordDelete).toHaveBeenCalledWith(
          expect.objectContaining({
            props: expect.objectContaining({ userId }),
          }),
        );
      });

      test("someone who may only use Data Observability cannot delete a store Data Security relies on", async () => {
        const store: ObjectID = await insertStore({
          foundFrom: "Database product",
        });
        await insertIssue(store);

        await expect(
          DataObservabilityStoreSettings.delete({
            projectId,
            dataStoreId: store,
            props: DATA_OBSERVABILITY_ADMIN(),
          }),
        ).rejects.toThrow(DELETE_REFUSAL);
        expect(await readStoreRow(store)).not.toBeNull();
        expect(await count("DataSecurityIssue", store)).toBe(1);
      });

      test("someone who may delete Data Security's stores deletes it, through Data Security's delete", async () => {
        const store: ObjectID = await insertStore({
          foundFrom: "Database product",
        });
        await insertIssue(store);
        await insertAsset(store, "orders");

        await DataObservabilityStoreSettings.delete({
          projectId,
          dataStoreId: store,
          props: BOTH_ADMIN(),
        });

        expect(await readStoreRow(store)).toBeNull();
        expect(await count("DataSecurityIssue", store)).toBe(0);
        expect(await count("DataAsset", store)).toBe(0);
      });
    });

    // ---- Database Agents ---------------------------------------------------------

    describe("a Database Agent", () => {
      test("is offered with whether it can read a database now", async () => {
        await insertAgent({ server: serverId });

        const settings: StoreSettings =
          await DataObservabilityStoreSettings.read({
            projectId,
            dataStoreId: await insertStore({
              agentServer: serverId,
              agentDatabase: "orders",
            }),
            props: DATA_OBSERVABILITY_ADMIN(),
          });

        expect(settings.connection).toMatchObject({
          collector: DataObservabilityCollector.DatabaseAgent,
          databaseServer: { id: serverId.toString(), name: "orders-db" },
          databaseName: "orders",
          agentState: DataObservabilityAgentState.Ready,
        });

        const summary: DataObservabilityStoreSummary | undefined = (
          await DataDataObservabilityAPI.getStoreSummaries(
            projectId,
            new Date(),
          )
        ).find((item: DataObservabilityStoreSummary) => {
          return item.collector === DataObservabilityCollector.DatabaseAgent;
        });

        expect(summary).toMatchObject({
          databaseServerName: "orders-db",
          agentState: DataObservabilityAgentState.Ready,
        });
      });

      test("is handed only its own server's due databases, as work that names no statement", async () => {
        const agent: ResourceAiAgent = await insertAgent({ server: serverId });
        const due: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "orders",
        });
        const asset: ObjectID = await insertAsset(due, "orders");
        const check: ObjectID = await insertCheck(due, asset, {
          type: DataCheckType.NullPercent,
          column: "status",
        });
        const custom: ObjectID = await insertCheck(due, asset, {
          type: DataCheckType.CustomSql,
          customSql: "SELECT COUNT(*) FROM orders",
        });
        const otherServers: ObjectID = await insertStore({
          agentServer: otherServerId,
          agentDatabase: "billing",
        });
        const notDue: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "later",
          next: new Date(Date.now() + 60 * 60 * 1000),
        });
        const paused: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "paused",
          tableHealth: false,
        });
        const removed: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "removed",
          removedAt: new Date(),
        });

        const work: Array<DatabaseAgentWork> =
          await DataObservabilityAgentCollect.handOutWork(agent);

        expect(
          work.map((item: DatabaseAgentWork) => {
            return item.dataStoreId;
          }),
        ).toEqual([due.toString()]);
        expect(work[0]).toMatchObject({
          engine: "postgresql",
          databaseName: "orders",
          readsViewLineage: true,
        });
        expect(work[0]!.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              checkId: check.toString(),
              type: DataCheckType.NullPercent,
              schemaName: "public",
              tableName: "orders",
              columnName: "status",
              customSql: null,
            }),
            expect.objectContaining({
              checkId: custom.toString(),
              type: DataCheckType.CustomSql,
              customSql: "SELECT COUNT(*) FROM orders",
            }),
          ]),
        );
        // What to read, never how: no statement, no credential.
        expect(JSON.stringify(work)).not.toMatch(
          /"sql"|connectionString|password/,
        );

        // Claimed: the next poll gets nothing until the claim runs out.
        expect(await DataObservabilityAgentCollect.handOutWork(agent)).toEqual(
          [],
        );

        for (const untouched of [otherServers, notDue, paused, removed]) {
          const row: DataStore | null = await readStoreRow(untouched);
          expect(
            row?.nextTableHealthCollectionAt === null ||
              new Date(row!.nextTableHealthCollectionAt!).getTime() <
                Date.now() + 2 * 60 * 60 * 1000,
          ).toBe(true);
        }

        // The other server's database is still due for its own agent.
        expect(
          (
            await claimDueTableHealthStoresForAgent({
              databaseServerId: otherServerId,
              projectId,
              limit: 5,
            })
          ).map((row: { _id: string }) => {
            return row._id;
          }),
        ).toEqual([otherServers.toString()]);
      });

      test("is handed nothing until its owner turns Data Observability on, in a version it speaks", async () => {
        await insertStore({ agentServer: serverId, agentDatabase: "orders" });

        for (const dataObservability of [
          null,
          {
            isOn: false,
            workVersion: DATABASE_AGENT_WORK_VERSION,
            engine: "postgresql",
          },
          { isOn: true, workVersion: 0, engine: "postgresql" },
        ]) {
          await database.query(`DELETE FROM "${schema}"."ResourceAiAgent"`);
          const agent: ResourceAiAgent = await insertAgent({
            server: serverId,
            dataObservability: dataObservability as JSONObject | null,
          });

          expect(
            await DataObservabilityAgentCollect.handOutWork(agent),
          ).toEqual([]);
        }
      });

      test("a database of an engine the agent does not read is told so, not handed out", async () => {
        const agent: ResourceAiAgent = await insertAgent({
          server: serverId,
          dataObservability: {
            isOn: true,
            workVersion: DATABASE_AGENT_WORK_VERSION,
            engine: "mysql",
          },
        });
        const store: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "orders",
        });
        const failure: SpyInstance<typeof TableHealthIngest.recordFailure> =
          jest
            .spyOn(TableHealthIngest, "recordFailure")
            .mockResolvedValue(undefined as never);

        expect(await DataObservabilityAgentCollect.handOutWork(agent)).toEqual(
          [],
        );
        expect(failure).toHaveBeenCalledWith(
          expect.objectContaining({
            storeId: expect.anything(),
            error: expect.stringContaining("reads MySQL databases"),
          }),
        );
        expect(failure.mock.calls[0]![0].storeId.toString()).toBe(
          store.toString(),
        );
      });

      test("is heard only about its own server's databases", async () => {
        const agent: ResourceAiAgent = await insertAgent({ server: serverId });
        const own: ObjectID = await insertStore({
          agentServer: serverId,
          agentDatabase: "orders",
        });
        const someoneElses: ObjectID = await insertStore({
          agentServer: otherServerId,
          agentDatabase: "billing",
        });
        const recorded: SpyInstance<typeof TableHealthIngest.recordSnapshot> =
          jest
            .spyOn(TableHealthIngest, "recordSnapshot")
            .mockResolvedValue({ schemaChanges: 0 } as never);
        jest
          .spyOn(DataCheckIngest, "recordResults")
          .mockResolvedValue(undefined as never);
        const snapshot: JSONObject = {
          engine: "postgresql",
          collectedAt: new Date().toISOString(),
          tables: [
            {
              schema: "public",
              name: "orders",
              kind: "Table",
              estimatedRows: 5,
              sizeInBytes: 8192,
              writeCount: 1,
              secondsSinceChange: null,
              readCount: 1,
              secondsSinceRead: null,
              columns: [
                {
                  name: "id",
                  dataType: "integer",
                  isNullable: false,
                  position: 1,
                },
              ],
            },
          ],
          isComplete: true,
          warnings: [],
          secondsSinceStatsReset: 60,
          target: { databaseName: "orders", host: "orders-db", port: 5432 },
        };

        await expect(
          DataObservabilityAgentCollect.acceptResult(agent, {
            dataStoreId: someoneElses.toString(),
            snapshot,
          }),
        ).rejects.toThrow("Data store not found.");
        expect(recorded).not.toHaveBeenCalled();

        expect(
          await DataObservabilityAgentCollect.acceptResult(agent, {
            dataStoreId: own.toString(),
            snapshot,
          }),
        ).toMatchObject({ accepted: true, tables: 1 });
        expect(recorded).toHaveBeenCalledTimes(1);
        expect(recorded.mock.calls[0]![0].store.id.toString()).toBe(
          own.toString(),
        );

        // A snapshot of another engine is no snapshot of this database.
        await expect(
          DataObservabilityAgentCollect.acceptResult(agent, {
            dataStoreId: own.toString(),
            snapshot: { ...snapshot, engine: "mysql" },
          }),
        ).rejects.toThrow("The result is not a table health snapshot.");
      });

      test("the workers and the probe leave its databases alone, and the probe never sets them aside", async () => {
        const store: ObjectID = await insertStore({
          contentScan: true,
          scanProbe: probeId,
          probeVariable: "ORDERS_DB_URL",
          agentServer: serverId,
          agentDatabase: "orders",
        });
        await saveConnectionString(store, "postgres://reader:pw@db/orders");
        const before: DataStore | null = await readStoreRow(store);

        expect(
          (await DataObservabilityRunner.claimDueStores(100)).some(
            (item: { dataStoreId: ObjectID }) => {
              return item.dataStoreId.toString() === store.toString();
            },
          ),
        ).toBe(false);
        expect(
          (await claimDueTableHealthStoresForProbe({ probeId, limit: 5 })).some(
            (row: { _id: string }) => {
              return row._id === store.toString();
            },
          ),
        ).toBe(false);

        // Its due time is the agent's: unmoved by the probe's claim and set-aside.
        const after: DataStore | null = await readStoreRow(store);
        expect(new Date(after!.nextTableHealthCollectionAt!).getTime()).toBe(
          new Date(before!.nextTableHealthCollectionAt!).getTime(),
        );
        expect(
          (
            await claimDueTableHealthStoresForAgent({
              databaseServerId: serverId,
              projectId,
              limit: 5,
            })
          ).map((row: { _id: string }) => {
            return row._id;
          }),
        ).toEqual([store.toString()]);
      });

      test("Connect a Database reads a new database through it, with nothing saved but which", async () => {
        await insertAgent({ server: serverId });

        const connected: { dataStoreId: string } =
          await DataDataObservabilityAPI.connectStore(projectId, {
            name: "Orders",
            kind: DataStoreKind.PostgreSql,
            databaseServerId: serverId.toString(),
            databaseName: "orders",
          });
        const row: DataStore | null = await readStoreRow(
          new ObjectID(connected.dataStoreId),
        );

        expect(row?.tableHealthDatabaseServerId?.toString()).toBe(
          serverId.toString(),
        );
        expect(row?.tableHealthDatabaseName).toBe("orders");
        expect(row?.connectionString).toBeFalsy();
        expect(row?.scanProbeId).toBeFalsy();
        expect(row?.isContentScanEnabled).toBe(false);
        // The agent reads it at its next poll; no worker is queued.
        expect(queued.length).toBe(0);

        const [found] = await database.query(
          `SELECT "discoveredFrom" FROM "${schema}"."DataStore" WHERE "_id" = $1`,
          [connected.dataStoreId],
        );
        expect(found.discoveredFrom).toBe(DATA_OBSERVABILITY_FOUND_FROM);
      });

      test("connecting a store Data Security found gives its content scans no login", async () => {
        const known: ObjectID = await insertStore({
          foundFrom: "Database product",
          contentScan: true,
        });

        await DataDataObservabilityAPI.connectStore(projectId, {
          name: "Orders",
          kind: DataStoreKind.PostgreSql,
          dataStoreId: known.toString(),
          connectionString: "postgres://reader:pw@db/orders",
        });

        const row: DataStore | null = await readStoreRow(known);

        expect(row?.connectionString).toBe("postgres://reader:pw@db/orders");
        // Never sampled before it had a way in, and not now: no value leaves the database.
        expect(row?.isContentScanEnabled).toBe(false);
      });
    });
  },
);
