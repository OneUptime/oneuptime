import { AlertEpisodeFeedEventType } from "../../../Models/DatabaseModels/AlertEpisodeFeed";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentEpisodeFeedEventType } from "../../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";

/*
 * WHICH UPDATE EACH FEED ENTRY IS, FOR THE RULES THAT CHOOSE THEIR UPDATES.
 *
 * Every kind of entry in an incident's, alert's, episode's, scheduled
 * maintenance event's or on-call policy's feed is exactly one kind of
 * update (NotificationRuleUpdates): a rule that chose Key updates only
 * posts a public note and leaves a private one out because of this table,
 * and an on-call channel hears who is on call and not every override
 * (issue #7549). Each
 * table is a Record of its feed's every event type, so a new kind of feed
 * entry does not compile until somebody says which update it is - and
 * FeedUpdateKinds.test holds every answer to the updates that kind of rule
 * can choose, so it is never one no rule can pick.
 *
 * Kinds of entry that are never posted to Slack, Microsoft Teams or
 * Mattermost - an episode's severity, a rule run that only the feed shows -
 * have a kind too, the one they would be posted as: the update the rules
 * can choose that says it best, or Everything else.
 *
 * Where an entry is more than its type - a state change that resolves the
 * incident, an edit that changes its severity - the code that writes it
 * says so (FeedWorkspaceNotification.updateKinds), and its type's kind here
 * is only the default.
 */

export const INCIDENT_FEED_UPDATE_KINDS: Readonly<
  Record<IncidentFeedEventType, NotificationRuleUpdateKind>
> = {
  [IncidentFeedEventType.IncidentCreated]: NotificationRuleUpdateKind.Created,
  // Resolved and reopened, said where it is written (getStateChangeKind).
  [IncidentFeedEventType.IncidentStateChanged]:
    NotificationRuleUpdateKind.StateChanges,
  // The severity and the postmortem's status are said where it is written.
  [IncidentFeedEventType.IncidentUpdated]: NotificationRuleUpdateKind.Edits,
  [IncidentFeedEventType.PublicNote]: NotificationRuleUpdateKind.PublicNotes,
  [IncidentFeedEventType.PublicNoteApproval]:
    NotificationRuleUpdateKind.PublicNotes,
  [IncidentFeedEventType.PrivateNote]: NotificationRuleUpdateKind.PrivateNotes,
  [IncidentFeedEventType.OwnerUserAdded]: NotificationRuleUpdateKind.Owners,
  [IncidentFeedEventType.OwnerTeamAdded]: NotificationRuleUpdateKind.Owners,
  [IncidentFeedEventType.OwnerUserRemoved]: NotificationRuleUpdateKind.Owners,
  [IncidentFeedEventType.OwnerTeamRemoved]: NotificationRuleUpdateKind.Owners,
  // The Incident Commander and the incident's other roles.
  [IncidentFeedEventType.IncidentMemberAdded]:
    NotificationRuleUpdateKind.Owners,
  [IncidentFeedEventType.IncidentMemberRemoved]:
    NotificationRuleUpdateKind.Owners,
  [IncidentFeedEventType.OnCallPolicy]: NotificationRuleUpdateKind.Paging,
  [IncidentFeedEventType.OnCallNotification]: NotificationRuleUpdateKind.Paging,
  [IncidentFeedEventType.OnCallRuleExecuted]: NotificationRuleUpdateKind.Paging,
  [IncidentFeedEventType.PostmortemNote]: NotificationRuleUpdateKind.Postmortem,
  // OneUptime AI's root cause analysis.
  [IncidentFeedEventType.RootCause]: NotificationRuleUpdateKind.AI,
  [IncidentFeedEventType.AutoRemediation]: NotificationRuleUpdateKind.AI,
  // The AI summary of a call.
  [IncidentFeedEventType.VideoCallSummary]: NotificationRuleUpdateKind.AI,
  [IncidentFeedEventType.RemediationNotes]: NotificationRuleUpdateKind.Edits,
  [IncidentFeedEventType.VideoCallStarted]:
    NotificationRuleUpdateKind.VideoCallStarted,
  [IncidentFeedEventType.VideoCallFailed]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.VideoCallTranscriptAdded]:
    NotificationRuleUpdateKind.Other,
  // Delivery problems: not every subscriber was notified.
  [IncidentFeedEventType.SubscriberNotificationSent]:
    NotificationRuleUpdateKind.Other,
  // Reminders that the incident is still open.
  [IncidentFeedEventType.OwnerNotificationSent]:
    NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.AlertLinked]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.AlertUnlinked]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.LabelRuleExecuted]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.OwnerRuleExecuted]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.PrivacyRuleExecuted]: NotificationRuleUpdateKind.Other,
  [IncidentFeedEventType.ChannelMemberAdded]: NotificationRuleUpdateKind.Other,
};

export const ALERT_FEED_UPDATE_KINDS: Readonly<
  Record<AlertFeedEventType, NotificationRuleUpdateKind>
> = {
  [AlertFeedEventType.AlertCreated]: NotificationRuleUpdateKind.Created,
  // Resolved and reopened, said where it is written (getStateChangeKind).
  [AlertFeedEventType.AlertStateChanged]:
    NotificationRuleUpdateKind.StateChanges,
  // The severity is said where it is written.
  [AlertFeedEventType.AlertUpdated]: NotificationRuleUpdateKind.Edits,
  [AlertFeedEventType.PrivateNote]: NotificationRuleUpdateKind.PrivateNotes,
  // An alert has no status page: nothing of it is posted as a public note.
  [AlertFeedEventType.PublicNote]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.OwnerUserAdded]: NotificationRuleUpdateKind.Owners,
  [AlertFeedEventType.OwnerTeamAdded]: NotificationRuleUpdateKind.Owners,
  [AlertFeedEventType.OwnerUserRemoved]: NotificationRuleUpdateKind.Owners,
  [AlertFeedEventType.OwnerTeamRemoved]: NotificationRuleUpdateKind.Owners,
  [AlertFeedEventType.OnCallPolicy]: NotificationRuleUpdateKind.Paging,
  [AlertFeedEventType.OnCallNotification]: NotificationRuleUpdateKind.Paging,
  [AlertFeedEventType.OnCallRuleExecuted]: NotificationRuleUpdateKind.Paging,
  // OneUptime AI's root cause analysis.
  [AlertFeedEventType.RootCause]: NotificationRuleUpdateKind.AI,
  [AlertFeedEventType.AutoRemediation]: NotificationRuleUpdateKind.AI,
  [AlertFeedEventType.RemediationNotes]: NotificationRuleUpdateKind.Edits,
  [AlertFeedEventType.VideoCallStarted]:
    NotificationRuleUpdateKind.VideoCallStarted,
  [AlertFeedEventType.VideoCallFailed]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.SubscriberNotificationSent]:
    NotificationRuleUpdateKind.Other,
  // Reminders that the alert is still open.
  [AlertFeedEventType.OwnerNotificationSent]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.AddedToEpisode]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.RemovedFromEpisode]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.LinkedToIncident]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.UnlinkedFromIncident]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.LabelRuleExecuted]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.OwnerRuleExecuted]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.PrivacyRuleExecuted]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.IncidentRuleExecuted]: NotificationRuleUpdateKind.Other,
  [AlertFeedEventType.ChannelMemberAdded]: NotificationRuleUpdateKind.Other,
};

export const INCIDENT_EPISODE_FEED_UPDATE_KINDS: Readonly<
  Record<IncidentEpisodeFeedEventType, NotificationRuleUpdateKind>
> = {
  [IncidentEpisodeFeedEventType.EpisodeCreated]:
    NotificationRuleUpdateKind.Created,
  // Resolved and reopened, said where it is written (getStateChangeKind).
  [IncidentEpisodeFeedEventType.EpisodeStateChanged]:
    NotificationRuleUpdateKind.StateChanges,
  [IncidentEpisodeFeedEventType.IncidentAdded]:
    NotificationRuleUpdateKind.EpisodeMembers,
  [IncidentEpisodeFeedEventType.IncidentRemoved]:
    NotificationRuleUpdateKind.EpisodeMembers,
  [IncidentEpisodeFeedEventType.PublicNote]:
    NotificationRuleUpdateKind.PublicNotes,
  [IncidentEpisodeFeedEventType.PublicNoteApproval]:
    NotificationRuleUpdateKind.PublicNotes,
  [IncidentEpisodeFeedEventType.PrivateNote]:
    NotificationRuleUpdateKind.PrivateNotes,
  [IncidentEpisodeFeedEventType.OwnerUserAdded]:
    NotificationRuleUpdateKind.Owners,
  [IncidentEpisodeFeedEventType.OwnerTeamAdded]:
    NotificationRuleUpdateKind.Owners,
  [IncidentEpisodeFeedEventType.OwnerUserRemoved]:
    NotificationRuleUpdateKind.Owners,
  [IncidentEpisodeFeedEventType.OwnerTeamRemoved]:
    NotificationRuleUpdateKind.Owners,
  [IncidentEpisodeFeedEventType.OnCallPolicy]:
    NotificationRuleUpdateKind.Paging,
  [IncidentEpisodeFeedEventType.OnCallNotification]:
    NotificationRuleUpdateKind.Paging,
  [IncidentEpisodeFeedEventType.OnCallRuleExecuted]:
    NotificationRuleUpdateKind.Paging,
  /*
   * Kept to the episode's feed today. Posted one day, each gets an update
   * of its own on the episode rules' Updates step.
   */
  [IncidentEpisodeFeedEventType.EpisodeUpdated]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.SeverityChanged]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.RootCause]: NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.RemediationNotes]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.PostmortemNote]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.SubscriberNotificationSent]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.OwnerNotificationSent]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.LabelRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.OwnerRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.PrivacyRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [IncidentEpisodeFeedEventType.ChannelMemberAdded]:
    NotificationRuleUpdateKind.Other,
};

export const ALERT_EPISODE_FEED_UPDATE_KINDS: Readonly<
  Record<AlertEpisodeFeedEventType, NotificationRuleUpdateKind>
> = {
  [AlertEpisodeFeedEventType.EpisodeCreated]:
    NotificationRuleUpdateKind.Created,
  // Resolved and reopened, said where it is written (getStateChangeKind).
  [AlertEpisodeFeedEventType.EpisodeStateChanged]:
    NotificationRuleUpdateKind.StateChanges,
  [AlertEpisodeFeedEventType.AlertAdded]:
    NotificationRuleUpdateKind.EpisodeMembers,
  [AlertEpisodeFeedEventType.AlertRemoved]:
    NotificationRuleUpdateKind.EpisodeMembers,
  [AlertEpisodeFeedEventType.PrivateNote]:
    NotificationRuleUpdateKind.PrivateNotes,
  [AlertEpisodeFeedEventType.OwnerUserAdded]: NotificationRuleUpdateKind.Owners,
  [AlertEpisodeFeedEventType.OwnerTeamAdded]: NotificationRuleUpdateKind.Owners,
  [AlertEpisodeFeedEventType.OwnerUserRemoved]:
    NotificationRuleUpdateKind.Owners,
  [AlertEpisodeFeedEventType.OwnerTeamRemoved]:
    NotificationRuleUpdateKind.Owners,
  [AlertEpisodeFeedEventType.OnCallPolicy]: NotificationRuleUpdateKind.Paging,
  [AlertEpisodeFeedEventType.OnCallNotification]:
    NotificationRuleUpdateKind.Paging,
  [AlertEpisodeFeedEventType.OnCallRuleExecuted]:
    NotificationRuleUpdateKind.Paging,
  /*
   * Kept to the episode's feed today. Posted one day, each gets an update
   * of its own on the episode rules' Updates step.
   */
  [AlertEpisodeFeedEventType.EpisodeUpdated]: NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.SeverityChanged]: NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.RootCause]: NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.OwnerNotificationSent]:
    NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.LabelRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.OwnerRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.PrivacyRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [AlertEpisodeFeedEventType.ChannelMemberAdded]:
    NotificationRuleUpdateKind.Other,
};

export const SCHEDULED_MAINTENANCE_FEED_UPDATE_KINDS: Readonly<
  Record<ScheduledMaintenanceFeedEventType, NotificationRuleUpdateKind>
> = {
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated]:
    NotificationRuleUpdateKind.Created,
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged]:
    NotificationRuleUpdateKind.StateChanges,
  [ScheduledMaintenanceFeedEventType.PublicNote]:
    NotificationRuleUpdateKind.PublicNotes,
  [ScheduledMaintenanceFeedEventType.PublicNoteApproval]:
    NotificationRuleUpdateKind.PublicNotes,
  [ScheduledMaintenanceFeedEventType.PrivateNote]:
    NotificationRuleUpdateKind.PrivateNotes,
  /*
   * Kept to the event's feed today. Posted one day, each gets an update of
   * its own on the scheduled maintenance rules' Updates step.
   */
  [ScheduledMaintenanceFeedEventType.ScheduledMaintenanceUpdated]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OwnerUserAdded]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OwnerTeamAdded]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OwnerUserRemoved]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OwnerTeamRemoved]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.RootCause]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.RemediationNotes]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OnCallPolicy]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OnCallNotification]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.SubscriberNotificationSent]:
    NotificationRuleUpdateKind.Other,
  // Reminders that the event has not ended.
  [ScheduledMaintenanceFeedEventType.OwnerNotificationSent]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.OwnerRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.LabelRuleExecuted]:
    NotificationRuleUpdateKind.Other,
  [ScheduledMaintenanceFeedEventType.ChannelMemberAdded]:
    NotificationRuleUpdateKind.Other,
};

/*
 * An on-call policy's feed (issue #7549). A roster handoff is who is on
 * call now; the handoff code says when its entry is only who is next
 * (OnCallHandoffPosts names OnCallNext). Every kind of entry the policy's
 * rules can tell apart has an update of its own: nothing is Everything
 * else.
 */
export const ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS: Readonly<
  Record<OnCallDutyPolicyFeedEventType, NotificationRuleUpdateKind>
> = {
  [OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated]:
    NotificationRuleUpdateKind.Created,
  // Who is on call now; who is next when the handoff code says so.
  [OnCallDutyPolicyFeedEventType.RosterHandoff]:
    NotificationRuleUpdateKind.OnCallNow,
  [OnCallDutyPolicyFeedEventType.CoverageGapStarted]:
    NotificationRuleUpdateKind.NobodyOnCall,
  [OnCallDutyPolicyFeedEventType.UserOverrideAdded]:
    NotificationRuleUpdateKind.Overrides,
  // An override's cover or times edited (issues #7630, #7631).
  [OnCallDutyPolicyFeedEventType.UserOverrideChanged]:
    NotificationRuleUpdateKind.Overrides,
  [OnCallDutyPolicyFeedEventType.UserOverrideRemoved]:
    NotificationRuleUpdateKind.Overrides,
  // Who and what the policy's escalation rules page.
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.OnCallDutyScheduleRemoved]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.UserAdded]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.UserRemoved]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.TeamAdded]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.TeamRemoved]:
    NotificationRuleUpdateKind.PolicyChanges,
  [OnCallDutyPolicyFeedEventType.OwnerUserAdded]:
    NotificationRuleUpdateKind.Owners,
  [OnCallDutyPolicyFeedEventType.OwnerUserRemoved]:
    NotificationRuleUpdateKind.Owners,
  [OnCallDutyPolicyFeedEventType.OwnerTeamAdded]:
    NotificationRuleUpdateKind.Owners,
  [OnCallDutyPolicyFeedEventType.OwnerTeamRemoved]:
    NotificationRuleUpdateKind.Owners,
};

export default class FeedUpdateKinds {
  /*
   * The kinds of update an entry is: the ones its writer named, or its
   * type's (the tables above).
   */
  public static resolve(data: {
    named: ReadonlyArray<NotificationRuleUpdateKind> | undefined;
    ofType: NotificationRuleUpdateKind;
  }): Array<NotificationRuleUpdateKind> {
    return data.named && data.named.length > 0
      ? [...data.named]
      : [data.ofType];
  }
}
