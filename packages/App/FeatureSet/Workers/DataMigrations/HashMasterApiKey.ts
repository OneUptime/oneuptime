import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import logger from "Common/Server/Utils/Logger";
import MasterApiKey from "Common/Server/Utils/MasterApiKey";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

const MASTER_API_KEY_COLUMN: string = "masterApiKey";

/*
 * Hashes the server's master API key stored before it was stored hashed
 * (#7901).
 *
 * The key (GlobalConfig.masterApiKey, Admin Dashboard > Settings > API Key)
 * is kept as its hash now (Common/Server/Utils/MasterApiKey), but the
 * server's settings row written before holds the key itself: the schema
 * migration MasterApiKeyHashedColumn turned its uuid column into a varchar
 * and kept the key, as its lower-case text. This reads the row's raw value
 * and, where it is a key as it was written (a uuid - a hash never is one),
 * writes its hash in its place, in raw SQL, so the key is hashed exactly
 * once and DatabaseService's own hashing never touches it.
 *
 * Every script and integration that uses the key keeps working, with no
 * change: the key a request presents is hashed and compared with the hash
 * stored, and until this runs the lookup takes the key as it was written.
 *
 * The value is written only while the column still holds the value read
 * (WHERE ... = the value read): a key made since, through the service, is
 * already its hash and stays as it is, and a second runner at the same time
 * writes nothing. A row with no key is left as it is.
 *
 * Idempotent, and safe to run twice: a value that is already a hash is left
 * alone, so a second run rewrites nothing. Neither the key nor its hash
 * reaches the log or the SQL text.
 */
export default class HashMasterApiKey extends DataMigrationBase {
  public constructor() {
    super("HashMasterApiKey");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository =
      GlobalConfigService.getRepository() as unknown as ModelRepository;

    const tableName: string = repository.metadata.tableName;

    let rows: Array<Record<string, unknown>> = [];

    try {
      rows = (await repository.manager.query(
        `SELECT "_id", "${MASTER_API_KEY_COLUMN}" FROM "${tableName}"`,
      )) as Array<Record<string, unknown>>;
    } catch (err) {
      logger.error(
        "HashMasterApiKey: failed to read the server's settings to hash their master API key:",
      );
      logger.error(err);
      return;
    }

    for (const row of rows) {
      const value: unknown = row[MASTER_API_KEY_COLUMN];

      if (
        typeof value !== "string" ||
        !value ||
        !MasterApiKey.isStoredAsWritten(value)
      ) {
        // No key, or one stored as its hash already - nothing to do.
        continue;
      }

      try {
        await repository.manager.query(
          `UPDATE "${tableName}" SET "${MASTER_API_KEY_COLUMN}" = $1 WHERE "_id" = $2 AND "${MASTER_API_KEY_COLUMN}" = $3`,
          [MasterApiKey.hash(value), row["_id"], value],
        );
      } catch (err) {
        /*
         * A key that cannot be hashed must not halt every migration queued
         * behind this one. It still works as it was written; resetting it
         * stores the new one hashed.
         */
        logger.error(
          `HashMasterApiKey: failed to hash the master API key of the server's settings ${String(row["_id"])}. It keeps working; reset it on Admin Dashboard > Settings > API Key to store it hashed:`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
