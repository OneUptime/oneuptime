import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Permission from "Common/Types/Permission";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";

export type MonitorIncompatibleBehaviorField =
  | "isExclusion"
  | "includePingOnlyHosts";

export function canSelectAutoImportMonitorTemplate(
  values: FormValues<NetworkDeviceAutoImportRule>,
): boolean {
  return !values.isExclusion && !values.includePingOnlyHosts;
}

function gateOptions(
  permissions?: Array<Permission>,
): PermissionGateOptions | undefined {
  return permissions ? { permissions } : undefined;
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
      gateOptions(permissions),
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
 * Whether the rule form can offer a template picker. Reading which template
 * a rule applies takes reading the rule, but the picker lists the project's
 * templates, which takes reading templates: offered to somebody who may not,
 * the list request is refused and the field cannot be filled. Without it they
 * keep the rest of the form - an inventory-only rule needs no template.
 */
export function canPickAutoImportMonitorTemplate(
  permissions?: Array<Permission>,
): boolean {
  return (
    PermissionGate.canReadColumn(
      new NetworkDeviceAutoImportRule(),
      "monitorTemplate",
      gateOptions(permissions),
    ) &&
    PermissionGate.check(
      new MonitorTemplate(),
      ModelAction.Read,
      gateOptions(permissions),
    ).isAllowed
  );
}

export function canPickAutoImportOidTemplate(
  permissions?: Array<Permission>,
): boolean {
  return (
    PermissionGate.canReadColumn(
      new NetworkDeviceAutoImportRule(),
      "oidTemplate",
      gateOptions(permissions),
    ) &&
    PermissionGate.check(
      new NetworkDeviceOidTemplate(),
      ModelAction.Read,
      gateOptions(permissions),
    ).isAllowed
  );
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
