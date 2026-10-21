import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";

/*
 * WHICH RULES CAN CREATE A CHANNEL OF THEIR OWN.
 *
 * A rule for incidents, alerts, their episodes, scheduled maintenance events,
 * monitors or on-call policies can post to channels people already have and
 * create a channel for each record, with the record's people in it. A
 * security case rule only posts (SecurityCaseNotificationRule): a case is the
 * investigation trail of a possible breach, so it is posted to the channels
 * and, in Microsoft Teams, the chats its rule names, and the server never
 * opens a channel for one or invites anybody.
 *
 * So a security case rule's Destination step asks only where to post, and
 * what it says it does never mentions a channel of its own, whatever a rule
 * saved through the API holds. React-free, so the rule's copy and App's
 * tests can read it.
 */

// The kinds of record a rule can create a channel for.
export type ChannelRecordEventType = Exclude<
  NotificationRuleEventType,
  NotificationRuleEventType.SecurityCase
>;

export function canRuleCreateChannel(
  eventType: NotificationRuleEventType,
): eventType is ChannelRecordEventType {
  return eventType !== NotificationRuleEventType.SecurityCase;
}

// Every kind of record a rule can create a channel for, in the enum's order.
export const CHANNEL_RECORD_EVENT_TYPES: ReadonlyArray<ChannelRecordEventType> =
  Object.values(NotificationRuleEventType).filter(canRuleCreateChannel);
