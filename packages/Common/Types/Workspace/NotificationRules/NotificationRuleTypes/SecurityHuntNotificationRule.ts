import BaseNotificationRule from "../BaseNotificationRule";

/*
 * Posts to existing channels and chats only, as a security case's rule
 * does: what a hunt finds is security data, so a rule posts it where the
 * team chose to read it, never into a channel it would open and fill with
 * people.
 */
export default interface SecurityHuntNotificationRule
  extends BaseNotificationRule {
  _type: "SecurityHuntNotificationRule";
}
