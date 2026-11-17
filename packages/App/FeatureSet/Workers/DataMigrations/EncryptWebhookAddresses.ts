import DataMigrationBase from "./DataMigrationBase";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import EncryptColumnInPlace, {
  ColumnToEncrypt,
  ModelRepository,
} from "../Utils/EncryptColumnInPlace";

/*
 * Encrypts the webhook addresses stored before their columns were kept
 * encrypted at rest (#9013). A webhook's address is its credential - a
 * Slack, Microsoft Teams or Discord incoming webhook carries its secret in
 * its path - and these were stored as written:
 *
 *   - StatusPageSubscriber.slackIncomingWebhookUrl,
 *     .microsoftTeamsIncomingWebhookUrl and .subscriberWebhook: where a
 *     status page tells its Slack, Microsoft Teams and webhook subscribers;
 *   - UserWebhook.webhookUrl: a member's webhook notification method;
 *   - OpenStackProjectNotice.webhookUrl: where an OpenStack project's notice
 *     posts, and .previewedRecipient, which holds a copy of it
 *     ("webhook:<address>");
 *   - CustomNotificationChannel.webhookUrl and .secret: the installation's
 *     custom channels' addresses and signing secrets.
 *
 * Each column is `encrypted: true` now, so every write through its service
 * is encrypted; a row written before still holds its value as written - for
 * a URL column, the text the column's transformer wrote. Each such value is
 * encrypted in place, in raw SQL, only while the row still holds the value
 * read (EncryptColumnInPlace): an address saved meanwhile is already
 * encrypted and stays as its write stored it.
 *
 * Idempotent, and safe to run twice at once. Every reader reads the same
 * address before, during and after: DatabaseService decrypts our ciphertext
 * and hands back a value that is not one as it is, so status pages keep
 * telling their subscribers, pages keep reaching webhooks, and OpenStack
 * notices and custom channels keep posting. One table, or one row, that
 * cannot be read or written costs the others nothing, and no log line
 * carries a value.
 */
export default class EncryptWebhookAddresses extends DataMigrationBase {
  public constructor() {
    super("EncryptWebhookAddresses");
  }

  public override async migrate(): Promise<void> {
    for (const target of EncryptWebhookAddresses.getTargets()) {
      await EncryptColumnInPlace.encrypt({
        migrationName: this.name,
        target: target,
      });
    }
  }

  // Every column this encrypts, in the order it encrypts them.
  public static getTargets(): Array<ColumnToEncrypt> {
    const subscribers: ModelRepository =
      StatusPageSubscriberService.getRepository() as unknown as ModelRepository;
    const notices: ModelRepository =
      OpenStackProjectNoticeService.getRepository() as unknown as ModelRepository;
    const channels: ModelRepository =
      CustomNotificationChannelService.getRepository() as unknown as ModelRepository;

    return [
      {
        kind: "status page subscriber",
        repository: subscribers,
        column: "slackIncomingWebhookUrl",
      },
      {
        kind: "status page subscriber",
        repository: subscribers,
        column: "microsoftTeamsIncomingWebhookUrl",
      },
      {
        kind: "status page subscriber",
        repository: subscribers,
        column: "subscriberWebhook",
      },
      {
        kind: "webhook notification method",
        repository:
          UserWebhookService.getRepository() as unknown as ModelRepository,
        column: "webhookUrl",
      },
      {
        kind: "OpenStack project notice",
        repository: notices,
        column: "webhookUrl",
      },
      {
        kind: "OpenStack project notice",
        repository: notices,
        column: "previewedRecipient",
      },
      {
        kind: "custom notification channel",
        repository: channels,
        column: "webhookUrl",
      },
      {
        kind: "custom notification channel",
        repository: channels,
        column: "secret",
      },
    ];
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
