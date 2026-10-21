import { DashboardClientUrl } from "../EnvironmentConfig";
import URL from "../../Types/API/URL";
import ObjectID from "../../Types/ObjectID";
import SafeHtml from "../../Types/SafeHtml";
import {
  getProjectNotificationChannelOffOwnerSentence,
  PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH,
  ProjectNotificationChannel,
} from "../../Utils/Project/NotificationChannels";

/*
 * What a project's owners are told when a message was not sent because its
 * channel - SMS, phone calls or Telegram - is off in the project (SmsService,
 * CallService, TelegramService email them once).
 *
 * They may turn the channel on (owners hold the columns' update permission,
 * see Utils/Project/NotificationChannels), so this tells them to, if it
 * should be on, and links straight to the page with the switch.
 *
 * The link is built from the configured dashboard address
 * (EnvironmentConfig.DashboardClientUrl, as the billing emails' links are),
 * so sending the notice reads nothing from the database. Without a HOST
 * there is no address to link to, and the notice is the sentence alone - it
 * says where the switch is.
 */
export default class ProjectNotificationChannelOwnerNotice {
  /*
   * The project's Notification Settings page in the dashboard, or null when
   * the dashboard's address is not configured (no HOST): a link to
   * "http:///dashboard" would help nobody.
   */
  public static getSettingsLink(projectId: ObjectID): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId.toString()}/${PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH}`,
    );
  }

  /*
   * The notice, as the HTML the owners' email places it in (SimpleMessage's
   * info block): the sentence, then the link on a line of its own.
   */
  public static getHtml(data: {
    channel: ProjectNotificationChannel;
    projectId: ObjectID;
  }): string {
    const sentence: string = SafeHtml.escape(
      getProjectNotificationChannelOffOwnerSentence(data.channel),
    );

    const settingsLink: URL | null =
      ProjectNotificationChannelOwnerNotice.getSettingsLink(data.projectId);

    if (!settingsLink) {
      return sentence;
    }

    const link: string = SafeHtml.escape(settingsLink.toString());

    return `${sentence} <br/> <br/> <a href="${link}">${link}</a>`;
  }
}
