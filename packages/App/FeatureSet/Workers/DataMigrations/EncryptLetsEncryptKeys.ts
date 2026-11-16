import DataMigrationBase from "./DataMigrationBase";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import GreenlockCertificateService from "Common/Server/Services/GreenlockCertificateService";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the private keys of the free certificates OneUptime orders from
 * Let's Encrypt, stored before they were kept encrypted at rest.
 *
 *   - AcmeCertificate.certificateKey: the key of each certificate the
 *     Greenlock store ordered, for a custom domain or for the server's own
 *     host. Encrypted on every order and renewal from now on; a row written
 *     before holds the key as plaintext.
 *   - GreenlockCertificate.blob: the store ACME certificates replaced, which
 *     nothing reads any more, kept the private keys of the ACME account and
 *     of each domain's certificate there (isKeyPair). An installation that
 *     ran OneUptime before then still holds them.
 *
 * Each value is encrypted in place, in raw SQL, only while the row still
 * holds the plaintext read (EncryptColumnInPlace): a key renewed meanwhile
 * is already encrypted and stays as its write stored it.
 *
 * Idempotent, and safe to run twice at once. nginx keeps serving every
 * certificate throughout: DatabaseService.decrypt hands back a key that is
 * not our ciphertext as it is, and decrypts the rest, so its jobs write the
 * same key to disk before and after (Nginx/Jobs/AcmeWriteCertificates,
 * WriteServerCertToDisk). One table, or one row, that cannot be read or
 * written costs the others nothing, and no log line carries a key.
 */
export default class EncryptLetsEncryptKeys extends DataMigrationBase {
  public constructor() {
    super("EncryptLetsEncryptKeys");
  }

  public override async migrate(): Promise<void> {
    const targets: Array<ColumnToEncrypt> = [
      {
        kind: "Let's Encrypt certificate",
        repository:
          AcmeCertificateService.getRepository() as unknown as ModelRepository,
        column: "certificateKey",
      },
      {
        kind: "Greenlock store entry",
        repository:
          GreenlockCertificateService.getRepository() as unknown as ModelRepository,
        column: "blob",
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
