import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { translationKey } from "Common/Types/Translator";
import { getApiSingularName } from "Common/Utils/ModelApiName";

/*
 * WHO CHANGED A PRODUCT'S RULES, WHAT THEY CHANGED AND WHEN (#10462).
 *
 * Most rules are rows on their list, so their history has no resource page
 * to hang an Audit Logs page off. Each product's rules keep it on one page
 * at the end of the menu section that lists them, as Alerts > Rules > Audit
 * Logs started (#10290): Incidents > Rules > Audit Logs, Hosts > Settings >
 * Rule Audit Logs and the rest. A page lists the entries of its product's
 * kinds of rule by type (AuditLogsTable's resourceTypes), each kind by the
 * type its entries are stored under; the kinds are in the product's own
 * *RuleAuditLogTypes, which App/Tests/Dashboard/ProductRulesAuditLogsWiring
 * holds to every audited rule model of the product.
 *
 * Runbook rules are one kind for Alerts, Incidents and Scheduled
 * Maintenance, told apart by their trigger entity, which an entry does not
 * carry: their history is one page under Runbooks, beside the runbooks they
 * attach (Pages/Runbook/Settings/RuleAuditLogTypes), and the three products'
 * pages say where it is.
 */

export type RuleModelType = { new (): BaseModel };

// The types a product's rules' entries are stored under, in its order.
export const getRuleAuditLogResourceTypes: (
  modelTypes: ReadonlyArray<RuleModelType>,
) => Array<string> = (
  modelTypes: ReadonlyArray<RuleModelType>,
): Array<string> => {
  return modelTypes.map((modelType: RuleModelType): string => {
    return getApiSingularName(new modelType());
  });
};

/*
 * What a rules' Audit Logs page says under its title, as keys of the
 * Dashboard's locales: the card looks them up in the reader's language.
 */
export const RULE_AUDIT_LOGS_WORDS: Readonly<{
  description: string;
  descriptionWithRunbookRules: string;
  runbooksDescription: string;
}> = {
  description: translationKey(
    "Who created, changed or deleted these rules, what they changed and when.",
  ),
  // Alerts', Incidents' and Scheduled Maintenance's, whose Rules list runbook rules.
  descriptionWithRunbookRules: translationKey(
    "Who created, changed or deleted these rules, what they changed and when. Runbook rules' changes are under Runbooks > Settings > Rule Audit Logs.",
  ),
  runbooksDescription: translationKey(
    "Who created, changed or deleted these rules, what they changed and when: the runbook rules of alerts, incidents and maintenance events, and the runbooks' owner and label rules.",
  ),
};
