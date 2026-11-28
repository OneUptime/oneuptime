import EntitySource from "Common/Types/Telemetry/EntitySource";
import IconProp from "Common/Types/Icon/IconProp";
import { InventoryLiveness } from "Common/Types/Telemetry/InventoryLiveness";
import { AndroidSecurityPatchStatus } from "Common/Types/Host/AndroidSecurityPatch";
import { AndroidAgentPermissionsStatus } from "Common/Types/Host/AndroidAgentPermissions";
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
// Types only: the facets stay free of the browser-bound API client, which the list hands in.
import type {
  InventoryPlacementChoice,
  InventoryPlacementOptionsRequest,
} from "./InventoryPlacementApi";
import {
  INVENTORY_PLACEMENT_LEVEL_COLUMNS,
  INVENTORY_PLACEMENT_LEVELS,
  InventoryPlacementLevel,
} from "Common/Utils/Inventory/InventoryItemPlacement";
import ObjectID from "Common/Types/ObjectID";
import {
  PluralTemplate,
  translatePlural,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The Inventory list's facet vocabulary.
 *
 * Kept separate from InventoryTable for two reasons. These keys and option
 * values are persisted in saved views and shared URLs, so changing one is a
 * compatibility decision rather than a presentation refactor. The module is
 * also React-free, which lets tests pin the exact query each chip produces.
 *
 * An embedded Inventory list can already own a facet's query field in
 * its base query. A facet must not write the
 * same field: ModelTable merges the two as one object, where the later value
 * would silently replace the page's scope. buildInventoryFacets therefore
 * omits only the dimensions the page has locked while leaving every other
 * chip available.
 */

export const INVENTORY_ITEMS_TABLE_ID: string = "inventory-items-table";
export const INVENTORY_ARCHIVED_TABLE_ID: string = "inventory-archived-table";

export const INVENTORY_TYPE_FACET_KEY: string = "inventoryType";
export const INVENTORY_SOURCE_FACET_KEY: string = "inventorySource";
export const INVENTORY_STATUS_FACET_KEY: string = "inventoryStatus";
export const INVENTORY_LAST_SEEN_FACET_KEY: string = "inventoryLastSeen";
export const INVENTORY_SECURITY_PATCH_FACET_KEY: string =
  "inventorySecurityPatch";
export const INVENTORY_AGENT_PERMISSIONS_FACET_KEY: string =
  "inventoryAgentPermissions";
export const INVENTORY_CLUSTER_FACET_KEY: string = "inventoryCluster";
export const INVENTORY_HOST_FACET_KEY: string = "inventoryHost";
export const INVENTORY_DATACENTER_FACET_KEY: string = "inventoryDatacenter";

export const INVENTORY_FACET_QUERY_FIELDS: {
  type: "entityType";
  source: "source";
  status: "inventoryStatus";
  lastSeen: "lastSeenAt";
  securityPatch: "securityPatchStatus";
  agentPermissions: "agentPermissionsStatus";
  cluster: "placementCluster";
  host: "placementHost";
  datacenter: "placementDatacenter";
} = {
  type: "entityType",
  source: "source",
  status: "inventoryStatus",
  lastSeen: "lastSeenAt",
  securityPatch: "securityPatchStatus",
  agentPermissions: "agentPermissionsStatus",
  cluster: INVENTORY_PLACEMENT_LEVEL_COLUMNS.cluster,
  host: INVENTORY_PLACEMENT_LEVEL_COLUMNS.host,
  datacenter: INVENTORY_PLACEMENT_LEVEL_COLUMNS.datacenter,
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

export const INVENTORY_STATUS_FACET_OPTIONS: Array<FilterChipDropdownOption> = [
  {
    value: InventoryLiveness.Live,
    label: "Live",
    sublabel: "Sending data right now.",
  },
  {
    value: InventoryLiveness.Recent,
    label: "Recent",
    sublabel: "Seen within the last day, but not in the last half hour.",
  },
  {
    value: InventoryLiveness.Stale,
    label: "Stale",
    sublabel: "No telemetry received for over a day.",
  },
  {
    value: InventoryLiveness.Never,
    label: "Never seen",
    sublabel: "Expected to report telemetry but has not been seen yet.",
  },
  {
    value: InventoryLiveness.NotTracked,
    label: "Not tracked",
    sublabel:
      "Mirrored or manually added items that do not report a heartbeat.",
  },
];

/*
 * Which Android devices are behind on their security patches (#9965): a
 * patch level more than 90 days old is out of date, as the Security Patch
 * Out of Date alert says (Common/Types/Host/AndroidSecurityPatch). Read
 * from the item's virtual securityPatchStatus, so a filtered page and its
 * count agree. Anything with no patch level is in neither.
 */
export const INVENTORY_SECURITY_PATCH_FACET_OPTIONS: Array<FilterChipDropdownOption> =
  [
    {
      value: AndroidSecurityPatchStatus.OutOfDate,
      label: "Out of Date",
      sublabel: "Its security patch level is more than 90 days old.",
    },
    {
      value: AndroidSecurityPatchStatus.UpToDate,
      label: "Up to Date",
      sublabel: "Its security patch level is 90 days old or newer.",
    },
  ];

/*
 * Which Android devices the OneUptime Android agent still lacks a grant on
 * (#9967): READ_LOGS, READ_DROPBOX_DATA or usage access, which only adb
 * grants, so a fleet's are run device by device. Read from the item's
 * virtual agentPermissionsStatus; anything the agent does not run on is in
 * neither.
 */
export const INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS: Array<FilterChipDropdownOption> =
  [
    {
      value: AndroidAgentPermissionsStatus.Missing,
      label: "Missing",
      sublabel:
        "The Android agent still needs READ_LOGS, READ_DROPBOX_DATA or usage access.",
    },
    {
      value: AndroidAgentPermissionsStatus.Granted,
      label: "All Granted",
      sublabel: "The Android agent reads every app's logs and crash stacks.",
    },
  ];

const buildMultiOptionQuery: (
  values: Array<string>,
  operator: FilterOperator,
) => unknown = (values: Array<string>, operator: FilterOperator): unknown => {
  return defaultFacetQueryValue(values, operator, true);
};

/*
 * WHERE AN ITEM SITS (#11470): the Cluster, Host and Datacenter chips -
 * every VM on esx-node-07, every host of cluster-alpha. Each offers the
 * places of its level the list's items are in, with how many items are
 * there, as the server counts them over the whole list (archived or not,
 * as the list is), narrowed on the server by what is typed. Each filters
 * on the item's placementCluster, placementHost or placementDatacenter,
 * which the server works out from its attributes as the list shows them
 * under its name (Common/Utils/Inventory/InventoryItemPlacement): a page,
 * its count and a choice's count agree however many items there are. A
 * place is a name, so a choice is what it reads.
 */
export interface InventoryPlacementFacetWords {
  key: string;
  label: string;
  icon: IconProp;
  searchPlaceholder: string;
}

export const INVENTORY_PLACEMENT_FACET_WORDS: Readonly<
  Record<InventoryPlacementLevel, InventoryPlacementFacetWords>
> = {
  [InventoryPlacementLevel.Cluster]: {
    key: INVENTORY_CLUSTER_FACET_KEY,
    label: "Cluster",
    icon: IconProp.RectangleStack,
    searchPlaceholder: "Search clusters...",
  },
  [InventoryPlacementLevel.Host]: {
    key: INVENTORY_HOST_FACET_KEY,
    label: "Host",
    icon: IconProp.Server,
    searchPlaceholder: "Search hosts...",
  },
  [InventoryPlacementLevel.Datacenter]: {
    key: INVENTORY_DATACENTER_FACET_KEY,
    label: "Datacenter",
    icon: IconProp.BuildingOffice,
    searchPlaceholder: "Search datacenters...",
  },
};

// Under each choice: how many of the list's items are there.
export const INVENTORY_PLACEMENT_ITEM_COUNT: PluralTemplate = {
  one: "{{count}} item",
  other: "{{count}} items",
};

export type InventoryPlacementOptionsLoader = (
  request: InventoryPlacementOptionsRequest,
) => Promise<Array<InventoryPlacementChoice>>;

export interface InventoryFacetsContext {
  // The Archived list's place chips offer the archived items' places.
  isArchived?: boolean | undefined;
  /*
   * Where the place chips' choices come from: the list hands in the
   * server's (fetchInventoryPlacementOptions). Without one a chip offers
   * none, and still filters by a choice a saved view or a link holds.
   */
  loadPlacementOptions?: InventoryPlacementOptionsLoader | undefined;
}

const NO_PLACEMENT_OPTIONS: InventoryPlacementOptionsLoader = async (): Promise<
  Array<InventoryPlacementChoice>
> => {
  return [];
};

export function toInventoryPlacementFacetOption(
  choice: InventoryPlacementChoice,
): FilterChipDropdownOption {
  return {
    value: choice.value,
    label: choice.value,
    sublabel: translatePlural(INVENTORY_PLACEMENT_ITEM_COUNT, choice.count),
  };
}

export function getInventoryPlacementFacet(
  level: InventoryPlacementLevel,
  context: InventoryFacetsContext = {},
): ResourceFacet {
  const words: InventoryPlacementFacetWords =
    INVENTORY_PLACEMENT_FACET_WORDS[level];
  const load: InventoryPlacementOptionsLoader =
    context.loadPlacementOptions || NO_PLACEMENT_OPTIONS;

  return {
    key: words.key,
    queryField: INVENTORY_PLACEMENT_LEVEL_COLUMNS[level],
    label: words.label,
    icon: words.icon,
    isMultiSelect: true,
    searchPlaceholder: words.searchPlaceholder,
    supportedOperators: OPTION_OPERATORS,
    loadOptions: async (
      _projectId: ObjectID,
      searchTerm: string,
    ): Promise<Array<FilterChipDropdownOption>> => {
      return (
        await load({
          level: level,
          search: searchTerm.trim(),
          isArchived: Boolean(context.isArchived),
        })
      ).map(toInventoryPlacementFacetOption);
    },
    // A place's name is its value: a saved choice reads as it was chosen.
    resolveOptions: async (
      _projectId: ObjectID,
      values: Array<string>,
    ): Promise<Array<FilterChipDropdownOption>> => {
      return values.map((value: string): FilterChipDropdownOption => {
        return { value: value, label: value };
      });
    },
    toQueryValue: buildMultiOptionQuery,
  };
}

export function getInventoryPlacementFacets(
  context: InventoryFacetsContext = {},
): Array<ResourceFacet> {
  return INVENTORY_PLACEMENT_LEVELS.map(
    (level: InventoryPlacementLevel): ResourceFacet => {
      return getInventoryPlacementFacet(level, context);
    },
  );
}

// What it is, where it came from and whether it is live, before where it sits.
const INVENTORY_LEADING_FACETS: Array<ResourceFacet> = [
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
    key: INVENTORY_STATUS_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.status,
    label: "Status",
    icon: IconProp.CheckCircle,
    isMultiSelect: true,
    searchPlaceholder: "Search inventory statuses...",
    options: INVENTORY_STATUS_FACET_OPTIONS,
    supportedOperators: OPTION_OPERATORS,
    toQueryValue: buildMultiOptionQuery,
  },
];

const INVENTORY_TRAILING_FACETS: Array<ResourceFacet> = [
  {
    key: INVENTORY_LAST_SEEN_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.lastSeen,
    label: "Last Seen",
    icon: IconProp.Clock,
    type: "dateRange",
    supportedOperators: DATE_FACET_OPERATORS,
  },
  {
    key: INVENTORY_SECURITY_PATCH_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.securityPatch,
    // The asset detail's own name (InventoryAssetLabels): one name for one thing.
    label: "Security Patch Level",
    icon: IconProp.ShieldCheck,
    isMultiSelect: true,
    searchPlaceholder: "Search security patch levels...",
    options: INVENTORY_SECURITY_PATCH_FACET_OPTIONS,
    supportedOperators: OPTION_OPERATORS,
    toQueryValue: buildMultiOptionQuery,
  },
  {
    key: INVENTORY_AGENT_PERMISSIONS_FACET_KEY,
    queryField: INVENTORY_FACET_QUERY_FIELDS.agentPermissions,
    label: "Agent Permissions",
    icon: IconProp.Lock,
    isMultiSelect: true,
    searchPlaceholder: "Search agent permissions...",
    options: INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS,
    supportedOperators: OPTION_OPERATORS,
    toQueryValue: buildMultiOptionQuery,
  },
];

function getInventoryFacets(
  context: InventoryFacetsContext,
): Array<ResourceFacet> {
  return [
    ...INVENTORY_LEADING_FACETS,
    ...getInventoryPlacementFacets(context),
    ...INVENTORY_TRAILING_FACETS,
  ];
}

export const INVENTORY_BASE_FACETS: Array<ResourceFacet> = getInventoryFacets(
  {},
);

export interface InventoryFacetLockedQuery {
  entityType?: unknown;
  source?: unknown;
  lastSeenAt?: unknown;
  inventoryStatus?: unknown;
  securityPatchStatus?: unknown;
  agentPermissionsStatus?: unknown;
  placementCluster?: unknown;
  placementHost?: unknown;
  placementDatacenter?: unknown;
  [key: string]: unknown;
}

export type BuildInventoryFacetsFunction = (
  lockedQuery?: InventoryFacetLockedQuery | undefined,
  context?: InventoryFacetsContext | undefined,
) => Array<ResourceFacet>;

/**
 * Return the facets that do not collide with a page-owned base constraint.
 * `hasOwnProperty` is deliberate: an inherited property is not a query the
 * page sent, and an explicitly present `undefined` still owns the field.
 */
export const buildInventoryFacets: BuildInventoryFacetsFunction = (
  lockedQuery: InventoryFacetLockedQuery = {},
  context: InventoryFacetsContext = {},
): Array<ResourceFacet> => {
  return getInventoryFacets(context).filter((facet: ResourceFacet): boolean => {
    const queryField: string = facet.queryField || facet.key;

    return !Object.prototype.hasOwnProperty.call(lockedQuery, queryField);
  });
};
