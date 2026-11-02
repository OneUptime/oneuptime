/*
 * THE NAME A CLIENT GIVES A MODEL WHOSE OWN NAME READS POORLY AS ONE.
 *
 * The clients OneUptime publishes from its API - the Terraform and OpenTofu
 * provider (Scripts/TerraformProvider), the dashboard's Developer > Terraform
 * pages (TerraformSchema.getTerraformTypeName) and, after them, the CLI -
 * name a resource after its model's singular name: "Monitor" is
 * oneuptime_monitor. A few singular names are worded for a screen, not for
 * a resource, and read poorly as one:
 *
 *   - "User's On-Call Duty Escalation Rule" was
 *     oneuptime_users_on_call_duty_escalation_rule, for the person an
 *     escalation rule pages, beside oneuptime_escalation_rule itself; its
 *     team and schedule were oneuptime_team_on_call_duty_escalation_rule and
 *     oneuptime_schedules_on_call_duty_escalation_rule;
 *   - "AI Agent Owner Team" and "Probe Owner Team" were the only two owner
 *     teams of 38 not named <thing>_team_owner;
 *   - a status page's subscriber notification template - the row that says
 *     a status page sends with a template - is called "Subscriber
 *     Notification Template" on screen, as the template itself is. Two
 *     models of one name made one provider resource, the link's endpoints
 *     won, and no template could be made with Terraform at all. The
 *     template keeps the name; the link is a status page's.
 *
 * A client names each of them as below instead, by the model's table, which
 * the OpenAPI spec says on each tag (x-oneuptime-table). The provider keeps
 * the old name working as a deprecated alias that a moved block leaves
 * behind - or, where the old name is another resource's now, takes a moved
 * block from it.
 * The dashboard's own words for the records, its singular names, stay as
 * they are. No two models may share a name (ClientResourceNames.test.ts),
 * and the provider's generator stops when two do.
 */
export const CLIENT_RESOURCE_NAMES: Readonly<Record<string, string>> = {
  OnCallDutyPolicyEscalationRuleUser: "Escalation Rule User",
  OnCallDutyPolicyEscalationRuleTeam: "Escalation Rule Team",
  OnCallDutyPolicyEscalationRuleSchedule: "Escalation Rule Schedule",
  AIAgentOwnerTeam: "AI Agent Team Owner",
  ProbeOwnerTeam: "Probe Team Owner",
  StatusPageSubscriberNotificationTemplateStatusPage:
    "Status Page Subscriber Notification Template",
};

/*
 * The name a client gives a model: its own client name, or its singular
 * name.
 */
export function getClientResourceName(
  tableName: string,
  singularName: string,
): string {
  return CLIENT_RESOURCE_NAMES[tableName] || singularName;
}
