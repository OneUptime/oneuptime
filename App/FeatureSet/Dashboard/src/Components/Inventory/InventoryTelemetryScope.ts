import { getInventoryTypeLabel } from "./InventoryTypeCatalog";
import { LockedEntityKeyDisplayMap } from "../../Utils/LockedEntityKeyChips";

/*
 * How an Inventory item names itself on the locked pill of its telemetry
 * pages: its type as the chip key, its display name as the value —
 * "Kubernetes Pod: checkout-7d9f", the same shape a Kubernetes cluster's
 * pages use ("Cluster: prod").
 *
 * The pages filter by the item's entity key, a hash nobody can read, so the
 * key only becomes the chip's value when the item has no name. Pure (the
 * type catalog is plain data), so the shell and its tests share it.
 */

/** The chip key when the item's type is missing. */
export const INVENTORY_ITEM_FALLBACK_DISPLAY_KEY: string = "Inventory Item";

/** The subset of an InventoryItem the pill reads. */
export interface InventoryEntityKeyDisplaySource {
  entityKey?: string | undefined;
  entityType?: string | undefined;
  displayName?: string | undefined;
}

type TrimmedTextFunction = (value: unknown) => string;

const trimmedText: TrimmedTextFunction = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

type BuildInventoryEntityKeyDisplaysFunction = (
  item: InventoryEntityKeyDisplaySource,
) => LockedEntityKeyDisplayMap;

/**
 * The display map every Inventory signal page hands its viewer, keyed by the
 * item's entity key; empty for an item without one (the shell refuses to
 * render a signal page for it anyway).
 */
export const buildInventoryEntityKeyDisplays: BuildInventoryEntityKeyDisplaysFunction =
  (item: InventoryEntityKeyDisplaySource): LockedEntityKeyDisplayMap => {
    const entityKey: string = trimmedText(item.entityKey);

    if (!entityKey) {
      return {};
    }

    const entityType: string = trimmedText(item.entityType);
    const displayName: string = trimmedText(item.displayName);

    /*
     * A computed key in a literal is always an OWN property. Assigning
     * `displays[entityKey]` would instead re-point the object's prototype
     * for a key of `__proto__`, and the chip builder reads own entries only —
     * the pill would silently fall back to the raw key.
     */
    const displays: LockedEntityKeyDisplayMap = {
      [entityKey]: {
        displayKey: entityType
          ? getInventoryTypeLabel(entityType)
          : INVENTORY_ITEM_FALLBACK_DISPLAY_KEY,
        displayValue: displayName || entityKey,
      },
    };

    return displays;
  };
