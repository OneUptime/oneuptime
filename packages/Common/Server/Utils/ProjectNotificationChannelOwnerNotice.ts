import { DashboardClientUrl } from "../EnvironmentConfig";
import logger from "./Logger";
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
 * so sending the notice reads nothing from the database.
 */
export default class ProjectNotificationChannelOwnerNotice {
  // The project's Notification Settings page in the dashboard.
  public static getSettingsLink(projectId: ObjectID): URL {
    // No HOST configured: a link to "http:///dashboard" helps nobody.
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      throw new Error("The dashboard's address is not configured.");
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId.toString()}/${PROJECT_NOTIFICATION_CHANNEL_SETTINGS_PATH}`,
    );
  }

  /*
   * The notice, as the HTML the owners' email places it in (SimpleMessage's
   * info block): the sentence, then the link on a line of its own. Without
   * a link to give, the sentence alone - it says where the switch is.
   */
  public static getHtml(data: {
    channel: ProjectNotificationChannel;
    projectId: ObjectID;
  }): string {
    const sentence: string = SafeHtml.escape(
      getProjectNotificationChannelOffOwnerSentence(data.channel),
    );

    try {
      const link: string = SafeHtml.escape(
        ProjectNotificationChannelOwnerNotice.getSettingsLink(
          data.projectId,
        ).toString(),
      );

      return `${sentence} <br/> <br/> <a href="${link}">${link}</a>`;
    } catch (err) {
      logger.error(err);
      return sentence;
    }
  }
}
