import AppMetrics from "./AppMetrics";
import logger from "../Logger";
import MailTransportType from "../../../Types/Email/MailTransportType";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import SmsStatus from "../../../Types/SmsStatus";
import WhatsAppStatus from "../../../Types/WhatsAppStatus";

/*
 * NOTIFICATION DELIVERY METRICS: WHAT THE PLATFORM'S OPERATOR DEFINES
 * DELIVERY SLOS ON (issue #6600).
 *
 * Whoever runs OneUptime for other people - OneUptime Cloud, a company's
 * self-hosted installation - promises them that a page goes out, and fast.
 * These metrics are how they can tell, across every project, from
 * OneUptime's own telemetry (the OpenTelemetry exporter, openTelemetryExporter
 * in the Helm chart):
 *
 *   notification.trigger.count  how many records notify people: incidents,
 *                               alerts and their episodes, by type, by whether
 *                               a monitor or a person created them, and by the
 *                               monitor's type ("Incoming Request", "Logs").
 *   notification.send.count     every message handed to a provider, and how it
 *   notification.send.duration  went: by channel (sms, call, push, custom
 *                               channel ...), provider (twilio, expo, the
 *                               installation's SMS and call gateway, a mail
 *                               service, a custom channel - with its id and
 *                               name) and outcome (success, failure, not_sent).
 *   notification.time_to_send   how long after its trigger an on-call page was
 *                               accepted by its provider (OnCallPageTiming).
 *   notification.delivery.count     how a message the provider accepted
 *   notification.delivery.duration  ended, when the provider tells it later:
 *                               an SMS delivered or not, a call answered or
 *                               not, a push Apple or Google took or not, and
 *                               how long that took (issue #6648).
 *
 * Slack, Microsoft Teams and Mattermost messages also say where they went
 * (notification.destination): to a person, into a channel, or to an incoming
 * webhook (issue #6645).
 *
 * Every sender records through this file, so a channel, a provider or an
 * outcome is spelled one way everywhere, and every attribute keeps to a
 * bounded set of values: never a project, a person, a phone number or a
 * record. The one exception is a custom channel's id and name - custom
 * channels belong to the installation, its admin adds a handful, and telling
 * them apart is the point.
 *
 * Recording never fails a send: a metric that cannot be recorded is logged
 * and dropped.
 */

// The way a message reaches somebody.
export enum NotificationDeliveryChannel {
  Email = "email",
  SMS = "sms",
  Call = "call",
  WhatsApp = "whatsapp",
  Telegram = "telegram",
  Push = "push",
  Webhook = "webhook",
  Slack = "slack",
  MicrosoftTeams = "microsoft_teams",
  Mattermost = "mattermost",
  CustomChannel = "custom_channel",
}

// What a message was handed to.
export enum NotificationDeliveryProvider {
  // Not handed to any: it was not sent, or failed before one was picked.
  None = "none",
  Twilio = "twilio",
  // The installation's own HTTP gateway for SMS and calls (CallAndSmsProvider).
  SmsAndCallGateway = "sms_and_call_gateway",
  SMTP = "smtp",
  SendGrid = "sendgrid",
  AmazonSES = "amazon_ses",
  Mailgun = "mailgun",
  Postmark = "postmark",
  Resend = "resend",
  MicrosoftGraph = "microsoft_graph",
  // Expo's push service, with this installation's Expo access token.
  Expo = "expo",
  // Expo through OneUptime's push relay, for installations without a token.
  PushRelay = "push_relay",
  // A browser's push service (VAPID).
  WebPush = "web_push",
  MetaWhatsApp = "meta_whatsapp",
  TelegramBotApi = "telegram_bot_api",
  Slack = "slack",
  MicrosoftTeams = "microsoft_teams",
  Mattermost = "mattermost",
  Webhook = "webhook",
  CustomChannel = "custom_channel",
}

export enum NotificationDeliveryOutcome {
  // The provider accepted it.
  Success = "success",
  // The provider refused it or could not be reached, or sending it failed.
  Failure = "failure",
  /*
   * Deliberately not sent: the project turned the channel off, has too
   * little balance, is blocked, or the channel is off on this server. The
   * settings working, not the platform failing - so a success rate leaves
   * these out.
   */
  NotSent = "not_sent",
}

/*
 * Whose account a provider was used with: the installation's own (the Admin
 * Dashboard's settings, or the installation's Expo token, gateway, bot and
 * custom channels), or one a project configured for itself - its own Twilio
 * account, its own SMTP server - whose failures are the project's to fix.
 */
export enum NotificationProviderConfig {
  Global = "global",
  Project = "project",
}

// The record that triggered notifications.
export enum NotificationTriggerType {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incident_episode",
  AlertEpisode = "alert_episode",
}

// Who created it: a monitor (OneUptime's probes and workers), or a person.
export enum NotificationTriggerSource {
  Automatic = "automatic",
  Manual = "manual",
}

/*
 * What an on-call page's time to send is measured from (OnCallPageTiming),
 * for a page that started with its record: the moment OneUptime received
 * the data that tripped the monitor - an incoming request, which waits in a
 * queue before it is evaluated - or else the record's creation, the moment
 * a monitor's own check, a telemetry monitor's evaluation or a person
 * opened it. For a page started later - by a person, a workflow, a rule
 * that now matches, a page again, or after a hold the on-call rules ask
 * for - the moment it started.
 */
export enum OnCallPageStart {
  MonitorDataReceived = "monitor_data_received",
  RecordCreated = "record_created",
  PageStarted = "page_started",
}

/*
 * Where a Slack, Microsoft Teams or Mattermost message went (issue #6645).
 * Only those three channels carry it: every message of the others goes to
 * one person.
 */
export enum NotificationDestination {
  // To one person: the notification methods' own (WorkspaceUserNotificationService).
  DirectMessage = "direct_message",
  /*
   * Into a channel - or a Teams group chat - as the project's bot:
   * workspace notification rules, live run messages (WorkspaceChannelPosts).
   */
  Channel = "channel",
  // To an incoming webhook somebody made: a status page subscriber's.
  IncomingWebhook = "incoming_webhook",
}

/*
 * How a message the provider accepted ended, as the provider tells it later
 * (notification.delivery.count, issue #6648). Final: a message has one.
 */
export enum NotificationDeliveryStatus {
  // It reached the phone: the carrier's delivery receipt, Apple or Google took the push.
  Delivered = "delivered",
  /*
   * It never reached the phone: the carrier could not deliver the SMS, the
   * phone's app is gone (Expo's DeviceNotRegistered).
   */
  Undelivered = "undelivered",
  // The provider could not send it at all.
  Failed = "failed",
  // A call somebody - or their voicemail - picked up.
  Answered = "answered",
  // A call that rang out, or found the line busy or declined.
  NotAnswered = "not_answered",
}

// The attribute names, one spelling for every sender.
export enum NotificationMetricAttribute {
  Channel = "notification.channel",
  Provider = "notification.provider",
  ProviderConfig = "notification.provider.config",
  Outcome = "outcome",
  OnCallPage = "notification.on_call_page",
  CustomChannelId = "notification.custom_channel.id",
  CustomChannelName = "notification.custom_channel.name",
  TriggerType = "notification.trigger.type",
  TriggerSource = "notification.trigger.source",
  MonitorType = "monitor.type",
  PageStart = "notification.page.start",
  Destination = "notification.destination",
}

// The most of a custom channel's name an attribute carries.
export const MAX_CUSTOM_CHANNEL_NAME_LENGTH: number = 100;

// Which custom channel a message went to.
export interface NotificationCustomChannelIdentity {
  id: string;
  name?: string | undefined;
}

// What is known of a message as its sending starts.
export interface NotificationDispatchStart {
  channel: NotificationDeliveryChannel;
  provider?: NotificationDeliveryProvider | undefined;
  providerConfig?: NotificationProviderConfig | undefined;
  // A notification of an on-call page (it has an on-call timeline row).
  isOnCallPage?: boolean | undefined;
  customChannel?: NotificationCustomChannelIdentity | undefined;
  // Where a Slack, Microsoft Teams or Mattermost message went.
  destination?: NotificationDestination | undefined;
}

/*
 * A message's final status, as its provider told it - Twilio's status
 * callbacks, Expo's receipts, Meta's status webhooks. The sender's own
 * record of it says which channel, provider and account it went out on, and
 * whether it was an on-call page, as notification.send.count said them.
 */
export interface NotificationDeliveryReport {
  channel: NotificationDeliveryChannel;
  provider: NotificationDeliveryProvider;
  providerConfig?: NotificationProviderConfig | undefined;
  isOnCallPage: boolean;
  status: NotificationDeliveryStatus;
  /*
   * How long after the provider accepted the message it ended so, when that
   * is known (notification.delivery.duration). Left out when it is not: a
   * push's receipt says nothing of when Apple or Google took it.
   */
  timeToStatusInMs?: number | undefined;
}

export type NotificationMetricAttributes = Record<string, string>;

/*
 * Never throws: a metric is not worth a page. The logger itself may be a
 * test double that leaves debug out.
 */
function reportRecordingFailure(err: unknown): void {
  try {
    logger.debug(`Could not record a notification delivery metric: ${err}`);
  } catch {
    // Recording is best effort, and so is saying it failed.
  }
}

// A custom channel's name as an attribute carries it: trimmed, and not too long.
function toCustomChannelName(name: string | undefined): string | undefined {
  const trimmed: string = (name || "").trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > MAX_CUSTOM_CHANNEL_NAME_LENGTH
    ? trimmed.substring(0, MAX_CUSTOM_CHANNEL_NAME_LENGTH)
    : trimmed;
}

function addCustomChannelAttributes(
  attributes: NotificationMetricAttributes,
  customChannel: NotificationCustomChannelIdentity | undefined,
): void {
  if (!customChannel || !customChannel.id) {
    return;
  }

  attributes[NotificationMetricAttribute.CustomChannelId] = customChannel.id;

  const name: string | undefined = toCustomChannelName(customChannel.name);

  if (name) {
    attributes[NotificationMetricAttribute.CustomChannelName] = name;
  }
}

/*
 * ONE MESSAGE BEING SENT, AS ITS SENDER TELLS IT.
 *
 * Started before anything else is done (startDispatch), told what it learns
 * on the way - the provider it picked, that it was deliberately not sent,
 * that the provider accepted it - and ended once (end), which records it.
 * Of the outcomes, the one marked wins: a send marked a success stays one
 * when what follows the provider's answer fails (a log row that could not be
 * written), and one marked not sent stays not sent when its caller asked for
 * that to throw. A send ended with no outcome marked takes the one its end
 * is given: success when it returned, failure when it threw.
 */
export class NotificationDispatch {
  private readonly channel: NotificationDeliveryChannel;
  private provider: NotificationDeliveryProvider;
  private providerConfig: NotificationProviderConfig;
  private isOnCallPage: boolean;
  private customChannel: NotificationCustomChannelIdentity | undefined;
  private readonly destination: NotificationDestination | undefined;
  private outcome: NotificationDeliveryOutcome | undefined = undefined;
  private readonly startedAtInNs: bigint;
  private isEnded: boolean = false;

  public constructor(start: NotificationDispatchStart) {
    this.channel = start.channel;
    this.provider = start.provider || NotificationDeliveryProvider.None;
    this.providerConfig =
      start.providerConfig || NotificationProviderConfig.Global;
    this.isOnCallPage = Boolean(start.isOnCallPage);
    this.customChannel = start.customChannel;
    this.destination = start.destination;
    this.startedAtInNs = process.hrtime.bigint();
  }

  public setProvider(
    provider: NotificationDeliveryProvider,
    providerConfig?: NotificationProviderConfig | undefined,
  ): void {
    this.provider = provider;

    if (providerConfig) {
      this.providerConfig = providerConfig;
    }
  }

  public setCustomChannel(
    customChannel: NotificationCustomChannelIdentity | undefined,
  ): void {
    this.customChannel = customChannel;
  }

  public setIsOnCallPage(isOnCallPage: boolean): void {
    this.isOnCallPage = isOnCallPage;
  }

  public markSucceeded(): void {
    this.outcome = NotificationDeliveryOutcome.Success;
  }

  public markFailed(): void {
    this.outcome = NotificationDeliveryOutcome.Failure;
  }

  public markNotSent(): void {
    this.outcome = NotificationDeliveryOutcome.NotSent;
  }

  public getOutcome(): NotificationDeliveryOutcome | undefined {
    return this.outcome;
  }

  public getProvider(): NotificationDeliveryProvider {
    return this.provider;
  }

  public isRecorded(): boolean {
    return this.isEnded;
  }

  public getAttributes(
    outcome: NotificationDeliveryOutcome,
  ): NotificationMetricAttributes {
    return NotificationDeliveryMetrics.getDispatchAttributes({
      channel: this.channel,
      provider: this.provider,
      providerConfig: this.providerConfig,
      isOnCallPage: this.isOnCallPage,
      customChannel: this.customChannel,
      destination: this.destination,
      outcome: outcome,
    });
  }

  /*
   * Records the send, once: a second end - a finally after a catch that
   * ended it - records nothing.
   */
  public end(outcomeIfNotMarked: NotificationDeliveryOutcome): void {
    if (this.isEnded) {
      return;
    }

    this.isEnded = true;

    try {
      const outcome: NotificationDeliveryOutcome =
        this.outcome || outcomeIfNotMarked;
      const durationInMs: number =
        Number(process.hrtime.bigint() - this.startedAtInNs) / 1e6;
      const attributes: NotificationMetricAttributes =
        this.getAttributes(outcome);

      AppMetrics.getNotificationCounter().add(1, attributes);
      AppMetrics.getNotificationDuration().record(
        Math.max(0, durationInMs),
        attributes,
      );
    } catch (err) {
      reportRecordingFailure(err);
    }
  }
}

export default class NotificationDeliveryMetrics {
  public static startDispatch(
    start: NotificationDispatchStart,
  ): NotificationDispatch {
    return new NotificationDispatch(start);
  }

  /*
   * Sends one message and records how it went: `send` is handed the
   * dispatch to tell what it learns, and the dispatch is ended as `send`
   * returns (success, unless marked otherwise) or throws (failure, unless
   * marked otherwise). Whatever `send` returns or throws is passed on.
   */
  public static async measureDispatch<T>(
    start: NotificationDispatchStart,
    send: (dispatch: NotificationDispatch) => Promise<T>,
  ): Promise<T> {
    const dispatch: NotificationDispatch = this.startDispatch(start);

    try {
      const result: T = await send(dispatch);
      dispatch.end(NotificationDeliveryOutcome.Success);
      return result;
    } catch (err) {
      dispatch.end(NotificationDeliveryOutcome.Failure);
      throw err;
    }
  }

  /*
   * A message deliberately not sent before it reached its sender - a
   * blocked project, push turned off on this server, a custom channel with
   * no Enterprise license - recorded as such, with no time of its own.
   */
  public static recordNotSent(start: NotificationDispatchStart): void {
    this.recordWithoutDuration(start, NotificationDeliveryOutcome.NotSent);
  }

  /*
   * A message that failed before anything was handed to its provider - a
   * chat channel that could not be found, a workspace that could not be
   * asked where to post - recorded as a failure, with no time of its own:
   * notification.send.duration is how long providers take.
   */
  public static recordFailedBeforeSend(start: NotificationDispatchStart): void {
    this.recordWithoutDuration(start, NotificationDeliveryOutcome.Failure);
  }

  private static recordWithoutDuration(
    start: NotificationDispatchStart,
    outcome: NotificationDeliveryOutcome,
  ): void {
    try {
      const attributes: NotificationMetricAttributes =
        this.getDispatchAttributes({
          channel: start.channel,
          provider: start.provider || NotificationDeliveryProvider.None,
          providerConfig:
            start.providerConfig || NotificationProviderConfig.Global,
          isOnCallPage: Boolean(start.isOnCallPage),
          customChannel: start.customChannel,
          destination: start.destination,
          outcome: outcome,
        });

      AppMetrics.getNotificationCounter().add(1, attributes);
    } catch (err) {
      reportRecordingFailure(err);
    }
  }

  /*
   * A message's final status arrived from its provider
   * (notification.delivery.count), and how long after the provider accepted
   * the message, when that is known (notification.delivery.duration). Its
   * caller records each message's final status once: on the transition of
   * the message's own log row into it, never on every callback. Clocks of
   * two servers can disagree by a little: a time below zero is recorded as
   * zero. Never throws.
   */
  public static recordDelivery(report: NotificationDeliveryReport): void {
    try {
      const attributes: NotificationMetricAttributes =
        this.getDeliveryAttributes(report);

      AppMetrics.getNotificationDeliveryCounter().add(1, attributes);

      if (
        typeof report.timeToStatusInMs === "number" &&
        Number.isFinite(report.timeToStatusInMs)
      ) {
        AppMetrics.getNotificationDeliveryDuration().record(
          Math.max(0, report.timeToStatusInMs),
          attributes,
        );
      }
    } catch (err) {
      reportRecordingFailure(err);
    }
  }

  // A record that notifies people was created (notification.trigger.count).
  public static recordTrigger(data: {
    type: NotificationTriggerType;
    source: NotificationTriggerSource;
    monitorType?: string | undefined;
  }): void {
    try {
      AppMetrics.getNotificationTriggerCounter().add(
        1,
        this.getTriggerAttributes(data),
      );
    } catch (err) {
      reportRecordingFailure(err);
    }
  }

  /*
   * An on-call page's notification was accepted by its provider, this long
   * after its page's trigger (notification.time_to_send). Clocks of two
   * servers can disagree by a little: a time below zero is recorded as zero.
   */
  public static recordTimeToSend(data: {
    channel: NotificationDeliveryChannel;
    customChannel?: NotificationCustomChannelIdentity | undefined;
    triggerType?: NotificationTriggerType | undefined;
    pageStart: OnCallPageStart;
    timeToSendInMs: number;
  }): void {
    try {
      if (!Number.isFinite(data.timeToSendInMs)) {
        return;
      }

      AppMetrics.getNotificationTimeToSend().record(
        Math.max(0, data.timeToSendInMs),
        this.getTimeToSendAttributes(data),
      );
    } catch (err) {
      reportRecordingFailure(err);
    }
  }

  public static getDispatchAttributes(data: {
    channel: NotificationDeliveryChannel;
    provider: NotificationDeliveryProvider;
    providerConfig: NotificationProviderConfig;
    isOnCallPage: boolean;
    customChannel?: NotificationCustomChannelIdentity | undefined;
    destination?: NotificationDestination | undefined;
    outcome: NotificationDeliveryOutcome;
  }): NotificationMetricAttributes {
    const attributes: NotificationMetricAttributes = {
      [NotificationMetricAttribute.Channel]: data.channel,
      [NotificationMetricAttribute.Provider]: data.provider,
      [NotificationMetricAttribute.ProviderConfig]: data.providerConfig,
      [NotificationMetricAttribute.OnCallPage]: data.isOnCallPage
        ? "true"
        : "false",
      [NotificationMetricAttribute.Outcome]: data.outcome,
    };

    addCustomChannelAttributes(attributes, data.customChannel);

    if (data.destination) {
      attributes[NotificationMetricAttribute.Destination] = data.destination;
    }

    return attributes;
  }

  /*
   * A final status's attributes: the message's channel, provider, account
   * and whether it was a page - as notification.send.count said them - and
   * the status, as `outcome`.
   */
  public static getDeliveryAttributes(data: {
    channel: NotificationDeliveryChannel;
    provider: NotificationDeliveryProvider;
    providerConfig?: NotificationProviderConfig | undefined;
    isOnCallPage: boolean;
    status: NotificationDeliveryStatus;
  }): NotificationMetricAttributes {
    return {
      [NotificationMetricAttribute.Channel]: data.channel,
      [NotificationMetricAttribute.Provider]: data.provider,
      [NotificationMetricAttribute.ProviderConfig]:
        data.providerConfig || NotificationProviderConfig.Global,
      [NotificationMetricAttribute.OnCallPage]: data.isOnCallPage
        ? "true"
        : "false",
      [NotificationMetricAttribute.Outcome]: data.status,
    };
  }

  /*
   * How long ago a message's log was written - as its provider accepted it
   * - for its final status's time (recordDelivery). Undefined for a log
   * with no time it was written.
   */
  public static getMillisecondsSince(
    writtenAt: Date | null | undefined,
    now: Date = new Date(),
  ): number | undefined {
    if (!writtenAt) {
      return undefined;
    }

    const writtenAtInMs: number = new Date(writtenAt).getTime();

    if (!Number.isFinite(writtenAtInMs)) {
      return undefined;
    }

    return now.getTime() - writtenAtInMs;
  }

  /*
   * The final status an SMS log's status is, for the delivery metrics: one
   * of Twilio's delivery receipts' (SmsService.mapProviderStatusToSmsStatus).
   * Null for a status that is not final - still being sent - or not one
   * Twilio reported (an error sending it, too little balance).
   */
  public static getDeliveryStatusOfSms(
    status: SmsStatus | null | undefined,
  ): NotificationDeliveryStatus | null {
    switch (status) {
      case SmsStatus.Delivered:
        return NotificationDeliveryStatus.Delivered;
      case SmsStatus.Undelivered:
        return NotificationDeliveryStatus.Undelivered;
      case SmsStatus.Failed:
        return NotificationDeliveryStatus.Failed;
      default:
        return null;
    }
  }

  /*
   * The final status a WhatsApp log's status is: delivered once Meta says
   * it reached the phone - or that it was read, which it says of a message
   * delivered - and failed when Meta could not deliver it. Null for any
   * other: sent, queued, a warning, an error sending it.
   */
  public static getDeliveryStatusOfWhatsApp(
    status: WhatsAppStatus | null | undefined,
  ): NotificationDeliveryStatus | null {
    switch (status) {
      case WhatsAppStatus.Delivered:
      case WhatsAppStatus.Read:
        return NotificationDeliveryStatus.Delivered;
      case WhatsAppStatus.Failed:
        return NotificationDeliveryStatus.Failed;
      default:
        return null;
    }
  }

  public static getTriggerAttributes(data: {
    type: NotificationTriggerType;
    source: NotificationTriggerSource;
    monitorType?: string | undefined;
  }): NotificationMetricAttributes {
    const attributes: NotificationMetricAttributes = {
      [NotificationMetricAttribute.TriggerType]: data.type,
      [NotificationMetricAttribute.TriggerSource]: data.source,
    };

    // A monitor's type is one of the MonitorType enum's values: bounded.
    const monitorType: string = (data.monitorType || "").trim();

    if (monitorType) {
      attributes[NotificationMetricAttribute.MonitorType] = monitorType;
    }

    return attributes;
  }

  public static getTimeToSendAttributes(data: {
    channel: NotificationDeliveryChannel;
    customChannel?: NotificationCustomChannelIdentity | undefined;
    triggerType?: NotificationTriggerType | undefined;
    pageStart: OnCallPageStart;
  }): NotificationMetricAttributes {
    const attributes: NotificationMetricAttributes = {
      [NotificationMetricAttribute.Channel]: data.channel,
      [NotificationMetricAttribute.PageStart]: data.pageStart,
    };

    if (data.triggerType) {
      attributes[NotificationMetricAttribute.TriggerType] = data.triggerType;
    }

    addCustomChannelAttributes(attributes, data.customChannel);

    return attributes;
  }

  /*
   * The type of the record an on-call log row was written for, by which of
   * its record columns is set; undefined for a row with none.
   */
  public static getTriggerTypeOf(row: {
    triggeredByIncidentId?: unknown;
    triggeredByAlertId?: unknown;
    triggeredByIncidentEpisodeId?: unknown;
    triggeredByAlertEpisodeId?: unknown;
  }): NotificationTriggerType | undefined {
    if (row.triggeredByIncidentId) {
      return NotificationTriggerType.Incident;
    }

    if (row.triggeredByAlertId) {
      return NotificationTriggerType.Alert;
    }

    if (row.triggeredByIncidentEpisodeId) {
      return NotificationTriggerType.IncidentEpisode;
    }

    if (row.triggeredByAlertEpisodeId) {
      return NotificationTriggerType.AlertEpisode;
    }

    return undefined;
  }

  /*
   * The channel of an on-call page's notification, as these metrics name
   * it; null for a value that is not one of OnCallPageChannel's.
   */
  public static getChannelOfOnCallPage(
    channel: OnCallPageChannel,
  ): NotificationDeliveryChannel | null {
    return DELIVERY_CHANNEL_OF_ON_CALL_PAGE_CHANNEL[channel] || null;
  }

  /*
   * The provider an email went out through, by the transport that sent it.
   * A value that is not a transport is SMTP's, as toMailTransportType reads
   * it.
   */
  public static getMailProvider(
    transport: MailTransportType,
  ): NotificationDeliveryProvider {
    return (
      MAIL_PROVIDER_OF_TRANSPORT[transport] || NotificationDeliveryProvider.SMTP
    );
  }
}

/*
 * Every OnCallPageChannel and every MailTransportType is named here - a new
 * one does not compile until it is - so no channel or transport goes
 * uncounted.
 */
const DELIVERY_CHANNEL_OF_ON_CALL_PAGE_CHANNEL: Record<
  OnCallPageChannel,
  NotificationDeliveryChannel
> = {
  [OnCallPageChannel.Call]: NotificationDeliveryChannel.Call,
  [OnCallPageChannel.SMS]: NotificationDeliveryChannel.SMS,
  [OnCallPageChannel.WhatsApp]: NotificationDeliveryChannel.WhatsApp,
  [OnCallPageChannel.Telegram]: NotificationDeliveryChannel.Telegram,
  [OnCallPageChannel.Push]: NotificationDeliveryChannel.Push,
  [OnCallPageChannel.Email]: NotificationDeliveryChannel.Email,
  [OnCallPageChannel.Slack]: NotificationDeliveryChannel.Slack,
  [OnCallPageChannel.MicrosoftTeams]:
    NotificationDeliveryChannel.MicrosoftTeams,
  [OnCallPageChannel.Mattermost]: NotificationDeliveryChannel.Mattermost,
  [OnCallPageChannel.Webhook]: NotificationDeliveryChannel.Webhook,
  [OnCallPageChannel.CustomChannel]: NotificationDeliveryChannel.CustomChannel,
};

const MAIL_PROVIDER_OF_TRANSPORT: Record<
  MailTransportType,
  NotificationDeliveryProvider
> = {
  [MailTransportType.SMTP]: NotificationDeliveryProvider.SMTP,
  [MailTransportType.MicrosoftGraph]:
    NotificationDeliveryProvider.MicrosoftGraph,
  [MailTransportType.AmazonSES]: NotificationDeliveryProvider.AmazonSES,
  [MailTransportType.SendGrid]: NotificationDeliveryProvider.SendGrid,
  [MailTransportType.Mailgun]: NotificationDeliveryProvider.Mailgun,
  [MailTransportType.Postmark]: NotificationDeliveryProvider.Postmark,
  [MailTransportType.Resend]: NotificationDeliveryProvider.Resend,
};
