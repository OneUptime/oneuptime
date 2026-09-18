import IconProp from "Common/Types/Icon/IconProp";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";

/*
 * One icon per feed event type. These are Records rather than if-chains so
 * that adding an event type to either enum fails the build until it gets an
 * icon, instead of silently falling back to a plain circle in the feed.
 */
export const INCIDENT_EPISODE_FEED_ICONS: Record<
  IncidentEpisodeFeedEventType,
  IconProp
> = {
  [IncidentEpisodeFeedEventType.EpisodeCreated]: IconProp.Layers,
  [IncidentEpisodeFeedEventType.EpisodeStateChanged]: IconProp.ArrowCircleRight,
  [IncidentEpisodeFeedEventType.EpisodeUpdated]: IconProp.Edit,
  [IncidentEpisodeFeedEventType.IncidentAdded]: IconProp.Alert,
  [IncidentEpisodeFeedEventType.IncidentRemoved]: IconProp.Close,
  [IncidentEpisodeFeedEventType.OwnerUserAdded]: IconProp.User,
  [IncidentEpisodeFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [IncidentEpisodeFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [IncidentEpisodeFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [IncidentEpisodeFeedEventType.OwnerNotificationSent]: IconProp.Bell,
  [IncidentEpisodeFeedEventType.PrivateNote]: IconProp.Lock,
  [IncidentEpisodeFeedEventType.PublicNote]: IconProp.Announcement,
  [IncidentEpisodeFeedEventType.RootCause]: IconProp.Cube,
  [IncidentEpisodeFeedEventType.RemediationNotes]: IconProp.Wrench,
  [IncidentEpisodeFeedEventType.PostmortemNote]: IconProp.TextFile,
  [IncidentEpisodeFeedEventType.OnCallPolicy]: IconProp.Call,
  [IncidentEpisodeFeedEventType.OnCallNotification]: IconProp.Alert,
  [IncidentEpisodeFeedEventType.SeverityChanged]: IconProp.ExclaimationCircle,
  [IncidentEpisodeFeedEventType.SubscriberNotificationSent]:
    IconProp.Notification,
  [IncidentEpisodeFeedEventType.LabelRuleExecuted]: IconProp.Tag,
  [IncidentEpisodeFeedEventType.OwnerRuleExecuted]: IconProp.User,
  [IncidentEpisodeFeedEventType.PrivacyRuleExecuted]: IconProp.EyeSlash,
  [IncidentEpisodeFeedEventType.OnCallRuleExecuted]: IconProp.Call,
};

export const ALERT_EPISODE_FEED_ICONS: Record<
  AlertEpisodeFeedEventType,
  IconProp
> = {
  [AlertEpisodeFeedEventType.EpisodeCreated]: IconProp.Layers,
  [AlertEpisodeFeedEventType.EpisodeStateChanged]: IconProp.ArrowCircleRight,
  [AlertEpisodeFeedEventType.EpisodeUpdated]: IconProp.Edit,
  [AlertEpisodeFeedEventType.AlertAdded]: IconProp.Alert,
  [AlertEpisodeFeedEventType.AlertRemoved]: IconProp.Close,
  [AlertEpisodeFeedEventType.OwnerUserAdded]: IconProp.User,
  [AlertEpisodeFeedEventType.OwnerTeamAdded]: IconProp.Team,
  [AlertEpisodeFeedEventType.OwnerUserRemoved]: IconProp.Close,
  [AlertEpisodeFeedEventType.OwnerTeamRemoved]: IconProp.Close,
  [AlertEpisodeFeedEventType.OwnerNotificationSent]: IconProp.Bell,
  [AlertEpisodeFeedEventType.PrivateNote]: IconProp.Lock,
  [AlertEpisodeFeedEventType.RootCause]: IconProp.Cube,
  [AlertEpisodeFeedEventType.OnCallPolicy]: IconProp.Call,
  [AlertEpisodeFeedEventType.OnCallNotification]: IconProp.Alert,
  [AlertEpisodeFeedEventType.SeverityChanged]: IconProp.ExclaimationCircle,
  [AlertEpisodeFeedEventType.LabelRuleExecuted]: IconProp.Tag,
  [AlertEpisodeFeedEventType.OwnerRuleExecuted]: IconProp.User,
  [AlertEpisodeFeedEventType.PrivacyRuleExecuted]: IconProp.EyeSlash,
  [AlertEpisodeFeedEventType.OnCallRuleExecuted]: IconProp.Call,
};

export function getIncidentEpisodeFeedIcon(
  eventType: IncidentEpisodeFeedEventType | undefined,
): IconProp {
  return (
    (eventType && INCIDENT_EPISODE_FEED_ICONS[eventType]) || IconProp.Circle
  );
}

export function getAlertEpisodeFeedIcon(
  eventType: AlertEpisodeFeedEventType | undefined,
): IconProp {
  return (eventType && ALERT_EPISODE_FEED_ICONS[eventType]) || IconProp.Circle;
}
