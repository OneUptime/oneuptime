import StorageArrayResourceKind from "./StorageArrayResourceKind";

export interface StorageArrayResourceKindLabels {
  singular: string;
  plural: string;
}

/*
 * THE WORDS OF THE KINDS PLATFORMS SHARE (StorageArrayResourceKind).
 *
 * StorageArrayResourceKindUtil words every kind: these, and a kind only one
 * platform has from StorageArrayPlatformRegistry. A reader that words only
 * the shared kinds reads them here, without the registry, which brings
 * every platform's metrics and alert templates with it: the dashboard's
 * storage array widgets, which a public dashboard loads before it draws,
 * name a hardware component, a drive and a controller (some 12 KiB gzipped
 * of its first load, packages/Common/Scripts/first-load-budgets.js).
 */
const SHARED_KIND_LABELS: Record<
  StorageArrayResourceKind,
  StorageArrayResourceKindLabels
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

/*
 * A shared kind's words, or undefined for any other kind. Only the list's
 * own kinds count: `kind` is a plain string column, and `constructor` must
 * not find Object.prototype's.
 */
export function getSharedKindLabels(
  kind: string,
): StorageArrayResourceKindLabels | undefined {
  if (!Object.prototype.hasOwnProperty.call(SHARED_KIND_LABELS, kind)) {
    return undefined;
  }
  return SHARED_KIND_LABELS[kind as StorageArrayResourceKind];
}
