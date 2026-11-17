import HashPresentedKeysForLookup from "../../../FeatureSet/Workers/DataMigrations/HashPresentedKeysForLookup";
import { digestOfValueRead } from "../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import PresentedKeysInPlace, {
  PresentedKeyProtection,
  PresentedKeyTarget,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import PresentedKeysProtection, {
  PresentedKeysProtectionOutcome,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysProtection";
import Entities from "Common/Models/DatabaseModels/Index";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import IoTDeviceCredential from "Common/Models/DatabaseModels/IoTDeviceCredential";
import Probe from "Common/Models/DatabaseModels/Probe";
import Runner from "Common/Models/DatabaseModels/Runner";
import { PresentedKeysEncryptedColumns1809182900000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182900000-PresentedKeysEncryptedColumns";
import { StatusPageEmbedTokenEncryptedColumn1809182910000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182910000-StatusPageEmbedTokenEncryptedColumn";
import { StatusPageSubscriberTokenEncryptedColumn1809182920000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182920000-StatusPageSubscriberTokenEncryptedColumn";
import { MonitorKeysEncryptedColumns1809182930000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182930000-MonitorKeysEncryptedColumns";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import AIAgentService from "Common/Server/Services/AIAgentService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import DataProductService from "Common/Server/Services/DataProductService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import MonitorService from "Common/Server/Services/MonitorService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import RunbookService from "Common/Server/Services/RunbookService";
import RunnerService from "Common/Server/Services/RunnerService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";
import PresentedKeysAtRest, {
  LOOKUP_HASH_MIGRATION_NAME,
  PROTECTED_AT_REST_MARKER,
  SETTLE_PERIOD_MS,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import TableColumnType from "Common/Types/Database/TableColumnType";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * THE KEYS PRESENTED TO ONEUPTIME THROUGH THE UPGRADE THAT PROTECTS THEM,
 * ON A REAL POSTGRES (#9012).
 *
 * A probe's, a Runner's and an AI agent's key, a telemetry ingestion key, an
 * IoT device's secret, a monitor's three secret keys, a workflow's webhook
 * and email keys, a runbook's webhook key, a status page's embed token, a
 * data product's badge token, a subscriber's unsubscribe token and both
 * kinds of SCIM bearer token were stored as written. Every probe, agent,
 * collector, device, webhook, badge and identity provider out there keeps
 * the key it has, so each must keep working through the upgrade - on a
 * server of this release, and on one of the release before still running
 * beside it while the upgrade rolls out, which compares a key as written.
 * On the tables as they were before the upgrade, with every key stored the
 * old way (the uuid columns uuids, the tokens varchar(100)s):
 *
 *   - the schema migrations change the columns' types in place and keep
 *     every key; both releases find each key, and refuse a wrong one;
 *   - the HashPresentedKeysForLookup data migration writes each lookup hash
 *     and changes no key: both releases still find every key, and a second
 *     run changes nothing;
 *   - within the day after, the PresentedKeys:ProtectAtRest job keeps the
 *     lookup hashes up to date - a key a server of the release before
 *     changed is found by its new hash - and changes no key;
 *   - a day after, the job encrypts every key (a SCIM token: hashes it) in
 *     place and records it once: this release finds every key with the key
 *     as written and refuses a wrong one, reads each key back as written
 *     where people see it again, no key a request presents goes into a
 *     query, and nothing is stored as written any more;
 *   - two passes at once protect each key once; a key saved afterwards is
 *     stored protected at once;
 *   - rolled back, each column has its old type again: an encrypted uuid
 *     key a new random one, an encrypted token cleared.
 *
 * Opt in with RUN_POSTGRES_PRESENTED_KEYS_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema), dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from PRESENTED_KEYS_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from PRESENTED_KEYS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PRESENTED_KEYS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "Probe",
  "Runner",
  "AIAgent",
  "TelemetryIngestionKey",
  "IoTDeviceCredential",
  "Monitor",
  "Workflow",
  "Runbook",
  "StatusPage",
  "DataProduct",
  "StatusPageSubscriber",
  "ProjectSCIM",
  "StatusPageSCIM",
  "DataMigrations",
];

const PROJECT_ID: string = "90120000-0000-4000-8000-0000000000f1";
const STATUS_PAGE_ID: string = "90120000-0000-4000-8000-0000000000f2";
const MONITOR_STATUS_ID: string = "90120000-0000-4000-8000-0000000000f3";
const FLEET_ID: string = "90120000-0000-4000-8000-0000000000f4";

// Each row's id, by table.
const ROW_ID: Record<string, string> = {
  Probe: "90120000-0000-4000-8000-000000000001",
  Runner: "90120000-0000-4000-8000-000000000002",
  AIAgent: "90120000-0000-4000-8000-000000000003",
  TelemetryIngestionKey: "90120000-0000-4000-8000-000000000004",
  IoTDeviceCredential: "90120000-0000-4000-8000-000000000005",
  Monitor: "90120000-0000-4000-8000-000000000006",
  Workflow: "90120000-0000-4000-8000-000000000007",
  Runbook: "90120000-0000-4000-8000-000000000008",
  StatusPage: STATUS_PAGE_ID,
  DataProduct: "90120000-0000-4000-8000-00000000000a",
  StatusPageSubscriber: "90120000-0000-4000-8000-00000000000b",
  ProjectSCIM: "90120000-0000-4000-8000-00000000000c",
  StatusPageSCIM: "90120000-0000-4000-8000-00000000000d",
};

// Every key as the release before wrote it: uuids where the column was one.
const WRITTEN: Record<string, string> = {
  "Probe.key": "a-probe-key-the-operator-chose",
  "Runner.key": "6b8f1e0c4d2a4f6e8a0c2e4f6a8b0d2c4e6f8a0b2c4d6e8f",
  "AIAgent.key": "an-ai-agent-key-the-operator-chose",
  "TelemetryIngestionKey.secretKey": "1f6c2a8e-3b4d-4c5e-9f0a-1b2c3d4e5f60",
  "IoTDeviceCredential.secretKey": "2a7d3b9f-4c5e-4d6f-8a1b-2c3d4e5f6a71",
  "Monitor.serverMonitorSecretKey": "3b8e4c0a-5d6f-4e7a-9b2c-3d4e5f6a7b82",
  "Monitor.incomingRequestSecretKey": "4c9f5d1b-6e7a-4f8b-8c3d-4e5f6a7b8c93",
  "Monitor.incomingEmailSecretKey": "5d0a6e2c-7f8b-4a9c-9d4e-5f6a7b8c9da4",
  "Workflow.webhookSecretKey": "6e1b7f3d-8a9c-4b0d-8e5f-6a7b8c9d0eb5",
  "Workflow.incomingEmailSecretKey": "7f2c8a4e-9b0d-4c1e-9f6a-7b8c9d0e1fc6",
  "Runbook.webhookSecretKey": "a-runbook-webhook-key-of-forty-characters",
  "StatusPage.embeddedOverallStatusToken":
    "8a3d9b5f-0c1e-4d2f-8a7b-8c9d0e1f2ad7",
  "DataProduct.badgeToken": "9b4e0c6a-1d2f-4e3a-9b8c-9d0e1f2a3be8",
  "StatusPageSubscriber.unsubscribeToken": "c".repeat(64),
  "ProjectSCIM.bearerToken": "0d".repeat(32),
  "StatusPageSCIM.bearerToken": "1e".repeat(32),
};

// The ones a key presented by mistake would be: the same kind, another value.
const WRONG_UUID: string = "0c5f1d7b-2e3a-4f4b-8c9d-0e1f2a3b4cf9";
const WRONG_TEXT: string = "not-the-key-that-was-written";

// A key a server of the release before wrote during the upgrade.
const CHANGED_DURING_UPGRADE: string = "ad6f2e8c-3a4b-4c5d-8e0f-1a2b3c4d5e6f";

// When the upgrade's data migration ran, and a day after.
const UPGRADED_AT: Date = new Date("2026-11-16T08:00:00.000Z");
const A_DAY_AFTER: Date = new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS);

// What a statement sent to Postgres was, as TypeORM's logger hears it.
interface SentQuery {
  query: string;
  parameters: Array<unknown> | undefined;
}

// The service each table is read and written through.
interface KeyService {
  findOneByPresentedKey: (data: {
    column: string;
    presentedKey: string;
    query?: Record<string, unknown> | undefined;
    select: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<{ _id?: unknown } | null>;
  findOneBy: (data: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<{ _id?: unknown } | null>;
  mayHoldPresentedKeysAsWritten: () => Promise<boolean>;
}

const SERVICE: Record<string, KeyService> = {
  Probe: ProbeService as unknown as KeyService,
  Runner: RunnerService as unknown as KeyService,
  AIAgent: AIAgentService as unknown as KeyService,
  TelemetryIngestionKey: TelemetryIngestionKeyService as unknown as KeyService,
  IoTDeviceCredential: IoTDeviceCredentialService as unknown as KeyService,
  Monitor: MonitorService as unknown as KeyService,
  Workflow: WorkflowService as unknown as KeyService,
  Runbook: RunbookService as unknown as KeyService,
  StatusPage: StatusPageService as unknown as KeyService,
  DataProduct: DataProductService as unknown as KeyService,
  StatusPageSubscriber: StatusPageSubscriberService as unknown as KeyService,
  ProjectSCIM: ProjectSCIMService as unknown as KeyService,
  StatusPageSCIM: StatusPageSCIMService as unknown as KeyService,
};

// Every column whose keys are protected, as the job protects them.
const TARGETS: Array<PresentedKeyTarget> = PresentedKeysInPlace.getTargets();

const nameOf: (target: PresentedKeyTarget) => string = (
  target: PresentedKeyTarget,
): string => {
  return `${target.tableName}.${target.column}`;
};

const writtenOf: (target: PresentedKeyTarget) => string = (
  target: PresentedKeyTarget,
): string => {
  return WRITTEN[nameOf(target)]!;
};

const wrongOf: (target: PresentedKeyTarget) => string = (
  target: PresentedKeyTarget,
): string => {
  return target.columnType === TableColumnType.ObjectID
    ? WRONG_UUID
    : WRONG_TEXT;
};

describePostgres(
  "the keys presented to OneUptime through their upgrade (Postgres)",
  () => {
    const schema: string = `presented_keys_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    const sent: Array<SentQuery> = [];

    async function withRunner(
      work: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await work(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    // The value a column holds, as stored.
    async function stored(
      table: string,
      column: string,
      id: string = ROW_ID[table]!,
    ): Promise<string | null> {
      const rows: Array<{ value: string | null }> = await database.query(
        `SELECT "${column}"::text AS "value" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!.value;
    }

    async function columnType(table: string, column: string): Promise<string> {
      const rows: Array<{ data_type: string; max: number | null }> =
        await database.query(
          `SELECT data_type, character_maximum_length AS "max" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schema, table, column],
        );

      if (rows.length === 0) {
        return "none";
      }

      return rows[0]!.max
        ? `${rows[0]!.data_type}(${rows[0]!.max})`
        : rows[0]!.data_type;
    }

    /*
     * A server of the release before: it compares the key presented with
     * the column as written, in the query.
     */
    async function releaseBeforeFinds(
      target: PresentedKeyTarget,
      key: string,
    ): Promise<Array<string>> {
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id"::text AS "_id" FROM "${schema}"."${target.tableName}" WHERE "${target.column}" = $1`,
        [key],
      );

      return rows.map((row: { _id: string }): string => {
        return row._id;
      });
    }

    /*
     * A server of this release: a key a request names its record by alone
     * is found by its lookup hash (and, while one may be stored so, as
     * written); a key checked on a record the request names is held to
     * that record's key; a SCIM bearer token is matched by its hash in the
     * query, as SCIMAuthorization.findConnection matches it (and, while one
     * may be stored so, as written). The id found, or null.
     */
    async function thisReleaseFinds(
      target: PresentedKeyTarget,
      key: string,
    ): Promise<string | null> {
      const service: KeyService = SERVICE[target.tableName]!;
      const rowId: string = ROW_ID[target.tableName]!;

      if (target.protection === PresentedKeyProtection.Hash) {
        const find: (
          query: Record<string, unknown>,
        ) => Promise<{ _id?: unknown } | null> = async (
          query: Record<string, unknown>,
        ): Promise<{ _id?: unknown } | null> => {
          return await service.findOneBy({
            query: { ...query, _id: new ObjectID(rowId) },
            select: { _id: true },
            props: { isRoot: true },
          });
        };

        let found: { _id?: unknown } | null = await find({
          [target.column]: new HashedString(
            PresentedKey.toStoredHash(key),
            true,
          ),
        });

        if (
          !found &&
          !PresentedKey.isStoredHash(key) &&
          (await service.mayHoldPresentedKeysAsWritten())
        ) {
          found = await find({ [target.column]: key });
        }

        return found?._id ? String(found._id) : null;
      }

      const found: { _id?: unknown } | null =
        await service.findOneByPresentedKey({
          column: target.column,
          presentedKey: key,
          query: target.lookupHashColumn
            ? undefined
            : { _id: new ObjectID(rowId) },
          select: { _id: true },
          props: { isRoot: true },
        });

      return found?._id ? String(found._id) : null;
    }

    // Both releases find every key as written, and neither finds a wrong one.
    async function expectBothReleasesFindEveryKey(): Promise<void> {
      for (const target of TARGETS) {
        const rowId: string = ROW_ID[target.tableName]!;

        expect([
          nameOf(target),
          await releaseBeforeFinds(target, writtenOf(target)),
        ]).toEqual([nameOf(target), [rowId]]);
        expect([
          nameOf(target),
          await releaseBeforeFinds(target, wrongOf(target)),
        ]).toEqual([nameOf(target), []]);
        expect([
          nameOf(target),
          await thisReleaseFinds(target, writtenOf(target)),
        ]).toEqual([nameOf(target), rowId]);
        expect([
          nameOf(target),
          await thisReleaseFinds(target, wrongOf(target)),
        ]).toEqual([nameOf(target), null]);
      }
    }

    async function storedKeys(): Promise<Array<string | null>> {
      const values: Array<string | null> = [];

      for (const target of TARGETS) {
        values.push(await stored(target.tableName, target.column));

        if (target.lookupHashColumn) {
          values.push(await stored(target.tableName, target.lookupHashColumn));
        }
      }

      return values;
    }

    async function recordLookupHashesWritten(at: Date): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."DataMigrations" ("_id", "version", "name", "executed", "executedAt") VALUES ($1, 1, $2, true, $3)`,
        [ObjectID.generate().toString(), LOOKUP_HASH_MIGRATION_NAME, at],
      );
    }

    async function markersRecorded(): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text AS "count" FROM "${schema}"."DataMigrations" WHERE "name" = $1`,
        [PROTECTED_AT_REST_MARKER],
      );

      return Number(rows[0]!.count);
    }

    async function seedAsWritten(): Promise<void> {
      const key: (name: string) => string = (name: string): string => {
        return WRITTEN[name]!;
      };

      await database.query(
        `INSERT INTO "${schema}"."Probe" ("_id", "version", "key", "name", "slug", "probeVersion", "isGlobalProbe") VALUES ($1, 1, $2, 'Global probe', $3, '1.0.0', true)`,
        [ROW_ID["Probe"], key("Probe.key"), `probe-${ROW_ID["Probe"]}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."Runner" ("_id", "version", "key", "name", "slug", "projectId") VALUES ($1, 1, $2, 'Runner', $3, $4)`,
        [
          ROW_ID["Runner"],
          key("Runner.key"),
          `runner-${ROW_ID["Runner"]}`,
          PROJECT_ID,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."AIAgent" ("_id", "version", "key", "name", "slug", "aiAgentVersion") VALUES ($1, 1, $2, 'AI agent', $3, '1.0.0')`,
        [ROW_ID["AIAgent"], key("AIAgent.key"), `agent-${ROW_ID["AIAgent"]}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."TelemetryIngestionKey" ("_id", "version", "projectId", "name", "secretKey") VALUES ($1, 1, $2, 'Collector', $3)`,
        [
          ROW_ID["TelemetryIngestionKey"],
          PROJECT_ID,
          key("TelemetryIngestionKey.secretKey"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."IoTDeviceCredential" ("_id", "version", "projectId", "iotFleetId", "externalId", "secretKey") VALUES ($1, 1, $2, $3, 'device-1', $4)`,
        [
          ROW_ID["IoTDeviceCredential"],
          PROJECT_ID,
          FLEET_ID,
          key("IoTDeviceCredential.secretKey"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "serverMonitorSecretKey", "incomingRequestSecretKey", "incomingEmailSecretKey") VALUES ($1, 1, $2, 'Heartbeat', $3, 'Incoming Request', $4, $5, $6, $7)`,
        [
          ROW_ID["Monitor"],
          PROJECT_ID,
          `monitor-${ROW_ID["Monitor"]}`,
          MONITOR_STATUS_ID,
          key("Monitor.serverMonitorSecretKey"),
          key("Monitor.incomingRequestSecretKey"),
          key("Monitor.incomingEmailSecretKey"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Workflow" ("_id", "version", "projectId", "name", "slug", "webhookSecretKey", "incomingEmailSecretKey") VALUES ($1, 1, $2, 'Workflow', $3, $4, $5)`,
        [
          ROW_ID["Workflow"],
          PROJECT_ID,
          `workflow-${ROW_ID["Workflow"]}`,
          key("Workflow.webhookSecretKey"),
          key("Workflow.incomingEmailSecretKey"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."Runbook" ("_id", "version", "projectId", "name", "slug", "webhookSecretKey") VALUES ($1, 1, $2, 'Runbook', $3, $4)`,
        [
          ROW_ID["Runbook"],
          PROJECT_ID,
          `runbook-${ROW_ID["Runbook"]}`,
          key("Runbook.webhookSecretKey"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."StatusPage" ("_id", "version", "projectId", "name", "slug", "embeddedOverallStatusToken") VALUES ($1, 1, $2, 'Status', $3, $4)`,
        [
          STATUS_PAGE_ID,
          PROJECT_ID,
          `status-${STATUS_PAGE_ID}`,
          key("StatusPage.embeddedOverallStatusToken"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."DataProduct" ("_id", "version", "projectId", "name", "badgeToken") VALUES ($1, 1, $2, 'Orders', $3)`,
        [ROW_ID["DataProduct"], PROJECT_ID, key("DataProduct.badgeToken")],
      );
      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber" ("_id", "version", "projectId", "statusPageId", "subscriberEmail", "unsubscribeToken") VALUES ($1, 1, $2, $3, 'reader@example.com', $4)`,
        [
          ROW_ID["StatusPageSubscriber"],
          PROJECT_ID,
          STATUS_PAGE_ID,
          key("StatusPageSubscriber.unsubscribeToken"),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."ProjectSCIM" ("_id", "version", "projectId", "name", "bearerToken") VALUES ($1, 1, $2, 'Okta', $3)`,
        [ROW_ID["ProjectSCIM"], PROJECT_ID, key("ProjectSCIM.bearerToken")],
      );
      await database.query(
        `INSERT INTO "${schema}"."StatusPageSCIM" ("_id", "version", "projectId", "statusPageId", "name", "bearerToken") VALUES ($1, 1, $2, $3, 'Okta', $4)`,
        [
          ROW_ID["StatusPageSCIM"],
          PROJECT_ID,
          STATUS_PAGE_ID,
          key("StatusPageSCIM.bearerToken"),
        ],
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["PRESENTED_KEYS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PRESENTED_KEYS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PRESENTED_KEYS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: {
          logQuery: (query: string, parameters?: Array<unknown>): void => {
            sent.push({ query, parameters });
          },
          logQueryError: (): void => {},
          logQuerySlow: (): void => {},
          logSchemaBuild: (): void => {},
          logMigration: (): void => {},
          log: (): void => {},
        },
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The tables as they were before the upgrade, newest migration first.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new MonitorKeysEncryptedColumns1809182930000().down(queryRunner);
        await new StatusPageSubscriberTokenEncryptedColumn1809182920000().down(
          queryRunner,
        );
        await new StatusPageEmbedTokenEncryptedColumn1809182910000().down(
          queryRunner,
        );
        await new PresentedKeysEncryptedColumns1809182900000().down(
          queryRunner,
        );
      });

      await seedAsWritten();
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      // Live updates, workflows and the audit log are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockResolvedValue(undefined as never);

      // A fresh server each test: it asks again whether keys are protected.
      PresentedKeysAtRest.forget();
      sent.length = 0;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("before the upgrade: every key as written, in the columns as they were, and a server of the release before finds each", async () => {
      expect(await columnType("TelemetryIngestionKey", "secretKey")).toBe(
        "uuid",
      );
      expect(await columnType("Monitor", "incomingRequestSecretKey")).toBe(
        "uuid",
      );
      expect(await columnType("Workflow", "incomingEmailSecretKey")).toBe(
        "uuid",
      );
      expect(await columnType("Runbook", "webhookSecretKey")).toBe(
        "character varying(100)",
      );
      expect(await columnType("DataProduct", "badgeToken")).toBe(
        "character varying(100)",
      );
      expect(await columnType("Monitor", "incomingRequestSecretKeyHash")).toBe(
        "none",
      );

      for (const target of TARGETS) {
        expect([
          nameOf(target),
          await releaseBeforeFinds(target, writtenOf(target)),
        ]).toEqual([nameOf(target), [ROW_ID[target.tableName]]]);
      }
    });

    test("the schema migrations keep every key as written; both releases find each, and refuse a wrong one", async () => {
      await withRunner(async (queryRunner: QueryRunner) => {
        await new PresentedKeysEncryptedColumns1809182900000().up(queryRunner);
        await new StatusPageEmbedTokenEncryptedColumn1809182910000().up(
          queryRunner,
        );
        await new StatusPageSubscriberTokenEncryptedColumn1809182920000().up(
          queryRunner,
        );
        await new MonitorKeysEncryptedColumns1809182930000().up(queryRunner);
      });

      expect(await columnType("TelemetryIngestionKey", "secretKey")).toBe(
        "text",
      );
      expect(await columnType("Monitor", "incomingRequestSecretKey")).toBe(
        "text",
      );
      expect(await columnType("DataProduct", "badgeToken")).toBe("text");

      for (const target of TARGETS) {
        expect([
          nameOf(target),
          await stored(target.tableName, target.column),
        ]).toEqual([nameOf(target), writtenOf(target)]);

        if (target.lookupHashColumn) {
          expect(
            await stored(target.tableName, target.lookupHashColumn),
          ).toBeNull();
        }
      }

      await expectBothReleasesFindEveryKey();
    });

    test("Postgres digests a key as the passes do, so their compare-and-set matches the key read", async () => {
      for (const target of TARGETS) {
        const rows: Array<{ digest: string }> = await database.query(
          `SELECT encode(sha256(convert_to("${target.column}", 'UTF8')), 'hex') AS "digest" FROM "${schema}"."${target.tableName}" WHERE "_id" = $1`,
          [ROW_ID[target.tableName]],
        );

        expect([nameOf(target), rows]).toEqual([
          nameOf(target),
          [{ digest: digestOfValueRead(writtenOf(target)) }],
        ]);
      }
    });

    test("the data migration writes each lookup hash and changes no key: both releases still find every key, and a second run changes nothing", async () => {
      await new HashPresentedKeysForLookup().migrate();
      await recordLookupHashesWritten(UPGRADED_AT);

      for (const target of TARGETS) {
        expect([
          nameOf(target),
          await stored(target.tableName, target.column),
        ]).toEqual([nameOf(target), writtenOf(target)]);

        if (target.lookupHashColumn) {
          expect([
            nameOf(target),
            await stored(target.tableName, target.lookupHashColumn),
          ]).toEqual([
            nameOf(target),
            PresentedKey.hash(writtenOf(target), target.columnType),
          ]);
        }
      }

      await expectBothReleasesFindEveryKey();

      const afterOne: Array<string | null> = await storedKeys();

      await new HashPresentedKeysForLookup().migrate();

      expect(await storedKeys()).toEqual(afterOne);
    });

    test("within the day after, the job keeps the lookup hashes up to date and changes no key", async () => {
      const heartbeat: PresentedKeyTarget = TARGETS.find(
        (target: PresentedKeyTarget): boolean => {
          return nameOf(target) === "Monitor.incomingRequestSecretKey";
        },
      )!;

      // A server of the release before gives the heartbeat a new key.
      await database.query(
        `UPDATE "${schema}"."Monitor" SET "incomingRequestSecretKey" = $1 WHERE "_id" = $2`,
        [CHANGED_DURING_UPGRADE, ROW_ID["Monitor"]],
      );

      expect(
        await PresentedKeysProtection.run({
          runner: database,
          now: new Date(A_DAY_AFTER.getTime() - 1),
        }),
      ).toBe(PresentedKeysProtectionOutcome.Waiting);

      expect(await stored("Monitor", "incomingRequestSecretKey")).toBe(
        CHANGED_DURING_UPGRADE,
      );
      expect(await stored("Monitor", "incomingRequestSecretKeyHash")).toBe(
        PresentedKey.hash(CHANGED_DURING_UPGRADE, TableColumnType.ObjectID),
      );
      expect(await thisReleaseFinds(heartbeat, CHANGED_DURING_UPGRADE)).toBe(
        ROW_ID["Monitor"],
      );
      expect(
        await thisReleaseFinds(heartbeat, writtenOf(heartbeat)),
      ).toBeNull();
      expect(await markersRecorded()).toBe(0);

      // Back to the key every other test expects, as written.
      await database.query(
        `UPDATE "${schema}"."Monitor" SET "incomingRequestSecretKey" = $1 WHERE "_id" = $2`,
        [writtenOf(heartbeat), ROW_ID["Monitor"]],
      );
      await new HashPresentedKeysForLookup().migrate();

      await expectBothReleasesFindEveryKey();
    });

    test("a day after, every key is encrypted or hashed in place, once: this release finds each with the key as written, refuses a wrong one, and sends no key to Postgres", async () => {
      expect(
        await PresentedKeysProtection.run({
          runner: database,
          now: A_DAY_AFTER,
        }),
      ).toBe(PresentedKeysProtectionOutcome.Protected);
      expect(await markersRecorded()).toBe(1);

      for (const target of TARGETS) {
        const value: string = String(
          await stored(target.tableName, target.column),
        );

        if (target.protection === PresentedKeyProtection.Hash) {
          expect([nameOf(target), value]).toEqual([
            nameOf(target),
            PresentedKey.toStoredHash(writtenOf(target)),
          ]);
        } else {
          expect([nameOf(target), Encryption.looksEncrypted(value)]).toEqual([
            nameOf(target),
            true,
          ]);
          expect(await Encryption.decrypt(value)).toBe(writtenOf(target));
        }

        expect(value).not.toContain(writtenOf(target));

        if (target.lookupHashColumn) {
          expect(await stored(target.tableName, target.lookupHashColumn)).toBe(
            PresentedKey.hash(writtenOf(target), target.columnType),
          );
        }

        // Nothing is stored as written any more: a plain compare finds nothing.
        expect([
          nameOf(target),
          await releaseBeforeFinds(target, writtenOf(target)),
        ]).toEqual([nameOf(target), []]);
      }

      PresentedKeysAtRest.forget();
      sent.length = 0;

      for (const target of TARGETS) {
        expect([
          nameOf(target),
          await thisReleaseFinds(target, writtenOf(target)),
        ]).toEqual([nameOf(target), ROW_ID[target.tableName]]);
        expect([
          nameOf(target),
          await thisReleaseFinds(target, wrongOf(target)),
        ]).toEqual([nameOf(target), null]);
      }

      // Every key was found, and none went into a statement or its parameters.
      const leaks: Array<string> = [];

      for (const target of TARGETS) {
        for (const query of sent) {
          if (
            query.query.includes(writtenOf(target)) ||
            JSON.stringify(query.parameters || []).includes(writtenOf(target))
          ) {
            leaks.push(`${nameOf(target)}: ${query.query}`);
          }
        }
      }

      expect(sent.length).toBeGreaterThan(0);
      expect(leaks).toEqual([]);

      // Run again: nothing changes, byte for byte.
      const afterOne: Array<string | null> = await storedKeys();

      expect(
        await PresentedKeysProtection.run({
          runner: database,
          now: A_DAY_AFTER,
        }),
      ).toBe(PresentedKeysProtectionOutcome.AlreadyProtected);
      expect(await storedKeys()).toEqual(afterOne);
      expect(await markersRecorded()).toBe(1);
    });

    test("where people see a key again, it reads as written", async () => {
      const probe: Probe | null = await ProbeService.findOneById({
        id: new ObjectID(ROW_ID["Probe"]!),
        select: { key: true },
        props: { isRoot: true },
      });
      const runner: Runner | null = await RunnerService.findOneById({
        id: new ObjectID(ROW_ID["Runner"]!),
        select: { key: true },
        props: { isRoot: true },
      });
      const credential: IoTDeviceCredential | null =
        await IoTDeviceCredentialService.findOneById({
          id: new ObjectID(ROW_ID["IoTDeviceCredential"]!),
          select: { secretKey: true },
          props: { isRoot: true },
        });
      const product: DataProduct | null = await DataProductService.findOneById({
        id: new ObjectID(ROW_ID["DataProduct"]!),
        select: { badgeToken: true },
        props: { isRoot: true },
      });

      expect(probe?.key).toBe(WRITTEN["Probe.key"]);
      expect(runner?.key).toBe(WRITTEN["Runner.key"]);
      expect(credential?.secretKey?.toString()).toBe(
        WRITTEN["IoTDeviceCredential.secretKey"],
      );
      expect(product?.badgeToken).toBe(WRITTEN["DataProduct.badgeToken"]);

      // A global probe registers with its key: found among the global probes.
      const globalProbe: Probe | null = await ProbeService.findGlobalProbeByKey(
        WRITTEN["Probe.key"]!,
      );

      expect(globalProbe?.id?.toString()).toBe(ROW_ID["Probe"]);
      expect(await ProbeService.findGlobalProbeByKey(WRONG_TEXT)).toBeNull();
    });

    test("two passes at once protect each key once", async () => {
      const runbook: PresentedKeyTarget = TARGETS.find(
        (target: PresentedKeyTarget): boolean => {
          return nameOf(target) === "Runbook.webhookSecretKey";
        },
      )!;
      const secondRunbookId: string = "90120000-0000-4000-8000-0000000000aa";
      const secondKey: string = "a-key-stored-as-written-by-the-release-before";

      await database.query(
        `INSERT INTO "${schema}"."Runbook" ("_id", "version", "projectId", "name", "slug", "webhookSecretKey") VALUES ($1, 1, $2, 'Second runbook', $3, $4)`,
        [secondRunbookId, PROJECT_ID, `runbook-${secondRunbookId}`, secondKey],
      );

      await Promise.all([
        PresentedKeysInPlace.protect({
          migrationName: "PresentedKeysAtRestPostgres",
          target: runbook,
        }),
        PresentedKeysInPlace.protect({
          migrationName: "PresentedKeysAtRestPostgres",
          target: runbook,
        }),
      ]);

      // Once: one decryption gives the key written, not another ciphertext.
      expect(
        await Encryption.decrypt(
          String(await stored("Runbook", "webhookSecretKey", secondRunbookId)),
        ),
      ).toBe(secondKey);
    });

    test("a key saved after the upgrade is stored protected at once, and found", async () => {
      const product: PresentedKeyTarget = TARGETS.find(
        (target: PresentedKeyTarget): boolean => {
          return nameOf(target) === "DataProduct.badgeToken";
        },
      )!;
      const scim: PresentedKeyTarget = TARGETS.find(
        (target: PresentedKeyTarget): boolean => {
          return nameOf(target) === "StatusPageSCIM.bearerToken";
        },
      )!;
      const newBadgeToken: string = ObjectID.generate().toString();
      const newBearerToken: string = PresentedKey.generate();

      // A badge reset writes without the hooks, as DataObservabilityAPI does.
      await DataProductService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(ROW_ID["DataProduct"]!),
        data: { badgeToken: newBadgeToken } as never,
      });
      // Reset Bearer Token, through the service.
      await StatusPageSCIMService.updateOneById({
        id: new ObjectID(ROW_ID["StatusPageSCIM"]!),
        data: { bearerToken: newBearerToken } as never,
        props: { isRoot: true },
      });

      const badgeStored: string = String(
        await stored("DataProduct", "badgeToken"),
      );

      expect(Encryption.looksEncrypted(badgeStored)).toBe(true);
      expect(await Encryption.decrypt(badgeStored)).toBe(newBadgeToken);
      expect(await stored("StatusPageSCIM", "bearerToken")).toBe(
        PresentedKey.toStoredHash(newBearerToken),
      );

      expect(await thisReleaseFinds(product, newBadgeToken)).toBe(
        ROW_ID["DataProduct"],
      );
      expect(await thisReleaseFinds(product, writtenOf(product))).toBeNull();
      expect(await thisReleaseFinds(scim, newBearerToken)).toBe(
        ROW_ID["StatusPageSCIM"],
      );
      expect(await thisReleaseFinds(scim, writtenOf(scim))).toBeNull();
      // The hash itself, presented as a token, is no token.
      expect(
        await thisReleaseFinds(scim, PresentedKey.toStoredHash(newBearerToken)),
      ).toBeNull();
    });

    test("rolled back, each column has its old type: an encrypted uuid key a new random one, an encrypted token cleared", async () => {
      await withRunner(async (queryRunner: QueryRunner) => {
        await new MonitorKeysEncryptedColumns1809182930000().down(queryRunner);
        await new StatusPageSubscriberTokenEncryptedColumn1809182920000().down(
          queryRunner,
        );
        await new StatusPageEmbedTokenEncryptedColumn1809182910000().down(
          queryRunner,
        );
        await new PresentedKeysEncryptedColumns1809182900000().down(
          queryRunner,
        );
      });

      expect(await columnType("Monitor", "incomingRequestSecretKey")).toBe(
        "uuid",
      );
      expect(await columnType("Monitor", "incomingRequestSecretKeyHash")).toBe(
        "none",
      );

      const heartbeatKey: string = String(
        await stored("Monitor", "incomingRequestSecretKey"),
      );

      expect(heartbeatKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(heartbeatKey).not.toBe(
        WRITTEN["Monitor.incomingRequestSecretKey"],
      );
      expect(await stored("DataProduct", "badgeToken")).toBeNull();
      expect(await stored("Runbook", "webhookSecretKey")).toBeNull();
      expect(
        await stored("StatusPage", "embeddedOverallStatusToken"),
      ).toBeNull();
      expect(
        await stored("StatusPageSubscriber", "unsubscribeToken"),
      ).toBeNull();
    });
  },
);
