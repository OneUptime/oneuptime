import { JSONObject } from "../JSON";
import UserNotificationEventType from "../UserNotification/UserNotificationEventType";
import { fitTextsToBudget } from "../../Utils/MessageFit";

/*
 * WHAT A CUSTOM CHANNEL'S SERVICE RECEIVES.
 *
 * One JSON POST per person per notification, signed with the channel's secret
 * (X-OneUptime-Signature: sha256=<hex HMAC-SHA256 of the body>) and naming its
 * event in X-OneUptime-Event. A page to several people is several requests,
 * each with that person's own action links, so OneUptime knows who answered.
 *
 * The shape is a contract with services OneUptime does not own, so it carries
 * a version, fields are only ever added to it, and the docs
 * (self-hosted/custom-notification-channels) describe every one of them.
 *
 * Pure, with no Node or browser APIs.
 */

export const CUSTOM_CHANNEL_PAYLOAD_VERSION: number = 1;

/*
 * How a custom channel is named among the methods - in readiness, an on-call
 * log, the fallback's list of channels used - beside "Email", "SMS" and the
 * rest. OnCallReadinessService's ReadinessMethodType.CustomChannel spells it
 * the same.
 */
export const CUSTOM_CHANNEL_METHOD_LABEL: string = "Custom Channel";

// The header a request names its event in.
export const CUSTOM_CHANNEL_EVENT_HEADER: string = "X-OneUptime-Event";

// The header a request's signature rides in.
export const CUSTOM_CHANNEL_SIGNATURE_HEADER: string = "X-OneUptime-Signature";

/*
 * The text a request carries at most - title, message and description
 * together, in characters. A description can be megabytes (a response body
 * or a log a template placed in it); the longest text is cut first and ends
 * with the note that sends the reader to OneUptime (MessageFit), so a title
 * stays whole.
 */
export const MAX_CUSTOM_CHANNEL_TEXT_LENGTH: number = 16384;

export enum CustomChannelEvent {
  IncidentCreated = "on-call.incident.created",
  AlertCreated = "on-call.alert.created",
  IncidentEpisodeCreated = "on-call.incidentEpisode.created",
  AlertEpisodeCreated = "on-call.alertEpisode.created",
  // Sent by Send test, from the admin's page or a person's own.
  Test = "test",
}

// What the record a page is about is, in `recordType`.
export enum CustomChannelRecordType {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incidentEpisode",
  AlertEpisode = "alertEpisode",
}

/*
 * What a channel's service can do about a page, each by a POST to the link of
 * that name in `actions`: acknowledge it, escalate it to the next level (the
 * person cannot take it - the "Can't take it? Escalate" of every other
 * channel), or resolve the record.
 */
export enum CustomChannelAction {
  Acknowledge = "acknowledge",
  Escalate = "escalate",
  Resolve = "resolve",
}

export const CUSTOM_CHANNEL_ACTIONS: ReadonlyArray<CustomChannelAction> = [
  CustomChannelAction.Acknowledge,
  CustomChannelAction.Escalate,
  CustomChannelAction.Resolve,
];

export const isCustomChannelAction: (
  value: unknown,
) => value is CustomChannelAction = (
  value: unknown,
): value is CustomChannelAction => {
  return CUSTOM_CHANNEL_ACTIONS.includes(value as CustomChannelAction);
};

/*
 * What an action did, in the answer to its POST. "already" answers are not
 * errors: somebody else got there first, or the same button was pressed
 * twice.
 */
export enum CustomChannelActionResult {
  Acknowledged = "acknowledged",
  AlreadyAcknowledged = "alreadyAcknowledged",
  Escalated = "escalated",
  NotEscalated = "notEscalated",
  Resolved = "resolved",
  AlreadyResolved = "alreadyResolved",
}

export interface CustomChannelReference {
  id: string;
  name: string;
}

export interface CustomChannelPerson {
  id: string;
  name: string;
  email: string;
}

export interface CustomChannelRecord {
  id: string;
  // "INC-42", "#42", or empty when the record has no number.
  number: string;
  title: string;
  description: string;
  severity: string;
  state: string;
  // The record in the Dashboard.
  url: string;
}

export type CustomChannelActionLinks = Record<CustomChannelAction, string>;

export interface CustomChannelPageInput {
  event: CustomChannelEvent;
  notificationId: string;
  sentAt: Date;
  channel: CustomChannelReference;
  title: string;
  message: string;
  project: CustomChannelReference;
  team?: CustomChannelReference | undefined;
  user: CustomChannelPerson;
  recordType: CustomChannelRecordType;
  record: CustomChannelRecord;
  onCallPolicy?: CustomChannelReference | undefined;
  escalationRule?: CustomChannelReference | undefined;
  // A page again: the record was acknowledged a while ago, and is still not resolved.
  isPageAgain: boolean;
  actions: CustomChannelActionLinks;
}

export interface CustomChannelTestInput {
  sentAt: Date;
  channel: CustomChannelReference;
  user: CustomChannelPerson;
  project?: CustomChannelReference | undefined;
}

// The event and record type of an on-call page, by what fired it.
export const getCustomChannelEventFor: (
  eventType: UserNotificationEventType,
) => { event: CustomChannelEvent; recordType: CustomChannelRecordType } = (
  eventType: UserNotificationEventType,
): { event: CustomChannelEvent; recordType: CustomChannelRecordType } => {
  switch (eventType) {
    case UserNotificationEventType.IncidentCreated:
      return {
        event: CustomChannelEvent.IncidentCreated,
        recordType: CustomChannelRecordType.Incident,
      };
    case UserNotificationEventType.AlertCreated:
      return {
        event: CustomChannelEvent.AlertCreated,
        recordType: CustomChannelRecordType.Alert,
      };
    case UserNotificationEventType.IncidentEpisodeCreated:
      return {
        event: CustomChannelEvent.IncidentEpisodeCreated,
        recordType: CustomChannelRecordType.IncidentEpisode,
      };
    case UserNotificationEventType.AlertEpisodeCreated:
      return {
        event: CustomChannelEvent.AlertEpisodeCreated,
        recordType: CustomChannelRecordType.AlertEpisode,
      };
  }
};

const toReferenceJson: (
  reference: CustomChannelReference | undefined,
) => JSONObject | null = (
  reference: CustomChannelReference | undefined,
): JSONObject | null => {
  if (!reference) {
    return null;
  }

  return {
    id: reference.id,
    name: reference.name,
  };
};

// The body of a request about an on-call page.
export const buildCustomChannelPagePayload: (
  input: CustomChannelPageInput,
) => JSONObject = (input: CustomChannelPageInput): JSONObject => {
  const [title, message, description] = fitTextsToBudget(
    [input.title, input.message, input.record.description],
    MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
  );

  return {
    version: CUSTOM_CHANNEL_PAYLOAD_VERSION,
    event: input.event,
    notificationId: input.notificationId,
    sentAt: input.sentAt.toISOString(),
    channel: toReferenceJson(input.channel),
    title: title || "",
    message: message || "",
    project: toReferenceJson(input.project),
    team: toReferenceJson(input.team),
    user: {
      id: input.user.id,
      name: input.user.name,
      email: input.user.email,
    },
    recordType: input.recordType,
    record: {
      id: input.record.id,
      number: input.record.number,
      title: input.record.title,
      description: description || "",
      severity: input.record.severity,
      state: input.record.state,
      url: input.record.url,
    },
    onCallPolicy: toReferenceJson(input.onCallPolicy),
    escalationRule: toReferenceJson(input.escalationRule),
    isPageAgain: input.isPageAgain,
    actions: {
      [CustomChannelAction.Acknowledge]:
        input.actions[CustomChannelAction.Acknowledge],
      [CustomChannelAction.Escalate]:
        input.actions[CustomChannelAction.Escalate],
      [CustomChannelAction.Resolve]: input.actions[CustomChannelAction.Resolve],
    },
  };
};

/*
 * The body of Send test: the same shape with no record and nothing to act
 * on, so a service can be tried against it before a real page arrives.
 */
export const buildCustomChannelTestPayload: (
  input: CustomChannelTestInput,
) => JSONObject = (input: CustomChannelTestInput): JSONObject => {
  return {
    version: CUSTOM_CHANNEL_PAYLOAD_VERSION,
    event: CustomChannelEvent.Test,
    notificationId: null,
    sentAt: input.sentAt.toISOString(),
    channel: toReferenceJson(input.channel),
    title: `Test from OneUptime: ${input.channel.name}`,
    message: `This is a test of the ${input.channel.name} custom channel for ${input.user.name || input.user.email}. On-call pages to this person will arrive like this.`,
    project: toReferenceJson(input.project),
    team: null,
    user: {
      id: input.user.id,
      name: input.user.name,
      email: input.user.email,
    },
    recordType: null,
    record: null,
    onCallPolicy: null,
    escalationRule: null,
    isPageAgain: false,
    actions: null,
  };
};
