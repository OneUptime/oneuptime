import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

/*
 * Encrypts the Twilio auth tokens that were stored before the column became a
 * secret.
 *
 * ProjectCallSMSConfig.twilioAuthToken is now encrypted at rest (the model's
 * `encrypted: true`), but a row written before that holds the token as
 * plaintext. This reads each config's raw token, and when it is not already
 * our ciphertext (Encryption.looksEncrypted) encrypts it and writes it back —
 * in raw SQL, so DatabaseService's own encrypt/decrypt hooks never touch it
 * and the value is encrypted exactly once.
 *
 * Idempotent, and safe to run twice: a value that already looks encrypted is
 * left alone, so a second run rewrites nothing. The read path tolerates the
 * window before this finishes: DatabaseService.decrypt hands back a value
 * that is not our ciphertext untouched, so a not-yet-encrypted token still
 * reads as itself.
 */
export default class EncryptProjectCallSMSConfigTwilioAuthToken extends DataMigrationBase {
  public constructor() {
    super("EncryptProjectCallSMSConfigTwilioAuthToken");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository =
      ProjectCallSMSConfigService.getRepository() as unknown as ModelRepository;

    const tableName: string = repository.metadata.tableName;

    let rows: Array<{ _id: string; twilioAuthToken: string | null }> = [];

    try {
      rows = (await repository.manager.query(
        `SELECT "_id", "twilioAuthToken" FROM "${tableName}" WHERE "twilioAuthToken" IS NOT NULL AND "twilioAuthToken" <> ''`,
      )) as Array<{ _id: string; twilioAuthToken: string | null }>;
    } catch (err) {
      logger.error(
        "EncryptProjectCallSMSConfigTwilioAuthToken: failed to read the configs to encrypt:",
      );
      logger.error(err);
      return;
    }

    for (const row of rows) {
      const plaintext: string | null = row.twilioAuthToken;

      if (!plaintext || Encryption.looksEncrypted(plaintext)) {
        // Empty, or already encrypted by an earlier run — nothing to do.
        continue;
      }

      try {
        const encrypted: string = await Encryption.encrypt(plaintext);

        await repository.manager.query(
          `UPDATE "${tableName}" SET "twilioAuthToken" = $1 WHERE "_id" = $2 AND "twilioAuthToken" = $3`,
          [encrypted, row._id, plaintext],
        );
      } catch (err) {
        /*
         * One config that cannot be encrypted must not cost the others their
         * encryption, nor halt every migration queued behind this one.
         */
        logger.error(
          `EncryptProjectCallSMSConfigTwilioAuthToken: failed to encrypt config ${row._id}:`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
