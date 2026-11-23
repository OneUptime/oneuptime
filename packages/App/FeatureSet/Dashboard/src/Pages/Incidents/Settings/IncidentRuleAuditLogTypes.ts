import IncidentEpisodeLabelRule from "Common/Models/DatabaseModels/IncidentEpisodeLabelRule";
import IncidentEpisodeOnCallRule from "Common/Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentEpisodeOnCallRuleOwningTeam from "Common/Models/DatabaseModels/IncidentEpisodeOnCallRuleOwningTeam";
import IncidentEpisodeOwnerRule from "Common/Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentEpisodePrivacyRule from "Common/Models/DatabaseModels/IncidentEpisodePrivacyRule";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentLabelRule from "Common/Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import IncidentOnCallRuleOwningTeam from "Common/Models/DatabaseModels/IncidentOnCallRuleOwningTeam";
import IncidentOwnerRule from "Common/Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerRuleOwningTeam from "Common/Models/DatabaseModels/IncidentOwnerRuleOwningTeam";
import IncidentPrivacyRule from "Common/Models/DatabaseModels/IncidentPrivacyRule";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import IncidentSlaRule from "Common/Models/DatabaseModels/IncidentSlaRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY INCIDENTS > RULES > AUDIT LOGS LISTS
 * (#10462): its grouping, on-call, owner, privacy, label, SLA and reminder
 * rules, the episode twins of the on-call, owner, privacy and label rules, and
 * the teams picked to own an on-call or owner rule, which roll up to their
 * rule.
 */
export const INCIDENT_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  IncidentGroupingRule,
  IncidentOnCallRule,
  IncidentOnCallRuleOwningTeam,
  IncidentEpisodeOnCallRule,
  IncidentEpisodeOnCallRuleOwningTeam,
  IncidentOwnerRule,
  IncidentOwnerRuleOwningTeam,
  IncidentEpisodeOwnerRule,
  IncidentPrivacyRule,
  IncidentEpisodePrivacyRule,
  IncidentLabelRule,
  IncidentEpisodeLabelRule,
  IncidentSlaRule,
  IncidentReminderRule,
];

// The resource types their entries are stored under.
export const getIncidentRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(INCIDENT_RULE_MODEL_TYPES);
  };
