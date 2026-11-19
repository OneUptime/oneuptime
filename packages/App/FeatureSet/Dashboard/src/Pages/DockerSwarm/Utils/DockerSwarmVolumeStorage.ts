import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  formatStorageBytes,
  getStorageUsage,
  readStorageNumber,
} from "Common/Utils/Storage/StorageUsage";
import {
  InfrastructureResource,
  ResourceColumn,
  ResourceStorageUsageColumns,
} from "../../../Components/Infrastructure/ResourceTable";

/*
 * A SWARM VOLUME'S SIZE, AND THE DISK IT LIVES ON (#9648).
 *
 * A local volume has no size limit of its own: it grows until the disk
 * Docker keeps it on is full, and every local volume on the node shares
 * that disk. So a volume reads two things, both from the Swarm agent's
 * inventory (files 0.161.4 on): its own size, as Docker measures it
 * (/system/df), and how full that disk is (df on the poller's own volume,
 * which Docker keeps beside the others), drawn with the shared storage bar
 * at its default lines. A volume of another driver, or a local one mounted
 * from elsewhere (NFS, tmpfs), reports neither; an agent older than 0.161.4
 * reports neither for any volume. Each says so in words.
 */

export const DOCKER_SWARM_VOLUME_NOT_REPORTED: string =
  translationKey("Not reported");

export interface DockerSwarmVolumeStorage {
  // What the volume's files take, as Docker measured it.
  sizeBytes: number | null;
  // How full the disk it lives on is.
  disk: StorageUsage | null;
}

export function getDockerSwarmVolumeStorage(
  attributes: JSONObject | null | undefined,
): DockerSwarmVolumeStorage {
  const values: JSONObject = attributes || {};
  const size: number | null = readStorageNumber(
    values["sizeBytes"] as number | string | null | undefined,
  );
  return {
    sizeBytes: size !== null && size >= 0 ? size : null,
    disk: getStorageUsage({
      capacity: values["diskTotalBytes"] as number | string | null | undefined,
      available: values["diskAvailableBytes"] as
        | number
        | string
        | null
        | undefined,
    }),
  };
}

// A volume's row with its size and its disk, for the Volumes list's columns.
export function withDockerSwarmVolumeStorage(
  resource: InfrastructureResource,
  attributes: JSONObject | null | undefined,
): void {
  const storage: DockerSwarmVolumeStorage =
    getDockerSwarmVolumeStorage(attributes);
  if (storage.sizeBytes !== null) {
    resource.additionalAttributes["sizeBytes"] = String(storage.sizeBytes);
  }
  resource.storageUsage = {
    usage: storage.disk,
    noUsageText: DOCKER_SWARM_VOLUME_NOT_REPORTED,
  };
}

export const DOCKER_SWARM_VOLUME_SIZE_DESCRIPTION: string = translationKey(
  "Space the volume's files take, as Docker measures it, at most once an hour. Docker measures only local volumes.",
);

// The Volumes list's Size column, in the reader's digits ("10,4 MiB").
export function getDockerSwarmVolumeSizeColumn(
  language?: string | undefined,
): ResourceColumn {
  return {
    title: "Size",
    key: "sizeBytes",
    description: DOCKER_SWARM_VOLUME_SIZE_DESCRIPTION,
    getValue: (resource: InfrastructureResource): string => {
      const size: number | null = readStorageNumber(
        resource.additionalAttributes["sizeBytes"],
      );
      return size === null
        ? EMPTY_VALUE_MARK
        : formatStorageBytes(size, language);
    },
  };
}

export const DOCKER_SWARM_VOLUME_DISK_COLUMNS: ResourceStorageUsageColumns = {
  usedDescription: translationKey(
    "How full the disk Docker keeps the node's local volumes on is: they all share it. Amber at 80% and red at 90%.",
  ),
  disk: { title: "Disk" },
};
