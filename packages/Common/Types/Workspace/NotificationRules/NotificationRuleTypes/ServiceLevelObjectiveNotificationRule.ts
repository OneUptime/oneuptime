import BaseNotificationRule from "../BaseNotificationRule";

/*
 * Posts to existing channels and chats only, as a hunt's rule does: what it
 * posts is a change of an SLO's error budget policy - the tier the SLO
 * entered and the team's agreement for it, or its deployments frozen or
 * allowed again - which a team reads where it chose to, never in a channel
 * a rule would open for each SLO and fill with people.
 */
export default interface ServiceLevelObjectiveNotificationRule
  extends BaseNotificationRule {
  _type: "ServiceLevelObjectiveNotificationRule";
}
