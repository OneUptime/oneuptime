import ObjectID from "Common/Types/ObjectID";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * One inventory item, fetched with the full column set every detail tab needs.
 *
 * Each routed page loads the item for itself rather than relying on another
 * detail page to have rendered first. That buys independent addressability: a
 * bookmarked Logs or Metrics page works without the Overview page ever having
 * rendered. The rest of the product's detail pages make the same trade.
 */

export interface UseInventoryItemResult {
  item: InventoryItem | null;
  isLoading: boolean;
  error: string;
  /*
   * Reads the item again, quietly: the page stays as it is until the new
   * one lands - after Refresh, whose reading the server copies onto it.
   */
  reload?: (() => void) | undefined;
}

export type UseInventoryItemFunction = (
  modelId: ObjectID,
) => UseInventoryItemResult;

const useInventoryItem: UseInventoryItemFunction = (
  modelId: ObjectID,
): UseInventoryItemResult => {
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  // Bumped to read the item again without the page going back to loading.
  const [reloadKey, setReloadKey] = useState<number>(0);
  const loadedIdRef: MutableRefObject<string> = useRef<string>("");

  const modelIdString: string = modelId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;
    // A reload of the item on the page keeps it shown while it reads.
    const isQuiet: boolean = loadedIdRef.current === modelIdString;

    const load: () => Promise<void> = async (): Promise<void> => {
      if (!isQuiet) {
        setIsLoading(true);
        setError("");
      }

      try {
        const fetched: InventoryItem | null =
          await ModelAPI.getItem<InventoryItem>({
            modelType: InventoryItem,
            id: modelId,
            select: {
              _id: true,
              entityType: true,
              displayName: true,
              entityKey: true,
              source: true,
              description: true,
              labels: true,
              identifyingAttributes: true,
              descriptiveAttributes: true,
              resourceType: true,
              resourceId: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
          });

        /*
         * A response that lands after the id changed belongs to the previous
         * item; writing it would show the wrong thing under the right URL.
         */
        if (isCancelled) {
          return;
        }

        loadedIdRef.current = modelIdString;

        // A quiet reload that finds nothing keeps what the page shows.
        if (fetched || !isQuiet) {
          setItem(fetched);
        }
      } catch (err) {
        /*
         * A quiet reload that fails keeps what the page shows: the item is
         * still there, only its newest copy did not arrive.
         */
        if (isCancelled || isQuiet) {
          return;
        }

        setError(API.getFriendlyMessage(err));
      }

      if (!isCancelled) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, [modelIdString, reloadKey]);

  return {
    item,
    isLoading,
    error,
    reload: (): void => {
      setReloadKey((value: number): number => {
        return value + 1;
      });
    },
  };
};

export default useInventoryItem;
