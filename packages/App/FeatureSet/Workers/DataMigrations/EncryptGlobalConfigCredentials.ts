import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import DatabaseService from "Common/Server/Services/DatabaseService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

/*
 * The GlobalConfig columns this encrypts: every credential column of the
 * server's settings that was stored as written until it was declared
 * `encrypted: true` (#7739). The newer provider keys (Amazon SES, Mailgun,
 * Postmark, Resend) were encrypted from the start and are not listed.
 */
export const GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT: ReadonlyArray<
  keyof GlobalConfig
> = [
  "smtpPassword",
  "smtpClientSecret",
  "twilioAuthToken",
  "callAndSmsGatewaySecret",
  "metaWhatsAppAccessToken",
  "metaWhatsAppAppSecret",
  "metaWhatsAppWebhookVerifyToken",
  "telegramBotToken",
  "telegramWebhookSecretToken",
  "sendgridApiKey",
  "enterpriseLicenseKey",
  "enterpriseLicenseToken",
];

/*
 * Encrypts the server's credentials that were stored before their columns
 * were encrypted.
 *
 * The columns above are now encrypted (the model's `encrypted: true`), but
 * the server's settings row written before that holds each value as it was
 * written. This reads the row's raw values, and encrypts each one that is
 * set and not already our ciphertext (Encryption.looksEncrypted), writing
 * it back in raw SQL, so DatabaseService's own encrypt/decrypt never touch
 * it and the value is encrypted exactly once. A null or empty value is
 * left as it is.
 *
 * Each value is written only while the column still holds the value read
 * (WHERE ... = the value read): a value written since, through the
 * service, is already encrypted and stays as it is, and a second runner
 * at the same time writes nothing.
 *
 * Idempotent, and safe to run twice: a value that already looks encrypted
 * is left alone, so a second run rewrites nothing. Every reader reads the
 * same value before and after: DatabaseService.decrypt hands back a value
 * that is not our ciphertext untouched, and decrypts the rest to the value
 * that was encrypted.
 */
export default class EncryptGlobalConfigCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptGlobalConfigCredentials");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository =
      GlobalConfigService.getRepository() as unknown as ModelRepository;

    const tableName: string = repository.metadata.tableName;

    const columns: string = GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT.map(
      (column: keyof GlobalConfig): string => {
        return `"${String(column)}"`;
      },
    ).join(", ");

    let rows: Array<Record<string, unknown>> = [];

    try {
      rows = (await repository.manager.query(
        `SELECT "_id", ${columns} FROM "${tableName}"`,
      )) as Array<Record<string, unknown>>;
    } catch (err) {
      logger.error(
        "EncryptGlobalConfigCredentials: failed to read the server's settings to encrypt:",
      );
      logger.error(err);
      return;
    }

    for (const row of rows) {
      for (const column of GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT) {
        const value: unknown = row[String(column)];

        if (
          typeof value !== "string" ||
          !value ||
          Encryption.looksEncrypted(value)
        ) {
          // Not set, or already encrypted - nothing to do.
          continue;
        }

        try {
          const encrypted: string = await Encryption.encrypt(value);

          await repository.manager.query(
            `UPDATE "${tableName}" SET "${String(column)}" = $1 WHERE "_id" = $2 AND "${String(column)}" = $3`,
            [encrypted, row["_id"], value],
          );
        } catch (err) {
          /*
           * One value that cannot be encrypted must not cost the others
           * their encryption, nor halt every migration queued behind this
           * one. It still reads as itself.
           */
          logger.error(
            `EncryptGlobalConfigCredentials: failed to encrypt ${String(column)} of the server's settings ${String(row["_id"])}:`,
          );
          logger.error(err);
        }
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
