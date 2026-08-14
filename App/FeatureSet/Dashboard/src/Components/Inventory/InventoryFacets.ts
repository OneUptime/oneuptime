import EntitySource from "Common/Types/Telemetry/EntitySource";
import IconProp from "Common/Types/Icon/IconProp";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";
import {
  DATE_FACET_OPERATORS,
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { defaultFacetQueryValue } from "../ResourceOwners/FacetColumnQuery";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
} from "./InventoryTypeCatalog";
import {
  INVENTORY_SOURCE_ORDER,
  InventorySourceDescriptor,
  getInventorySourceDescriptor,
} from "./InventorySource";

/*
 * The Inventory list's facet vocabulary.
 *
 * Kept separate from InventoryTable for two reasons. These keys and option
 * values are persisted in saved views and shared URLs, so changing one is a
 * compatibility decision rather than a presentation refactor. The module is
 * also React-free, which lets tests pin the exact query each chip produces.
 *
 * A scoped Inventory list can already own entityType, source or lastSeenAt in
 * its base query (Overview drill-downs do this). A facet must not write the
 * same field: ModelTable merges the two as one object, where the later value
 * would silently replace the page's scope. buildInventoryFacets therefore
 * omits only the dimensions the page has locked while leaving every other
 * chip available.
 */

export const INVENTORY_ITEMS_TABLE_ID: string = "inventory-items-table";
export const INVENTORY_ARCHIVED_TABLE_ID: string = "inventory-archived-table";

export const INVENTORY_TYPE_FACET_KEY: string = "inventoryType";
export const INVENTORY_SOURCE_FACET_KEY: string = "inventorySource";
export const INVENTORY_LAST_SEEN_FACET_KEY: string = "inventoryLastSeen";

export const INVENTORY_FACET_QUERY_FIELDS: {
  type: "entityType";
  source: "source";
  lastSeen: "lastSeenAt";
} = {
  type: "entityType",
  source: "source",
  lastSeen: "lastSeenAt",
};

const OPTION_OPERATORS: Array<FilterOperator> = ["is", "is_not"];

export const INVENTORY_TYPE_FACET_OPTIONS: Array<FilterChipDropdownOption> =
  INVENTORY_TYPE_DESCRIPTORS.map(
    (descriptor: InventoryTypeDescriptor): FilterChipDropdownOption => {
      return {
        value: descriptor.entityType,
        label: descriptor.label,
        sublabel: descriptor.description,
        icon: descriptor.icon,
        group: descriptor.category,
      };
    },
  );

export const INVENTORY_SOURCE_FACET_OPTIONS: Array<FilterChipDropdownOption> =
  INVENTORY_SOURCE_ORDER.map(
    (source: EntitySource): FilterChipDropdownOption => {
      const descriptor: InventorySourceDescriptor =
        getInventorySourceDescriptor(source)!;

      return {
        value: descriptor.source,
        label: descriptor.label,
        sublabel: descriptor.description,
      };
    },
  );

const buildMultiOptionQuery: (
  values: Array<string>,
  operator: FilterOperator,
) => unknown = (values: Array<string>, operator: FilterOperator): unknown => {
  return defaultFacetQueryValue(values, operator, true);
};

export const INVENTORY_BASE_FACETS: Array<ResourceFacet> = [
  {
    key: INVENTORY_TYPE_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.type,
    label: "Type",
    icon: IconProp.Cube,
    isMultiSelect: true,
    searchPlaceholder: "Search inventory types...",
    options: INVENTORY_TYPE_FACET_OPTIONS,
    supportedOperators: OPTION_OPERATORS,
    toQueryValue: buildMultiOptionQuery,
  },
  {
    key: INVENTORY_SOURCE_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.source,
    label: "Source",
    icon: IconProp.Activity,
    isMultiSelect: true,
    searchPlaceholder: "Search inventory sources...",
    options: INVENTORY_SOURCE_FACET_OPTIONS,
    supportedOperators: OPTION_OPERATORS,
    toQueryValue: buildMultiOptionQuery,
  },
  {
    key: INVENTORY_LAST_SEEN_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.lastSeen,
    label: "Last Seen",
    icon: IconProp.Clock,
    type: "dateRange",
    supportedOperators: DATE_FACET_OPERATORS,
  },
];

export interface InventoryFacetLockedQuery {
  entityType?: unknown;
  source?: unknown;
  lastSeenAt?: unknown;
  [key: string]: unknown;
}

export type BuildInventoryFacetsFunction = (
  lockedQuery?: InventoryFacetLockedQuery | undefined,
) => Array<ResourceFacet>;

/**
 * Return the facets that do not collide with a page-owned base constraint.
 * `hasOwnProperty` is deliberate: an inherited property is not a query the
 * page sent, and an explicitly present `undefined` still owns the field.
 */
export const buildInventoryFacets: BuildInventoryFacetsFunction = (
  lockedQuery: InventoryFacetLockedQuery = {},
): Array<ResourceFacet> => {
  return INVENTORY_BASE_FACETS.filter((facet: ResourceFacet): boolean => {
    const queryField: string = facet.queryField || facet.key;

    return !Object.prototype.hasOwnProperty.call(lockedQuery, queryField);
  });
};
