import AlertEpisodeLabelRule from "Common/Models/DatabaseModels/AlertEpisodeLabelRule";
import AlertEpisodeOnCallRule from "Common/Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertEpisodeOnCallRuleOwningTeam from "Common/Models/DatabaseModels/AlertEpisodeOnCallRuleOwningTeam";
import AlertEpisodeOwnerRule from "Common/Models/DatabaseModels/AlertEpisodeOwnerRule";
import AlertEpisodePrivacyRule from "Common/Models/DatabaseModels/AlertEpisodePrivacyRule";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import AlertIncidentRule from "Common/Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import AlertOnCallRuleOwningTeam from "Common/Models/DatabaseModels/AlertOnCallRuleOwningTeam";
import AlertOwnerRule from "Common/Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "Common/Models/DatabaseModels/AlertPrivacyRule";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getApiSingularName } from "Common/Utils/ModelApiName";

/*
 * THE KINDS OF ALERT RULE WHOSE HISTORY ALERTS > RULES > AUDIT LOGS LISTS
 * (#10290): each kind of alert rule and its episode twin, and the teams
 * picked to own an on-call rule, which roll up to their rule. Runbook rules
 * are one kind for alerts, incidents and maintenance events, and their
 * entries do not say whose they are: their history is Runbooks > Settings >
 * Rule Audit Logs (Pages/Runbook/Settings/RuleAuditLogTypes, #10462).
 */
export const ALERT_RULE_MODEL_TYPES: ReadonlyArray<{ new (): BaseModel }> = [
  AlertGroupingRule,
  AlertOnCallRule,
  AlertOnCallRuleOwningTeam,
  AlertEpisodeOnCallRule,
  AlertEpisodeOnCallRuleOwningTeam,
  AlertIncidentRule,
  AlertOwnerRule,
  AlertEpisodeOwnerRule,
  AlertPrivacyRule,
  AlertEpisodePrivacyRule,
  AlertLabelRule,
  AlertEpisodeLabelRule,
  AlertReminderRule,
];

// The resource types their entries are stored under.
export const getAlertRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return ALERT_RULE_MODEL_TYPES.map(
      (modelType: { new (): BaseModel }): string => {
        return getApiSingularName(new modelType());
      },
    );
  };
