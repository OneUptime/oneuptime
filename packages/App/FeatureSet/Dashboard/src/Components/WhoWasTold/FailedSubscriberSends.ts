import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { phoneNumberInLine } from "Common/Types/PhoneNumberDirection";
import SmsStatus from "Common/Types/SmsStatus";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceAttentionDialogRead } from "../ResourcePart/ResourceAttentionDialog";
import {
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../ResourcePart/ResourceAttention";

/*
 * WHICH SUBSCRIBERS WERE NOT TOLD, AND WHY (#9597).
 *
 * "Who was told" counted an incident's status page subscribers - "120
 * sent · 3 failed" - and said why only when the whole send failed or was
 * skipped: a partial failure was a bare count, with no way to the sends.
 * "3 failed" now opens them (ResourceAttentionPill): each subscriber email
 * and SMS that failed, to whom, from which status page, the provider's own
 * words for why, when, and View: the record's Notification Logs.
 *
 * The same rows the count counts (WhoWasToldService.readSubscribers): the
 * record's email and SMS logs sent for a status page, in a failed status.
 * Read when "3 failed" is pressed, with the reader's own access: a list
 * they may not read says so, and the other list is still shown.
 */

export const FAILED_SUBSCRIBER_SENDS_HINT: string = translationKey(
  "Show which sends failed and why",
);

export const FAILED_SUBSCRIBER_SENDS_DESCRIPTION: string = translationKey(
  "The emails and text messages to status page subscribers that failed, and why, the newest first.",
);

export const FAILED_SUBSCRIBER_SENDS_EMPTY: string = translationKey(
  "No send to a subscriber has failed.",
);

export const FAILED_SUBSCRIBER_SENDS_LOAD_FAILED: string = translationKey(
  "Couldn't read the failed sends.",
);

const FAILED_TEMPLATE: string = translationKey("Failed {{time}}");

// How many of each kind one read lists: the newest.
export const FAILED_SUBSCRIBER_SENDS_LIMIT: number = 50;

// The SMS statuses the count counts as failed (WhoWasToldService).
export const FAILED_SMS_STATUSES: Array<SmsStatus> = [
  SmsStatus.Error,
  SmsStatus.Failed,
  SmsStatus.Undelivered,
  SmsStatus.LowBalance,
];

// A failed send, as the dialog draws it.
export interface FailedSubscriberSend {
  id: string;
  channel: "email" | "sms";
  // Whom it was sent to: an email address, or a phone number.
  to: string;
  status: string;
  // The provider's own words for why, as it wrote them.
  statusMessage?: string | undefined;
  statusPageName?: string | undefined;
  sentAt?: Date | undefined;
}

export function getFailedSubscriberSendItems(data: {
  sends: Array<FailedSubscriberSend>;
  translator: Translator;
  logsRoute: Route;
}): Array<ResourceAttentionItem> {
  return [...data.sends]
    .sort((a: FailedSubscriberSend, b: FailedSubscriberSend): number => {
      return (b.sentAt?.getTime() || 0) - (a.sentAt?.getTime() || 0);
    })
    .map((send: FailedSubscriberSend): ResourceAttentionItem => {
      const facts: Array<ResourceAttentionFact> = [];

      if (send.statusPageName) {
        facts.push({
          key: "status-page",
          label: "Status Page",
          value: send.statusPageName,
        });
      }

      const isSms: boolean = send.channel === "sms";

      return {
        key: `${send.channel}-${send.id}`,
        kind: isSms ? "SMS" : "Email",
        icon: isSms ? IconProp.Phone : IconProp.Email,
        // A number reads the way it is written, on a page read from the right too.
        name: isSms
          ? phoneNumberInLine(send.to, data.translator.language) || send.id
          : send.to || send.id,
        severity: ResourceAttentionSeverity.Critical,
        // The status a provider gave it, when it said no more than that.
        reasons:
          send.statusMessage || !send.status
            ? []
            : [{ text: "{{reason}}", values: { reason: send.status } }],
        message: send.statusMessage || undefined,
        facts: facts,
        since: send.sentAt
          ? { at: send.sentAt, template: FAILED_TEMPLATE }
          : undefined,
        route: data.logsRoute,
      };
    });
}

function toDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }

  return value instanceof Date
    ? value
    : OneUptimeDate.fromString(value as string);
}

export async function loadFailedSubscriberSends(data: {
  recordKind: OnCallTestPageRecordKind;
  recordId: ObjectID;
  translator: Translator;
  logsRoute: Route;
}): Promise<ResourceAttentionDialogRead> {
  const recordColumn: "alertId" | "incidentId" =
    data.recordKind === OnCallTestPageRecordKind.Alert
      ? "alertId"
      : "incidentId";

  const [emails, texts]: [
    PromiseSettledResult<ListResult<EmailLog>>,
    PromiseSettledResult<ListResult<SmsLog>>,
  ] = await Promise.allSettled([
    ModelAPI.getList<EmailLog>({
      modelType: EmailLog,
      query: {
        [recordColumn]: data.recordId,
        statusPageId: new NotNull(),
        status: MailStatus.Error,
      } as Query<EmailLog>,
      limit: FAILED_SUBSCRIBER_SENDS_LIMIT,
      skip: 0,
      select: {
        _id: true,
        toEmail: true,
        status: true,
        statusMessage: true,
        createdAt: true,
        statusPage: { name: true },
      },
      sort: { createdAt: SortOrder.Descending },
    }),
    ModelAPI.getList<SmsLog>({
      modelType: SmsLog,
      query: {
        [recordColumn]: data.recordId,
        statusPageId: new NotNull(),
        status: new Includes(FAILED_SMS_STATUSES),
      } as Query<SmsLog>,
      limit: FAILED_SUBSCRIBER_SENDS_LIMIT,
      skip: 0,
      select: {
        _id: true,
        toNumber: true,
        status: true,
        statusMessage: true,
        createdAt: true,
        statusPage: { name: true },
      },
      sort: { createdAt: SortOrder.Descending },
    }),
  ]);

  // Neither could be read: the dialog says why, with Try again.
  if (emails.status === "rejected" && texts.status === "rejected") {
    throw emails.reason;
  }

  const sends: Array<FailedSubscriberSend> = [];

  if (emails.status === "fulfilled") {
    for (const log of emails.value.data) {
      sends.push({
        id: log._id?.toString() || "",
        channel: "email",
        to: log.toEmail?.toString() || "",
        status: log.status?.toString() || "",
        statusMessage: log.statusMessage || undefined,
        statusPageName: log.statusPage?.name || undefined,
        sentAt: toDate(log.createdAt),
      });
    }
  }

  if (texts.status === "fulfilled") {
    for (const log of texts.value.data) {
      sends.push({
        id: log._id?.toString() || "",
        channel: "sms",
        to: log.toNumber?.toString() || "",
        status: log.status?.toString() || "",
        statusMessage: log.statusMessage || undefined,
        statusPageName: log.statusPage?.name || undefined,
        sentAt: toDate(log.createdAt),
      });
    }
  }

  return {
    items: getFailedSubscriberSendItems({
      sends: sends,
      translator: data.translator,
      logsRoute: data.logsRoute,
    }),
    isTruncated:
      (emails.status === "fulfilled" &&
        emails.value.count > emails.value.data.length) ||
      (texts.status === "fulfilled" &&
        texts.value.count > texts.value.data.length),
  };
}
