import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceLabelRule from "Common/Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkDeviceLinkRule from "Common/Models/DatabaseModels/NetworkDeviceLinkRule";
import NetworkDeviceNamingRule from "Common/Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkDeviceOwnerRule from "Common/Models/DatabaseModels/NetworkDeviceOwnerRule";
import NetworkSiteAssignmentRule from "Common/Models/DatabaseModels/NetworkSiteAssignmentRule";
import {
  getRuleAuditLogResourceTypes,
  RuleModelType,
} from "../../../Components/AuditLogs/RuleAuditLogTypes";

/*
 * THE KINDS OF RULE WHOSE HISTORY NETWORK > RULES > AUDIT LOGS LISTS (#10462):
 * every rule its Rules section lists: auto import, site assignment, naming,
 * owner, label and link rules (a site assignment rule's entries are its site's
 * too, on the site's Audit Logs page).
 */
export const NETWORK_RULE_MODEL_TYPES: ReadonlyArray<RuleModelType> = [
  NetworkDeviceAutoImportRule,
  NetworkSiteAssignmentRule,
  NetworkDeviceNamingRule,
  NetworkDeviceOwnerRule,
  NetworkDeviceLabelRule,
  NetworkDeviceLinkRule,
];

// The resource types their entries are stored under.
export const getNetworkRuleResourceTypes: () => Array<string> =
  (): Array<string> => {
    return getRuleAuditLogResourceTypes(NETWORK_RULE_MODEL_TYPES);
  };
