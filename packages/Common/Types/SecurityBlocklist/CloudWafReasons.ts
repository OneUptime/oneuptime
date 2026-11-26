import { translationKey } from "../Translator";
import {
  SecurityBlockReason,
  securityBlockReason,
} from "./SecurityBlockReason";

/*
 * WHAT AZURE WAF AND CLOUD ARMOR SAY OF A BLOCK OR A POLICY (#10348,
 * #10349), as reasons the Dashboard words in the reader's language
 * (SecurityBlockReason, #10629): why a block is not applied in a policy,
 * why what a policy holds is not in force, and where a policy stands.
 * Names, addresses, priorities and a cloud's own words go in as values.
 *
 * The Dashboard's extractor reads this file for what it marks
 * (Types/SecurityBlocklist is a "keys" root), so each is in every locale.
 */

export const CLOUD_WAF_REASONS: {
  cannotChallenge: string;
  ipv4Only: string;
  notAnAddress: string;
  full: string;
  noFreePriority: string;
  noFreePriorityAtAll: string;
  ruleTurnedOff: string;
  ruleChanged: string;
  ruleDeleted: string;
  priorityRuleTurnedOff: string;
  priorityRuleChanged: string;
  priorityRuleDeleted: string;
  groupDeleted: string;
  groupFull: string;
  policyTurnedOff: string;
  policyInDetection: string;
  gatewayPolicyNotAttached: string;
  frontDoorPolicyNotAttached: string;
  provisioningFailed: string;
  applying: string;
  keptChanging: string;
  busy: string;
  mayNotWrite: string;
  mayNotRead: string;
  policyNotFound: string;
  refused: string;
  couldNotRead: string;
  quotaUsedUp: string;
  rulesFull: string;
  networkPolicy: string;
} = {
  cannotChallenge: translationKey(
    "{{product}} cannot challenge: it can only block.",
  ),
  ipv4Only: translationKey(
    "Application Gateway matches IPv4 addresses only, so it cannot block {{value}}.",
  ),
  notAnAddress: translationKey(
    "{{product}} holds IPv4 and IPv6 addresses and ranges only.",
  ),
  full: translationKey(
    "{{policy}} is full: OneUptime's rules there hold {{addresses}} addresses, the most it keeps in one policy.",
  ),
  noFreePriority: translationKey(
    "{{policy}} has no free priority before your first Allow rule (priority {{priority}}) for another rule of OneUptime's, and OneUptime never renumbers your rules. Free a priority before it, and OneUptime adds its rule there.",
  ),
  noFreePriorityAtAll: translationKey(
    "{{policy}} has no free priority for another rule of OneUptime's: every priority from {{lowest}} to {{highest}} is taken, and OneUptime never renumbers your rules. Free one, and OneUptime adds its rule there.",
  ),
  ruleTurnedOff: translationKey(
    "OneUptime's rule {{rule}} in {{policy}} was turned off by hand, so the blocks it holds are not enforced. Select Put It Back to turn it on again.",
  ),
  ruleChanged: translationKey(
    "OneUptime's rule {{rule}} in {{policy}} was changed by hand, so the blocks it holds are not enforced. Select Put It Back to write it again.",
  ),
  ruleDeleted: translationKey(
    "OneUptime's rule {{rule}} in {{policy}} was deleted by hand, so the blocks it held are not enforced. Select Put It Back to add it again.",
  ),
  priorityRuleTurnedOff: translationKey(
    "OneUptime's rule at priority {{priority}} in {{policy}} was set to preview by hand, so the blocks it holds are not enforced. Select Put It Back to enforce it again.",
  ),
  priorityRuleChanged: translationKey(
    "OneUptime's rule at priority {{priority}} in {{policy}} was changed by hand, so the blocks it holds are not enforced. Select Put It Back to write it again.",
  ),
  priorityRuleDeleted: translationKey(
    "OneUptime's rule at priority {{priority}} in {{policy}} was deleted by hand, so the blocks it held are not enforced. Select Put It Back to add it again.",
  ),
  groupDeleted: translationKey(
    "OneUptime's address group {{group}} was deleted by hand, so its blocks are not enforced. Select Put It Back to make it again.",
  ),
  groupFull: translationKey(
    "OneUptime's address group {{group}} is full: it holds {{capacity}} ranges, the capacity it was made with.",
  ),
  policyTurnedOff: translationKey(
    "{{policy}} is turned off in Azure, so it blocks nothing. Turn it on, and its blocks are enforced from the next check.",
  ),
  policyInDetection: translationKey(
    "{{policy}} is in Detection mode, so Azure WAF only logs the requests OneUptime's rules match. Switch it to Prevention mode, and its blocks are enforced from the next check.",
  ),
  gatewayPolicyNotAttached: translationKey(
    "{{policy}} is not associated with an application gateway, a listener or a path rule, so it blocks nothing. Associate it in Azure, and its blocks are enforced from the next check.",
  ),
  frontDoorPolicyNotAttached: translationKey(
    "{{policy}} is not associated with a Front Door domain, so it blocks nothing. Associate it in Azure, and its blocks are enforced from the next check.",
  ),
  provisioningFailed: translationKey(
    "Azure could not apply the last change to {{policy}}: its provisioning state is Failed. Check the policy in the Azure portal. OneUptime reads it again on each check.",
  ),
  applying: translationKey(
    "Azure is applying the last change to {{policy}}. Its new blocks are enforced once it is done, usually within a few minutes.",
  ),
  keptChanging: translationKey(
    "{{policy}} kept changing while OneUptime wrote it ({{tries}} tries). OneUptime tries again shortly.",
  ),
  busy: translationKey(
    "Azure is still applying an earlier change to {{policy}}. OneUptime writes it again shortly.",
  ),
  mayNotWrite: translationKey(
    "OneUptime may not write {{policy}}: the connection has no {{permission}} there. Grant it with the lines the Add WAF dialog shows for the policy, then select Check Again.",
  ),
  mayNotRead: translationKey(
    "OneUptime may not read {{policy}}: the connection has no {{permission}} there. Grant it with the lines the Add WAF dialog shows for the policy, then select Check Again.",
  ),
  policyNotFound: translationKey(
    "{{policy}} was not found: it may have been deleted. Remove it here if it no longer exists.",
  ),
  refused: translationKey(
    "{{cloud}} refused the change to {{policy}}: {{error}}",
  ),
  couldNotRead: translationKey(
    "OneUptime could not read {{policy}}: {{error}}",
  ),
  quotaUsedUp: translationKey(
    "Google Cloud refused another rule in {{policy}} as over a quota: {{error}} Ask Google Cloud for more, or delete rules you no longer use.",
  ),
  rulesFull: translationKey(
    "{{policy}} is full: OneUptime's rules there hold {{addresses}} addresses, 10 to a rule. A global backend policy of a project with Cloud Armor Enterprise holds far more, in address groups.",
  ),
  networkPolicy: translationKey(
    "{{policy}} is a network edge security policy, whose rules match packets rather than requests, so OneUptime does not keep the blocklist in it. Pick a backend or edge security policy.",
  ),
};

/*
 * A reason with its values: what destinations hand the reconciler and the
 * row, worded where it is drawn.
 */
export function cloudWafReason(
  template: string,
  values: Record<string, string>,
  numbers?: Record<string, number> | undefined,
): SecurityBlockReason {
  return securityBlockReason(template, values, { numbers });
}
