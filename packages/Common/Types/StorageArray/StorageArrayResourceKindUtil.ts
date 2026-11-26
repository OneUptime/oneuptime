import StorageArrayResourceKind from "./StorageArrayResourceKind";
import {
  StorageArrayKindDefinition,
  StorageArrayPlatform,
} from "./StorageArrayPlatform";
import StorageArrayPlatformRegistry from "./StorageArrayPlatformRegistry";

/*
 * Which kinds of object a platform's inventory holds, and what each is
 * called. The kinds of a platform and the words of a kind only one platform
 * has come from StorageArrayPlatformRegistry; the shared kinds' words are
 * here.
 */
const KIND_LABELS: Record<
  StorageArrayResourceKind,
  { singular: string; plural: string }
> = {
  [StorageArrayResourceKind.Volume]: { singular: "Volume", plural: "Volumes" },
  [StorageArrayResourceKind.Host]: { singular: "Host", plural: "Hosts" },
  [StorageArrayResourceKind.Pod]: { singular: "Pod", plural: "Pods" },
  [StorageArrayResourceKind.Hardware]: {
    singular: "Hardware Component",
    plural: "Hardware Components",
  },
  [StorageArrayResourceKind.Drive]: { singular: "Drive", plural: "Drives" },
  [StorageArrayResourceKind.Controller]: {
    singular: "Controller",
    plural: "Controllers",
  },
  [StorageArrayResourceKind.NetworkInterface]: {
    singular: "Network Interface",
    plural: "Network Interfaces",
  },
  [StorageArrayResourceKind.Directory]: {
    singular: "Directory",
    plural: "Directories",
  },
  [StorageArrayResourceKind.FileSystem]: {
    singular: "File System",
    plural: "File Systems",
  },
  [StorageArrayResourceKind.Bucket]: { singular: "Bucket", plural: "Buckets" },
};

export class StorageArrayResourceKindUtil {
  // The kinds platforms share. A platform's own kinds are its own.
  public static getAllKinds(): Array<StorageArrayResourceKind> {
    return Object.values(StorageArrayResourceKind);
  }

  /*
   * The kinds a platform reports, in the order of its tabs. An unknown
   * system (an array discovered with a `storage.system` OneUptime has no
   * platform for) reports none. The registry matches the value exactly,
   * never by indexing an object with it: `storage.system` is
   * agent-supplied, and `constructor` must not find Object.prototype's.
   */
  public static getKindsForSystem(
    system: string | null | undefined,
  ): Array<StorageArrayResourceKind> {
    const platform: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(system);
    return platform
      ? ([...platform.kinds] as Array<StorageArrayResourceKind>)
      : [];
  }

  public static isKindForSystem(
    kind: StorageArrayResourceKind | string,
    system: string | null | undefined,
  ): boolean {
    return (
      StorageArrayResourceKindUtil.getKindsForSystem(system) as Array<string>
    ).includes(kind);
  }

  /*
   * `kind` is a plain string column, so a row written by a newer build (a
   * kind this one does not know) is shown under its raw kind rather than
   * crashing the page that renders it.
   */
  public static getSingularLabel(
    kind: StorageArrayResourceKind | string,
  ): string {
    return StorageArrayResourceKindUtil.getLabels(kind)?.singular || kind;
  }

  public static getPluralLabel(
    kind: StorageArrayResourceKind | string,
  ): string {
    return StorageArrayResourceKindUtil.getLabels(kind)?.plural || kind;
  }

  private static getLabels(
    kind: string,
  ): { singular: string; plural: string } | undefined {
    if (Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)) {
      return KIND_LABELS[kind as StorageArrayResourceKind];
    }
    const definition: StorageArrayKindDefinition | null =
      StorageArrayPlatformRegistry.getKindDefinition(kind);
    if (definition) {
      return {
        singular: definition.singularLabel,
        plural: definition.pluralLabel,
      };
    }
    return undefined;
  }
}

export default StorageArrayResourceKindUtil;
