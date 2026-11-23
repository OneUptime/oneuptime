import StorageArrayLabelRule from "Common/Models/DatabaseModels/StorageArrayLabelRule";
import StorageArrayOwnerRule from "Common/Models/DatabaseModels/StorageArrayOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY STORAGE ARRAYS > SETTINGS > RULE AUDIT LOGS
 * LISTS (#10462): its owner and label rules.
 */
export const STORAGE_ARRAY_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  StorageArrayOwnerRule,
  StorageArrayLabelRule,
];

// The resource types their entries are stored under.
export const getStorageArrayRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(STORAGE_ARRAY_RULE_MODEL_TYPES);
  };
