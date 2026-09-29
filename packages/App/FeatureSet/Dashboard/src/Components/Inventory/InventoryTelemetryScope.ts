import { getInventoryTypeLabel } from "./InventoryTypeCatalog";
import {
  LockedEntityKeyDisplay,
  LockedEntityKeyDisplayMap,
} from "../../Utils/LockedEntityKeyChips";
import {
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
  MANUAL_ENTITY_IDENTITY_ATTRIBUTE,
  canonicalizeEntityValue,
} from "Common/Utils/Telemetry/EntityKey";

/*
 * How an Inventory item names itself on the locked pill of its telemetry
 * pages: its type as the chip key, its display name as the value —
 * "Kubernetes Pod: checkout-7d9f", the same shape a Kubernetes cluster's
 * pages use ("Cluster: prod").
 *
 * The pages filter by the item's entity key, a hash nobody can read, so the
 * key only becomes the chip's value when the item has no name. For the same
 * reason the pill's search syntax is spelled with the item's identifying
 * resource attributes, never with the key. Pure (the type catalog is plain
 * data), so the shell and its tests share it.
 */

/** The chip key when the item's type is missing. */
export const INVENTORY_ITEM_FALLBACK_DISPLAY_KEY: string = "Inventory Item";

/*
 * Identity attributes OneUptime mints for items that never flow through an
 * OTLP resource (hand-registered CIs, rows mirrored from inventory tables).
 * No telemetry row carries them, so a search on them would find nothing.
 */
const NON_TELEMETRY_IDENTITY_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  MANUAL_ENTITY_IDENTITY_ATTRIBUTE,
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
]);

/** The subset of an InventoryItem the pill reads. */
export interface InventoryEntityKeyDisplaySource {
  entityKey?: string | undefined;
  entityType?: string | undefined;
  displayName?: string | undefined;
  /*
   * The resource attributes the entity key was hashed from, as ingest
   * canonicalized them (trimmed, lowercased).
   */
  identifyingAttributes?: unknown;
  /*
   * Descriptive resource attributes in their original case — for a pod or a
   * node this includes the name its identity was built from.
   */
  descriptiveAttributes?: unknown;
}

type TrimmedTextFunction = (value: unknown) => string;

const trimmedText: TrimmedTextFunction = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

type IdentityValueTextFunction = (value: unknown) => string;

/*
 * Identity values are strings once ingest canonicalizes them; a number (a
 * process pid stored before that) still names the value unambiguously.
 */
const identityValueText: IdentityValueTextFunction = (
  value: unknown,
): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return trimmedText(value);
};

type BuildInventorySearchAttributesFunction = (
  item: InventoryEntityKeyDisplaySource,
) => Record<string, string> | undefined;

/**
 * The resource attributes an Inventory item's search syntax is spelled with:
 * every identifying attribute, so the search narrows to this entity the way
 * its key does (a pod is its cluster, namespace AND name — the name alone
 * would also match a same-named pod elsewhere).
 *
 * Ingest lowercases identity values before hashing them, while the explorers
 * match attribute values exactly. So a value is taken in its original case
 * from the descriptive attributes whenever they hold the same attribute with
 * the same canonical value (a pod's and a node's name); otherwise the
 * canonical value is the best the item knows.
 *
 * Undefined when there is nothing to spell: no identifying attributes, an
 * identity OneUptime minted outside telemetry, or any value that is empty —
 * leaving an attribute out would widen the search past the entity.
 */
export const buildInventorySearchAttributes: BuildInventorySearchAttributesFunction =
  (
    item: InventoryEntityKeyDisplaySource,
  ): Record<string, string> | undefined => {
    if (!isPlainObject(item.identifyingAttributes)) {
      return undefined;
    }

    const identifying: Record<string, unknown> = item.identifyingAttributes;
    const descriptive: Record<string, unknown> = isPlainObject(
      item.descriptiveAttributes,
    )
      ? item.descriptiveAttributes
      : {};

    const attributeKeys: Array<string> = Object.keys(identifying);

    if (attributeKeys.length === 0) {
      return undefined;
    }

    const searchAttributes: Record<string, string> = {};

    for (const rawKey of attributeKeys) {
      const attributeKey: string = rawKey.trim();

      if (
        attributeKey.length === 0 ||
        NON_TELEMETRY_IDENTITY_ATTRIBUTES.has(attributeKey)
      ) {
        return undefined;
      }

      const identityValue: string = identityValueText(identifying[rawKey]);

      if (identityValue.length === 0) {
        return undefined;
      }

      const originalCaseValue: string = Object.prototype.hasOwnProperty.call(
        descriptive,
        rawKey,
      )
        ? trimmedText(descriptive[rawKey])
        : "";

      const value: string =
        originalCaseValue.length > 0 &&
        canonicalizeEntityValue(originalCaseValue) ===
          canonicalizeEntityValue(identityValue)
          ? originalCaseValue
          : identityValue;

      /*
       * defineProperty rather than assignment: an attribute key of
       * `__proto__` must stay an own entry, not re-point the prototype.
       */
      Object.defineProperty(searchAttributes, attributeKey, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return searchAttributes;
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

    const display: LockedEntityKeyDisplay = {
      displayKey: entityType
        ? getInventoryTypeLabel(entityType)
        : INVENTORY_ITEM_FALLBACK_DISPLAY_KEY,
      displayValue: displayName || entityKey,
    };

    const searchAttributes: Record<string, string> | undefined =
      buildInventorySearchAttributes(item);

    if (searchAttributes) {
      display.searchAttributes = searchAttributes;
    }

    /*
     * A computed key in a literal is always an OWN property. Assigning
     * `displays[entityKey]` would instead re-point the object's prototype
     * for a key of `__proto__`, and the chip builder reads own entries only —
     * the pill would silently fall back to the raw key.
     */
    const displays: LockedEntityKeyDisplayMap = {
      [entityKey]: display,
    };

    return displays;
  };
