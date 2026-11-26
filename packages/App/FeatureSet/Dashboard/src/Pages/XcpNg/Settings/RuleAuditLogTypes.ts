import XcpNgPoolLabelRule from "Common/Models/DatabaseModels/XcpNgPoolLabelRule";
import XcpNgPoolOwnerRule from "Common/Models/DatabaseModels/XcpNgPoolOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY XCP-NG > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its pools' owner and label rules.
 */
export const XCP_NG_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  XcpNgPoolOwnerRule,
  XcpNgPoolLabelRule,
];

// The resource types their entries are stored under.
export const getXcpNgRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(XCP_NG_RULE_MODEL_TYPES);
  };
