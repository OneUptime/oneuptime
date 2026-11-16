import DataMigrationBase from "./DataMigrationBase";
import { digestOfValueRead } from "./HashMasterApiKey";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ApiKeyService, {
  KEY_STORED_AS_WRITTEN_SQL_PATTERN,
} from "Common/Server/Services/ApiKeyService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import HashedApiKey from "Common/Server/Utils/APIKey/HashedApiKey";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

const API_KEY_COLUMN: string = "apiKey";
const API_KEY_HINT_COLUMN: string = "apiKeyHint";

// How many keys a page reads: each is written on its own.
export const HASH_PROJECT_API_KEYS_PAGE_SIZE: number = 500;

/*
 * Hashes the project API keys stored before keys were stored hashed
 * (#8902).
 *
 * A project's API keys (ApiKey.apiKey, Project Settings > Advanced > API
 * Keys) are kept as their hash now (Common/Server/Utils/APIKey/HashedApiKey),
 * but every key made before holds the key itself: the schema migration
 * ApiKeyHashedColumn turned its uuid column into a varchar and kept the key,
 * as its lower-case text. This reads those keys a page at a time - by id,
 * the ones still a uuid (a hash never is one) - and writes each one's hash
 * in its place, with its hint (its last four characters, which the key's
 * pages show in place of the key): once the key is hashed, nothing can
 * work the hint out. In raw SQL, so the key is hashed exactly once and
 * DatabaseService's own hashing never touches it; a key deleted already is
 * hashed too, so no backup holds it either.
 *
 * Every script, integration and Terraform configuration that uses a key
 * keeps working, with no change: the key a request presents is hashed and
 * looked up by its hash, and until this has run the lookup takes a key as
 * it was written (ApiKeyService.findApiKey).
 *
 * A key is written only while its column still holds the value read,
 * compared by its digest (digestOfValueRead) so that the key is in no
 * statement's parameters: a key reset since, through the service, is its
 * hash already and stays as it is, and a second runner at the same time
 * writes nothing.
 *
 * Idempotent, and safe to run twice: a key already stored as its hash is
 * never read, so a second run rewrites nothing. The key is in no
 * statement's text or parameters, nor in the log; what is written, its hash
 * and its hint, is no key.
 */
export default class HashProjectApiKeys extends DataMigrationBase {
  public constructor() {
    super("HashProjectApiKeys");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository =
      ApiKeyService.getRepository() as unknown as ModelRepository;

    const tableName: string = repository.metadata.tableName;

    // The last key read: each page starts after it, so every key is read once.
    let afterId: string = ObjectID.getZeroObjectID().toString();

    for (;;) {
      let rows: Array<Record<string, unknown>> = [];

      try {
        rows = (await repository.manager.query(
          `SELECT "_id", "${API_KEY_COLUMN}" FROM "${tableName}" WHERE "_id" > $1 AND "${API_KEY_COLUMN}" ~* '${KEY_STORED_AS_WRITTEN_SQL_PATTERN}' ORDER BY "_id" ASC LIMIT ${HASH_PROJECT_API_KEYS_PAGE_SIZE}`,
          [afterId],
        )) as Array<Record<string, unknown>>;
      } catch (err) {
        /*
         * The keys left keep working as they were written: the lookup takes
         * them while any is stored so.
         */
        logger.error(
          "HashProjectApiKeys: failed to read the project API keys to hash them. They keep working as they were written:",
        );
        logger.error(err);
        return;
      }

      for (const row of rows) {
        await this.hashKey(repository, tableName, row);
      }

      if (rows.length < HASH_PROJECT_API_KEYS_PAGE_SIZE) {
        return;
      }

      afterId = String(rows[rows.length - 1]!["_id"]);
    }
  }

  private async hashKey(
    repository: ModelRepository,
    tableName: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const value: unknown = row[API_KEY_COLUMN];

    if (
      typeof value !== "string" ||
      !value ||
      !HashedApiKey.isStoredAsWritten(value)
    ) {
      // Stored as its hash since it was read - nothing to do.
      return;
    }

    try {
      await repository.manager.query(
        `UPDATE "${tableName}" SET "${API_KEY_COLUMN}" = $1, "${API_KEY_HINT_COLUMN}" = $2 WHERE "_id" = $3 AND encode(sha256(convert_to("${API_KEY_COLUMN}", 'UTF8')), 'hex') = $4`,
        [
          HashedApiKey.hash(value),
          HashedApiKey.getHint(value),
          row["_id"],
          digestOfValueRead(value),
        ],
      );
    } catch (err) {
      /*
       * A key that cannot be hashed must not cost the others theirs, nor
       * halt every migration queued behind this one. It still works as it
       * was written; resetting it stores the new one hashed.
       */
      logger.error(
        `HashProjectApiKeys: failed to hash the API key ${String(row["_id"])}. It keeps working; reset it on its page under Project Settings > Advanced > API Keys to store it hashed:`,
      );
      logger.error(err);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
