import OpenStackCloudLabelRule from "Common/Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY OPENSTACK > SETTINGS > RULE AUDIT LOGS LISTS
 * (#10462): its clouds' owner and label rules.
 */
export const OPENSTACK_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  OpenStackCloudOwnerRule,
  OpenStackCloudLabelRule,
];

// The resource types their entries are stored under.
export const getOpenStackRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(OPENSTACK_RULE_MODEL_TYPES);
  };
