import BaseNotificationRule from "../BaseNotificationRule";


// This rule is just used to post to existing channels. 
export default interface MonitorStatusNotificationRule extends BaseNotificationRule {
  _type: "MonitorStatusNotificationRule";
}
