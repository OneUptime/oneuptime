import EncryptColumnInPlace, { ModelRepository } from "./EncryptColumnInPlace";
import { digestOfValueRead } from "../DataMigrations/HashMasterApiKey";
import AIAgentService from "Common/Server/Services/AIAgentService";
import DataProductService from "Common/Server/Services/DataProductService";
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
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";
import TableColumnType from "Common/Types/Database/TableColumnType";

/*
 * How a key presented to OneUptime is kept (#9012): encrypted, so the people
 * who may read it see it again, or only as its hash (a SCIM bearer token).
 */
export enum PresentedKeyProtection {
  Encrypt = "encrypt",
  Hash = "hash",
}

// One column of one table whose keys were stored as written before #9012.
export interface PresentedKeyTarget {
  // What a row is, for the log: "monitor".
  kind: string;
  // The table, as its model names it: "Monitor".
  tableName: string;
  // Read when the target is used, so a list of targets needs no database.
  repository: ModelRepository;
  // The column, as the table names it: "incomingRequestSecretKey".
  column: string;
  protection: PresentedKeyProtection;
  // The column its lookup hash is kept in, when a request names the row by the key alone.
  lookupHashColumn?: string | undefined;
  // How the key is compared, and so hashed (PresentedKey.normalize).
  columnType: TableColumnType;
}

// What one pass over one column did.
export interface PresentedKeysPass {
  // Rows that held a key stored as written.
  read: number;
  // Rows written.
  written: number;
  // Rows that could not be written, or pages that could not be read.
  failed: number;
  // Whether the pass stopped at its deadline, with rows left.
  isCutShort: boolean;
}

type StoredRow = Record<string, unknown>;

/*
 * The service of a table with a presented key: its model, and its
 * repository. A model's tableName reads as string | null where null checks
 * are strict (ee's tsconfig), as string | undefined where they are not.
 */
interface KeyService {
  getModel: () => { tableName?: string | null | undefined };
  getRepository: () => unknown;
}

// A key OneUptime keeps only as its hash (PresentedKey.toStoredHash), in SQL.
const STORED_HASH_SQL_PATTERN: string = "^sha256\\$[0-9a-f]{64}$";

/*
 * THE KEYS PRESENTED TO ONEUPTIME THAT WERE STORED AS WRITTEN, PROTECTED IN
 * PLACE (#9012).
 *
 * A probe's key, a monitor's secret key, a SCIM bearer token: each is now
 * kept encrypted, or as its hash, on every write through its service. The
 * rows written before still hold the key as it was written. Two passes
 * protect them, so that a server of the release before - which compares a
 * key as written, and may still be running while an upgrade rolls out -
 * keeps checking every key (PresentedKeysAtRest):
 *
 *   writeLookupHashes  at the upgrade (HashPresentedKeysForLookup), and then
 *                      by every run of the PresentedKeys:ProtectAtRest job:
 *                      the lookup hash of each key stored as written, beside
 *                      it, where it is missing or is not that key's (a
 *                      server of the release before wrote the key). Changes
 *                      no key.
 *   protect            by the job, a day after the upgrade: each key stored
 *                      as written encrypted, or hashed, in place, with its
 *                      lookup hash.
 *
 * Each reads a page at a time, by id, in raw SQL - so DatabaseService's own
 * encryption never touches a value twice - soft-deleted rows included: a
 * key a deleted row kept is a key all the same. Each write lands only while
 * the row still holds the key read, compared by its digest
 * (digestOfValueRead), so no key is in any statement's parameters, a key
 * changed since through the service is left as its write stored it, and a
 * second runner at the same time writes nothing. Idempotent: a protected
 * key is never read again. No key is in any log line: one row that cannot
 * be written costs the others nothing, and says so by its id
 * (EncryptColumnInPlace.describeError).
 */
export default class PresentedKeysInPlace {
  // Rows read per query.
  public static readonly PAGE_SIZE: number = 500;

  // Every column whose keys are protected, in the order they are.
  public static getTargets(): Array<PresentedKeyTarget> {
    // A target of a service's table, its repository read when it is used.
    const targetOf: (
      service: KeyService,
      target: Omit<PresentedKeyTarget, "repository" | "tableName">,
    ) => PresentedKeyTarget = (
      service: KeyService,
      target: Omit<PresentedKeyTarget, "repository" | "tableName">,
    ): PresentedKeyTarget => {
      return {
        ...target,
        tableName: service.getModel().tableName || "",
        get repository(): ModelRepository {
          return service.getRepository() as ModelRepository;
        },
      };
    };

    return [
      targetOf(ProbeService, {
        kind: "probe",
        column: "key",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(RunnerService, {
        kind: "Runner",
        column: "key",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(AIAgentService, {
        kind: "AI agent",
        column: "key",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(TelemetryIngestionKeyService, {
        kind: "telemetry ingestion key",
        column: "secretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "secretKeyHash",
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(IoTDeviceCredentialService, {
        kind: "IoT device credential",
        column: "secretKey",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(MonitorService, {
        kind: "monitor",
        column: "serverMonitorSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "serverMonitorSecretKeyHash",
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(MonitorService, {
        kind: "monitor",
        column: "incomingRequestSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "incomingRequestSecretKeyHash",
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(MonitorService, {
        kind: "monitor",
        column: "incomingEmailSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "incomingEmailSecretKeyHash",
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(WorkflowService, {
        kind: "workflow",
        column: "webhookSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "webhookSecretKeyHash",
        columnType: TableColumnType.LongText,
      }),
      targetOf(WorkflowService, {
        kind: "workflow",
        column: "incomingEmailSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        lookupHashColumn: "incomingEmailSecretKeyHash",
        columnType: TableColumnType.ObjectID,
      }),
      targetOf(RunbookService, {
        kind: "runbook",
        column: "webhookSecretKey",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(StatusPageService, {
        kind: "status page",
        column: "embeddedOverallStatusToken",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(DataProductService, {
        kind: "data product",
        column: "badgeToken",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(StatusPageSubscriberService, {
        kind: "status page subscriber",
        column: "unsubscribeToken",
        protection: PresentedKeyProtection.Encrypt,
        columnType: TableColumnType.ShortText,
      }),
      targetOf(ProjectSCIMService, {
        kind: "project SCIM connection",
        column: "bearerToken",
        protection: PresentedKeyProtection.Hash,
        columnType: TableColumnType.HashedString,
      }),
      targetOf(StatusPageSCIMService, {
        kind: "status page SCIM connection",
        column: "bearerToken",
        protection: PresentedKeyProtection.Hash,
        columnType: TableColumnType.HashedString,
      }),
    ];
  }

  /*
   * The condition a row holds a key stored as written by: a value that is
   * not what this column keeps now - not our ciphertext (Encryption
   * .CIPHERTEXT_PREFIX), not a stored hash (PresentedKey.toStoredHash).
   */
  public static getStoredAsWrittenSql(target: PresentedKeyTarget): string {
    const column: string = `"${target.column}"`;

    const isProtected: string =
      target.protection === PresentedKeyProtection.Hash
        ? `${column} ~ '${STORED_HASH_SQL_PATTERN}'`
        : `${column} LIKE '${Encryption.CIPHERTEXT_PREFIX}%'`;

    return `${column} IS NOT NULL AND ${column} <> '' AND NOT (${isProtected})`;
  }

  /*
   * Writes, beside each key of `target` stored as written, its lookup hash,
   * where the column holds none or another key's. Changes no key: a server
   * of the release before keeps finding every key as written, and this
   * release's finds it by its hash.
   */
  public static async writeLookupHashes(data: {
    migrationName: string;
    target: PresentedKeyTarget;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
  }): Promise<PresentedKeysPass> {
    const lookupHashColumn: string | undefined = data.target.lookupHashColumn;

    if (!lookupHashColumn) {
      return { read: 0, written: 0, failed: 0, isCutShort: false };
    }

    return await PresentedKeysInPlace.eachStoredAsWritten({
      ...data,
      extraColumns: [lookupHashColumn],
      writeRow: async (row: StoredRow, key: string): Promise<boolean> => {
        const keyHash: string | null = PresentedKey.hash(
          key,
          data.target.columnType,
        );

        if (!keyHash || row[lookupHashColumn] === keyHash) {
          return false;
        }

        await PresentedKeysInPlace.updateRow({
          target: data.target,
          id: row["_id"],
          keyRead: key,
          set: { [lookupHashColumn]: keyHash },
        });

        return true;
      },
    });
  }

  /*
   * Encrypts, or hashes, each key of `target` stored as written, in place,
   * with its lookup hash beside it. A server of the release before compares
   * a key as written, so this runs only once none can still be running
   * (PresentedKeysAtRest.SETTLE_PERIOD_MS).
   */
  public static async protect(data: {
    migrationName: string;
    target: PresentedKeyTarget;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
  }): Promise<PresentedKeysPass> {
    return await PresentedKeysInPlace.eachStoredAsWritten({
      ...data,
      extraColumns: [],
      writeRow: async (row: StoredRow, key: string): Promise<boolean> => {
        const set: Record<string, string> = {
          [data.target.column]:
            data.target.protection === PresentedKeyProtection.Hash
              ? PresentedKey.toStoredHash(key)
              : await Encryption.encrypt(key),
        };

        if (data.target.lookupHashColumn) {
          const keyHash: string | null = PresentedKey.hash(
            key,
            data.target.columnType,
          );

          if (keyHash) {
            set[data.target.lookupHashColumn] = keyHash;
          }
        }

        await PresentedKeysInPlace.updateRow({
          target: data.target,
          id: row["_id"],
          keyRead: key,
          set: set,
        });

        return true;
      },
    });
  }

  /*
   * Whether `target` still holds a key stored as written - none once
   * protect() has been through it.
   */
  public static async hasKeysStoredAsWritten(
    target: PresentedKeyTarget,
  ): Promise<boolean> {
    const rows: unknown = await target.repository.manager.query(
      `SELECT 1 FROM "${target.repository.metadata.tableName}" WHERE ${PresentedKeysInPlace.getStoredAsWrittenSql(target)} LIMIT 1`,
    );

    return Array.isArray(rows) && rows.length > 0;
  }

  // Each row of `target` that holds a key stored as written, a page at a time.
  private static async eachStoredAsWritten(data: {
    migrationName: string;
    target: PresentedKeyTarget;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    extraColumns: Array<string>;
    writeRow: (row: StoredRow, key: string) => Promise<boolean>;
  }): Promise<PresentedKeysPass> {
    const pass: PresentedKeysPass = {
      read: 0,
      written: 0,
      failed: 0,
      isCutShort: false,
    };
    const pageSize: number = data.pageSize || PresentedKeysInPlace.PAGE_SIZE;
    const { kind, repository, column } = data.target;
    const tableName: string = repository.metadata.tableName;
    const columns: string = ["_id", column, ...data.extraColumns]
      .map((name: string): string => {
        return `"${name}"`;
      })
      .join(", ");

    let afterId: string | null = null;

    for (;;) {
      if (data.deadline?.hasPassed()) {
        pass.isCutShort = true;
        return pass;
      }

      let rows: Array<StoredRow> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT ${columns} FROM "${tableName}" WHERE ${PresentedKeysInPlace.getStoredAsWrittenSql(data.target)}${
            afterId === null ? "" : ` AND "_id" > $1`
          } ORDER BY "_id" ASC LIMIT ${pageSize}`,
          afterId === null ? [] : [afterId],
        )) as Array<StoredRow>;
      } catch (err) {
        pass.failed++;
        logger.error(
          `${data.migrationName}: failed to read the ${kind} rows' ${column}: ${EncryptColumnInPlace.describeError(err)}`,
        );
        return pass;
      }

      for (const row of rows) {
        const key: unknown = row[column];

        if (typeof key !== "string" || !key) {
          continue;
        }

        pass.read++;

        try {
          if (await data.writeRow(row, key)) {
            pass.written++;
          }
        } catch (err) {
          /*
           * One key that cannot be written must not cost the others theirs,
           * nor halt every migration queued behind this one. It still works
           * as it was written.
           */
          pass.failed++;
          logger.error(
            `${data.migrationName}: failed to write the ${column} of ${kind} ${String(row["_id"])}: ${EncryptColumnInPlace.describeError(err, key)}`,
          );
        }
      }

      if (rows.length < pageSize) {
        return pass;
      }

      const lastId: string = String(rows[rows.length - 1]!["_id"]);

      // A page that does not move on would be read again for ever.
      if (lastId === afterId) {
        return pass;
      }

      afterId = lastId;
    }
  }

  /*
   * One row's write, held to the key read: compared by its digest, so the
   * key is in no statement's parameters, and a key changed meanwhile - by
   * the service, already protected - is left as it is.
   */
  private static async updateRow(data: {
    target: PresentedKeyTarget;
    id: unknown;
    keyRead: string;
    set: Record<string, string>;
  }): Promise<void> {
    const columns: Array<string> = Object.keys(data.set);
    const assignments: string = columns
      .map((name: string, index: number): string => {
        return `"${name}" = $${index + 1}`;
      })
      .join(", ");
    const parameters: Array<unknown> = columns.map((name: string): unknown => {
      return data.set[name];
    });

    parameters.push(data.id, digestOfValueRead(data.keyRead));

    await data.target.repository.manager.query(
      `UPDATE "${data.target.repository.metadata.tableName}" SET ${assignments} WHERE "_id" = $${columns.length + 1} AND encode(sha256(convert_to("${data.target.column}", 'UTF8')), 'hex') = $${columns.length + 2}`,
      parameters,
    );
  }
}
