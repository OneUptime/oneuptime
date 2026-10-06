import { DashboardClientUrl } from "../EnvironmentConfig";
import URL from "../../Types/API/URL";
import ObjectID from "../../Types/ObjectID";
import SafeHtml from "../../Types/SafeHtml";
import {
  getProjectBalanceOwnerSentence,
  PROJECT_BALANCE_SETTINGS_PATH,
  ProjectBalanceType,
} from "../../Utils/Project/ProjectBalance";

/*
 * What a project's owners are told when a message was not sent because the
 * project's balance could not pay for it (SmsService, CallService,
 * WhatsAppService and TelegramService email them once, until the balance is
 * topped up again).
 *
 * They may add balance (owners hold the recharge permission, see
 * Utils/Project/ProjectBalance), so this tells them to, and links straight
 * to the page with the Recharge button and Auto Recharge.
 *
 * The link is built from the configured dashboard address
 * (EnvironmentConfig.DashboardClientUrl, as the billing emails' links are),
 * so sending the notice reads nothing from the database. Without a HOST
 * there is no address to link to, and the notice is the sentence alone - it
 * says where the page is.
 */
export default class ProjectBalanceOwnerNotice {
  /*
   * The page that holds the balance in the dashboard, or null when the
   * dashboard's address is not configured (no HOST): a link to
   * "http:///dashboard" would help nobody.
   */
  public static getSettingsLink(data: {
    balance: ProjectBalanceType;
    projectId: ObjectID;
  }): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${data.projectId.toString()}/${PROJECT_BALANCE_SETTINGS_PATH[data.balance]}`,
    );
  }

  /*
   * The notice, as the HTML the owners' email places it in (SimpleMessage's
   * info block): the sentence, then the link on a line of its own.
   */
  public static getHtml(data: {
    balance: ProjectBalanceType;
    projectId: ObjectID;
  }): string {
    const sentence: string = SafeHtml.escape(
      getProjectBalanceOwnerSentence(data.balance),
    );

    const settingsLink: URL | null =
      ProjectBalanceOwnerNotice.getSettingsLink(data);

    if (!settingsLink) {
      return sentence;
    }

    const link: string = SafeHtml.escape(settingsLink.toString());

    return `${sentence} <br/> <br/> <a href="${link}">${link}</a>`;
  }
}
