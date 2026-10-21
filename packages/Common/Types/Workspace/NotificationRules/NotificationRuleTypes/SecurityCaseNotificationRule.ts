import BaseNotificationRule from "../BaseNotificationRule";

/*
 * Posts to existing channels and chats only: a security case is the
 * investigation trail of a possible breach, so it gets no channel of its own
 * that a rule would open and fill with people.
 */
export default interface SecurityCaseNotificationRule
  extends BaseNotificationRule {
  _type: "SecurityCaseNotificationRule";
}
