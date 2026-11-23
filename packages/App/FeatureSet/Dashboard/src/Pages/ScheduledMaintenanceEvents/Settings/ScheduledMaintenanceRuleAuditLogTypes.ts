import ScheduledMaintenanceLabelRule from "Common/Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceOwnerRule from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY SCHEDULED MAINTENANCE > RULES > AUDIT LOGS
 * LISTS (#10462): its owner, label and reminder rules.
 */
export const SCHEDULED_MAINTENANCE_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> =
  [
    ScheduledMaintenanceOwnerRule,
    ScheduledMaintenanceLabelRule,
    ScheduledMaintenanceReminderRule,
  ];

// The resource types their entries are stored under.
export const getScheduledMaintenanceRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(SCHEDULED_MAINTENANCE_RULE_MODEL_TYPES);
  };
