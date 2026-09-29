import EntitySource from "Common/Types/Telemetry/EntitySource";

export interface InventorySettingsPolicy {
  isEditable: boolean;
  readOnlyExplanation: string | null;
}

export type GetInventorySettingsPolicyFunction = (
  source: string | undefined,
) => InventorySettingsPolicy;

/*
 * Inventory is only authoritative for rows a person registered here. Names
 * and descriptions on discovered and mirrored rows are copied from their
 * owning source and will be reconciled over any local write.
 */
export const getInventorySettingsPolicy: GetInventorySettingsPolicyFunction = (
  source: string | undefined,
): InventorySettingsPolicy => {
  if (source === EntitySource.Manual) {
    return {
      isEditable: true,
      readOnlyExplanation: null,
    };
  }

  if (source === EntitySource.Discovered) {
    return {
      isEditable: false,
      readOnlyExplanation:
        "This item was discovered from telemetry. Its emitting resource owns its name, description, type and identity. Update those resource attributes at the source; Inventory would overwrite a local edit during reconciliation.",
    };
  }

  if (source === EntitySource.Inventory) {
    return {
      isEditable: false,
      readOnlyExplanation:
        "This item is mirrored from another OneUptime resource. The original resource owns its name, description, type and identity. Edit that resource instead; Inventory would overwrite a local edit during reconciliation.",
    };
  }

  return {
    isEditable: false,
    readOnlyExplanation:
      "This item's source is not recognized by this version of OneUptime, so its name, description, type and identity are treated as source-owned and read-only.",
  };
};
