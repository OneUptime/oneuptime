import IconProp from "Common/Types/Icon/IconProp";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayKindDefinition } from "Common/Types/StorageArray/StorageArrayPlatform";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import PageMap from "../../../Utils/PageMap";

/*
 * HOW THE STORAGE ARRAY PAGES SPEAK OF EACH KIND OF OBJECT.
 *
 * A platform says which kinds it reports and where its Overview puts them
 * (StorageArrayPlatform.kinds and overview: its count chips, its inventory
 * tile, the kind its Slowest and Largest lists rank); the words are the
 * pages'. The kinds platforms share have theirs here; a kind only one
 * platform has brings its own (StorageArrayPlatform.kindDefinitions), so a
 * new platform's pages need no change here.
 */

export interface StorageArrayKindWords {
  // "{{count}} volume" / "{{count}} volumes".
  count: PluralTemplate;
  icon: IconProp;
}

// The Overview's last golden tile, for the kinds that can fill it.
export interface StorageArrayInventoryTileWords {
  title: string;
  description: string;
}

// The Overview's Slowest and Largest lists, for the kinds they can rank.
export interface StorageArrayTopListWords {
  slowestTitle: string;
  slowestDescription: string;
  slowestTooltip: string;
  largestTitle: string;
  largestDescription: string;
  largestTooltip: string;
  detailPageKey: PageMap;
}

const KIND_WORDS: Record<string, StorageArrayKindWords> = {
  [StorageArrayResourceKind.Volume]: {
    count: { one: "{{count}} volume", other: "{{count}} volumes" },
    icon: IconProp.Disc,
  },
  [StorageArrayResourceKind.Host]: {
    count: { one: "{{count}} host", other: "{{count}} hosts" },
    icon: IconProp.Server,
  },
  [StorageArrayResourceKind.Pod]: {
    count: { one: "{{count}} pod", other: "{{count}} pods" },
    icon: IconProp.Refresh,
  },
  [StorageArrayResourceKind.FileSystem]: {
    count: { one: "{{count}} file system", other: "{{count}} file systems" },
    icon: IconProp.Folder,
  },
  [StorageArrayResourceKind.Bucket]: {
    count: { one: "{{count}} bucket", other: "{{count}} buckets" },
    icon: IconProp.Archive,
  },
  [StorageArrayResourceKind.Hardware]: {
    count: {
      one: "{{count}} hardware component",
      other: "{{count}} hardware components",
    },
    icon: IconProp.CPUChip,
  },
};

const INVENTORY_TILE_WORDS: Record<string, StorageArrayInventoryTileWords> = {
  [StorageArrayResourceKind.Volume]: {
    title: "Volumes",
    description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumesTile,
  },
  [StorageArrayResourceKind.FileSystem]: {
    title: "File Systems",
    description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemsTile,
  },
};

const TOP_LIST_WORDS: Record<string, StorageArrayTopListWords> = {
  [StorageArrayResourceKind.Volume]: {
    slowestTitle: "Slowest Volumes",
    slowestDescription: "Volumes with the highest read or write latency.",
    slowestTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.slowestVolumes,
    largestTitle: "Largest Volumes",
    largestDescription: "Volumes using the most flash after data reduction.",
    largestTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.largestVolumes,
    detailPageKey: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
  },
  [StorageArrayResourceKind.FileSystem]: {
    slowestTitle: "Slowest File Systems",
    slowestDescription: "File systems with the highest read or write latency.",
    slowestTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.slowestFileSystems,
    largestTitle: "Largest File Systems",
    largestDescription: "File systems using the most flash.",
    largestTooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.largestFileSystems,
    detailPageKey: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
  },
};

function ownKey<T>(table: Record<string, T>, kind: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, kind)
    ? table[kind]
    : undefined;
}

/*
 * A kind's words: the shared kinds' from this table, a platform's own
 * kind's from its definition, and for a kind nobody describes, its label
 * as a plain count.
 */
export function getStorageArrayKindWords(kind: string): StorageArrayKindWords {
  const shared: StorageArrayKindWords | undefined = ownKey(KIND_WORDS, kind);
  if (shared) {
    return shared;
  }
  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind);
  if (definition) {
    return { count: definition.countLabel, icon: definition.icon };
  }
  const label: string = StorageArrayResourceKindUtil.getPluralLabel(kind);
  return {
    count: { one: `{{count}} ${label}`, other: `{{count}} ${label}` },
    icon: IconProp.Squares,
  };
}

export function getStorageArrayInventoryTileWords(
  kind: string,
): StorageArrayInventoryTileWords {
  return (
    ownKey(INVENTORY_TILE_WORDS, kind) || {
      title: StorageArrayResourceKindUtil.getPluralLabel(kind),
      description: STORAGE_ARRAY_METRIC_DESCRIPTIONS.inventoryCounts,
    }
  );
}

// Null for a kind the Overview has no ranked lists for.
export function getStorageArrayTopListWords(
  kind: string,
): StorageArrayTopListWords | null {
  return ownKey(TOP_LIST_WORDS, kind) || null;
}

/*
 * The count of a kind on an array: its countsByKind (#11000), or - for
 * the kinds that had a column of their own before it - that column, which
 * the ingest still fills.
 */
export function getStorageArrayKindCount(
  array: StorageArray,
  kind: string,
): number | undefined {
  const counts: Record<string, number> | undefined = array.countsByKind;
  if (
    counts &&
    Object.prototype.hasOwnProperty.call(counts, kind) &&
    typeof counts[kind] === "number"
  ) {
    return counts[kind];
  }
  switch (kind) {
    case StorageArrayResourceKind.Volume:
      return array.volumeCount;
    case StorageArrayResourceKind.Host:
      return array.hostCount;
    case StorageArrayResourceKind.Pod:
      return array.podCount;
    case StorageArrayResourceKind.FileSystem:
      return array.fileSystemCount;
    case StorageArrayResourceKind.Bucket:
      return array.bucketCount;
    case StorageArrayResourceKind.Hardware:
      return array.hardwareComponentCount;
    default:
      return undefined;
  }
}
