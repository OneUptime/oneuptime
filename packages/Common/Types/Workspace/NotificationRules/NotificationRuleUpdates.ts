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
 * An on-call policy rule chooses too (issue #7549), from updates of its
 * own: who is on call now, who is next, nobody on call, overrides, changes
 * to the policy and its owners. A handoff is one message - "📞 @Ana is now
 * on call for Payments until Fri at 5:50 PM" - that names who is next only
 * where a rule asks for it (OnCallHandoffPosts). A NEW on-call rule starts
 * with the key updates ticked (getNewRuleUpdatesToPost): who is on call
 * now, and when nobody is - however it is made (issue #7971). The
 * Dashboard's form starts there, and the server gives the same list to a
 * rule the API, Terraform or a workflow creates without one
 * (withNewRuleUpdates). An edit that leaves the list out keeps the rule's
 * (withKeptUpdates): Terraform writes a rule's JSON as its configuration
 * has it, so a rule made quiet would turn noisy at its first change.
 * Every update is asked for with null there, which the Dashboard's Every
 * update sends for such a rule (withChosenKinds).
 *
 * So does a security case rule (issue #7936), from the four notices a case
 * posts (SecurityCaseNotifications): a case that opens at, or rises to, a
 * higher priority, an assignment, a playbook step waiting for approval and
 * a response target about to be missed, or missed. A case has no first
 * message: a rule may leave every notice out.
 *
 * Custom field edits (issue #7937) and the reminders that a record is still
 * open (issue #7938) are boxes of their own, out of Other edits and
 * Everything else. A rule saved before them, with Other edits or
 * Everything else ticked, had the new box ticked by the upgrade
 * (AddCustomFieldsAndRemindersToUpdatesToPost), so it posts what it did.
 *
 * Monitor, security hunt and SLO rules post every update; they have no
 * choice (getChoosableKinds is empty for them).
 *
 * A hand-off's line names the person on call as text that pings nobody,
 * so a channel that hears every hand-off is not pinged by each one. An
 * on-call rule that posts who is on call now can ask to mention them
 * instead (issue #7968): "📞 @ana.lee is now on call ...", a real mention
 * that notifies them, where they connected their account in the
 * workspace (BaseNotificationRule.shouldMentionWhoIsOnCall,
 * isMentioningWhoIsOnCall). It is off unless a rule turns it on. Who is
 * next is never mentioned, so a hand-off notifies one person.
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
  // The title, description, labels, monitors and other fields.
  Edits = "Edits",
  /*
   * Custom field values set, changed or cleared (issue #7937): its record's
   * update hook names it, beside Edits when other fields changed with them.
   */
  CustomFields = "CustomFields",
  /*
   * The reminders that the record is still open, which its reminder rules
   * send its owners (issue #7938): the reminder jobs name it.
   */
  Reminders = "Reminders",
  // Everything else: linked records, delivery problems.
  Other = "Other",

  /*
   * An on-call policy's updates (issue #7549). Each of its feed entries is
   * one of these, or Owners (FeedUpdateKinds).
   */
  // A handoff: who is on call now in one of the policy's schedules, until when.
  OnCallNow = "OnCallNow",
  // Who takes over at the next handoff.
  OnCallNext = "OnCallNext",
  // A schedule with nobody on call: alerts that reach it page no one.
  NobodyOnCall = "NobodyOnCall",
  // Somebody covering for somebody else, and covers taken back.
  Overrides = "Overrides",
  /*
   * Schedules, people and teams added to or removed from the policy's
   * escalation rules.
   */
  PolicyChanges = "PolicyChanges",

  /*
   * A security case's notices (issue #7936), each posted with its kind
   * (SecurityCaseNotifications.postToChannels).
   */
  // A case opens at a priority, or rises to a higher one.
  PriorityReached = "PriorityReached",
  // A case is assigned to a person or a team.
  Assigned = "Assigned",
  // A playbook step waits for someone to approve it.
  ApprovalRequested = "ApprovalRequested",
  // A case is about to miss a response target, or misses it.
  ResponseTargets = "ResponseTargets",
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
 * scheduled maintenance event's owners are not posted, an episode has no
 * reminders.
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
    NotificationRuleUpdateKind.CustomFields,
    NotificationRuleUpdateKind.Reminders,
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
    NotificationRuleUpdateKind.CustomFields,
    NotificationRuleUpdateKind.Reminders,
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
    NotificationRuleUpdateKind.Reminders,
    NotificationRuleUpdateKind.Other,
  ],
  // Everything an on-call policy's feed posts: nothing is Everything else.
  [NotificationRuleEventType.OnCallDutyPolicy]: [
    NotificationRuleUpdateKind.OnCallNow,
    NotificationRuleUpdateKind.OnCallNext,
    NotificationRuleUpdateKind.NobodyOnCall,
    NotificationRuleUpdateKind.Overrides,
    NotificationRuleUpdateKind.PolicyChanges,
    NotificationRuleUpdateKind.Owners,
  ],
  /*
   * Every notice a security case posts (issue #7936): nothing else - and
   * OneUptime AI handing a case it worked to people (#10352), as AI.
   */
  [NotificationRuleEventType.SecurityCase]: [
    NotificationRuleUpdateKind.PriorityReached,
    NotificationRuleUpdateKind.Assigned,
    NotificationRuleUpdateKind.ApprovalRequested,
    NotificationRuleUpdateKind.ResponseTargets,
    NotificationRuleUpdateKind.AI,
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
  /*
   * Who is on call: each handoff, and a schedule left with nobody on call -
   * the two things an on-call channel is for (issue #7549).
   */
  [NotificationRuleEventType.OnCallDutyPolicy]: [
    NotificationRuleUpdateKind.OnCallNow,
    NotificationRuleUpdateKind.NobodyOnCall,
  ],
  /*
   * What a security channel has to act on (issue #7936): a case at a
   * priority it is for, a step nobody can run until it is approved, and a
   * response target about to be missed. Who a case is assigned to is left
   * out. A case OneUptime AI hands to people needs one of them now (#10352).
   */
  [NotificationRuleEventType.SecurityCase]: [
    NotificationRuleUpdateKind.PriorityReached,
    NotificationRuleUpdateKind.ApprovalRequested,
    NotificationRuleUpdateKind.ResponseTargets,
    NotificationRuleUpdateKind.AI,
  ],
};

/*
 * What a NEW rule of a kind starts with, when that is not every update. An
 * on-call channel used to hear of every handoff three times over, and of
 * every schedule, person and team added to the policy (issue #7549): a new
 * on-call rule starts on the key updates instead - who is on call now, and
 * when nobody is - and its Updates step offers the rest. Rules saved
 * before keep posting every update. A rule made through the API or with
 * Terraform starts on the key updates too when it leaves updatesToPost out
 * (issue #7971); one that sends null posts every update.
 */
const NEW_RULE_UPDATE_KINDS: Readonly<
  Partial<
    Record<NotificationRuleEventType, ReadonlyArray<NotificationRuleUpdateKind>>
  >
> = {
  [NotificationRuleEventType.OnCallDutyPolicy]: [
    NotificationRuleUpdateKind.OnCallNow,
    NotificationRuleUpdateKind.NobodyOnCall,
  ],
};

// A rule's JSON, as far as the updates it posts go.
export type RuleWithUpdates = Partial<
  Pick<BaseNotificationRule, "updatesToPost" | "shouldMentionWhoIsOnCall">
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

  /*
   * The updates a new rule of this kind starts with, or undefined when it
   * starts posting every update (NEW_RULE_UPDATE_KINDS).
   */
  public static getNewRuleUpdatesToPost(
    eventType: NotificationRuleEventType | undefined,
  ): Array<NotificationRuleUpdateKind> | undefined {
    const kinds: ReadonlyArray<NotificationRuleUpdateKind> | undefined =
      eventType ? NEW_RULE_UPDATE_KINDS[eventType] : undefined;

    return kinds ? [...kinds] : undefined;
  }

  /*
   * A new rule's JSON, as far as its updates go: the updates its kind
   * starts with, or nothing - every update.
   */
  public static getNewRuleUpdates(
    eventType: NotificationRuleEventType | undefined,
  ): RuleWithUpdates {
    const kinds: Array<NotificationRuleUpdateKind> | undefined =
      this.getNewRuleUpdatesToPost(eventType);

    return kinds ? { updatesToPost: kinds } : {};
  }

  /*
   * Whether a new rule of this kind starts on chosen updates rather than on
   * every update (NEW_RULE_UPDATE_KINDS): an on-call policy's. Such a rule
   * gets its kind's list when its JSON leaves updatesToPost out, and keeps
   * its own on an edit that leaves it out (#7971).
   */
  public static hasNewRuleUpdates(
    eventType: NotificationRuleEventType | undefined,
  ): boolean {
    return this.getNewRuleUpdatesToPost(eventType) !== undefined;
  }

  /*
   * Whether a rule's JSON says which updates it posts: a list, or null for
   * every update. A JSON that leaves updatesToPost out says nothing of them.
   * Anything but an object - no JSON at all - says nothing either.
   */
  public static saysUpdatesToPost(rule: unknown): boolean {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      return false;
    }

    return (rule as Record<string, unknown>)["updatesToPost"] !== undefined;
  }

  /*
   * A new rule's JSON as the server stores it (#7971): a rule of a kind that
   * starts on chosen updates, whose JSON says none, gets its kind's list -
   * an on-call policy rule made through the API, with Terraform or by a
   * workflow starts on the key updates, as one made in the Dashboard does.
   * A list the caller sent is kept, and so is null: every update, asked for.
   */
  public static withNewRuleUpdates<T>(data: {
    rule: T;
    eventType: NotificationRuleEventType | undefined;
  }): T {
    const kinds: Array<NotificationRuleUpdateKind> | undefined =
      this.getNewRuleUpdatesToPost(data.eventType);

    if (
      !kinds ||
      !data.rule ||
      typeof data.rule !== "object" ||
      Array.isArray(data.rule) ||
      this.saysUpdatesToPost(data.rule)
    ) {
      return data.rule;
    }

    return { ...data.rule, updatesToPost: kinds };
  }

  /*
   * What an edit leaves out keeps (#7971). A rule of a kind that starts on
   * chosen updates goes on posting what it posts when the JSON an edit
   * writes leaves updatesToPost out: Terraform writes a rule's JSON as its
   * configuration has it, so an on-call rule that started on the key
   * updates would turn to every update at its first change. `stored` is
   * the rule's JSON as it is now; its updates are kept as they are, a list,
   * null or none at all - a rule saved before rules chose updates goes on
   * posting every update.
   *
   * A rule whose edit makes it another kind of rule is a new rule of that
   * kind: it gets the kind's list (withNewRuleUpdates). Any other kind of
   * rule, and a JSON that says which updates to post, is written as it is
   * sent.
   */
  public static withKeptUpdates<T>(data: {
    written: T;
    // The kind of rule the edit leaves it: the kind it sends, or the rule's own.
    eventType: NotificationRuleEventType | undefined;
    // The rule as it is stored now, and its kind.
    stored: StoredRuleUpdates;
    storedEventType: NotificationRuleEventType | undefined;
  }): T {
    if (
      !this.hasNewRuleUpdates(data.eventType) ||
      !data.written ||
      typeof data.written !== "object" ||
      Array.isArray(data.written) ||
      this.saysUpdatesToPost(data.written)
    ) {
      return data.written;
    }

    if (data.storedEventType !== data.eventType) {
      return this.withNewRuleUpdates({
        rule: data.written,
        eventType: data.eventType,
      });
    }

    const kept: unknown = data.stored?.updatesToPost;

    if (kept === undefined) {
      return data.written;
    }

    return {
      ...data.written,
      updatesToPost: Array.isArray(kept) ? [...kept] : kept,
    };
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
   *
   * A rule of a kind that starts on chosen updates (an on-call policy's)
   * says every update with null instead: left out, the server would give a
   * new rule its kind's list, and keep an edited rule's (#7971).
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
      if (this.hasNewRuleUpdates(data.eventType)) {
        rule.updatesToPost = null;
      } else {
        delete rule.updatesToPost;
      }

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
   * monitor's - or one every rule posts.
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
    /*
     * Only where a rule that wants the message also passes this: one that
     * asks to mention who is on call (isMentioningWhoIsOnCall). A channel
     * whose rules are not known has no rule to pass it.
     */
    onlyWhereRule?: ((rule: StoredRuleUpdates) => boolean) | undefined;
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
      return !data.onlyWhereRule;
    }

    return rulesOfChannel.some((rule: RuleOfChannel): boolean => {
      return (
        this.wantsUpdate({
          rule: rule.rule,
          updateKinds: data.updateKinds,
        }) &&
        (!data.onlyWhereRule || data.onlyWhereRule(rule.rule))
      );
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
      /*
       * Left out, a new rule of a kind that starts on chosen updates gets
       * them (#7971): null is every update there.
       */
      const everyUpdate: string = this.hasNewRuleUpdates(data.eventType)
        ? "Send null to post every update."
        : "Leave it out to post every update.";

      return `updatesToPost is a list of the updates the rule posts, any of: ${choosable.join(", ")}. ${everyUpdate}`;
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

  /*
   * Whether a kind of rule can mention the person who comes on call: an
   * on-call policy's (issue #7968).
   */
  public static canMentionWhoIsOnCall(
    eventType: NotificationRuleEventType | undefined,
  ): boolean {
    return eventType === NotificationRuleEventType.OnCallDutyPolicy;
  }

  /*
   * Whether a rule mentions the person who comes on call in its hand-off
   * lines: only when it says so, and only while it posts who is on call
   * now - every update, or a list with it. Anything but true is off: a rule
   * saved before, or a value typed by hand into its JSON.
   */
  public static isMentioningWhoIsOnCall(rule: StoredRuleUpdates): boolean {
    if (rule?.shouldMentionWhoIsOnCall !== true) {
      return false;
    }

    return this.wantsUpdate({
      rule: rule,
      updateKinds: [NotificationRuleUpdateKind.OnCallNow],
    });
  }

  // The rule as the Updates step's mention switch sets it: off, it is left out.
  public static withMentionOfWhoIsOnCall<T extends RuleWithUpdates>(data: {
    rule: T | undefined;
    isOn: boolean;
  }): T {
    const rule: RuleWithUpdates = { ...(data.rule || {}) };

    if (data.isOn) {
      rule.shouldMentionWhoIsOnCall = true;
    } else {
      delete rule.shouldMentionWhoIsOnCall;
    }

    return rule as T;
  }

  /*
   * What is wrong with whether a rule is saved to mention the person who
   * comes on call, or null when nothing is: true or false, and true only
   * on an on-call policy's rule.
   */
  public static getMentionValidationError(data: {
    eventType: NotificationRuleEventType | undefined;
    shouldMentionWhoIsOnCall: unknown;
  }): string | null {
    const value: unknown = data.shouldMentionWhoIsOnCall;

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "boolean") {
      return "shouldMentionWhoIsOnCall is true or false: whether a hand-off's line mentions the person who comes on call.";
    }

    if (value && !this.canMentionWhoIsOnCall(data.eventType)) {
      return `${data.eventType || "These"} rules do not mention who is on call: leave shouldMentionWhoIsOnCall out. On-call policy rules can.`;
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
