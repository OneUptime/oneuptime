import { SnmpTableDefinition } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { WIFI_TABLE_KINDS } from "Common/Utils/NetworkDevice/WifiRadioUtil";
import {
  VendorTemplateChoiceKind,
  VendorTemplateDecision,
  VendorTemplateDeviceFacts,
  VendorTemplateSkip,
  decideVendorTemplate,
} from "./VendorTemplateApplication";

/*
 * What a device's Wi-Fi tab says when it has no Wi-Fi data yet - decided
 * without React, so the page and its tests read the same rules.
 *
 * The one obvious next step is the vendor's template, so the tab works out
 * which one the device needs from what its last poll read (its sysObjectID
 * and sysDescr, matched exactly as "Apply Vendor Template" and the first
 * poll of a discovered device match them) and offers to apply it. Where it
 * cannot - the device is not identified yet, its tables come from an OID
 * Collection Template, a monitor polls it, or no template reads Wi-Fi for
 * its vendor - it says why, and where to go instead.
 */

export enum WifiAdviceKind {
  // The device's vendor has a Wi-Fi template the device does not walk yet.
  ApplyTemplate = "applyTemplate",
  // It already has the template's Wi-Fi tables; they have not been walked yet.
  WaitForPoll = "waitForPoll",
  // Not read over SNMP yet, so there is no vendor to match.
  NotIdentified = "notIdentified",
  // Its tables come from an OID Collection Template: add them there.
  LinkedToOidTemplate = "linkedToOidTemplate",
  // A monitor polls it, not the device: nothing a template adds would be read.
  MonitorBacked = "monitorBacked",
  // Identified, but no template reads radios for what it reports.
  NoWifiTemplate = "noWifiTemplate",
}

export type WifiAdvice =
  | { kind: WifiAdviceKind.ApplyTemplate; template: SnmpVendorTemplate }
  | { kind: WifiAdviceKind.WaitForPoll; template: SnmpVendorTemplate }
  | { kind: WifiAdviceKind.NotIdentified }
  | { kind: WifiAdviceKind.LinkedToOidTemplate }
  | { kind: WifiAdviceKind.MonitorBacked }
  | { kind: WifiAdviceKind.NoWifiTemplate };

export interface WifiAdviceDeviceFacts extends VendorTemplateDeviceFacts {
  // The device's own tables, to tell "apply" from "wait for the next poll".
  snmpTables?: Array<SnmpTableDefinition> | null | undefined;
}

// Whether a template brings at least one table the Wi-Fi tab reads.
export function hasWifiTables(template: SnmpVendorTemplate): boolean {
  return (template.tables || []).some((table: SnmpTableDefinition) => {
    return WIFI_TABLE_KINDS.includes(SnmpTableListUtil.parseKind(table.kind));
  });
}

/*
 * The templates with Wi-Fi tables, in the order the template lists keep -
 * the vendors the empty Wi-Fi tab names as supported.
 */
export function getWifiTemplates(): Array<SnmpVendorTemplate> {
  return SnmpVendorTemplateUtil.getAll().filter(
    (template: SnmpVendorTemplate) => {
      return hasWifiTables(template);
    },
  );
}

export function getWifiAdvice(device: WifiAdviceDeviceFacts): WifiAdvice {
  const decision: VendorTemplateDecision = decideVendorTemplate(device, {
    kind: VendorTemplateChoiceKind.MatchEachDevice,
  });

  if (decision.kind === "skip") {
    switch (decision.skip) {
      case VendorTemplateSkip.MonitorBacked:
        return { kind: WifiAdviceKind.MonitorBacked };
      case VendorTemplateSkip.LinkedToOidTemplate:
        return { kind: WifiAdviceKind.LinkedToOidTemplate };
      case VendorTemplateSkip.NotIdentified:
        return { kind: WifiAdviceKind.NotIdentified };
      default:
        return { kind: WifiAdviceKind.NoWifiTemplate };
    }
  }

  if (!hasWifiTables(decision.template)) {
    return { kind: WifiAdviceKind.NoWifiTemplate };
  }

  const ownKeys: Set<string> = new Set(
    (device.snmpTables || []).map((table: SnmpTableDefinition) => {
      return SnmpTableListUtil.normalizeKey(table.key || table.name);
    }),
  );

  const missingWifiTable: boolean = (decision.template.tables || []).some(
    (table: SnmpTableDefinition) => {
      return (
        WIFI_TABLE_KINDS.includes(SnmpTableListUtil.parseKind(table.kind)) &&
        !ownKeys.has(table.key)
      );
    },
  );

  return missingWifiTable
    ? { kind: WifiAdviceKind.ApplyTemplate, template: decision.template }
    : { kind: WifiAdviceKind.WaitForPoll, template: decision.template };
}
