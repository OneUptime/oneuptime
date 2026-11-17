import DataMigrationBase from "./DataMigrationBase";
import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import ProjectSmtpConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WorkspaceProjectAuthTokenService from "Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "Common/Server/Services/WorkspaceUserAuthTokenService";
import EncryptColumnInPlace, {
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
 * Each such value is encrypted in place, in raw SQL, only while the row
 * still holds the value read (EncryptColumnInPlace): a value saved
 * meanwhile is already encrypted and stays as its write stored it.
 *
 * Idempotent, and safe to run twice at once. Every reader reads the same
 * value before, during and after: DatabaseService.decrypt hands back a
 * value that is not our ciphertext as it is, and decrypts the rest, so mail
 * keeps going out through the project's server, Slack, Microsoft Teams and
 * Mattermost keep being posted to, and webhooks keep being signed. One
 * table, or one row, that cannot be read or written costs the others
 * nothing, and no log line carries a value.
 */
export default class EncryptProjectCredentials extends DataMigrationBase {
  public constructor() {
    super("EncryptProjectCredentials");
  }

  public override async migrate(): Promise<void> {
    for (const target of EncryptProjectCredentials.getTargets()) {
      await EncryptColumnInPlace.encrypt({
        migrationName: this.name,
        target: target,
      });
    }
  }

  // Every column this encrypts, in the order it encrypts them.
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
