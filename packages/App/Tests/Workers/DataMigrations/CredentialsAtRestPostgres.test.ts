import EncryptGlobalConfigCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptGlobalConfigCredentials";
import EncryptLetsEncryptKeys from "../../../FeatureSet/Workers/DataMigrations/EncryptLetsEncryptKeys";
import EncryptProjectCallSMSConfigTwilioAuthToken from "../../../FeatureSet/Workers/DataMigrations/EncryptProjectCallSMSConfigTwilioAuthToken";
import EncryptProjectCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptProjectCredentials";
import EncryptSnmpCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptSnmpCredentials";
import EncryptUploadedCertificateKeys from "../../../FeatureSet/Workers/DataMigrations/EncryptUploadedCertificateKeys";
import EncryptWebhookAddresses from "../../../FeatureSet/Workers/DataMigrations/EncryptWebhookAddresses";
import MaskWebhookAddressesInLogs from "../../../FeatureSet/Workers/DataMigrations/MaskWebhookAddressesInLogs";
import MoveLegacySnmpV3AuthToColumns from "../../../FeatureSet/Workers/DataMigrations/MoveLegacySnmpV3AuthToColumns";
import CredentialsAtRest, {
  CredentialsAtRestOutcome,
  CredentialsAtRestRun,
  getProtectedMarkerName,
} from "../../../FeatureSet/Workers/Utils/CredentialsAtRest";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
} from "../../../FeatureSet/Workers/Utils/EncryptColumnInPlace";
import Entities from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { TwilioAuthTokenTextColumn1809182960000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182960000-TwilioAuthTokenTextColumn";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import { SETTLE_PERIOD_MS } from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import URL from "Common/Types/API/URL";
import { isEncryptedValue } from "Common/Types/Database/EncryptedValue";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import ObjectID from "Common/Types/ObjectID";
import { hasUsableCredentials } from "Common/Utils/NetworkDevice/SnmpCredentialUtil";
import WebhookAddressMask from "Common/Utils/WebhookAddressMask";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * THE UPGRADE THAT KEEPS STORED CREDENTIALS READABLE BY THE RELEASE BEFORE,
 * AND ENCRYPTS THEM A DAY LATER, ON A REAL POSTGRES (#9266, #9267, #9268).
 *
 * Every column the upgrade to 15 used to encrypt in place - a project's
 * mail, chat and webhook credentials (#8989), the webhook addresses
 * (#9013), the SNMP credentials (#9014), the certificate keys (#8920,
 * #8933), the server's own credentials (#7739) and the Twilio tokens - is
 * seeded as a server of the release before stored it, on the migrated
 * tables. Then the upgrade runs as it does - its data migrations, recorded
 * when they ran - and the CredentialsAtRest:EncryptInPlace job runs as it
 * would, at times of its own:
 *
 *   - during the upgrade, a server of the release before - which reads each
 *     column as it is stored - reads every value as written, and walks a
 *     device whose v3 credentials were only in its legacy object; this
 *     release reads every value as written too;
 *   - what a server of the release before saves meanwhile is stored as
 *     written, and the job, within the day, changes nothing;
 *   - a day later the job encrypts every value - those saved meanwhile
 *     too - and masks the addresses logged meanwhile; once a pass finds
 *     nothing left it records each migration's marker, and does nothing
 *     more; every value decrypts, once, to the value written;
 *   - on an install that ran those migrations when they still encrypted at
 *     once (15.0.0, builds of main), the job's pass comes at once and
 *     encrypts only what is left: every ciphertext stays byte for byte;
 *   - a Twilio auth token of 500 characters as written fits its column
 *     encrypted, as text, where the varchar(500) refused its ciphertext.
 *
 * Opt in with RUN_POSTGRES_CREDENTIALS_AT_REST_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema (search_path holds only that schema), dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from CREDENTIALS_AT_REST_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from CREDENTIALS_AT_REST_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CREDENTIALS_AT_REST_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "DataMigrations",
  "ProjectCallSMSConfig",
  "GlobalConfig",
  "StatusPageDomain",
  "DashboardDomain",
  "FormDomain",
  "AcmeCertificate",
  "ProjectSMTPConfig",
  "WorkspaceProjectAuthToken",
  "WorkspaceUserAuthToken",
  "CodeRepository",
  "UserWebhook",
  "StatusPageSubscriber",
  "OpenStackProjectNotice",
  "CustomNotificationChannel",
  "NetworkDevice",
  "NetworkDeviceDiscoveryScan",
  "WebhookLog",
  "UserOnCallLogTimeline",
];

// The data migrations whose columns these are, in the order they run.
const MIGRATIONS: Array<{
  name: string;
  getTargets: () => Array<ColumnToEncrypt>;
}> = [
  {
    name: new EncryptProjectCallSMSConfigTwilioAuthToken().name,
    getTargets: EncryptProjectCallSMSConfigTwilioAuthToken.getTargets,
  },
  {
    name: new EncryptGlobalConfigCredentials().name,
    getTargets: EncryptGlobalConfigCredentials.getTargets,
  },
  {
    name: new EncryptUploadedCertificateKeys().name,
    getTargets: EncryptUploadedCertificateKeys.getTargets,
  },
  {
    name: new EncryptLetsEncryptKeys().name,
    getTargets: EncryptLetsEncryptKeys.getTargets,
  },
  {
    name: new EncryptProjectCredentials().name,
    getTargets: EncryptProjectCredentials.getTargets,
  },
  {
    name: new EncryptWebhookAddresses().name,
    getTargets: EncryptWebhookAddresses.getTargets,
  },
  {
    name: new EncryptSnmpCredentials().name,
    getTargets: EncryptSnmpCredentials.getTargets,
  },
];

// The columns of URL type, whose transformer writes the URL as its text.
const URL_COLUMNS: ReadonlyArray<string> = [
  "StatusPageSubscriber.slackIncomingWebhookUrl",
  "StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl",
  "StatusPageSubscriber.subscriberWebhook",
  "UserWebhook.webhookUrl",
  "OpenStackProjectNotice.webhookUrl",
];

const LEGACY_AUTH_KEY: string = "a legacy auth passphrase";
const LEGACY_PRIV_KEY: string = "a legacy privacy passphrase";

// The server's settings: one row, as an install has.
const SERVER_SETTINGS_ID: string = ObjectID.getZeroObjectID().toString();

// One credential, in one row: what it is, and what it holds as written.
interface Credential {
  migration: string;
  table: string;
  column: string;
  id: string;
  jsonFields?: ReadonlyArray<string> | undefined;
  // As a server of the release before stored it.
  stored: unknown;
  // As a reader of this release reads it, through DatabaseService.
  read: unknown;
}

function written(table: string, column: string, round: string): unknown {
  const name: string = `${table}.${column}`;

  if (URL_COLUMNS.includes(name)) {
    return URL.fromString(
      `https://hooks.example.com/${table}/${column}/s3cr3t-${round}`,
    ).toString();
  }

  if (name === "OpenStackProjectNotice.previewedRecipient") {
    return `webhook:https://notices.example.com/s3cr3t-${round}`;
  }

  if (name === "NetworkDevice.snmpV3Auth") {
    return {
      securityLevel: "authPriv",
      username: `legacy-${round}`,
      authProtocol: "SHA",
      authKey: `${LEGACY_AUTH_KEY} ${round}`,
      privProtocol: "AES",
      privKey: `${LEGACY_PRIV_KEY} ${round}`,
    };
  }

  if (name === "NetworkDeviceDiscoveryScan.snmpConfigs") {
    return [
      {
        id: "access",
        name: "Access switches",
        snmpVersion: "V2c",
        snmpCommunityString: `community ${round}`,
        snmpPort: 161,
      },
      {
        id: "core",
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3AuthKey: `auth key ${round}`,
        snmpV3PrivKey: `priv key ${round}`,
      },
    ];
  }

  // Spaces, symbols and a line break kept, exactly as written.
  return `${name} as written ${round} & !#% \n end`;
}

describePostgres(
  "the upgrade that keeps credentials readable by the release before, and encrypts them a day later (Postgres)",
  () => {
    const schema: string = `credentials_at_rest_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

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

    // Every column a row must have, that has no default, and its type.
    const requiredColumns: Map<
      string,
      Array<{ name: string; type: string }>
    > = new Map();

    async function columnsRequiredBy(
      table: string,
    ): Promise<Array<{ name: string; type: string }>> {
      if (!requiredColumns.has(table)) {
        const rows: Array<{ name: string; type: string }> =
          await database.query(
            `SELECT column_name AS "name", data_type AS "type" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_default IS NULL`,
            [schema, table],
          );

        requiredColumns.set(table, rows);
      }

      return requiredColumns.get(table)!;
    }

    // A row of `table` holding `values`, every other required column filled.
    async function insertRow(
      table: string,
      values: Record<string, unknown>,
    ): Promise<void> {
      const row: Record<string, unknown> = { ...values };
      const unique: string = ObjectID.generate().toString();

      for (const { name, type } of await columnsRequiredBy(table)) {
        if (name in row) {
          continue;
        }

        row[name] =
          type === "uuid"
            ? ObjectID.generate().toString()
            : type === "integer" || type === "bigint" || type === "smallint"
              ? 1
              : type === "boolean"
                ? false
                : type.startsWith("timestamp")
                  ? new Date()
                  : type === "jsonb" || type === "json"
                    ? "{}"
                    : `${name}-${unique}`;
      }

      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];

          return value !== null &&
            typeof value === "object" &&
            !(value instanceof Date)
            ? JSON.stringify(value)
            : value;
        }),
      );
    }

    // What a server of the release before reads: the column as it is stored.
    async function storedValue(
      table: string,
      id: string,
      column: string,
    ): Promise<unknown> {
      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "${column}" AS "value" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );

      return rows[0]?.["value"] ?? null;
    }

    function modelTypeOf(table: string): { new (): DatabaseBaseModel } {
      const modelType: { new (): DatabaseBaseModel } | undefined = (
        Entities as Array<{ new (): DatabaseBaseModel }>
      ).find((candidate: { new (): DatabaseBaseModel }): boolean => {
        return database.getMetadata(candidate).tableName === table;
      });

      if (!modelType) {
        throw new Error(`no model is stored in ${table}`);
      }

      return modelType;
    }

    // What a reader of this release reads: the column through DatabaseService.
    async function readValue(
      table: string,
      id: string,
      column: string,
    ): Promise<unknown> {
      const service: DatabaseService<DatabaseBaseModel> =
        new DatabaseService<DatabaseBaseModel>(modelTypeOf(table));
      const record: DatabaseBaseModel | null = await service.findOneById({
        id: new ObjectID(id),
        select: { [column]: true } as never,
        props: { isRoot: true },
      });
      const value: unknown = (record as unknown as Record<string, unknown>)?.[
        column
      ];

      return value instanceof URL ? value.toString() : value ?? null;
    }

    /*
     * One credential per column every migration names, as written: each in a
     * row of its own, but the server's settings, which are one row - a
     * later round writes over the columns of the one before.
     */
    async function seedCredentials(round: string): Promise<Array<Credential>> {
      const credentials: Array<Credential> = [];

      for (const migration of MIGRATIONS) {
        for (const target of migration.getTargets()) {
          const table: string = target.repository.metadata.tableName;
          const id: string =
            table === "GlobalConfig"
              ? SERVER_SETTINGS_ID
              : ObjectID.generate().toString();
          const value: unknown = written(table, target.column, round);

          if (
            table === "GlobalConfig" &&
            (
              (await database.query(
                `SELECT 1 FROM "${schema}"."GlobalConfig" WHERE "_id" = $1`,
                [id],
              )) as Array<unknown>
            ).length > 0
          ) {
            await database.query(
              `UPDATE "${schema}"."GlobalConfig" SET "${target.column}" = $1 WHERE "_id" = $2`,
              [value, id],
            );
          } else {
            await insertRow(table, { _id: id, [target.column]: value });
          }

          credentials.push({
            migration: migration.name,
            table: table,
            column: target.column,
            id: id,
            jsonFields: target.jsonFields,
            stored: value,
            read: value,
          });
        }
      }

      return credentials;
    }

    // The webhook log and the on-call log, as a server of the release before keeps them.
    async function seedLogs(round: string): Promise<{
      logId: string;
      lineId: string;
      address: string;
    }> {
      const address: string = `https://hooks.slack.com/services/T0/B0/${round}-s3cr3t`;
      const logId: string = ObjectID.generate().toString();
      const lineId: string = ObjectID.generate().toString();

      await insertRow("WebhookLog", {
        _id: logId,
        webhookUrl: address,
        statusMessage: `connect ECONNREFUSED ${address}`,
        status: "Error",
      });
      await insertRow("UserOnCallLogTimeline", {
        _id: lineId,
        statusMessage: `Sending webhook to ${address}.`,
        status: "Sending",
      });

      return { logId, lineId, address };
    }

    // The upgrade's data migrations, recorded when they ran, as the runner records them.
    async function upgradeAt(executedAt: Date): Promise<void> {
      const migrations: Array<{ name: string; migrate: () => Promise<void> }> =
        [
          new EncryptProjectCallSMSConfigTwilioAuthToken(),
          new EncryptGlobalConfigCredentials(),
          new EncryptUploadedCertificateKeys(),
          new EncryptLetsEncryptKeys(),
          new EncryptProjectCredentials(),
          new EncryptWebhookAddresses(),
          new EncryptSnmpCredentials(),
          new MoveLegacySnmpV3AuthToColumns(),
          new MaskWebhookAddressesInLogs(),
        ];

      for (const migration of migrations) {
        await migration.migrate();
        await recordRun(migration.name, executedAt);
      }
    }

    async function recordRun(name: string, executedAt: Date): Promise<void> {
      await insertRow("DataMigrations", {
        _id: ObjectID.generate().toString(),
        name: name,
        executed: true,
        executedAt: executedAt,
      });
    }

    async function runJobAt(now: Date): Promise<Array<CredentialsAtRestRun>> {
      return await CredentialsAtRest.run({ runner: database, now: now });
    }

    // Every credential, as the release before reads it and as this one does.
    async function expectReadAsWritten(
      credentials: Array<Credential>,
    ): Promise<void> {
      for (const credential of credentials) {
        const name: string = `${credential.table}.${credential.column}`;

        expect([
          name,
          await storedValue(credential.table, credential.id, credential.column),
        ]).toEqual([name, credential.stored]);
        expect([
          name,
          await readValue(credential.table, credential.id, credential.column),
        ]).toEqual([name, credential.read]);
      }
    }

    // Every credential stored encrypted, once, and read as written.
    async function expectEncryptedOnce(
      credentials: Array<Credential>,
    ): Promise<void> {
      for (const credential of credentials) {
        const name: string = `${credential.table}.${credential.column}`;
        const stored: unknown = await storedValue(
          credential.table,
          credential.id,
          credential.column,
        );

        if (credential.jsonFields) {
          const read: unknown = credential.read;
          const entries: Array<JSONObject> = (
            Array.isArray(stored) ? stored : [stored]
          ) as Array<JSONObject>;
          const asWritten: Array<JSONObject> = (
            Array.isArray(read) ? read : [read]
          ) as Array<JSONObject>;

          for (const [index, entry] of entries.entries()) {
            for (const field of Object.keys(entry)) {
              const value: unknown = entry[field];

              if (!credential.jsonFields.includes(field)) {
                // Its other fields stay readable, as written.
                expect([name, field, value]).toEqual([
                  name,
                  field,
                  asWritten[index]![field],
                ]);
                continue;
              }

              expect([name, field, isEncryptedValue(value)]).toEqual([
                name,
                field,
                true,
              ]);
              expect([
                name,
                field,
                await Encryption.decrypt(String(value)),
              ]).toEqual([name, field, asWritten[index]![field]]);
            }
          }
        } else {
          expect([name, isEncryptedValue(stored)]).toEqual([name, true]);
          expect([name, await Encryption.decrypt(String(stored))]).toEqual([
            name,
            credential.stored,
          ]);
        }

        expect([
          name,
          await readValue(credential.table, credential.id, credential.column),
        ]).toEqual([name, credential.read]);
      }
    }

    /*
     * A device's legacy v3 object moves into its columns at the upgrade
     * (MoveLegacySnmpV3AuthToColumns): each such credential is read from the
     * columns afterwards, the object cleared.
     */
    function afterTheLegacyMove(
      credentials: Array<Credential>,
    ): Array<Credential> {
      const moved: Array<Credential> = [];

      for (const credential of credentials) {
        if (
          `${credential.table}.${credential.column}` !==
          "NetworkDevice.snmpV3Auth"
        ) {
          moved.push(credential);
          continue;
        }

        const legacy: JSONObject = credential.stored as JSONObject;

        for (const [column, field] of [
          ["snmpV3AuthKey", "authKey"],
          ["snmpV3PrivKey", "privKey"],
        ] as Array<[string, string]>) {
          moved.push({
            ...credential,
            column: column,
            jsonFields: undefined,
            stored: legacy[field],
            read: legacy[field],
          });
        }
      }

      return moved;
    }

    // The credentials as they are now: a later write of a row's column wins.
    function latest(credentials: Array<Credential>): Array<Credential> {
      const byPlace: Map<string, Credential> = new Map();

      for (const credential of credentials) {
        byPlace.set(
          `${credential.table}.${credential.id}.${credential.column}`,
          credential,
        );
      }

      return Array.from(byPlace.values());
    }

    async function markers(): Promise<Array<string>> {
      const rows: Array<{ name: string }> = await database.query(
        `SELECT "name" FROM "${schema}"."DataMigrations" WHERE "name" LIKE 'CredentialsAtRest:%' ORDER BY "name"`,
      );

      return rows.map((row: { name: string }): string => {
        return row.name;
      });
    }

    async function emptyTables(): Promise<void> {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["CREDENTIALS_AT_REST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["CREDENTIALS_AT_REST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["CREDENTIALS_AT_REST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
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
    }, 120000);

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

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      await emptyTables();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the upgrade leaves every credential readable by the release before; a day later the job encrypts every one, those it saved meanwhile too", async () => {
      const upgradedAt: Date = new Date();
      const before: Array<Credential> = await seedCredentials("before");
      const logged: { logId: string; lineId: string; address: string } =
        await seedLogs("before");

      // 39 columns: the Twilio token, the server's 12, 3 + 1 certificate keys, #8989's 6, #9013's 8, #9014's 8.
      expect(before).toHaveLength(39);
      await expectReadAsWritten(before);

      await upgradeAt(upgradedAt);

      /*
       * During the upgrade: a server of the release before reads every
       * credential as stored - as written - and so does this release.
       */
      const duringTheUpgrade: Array<Credential> = afterTheLegacyMove(before);

      await expectReadAsWritten(duringTheUpgrade);

      // The device whose v3 credentials were only in its object: walked by both.
      const legacyDevice: Credential = before.find((credential: Credential) => {
        return (
          `${credential.table}.${credential.column}` ===
          "NetworkDevice.snmpV3Auth"
        );
      })!;

      expect(
        await storedValue("NetworkDevice", legacyDevice.id, "snmpV3Auth"),
      ).toBeNull();
      expect(
        hasUsableCredentials({
          snmpVersion: "V3",
          snmpV3Username: (await storedValue(
            "NetworkDevice",
            legacyDevice.id,
            "snmpV3Username",
          )) as string,
        }),
      ).toBe(true);

      // The logs keep a webhook by its scheme and host: harmless to the release before.
      const masked: string = WebhookAddressMask.mask(logged.address);

      expect(await storedValue("WebhookLog", logged.logId, "webhookUrl")).toBe(
        masked,
      );
      expect(
        await storedValue(
          "UserOnCallLogTimeline",
          logged.lineId,
          "statusMessage",
        ),
      ).toBe("Sending webhook.");

      // A server of the release before saves credentials meanwhile, as written.
      const savedMeanwhile: Array<Credential> =
        await seedCredentials("saved-meanwhile");
      const loggedMeanwhile: {
        logId: string;
        lineId: string;
        address: string;
      } = await seedLogs("logged-meanwhile");

      // The server's settings are one row: what it saved is what they hold.
      const everyCredential: Array<Credential> = latest([
        ...duringTheUpgrade,
        ...savedMeanwhile,
      ]);

      // Within the day the job changes nothing.
      const withinTheDay: Array<CredentialsAtRestRun> = await runJobAt(
        new Date(upgradedAt.getTime() + 60 * 60 * 1000),
      );

      expect(
        withinTheDay.every((run: CredentialsAtRestRun): boolean => {
          return run.outcome === CredentialsAtRestOutcome.Waiting;
        }),
      ).toBe(true);
      expect(withinTheDay).toHaveLength(8);
      await expectReadAsWritten(everyCredential);
      expect(await markers()).toEqual([]);

      // A day later: everything as written is encrypted, and recorded once nothing is left.
      const aDayLater: Date = new Date(
        upgradedAt.getTime() + SETTLE_PERIOD_MS + 1000,
      );

      const first: Array<CredentialsAtRestRun> = await runJobAt(aDayLater);

      // It encrypted values: the next run is to find none left. The mask is done in one.
      expect(
        first.map((run: CredentialsAtRestRun): string => {
          return `${run.migrationName}: ${run.outcome}`;
        }),
      ).toEqual([
        ...MIGRATIONS.map((migration: { name: string }): string => {
          return `${migration.name}: ${CredentialsAtRestOutcome.NotDoneYet}`;
        }),
        `MaskWebhookAddressesInLogs: ${CredentialsAtRestOutcome.Protected}`,
      ]);

      const second: Array<CredentialsAtRestRun> = await runJobAt(aDayLater);

      expect(
        second.map((run: CredentialsAtRestRun): string => {
          return `${run.migrationName}: ${run.outcome}`;
        }),
      ).toEqual([
        ...MIGRATIONS.map((migration: { name: string }): string => {
          return `${migration.name}: ${CredentialsAtRestOutcome.Protected}`;
        }),
        `MaskWebhookAddressesInLogs: ${CredentialsAtRestOutcome.AlreadyProtected}`,
      ]);
      expect(await markers()).toEqual(
        [
          ...MIGRATIONS.map((migration: { name: string }) => {
            return migration.name;
          }),
          "MaskWebhookAddressesInLogs",
        ]
          .map(getProtectedMarkerName)
          .sort(),
      );

      await expectEncryptedOnce(everyCredential);

      // What the release before logged meanwhile is masked too.
      expect(
        await storedValue("WebhookLog", loggedMeanwhile.logId, "webhookUrl"),
      ).toBe(WebhookAddressMask.mask(loggedMeanwhile.address));
      expect(
        await storedValue(
          "UserOnCallLogTimeline",
          loggedMeanwhile.lineId,
          "statusMessage",
        ),
      ).toBe("Sending webhook.");

      /*
       * The legacy device a server of the release before saved meanwhile -
       * its object written after the move - is walked with it, its keys
       * encrypted inside it.
       */
      const savedLegacy: Credential = savedMeanwhile.find(
        (credential: Credential) => {
          return (
            `${credential.table}.${credential.column}` ===
            "NetworkDevice.snmpV3Auth"
          );
        },
      )!;
      const device: NetworkDevice | null =
        await new DatabaseService<NetworkDevice>(NetworkDevice).findOneById({
          id: new ObjectID(savedLegacy.id),
          select: NetworkDeviceHydrationUtil.snmpConfigSelect,
          props: { isRoot: true },
        });

      device!.snmpVersion = "V3";

      expect(NetworkDeviceHydrationUtil.resolvePollMode(device!)).toBe("snmp");

      const walk: MonitorStepSnmpMonitor =
        NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
          hostname: "10.0.0.1",
          credentials: device!,
          oids: [],
          monitorInterfaces: true,
        });

      expect(walk.snmpV3Auth).toEqual(savedLegacy.stored);

      // Once recorded, a run changes nothing, byte for byte.
      const values: Array<unknown> = [];

      for (const credential of everyCredential) {
        values.push(
          await storedValue(credential.table, credential.id, credential.column),
        );
      }

      const third: Array<CredentialsAtRestRun> = await runJobAt(
        new Date(aDayLater.getTime() + SETTLE_PERIOD_MS),
      );

      expect(
        third.every((run: CredentialsAtRestRun): boolean => {
          return run.outcome === CredentialsAtRestOutcome.AlreadyProtected;
        }),
      ).toBe(true);

      const valuesAfter: Array<unknown> = [];

      for (const credential of everyCredential) {
        valuesAfter.push(
          await storedValue(credential.table, credential.id, credential.column),
        );
      }

      expect(valuesAfter).toEqual(values);
    });

    test("on an install that ran the migrations when they still encrypted at once, the job encrypts only what is left: no ciphertext twice", async () => {
      const ranAt: Date = new Date(Date.now() - 7 * SETTLE_PERIOD_MS);
      const encryptedThen: Array<Credential> = afterTheLegacyMove(
        await seedCredentials("encrypted-then"),
      );

      // As the merged migrations did: every value encrypted in place, at that upgrade.
      for (const migration of MIGRATIONS) {
        for (const target of migration.getTargets()) {
          await EncryptColumnInPlace.encrypt({
            migrationName: migration.name,
            target: target,
          });
        }
      }

      await new MoveLegacySnmpV3AuthToColumns().migrate();

      for (const migration of [
        ...MIGRATIONS.map((entry: { name: string }) => {
          return entry.name;
        }),
        "MoveLegacySnmpV3AuthToColumns",
        "MaskWebhookAddressesInLogs",
      ]) {
        await recordRun(migration, ranAt);
      }

      await expectEncryptedOnce(encryptedThen);

      const ciphertexts: Array<unknown> = [];

      for (const credential of encryptedThen) {
        ciphertexts.push(
          await storedValue(credential.table, credential.id, credential.column),
        );
      }

      // What a server of the release before saved as written, during that upgrade.
      const leftAsWritten: Array<Credential> =
        await seedCredentials("left-as-written");

      // The server's settings are one row: written over then, they hold the later values.
      const untouched: Array<Credential> = encryptedThen.filter(
        (credential: Credential): boolean => {
          return credential.table !== "GlobalConfig";
        },
      );
      const everyCredential: Array<Credential> = latest([
        ...encryptedThen,
        ...leftAsWritten,
      ]);

      // Its wait is long over: the first run of the job encrypts what is left.
      await runJobAt(new Date());

      const second: Array<CredentialsAtRestRun> = await runJobAt(new Date());

      expect(
        second.map((run: CredentialsAtRestRun): string => {
          return `${run.migrationName}: ${run.outcome}`;
        }),
      ).toEqual([
        ...MIGRATIONS.map((migration: { name: string }): string => {
          return `${migration.name}: ${CredentialsAtRestOutcome.Protected}`;
        }),
        `MaskWebhookAddressesInLogs: ${CredentialsAtRestOutcome.AlreadyProtected}`,
      ]);

      await expectEncryptedOnce(everyCredential);

      // Every ciphertext from then, byte for byte: never encrypted twice.
      const after: Array<unknown> = [];

      for (const credential of untouched) {
        after.push(
          await storedValue(credential.table, credential.id, credential.column),
        );
      }

      expect(after).toEqual(
        ciphertexts.filter((_value: unknown, index: number): boolean => {
          return encryptedThen[index]!.table !== "GlobalConfig";
        }),
      );
    });

    test("two runs of the job at once encrypt each value once", async () => {
      const upgradedAt: Date = new Date(Date.now() - 2 * SETTLE_PERIOD_MS);
      const credentials: Array<Credential> = afterTheLegacyMove(
        await seedCredentials("twice-at-once"),
      );

      await upgradeAt(upgradedAt);

      await Promise.all([runJobAt(new Date()), runJobAt(new Date())]);

      // Decrypted once, each is the value: not a ciphertext of a ciphertext.
      await expectEncryptedOnce(credentials);
    });

    test("a Twilio auth token of 500 characters as written is stored encrypted, in its text column, where its varchar(500) refused the ciphertext", async () => {
      const configId: string = ObjectID.generate().toString();
      const service: DatabaseService<ProjectCallSMSConfig> =
        new DatabaseService<ProjectCallSMSConfig>(ProjectCallSMSConfig);
      const token: string = "t".repeat(500);

      await insertRow("ProjectCallSMSConfig", {
        _id: configId,
        twilioAccountSID: "AC00000000000000000000000000000001",
        twilioAuthToken: "0123456789abcdef0123456789abcdef",
      });

      // Before #9267: the column as it was, refusing the 704-character ciphertext.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new TwilioAuthTokenTextColumn1809182960000().down(queryRunner);
      });

      await expect(
        service.updateOneById({
          id: new ObjectID(configId),
          data: { twilioAuthToken: token } as never,
          props: { isRoot: true },
        }),
      ).rejects.toThrow();

      // The token stored before is kept by the migration, both ways.
      expect(
        await storedValue("ProjectCallSMSConfig", configId, "twilioAuthToken"),
      ).toBe("0123456789abcdef0123456789abcdef");

      await withRunner(async (queryRunner: QueryRunner) => {
        await new TwilioAuthTokenTextColumn1809182960000().up(queryRunner);
      });

      expect(
        await storedValue("ProjectCallSMSConfig", configId, "twilioAuthToken"),
      ).toBe("0123456789abcdef0123456789abcdef");

      const types: Array<{ data_type: string; max: number | null }> =
        await database.query(
          `SELECT data_type, character_maximum_length AS "max" FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'ProjectCallSMSConfig' AND column_name = 'twilioAuthToken'`,
          [schema],
        );

      expect(types[0]).toEqual({ data_type: "text", max: null });

      await service.updateOneById({
        id: new ObjectID(configId),
        data: { twilioAuthToken: token } as never,
        props: { isRoot: true },
      });

      const stored: string = String(
        await storedValue("ProjectCallSMSConfig", configId, "twilioAuthToken"),
      );

      expect(stored).toHaveLength(704);
      expect(await Encryption.decrypt(stored)).toBe(token);
      expect(
        await readValue("ProjectCallSMSConfig", configId, "twilioAuthToken"),
      ).toBe(token);

      // One character more is refused, naming the field, before it is encrypted.
      await expect(
        service.updateOneById({
          id: new ObjectID(configId),
          data: { twilioAuthToken: `${token}t` } as never,
          props: { isRoot: true },
        }),
      ).rejects.toThrow("twilioAuthToken can be at most 500 characters long");
    });
  },
);
