import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import { SnmpTableDefinition } from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What "Apply Vendor Template" does to one device, decided without the
 * network, so the dialog's preview and the action itself cannot disagree.
 *
 * A vendor template is what a device's Settings offers as "Vendor Health
 * Template": a prebuilt set of health OIDs (CPU, memory, temperature) and
 * SNMP tables (fans, radios, tunnels) for one platform. Applying it COPIES
 * them into the device's own lists - the same merge the Settings dropdown
 * and the SNMP Tables editor make, and the same one the first poll makes on
 * a discovered device (NetworkInventoryUtil): an OID or a table the device
 * already has is kept as it is, nothing is removed, and applying the same
 * template twice changes nothing.
 *
 * The template list is SnmpVendorTemplateUtil.getAll(), read when the dialog
 * is drawn: a template added there appears in the dialog, and is picked by
 * "Match each device's vendor", with no change here.
 */

// The dropdown value that picks each device's template from its own identity.
export const MATCH_EACH_DEVICE_VALUE: string = "match-each-device";

export const MATCH_EACH_DEVICE_LABEL: string = translationKey(
  "Match each device's vendor (recommended)",
);

export enum VendorTemplateChoiceKind {
  MatchEachDevice = "matchEachDevice",
  Template = "template",
}

export type VendorTemplateChoice =
  | { kind: VendorTemplateChoiceKind.MatchEachDevice }
  | { kind: VendorTemplateChoiceKind.Template; template: SnmpVendorTemplate };

/*
 * Why a device is left as it is. Checked in this order: what the device IS
 * (nothing polls it), then what it is linked to, then whether it can be
 * identified at all - so a monitor-backed device is never reported as merely
 * "not identified".
 */
export enum VendorTemplateSkip {
  // Nothing polls a monitor-backed device, so its OIDs would never be read.
  MonitorBacked = "monitorBacked",
  /*
   * Linked to an OID Collection Template, which is what decides its health
   * OIDs. A vendor copy on top would make it collect the union of two lists,
   * only one of which anybody can see - the reason the Settings page hides
   * the vendor dropdown on a linked device, and the first poll never seeds
   * one.
   */
  LinkedToOidTemplate = "linkedToOidTemplate",
  // No sysObjectID yet: nothing has walked it over SNMP.
  NotIdentified = "notIdentified",
  // Walked, but no template matches what it reports.
  NoMatchingTemplate = "noMatchingTemplate",
}

export type VendorTemplateDecision =
  | { kind: "apply"; template: SnmpVendorTemplate }
  | { kind: "skip"; skip: VendorTemplateSkip };

/*
 * What a decision needs from a device. Read off the table's rows for the
 * dialog's preview, and off a fresh read when the action runs.
 */
export interface VendorTemplateDeviceFacts {
  monitoringMethod?: string | null | undefined;
  // Presence is what counts: an id (or the relation) means "linked".
  oidTemplateId?: { toString: () => string } | string | null | undefined;
  sysObjectId?: string | null | undefined;
  sysDescr?: string | null | undefined;
}

export interface VendorTemplateOption {
  label: string;
  value: string;
}

/*
 * The dropdown's options: matching first (the safe choice for a mixed
 * selection), then every template in the order the Settings dropdown lists
 * them - generic first, vendors alphabetically.
 */
export function getVendorTemplateOptions(
  translateLabel: (english: string) => string,
): Array<VendorTemplateOption> {
  return [
    {
      label: translateLabel(MATCH_EACH_DEVICE_LABEL),
      value: MATCH_EACH_DEVICE_VALUE,
    },
    ...SnmpVendorTemplateUtil.getAll().map(
      (template: SnmpVendorTemplate): VendorTemplateOption => {
        // A product name, the same in every language.
        return { label: template.label, value: template.id };
      },
    ),
  ];
}

// The dropdown's value as a choice; null for a value no option has.
export function readVendorTemplateChoice(
  value: unknown,
): VendorTemplateChoice | null {
  const id: string = String(value ?? "").trim();

  if (!id) {
    return null;
  }

  if (id === MATCH_EACH_DEVICE_VALUE) {
    return { kind: VendorTemplateChoiceKind.MatchEachDevice };
  }

  const template: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.getById(id);

  return template
    ? { kind: VendorTemplateChoiceKind.Template, template: template }
    : null;
}

function isLinkedToOidTemplate(device: VendorTemplateDeviceFacts): boolean {
  const linked: unknown = device.oidTemplateId;

  if (!linked) {
    return false;
  }

  return String(linked).trim().length > 0;
}

export function decideVendorTemplate(
  device: VendorTemplateDeviceFacts,
  choice: VendorTemplateChoice,
): VendorTemplateDecision {
  if (
    NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
      device.monitoringMethod || undefined,
    )
  ) {
    return { kind: "skip", skip: VendorTemplateSkip.MonitorBacked };
  }

  if (isLinkedToOidTemplate(device)) {
    return { kind: "skip", skip: VendorTemplateSkip.LinkedToOidTemplate };
  }

  /*
   * The operator's own pick applies whatever the device reports: they know
   * their gear, and a device not walked yet still collects the template's
   * OIDs from the first walk its credentials allow.
   */
  if (choice.kind === VendorTemplateChoiceKind.Template) {
    return { kind: "apply", template: choice.template };
  }

  const sysObjectId: string = (device.sysObjectId || "").trim();

  if (!sysObjectId) {
    return { kind: "skip", skip: VendorTemplateSkip.NotIdentified };
  }

  // sysDescr too: Fabric Engine reports Extreme's 1916 exactly as EXOS does.
  const matched: SnmpVendorTemplate | undefined =
    SnmpVendorTemplateUtil.matchDevice({
      sysObjectId: sysObjectId,
      sysDescr: device.sysDescr || undefined,
    });

  if (!matched) {
    return { kind: "skip", skip: VendorTemplateSkip.NoMatchingTemplate };
  }

  return { kind: "apply", template: matched };
}

export interface VendorTemplateMerge {
  snmpOids: Array<SnmpOid>;
  snmpTables: Array<SnmpTableDefinition>;
  addedOidCount: number;
  addedTableCount: number;
}

/*
 * The device's lists with the template's added: its own entries first and
 * untouched, the template's after them, nothing twice (by OID, and by table
 * key). The counts say whether there is anything to write at all.
 */
export function mergeVendorTemplate(data: {
  snmpOids?: Array<SnmpOid> | null | undefined;
  snmpTables?: Array<SnmpTableDefinition> | null | undefined;
  template: SnmpVendorTemplate;
}): VendorTemplateMerge {
  const existingOids: Array<SnmpOid> = Array.isArray(data.snmpOids)
    ? data.snmpOids
    : [];
  const existingTables: Array<SnmpTableDefinition> = Array.isArray(
    data.snmpTables,
  )
    ? data.snmpTables
    : [];

  const snmpOids: Array<SnmpOid> = SnmpVendorTemplateUtil.mergeOids(
    existingOids,
    data.template.id,
  );
  const snmpTables: Array<SnmpTableDefinition> =
    SnmpVendorTemplateUtil.mergeTables(existingTables, data.template.id);

  return {
    snmpOids: snmpOids,
    snmpTables: snmpTables,
    addedOidCount: snmpOids.length - existingOids.length,
    addedTableCount: snmpTables.length - existingTables.length,
  };
}

export interface VendorTemplatePlanSummary {
  // Most devices first, then by label.
  applying: Array<{ template: SnmpVendorTemplate; deviceCount: number }>;
  // In VendorTemplateSkip order.
  skipped: Array<{ skip: VendorTemplateSkip; deviceCount: number }>;
}

const SKIP_ORDER: Array<VendorTemplateSkip> = [
  VendorTemplateSkip.NotIdentified,
  VendorTemplateSkip.NoMatchingTemplate,
  VendorTemplateSkip.LinkedToOidTemplate,
  VendorTemplateSkip.MonitorBacked,
];

/*
 * The dialog's preview: which template each selected device would get, and
 * how many are left as they are and why. Planned from the rows the operator
 * selected; the action re-decides every device from a fresh read.
 */
export function summarizeVendorTemplatePlan(
  devices: Array<VendorTemplateDeviceFacts>,
  choice: VendorTemplateChoice,
): VendorTemplatePlanSummary {
  const applyCounts: Map<
    string,
    { template: SnmpVendorTemplate; deviceCount: number }
  > = new Map();
  const skipCounts: Map<VendorTemplateSkip, number> = new Map();

  for (const device of devices) {
    const decision: VendorTemplateDecision = decideVendorTemplate(
      device,
      choice,
    );

    if (decision.kind === "apply") {
      const entry: { template: SnmpVendorTemplate; deviceCount: number } =
        applyCounts.get(decision.template.id) || {
          template: decision.template,
          deviceCount: 0,
        };
      entry.deviceCount += 1;
      applyCounts.set(decision.template.id, entry);
      continue;
    }

    skipCounts.set(decision.skip, (skipCounts.get(decision.skip) || 0) + 1);
  }

  const applying: Array<{ template: SnmpVendorTemplate; deviceCount: number }> =
    Array.from(applyCounts.values()).sort(
      (
        a: { template: SnmpVendorTemplate; deviceCount: number },
        b: { template: SnmpVendorTemplate; deviceCount: number },
      ): number => {
        if (a.deviceCount !== b.deviceCount) {
          return b.deviceCount - a.deviceCount;
        }

        return a.template.label.localeCompare(b.template.label);
      },
    );

  const skipped: Array<{ skip: VendorTemplateSkip; deviceCount: number }> =
    SKIP_ORDER.filter((skip: VendorTemplateSkip): boolean => {
      return (skipCounts.get(skip) || 0) > 0;
    }).map((skip: VendorTemplateSkip) => {
      return { skip: skip, deviceCount: skipCounts.get(skip) || 0 };
    });

  return { applying: applying, skipped: skipped };
}

// The generic template, named in the advice for a device nothing matches.
export function getGenericVendorTemplateLabel(): string {
  return (
    SnmpVendorTemplateUtil.getById("host-resources-mib")?.label ||
    "Generic (Host Resources MIB)"
  );
}
