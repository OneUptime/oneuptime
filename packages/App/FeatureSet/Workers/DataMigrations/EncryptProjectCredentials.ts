import DataMigrationBase from "./DataMigrationBase";
import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the project credentials stored before their columns were kept
 * encrypted at rest (#8989):
 *
 *   - ProjectSmtpConfig.password and .clientSecret: a project's own mail
 *     server's password, and its OAuth app's client secret (for a Google
 *     service account, the private key of its JSON key file). The email
 *     providers' keys beside them were encrypted from the start.
 *   - WorkspaceProjectAuthToken.authToken: the project's bot token in
 *     Slack, Microsoft Teams (the tenant's Graph app token) or Mattermost.
 *   - WorkspaceUserAuthToken.authToken: a member's own token from their
 *     Slack or Microsoft Teams sign-in.
 *   - CodeRepository.secretToken: the secret a repository's webhooks are
 *     verified with.
 *   - UserWebhook.secret: the key a member's webhook notification method
 *     signs each request with.
 *
 * Each column is `encrypted: true` now, so every write through its service
 * is encrypted; a row written before still holds its value as written.
 *
 * THE UPGRADE CHANGES NO VALUE (#9266). A server of the release before,
 * still running while the upgrade rolls out, reads each column as it is
 * stored: it would sign in to the mail server, post to Slack and sign a
 * webhook with a ciphertext, and a page sent then would be lost. So this
 * runs at the upgrade and changes nothing, and when it ran starts the wait:
 * a day later, once no server of the release before can still be running,
 * the CredentialsAtRest:EncryptInPlace job encrypts each value still stored
 * as written - those it saved meanwhile too - in place, in raw SQL, only
 * while the row still holds the value read (CredentialsAtRest,
 * EncryptColumnInPlace). An install that ran this when it still encrypted
 * at once (15.0.0, builds of main) has its values encrypted already: the
 * job encrypts what is left, and never a ciphertext again.
 *
 * Every reader of this release reads the same value before, during and
 * after: DatabaseService.decrypt hands back a value that is not our
 * ciphertext as it is, and decrypts the rest, so mail keeps going out
 * through the project's server, Slack, Microsoft Teams and Mattermost keep
 * being posted to, and webhooks keep being signed.
 */
export default class EncryptProjectCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptProjectCredentials");
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
    const smtpConfigs: ModelRepository =
      ProjectSmtpConfigService.getRepository() as unknown as ModelRepository;

    return [
      {
        kind: "SMTP config",
        repository: smtpConfigs,
        column: "password",
      },
      {
        kind: "SMTP config",
        repository: smtpConfigs,
        column: "clientSecret",
      },
      {
        kind: "workspace connection",
        repository:
          WorkspaceProjectAuthTokenService.getRepository() as unknown as ModelRepository,
        column: "authToken",
      },
      {
        kind: "workspace account link",
        repository:
          WorkspaceUserAuthTokenService.getRepository() as unknown as ModelRepository,
        column: "authToken",
      },
      {
        kind: "code repository",
        repository:
          CodeRepositoryService.getRepository() as unknown as ModelRepository,
        column: "secretToken",
      },
      {
        kind: "webhook notification method",
        repository:
          UserWebhookService.getRepository() as unknown as ModelRepository,
        column: "secret",
      },
    ];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
