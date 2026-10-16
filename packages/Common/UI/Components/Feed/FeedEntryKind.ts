import {
  Amber500,
  Blue500,
  Gray500,
  Green500,
  Indigo500,
  Red500,
  Violet500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
// Type only: the tables stay importable where i18next is not installed.
import type { PluralTemplate } from "../../Utils/TranslateTemplate";

/*
 * What kind of thing a feed entry is, and how every feed draws that kind: one
 * icon, one colour, and whether entries of the kind fold together when they
 * arrive in a burst.
 *
 * Every activity feed - incidents, alerts, episodes, scheduled maintenance,
 * monitors, on-call policies, and the infrastructure, catalog and SLO feeds -
 * builds its table of event types from the kinds below, so a note, an owner
 * added or an on-call page looks the same wherever it appears.
 *
 * React-free so the tables can be pinned in plain tests.
 */
export enum FeedTone {
  // Bookkeeping: edits, rules that ran, links between records.
  Neutral = "Neutral",
  // People talking: notes, root causes, calls.
  Info = "Info",
  // Things getting better: restored, acknowledged.
  Success = "Success",
  // Things to watch: severity changes, overrides, automatic remediation.
  Warning = "Warning",
  // Things going wrong: an incident declared, a call that failed to start.
  Danger = "Danger",
  // Who is involved: owners and members added or removed.
  People = "People",
  // What OneUptime AI did.
  AI = "AI",
  /*
   * The entry's own colour, which the server chose for what it records: a
   * state change in the new state's colour, an on-call page in its
   * outcome's (sent, acknowledged, skipped, failed).
   */
  Record = "Record",
}

const TONE_COLORS: Record<Exclude<FeedTone, FeedTone.Record>, Color> = {
  [FeedTone.Neutral]: Gray500,
  [FeedTone.Info]: Blue500,
  [FeedTone.Success]: Green500,
  [FeedTone.Warning]: Amber500,
  [FeedTone.Danger]: Red500,
  [FeedTone.People]: Violet500,
  [FeedTone.AI]: Indigo500,
};

/*
 * Kinds of entry that the server writes in bursts - one per person paged,
 * one per rule that ran - and that the feed folds into the first of them,
 * so a busy minute reads as one moment rather than a screenful.
 */
export enum FeedBurstKind {
  OnCall = "OnCall",
  OwnerNotification = "OwnerNotification",
  SubscriberNotification = "SubscriberNotification",
  Rule = "Rule",
}

/*
 * The button under a folded burst. Translated whole, the count in the
 * reader's grammar (see Locales/README.md).
 */
export const FEED_BURST_LABELS: Record<FeedBurstKind, PluralTemplate> = {
  [FeedBurstKind.OnCall]: {
    one: "Show {{count}} more on-call update",
    other: "Show {{count}} more on-call updates",
  },
  [FeedBurstKind.OwnerNotification]: {
    one: "Show {{count}} more owner notification",
    other: "Show {{count}} more owner notifications",
  },
  [FeedBurstKind.SubscriberNotification]: {
    one: "Show {{count}} more subscriber notification",
    other: "Show {{count}} more subscriber notifications",
  },
  [FeedBurstKind.Rule]: {
    one: "Show {{count}} more rule that ran",
    other: "Show {{count}} more rules that ran",
  },
};

// A burst that was unfolded folds back with this.
export const FEED_BURST_COLLAPSE_LABEL: string = "Show fewer";

export interface FeedEntryKind {
  icon: IconProp;
  tone: FeedTone;
  burst?: FeedBurstKind | undefined;
  /*
   * The words of the toggle that unfolds the entry's details, where "Show
   * details" is not the most telling - "Show who was notified". A key the
   * Dashboard's locale files translate.
   */
  moreText?: string | undefined;
  /*
   * The entry carries what somebody wrote - a note, a root cause, a
   * postmortem: its body is set apart in a card, as the Notes page draws a
   * note, so what people said stands out from what happened around it.
   */
  isNote?: boolean | undefined;
}

/*
 * The kinds every feed shares, by the event type name the feed models give
 * them. A feed's own table spreads the ones it records, so the compiler still
 * checks that each of its event types has a kind.
 */
export const SHARED_FEED_ENTRY_KINDS: {
  PublicNote: FeedEntryKind;
  PrivateNote: FeedEntryKind;
  RootCause: FeedEntryKind;
  AIRootCause: FeedEntryKind;
  RemediationNotes: FeedEntryKind;
  PostmortemNote: FeedEntryKind;
  OwnerUserAdded: FeedEntryKind;
  OwnerTeamAdded: FeedEntryKind;
  OwnerUserRemoved: FeedEntryKind;
  OwnerTeamRemoved: FeedEntryKind;
  OwnerNotificationSent: FeedEntryKind;
  SubscriberNotificationSent: FeedEntryKind;
  OnCallPolicy: FeedEntryKind;
  OnCallNotification: FeedEntryKind;
  LabelRuleExecuted: FeedEntryKind;
  OwnerRuleExecuted: FeedEntryKind;
  PrivacyRuleExecuted: FeedEntryKind;
  OnCallRuleExecuted: FeedEntryKind;
  AutoRemediation: FeedEntryKind;
  VideoCallStarted: FeedEntryKind;
  VideoCallFailed: FeedEntryKind;
  ChannelMemberAdded: FeedEntryKind;
  StateChanged: FeedEntryKind;
  SeverityChanged: FeedEntryKind;
  Updated: FeedEntryKind;
  Created: FeedEntryKind;
  Archived: FeedEntryKind;
  Restored: FeedEntryKind;
  Linked: FeedEntryKind;
  Unlinked: FeedEntryKind;
  MemberAdded: FeedEntryKind;
  MemberRemoved: FeedEntryKind;
  RoleAssigned: FeedEntryKind;
  RoleUnassigned: FeedEntryKind;
  Other: FeedEntryKind;
} = {
  PublicNote: {
    icon: IconProp.Announcement,
    tone: FeedTone.Info,
    isNote: true,
  },
  PrivateNote: { icon: IconProp.Lock, tone: FeedTone.Info, isNote: true },
  RootCause: { icon: IconProp.LightBulb, tone: FeedTone.Info, isNote: true },
  // A root cause an AI investigation wrote.
  AIRootCause: { icon: IconProp.Sparkles, tone: FeedTone.AI, isNote: true },
  RemediationNotes: {
    icon: IconProp.Wrench,
    tone: FeedTone.Info,
    isNote: true,
  },
  PostmortemNote: { icon: IconProp.Book, tone: FeedTone.Info, isNote: true },
  OwnerUserAdded: { icon: IconProp.UserPlus, tone: FeedTone.People },
  OwnerTeamAdded: { icon: IconProp.UserGroup, tone: FeedTone.People },
  OwnerUserRemoved: { icon: IconProp.UserMinus, tone: FeedTone.People },
  OwnerTeamRemoved: { icon: IconProp.UserMinus, tone: FeedTone.People },
  OwnerNotificationSent: {
    icon: IconProp.Bell,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.OwnerNotification,
    moreText: "Show who was notified",
  },
  SubscriberNotificationSent: {
    icon: IconProp.Notification,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.SubscriberNotification,
  },
  OnCallPolicy: {
    icon: IconProp.PhoneArrowUpRight,
    tone: FeedTone.Record,
    burst: FeedBurstKind.OnCall,
  },
  OnCallNotification: {
    icon: IconProp.PhoneArrowUpRight,
    tone: FeedTone.Record,
    burst: FeedBurstKind.OnCall,
  },
  LabelRuleExecuted: {
    icon: IconProp.Tag,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.Rule,
  },
  OwnerRuleExecuted: {
    icon: IconProp.UserGroup,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.Rule,
  },
  PrivacyRuleExecuted: {
    icon: IconProp.EyeSlash,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.Rule,
  },
  OnCallRuleExecuted: {
    icon: IconProp.Call,
    tone: FeedTone.Neutral,
    burst: FeedBurstKind.Rule,
  },
  AutoRemediation: { icon: IconProp.Bolt, tone: FeedTone.Warning },
  VideoCallStarted: { icon: IconProp.VideoCamera, tone: FeedTone.Info },
  VideoCallFailed: { icon: IconProp.VideoCameraSlash, tone: FeedTone.Danger },
  // Somebody added to the record's own Slack channel from its page.
  ChannelMemberAdded: {
    icon: IconProp.ChatBubbleLeftRight,
    tone: FeedTone.People,
  },
  StateChanged: { icon: IconProp.ArrowCircleRight, tone: FeedTone.Record },
  SeverityChanged: {
    icon: IconProp.ExclaimationCircle,
    tone: FeedTone.Warning,
  },
  Updated: { icon: IconProp.PencilSquare, tone: FeedTone.Neutral },
  Created: { icon: IconProp.Add, tone: FeedTone.Info },
  Archived: { icon: IconProp.Archive, tone: FeedTone.Neutral },
  Restored: { icon: IconProp.Unarchive, tone: FeedTone.Success },
  Linked: { icon: IconProp.Link, tone: FeedTone.Neutral },
  Unlinked: { icon: IconProp.LinkSlash, tone: FeedTone.Neutral },
  // A record that joined or left a group: an incident added to an episode.
  MemberAdded: { icon: IconProp.Layers, tone: FeedTone.Neutral },
  MemberRemoved: { icon: IconProp.Layers, tone: FeedTone.Neutral },
  // Someone given or relieved of a role on the record: Incident Commander.
  RoleAssigned: { icon: IconProp.Identification, tone: FeedTone.People },
  RoleUnassigned: { icon: IconProp.Identification, tone: FeedTone.People },
  // An event type this build does not know (a newer server wrote it).
  Other: { icon: IconProp.Circle, tone: FeedTone.Neutral },
};

/*
 * The colour an entry is drawn in: its kind's, or for a kind that takes the
 * entry's own colour, that colour - falling back to grey for an old row
 * that has none.
 */
export const getFeedEntryColor: (data: {
  kind: FeedEntryKind;
  rowColor?: Color | undefined;
}) => Color = (data: {
  kind: FeedEntryKind;
  rowColor?: Color | undefined;
}): Color => {
  if (data.kind.tone === FeedTone.Record) {
    return data.rowColor || Gray500;
  }

  return TONE_COLORS[data.kind.tone];
};

/*
 * The kind for one event type from a feed's table, or Other for a type this
 * build does not know. A Map lookup on the plain string, so a type that
 * happens to share a name with an Object.prototype member cannot come back
 * as a function.
 */
export const getFeedEntryKind: <TEventType extends string>(data: {
  kinds: Record<TEventType, FeedEntryKind>;
  eventType: string | undefined;
}) => FeedEntryKind = <TEventType extends string>(data: {
  kinds: Record<TEventType, FeedEntryKind>;
  eventType: string | undefined;
}): FeedEntryKind => {
  if (!data.eventType) {
    return SHARED_FEED_ENTRY_KINDS.Other;
  }

  if (!Object.prototype.hasOwnProperty.call(data.kinds, data.eventType)) {
    return SHARED_FEED_ENTRY_KINDS.Other;
  }

  return (
    (data.kinds as Record<string, FeedEntryKind>)[data.eventType] ||
    SHARED_FEED_ENTRY_KINDS.Other
  );
};

// A feed's icon table, from its kinds: what the event type filter lists.
export const getFeedIcons: <TEventType extends string>(
  kinds: Record<TEventType, FeedEntryKind>,
) => Record<TEventType, IconProp> = <TEventType extends string>(
  kinds: Record<TEventType, FeedEntryKind>,
): Record<TEventType, IconProp> => {
  const icons: Partial<Record<TEventType, IconProp>> = {};

  for (const eventType of Object.keys(kinds) as Array<TEventType>) {
    icons[eventType] = kinds[eventType].icon;
  }

  return icons as Record<TEventType, IconProp>;
};
