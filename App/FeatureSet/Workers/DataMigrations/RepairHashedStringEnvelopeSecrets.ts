import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import DataSourceService from "Common/Server/Services/DataSourceService";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import ThreatIntelFeedService from "Common/Server/Services/ThreatIntelFeedService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;
type ModelColumn = ReturnType<
  ModelRepository["metadata"]["findColumnWithPropertyName"]
>;

/*
 * What the broken write left in a column: HashedString.toJSON(), serialized
 * by the Postgres driver. Ends on the quote that opens a STRING value, so
 * only envelopes that carry a string are rewritten.
 */
export const HASHED_STRING_ENVELOPE_PREFIX: string =
  '{"_type":"HashedString","value":"';

export interface SecretColumns {
  service: DatabaseService<BaseModel>;
  columns: Array<string>;
}

/*
 * Every column a dashboard FormFieldSchemaType.Password field writes that
 * is not itself a hashed column.
 */
export const SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS: Array<SecretColumns> =
  [
    {
      // Security Events > Threat Intel: create form and Update Credentials.
      service: ThreatIntelFeedService as unknown as DatabaseService<BaseModel>,
      columns: ["apiToken", "basicAuthPassword"],
    },
    {
      // Dashboards > Settings > Data Sources: create form and Update Credentials.
      service: DataSourceService as unknown as DatabaseService<BaseModel>,
      columns: ["password", "apiToken"],
    },
    {
      // Settings > Runner Credentials.
      service:
        RunbookCredentialService as unknown as DatabaseService<BaseModel>,
      columns: ["sshPassphrase", "sshPassword"],
    },
    {
      // User Settings > Notification Methods > Webhooks (not encrypted).
      service: UserWebhookService as unknown as DatabaseService<BaseModel>,
      columns: ["secret"],
    },
  ];

/*
 * Repairs the secrets issue #3807 left at rest.
 *
 * BasicForm wraps every Password field value in a HashedString, and until
 * DatabaseService started unwrapping it, the write path stored the object's
 * JSON — '{"_type":"HashedString","value":"..."}' — in columns that expect
 * a plain string. For an encrypted column the envelope holds the
 * ciphertext, which DatabaseService.decrypt now unwraps on read; for the
 * webhook signing secret it holds the secret itself, and every signature
 * was being computed with the envelope as the key.
 *
 * This rewrites each envelope to the string inside it, in SQL, so a
 * ciphertext is moved byte-for-byte and never decrypted, re-encrypted or
 * passed through a hook-free write path that would store it unencrypted.
 * The prefix is compared literally rather than with LIKE, where the
 * underscore in "_type" is a wildcard.
 *
 * Idempotent, and safe to run twice concurrently: an unwrapped value no
 * longer matches the prefix, and a second UPDATE waiting on the first's row
 * lock re-checks its WHERE clause and skips the row.
 */
export default class RepairHashedStringEnvelopeSecrets extends DataMigrationBase {
  public constructor() {
    super("RepairHashedStringEnvelopeSecrets");
  }

  public override async migrate(): Promise<void> {
    for (const secretColumns of SECRET_COLUMNS_WRITTEN_FROM_PASSWORD_FIELDS) {
      for (const propertyName of secretColumns.columns) {
        try {
          await this.unwrapColumn(secretColumns.service, propertyName);
        } catch (err) {
          /*
           * One column that cannot be repaired must not cost the others
           * their repair, nor halt every migration queued behind this one.
           */
          logger.error(
            `RepairHashedStringEnvelopeSecrets: failed to repair ${propertyName}:`,
          );
          logger.error(err);
        }
      }
    }
  }

  private async unwrapColumn(
    service: DatabaseService<BaseModel>,
    propertyName: string,
  ): Promise<void> {
    const repository: ModelRepository = service.getRepository();

    const column: ModelColumn =
      repository.metadata.findColumnWithPropertyName(propertyName);

    if (!column) {
      throw new BadDataException(
        `Unknown column "${propertyName}" on "${repository.metadata.tableName}"`,
      );
    }

    const tableName: string = repository.metadata.tableName;
    const columnName: string = column.databaseName;

    const result: unknown = await repository.manager.query(
      `UPDATE "${tableName}" SET "${columnName}" = ("${columnName}"::json ->> 'value') WHERE left("${columnName}", char_length($1)) = $1`,
      [HASHED_STRING_ENVELOPE_PREFIX],
    );

    // The Postgres driver answers an UPDATE with [rows, affectedRowCount].
    const repairedRows: unknown = Array.isArray(result) ? result[1] : 0;

    if (typeof repairedRows === "number" && repairedRows > 0) {
      logger.info(
        `RepairHashedStringEnvelopeSecrets: repaired ${repairedRows} ${tableName}.${columnName} value(s).`,
      );
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
