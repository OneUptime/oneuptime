import { useEffect, useState } from "react";
import ObjectID from "Common/Types/ObjectID";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayKindPage } from "Common/Types/StorageArray/StorageArrayPlatform";

/*
 * WHICH PLATFORM AN ARRAY'S PAGE SPEAKS FOR (#11122).
 *
 * A storage array's list pages (Volumes, Hosts, Replication, ...) say what
 * they list in its platform's words and draw its platform's columns
 * (StorageArrayPlatform.kindPages), so they read the array's
 * `storageSystem` first, and its `osName`, which names a deployment whose
 * hardware its vendor or cloud runs (Amazon FSx for NetApp ONTAP). Until
 * it arrives a page draws its skeleton: it never shows another platform's
 * words first.
 */

export interface StorageArrayPlatformState {
  isLoading: boolean;
  name: string | undefined;
  storageSystem: string | undefined;
  osName: string | undefined;
}

export function useStorageArrayPlatform(
  modelId: ObjectID,
): StorageArrayPlatformState {
  const [state, setState] = useState<StorageArrayPlatformState>({
    isLoading: true,
    name: undefined,
    storageSystem: undefined,
    osName: undefined,
  });

  useEffect(() => {
    let ignore: boolean = false;
    ModelAPI.getItem<StorageArray>({
      modelType: StorageArray,
      id: modelId,
      select: { name: true, storageSystem: true, osName: true },
    })
      .then((item: StorageArray | null): void => {
        if (ignore) {
          return;
        }
        setState({
          isLoading: false,
          name: item?.name || undefined,
          storageSystem: item?.storageSystem || undefined,
          osName: item?.osName || undefined,
        });
      })
      .catch((): void => {
        if (!ignore) {
          // The platform is supplementary: the page reads its own words.
          setState({
            isLoading: false,
            name: undefined,
            storageSystem: undefined,
            osName: undefined,
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [modelId.toString()]);

  return state;
}

// What a kind's pages say and draw on the array's platform, or null.
export function getKindPageFor(
  storageSystem: string | null | undefined,
  kind: string,
): StorageArrayKindPage | null {
  return StorageArrayPlatformRegistry.getKindPage(storageSystem, kind);
}
