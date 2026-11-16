import DataMigrationBase from "./DataMigrationBase";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the private keys of the free certificates OneUptime orders from
 * Let's Encrypt, stored before they were kept encrypted at rest:
 * AcmeCertificate.certificateKey, the key of each certificate ordered for a
 * custom domain or for the server's own host. Encrypted on every order and
 * renewal from now on; a row written before holds the key as plaintext.
 *
 * It encrypted GreenlockCertificate.blob too, the ACME account and
 * certificate keys of the store ACME certificates replaced. That table is
 * gone now (DropGreenlockTables1809181850000, #8990), dropped by a schema
 * migration before any data migration runs, and its keys with it: there is
 * nothing of it left to encrypt.
 *
 * Each value is encrypted in place, in raw SQL, only while the row still
 * holds the plaintext read (EncryptColumnInPlace): a key renewed meanwhile
 * is already encrypted and stays as its write stored it.
 *
 * Idempotent, and safe to run twice at once. nginx keeps serving every
 * certificate throughout: DatabaseService.decrypt hands back a key that is
 * not our ciphertext as it is, and decrypts the rest, so its jobs write the
 * same key to disk before and after (Nginx/Jobs/AcmeWriteCertificates,
 * WriteServerCertToDisk). A row that cannot be read or written costs the
 * others nothing, and no log line carries a key.
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
