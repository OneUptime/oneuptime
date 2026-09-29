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

  /*
   * `selectedProperty` is what makes this cell render the template's name.
   * The table derives its cell key from the first key of `field` alone, so
   * without it the key is the relation itself and both the cell and the CSV
   * exporter receive the MonitorTemplate object — the table stringifies it to
   * "[object Object]" and the exporter falls through to raw JSON. Naming the
   * property extends the key to "monitorTemplate.templateName", which both
   * resolve to the string. A `getElement` would only fix the cell: the
   * exporter never calls it, and it looks for display keys "name"/"title"/
   * "value", none of which is MonitorTemplate's `templateName`.
   */
  return {
    field: { monitorTemplate: { templateName: true } },
    title: "Monitor Template",
    type: FieldType.Entity,
    selectedProperty: "templateName",
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
