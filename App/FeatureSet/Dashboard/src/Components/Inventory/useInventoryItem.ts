import ObjectID from "Common/Types/ObjectID";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * One inventory item, fetched with the full column set every detail tab needs.
 *
 * Each tab loads the item for itself rather than having the layout thread it
 * down. That costs one extra read of a single narrow row (the layout loads it
 * too, to decide whether this item is editable), and buys independent
 * addressability: a bookmarked Telemetry tab has to work without the Overview
 * tab ever having rendered. The rest of the product's detail pages make the
 * same trade.
 */

export interface UseInventoryItemResult {
  item: InventoryItem | null;
  isLoading: boolean;
  error: string;
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

  const modelIdString: string = modelId.toString();

  useEffect(() => {
    let isCancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

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

        setItem(fetched);
      } catch (err) {
        if (isCancelled) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIdString]);

  return { item, isLoading, error };
};

export default useInventoryItem;
