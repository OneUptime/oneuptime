import DataMigrationBase from "./DataMigrationBase";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import FormDomainService from "Common/Server/Services/FormDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the private keys of uploaded certificates stored before the
 * column became a secret kept encrypted at rest.
 *
 * A status page's, a dashboard's and a form's custom domain keep the private
 * key of the certificate their owner uploaded in customCertificateKey, now
 * encrypted at rest (the models' `encrypted: true`) and never returned by the
 * API. A row written before that holds the key as plaintext. Each such key
 * is encrypted in place, in raw SQL, only while the row still holds the
 * plaintext read (EncryptColumnInPlace), so a key replaced meanwhile is left
 * as its new write stored it.
 *
 * Idempotent, and safe to run twice: a value that already looks encrypted is
 * left alone. The read path tolerates the window before this finishes:
 * DatabaseService.decrypt hands back a value that is not our ciphertext
 * untouched, so nginx keeps serving a not-yet-encrypted key as it is.
 * One table, or one row, that cannot be read or written costs the others
 * nothing, and no log line carries a key.
 */
export default class EncryptUploadedCertificateKeys extends DataMigrationBase {
  public constructor() {
    super("EncryptUploadedCertificateKeys");
  }

  public override async migrate(): Promise<void> {
    const targets: Array<ColumnToEncrypt> = [
      {
        kind: "status page domain",
        repository:
          StatusPageDomainService.getRepository() as unknown as ModelRepository,
        column: "customCertificateKey",
      },
      {
        kind: "dashboard domain",
        repository:
          DashboardDomainService.getRepository() as unknown as ModelRepository,
        column: "customCertificateKey",
      },
      {
        kind: "form domain",
        repository:
          FormDomainService.getRepository() as unknown as ModelRepository,
        column: "customCertificateKey",
      },
    ];

    for (const target of targets) {
      await EncryptColumnInPlace.encrypt({
        migrationName: this.name,
        target: target,
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
