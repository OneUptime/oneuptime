import IconProp from "Common/Types/Icon/IconProp";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import {
  FeedEntryKind,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryKind,
  getFeedIcons,
} from "Common/UI/Components/Feed/FeedEntryKind";

/*
 * What each episode feed event type is (FeedEntryKind): its icon and colour,
 * and whether a burst of it folds together. These are Records rather than
 * if-chains so that adding an event type to either enum fails the build until
 * it gets a kind, instead of silently falling back to a plain circle in the
 * feed.
 */
export const INCIDENT_EPISODE_FEED_KINDS: Record<
  IncidentEpisodeFeedEventType,
  FeedEntryKind
> = {
  [IncidentEpisodeFeedEventType.EpisodeCreated]: {
    ...SHARED_FEED_ENTRY_KINDS.Created,
    icon: IconProp.Layers,
  },
  [IncidentEpisodeFeedEventType.EpisodeStateChanged]:
    SHARED_FEED_ENTRY_KINDS.StateChanged,
  [IncidentEpisodeFeedEventType.EpisodeUpdated]:
    SHARED_FEED_ENTRY_KINDS.Updated,
  // A member shows its own icon, the one its own feed opens with.
  [IncidentEpisodeFeedEventType.IncidentAdded]: {
    ...SHARED_FEED_ENTRY_KINDS.MemberAdded,
    icon: IconProp.Flag,
  },
  [IncidentEpisodeFeedEventType.IncidentRemoved]: {
    ...SHARED_FEED_ENTRY_KINDS.MemberRemoved,
    icon: IconProp.Flag,
  },
  [IncidentEpisodeFeedEventType.OwnerUserAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [IncidentEpisodeFeedEventType.OwnerTeamAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [IncidentEpisodeFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [IncidentEpisodeFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [IncidentEpisodeFeedEventType.OwnerNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
  [IncidentEpisodeFeedEventType.PrivateNote]:
    SHARED_FEED_ENTRY_KINDS.PrivateNote,
  [IncidentEpisodeFeedEventType.PublicNote]: SHARED_FEED_ENTRY_KINDS.PublicNote,
  [IncidentEpisodeFeedEventType.RootCause]: SHARED_FEED_ENTRY_KINDS.RootCause,
  [IncidentEpisodeFeedEventType.RemediationNotes]:
    SHARED_FEED_ENTRY_KINDS.RemediationNotes,
  [IncidentEpisodeFeedEventType.PostmortemNote]:
    SHARED_FEED_ENTRY_KINDS.PostmortemNote,
  [IncidentEpisodeFeedEventType.OnCallPolicy]:
    SHARED_FEED_ENTRY_KINDS.OnCallPolicy,
  [IncidentEpisodeFeedEventType.OnCallNotification]:
    SHARED_FEED_ENTRY_KINDS.OnCallNotification,
  [IncidentEpisodeFeedEventType.SeverityChanged]:
    SHARED_FEED_ENTRY_KINDS.SeverityChanged,
  [IncidentEpisodeFeedEventType.SubscriberNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.SubscriberNotificationSent,
  [IncidentEpisodeFeedEventType.LabelRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
  [IncidentEpisodeFeedEventType.OwnerRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
  [IncidentEpisodeFeedEventType.PrivacyRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.PrivacyRuleExecuted,
  [IncidentEpisodeFeedEventType.OnCallRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OnCallRuleExecuted,
  [IncidentEpisodeFeedEventType.ChannelMemberAdded]:
    SHARED_FEED_ENTRY_KINDS.ChannelMemberAdded,
};

export const ALERT_EPISODE_FEED_KINDS: Record<
  AlertEpisodeFeedEventType,
  FeedEntryKind
> = {
  [AlertEpisodeFeedEventType.EpisodeCreated]: {
    ...SHARED_FEED_ENTRY_KINDS.Created,
    icon: IconProp.Layers,
  },
  [AlertEpisodeFeedEventType.EpisodeStateChanged]:
    SHARED_FEED_ENTRY_KINDS.StateChanged,
  [AlertEpisodeFeedEventType.EpisodeUpdated]: SHARED_FEED_ENTRY_KINDS.Updated,
  [AlertEpisodeFeedEventType.AlertAdded]: {
    ...SHARED_FEED_ENTRY_KINDS.MemberAdded,
    icon: IconProp.BellAlert,
  },
  [AlertEpisodeFeedEventType.AlertRemoved]: {
    ...SHARED_FEED_ENTRY_KINDS.MemberRemoved,
    icon: IconProp.BellAlert,
  },
  [AlertEpisodeFeedEventType.OwnerUserAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserAdded,
  [AlertEpisodeFeedEventType.OwnerTeamAdded]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded,
  [AlertEpisodeFeedEventType.OwnerUserRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved,
  [AlertEpisodeFeedEventType.OwnerTeamRemoved]:
    SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved,
  [AlertEpisodeFeedEventType.OwnerNotificationSent]:
    SHARED_FEED_ENTRY_KINDS.OwnerNotificationSent,
  [AlertEpisodeFeedEventType.PrivateNote]: SHARED_FEED_ENTRY_KINDS.PrivateNote,
  [AlertEpisodeFeedEventType.RootCause]: SHARED_FEED_ENTRY_KINDS.RootCause,
  [AlertEpisodeFeedEventType.OnCallPolicy]:
    SHARED_FEED_ENTRY_KINDS.OnCallPolicy,
  [AlertEpisodeFeedEventType.OnCallNotification]:
    SHARED_FEED_ENTRY_KINDS.OnCallNotification,
  [AlertEpisodeFeedEventType.SeverityChanged]:
    SHARED_FEED_ENTRY_KINDS.SeverityChanged,
  [AlertEpisodeFeedEventType.LabelRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted,
  [AlertEpisodeFeedEventType.OwnerRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted,
  [AlertEpisodeFeedEventType.PrivacyRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.PrivacyRuleExecuted,
  [AlertEpisodeFeedEventType.OnCallRuleExecuted]:
    SHARED_FEED_ENTRY_KINDS.OnCallRuleExecuted,
  [AlertEpisodeFeedEventType.ChannelMemberAdded]:
    SHARED_FEED_ENTRY_KINDS.ChannelMemberAdded,
};

export const INCIDENT_EPISODE_FEED_ICONS: Record<
  IncidentEpisodeFeedEventType,
  IconProp
> = getFeedIcons(INCIDENT_EPISODE_FEED_KINDS);

export const ALERT_EPISODE_FEED_ICONS: Record<
  AlertEpisodeFeedEventType,
  IconProp
> = getFeedIcons(ALERT_EPISODE_FEED_KINDS);

export function getIncidentEpisodeFeedKind(
  eventType: IncidentEpisodeFeedEventType | string | undefined,
): FeedEntryKind {
  return getFeedEntryKind({
    kinds: INCIDENT_EPISODE_FEED_KINDS,
    eventType: eventType,
  });
}

export function getAlertEpisodeFeedKind(
  eventType: AlertEpisodeFeedEventType | string | undefined,
): FeedEntryKind {
  return getFeedEntryKind({
    kinds: ALERT_EPISODE_FEED_KINDS,
    eventType: eventType,
  });
}

export function getIncidentEpisodeFeedIcon(
  eventType: IncidentEpisodeFeedEventType | undefined,
): IconProp {
  return getIncidentEpisodeFeedKind(eventType).icon;
}

export function getAlertEpisodeFeedIcon(
  eventType: AlertEpisodeFeedEventType | undefined,
): IconProp {
  return getAlertEpisodeFeedKind(eventType).icon;
}
