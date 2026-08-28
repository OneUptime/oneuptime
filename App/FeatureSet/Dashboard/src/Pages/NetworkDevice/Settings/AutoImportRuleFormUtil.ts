import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import Permission from "Common/Types/Permission";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PermissionGate from "Common/UI/Utils/PermissionGate";

export type MonitorIncompatibleBehaviorField =
  | "isExclusion"
  | "includePingOnlyHosts";

export function canSelectAutoImportMonitorTemplate(
  values: FormValues<NetworkDeviceAutoImportRule>,
): boolean {
  return !values.isExclusion && !values.includePingOnlyHosts;
}

/*
 * Selecting an unreadable relation column fails the whole rule list request;
 * return no column for a granular rule-reader so the inventory-only page
 * remains usable. The optional permission set is a deterministic test seam.
 */
export function getReadableMonitorTemplateColumn(
  permissions?: Array<Permission>,
): Column<NetworkDeviceAutoImportRule> | null {
  if (
    !PermissionGate.canReadColumn(
      new NetworkDeviceAutoImportRule(),
      "monitorTemplate",
      permissions ? { permissions } : undefined,
    )
  ) {
    return null;
  }

  return {
    field: { monitorTemplate: { templateName: true } },
    title: "Monitor Template",
    type: FieldType.Entity,
  };
}

/*
 * Hidden form fields remain part of BasicForm's submitted value. Clear the
 * relation under both writable spellings when a behavior toggle makes
 * monitor provisioning invalid, including on edits where null (rather than
 * undefined) is what tells the API to remove a persisted relation.
 */
export function updateMonitorIncompatibleBehavior(
  currentValues: FormValues<NetworkDeviceAutoImportRule>,
  field: MonitorIncompatibleBehaviorField,
  value: boolean,
): FormValues<NetworkDeviceAutoImportRule> {
  const nextValues: FormValues<NetworkDeviceAutoImportRule> = {
    ...currentValues,
    [field]: value,
  };

  if (value) {
    nextValues.monitorTemplate = null;
    (nextValues as unknown as Record<string, unknown>)["monitorTemplateId"] =
      null;
  }

  return nextValues;
}
