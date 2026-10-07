import ProjectService from "../../Services/ProjectService";
import logger, { LogAttributes } from "../Logger";
import ObjectID from "../../../Types/ObjectID";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";

/*
 * What an SMS, call, WhatsApp or Telegram message does to the project's
 * balance where OneUptime bills (OneUptime Cloud) - the parts SmsService,
 * CallService, WhatsAppService and TelegramService share, so all four pay
 * and tell the owners the same way:
 *
 * - A message the provider took is paid in one statement, from whatever the
 *   balance is now (ProjectService.deductSmsOrCallBalanceInUSDCents). Each
 *   used to write back "the balance it read before sending, less its cost",
 *   so of the messages of a paging storm only the last write counted, and a
 *   recharge landing in between was written over.
 * - A message the balance could not pay for tells the owners once each time
 *   it runs out, decided by one conditional UPDATE
 *   (ProjectService.claimSmsOrCallLowBalanceNotice). Each used to read "not
 *   told yet" with the project and email them, so the messages of a storm
 *   that found the balance used up together each emailed every owner.
 */
export default class MessagingBalance {
  /*
   * What one message costs, in whole cents: the configured cost (in cents
   * already), times the parts it is sent in. The senders used to turn the
   * cents into dollars and back, and floating point took a cent more, or a
   * cent less, for some costs (29 cents came to 28).
   */
  public static getCostInUSDCents(data: {
    costPerPartInUSDCents: number;
    parts?: number | undefined;
  }): number {
    const perPart: number = Number.isFinite(data.costPerPartInUSDCents)
      ? Math.max(0, Math.round(data.costPerPartInUSDCents))
      : 0;

    const parts: number =
      data.parts && Number.isFinite(data.parts) && data.parts > 1
        ? Math.ceil(data.parts)
        : 1;

    return perPart * parts;
  }

  /*
   * Pay for a message the provider has taken: its cost comes off the
   * balance in one statement. Answers the balance it left, or null when it
   * could not be written.
   *
   * Never throws. The message went out; a balance that could not be written
   * is logged with what it cost, so it can be put right, and is not turned
   * into a failed message - which the caller would report as not sent, and
   * might send again.
   */
  public static async payForSentMessage(data: {
    projectId: ObjectID;
    channel: ProjectNotificationChannel;
    costInUSDCents: number;
  }): Promise<number | null> {
    try {
      return await ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId: data.projectId,
        amountInUSDCents: data.costInUSDCents,
      });
    } catch (err) {
      logger.error(
        `SMS and call balance: a ${data.channel} message of project ${data.projectId.toString()} went out, and its cost (${data.costInUSDCents} cents) could not be taken from the balance: ${err}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      return null;
    }
  }

  /*
   * Whether this message, not sent for want of balance, is the one that
   * tells the project's owners: the first since the balance was last added
   * to. `alreadyTold` is the flag as the sender read it with the project,
   * which saves the write when they were told long ago; otherwise the flag
   * is claimed in one statement, which exactly one message wins however many
   * find the balance used up together, on any server.
   */
  public static async shouldTellOwnersBalanceIsLow(data: {
    projectId: ObjectID;
    alreadyTold?: boolean | undefined;
  }): Promise<boolean> {
    if (data.alreadyTold) {
      return false;
    }

    return await ProjectService.claimSmsOrCallLowBalanceNotice(data.projectId);
  }
}
