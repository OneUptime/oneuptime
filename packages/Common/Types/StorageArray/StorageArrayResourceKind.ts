import StorageSystem from "./StorageSystem";

/*
 * The kinds of object a storage array's inventory holds
 * (StorageArrayResource.kind), in singular PascalCase like CephResource's
 * `Osd` / `Pool`. Stored as plain strings, so adding a kind never needs a
 * migration.
 */
enum StorageArrayResourceKind {
  Volume = "Volume",
  Host = "Host",
  Pod = "Pod",
  Hardware = "Hardware",
  Drive = "Drive",
  Controller = "Controller",
  NetworkInterface = "NetworkInterface",
  Directory = "Directory",
  FileSystem = "FileSystem",
  Bucket = "Bucket",
}

const KINDS_BY_SYSTEM: Record<
  StorageSystem,
  Array<StorageArrayResourceKind>
> = {
  [StorageSystem.PureStorageFlashArray]: [
    StorageArrayResourceKind.Volume,
    StorageArrayResourceKind.Host,
    StorageArrayResourceKind.Pod,
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.Drive,
    StorageArrayResourceKind.Controller,
    StorageArrayResourceKind.NetworkInterface,
    StorageArrayResourceKind.Directory,
  ],
  [StorageSystem.PureStorageFlashBlade]: [
    StorageArrayResourceKind.Hardware,
    StorageArrayResourceKind.FileSystem,
    StorageArrayResourceKind.Bucket,
  ],
};

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
  public static getAllKinds(): Array<StorageArrayResourceKind> {
    return Object.values(StorageArrayResourceKind);
  }

  /*
   * The kinds a platform reports. An unknown system (an array discovered
   * with a `storage.system` OneUptime has no extractor for) reports none.
   */
  public static getKindsForSystem(
    system: string | null | undefined,
  ): Array<StorageArrayResourceKind> {
    if (!system) {
      return [];
    }
    return KINDS_BY_SYSTEM[system as StorageSystem] || [];
  }

  public static isKindForSystem(
    kind: StorageArrayResourceKind,
    system: string | null | undefined,
  ): boolean {
    return StorageArrayResourceKindUtil.getKindsForSystem(system).includes(
      kind,
    );
  }

  public static getSingularLabel(kind: StorageArrayResourceKind): string {
    return KIND_LABELS[kind].singular;
  }

  public static getPluralLabel(kind: StorageArrayResourceKind): string {
    return KIND_LABELS[kind].plural;
  }
}

export default StorageArrayResourceKind;
