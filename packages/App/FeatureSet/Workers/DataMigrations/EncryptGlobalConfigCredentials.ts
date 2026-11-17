import DataMigrationBase from "./DataMigrationBase";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * The GlobalConfig columns this encrypts: every credential column of the
 * server's settings that was stored as written until it was declared
 * `encrypted: true` (#7739). The newer provider keys (Amazon SES, Mailgun,
 * Postmark, Resend) were encrypted from the start and are not listed.
 */
export const GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT: ReadonlyArray<
  keyof GlobalConfig
> = [
  "smtpPassword",
  "smtpClientSecret",
  "twilioAuthToken",
  "callAndSmsGatewaySecret",
  "metaWhatsAppAccessToken",
  "metaWhatsAppAppSecret",
  "metaWhatsAppWebhookVerifyToken",
  "telegramBotToken",
  "telegramWebhookSecretToken",
  "sendgridApiKey",
  "enterpriseLicenseKey",
  "enterpriseLicenseToken",
];

/*
 * The server's credentials that were stored before their columns were
 * encrypted.
 *
 * The columns above are now encrypted (the model's `encrypted: true`), but
 * the server's settings row written before that holds each value as it was
 * written.
 *
 * THE UPGRADE CHANGES NO VALUE (#9266). A server of a release before 14.1.0,
 * still running while an upgrade from it rolls out, reads these columns as
 * they are stored: every email, SMS and call it sends with the server's own
 * settings would go out with a ciphertext for a password or a token, and
 * fail. So this runs at the upgrade and changes nothing, and when it ran
 * starts the wait: a day later, once no server of the release before can
 * still be running, the CredentialsAtRest:EncryptInPlace job encrypts each
 * value still stored as written, in place, in raw SQL, only while the
 * column still holds the value read (CredentialsAtRest,
 * EncryptColumnInPlace). An install that ran this when it still encrypted
 * at once (14.1.0 to 15.0.0) has its values encrypted already: the job
 * encrypts what is left, and never a ciphertext again.
 *
 * Every reader of this release reads the same value before and after:
 * DatabaseService.decrypt hands back a value that is not our ciphertext
 * untouched, and decrypts the rest to the value that was encrypted.
 */
export default class EncryptGlobalConfigCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptGlobalConfigCredentials");
  }

  // Leaves every value as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  /*
   * Every column whose values are encrypted in place a day after this ran,
   * in that order (CredentialsAtRest).
   */
  public static getTargets(): Array<ColumnToEncrypt> {
    const settings: ModelRepository =
      GlobalConfigService.getRepository() as unknown as ModelRepository;

    return GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT.map(
      (column: keyof GlobalConfig): ColumnToEncrypt => {
        return {
          kind: "server settings",
          repository: settings,
          column: String(column),
        };
      },
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
