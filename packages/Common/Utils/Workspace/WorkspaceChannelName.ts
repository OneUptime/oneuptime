import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NumberPrefixUtil, { NumberPrefixColumn } from "../Project/NumberPrefix";

/*
 * THE NAME OF A CHANNEL A NOTIFICATION RULE CREATES.
 *
 * A Slack or Microsoft Teams rule that creates a channel for each incident,
 * alert, episode, scheduled maintenance event, monitor or on-call policy
 * names it after the record:
 *
 *   - with no prefix, the channel is the record's own name: inc-42 for
 *     incident INC-42 (its number as the project's Number Prefix page writes
 *     it), sm-7 for scheduled maintenance SM-7, apihealth for the monitor
 *     "API Health";
 *   - with a prefix, the prefix comes first: prod- makes prod-inc-42.
 *
 * The prefix is the rule's newChannelTemplateName. It used to be required,
 * and a rule saved without one through the API was given
 * "oneuptime-incident-" and the like (getLegacyDefaultPrefix); the data
 * migration KeepChannelNamePrefixOfRulesWithoutOne writes that into those
 * rules, so they keep naming channels as they did, and an empty prefix now
 * means none.
 *
 * Everything a rule with a prefix names is named exactly as before: the
 * prefix as stored, then the record's number (a scheduled maintenance
 * event's without its number prefix) or name, with what the workspace does
 * not take left out. What is new is only what used to fail: a name longer
 * than the workspace takes is shortened (the prefix first, so the record's
 * part that tells channels apart stays whole), a Microsoft Teams name does
 * not start with a space or an underscore, and a name somebody already has
 * is tried again with -2, -3 and so on (getChannelName's attempt).
 *
 * Slack: lowercase letters, numbers, - and _, at most 80 characters
 * (conversations.create). Microsoft Teams: what OneUptime has always kept
 * (letters, numbers, -, _ and spaces), at most 50 characters (the Graph
 * channel's displayName), not starting with an underscore.
 *
 * Pure, in Common/Utils, so the server that creates channels and the rule
 * form that previews their name work it out the same way.
 */

/*
 * What a channel name is made of for one record: what follows a rule's
 * prefix, and the record's own name for a rule without one.
 */
export interface WorkspaceChannelNameParts {
  /*
   * What follows a rule's prefix, as rules with a prefix have always named
   * channels: the record's number as the project writes it (INC-42), a
   * scheduled maintenance event's bare number (42), a monitor's or on-call
   * policy's name. Characters a channel name may not hold are left out
   * when the name is made.
   */
  afterPrefix: string;
  /*
   * The record's own name, for a rule without a prefix: inc-42, sm-7, a
   * monitor's name. Never empty, and always holds a letter: a record whose
   * number or name has none (a project without number prefixes writes
   * incidents #42) is named after what it is, incident-42.
   */
  ownName: string;
}

/*
 * The Project column that holds the number prefix of each kind of numbered
 * record a rule can be for. Monitors and on-call policies have names.
 */
export const NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE: Readonly<
  Partial<Record<NotificationRuleEventType, NumberPrefixColumn>>
> = {
  [NotificationRuleEventType.Incident]: "incidentNumberPrefix",
  [NotificationRuleEventType.Alert]: "alertNumberPrefix",
  [NotificationRuleEventType.IncidentEpisode]: "incidentEpisodeNumberPrefix",
  [NotificationRuleEventType.AlertEpisode]: "alertEpisodeNumberPrefix",
  [NotificationRuleEventType.ScheduledMaintenance]:
    "scheduledMaintenanceNumberPrefix",
};

/*
 * A project's number prefixes by the kind of record a rule is for: "INC-",
 * or null for a project that writes its incidents #42.
 */
export type WorkspaceChannelNumberPrefixes = Partial<
  Record<NotificationRuleEventType, string | null>
>;

/*
 * A record to show a channel name with: what people call it (INC-42, the
 * monitor "API Health") and the parts of its channel's name.
 */
export interface WorkspaceChannelNameExample {
  recordName: string;
  parts: WorkspaceChannelNameParts;
}

// A channel name with what the workspace changed in what was typed.
export interface WorkspaceChannelNameDescription {
  name: string;
  /*
   * The prefix lost characters the workspace does not take in a channel
   * name, or (Slack) its capital letters.
   */
  prefixChanged: boolean;
  // The name was cut to the workspace's limit.
  shortened: boolean;
}

/*
 * What a record is called in a channel name made from its kind:
 * incident-42 for a project that writes its incidents #42.
 */
const RECORD_WORDS: Record<NotificationRuleEventType, string> = {
  [NotificationRuleEventType.Incident]: "incident",
  [NotificationRuleEventType.Alert]: "alert",
  [NotificationRuleEventType.IncidentEpisode]: "incident-episode",
  [NotificationRuleEventType.AlertEpisode]: "alert-episode",
  [NotificationRuleEventType.ScheduledMaintenance]: "maintenance",
  [NotificationRuleEventType.Monitor]: "monitor",
  [NotificationRuleEventType.OnCallDutyPolicy]: "on-call-policy",
};

/*
 * A monitor or on-call policy to show a channel name with, in a project that
 * has none yet.
 */
const EXAMPLE_RECORD_NAMES: Partial<Record<NotificationRuleEventType, string>> =
  {
    [NotificationRuleEventType.Monitor]: "Website",
    [NotificationRuleEventType.OnCallDutyPolicy]: "Primary",
  };

// Everything a Slack channel name may not hold (and the record's part never holds).
const NOT_IN_SLACK_CHANNEL_NAME: RegExp = /[^a-z0-9\-_]/g;

// Everything OneUptime leaves out of a Microsoft Teams channel name.
const NOT_IN_TEAMS_CHANNEL_NAME: RegExp = /[^a-zA-Z0-9\-_\s]/g;

const HAS_LETTER: RegExp = /[a-z]/;

// What a Microsoft Teams channel name may not start or end with.
const TEAMS_NAME_START: RegExp = /^[\s_]+/;
const TEAMS_NAME_END: RegExp = /\s+$/;

// The separators a record's own name does not start with.
const LEADING_SEPARATORS: RegExp = /^[-_]+/;

export default class WorkspaceChannelName {
  public static readonly SLACK_MAX_LENGTH: number = 80;

  public static readonly MICROSOFT_TEAMS_MAX_LENGTH: number = 50;

  /*
   * How many names are tried for one channel: the name, then -2, -3, -4 and
   * -5 after it while the workspace says the name is taken.
   */
  public static readonly MAX_NAME_ATTEMPTS: number = 5;

  // The longest channel name the workspace takes.
  public static getMaxLength(workspaceType: WorkspaceType): number {
    return workspaceType === WorkspaceType.MicrosoftTeams
      ? WorkspaceChannelName.MICROSOFT_TEAMS_MAX_LENGTH
      : WorkspaceChannelName.SLACK_MAX_LENGTH;
  }

  // What a record is called in a channel name made from its kind.
  public static getRecordWord(eventType: NotificationRuleEventType): string {
    return RECORD_WORDS[eventType] || "record";
  }

  /*
   * The prefix a rule's channels start with, as the rule stores it, or ""
   * for none: nothing, or nothing but spaces.
   */
  public static getPrefix(rule: {
    newChannelTemplateName?: string | null | undefined;
  }): string {
    const prefix: unknown = rule.newChannelTemplateName;

    if (typeof prefix !== "string" || !prefix.trim()) {
      return "";
    }

    return prefix;
  }

  public static hasPrefix(prefix: string | null | undefined): boolean {
    return Boolean(prefix && prefix.trim());
  }

  /*
   * The prefix every rule saved without one used to get: oneuptime-incident-,
   * oneuptime-scheduled maintenance- (the space is left out of the name, in
   * Slack). Written into those rules once (the data migration
   * KeepChannelNamePrefixOfRulesWithoutOne), so their channels keep their
   * names now that an empty prefix means none.
   */
  public static getLegacyDefaultPrefix(
    eventType: NotificationRuleEventType,
  ): string {
    return `oneuptime-${eventType.toLowerCase()}-`;
  }

  /*
   * The parts of the name of an incident's, alert's, episode's or scheduled
   * maintenance event's channel. numberWithPrefix is the number as the
   * project writes it (INC-42, #42).
   */
  public static forNumberedRecord(data: {
    eventType: NotificationRuleEventType;
    number: number;
    numberWithPrefix?: string | null | undefined;
  }): WorkspaceChannelNameParts {
    const numberWithPrefix: string =
      data.numberWithPrefix ||
      NumberPrefixUtil.formatNumber(undefined, data.number);

    /*
     * A scheduled maintenance event's channel has always been named with
     * the bare number (prefix-42), while every other record's carries the
     * number's prefix (prefix-inc-42). A rule with a prefix keeps naming
     * them so.
     */
    const afterPrefix: string =
      data.eventType === NotificationRuleEventType.ScheduledMaintenance
        ? data.number.toString()
        : data.numberWithPrefix || data.number.toString();

    return {
      afterPrefix: afterPrefix,
      ownName: WorkspaceChannelName.getOwnName({
        eventType: data.eventType,
        text: numberWithPrefix,
      }),
    };
  }

  // The parts of the name of a monitor's or on-call policy's channel.
  public static forNamedRecord(data: {
    eventType: NotificationRuleEventType;
    name: string;
  }): WorkspaceChannelNameParts {
    const name: string = (data.name || "").toLowerCase();

    return {
      afterPrefix: name,
      ownName: WorkspaceChannelName.getOwnName({
        eventType: data.eventType,
        text: name,
      }),
    };
  }

  /*
   * The parts of the name of the channel Test Rule creates: the rule's
   * prefix and a few random letters (prod-abcde), or test-abcde for a rule
   * without a prefix.
   */
  public static forTest(data: { randomText: string }): WorkspaceChannelNameParts {
    const randomText: string = WorkspaceChannelName.toRecordPart(
      data.randomText,
    );

    return {
      afterPrefix: data.randomText,
      ownName: randomText ? `test-${randomText}` : "test",
    };
  }

  /*
   * Whether a kind of record is numbered (incidents, alerts, episodes,
   * scheduled maintenance events) rather than named (monitors, on-call
   * policies).
   */
  public static isNumberedRecord(eventType: NotificationRuleEventType): boolean {
    return Boolean(NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE[eventType]);
  }

  /*
   * A record of a kind to show a channel name with, in the rule form's
   * preview: number 42 as the project writes it (INC-42, or #42 for a
   * project without a number prefix), or a monitor's or on-call policy's
   * name - one of the project's when it has one.
   */
  public static getExample(data: {
    eventType: NotificationRuleEventType;
    numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
    recordName?: string | null | undefined;
  }): WorkspaceChannelNameExample {
    if (WorkspaceChannelName.isNumberedRecord(data.eventType)) {
      const numberWithPrefix: string = NumberPrefixUtil.formatNumber(
        data.numberPrefixes?.[data.eventType],
        NumberPrefixUtil.EXAMPLE_NUMBER,
      );

      return {
        recordName: numberWithPrefix,
        parts: WorkspaceChannelName.forNumberedRecord({
          eventType: data.eventType,
          number: NumberPrefixUtil.EXAMPLE_NUMBER,
          numberWithPrefix: numberWithPrefix,
        }),
      };
    }

    const recordName: string =
      data.recordName?.trim() ||
      EXAMPLE_RECORD_NAMES[data.eventType] ||
      EXAMPLE_RECORD_NAMES[NotificationRuleEventType.Monitor]!;

    return {
      recordName: recordName,
      parts: WorkspaceChannelName.forNamedRecord({
        eventType: data.eventType,
        name: recordName,
      }),
    };
  }

  /*
   * The name of the channel a rule creates for a record, as the workspace
   * takes it. attempt 2 and later name the channel to try when the name
   * before it was taken: prod-inc-42-2.
   */
  public static getChannelName(data: {
    workspaceType: WorkspaceType;
    prefix: string | null | undefined;
    parts: WorkspaceChannelNameParts;
    attempt?: number | undefined;
  }): string {
    return WorkspaceChannelName.describe(data).name;
  }

  /*
   * The name, and what the workspace changed on the way: what the rule
   * form's preview says under the name.
   */
  public static describe(data: {
    workspaceType: WorkspaceType;
    prefix: string | null | undefined;
    parts: WorkspaceChannelNameParts;
    attempt?: number | undefined;
  }): WorkspaceChannelNameDescription {
    const maxLength: number = WorkspaceChannelName.getMaxLength(
      data.workspaceType,
    );

    const attemptSuffix: string =
      data.attempt && data.attempt > 1 ? `-${Math.floor(data.attempt)}` : "";

    const prefix: string = WorkspaceChannelName.hasPrefix(data.prefix)
      ? (data.prefix as string)
      : "";

    let prefixPart: string = WorkspaceChannelName.toWorkspaceText({
      workspaceType: data.workspaceType,
      text: prefix,
    });

    let recordPart: string = prefix
      ? WorkspaceChannelName.toRecordPart(data.parts.afterPrefix)
      : data.parts.ownName;

    const prefixChanged: boolean = prefixPart !== prefix;

    /*
     * Nothing left of either (a prefix of characters a channel name may
     * not hold, a monitor named "!!!"): the record's own name, rather than
     * a name the workspace refuses.
     */
    if (!WorkspaceChannelName.toFinalName(data.workspaceType, prefixPart + recordPart)) {
      prefixPart = "";
      recordPart = data.parts.ownName;
    }

    let shortened: boolean = false;

    /*
     * Too long: the prefix gives way first, so the record's part - what
     * tells one record's channel from the next - stays whole.
     */
    if (recordPart.length + attemptSuffix.length > maxLength) {
      recordPart = recordPart.substring(0, maxLength - attemptSuffix.length);
      prefixPart = "";
      shortened = true;
    } else if (
      prefixPart.length + recordPart.length + attemptSuffix.length >
      maxLength
    ) {
      prefixPart = prefixPart.substring(
        0,
        maxLength - recordPart.length - attemptSuffix.length,
      );
      shortened = true;
    }

    return {
      name: WorkspaceChannelName.toFinalName(
        data.workspaceType,
        prefixPart + recordPart + attemptSuffix,
      ),
      prefixChanged: prefixChanged,
      shortened: shortened,
    };
  }

  /*
   * A record's number or name as it follows a prefix: lowercase letters,
   * numbers, - and _ - the characters both workspaces take as they are.
   */
  public static toRecordPart(text: string | null | undefined): string {
    return (text || "")
      .toString()
      .toLowerCase()
      .replace(NOT_IN_SLACK_CHANNEL_NAME, "");
  }

  /*
   * Text as the workspace keeps it in a channel name: Slack's lowercase
   * letters, numbers, - and _; for Microsoft Teams, letters (either case),
   * numbers, -, _ and spaces.
   */
  public static toWorkspaceText(data: {
    workspaceType: WorkspaceType;
    text: string;
  }): string {
    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      return data.text.replace(NOT_IN_TEAMS_CHANNEL_NAME, "");
    }

    return data.text.toLowerCase().replace(NOT_IN_SLACK_CHANNEL_NAME, "");
  }

  private static toFinalName(
    workspaceType: WorkspaceType,
    name: string,
  ): string {
    if (workspaceType === WorkspaceType.MicrosoftTeams) {
      return name.replace(TEAMS_NAME_START, "").replace(TEAMS_NAME_END, "");
    }

    return name;
  }

  /*
   * The record's own name: its number or name with what a channel name may
   * not hold left out, not starting with - or _; after what the record is
   * when nothing of a letter is left (incident-42, monitor-2024, monitor).
   */
  private static getOwnName(data: {
    eventType: NotificationRuleEventType;
    text: string;
  }): string {
    const ownName: string = WorkspaceChannelName.toRecordPart(data.text).replace(
      LEADING_SEPARATORS,
      "",
    );

    if (HAS_LETTER.test(ownName)) {
      return ownName;
    }

    const recordWord: string = WorkspaceChannelName.getRecordWord(
      data.eventType,
    );

    return ownName ? `${recordWord}-${ownName}` : recordWord;
  }
}
