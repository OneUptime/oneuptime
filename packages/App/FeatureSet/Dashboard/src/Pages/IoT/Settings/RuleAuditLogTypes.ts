import IoTFleetLabelRule from "Common/Models/DatabaseModels/IoTFleetLabelRule";
import IoTFleetOwnerRule from "Common/Models/DatabaseModels/IoTFleetOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY IOT > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its fleets' owner and label rules.
 */
export const IOT_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  IoTFleetOwnerRule,
  IoTFleetLabelRule,
];

// The resource types their entries are stored under.
export const getIoTRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(IOT_RULE_MODEL_TYPES);
  };
