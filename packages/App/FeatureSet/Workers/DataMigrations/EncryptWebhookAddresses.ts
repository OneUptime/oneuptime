import DataMigrationBase from "./DataMigrationBase";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import {
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
 * a URL column, the text the column's transformer wrote.
 *
 * THE UPGRADE CHANGES NO ADDRESS (#9266). A server of the release before,
 * still running while the upgrade rolls out, reads each column as it is
 * stored: it would post a page, or a status page's notice, to a ciphertext,
 * and lose it. So this runs at the upgrade and changes nothing, and when it
 * ran starts the wait: a day later, once no server of the release before
 * can still be running, the CredentialsAtRest:EncryptInPlace job encrypts
 * each value still stored as written - those it saved meanwhile too - in
 * place, in raw SQL, only while the row still holds the value read
 * (CredentialsAtRest, EncryptColumnInPlace). An install that ran this when
 * it still encrypted at once (builds of main) has its addresses encrypted
 * already: the job encrypts what is left, and never a ciphertext again.
 *
 * Every reader of this release reads the same address before, during and
 * after: DatabaseService decrypts our ciphertext and hands back a value
 * that is not one as it is, so status pages keep telling their subscribers,
 * pages keep reaching webhooks, and OpenStack notices and custom channels
 * keep posting.
 */
export default class EncryptWebhookAddresses extends DataMigrationBase {
  public constructor() {
    super("EncryptWebhookAddresses");
  }

  // Leaves every address as written: see the top of this file.
  public override async migrate(): Promise<void> {
    return;
  }

  /*
   * Every column whose values are encrypted in place a day after this ran,
   * in that order (CredentialsAtRest).
   */
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
