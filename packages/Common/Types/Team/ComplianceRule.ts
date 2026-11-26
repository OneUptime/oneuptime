import ComplianceNotificationChannel from "./ComplianceNotificationChannel";
import ComplianceRuleType from "./ComplianceRuleType";
import NotificationRuleType from "../NotificationRule/NotificationRuleType";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  getListSeparator,
  isComposedValue,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";

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
  /*
   * The same sentence where the server's admins took the mobile app away
   * (Admin Dashboard > Settings > Help and Support, #10945), for a rule
   * whose sentence names the app; undefined for every other rule.
   */
  descriptionWithoutApp?: string | undefined;
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
      label: translationKey("Call"),
      method: { noun: "phone number for calls", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.SMS,
      label: translationKey("SMS"),
      method: { noun: "phone number for SMS", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Push,
      label: translationKey("Push notification"),
      method: { noun: "push notification device", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Email,
      label: translationKey("Email"),
      method: { noun: "email address", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.WhatsApp,
      label: translationKey("WhatsApp"),
      method: { noun: "WhatsApp number", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Telegram,
      label: translationKey("Telegram"),
      method: { noun: "Telegram account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Slack,
      label: translationKey("Slack"),
      method: { noun: "Slack account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.MicrosoftTeams,
      label: translationKey("Microsoft Teams"),
      method: { noun: "Microsoft Teams account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Mattermost,
      label: translationKey("Mattermost"),
      method: { noun: "Mattermost account", hasVerification: true },
    },
    {
      channel: ComplianceNotificationChannel.Webhook,
      label: translationKey("Webhook"),
      method: { noun: "webhook", hasVerification: false },
    },
    {
      channel: ComplianceNotificationChannel.CustomChannel,
      label: translationKey("Custom channel"),
      // The installation's, not the member's: nothing to add or verify.
      method: null,
    },
  ];

const methodRule: (data: {
  ruleType: ComplianceRuleType;
  channel: ComplianceMethodChannel;
  title: string;
  description: string;
  descriptionWithoutApp?: string | undefined;
}) => ComplianceRuleDefinition = (data: {
  ruleType: ComplianceRuleType;
  channel: ComplianceMethodChannel;
  title: string;
  description: string;
  descriptionWithoutApp?: string | undefined;
}): ComplianceRuleDefinition => {
  return {
    ruleType: data.ruleType,
    category: ComplianceRuleCategory.NotificationMethod,
    title: data.title,
    description: data.description,
    ...(data.descriptionWithoutApp
      ? { descriptionWithoutApp: data.descriptionWithoutApp }
      : {}),
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
      title: translationKey("Incident on-call rules"),
      description: translationKey(
        "Members are notified when an incident on-call policy pages them - for the severities and channels you choose.",
      ),
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      severityKind: ComplianceSeverityKind.Alert,
      subject: "alert",
      title: translationKey("Alert on-call rules"),
      description: translationKey(
        "Members are notified when an alert on-call policy pages them - for the severities and channels you choose.",
      ),
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      notificationRuleType:
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      severityKind: ComplianceSeverityKind.Incident,
      subject: "incident episode",
      title: translationKey("Incident episode on-call rules"),
      description: translationKey(
        "Members are notified when an incident episode on-call policy pages them - for the severities and channels you choose.",
      ),
    }),
    onCallRule({
      ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
      notificationRuleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      severityKind: ComplianceSeverityKind.Alert,
      subject: "alert episode",
      title: translationKey("Alert episode on-call rules"),
      description: translationKey(
        "Members are notified when an alert episode on-call policy pages them - for the severities and channels you choose.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
      channel: ComplianceNotificationChannel.Call,
      title: translationKey("Verified phone for calls"),
      description: translationKey(
        "Members have a verified phone number that can be called.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
      channel: ComplianceNotificationChannel.SMS,
      title: translationKey("Verified phone for SMS"),
      description: translationKey(
        "Members have a verified phone number that can receive SMS.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      channel: ComplianceNotificationChannel.Push,
      title: translationKey("Verified push device"),
      description: translationKey(
        "Members have the mobile app or a browser registered for push notifications.",
      ),
      descriptionWithoutApp: translationKey(
        "Members have a browser registered for push notifications.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      channel: ComplianceNotificationChannel.Email,
      title: translationKey("Verified email"),
      description: translationKey(
        "Members have a verified email address for notifications.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
      channel: ComplianceNotificationChannel.WhatsApp,
      title: translationKey("Verified WhatsApp"),
      description: translationKey("Members have a verified WhatsApp number."),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationTelegramMethod,
      channel: ComplianceNotificationChannel.Telegram,
      title: translationKey("Verified Telegram"),
      description: translationKey("Members have a verified Telegram account."),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationSlackMethod,
      channel: ComplianceNotificationChannel.Slack,
      title: translationKey("Verified Slack"),
      description: translationKey(
        "Members have a verified Slack account for direct messages.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
      channel: ComplianceNotificationChannel.MicrosoftTeams,
      title: translationKey("Verified Microsoft Teams"),
      description: translationKey(
        "Members have a verified Microsoft Teams account.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationMattermostMethod,
      channel: ComplianceNotificationChannel.Mattermost,
      title: translationKey("Verified Mattermost"),
      description: translationKey(
        "Members have a verified Mattermost account for direct messages.",
      ),
    }),
    methodRule({
      ruleType: ComplianceRuleType.HasNotificationWebhookMethod,
      channel: ComplianceNotificationChannel.Webhook,
      title: translationKey("Webhook configured"),
      description: translationKey(
        "Members have a webhook notification method.",
      ),
    }),
  ];

/*
 * HOW THE DASHBOARD SAYS A RULE, IN THE READER'S LANGUAGE (#8296, #8461).
 *
 * The catalog's names above are English the Dashboard looks up (each one a
 * translationKey, read by the string extractor as a "keys" root). Its
 * sentences are whole keys of their own, one per rule kind and shape,
 * because a language words "an incident on-call rule that notifies them by
 * Call" its own way: the subject, the article and the verb agree in it.
 * With no translator - the server, a unit test - each reads in English
 * word for word as it always did.
 */
interface OnCallRuleWords {
  // The rule's name when it insists on channels: "Call and SMS for incidents".
  titleWithChannels: string;
  // Every member must have the rule, on any channel.
  anyChannel: string;
  // ... on one channel.
  oneChannel: string;
  // ... on each of several channels, listed with CHANNEL_IN_SENTENCE.
  severalChannels: string;
  // The scope of a rule that covers every severity of its kind.
  everySeverity: string;
}

const ON_CALL_RULE_WORDS: Readonly<Record<string, OnCallRuleWords>> = {
  [ComplianceRuleType.HasIncidentOnCallRules]: {
    titleWithChannels: translationKey("{{channels}} for incidents"),
    anyChannel: translationKey(
      "Every member has an incident on-call rule for {{scope}}.",
    ),
    oneChannel: translationKey(
      "Every member has an incident on-call rule that notifies them by {{channel}} for {{scope}}.",
    ),
    severalChannels: translationKey(
      "Every member has incident on-call rules that notify them {{channels}} for {{scope}}.",
    ),
    everySeverity: translationKey("every incident severity"),
  },
  [ComplianceRuleType.HasAlertOnCallRules]: {
    titleWithChannels: translationKey("{{channels}} for alerts"),
    anyChannel: translationKey(
      "Every member has an alert on-call rule for {{scope}}.",
    ),
    oneChannel: translationKey(
      "Every member has an alert on-call rule that notifies them by {{channel}} for {{scope}}.",
    ),
    severalChannels: translationKey(
      "Every member has alert on-call rules that notify them {{channels}} for {{scope}}.",
    ),
    everySeverity: translationKey("every alert severity"),
  },
  [ComplianceRuleType.HasIncidentEpisodeOnCallRules]: {
    titleWithChannels: translationKey("{{channels}} for incident episodes"),
    anyChannel: translationKey(
      "Every member has an incident episode on-call rule for {{scope}}.",
    ),
    oneChannel: translationKey(
      "Every member has an incident episode on-call rule that notifies them by {{channel}} for {{scope}}.",
    ),
    severalChannels: translationKey(
      "Every member has incident episode on-call rules that notify them {{channels}} for {{scope}}.",
    ),
    everySeverity: translationKey("every incident episode severity"),
  },
  [ComplianceRuleType.HasAlertEpisodeOnCallRules]: {
    titleWithChannels: translationKey("{{channels}} for alert episodes"),
    anyChannel: translationKey(
      "Every member has an alert episode on-call rule for {{scope}}.",
    ),
    oneChannel: translationKey(
      "Every member has an alert episode on-call rule that notifies them by {{channel}} for {{scope}}.",
    ),
    severalChannels: translationKey(
      "Every member has alert episode on-call rules that notify them {{channels}} for {{scope}}.",
    ),
    everySeverity: translationKey("every alert episode severity"),
  },
};

/*
 * One channel of a rule on several, as the list after "notify them" says
 * each: "by Call and by Push notification" - the rule needs a rule on each.
 */
const CHANNEL_IN_SENTENCE: string = translationKey("by {{channel}}");

// What every member of a method rule must have, as one sentence.
const METHOD_RULE_SENTENCES: Readonly<Record<string, string>> = {
  [ComplianceNotificationChannel.Call]: translationKey(
    "Every member has a verified phone number for calls.",
  ),
  [ComplianceNotificationChannel.SMS]: translationKey(
    "Every member has a verified phone number for SMS.",
  ),
  [ComplianceNotificationChannel.Push]: translationKey(
    "Every member has a verified push notification device.",
  ),
  [ComplianceNotificationChannel.Email]: translationKey(
    "Every member has a verified email address.",
  ),
  [ComplianceNotificationChannel.WhatsApp]: translationKey(
    "Every member has a verified WhatsApp number.",
  ),
  [ComplianceNotificationChannel.Telegram]: translationKey(
    "Every member has a verified Telegram account.",
  ),
  [ComplianceNotificationChannel.Slack]: translationKey(
    "Every member has a verified Slack account.",
  ),
  [ComplianceNotificationChannel.MicrosoftTeams]: translationKey(
    "Every member has a verified Microsoft Teams account.",
  ),
  [ComplianceNotificationChannel.Mattermost]: translationKey(
    "Every member has a verified Mattermost account.",
  ),
  [ComplianceNotificationChannel.Webhook]: translationKey(
    "Every member has a webhook notification method.",
  ),
};

export const UNKNOWN_RULE: string = translationKey("Unknown rule");

const UNKNOWN_RULE_SENTENCE: string = translationKey(
  'Unknown compliance rule "{{ruleType}}".',
);

// A list the way a sentence says it, each shape a whole key: "a, b and c".
const LIST_WITH_AND: Readonly<Record<2 | 3, string>> = {
  2: translationKey("{{first}} and {{second}}"),
  3: translationKey("{{first}}, {{second}} and {{third}}"),
};

// The language of the server, of a unit test, and of a page with no translator.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

/*
 * "A, B and C" - the severity lists in sentences read as prose, not as a
 * comma-separated dump. With a translator, in its language: "A, B und C",
 * "A、B 和 C" (a longer list says the first ones together, with the
 * language's own separator). Without one, English, as the server writes it.
 */
export const joinAsProse: (
  items: Array<string>,
  translator?: Translator | undefined,
) => string = (
  items: Array<string>,
  translator?: Translator | undefined,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  if (!translator) {
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  }

  if (items.length > 3) {
    const together: number = items.length - 2;

    return joinAsProse(
      [
        items.slice(0, together).join(getListSeparator(translator.language)),
        ...items.slice(together),
      ],
      translator,
    );
  }

  const [first, second, third] = items;

  return translator.translateTemplate(
    LIST_WITH_AND[items.length as 2 | 3],
    third === undefined
      ? { first: first!, second: second! }
      : { first: first!, second: second!, third: third },
  );
};

/*
 * A value of a sentence, as the sentence's translator writes it: a name as
 * written, a number in its digits, a term or a composed value in its words.
 */
export const getValueInSentence: (
  value: TemplateValue,
  sentence: Translator,
) => string = (value: TemplateValue, sentence: Translator): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return sentence.formatNumber(value);
  }

  if (isComposedValue(value)) {
    return value.compose(sentence);
  }

  return sentence.translateTerm(value.translatableTerm, {
    inSentence: value.inSentence,
  });
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
   * "Verified push device". With a translator, in its language ("Anruf für
   * Vorfälle"); a rule type this build does not know reads as stored.
   */
  public static getTitle(
    data: {
      ruleType: string | undefined | null;
      notificationChannels?: Array<string> | undefined | null;
    },
    translator: Translator = ENGLISH,
  ): string {
    const definition: ComplianceRuleDefinition | undefined =
      ComplianceRule.getDefinition(data.ruleType);

    if (!definition) {
      return data.ruleType || translator.translateText(UNKNOWN_RULE) || "";
    }

    const channelLabels: Array<string> = ComplianceRule.getChannelLabels(
      data.notificationChannels,
    );
    const words: OnCallRuleWords | undefined =
      ON_CALL_RULE_WORDS[definition.ruleType];

    if (
      definition.category === ComplianceRuleCategory.OnCallRule &&
      channelLabels.length > 0 &&
      words
    ) {
      return translator.translateTemplate(words.titleWithChannels, {
        channels: ComplianceRule.getChannelList(channelLabels),
      });
    }

    return translator.translateText(definition.title) || definition.title;
  }

  /*
   * The rule as one sentence about what every member must have, e.g.
   * "Every member has an incident on-call rule that notifies them by Call for
   * Critical Incident and Major Incident." A rule on several channels needs a
   * rule on each, and says so: "Every member has incident on-call rules that
   * notify them by Call and by Push notification for Critical Incident."
   *
   * `severityNames` is the rule's scope. Empty means every severity, which is
   * what a rule with no severities selected enforces. A name goes in as the
   * page says it - a name as written, or a default name as a term of the
   * sentence (recordNameInSentence), which takes the sentence's language.
   *
   * With a translator the sentence is the reader's: each shape is one whole
   * key, so a language words the subject, the article and the verb together.
   */
  public static describe(
    data: {
      ruleType: string | undefined | null;
      notificationChannels?: Array<string> | undefined | null;
      severityNames?: Array<TemplateValue> | undefined;
    },
    translator: Translator = ENGLISH,
  ): string {
    const definition: ComplianceRuleDefinition | undefined =
      ComplianceRule.getDefinition(data.ruleType);

    if (!definition) {
      return translator.translateTemplate(UNKNOWN_RULE_SENTENCE, {
        ruleType: data.ruleType || "",
      });
    }

    if (definition.category === ComplianceRuleCategory.NotificationMethod) {
      const sentence: string | undefined = definition.methodChannel
        ? METHOD_RULE_SENTENCES[definition.methodChannel]
        : undefined;

      return sentence
        ? translator.translateText(sentence) || sentence
        : "Every member has a verified notification method.";
    }

    const words: OnCallRuleWords | undefined =
      ON_CALL_RULE_WORDS[definition.ruleType];

    if (!words) {
      return "";
    }

    const severityNames: Array<TemplateValue> = data.severityNames || [];
    const scope: TemplateValue =
      severityNames.length === 0
        ? translatableTerm(words.everySeverity)
        : composedValue((sentence: Translator): string => {
            return joinAsProse(
              severityNames.map((name: TemplateValue): string => {
                return getValueInSentence(name, sentence);
              }),
              sentence,
            );
          });

    const channelLabels: Array<string> = ComplianceRule.getChannelLabels(
      data.notificationChannels,
    );

    if (channelLabels.length > 1) {
      return translator.translateTemplate(words.severalChannels, {
        channels: composedValue((sentence: Translator): string => {
          return joinAsProse(
            channelLabels.map((label: string): string => {
              return sentence.translateTemplate(CHANNEL_IN_SENTENCE, {
                channel: translatableTerm(label),
              });
            }),
            sentence,
          );
        }),
        scope: scope,
      });
    }

    if (channelLabels.length === 1) {
      return translator.translateTemplate(words.oneChannel, {
        channel: translatableTerm(channelLabels[0]!),
        scope: scope,
      });
    }

    return translator.translateTemplate(words.anyChannel, { scope: scope });
  }

  /*
   * A channel's name in the reader's language - "Anruf", "Push-
   * Benachrichtigung" - or, for a channel this build does not know, the
   * value as stored.
   */
  public static getChannelLabel(
    channel: string | undefined | null,
    translator: Translator = ENGLISH,
  ): string {
    const label: string | undefined =
      ComplianceRule.getChannelDefinition(channel)?.label;

    if (!label) {
      return channel || "";
    }

    return translator.translateText(label) || label;
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

  // Channels' names as a list in a sentence, each in the sentence's language.
  private static getChannelList(labels: Array<string>): TemplateValue {
    return composedValue((sentence: Translator): string => {
      return joinAsProse(
        labels.map((label: string): string => {
          return sentence.translateText(label) || label;
        }),
        sentence,
      );
    });
  }
}
