import Incident from "../../../Models/DatabaseModels/Incident";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackProjectNoticeDelivery from "../../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
  isOpenStackProjectNoticeArmed,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import API from "../../../Utils/API";
import {
  OpenStackProjectNoticeFacts,
  OpenStackProjectNoticeMessage,
  writeOpenStackProjectNotice,
} from "../../../Utils/OpenStack/OpenStackProjectNoticeText";
import IncidentService from "../../Services/IncidentService";
import MailService from "../../Services/MailService";
import OpenStackProjectNoticeDeliveryService from "../../Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "../../Services/OpenStackProjectNoticeService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import BlockedProjectNotifications from "../Notification/BlockedProjectNotifications";
import logger from "../Logger";
import SSRFProtection from "../SSRFProtection";
import OpenStackProjectNotices, {
  toOpenStackNoticeRecipient,
} from "./OpenStackProjectNotices";

/*
 * SENDING WHAT WAS WRITTEN DOWN.
 *
 * Once a minute (OpenStack:SendProjectNotices): what is over gets its second notice written, and what is
 * waiting goes out. Everything is asked again just before it goes, because a minute is long enough for an
 * operator to have turned a notice off or a project to have gone, and what was true when the part failed
 * doesn't decide what is true now.
 *
 * A notice goes out at most once. A row is taken by one worker (claimForSending) before anything is sent,
 * and one left mid-send by a crash stays unsent and says so, rather than risk telling someone twice. Only
 * an answer that says nothing was accepted is tried again.
 */

// What a run takes, so a host with five hundred projects on it goes out over a few minutes.
export const OPENSTACK_NOTICES_PER_RUN: number = 200;
export const OPENSTACK_NOTICE_ATTEMPTS: number = 3;
const RETRY_AFTER_MINUTES: number = 5;
// Longer than a send can take: a row older than this lost its worker.
const SENDING_FOR_TOO_LONG_MINUTES: number = 15;
// Recipients at once. One notice's rows go in order, so a repeat sees what went before it.
const NOTICES_AT_ONCE: number = 10;
const WEBHOOK_TIMEOUT_IN_MS: number = 10000;
const EMAIL_TIMEOUT_IN_MS: number = 30000;

export interface OpenStackNoticeSendOutcome {
  isSent: boolean;
  // Why not, for whoever reads the delivery.
  message?: string | undefined;
  // Whether nothing was accepted, so that trying again can't tell anyone twice.
  canTryAgain?: boolean | undefined;
}

const OPENING_EVENTS: ReadonlyArray<OpenStackProjectNoticeEvent> = [
  OpenStackProjectNoticeEvent.IncidentOpened,
  OpenStackProjectNoticeEvent.MaintenancePlanned,
];

function closingEventOf(
  event: OpenStackProjectNoticeEvent,
): OpenStackProjectNoticeEvent {
  return event === OpenStackProjectNoticeEvent.MaintenancePlanned
    ? OpenStackProjectNoticeEvent.MaintenanceEnded
    : OpenStackProjectNoticeEvent.IncidentResolved;
}

function idOf(row: { _id?: string | undefined; id?: ObjectID | null }): string {
  return (row._id || row.id?.toString() || "").toString();
}

export default class OpenStackProjectNoticeSender {
  public static async run(): Promise<void> {
    await this.closeWhatIsOver();
    await this.giveUpOnLostSends();
    await this.sendWhatIsDue();
  }

  /*
   * An incident resolved or a maintenance event over: what was opened is closed, and when nothing else
   * still holds the part, whoever was told it opened is told it is over. Nobody is told something ended
   * who was never told it began.
   */
  public static async closeWhatIsOver(): Promise<void> {
    const open: Array<OpenStackProjectNoticeDelivery> =
      await OpenStackProjectNoticeDeliveryService.findBy({
        query: {
          closedAt: QueryHelper.isNull(),
          event: QueryHelper.any([...OPENING_EVENTS]),
        },
        select: {
          _id: true,
          projectId: true,
          openStackCloudId: true,
          openStackProjectNoticeId: true,
          openStackProjectId: true,
          event: true,
          dedupeKey: true,
          partKey: true,
          incidentId: true,
          scheduledMaintenanceId: true,
          facts: true,
          status: true,
        },
        skip: 0,
        limit: 10000,
        props: { isRoot: true },
      });

    if (open.length === 0) {
      return;
    }

    const over: Set<string> = await this.readSubjectsThatAreOver(open);
    const isOver: (row: OpenStackProjectNoticeDelivery) => boolean = (
      row: OpenStackProjectNoticeDelivery,
    ): boolean => {
      return over.has(
        (row.incidentId || row.scheduledMaintenanceId || "").toString(),
      );
    };

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const row of open.filter(isOver)) {
      await OpenStackProjectNoticeDeliveryService.updateOneById({
        id: new ObjectID(idOf(row)),
        data: { closedAt: now },
        props: { isRoot: true },
      });
    }

    const handled: Set<string> = new Set();

    for (const row of open.filter(isOver)) {
      const group: string = `${row.openStackProjectNoticeId?.toString()}|${row.partKey}`;

      if (handled.has(group)) {
        continue;
      }

      handled.add(group);

      const isStillHeld: boolean = open.some(
        (other: OpenStackProjectNoticeDelivery): boolean => {
          return (
            !isOver(other) &&
            other.partKey === row.partKey &&
            other.openStackProjectNoticeId?.toString() ===
              row.openStackProjectNoticeId?.toString()
          );
        },
      );

      if (!isStillHeld) {
        await this.tellItIsOver(row, now);
      }
    }
  }

  private static async readSubjectsThatAreOver(
    open: ReadonlyArray<OpenStackProjectNoticeDelivery>,
  ): Promise<Set<string>> {
    const incidentIds: Array<string> = Array.from(
      new Set(
        open
          .map((row: OpenStackProjectNoticeDelivery): string => {
            return row.incidentId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );
    const maintenanceIds: Array<string> = Array.from(
      new Set(
        open
          .map((row: OpenStackProjectNoticeDelivery): string => {
            return row.scheduledMaintenanceId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );

    // Whatever isn't found was deleted, and a deleted incident is over too.
    const over: Set<string> = new Set([...incidentIds, ...maintenanceIds]);

    if (incidentIds.length > 0) {
      const incidents: Array<Incident> = await IncidentService.findBy({
        query: { _id: QueryHelper.any(incidentIds) },
        select: {
          _id: true,
          currentIncidentState: { isResolvedState: true },
        },
        skip: 0,
        limit: incidentIds.length,
        props: { isRoot: true },
      });

      for (const incident of incidents) {
        if (!incident.currentIncidentState?.isResolvedState) {
          over.delete(idOf(incident));
        }
      }
    }

    if (maintenanceIds.length > 0) {
      const events: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: { _id: QueryHelper.any(maintenanceIds) },
          select: {
            _id: true,
            currentScheduledMaintenanceState: {
              isEndedState: true,
              isResolvedState: true,
            },
          },
          skip: 0,
          limit: maintenanceIds.length,
          props: { isRoot: true },
        });

      for (const event of events) {
        const state: ScheduledMaintenance["currentScheduledMaintenanceState"] =
          event.currentScheduledMaintenanceState;

        if (!state?.isEndedState && !state?.isResolvedState) {
          over.delete(idOf(event));
        }
      }
    }

    return over;
  }

  private static async tellItIsOver(
    row: OpenStackProjectNoticeDelivery,
    now: Date,
  ): Promise<void> {
    const opening: OpenStackProjectNoticeEvent =
      row.event as OpenStackProjectNoticeEvent;
    const closing: OpenStackProjectNoticeEvent = closingEventOf(opening);
    const scope: {
      openStackProjectNoticeId: ObjectID;
      partKey: string;
    } = {
      openStackProjectNoticeId: row.openStackProjectNoticeId!,
      partKey: row.partKey!,
    };

    const [lastTold, lastClosing]: [
      OpenStackProjectNoticeDelivery | null,
      OpenStackProjectNoticeDelivery | null,
    ] = await Promise.all([
      OpenStackProjectNoticeDeliveryService.findOneBy({
        query: {
          ...scope,
          event: opening,
          status: OpenStackProjectNoticeDeliveryStatus.Sent,
        },
        select: { createdAt: true, dedupeKey: true, facts: true },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      }),
      OpenStackProjectNoticeDeliveryService.findOneBy({
        query: { ...scope, event: closing },
        select: { createdAt: true },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      }),
    ]);

    if (
      !lastTold?.createdAt ||
      (lastClosing?.createdAt &&
        new Date(lastClosing.createdAt).getTime() >=
          new Date(lastTold.createdAt).getTime())
    ) {
      return;
    }

    await OpenStackProjectNoticeDeliveryService.recordIfNew([
      {
        projectId: row.projectId!,
        openStackCloudId: row.openStackCloudId!,
        openStackProjectNoticeId: row.openStackProjectNoticeId!.toString(),
        openStackProjectId: row.openStackProjectId!,
        event: closing,
        dedupeKey: `${lastTold.dedupeKey}:closed`,
        partKey: row.partKey!,
        incidentId: row.incidentId,
        scheduledMaintenanceId: row.scheduledMaintenanceId,
        facts: {
          ...(lastTold.facts as JSONObject),
          event: closing,
          occurredAt: now.toISOString(),
        },
      },
    ]);
  }

  private static async giveUpOnLostSends(): Promise<void> {
    const lost: Array<OpenStackProjectNoticeDelivery> =
      await OpenStackProjectNoticeDeliveryService.findBy({
        query: {
          status: OpenStackProjectNoticeDeliveryStatus.Sending,
          updatedAt: QueryHelper.lessThan(
            OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              -SENDING_FOR_TOO_LONG_MINUTES,
            ),
          ),
        },
        select: { _id: true },
        skip: 0,
        limit: OPENSTACK_NOTICES_PER_RUN,
        props: { isRoot: true },
      });

    for (const row of lost) {
      await OpenStackProjectNoticeDeliveryService.updateOneById({
        id: new ObjectID(idOf(row)),
        data: {
          status: OpenStackProjectNoticeDeliveryStatus.Failed,
          statusMessage:
            "The worker stopped while sending this, so it may or may not have gone out. It is not sent again, so that nobody is told twice.",
        },
        props: { isRoot: true },
      });
    }
  }

  public static async sendWhatIsDue(): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const waiting: Array<OpenStackProjectNoticeDelivery> =
      await OpenStackProjectNoticeDeliveryService.findBy({
        query: { status: OpenStackProjectNoticeDeliveryStatus.Pending },
        select: {
          _id: true,
          projectId: true,
          openStackCloudId: true,
          openStackProjectNoticeId: true,
          openStackProjectId: true,
          event: true,
          partKey: true,
          incidentId: true,
          scheduledMaintenanceId: true,
          facts: true,
          attempts: true,
          nextAttemptAt: true,
          closedAt: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: OPENSTACK_NOTICES_PER_RUN,
        props: { isRoot: true },
      });

    const lanes: Map<string, Array<OpenStackProjectNoticeDelivery>> = new Map();

    for (const row of waiting) {
      if (
        row.nextAttemptAt &&
        new Date(row.nextAttemptAt).getTime() > now.getTime()
      ) {
        continue;
      }

      const lane: string = row.openStackProjectNoticeId?.toString() || "";
      lanes.set(lane, [...(lanes.get(lane) || []), row]);
    }

    const queue: Array<Array<OpenStackProjectNoticeDelivery>> = Array.from(
      lanes.values(),
    );

    const worker: () => Promise<void> = async (): Promise<void> => {
      for (;;) {
        const lane: Array<OpenStackProjectNoticeDelivery> | undefined =
          queue.shift();

        if (!lane) {
          return;
        }

        for (const row of lane) {
          try {
            await this.sendOne(row);
          } catch (error) {
            logger.error(
              `Could not send an OpenStack project notice: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: NOTICES_AT_ONCE }, () => {
        return worker();
      }),
    );
  }

  // Why this must not go out now, or null. Asked after the row is taken, right before it is sent.
  public static async getWhyNotToSend(
    row: OpenStackProjectNoticeDelivery,
    notice: OpenStackProjectNotice | null,
  ): Promise<string | null> {
    if (!notice) {
      return "The notice was deleted before this went out.";
    }

    if (!isOpenStackProjectNoticeArmed(toOpenStackNoticeRecipient(notice))) {
      return "The notice was turned off or its recipient changed before this went out.";
    }

    const projects: Set<string> =
      await OpenStackProjectNotices.readExistingProjects({
        projectId: row.projectId!,
        openStackCloudId: row.openStackCloudId!,
        openStackProjectIds: [row.openStackProjectId!],
      });

    if (!projects.has(row.openStackProjectId!)) {
      return "The project is no longer in this cloud.";
    }

    if (!OPENING_EVENTS.includes(row.event as OpenStackProjectNoticeEvent)) {
      return null;
    }

    if (row.closedAt) {
      return "It was over before this went out.";
    }

    const earlier: OpenStackProjectNoticeDelivery | null =
      await OpenStackProjectNoticeDeliveryService.findOneBy({
        query: {
          openStackProjectNoticeId: row.openStackProjectNoticeId!,
          partKey: row.partKey!,
          event: row.event!,
          closedAt: QueryHelper.isNull(),
          status: QueryHelper.any([
            OpenStackProjectNoticeDeliveryStatus.Sending,
            OpenStackProjectNoticeDeliveryStatus.Sent,
          ]),
          _id: QueryHelper.notEquals(idOf(row)),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    return earlier
      ? "This recipient has already been told about this part, and that is not over yet."
      : null;
  }

  private static async sendOne(
    row: OpenStackProjectNoticeDelivery,
  ): Promise<void> {
    const id: ObjectID = new ObjectID(idOf(row));

    if (!(await OpenStackProjectNoticeDeliveryService.claimForSending(id))) {
      return;
    }

    const notice: OpenStackProjectNotice | null =
      await OpenStackProjectNoticeService.findOneById({
        id: row.openStackProjectNoticeId!,
        select: {
          _id: true,
          openStackProjectId: true,
          email: true,
          webhookUrl: true,
          isEnabled: true,
          previewedRecipient: true,
          previewSeenAt: true,
        },
        props: { isRoot: true },
      });

    const whyNot: string | null = await this.getWhyNotToSend(row, notice);

    if (whyNot) {
      await OpenStackProjectNoticeDeliveryService.updateOneById({
        id,
        data: {
          status: OpenStackProjectNoticeDeliveryStatus.Skipped,
          statusMessage: whyNot,
        },
        props: { isRoot: true },
      });
      return;
    }

    const message: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice(
      row.facts as unknown as OpenStackProjectNoticeFacts,
    );

    const outcome: OpenStackNoticeSendOutcome = await this.deliver({
      row,
      notice: notice!,
      message,
    });

    if (outcome.isSent) {
      await OpenStackProjectNoticeDeliveryService.updateOneById({
        id,
        data: {
          status: OpenStackProjectNoticeDeliveryStatus.Sent,
          sentAt: OneUptimeDate.getCurrentDate(),
        },
        props: { isRoot: true },
      });
      return;
    }

    const attempts: number = (row.attempts || 0) + 1;
    const willTryAgain: boolean =
      Boolean(outcome.canTryAgain) && attempts < OPENSTACK_NOTICE_ATTEMPTS;

    await OpenStackProjectNoticeDeliveryService.updateOneById({
      id,
      data: {
        status: willTryAgain
          ? OpenStackProjectNoticeDeliveryStatus.Pending
          : OpenStackProjectNoticeDeliveryStatus.Failed,
        statusMessage: (outcome.message || "It could not be sent.").substring(
          0,
          490,
        ),
        ...(willTryAgain
          ? {
              nextAttemptAt: OneUptimeDate.addRemoveMinutes(
                OneUptimeDate.getCurrentDate(),
                RETRY_AFTER_MINUTES,
              ),
            }
          : {}),
      },
      props: { isRoot: true },
    });
  }

  public static async deliver(data: {
    row: OpenStackProjectNoticeDelivery;
    notice: OpenStackProjectNotice;
    message: OpenStackProjectNoticeMessage;
  }): Promise<OpenStackNoticeSendOutcome> {
    return data.notice.email
      ? this.sendEmail({ ...data, email: data.notice.email })
      : this.sendWebhook({ ...data, webhookUrl: data.notice.webhookUrl! });
  }

  private static async sendEmail(data: {
    row: OpenStackProjectNoticeDelivery;
    email: Email;
    message: OpenStackProjectNoticeMessage;
  }): Promise<OpenStackNoticeSendOutcome> {
    const html: string = await Markdown.convertToHTML(
      data.message.markdown,
      MarkdownContentType.Email,
    );

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        (await MailService.sendMail(
          {
            toEmail: data.email,
            templateType: EmailTemplateType.SimpleMessage,
            vars: { subject: data.message.subject, message: html },
            subject: data.message.subject,
            // What a name holds is not template syntax: see EmailMessage.
            isSubjectLiteral: true,
          },
          {
            projectId: data.row.projectId,
            incidentId: data.row.incidentId,
            scheduledMaintenanceId: data.row.scheduledMaintenanceId,
            timeoutInMs: EMAIL_TIMEOUT_IN_MS,
          },
        )) as HTTPResponse<JSONObject> | HTTPErrorResponse;

      if (response instanceof HTTPErrorResponse) {
        return {
          isSent: false,
          canTryAgain: true,
          message: `The mail service would not take it: ${response.statusCode}.`,
        };
      }

      return { isSent: true };
    } catch (error) {
      // Whether the mail service took it isn't known, so it isn't sent again.
      return {
        isSent: false,
        canTryAgain: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private static async sendWebhook(data: {
    row: OpenStackProjectNoticeDelivery;
    webhookUrl: URL;
    message: OpenStackProjectNoticeMessage;
  }): Promise<OpenStackNoticeSendOutcome> {
    const refusal: HTTPErrorResponse | null =
      await BlockedProjectNotifications.getRefusal({
        channel: "Webhook",
        projectId: data.row.projectId,
      });

    if (refusal) {
      return {
        isSent: false,
        canTryAgain: false,
        message: BlockedProjectNotifications.getNotSentReason("Webhook"),
      };
    }

    try {
      await SSRFProtection.validateWebhookTargetIsSafe(data.webhookUrl, {
        allowPrivateNetworkTargets: true,
      });
    } catch (error) {
      return {
        isSent: false,
        canTryAgain: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const deliveryId: string = idOf(data.row);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: data.webhookUrl,
          // A stable id, for a receiver that wants to be sure it acts once.
          data: { ...data.message.webhook, id: deliveryId },
          headers: { "Idempotency-Key": deliveryId },
          options: {
            retries: 0,
            timeout: WEBHOOK_TIMEOUT_IN_MS,
            // A public host could otherwise send this server on to an internal address.
            doNotFollowRedirects: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        const status: number = response.statusCode;

        return {
          isSent: false,
          // Only an answer saying it wasn't taken: 429 and the 500s.
          canTryAgain: status === 429 || status >= 500,
          message: `The webhook answered ${status}.`,
        };
      }

      return { isSent: true };
    } catch (error) {
      // A timeout may have been read at the other end, so it isn't sent again.
      return {
        isSent: false,
        canTryAgain: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
