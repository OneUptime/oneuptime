import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/InstanceTokenSigningKey";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TokenSigningKey from "../Utils/TokenSigningKey";
import ObjectID from "../../Types/ObjectID";

/*
 * The one row of InstanceTokenSigningKey. A fixed id, so "store a key unless
 * one is stored" is a primary-key conflict Postgres settles by itself.
 */
export const INSTANCE_TOKEN_SIGNING_KEY_ROW_ID: string =
  ObjectID.getZeroObjectID().toString();

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * This installation's own token signing key, stored by whichever process
   * asked first.
   *
   * Two statements, each its own transaction. The first offers a fresh key
   * and does nothing if a key is already stored. The second reads the stored
   * one; being a statement of its own, it sees a row another process
   * committed while the first statement waited on it, which a read inside
   * the same statement would not. So any number of app and worker processes
   * starting at once all come away with the same key, and a restart reads
   * the key it had.
   *
   * Throws when the stored value is not a well-formed key, rather than
   * signing with whatever a damaged or hand-edited row holds.
   */
  @CaptureSpan()
  public async getOrCreateKey(): Promise<string> {
    await this.getRepository().manager.query(
      `INSERT INTO "InstanceTokenSigningKey" ("_id", "signingKey", "version")
        VALUES ($1, $2, 1)
        ON CONFLICT ("_id") DO NOTHING`,
      [
        INSTANCE_TOKEN_SIGNING_KEY_ROW_ID,
        TokenSigningKey.generateInstallationKey(),
      ],
    );

    const rows: Array<{ signingKey?: unknown }> =
      await this.getRepository().manager.query(
        `SELECT "signingKey" FROM "InstanceTokenSigningKey" WHERE "_id" = $1`,
        [INSTANCE_TOKEN_SIGNING_KEY_ROW_ID],
      );

    const key: unknown = rows?.[0]?.signingKey;

    if (!TokenSigningKey.isWellFormedInstallationKey(key)) {
      throw new Error(
        "The InstanceTokenSigningKey table holds no well-formed token signing key, so OneUptime will not start signing with it. Delete its row and restart every OneUptime app and worker to generate a new one (everybody signs in again), or set ENCRYPTION_SECRET to a long random value.",
      );
    }

    return key;
  }

  /*
   * Run once by every App process at boot, right after it connects to
   * Postgres and before it serves a request or starts a worker
   * (App/Index.ts).
   *
   * An installation whose operator set ENCRYPTION_SECRET signs with that,
   * as it always did: nothing is read or written here. One whose
   * ENCRYPTION_SECRET is unset or a shipped placeholder signs with its own
   * key from now on, so a token signed with that public value is refused.
   */
  @CaptureSpan()
  public async loadTokenSigningKey(): Promise<void> {
    if (TokenSigningKey.isEncryptionSecretUsed()) {
      return;
    }

    TokenSigningKey.useInstallationKey(await this.getOrCreateKey());

    logger.info(
      "ENCRYPTION_SECRET is unset or a placeholder shipped in the OneUptime repository, so sign-in and other tokens are signed with this installation's own random key, kept in the database.",
    );
  }
}

export default new Service();
