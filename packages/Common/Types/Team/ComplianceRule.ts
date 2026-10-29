import ComplianceNotificationChannel from "./ComplianceNotificationChannel";
import ComplianceRuleType from "./ComplianceRuleType";
import NotificationRuleType from "../NotificationRule/NotificationRuleType";

/*
 * The catalog of team compliance rules: what each ComplianceRuleType means,
 * which options it takes, and how to say it in a sentence. The server (which
 * evaluates rules), the settings service (which validates them) and the
 * Dashboard (which builds and describes them) all read this one table, so the
 * three can never disagree about whether, say, an alert rule takes incident
 * severities.
 *
 * Pure data and pure functions only - this file is bundled into the Dashboard.
 *
 * A channel is either a method a member owns - a phone, a push device, a
 * webhook - or a custom channel (#5332), which is the installation's: its
 * admin adds it, and a member's on-call rule just names it. The second kind
 * has nothing per person, so its definition has no method and there is no
 * "has a verified ..." rule for it; only on-call rules can insist on it.
 */

export enum ComplianceRuleCategory {
  // The member has a verified notification method on one channel.
  NotificationMethod = "NotificationMethod",
  /*
   * The member has on-call notification rules for a set of severities,
   * optionally on specific channels - on every one of them.
   */
  OnCallRule = "OnCallRule",
}

export enum ComplianceSeverityKind {
  Incident = "Incident",
  Alert = "Alert",
}

// The method a member owns on a channel.
export interface ComplianceChannelMethod {
  // What a member has to add: "phone number for calls", "push device", ...
  noun: string;
  /*
   * False only for webhooks, which have no verification step: a configured
   * webhook is usable as it stands, and the runtime treats it that way.
   */
  hasVerification: boolean;
}

export interface ComplianceChannelDefinition {
  channel: ComplianceNotificationChannel;
  // "Call", "Push notification", ...
  label: string;
  /*
   * The method a member owns on this channel, or null for a channel with
   * nothing per person: a custom channel is set up once, by the
   * installation's admin, and reaches whoever's on-call rule names it. Such
   * a channel has no method rule, and an on-call rule on it is met by a rule
   * that pages through a custom channel that is on.
   */
  method: ComplianceChannelMethod | null;
}

/*
 * The channels a member owns a method on - every channel whose definition
 * has one, which is every channel but CustomChannel. Method rules exist for
 * exactly these.
 */
export type ComplianceMethodChannel = Exclude<
  ComplianceNotificationChannel,
  ComplianceNotificationChannel.CustomChannel
>;

export interface ComplianceRuleDefinition {
  ruleType: ComplianceRuleType;
  category: ComplianceRuleCategory;
  // Short name for the rule kind, used on builder cards.
  title: string;
  // One sentence on what the rule checks.
  description: string;
  // NotificationMethod rules: the channel whose verified method is required.
  methodChannel?: ComplianceMethodChannel | undefined;
  // OnCallRule rules: the notification rule type the member must have.
  notificationRuleType?: NotificationRuleType | undefined;
  // OnCallRule rules: which severity list scopes the rule.
  severityKind?: ComplianceSeverityKind | undefined;
  // OnCallRule rules: "incident", "alert", "incident episode", "alert episode".
  subject?: string | undefined;
}

export const COMPLIANCE_CHANNEL_DEFINITIONS: ReadonlyArray<ComplianceChannelDefinition> =
  [
    {
      channel: ComplianceNotificationChannel.Call,
      label: "Call",
      method: { noun: "phone number for calls", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.SMS,
      label: "SMS",
      method: { noun: "phone number for SMS", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Push,
      label: "Push notification",
      method: { noun: "push notification device", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Email,
      label: "Email",
      method: { noun: "email address", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.WhatsApp,
      label: "WhatsApp",
      method: { noun: "WhatsApp number", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Telegram,
      label: "Telegram",
      method: { noun: "Telegram account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Slack,
      label: "Slack",
      method: { noun: "Slack account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.MicrosoftTeams,
      label: "Microsoft Teams",
      method: { noun: "Microsoft Teams account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Webhook,
      label: "Webhook",
      method: { noun: "webhook", hasVerification: false },
    },
    {
      channel: ComplianceNotificationChannel.CustomChannel,
      label: "Custom channel",
      // The installation's, not the member's: nothing to add or verify.
      method: null,
    },
  ];

const methodRule: (data: {
  ruleType: ComplianceRuleType;
  channel: ComplianceMethodChannel;
  title: string;
  description: string;
}) => ComplianceRuleDefinition = (data: {
  ruleType: ComplianceRuleType;
  channel: ComplianceMethodChannel;
  title: string;
  description: string;
}): ComplianceRuleDefinition => {
  return {
    ruleType: data.ruleType,
    category: ComplianceRuleCategory.NotificationMethod,
    title: data.title,
    description: data.description,
    methodChannel: data.channel,
  };
};

const onCallRule: (data: {
  ruleType: ComplianceRuleType;
  notificationRuleType: NotificationRuleType;
  severityKind: ComplianceSeverityKind;
  subject: string;
  title: string;
  description: string;
}) => ComplianceRuleDefinition = (data: {
  ruleType: ComplianceRuleType;
  notificationRuleType: NotificationRuleType;
  severityKind: ComplianceSeverityKind;
  subject: string;
  title: string;
  description: string;
}): ComplianceRuleDefinition => {
  return {
    ruleType: data.ruleType,
    category: ComplianceRuleCategory.OnCallRule,
    title: data.title,
    description: data.description,
    notificationRuleType: data.notificationRuleType,
    severityKind: data.severityKind,
    subject: data.subject,
  };
};

/*
 * In the order the Dashboard offers them: the on-call rules first, because
 * "will this person actually be paged for a critical incident" is the question
 * this page exists to answer, then the method rules.
 */
export const COMPLIANCE_RULE_DEFINITIONS: ReadonlyArray<ComplianceRuleDefinition> =
  [
    onCallRule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      severityKind: ComplianceSeverityKind.Incident,
      subject: "incident",
      title: "Incident on-call rules",
      description:
        "Members are notified when an incident on-call policy pages them - for the severities and channels you choose.",
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      severityKind: ComplianceSeverityKind.Alert,
      subject: "alert",
      title: "Alert on-call rules",
      description:
        "Members are notified when an alert on-call policy pages them - for the severities and channels you choose.",
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      notificationRuleType:
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityKind: ComplianceSeverityKind.Incident,
      subject: "incident episode",
      title: "Incident episode on-call rules",
      description:
        "Members are notified when an incident episode on-call policy pages them - for the severities and channels you choose.",
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      severityKind: ComplianceSeverityKind.Alert,
      subject: "alert episode",
      title: "Alert episode on-call rules",
      description:
        "Members are notified when an alert episode on-call policy pages them - for the severities and channels you choose.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
      channel: ComplianceNotificationChannel.Call,
      title: "Verified phone for calls",
      description: "Members have a verified phone number that can be called.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
      channel: ComplianceNotificationChannel.SMS,
      title: "Verified phone for SMS",
      description: "Members have a verified phone number that can receive SMS.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      channel: ComplianceNotificationChannel.Push,
      title: "Verified push device",
      description:
        "Members have the mobile app or a browser registered for push notifications.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      channel: ComplianceNotificationChannel.Email,
      title: "Verified email",
      description: "Members have a verified email address for notifications.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
      channel: ComplianceNotificationChannel.WhatsApp,
      title: "Verified WhatsApp",
      description: "Members have a verified WhatsApp number.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationTelegramMethod,
      channel: ComplianceNotificationChannel.Telegram,
      title: "Verified Telegram",
      description: "Members have a verified Telegram account.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationSlackMethod,
      channel: ComplianceNotificationChannel.Slack,
      title: "Verified Slack",
      description: "Members have a verified Slack account for direct messages.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
      channel: ComplianceNotificationChannel.MicrosoftTeams,
      title: "Verified Microsoft Teams",
      description: "Members have a verified Microsoft Teams account.",
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationWebhookMethod,
      channel: ComplianceNotificationChannel.Webhook,
      title: "Webhook configured",
      description: "Members have a webhook notification method.",
    }),
  ];

/*
 * "A, B and C" - the severity lists in sentences read as prose, not as a
 * comma-separated dump.
 */
export const joinAsProse: (items: Array<string>) => string = (
  items: Array<string>,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

export default class ComplianceRule {
  public static getDefinition(
    ruleType: string | undefined | null,
  ): ComplianceRuleDefinition | undefined {
    return COMPLIANCE_RULE_DEFINITIONS.find(
      (definition: ComplianceRuleDefinition): boolean => {
        return definition.ruleType === ruleType;
      },
    );
  }

  public static getChannelDefinition(
    channel: string | undefined | null,
  ): ComplianceChannelDefinition | undefined {
    return COMPLIANCE_CHANNEL_DEFINITIONS.find(
      (definition: ComplianceChannelDefinition): boolean => {
        return definition.channel === channel;
      },
    );
  }

  public static isKnownRuleType(value: unknown): value is ComplianceRuleType {
    return (
      typeof value === "string" && Boolean(ComplianceRule.getDefinition(value))
    );
  }

  public static isKnownChannel(
    value: unknown,
  ): value is ComplianceNotificationChannel {
    return (
      typeof value === "string" &&
      Boolean(ComplianceRule.getChannelDefinition(value))
    );
  }

  /*
   * Whether a member owns a method on the channel - every channel but a
   * custom one, which has nothing per person (ComplianceChannelDefinition).
   */
  public static isMethodChannel(
    channel: string | undefined | null,
  ): channel is ComplianceMethodChannel {
    return Boolean(ComplianceRule.getChannelDefinition(channel)?.method);
  }

  /*
   * A rule's channels as one canonical list: the known channels in `value`,
   * each once, in catalog order - so two lists naming the same channels read,
   * compare and store alike however they were picked. Anything that is not a
   * list reads as no channels ("any channel"), and so does a list of nothing
   * this build recognises; the settings service refuses such input on write,
   * so only rows it did not write can hold it.
   */
  public static normaliseChannels(
    value: unknown,
  ): Array<ComplianceNotificationChannel> {
    if (!Array.isArray(value)) {
      return [];
    }

    return COMPLIANCE_CHANNEL_DEFINITIONS.map(
      (
        definition: ComplianceChannelDefinition,
      ): ComplianceNotificationChannel => {
        return definition.channel;
      },
    ).filter((channel: ComplianceNotificationChannel): boolean => {
      return value.includes(channel);
    });
  }

  public static isOnCallRule(ruleType: string | undefined | null): boolean {
    return (
      ComplianceRule.getDefinition(ruleType)?.category ===
      ComplianceRuleCategory.OnCallRule
    );
  }

  /*
   * Only on-call rules take a severity scope and channels. A method rule
   * ("has a verified email") has neither, and any that arrive with one are
   * ignored rather than half-applied.
   */
  public static supportsSeverityScope(
    ruleType: string | undefined | null,
  ): boolean {
    return ComplianceRule.isOnCallRule(ruleType);
  }

  public static supportsChannel(ruleType: string | undefined | null): boolean {
    return ComplianceRule.isOnCallRule(ruleType);
  }

  public static getSeverityKind(
    ruleType: string | undefined | null,
  ): ComplianceSeverityKind | undefined {
    return ComplianceRule.getDefinition(ruleType)?.severityKind;
  }

  public static getMethodRuleTypeForChannel(
    channel: ComplianceNotificationChannel,
  ): ComplianceRuleType | undefined {
    return COMPLIANCE_RULE_DEFINITIONS.find(
      (definition: ComplianceRuleDefinition): boolean => {
        return (
          definition.category === ComplianceRuleCategory.NotificationMethod &&
          definition.methodChannel === channel
        );
      },
    )?.ruleType;
  }

  /*
   * The rule's name as a list row shows it: "Call for incidents",
   * "Call and Push notification for incidents", "Incident on-call rules",
   * "Verified push device".
   */
  public static getTitle(data: {
    ruleType: string | undefined | null;
    notificationChannels?: Array<string> | undefined | null;
  }): string {
    const definition: ComplianceRuleDefinition | undefined =
      ComplianceRule.getDefinition(data.ruleType);

    if (!definition) {
      return data.ruleType || "Unknown rule";
    }

    const channelLabels: Array<string> = ComplianceRule.getChannelLabels(
      data.notificationChannels,
    );

    if (
      definition.category === ComplianceRuleCategory.OnCallRule &&
      channelLabels.length > 0
    ) {
      return `${joinAsProse(channelLabels)} for ${definition.subject}s`;
    }

    return definition.title;
  }

  /*
   * The rule as one sentence about what every member must have, e.g.
   * "Every member has an incident on-call rule that notifies them by Call for
   * Critical Incident and Major Incident." A rule on several channels needs a
   * rule on each, and says so: "Every member has incident on-call rules that
   * notify them by Call and by Push notification for Critical Incident."
   *
   * `severityNames` is the rule's scope. Empty means every severity, which is
   * what a rule with no severities selected enforces.
   */
  public static describe(data: {
    ruleType: string | undefined | null;
    notificationChannels?: Array<string> | undefined | null;
    severityNames?: Array<string> | undefined;
  }): string {
    const definition: ComplianceRuleDefinition | undefined =
      ComplianceRule.getDefinition(data.ruleType);

    if (!definition) {
      return `Unknown compliance rule "${data.ruleType || ""}".`;
    }

    if (definition.category === ComplianceRuleCategory.NotificationMethod) {
      const method: ComplianceChannelMethod | null | undefined =
        ComplianceRule.getChannelDefinition(definition.methodChannel)?.method;

      if (method && !method.hasVerification) {
        return `Every member has a ${method.noun} notification method.`;
      }

      return `Every member has a verified ${method?.noun || "notification method"}.`;
    }

    const severityNames: Array<string> = data.severityNames || [];
    const scope: string =
      severityNames.length === 0
        ? `every ${definition.subject} severity`
        : joinAsProse(severityNames);

    const channelLabels: Array<string> = ComplianceRule.getChannelLabels(
      data.notificationChannels,
    );

    if (channelLabels.length > 1) {
      return `Every member has ${definition.subject || ""} on-call rules that notify them ${joinAsProse(
        channelLabels.map((label: string): string => {
          return `by ${label}`;
        }),
      )} for ${scope}.`;
    }

    if (channelLabels.length === 1) {
      return `Every member has ${ComplianceRule.withArticle(definition.subject || "")} on-call rule that notifies them by ${channelLabels[0]} for ${scope}.`;
    }

    return `Every member has ${ComplianceRule.withArticle(definition.subject || "")} on-call rule for ${scope}.`;
  }

  // The labels of the known channels in `channels`, in catalog order.
  private static getChannelLabels(
    channels: Array<string> | undefined | null,
  ): Array<string> {
    return ComplianceRule.normaliseChannels(channels).map(
      (channel: ComplianceNotificationChannel): string => {
        return ComplianceRule.getChannelDefinition(channel)?.label || channel;
      },
    );
  }

  private static withArticle(noun: string): string {
    return "aeiou".includes(noun.charAt(0).toLowerCase())
      ? `an ${noun}`
      : `a ${noun}`;
  }
}
