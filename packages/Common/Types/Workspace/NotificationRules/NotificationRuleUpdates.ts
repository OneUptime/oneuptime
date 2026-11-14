import BaseNotificationRule from "./BaseNotificationRule";
import NotificationRuleEventType from "./EventType";
import NotificationRuleWorkspaceChannel, {
  NotificationRuleWorkspaceChannelUtil,
} from "./NotificationRuleWorkspaceChannel";

/*
 * WHICH UPDATES A WORKSPACE NOTIFICATION RULE POSTS (issue #7581).
 *
 * A record's channels hear of everything that happens to it: every state
 * change, note, owner, page and edit. A channel for the people working the
 * incident wants that. A quiet one - #executive-alerts - wants to hear that
 * an incident was declared and resolved, and little else, and every
 * granular update buried those two. So an incident, alert, episode or
 * scheduled maintenance rule says which updates it posts:
 *
 *   Which updates to post
 *   (o) Every update
 *   ( ) Key updates only   Resolved and reopened, severity changes,
 *                          public notes and the postmortem.
 *   ( ) Choose updates     [x] Resolved and reopened  [ ] Private notes ...
 *
 * The choice is stored on the rule, as the kinds of update it posts
 * (BaseNotificationRule.updatesToPost). No list - every rule saved before
 * there was a choice, and every new rule until somebody makes one - posts
 * every update, as rules always did. An empty list posts only what every
 * rule posts (ALWAYS_POSTED_UPDATE_KINDS): the record's first message -
 * declared, created or scheduled - which is what the channel is about, and
 * a video call's Join button, which a rule's Video Call step promises
 * "wherever the rule posts".
 *
 * Every entry of a record's feed is one kind of update
 * (Server/Utils/Feed/FeedUpdateKinds), and so is an on-call policy's run
 * message (Paging). A message is posted in a channel only when a rule the
 * channel is for wants one of its kinds (wantsUpdate, isWantedInChannel). A
 * message can be of more than one kind - an edit that changes the severity
 * and the title is a severity change and an edit - and is posted where any
 * of them is wanted.
 *
 * Monitor, on-call policy, security and SLO rules post every update; they
 * have no choice yet (getChoosableKinds is empty for them).
 */
export enum NotificationRuleUpdateKind {
  // The record's first message: declared, created or scheduled. Always posted.
  Created = "Created",
  // A video call started for the record, with its Join button. Always posted.
  VideoCallStarted = "VideoCallStarted",
  // Resolved, or reopened after it was resolved.
  ResolvedAndReopened = "ResolvedAndReopened",
  /*
   * Any other move between states: acknowledged, investigating, or on from
   * one resolved state to another. A scheduled maintenance event's every
   * state change.
   */
  StateChanges = "StateChanges",
  SeverityChanges = "SeverityChanges",
  // Notes shown on status pages.
  PublicNotes = "PublicNotes",
  PrivateNotes = "PrivateNotes",
  // Owners added and removed; an incident's roles - Incident Commander - too.
  Owners = "Owners",
  // An on-call policy's run: who was paged, who acknowledged, who was not reached.
  Paging = "Paging",
  // An episode's incidents (or alerts) added and removed.
  EpisodeMembers = "EpisodeMembers",
  // The postmortem's note, its draft and its status.
  Postmortem = "Postmortem",
  // AI root cause analyses, call summaries and automatic fixes.
  AI = "AI",
  // The title, description, labels, custom fields and other fields.
  Edits = "Edits",
  // Everything else: linked records, reminders, delivery problems.
  Other = "Other",
}

// What a rule picks on its Updates step.
export enum NotificationRuleUpdatesChoice {
  EveryUpdate = "EveryUpdate",
  KeyUpdates = "KeyUpdates",
  ChosenUpdates = "ChosenUpdates",
}

/*
 * Posted wherever a record's messages go, whatever a rule chose: the first
 * message, and a video call's Join button.
 */
export const ALWAYS_POSTED_UPDATE_KINDS: ReadonlyArray<NotificationRuleUpdateKind> =
  [
    NotificationRuleUpdateKind.Created,
    NotificationRuleUpdateKind.VideoCallStarted,
  ];

/*
 * The updates each kind of rule can choose, in the order its Updates step
 * lists them. Only what that kind of record posts: an alert has no public
 * notes or postmortem, an episode's severity changes stay in its feed, a
 * scheduled maintenance event's owners are not posted.
 */
const CHOOSABLE_UPDATE_KINDS: Readonly<
  Partial<
    Record<NotificationRuleEventType, ReadonlyArray<NotificationRuleUpdateKind>>
  >
> = {
  [NotificationRuleEventType.Incident]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.SeverityChanges,
    NotificationRuleUpdateKind.PublicNotes,
    NotificationRuleUpdateKind.PrivateNotes,
    NotificationRuleUpdateKind.Owners,
    NotificationRuleUpdateKind.Paging,
    NotificationRuleUpdateKind.Postmortem,
    NotificationRuleUpdateKind.AI,
    NotificationRuleUpdateKind.Edits,
    NotificationRuleUpdateKind.Other,
  ],
  [NotificationRuleEventType.Alert]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.SeverityChanges,
    NotificationRuleUpdateKind.PrivateNotes,
    NotificationRuleUpdateKind.Owners,
    NotificationRuleUpdateKind.Paging,
    NotificationRuleUpdateKind.AI,
    NotificationRuleUpdateKind.Edits,
    NotificationRuleUpdateKind.Other,
  ],
  [NotificationRuleEventType.IncidentEpisode]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.EpisodeMembers,
    NotificationRuleUpdateKind.PublicNotes,
    NotificationRuleUpdateKind.PrivateNotes,
    NotificationRuleUpdateKind.Owners,
    NotificationRuleUpdateKind.Paging,
    NotificationRuleUpdateKind.Other,
  ],
  [NotificationRuleEventType.AlertEpisode]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.EpisodeMembers,
    NotificationRuleUpdateKind.PrivateNotes,
    NotificationRuleUpdateKind.Owners,
    NotificationRuleUpdateKind.Paging,
    NotificationRuleUpdateKind.Other,
  ],
  [NotificationRuleEventType.ScheduledMaintenance]: [
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.PublicNotes,
    NotificationRuleUpdateKind.PrivateNotes,
    NotificationRuleUpdateKind.Other,
  ],
};

/*
 * Key updates only: what a quiet channel wants to hear, beside the first
 * message - that the record is over (or is not, after all), how bad it is,
 * what its status page says and, for an incident, what was learned.
 */
const KEY_UPDATE_KINDS: Readonly<
  Partial<
    Record<NotificationRuleEventType, ReadonlyArray<NotificationRuleUpdateKind>>
  >
> = {
  [NotificationRuleEventType.Incident]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.SeverityChanges,
    NotificationRuleUpdateKind.PublicNotes,
    NotificationRuleUpdateKind.Postmortem,
  ],
  [NotificationRuleEventType.Alert]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.SeverityChanges,
  ],
  [NotificationRuleEventType.IncidentEpisode]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
    NotificationRuleUpdateKind.PublicNotes,
  ],
  [NotificationRuleEventType.AlertEpisode]: [
    NotificationRuleUpdateKind.ResolvedAndReopened,
  ],
  [NotificationRuleEventType.ScheduledMaintenance]: [
    NotificationRuleUpdateKind.StateChanges,
    NotificationRuleUpdateKind.PublicNotes,
  ],
};

// A rule's JSON, as far as the updates it posts go.
export type RuleWithUpdates = Partial<
  Pick<BaseNotificationRule, "updatesToPost">
>;

// A rule as stored: updatesToPost is JSON, so it is read with care.
export type StoredRuleUpdates = RuleWithUpdates | null | undefined;

// A rule of the project, with its id, as a record's channel names it.
export interface RuleOfChannel {
  id: string;
  rule: StoredRuleUpdates;
}

export default class NotificationRuleUpdates {
  public static isUpdateKind(
    value: unknown,
  ): value is NotificationRuleUpdateKind {
    return (
      typeof value === "string" &&
      (Object.values(NotificationRuleUpdateKind) as Array<string>).includes(
        value,
      )
    );
  }

  public static isAlwaysPosted(kind: NotificationRuleUpdateKind): boolean {
    return ALWAYS_POSTED_UPDATE_KINDS.includes(kind);
  }

  // The updates a kind of rule can choose, in order: none when it has no choice.
  public static getChoosableKinds(
    eventType: NotificationRuleEventType | undefined,
  ): Array<NotificationRuleUpdateKind> {
    return eventType ? [...(CHOOSABLE_UPDATE_KINDS[eventType] || [])] : [];
  }

  // Whether a kind of rule chooses which updates it posts.
  public static canChooseUpdates(
    eventType: NotificationRuleEventType | undefined,
  ): boolean {
    return this.getChoosableKinds(eventType).length > 0;
  }

  // Key updates only, in the order the Updates step lists them.
  public static getKeyKinds(
    eventType: NotificationRuleEventType | undefined,
  ): Array<NotificationRuleUpdateKind> {
    return eventType ? [...(KEY_UPDATE_KINDS[eventType] || [])] : [];
  }

  /*
   * The updates a rule chose, as stored: undefined when it chose none, which
   * is every update. A value that is not a kind - typed by hand into the
   * JSON, or a kind a later version took out - is left out.
   */
  public static getChosenKinds(
    rule: StoredRuleUpdates,
  ): Array<NotificationRuleUpdateKind> | undefined {
    const stored: unknown = rule?.updatesToPost;

    if (!Array.isArray(stored)) {
      return undefined;
    }

    const kinds: Array<NotificationRuleUpdateKind> = [];

    for (const value of stored) {
      if (this.isUpdateKind(value) && !kinds.includes(value)) {
        kinds.push(value);
      }
    }

    return kinds;
  }

  /*
   * What the rule picked on its Updates step. A list that is exactly Key
   * updates only reads as that choice, in whatever order it was stored.
   */
  public static getChoice(data: {
    rule: StoredRuleUpdates;
    eventType: NotificationRuleEventType | undefined;
  }): NotificationRuleUpdatesChoice {
    const chosen: Array<NotificationRuleUpdateKind> | undefined =
      this.getChosenKinds(data.rule);

    if (!chosen || !this.canChooseUpdates(data.eventType)) {
      return NotificationRuleUpdatesChoice.EveryUpdate;
    }

    if (this.isSameKinds(chosen, this.getKeyKinds(data.eventType))) {
      return NotificationRuleUpdatesChoice.KeyUpdates;
    }

    return NotificationRuleUpdatesChoice.ChosenUpdates;
  }

  /*
   * The updates the rule posts, of those its kind can choose, in their
   * order: every one when it chose none.
   */
  public static getPostedKinds(data: {
    rule: StoredRuleUpdates;
    eventType: NotificationRuleEventType | undefined;
  }): Array<NotificationRuleUpdateKind> {
    const choosable: Array<NotificationRuleUpdateKind> = this.getChoosableKinds(
      data.eventType,
    );
    const chosen: Array<NotificationRuleUpdateKind> | undefined =
      this.getChosenKinds(data.rule);

    if (!chosen) {
      return choosable;
    }

    return choosable.filter((kind: NotificationRuleUpdateKind): boolean => {
      return chosen.includes(kind);
    });
  }

  /*
   * The rule with `kinds` as the updates it posts, put in the order its
   * Updates step lists them. Every update - no list, or every kind its
   * Updates step lists - takes the list out, so the rule goes on posting
   * every update, the kinds a later version adds included.
   */
  public static withChosenKinds<T extends RuleWithUpdates>(data: {
    rule: T | undefined;
    eventType: NotificationRuleEventType | undefined;
    kinds: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): T {
    const rule: RuleWithUpdates = { ...(data.rule || {}) };

    const choosable: Array<NotificationRuleUpdateKind> = this.getChoosableKinds(
      data.eventType,
    );

    const kinds: Array<NotificationRuleUpdateKind> | undefined = data.kinds
      ? choosable.filter((kind: NotificationRuleUpdateKind): boolean => {
          return data.kinds!.includes(kind);
        })
      : undefined;

    if (!kinds || choosable.length === 0 || kinds.length === choosable.length) {
      delete rule.updatesToPost;
      return rule as T;
    }

    rule.updatesToPost = kinds;
    return rule as T;
  }

  // The rule as a choice on its Updates step sets it.
  public static withChoice<T extends RuleWithUpdates>(data: {
    rule: T | undefined;
    eventType: NotificationRuleEventType | undefined;
    choice: NotificationRuleUpdatesChoice;
    // For Choose updates: the boxes ticked.
    kinds?: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): T {
    if (data.choice === NotificationRuleUpdatesChoice.EveryUpdate) {
      return this.withChosenKinds({
        rule: data.rule,
        eventType: data.eventType,
        kinds: undefined,
      });
    }

    if (data.choice === NotificationRuleUpdatesChoice.KeyUpdates) {
      return this.withChosenKinds({
        rule: data.rule,
        eventType: data.eventType,
        kinds: this.getKeyKinds(data.eventType),
      });
    }

    return this.withChosenKinds({
      rule: data.rule,
      eventType: data.eventType,
      kinds: data.kinds || [],
    });
  }

  /*
   * Whether a message of these kinds goes wherever the record's messages
   * go, whatever the rules chose: one that says nothing of its kind - a
   * monitor's, an on-call policy's - or one every rule posts.
   */
  public static isPostedEverywhere(
    updateKinds: ReadonlyArray<NotificationRuleUpdateKind> | undefined,
  ): boolean {
    return (
      !updateKinds ||
      updateKinds.length === 0 ||
      updateKinds.some((kind: NotificationRuleUpdateKind): boolean => {
        return this.isAlwaysPosted(kind);
      })
    );
  }

  /*
   * Whether a rule posts a message of these kinds: one posted everywhere
   * (isPostedEverywhere), or one of the updates it chose - every one when
   * it chose none.
   */
  public static wantsUpdate(data: {
    rule: StoredRuleUpdates;
    updateKinds: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): boolean {
    if (!data.updateKinds || this.isPostedEverywhere(data.updateKinds)) {
      return true;
    }

    const chosen: Array<NotificationRuleUpdateKind> | undefined =
      this.getChosenKinds(data.rule);

    if (!chosen) {
      return true;
    }

    return data.updateKinds.some(
      (kind: NotificationRuleUpdateKind): boolean => {
        return chosen.includes(kind);
      },
    );
  }

  /*
   * Whether a message of these kinds is posted in a channel OneUptime
   * created for a record: when one of the rules that asked for the channel
   * wants it. A channel stored before its rules were recorded, or whose
   * every rule was deleted since, has no rule left to ask, and gets every
   * update, as it always did.
   */
  public static isWantedInChannel(data: {
    channel: Partial<
      Pick<
        NotificationRuleWorkspaceChannel,
        "notificationRuleId" | "notificationRuleIds"
      >
    >;
    // The project's rules of the channel's kind of record and workspace.
    rules: ReadonlyArray<RuleOfChannel>;
    updateKinds: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
  }): boolean {
    const rulesOfChannel: Array<RuleOfChannel> = data.rules.filter(
      (rule: RuleOfChannel): boolean => {
        return NotificationRuleWorkspaceChannelUtil.isChannelOfRule({
          channel: data.channel,
          notificationRuleId: rule.id,
        });
      },
    );

    if (rulesOfChannel.length === 0) {
      return true;
    }

    return rulesOfChannel.some((rule: RuleOfChannel): boolean => {
      return this.wantsUpdate({
        rule: rule.rule,
        updateKinds: data.updateKinds,
      });
    });
  }

  /*
   * Which update a move between states is: resolving the record, or
   * reopening it, is Resolved and reopened; any other - acknowledged,
   * investigating, or on from one resolved state to another ("Resolved" to
   * "Closed") - is another state change.
   */
  public static getStateChangeKind(data: {
    isResolved: boolean;
    wasResolved: boolean;
  }): NotificationRuleUpdateKind {
    return data.isResolved !== data.wasResolved
      ? NotificationRuleUpdateKind.ResolvedAndReopened
      : NotificationRuleUpdateKind.StateChanges;
  }

  /*
   * What is wrong with the updates a rule is saved with, through the API or
   * the Dashboard, or null when nothing is: a list of the kinds its kind of
   * rule can choose, or nothing at all.
   */
  public static getValidationError(data: {
    eventType: NotificationRuleEventType | undefined;
    updatesToPost: unknown;
  }): string | null {
    if (data.updatesToPost === undefined || data.updatesToPost === null) {
      return null;
    }

    const choosable: Array<NotificationRuleUpdateKind> = this.getChoosableKinds(
      data.eventType,
    );

    if (choosable.length === 0) {
      return `${data.eventType || "These"} rules post every update: leave updatesToPost out.`;
    }

    if (!Array.isArray(data.updatesToPost)) {
      return `updatesToPost is a list of the updates the rule posts, any of: ${choosable.join(", ")}. Leave it out to post every update.`;
    }

    for (const value of data.updatesToPost as Array<unknown>) {
      if (
        !this.isUpdateKind(value) ||
        !choosable.includes(value as NotificationRuleUpdateKind)
      ) {
        // A value typed by hand can be anything: only its start is repeated.
        const shown: string = String(JSON.stringify(value)).substring(0, 80);

        return `updatesToPost lists ${shown}, which ${data.eventType} rules cannot choose. They choose any of: ${choosable.join(", ")}.`;
      }
    }

    return null;
  }

  private static isSameKinds(
    first: ReadonlyArray<NotificationRuleUpdateKind>,
    second: ReadonlyArray<NotificationRuleUpdateKind>,
  ): boolean {
    return (
      first.length === second.length &&
      first.every((kind: NotificationRuleUpdateKind): boolean => {
        return second.includes(kind);
      })
    );
  }
}
