import BaseNotificationRule from "../BaseNotificationRule";

// This rule is just used to post to existing channels.
export default interface MonitorNotificationRule extends BaseNotificationRule {
  _type: "MonitorNotificationRule";
}
