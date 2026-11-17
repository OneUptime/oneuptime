import DataMigrationBase from "./DataMigrationBase";
import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * The private keys of the free certificates OneUptime orders from Let's
 * Encrypt, stored before they were kept encrypted at rest:
 * AcmeCertificate.certificateKey, the key of each certificate ordered for a
 * custom domain or for the server's own host. Encrypted on every order and
 * renewal from now on; a row written before holds the key as plaintext.
 *
 * It encrypted GreenlockCertificate.blob too, the ACME account and
 * certificate keys of the store ACME certificates replaced. That table is
 * gone now (DropGreenlockTables1809182470000, #8990), dropped by a schema
 * migration before any data migration runs, and its keys with it: there is
 * nothing of it left to encrypt.
 *
 * THE UPGRADE CHANGES NO KEY (#9266). The ingress of the release before,
 * still running while the upgrade rolls out, writes each key to disk as it
 * is stored (StatusPageCerts:WriteAcmeCertsToDisk, every 15 minutes and at
 * its start), and nginx reads a domain's key file at each handshake: a
 * ciphertext there fails TLS for that domain. So this runs at the upgrade
 * and changes nothing, and when it ran starts the wait: a day later, once
 * no server of the release before can still be running, the
 * CredentialsAtRest:EncryptInPlace job encrypts each key still stored as
 * written, in place, in raw SQL, only while the row still holds the key
 * read (CredentialsAtRest, EncryptColumnInPlace): a key renewed meanwhile
 * is already encrypted and stays as its write stored it. An install that
 * ran this when it still encrypted at once (15.0.0) has its keys encrypted
 * already: the job encrypts what is left, and never a ciphertext again.
 *
 * The ingress of this release serves every certificate throughout:
 * DatabaseService.decrypt hands back a key that is not our ciphertext as it
 * is, and decrypts the rest, so its jobs write the same key to disk before
 * and after (Nginx/Jobs/AcmeWriteCertificates, WriteServerCertToDisk).
 */
export default class EncryptLetsEncryptKeys extends DataMigrationBase {
  public constructor() {
    super("EncryptLetsEncryptKeys");
  }

  // Leaves every key as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  // The column whose keys are encrypted in place a day after this ran.
  public static getTargets(): Array<ColumnToEncrypt> {
    return [
      {
        kind: "Let's Encrypt certificate",
        repository:
          AcmeCertificateService.getRepository() as unknown as ModelRepository,
        column: "certificateKey",
      },
    ];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
