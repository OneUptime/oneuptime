import DataMigrationBase from "./DataMigrationBase";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import FormDomainService from "Common/Server/Services/FormDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * The private keys of uploaded certificates stored before the column became
 * a secret kept encrypted at rest.
 *
 * A status page's, a dashboard's and a form's custom domain keep the private
 * key of the certificate their owner uploaded in customCertificateKey, now
 * encrypted at rest (the models' `encrypted: true`) and never returned by the
 * API. A row written before that holds the key as plaintext.
 *
 * THE UPGRADE CHANGES NO KEY (#9266). The ingress of the release before,
 * still running while the upgrade rolls out, writes each key to disk as it
 * is stored, and nginx reads the key file of a domain at each handshake: a
 * ciphertext there fails TLS for that domain. So this runs at the upgrade
 * and changes nothing, and when it ran starts the wait: a day later, once
 * no server of the release before can still be running, the
 * CredentialsAtRest:EncryptInPlace job encrypts each key still stored as
 * written, in place, in raw SQL, only while the row still holds the key
 * read (CredentialsAtRest, EncryptColumnInPlace). An install that ran this
 * when it still encrypted at once (15.0.0) has its keys encrypted already:
 * the job encrypts what is left, and never a ciphertext again.
 *
 * The ingress of this release serves every key throughout:
 * DatabaseService.decrypt hands back a value that is not our ciphertext
 * untouched, and decrypts the rest.
 */
export default class EncryptUploadedCertificateKeys extends DataMigrationBase {
  public constructor() {
    super("EncryptUploadedCertificateKeys");
  }

  // Leaves every key as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  /*
   * Every column whose keys are encrypted in place a day after this ran, in
   * that order (CredentialsAtRest).
   */
  public static getTargets(): Array<ColumnToEncrypt> {
    return [
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
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
