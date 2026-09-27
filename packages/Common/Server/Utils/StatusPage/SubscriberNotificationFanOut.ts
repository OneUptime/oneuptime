import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import ObjectID from "../../../Types/ObjectID";
import ArrayUtil from "../../../Utils/Array";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import logger, { LogAttributes } from "../Logger";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
} from "./SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming, {
  SubscriberNotificationSendWindow,
} from "./SubscriberNotificationTiming";

/*
 * Walks every subscriber of one status page for a subscriber send, and hands
 * each to the job's handler, which builds that subscriber's messages and
 * awaits them (SubscriberNotificationDeliveryRecord.deliver).
 *
 * - Every subscriber, not the first LIMIT_MAX: the page is read in batches of
 *   SubscriberNotificationTiming.SUBSCRIBERS_PER_READ, each after the last
 *   _id of the one before, until a batch comes back short. One read used to
 *   stop at LIMIT_MAX without a word, so the 10,001st subscriber of a page
 *   was never told.
 * - At most SEND_CONCURRENCY subscribers in flight. Handlers are started in
 *   the order the subscribers were read, so the email and SMS dedupe of a
 *   scoped send still gives an address to the first page that has it.
 * - Within the send window: once it closes, no further subscriber is
 *   started, the ones in flight finish, and the page is recorded as not
 *   reached in full (OutOfTime).
 * - A handler that throws does not stop the others: the page is recorded as
 *   failed part-way, and the send goes on.
 *
 * A page whose every subscriber was reached is recorded as finished; with no
 * failed message it counts as sent in full (didStatusPageSucceed). A read
 * that fails is thrown, for the job to handle as it handles any error on
 * that page.
 */
export default class SubscriberNotificationFanOut {
  public static async forEachSubscriber(data: {
    statusPage: StatusPage;
    record: SubscriberNotificationDeliveryRecord;
    sendWindow: SubscriberNotificationSendWindow;
    handler: (subscriber: StatusPageSubscriber) => Promise<void>;
    logAttributes?: LogAttributes | undefined;
    concurrency?: number | undefined;
    subscribersPerRead?: number | undefined;
  }): Promise<void> {
    const statusPageId: ObjectID | null = data.statusPage.id;

    if (!statusPageId) {
      return;
    }

    const concurrency: number =
      data.concurrency || SubscriberNotificationTiming.SEND_CONCURRENCY;
    const subscribersPerRead: number =
      data.subscribersPerRead ||
      SubscriberNotificationTiming.SUBSCRIBERS_PER_READ;

    let afterId: ObjectID | undefined = undefined;
    // Set once the send window closes; read by every handler in flight.
    const progress: { ranOutOfTime: boolean } = { ranOutOfTime: false };

    for (;;) {
      if (!data.sendWindow.isOpen()) {
        progress.ranOutOfTime = true;
        break;
      }

      const subscribers: Array<StatusPageSubscriber> =
        await StatusPageSubscriberService.getSubscribersByStatusPage(
          statusPageId,
          {
            isRoot: true,
            ignoreHooks: true,
          },
          {
            afterId: afterId,
            limit: subscribersPerRead,
          },
        );

      logger.debug(
        `Read ${subscribers.length} subscriber(s) of status page ${statusPageId.toString()}${afterId ? ` after ${afterId.toString()}` : ""}.`,
        data.logAttributes,
      );

      await ArrayUtil.forEachWithConcurrency(
        subscribers,
        concurrency,
        async (subscriber: StatusPageSubscriber): Promise<void> => {
          if (progress.ranOutOfTime || !data.sendWindow.isOpen()) {
            progress.ranOutOfTime = true;
            return;
          }

          try {
            await data.handler(subscriber);
          } catch (err) {
            logger.error(
              `Error notifying subscriber ${subscriber._id?.toString() || ""} of status page ${statusPageId.toString()}: ${err}`,
              data.logAttributes,
            );

            data.record.skipStatusPage(
              data.statusPage,
              StatusPageDeliverySkipReason.Failed,
            );
          }
        },
      );

      if (progress.ranOutOfTime) {
        break;
      }

      const lastId: string | undefined =
        subscribers[subscribers.length - 1]?._id?.toString();

      if (subscribers.length < subscribersPerRead || !lastId) {
        break;
      }

      afterId = new ObjectID(lastId);
    }

    if (progress.ranOutOfTime) {
      logger.debug(
        `The send ran out of time part-way through status page ${statusPageId.toString()}.`,
        data.logAttributes,
      );

      data.record.skipStatusPage(
        data.statusPage,
        StatusPageDeliverySkipReason.OutOfTime,
      );

      return;
    }

    data.record.finishStatusPage(data.statusPage);
  }
}
