import {
  DatabaseWorkloadTarget,
  getContainerDatabaseWorkloadNames,
  getContainerInventoryNames,
} from "./DatabaseWorkloadLookup";
import DockerResource from "Common/Models/DatabaseModels/DockerResource";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useMemo, useState } from "react";

/*
 * The "Open database" target of a Docker / Podman container page.
 *
 * Discovery classifies a container from its inventory row — DockerResource
 * / PodmanResource: name, image and LABELS — and names a Compose database
 * `${project}-${service}` from the labels. The page itself only knows the
 * container's name and, when a CPU point arrived in the last minutes, its
 * image, so without the row a Compose database (`shop-db`, run as
 * `shop-db-1`) is never found. This reads the row's labels and image — one
 * lean query — and hands them to the same classifier.
 *
 * Null (nothing asked yet) until the row has been read; a missing row or a
 * failed read (no permission on the inventory, say) falls back to what the
 * page knows, never to an error.
 */

export interface ContainerDatabaseWorkloadInput {
  platform: "docker" | "podman";
  // The Docker / Podman host.
  hostId: ObjectID;
  containerName: string;
  // The image the page read from the container's metrics, when it has one.
  imageName?: string | null | undefined;
}

interface ContainerInventory {
  labels: Record<string, unknown> | null;
  imageName: string | null;
}

const NO_INVENTORY: ContainerInventory = { labels: null, imageName: null };

function inventoryOf(
  row: DockerResource | PodmanResource | undefined,
): ContainerInventory {
  if (!row) {
    return NO_INVENTORY;
  }
  const labels: unknown = row.labels;
  return {
    labels:
      labels && typeof labels === "object" && !Array.isArray(labels)
        ? (labels as Record<string, unknown>)
        : null,
    imageName:
      typeof row.imageName === "string" && row.imageName.trim()
        ? row.imageName.trim()
        : null,
  };
}

async function fetchContainerInventory(data: {
  platform: "docker" | "podman";
  hostId: ObjectID;
  names: Array<string>;
}): Promise<ContainerInventory> {
  const name: string | Includes =
    data.names.length === 1 ? data.names[0]! : new Includes(data.names);

  if (data.platform === "docker") {
    const result: ListResult<DockerResource> =
      await ModelAPI.getList<DockerResource>({
        modelType: DockerResource,
        query: { dockerHostId: data.hostId, kind: "Container", name: name },
        select: { labels: true, imageName: true },
        sort: { lastSeenAt: SortOrder.Descending },
        skip: 0,
        limit: 1,
      });
    return inventoryOf(result.data?.[0]);
  }

  const result: ListResult<PodmanResource> =
    await ModelAPI.getList<PodmanResource>({
      modelType: PodmanResource,
      query: { podmanHostId: data.hostId, kind: "Container", name: name },
      select: { labels: true, imageName: true },
      sort: { lastSeenAt: SortOrder.Descending },
      skip: 0,
      limit: 1,
    });
  return inventoryOf(result.data?.[0]);
}

export default function useContainerDatabaseWorkloadTarget(
  input: ContainerDatabaseWorkloadInput,
): DatabaseWorkloadTarget | null {
  // Undefined while the row is being read.
  const [inventory, setInventory] = useState<ContainerInventory | undefined>(
    undefined,
  );
  const hostKey: string = input.hostId ? input.hostId.toString() : "";

  useEffect(() => {
    setInventory(undefined);
    const names: Array<string> = getContainerInventoryNames(
      input.containerName,
    );
    if (!hostKey || names.length === 0) {
      setInventory(NO_INVENTORY);
      return;
    }

    let ignore: boolean = false;

    // Everything inside the try: whatever goes wrong, the page still asks.
    const load: () => Promise<void> = async (): Promise<void> => {
      let found: ContainerInventory = NO_INVENTORY;
      try {
        found = await fetchContainerInventory({
          platform: input.platform,
          hostId: new ObjectID(hostKey),
          names: names,
        });
      } catch {
        // Best-effort: ask with what the page knows.
      }
      if (!ignore) {
        setInventory(found);
      }
    };

    load().catch((): void => {});

    return (): void => {
      ignore = true;
    };
  }, [input.platform, hostKey, input.containerName]);

  const pageImage: string = (input.imageName || "").trim();

  return useMemo((): DatabaseWorkloadTarget | null => {
    if (!inventory || !hostKey) {
      return null;
    }
    return {
      platform: input.platform,
      parentId: hostKey,
      workloadNames: getContainerDatabaseWorkloadNames({
        containerName: input.containerName,
        imageName: pageImage || inventory.imageName,
        labels: inventory.labels,
      }),
    };
  }, [inventory, input.platform, hostKey, input.containerName, pageImage]);
}
