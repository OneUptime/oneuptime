import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import FormDomainService from "Common/Server/Services/FormDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

type KeyRow = { _id: string; customCertificateKey: string | null };

/*
 * Encrypts the private keys of uploaded certificates stored before the
 * column became a secret kept encrypted at rest.
 *
 * A status page's, a dashboard's and a form's custom domain keep the private
 * key of the certificate their owner uploaded in customCertificateKey, now
 * encrypted at rest (the models' `encrypted: true`) and never returned by the
 * API. A row written before that holds the key as plaintext. This reads each
 * row's raw key and, when it is not already our ciphertext
 * (Encryption.looksEncrypted), encrypts it and writes it back - in raw SQL,
 * so DatabaseService's own encrypt and decrypt never touch it and the value
 * is encrypted exactly once. Each row is written only while it still holds
 * the plaintext read, so a key replaced meanwhile is left as its new write
 * stored it.
 *
 * Idempotent, and safe to run twice: a value that already looks encrypted is
 * left alone. The read path tolerates the window before this finishes:
 * DatabaseService.decrypt hands back a value that is not our ciphertext
 * untouched, so nginx keeps serving a not-yet-encrypted key as it is.
 * One table, or one row, that cannot be read or written costs the others
 * nothing.
 */
export default class EncryptUploadedCertificateKeys extends DataMigrationBase {
  public constructor() {
    super("EncryptUploadedCertificateKeys");
  }

  public override async migrate(): Promise<void> {
    const services: Array<{ kind: string; repository: ModelRepository }> = [
      {
        kind: "status page",
        repository:
          StatusPageDomainService.getRepository() as unknown as ModelRepository,
      },
      {
        kind: "dashboard",
        repository:
          DashboardDomainService.getRepository() as unknown as ModelRepository,
      },
      {
        kind: "form",
        repository:
          FormDomainService.getRepository() as unknown as ModelRepository,
      },
    ];

    for (const service of services) {
      await this.encryptKeysOf(service);
    }
  }

  private async encryptKeysOf(data: {
    kind: string;
    repository: ModelRepository;
  }): Promise<void> {
    const tableName: string = data.repository.metadata.tableName;

    let rows: Array<KeyRow> = [];

    try {
      rows = (await data.repository.manager.query(
        `SELECT "_id", "customCertificateKey" FROM "${tableName}" WHERE "customCertificateKey" IS NOT NULL AND "customCertificateKey" <> ''`,
      )) as Array<KeyRow>;
    } catch (err) {
      logger.error(
        `EncryptUploadedCertificateKeys: failed to read the ${data.kind} domains' keys to encrypt:`,
      );
      logger.error(err);
      return;
    }

    for (const row of rows) {
      const plaintext: string | null = row.customCertificateKey;

      if (!plaintext || Encryption.looksEncrypted(plaintext)) {
        // Empty, or already encrypted by an earlier run - nothing to do.
        continue;
      }

      try {
        const encrypted: string = await Encryption.encrypt(plaintext);

        await data.repository.manager.query(
          `UPDATE "${tableName}" SET "customCertificateKey" = $1 WHERE "_id" = $2 AND "customCertificateKey" = $3`,
          [encrypted, row._id, plaintext],
        );
      } catch (err) {
        /*
         * One domain whose key cannot be encrypted must not cost the others
         * their encryption, nor halt every migration queued behind this one.
         * The key is never logged.
         */
        logger.error(
          `EncryptUploadedCertificateKeys: failed to encrypt the key of ${data.kind} domain ${row._id}:`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
