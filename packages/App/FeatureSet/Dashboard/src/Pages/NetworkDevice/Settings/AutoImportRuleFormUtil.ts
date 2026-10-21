import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import Permission from "Common/Types/Permission";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PermissionGate from "Common/UI/Utils/PermissionGate";

/*
 * The one behaviour a monitor template cannot go with: an exclusion rule
 * imports nothing, so it has nothing to monitor.
 *
 * Ping-only hosts used to be the second. They imported as monitor-backed
 * devices that nothing polled, so a Network Device monitor on one had no
 * polls to read. They import as probe-polled devices now - the probe pings
 * them - and a template's reachability check reads that ping, so a rule
 * that includes them gets them monitored like any other device, exactly as
 * an import from Review Results does. (The server has allowed it since
 * ping-first polling; only this form still refused it.)
 */
export type MonitorIncompatibleBehaviorField = "isExclusion";

export function canSelectAutoImportMonitorTemplate(
  values: FormValues<NetworkDeviceAutoImportRule>,
): boolean {
  return !values.isExclusion;
}

/*
 * Selecting an unreadable relation column fails the whole rule list request,
 * so the column is asked for only when the user may read it. A rule's
 * template is read with the rule itself (the model's read list), so every
 * rule reader sees which template a rule applies; the template's name rides
 * along on the relation. The optional permission set is a deterministic test
 * seam.
 */
export function getReadableMonitorTemplateColumn(
  permissions?: Array<Permission>,
): Column<NetworkDeviceAutoImportRule> | null {
  if (
    !PermissionGate.canReadColumn(
      new NetworkDeviceAutoImportRule(),
      "monitorTemplate",
      { permissions },
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
