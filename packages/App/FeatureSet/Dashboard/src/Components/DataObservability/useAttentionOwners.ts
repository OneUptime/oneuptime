import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import DataAssetOwnerTeam from "Common/Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "Common/Models/DatabaseModels/DataAssetOwnerUser";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DataAttentionItem } from "Common/Types/DataObservability/DataObservabilityAttention";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Who owns each thing the Overview says needs someone: a table's owners
 * (and a check's, by its table), and a data product's. They are read
 * through the ordinary routes, with the reader's own permissions, so a
 * person who may not see a table's owners sees no names - and nothing is
 * said of an item whose owners could not be read, rather than "no owner".
 */

// The most owners of one kind read for one Overview.
const MAX_OWNERS_READ: number = 500;

export interface AttentionOwners {
  // By "asset:<id>" or "product:<id>"; an item missing here has no owner.
  byKey: Map<string, Array<ResourceOwnerEntry>>;
  // Whether the owners have been read: until then, and after a failed read, none are told of.
  isKnown: boolean;
}

export function getAttentionOwnerKey(item: DataAttentionItem): string | null {
  if (item.dataProductId) {
    return `product:${item.dataProductId}`;
  }

  return item.dataAssetId ? `asset:${item.dataAssetId}` : null;
}

function push(
  byKey: Map<string, Array<ResourceOwnerEntry>>,
  key: string,
  entry: ResourceOwnerEntry,
): void {
  const list: Array<ResourceOwnerEntry> = byKey.get(key) || [];
  list.push(entry);
  byKey.set(key, list);
}

export default function useAttentionOwners(
  items: Array<DataAttentionItem>,
): AttentionOwners {
  const [owners, setOwners] = useState<AttentionOwners>({
    byKey: new Map(),
    isKnown: false,
  });
  const assetIds: Array<string> = Array.from(
    new Set(
      items
        .filter((item: DataAttentionItem): boolean => {
          return !item.dataProductId && Boolean(item.dataAssetId);
        })
        .map((item: DataAttentionItem): string => {
          return item.dataAssetId!;
        }),
    ),
  );
  const productIds: Array<string> = Array.from(
    new Set(
      items
        .map((item: DataAttentionItem): string => {
          return item.dataProductId || "";
        })
        .filter(Boolean),
    ),
  );
  const readKey: string = `${assetIds.join(",")}|${productIds.join(",")}`;

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      if (assetIds.length === 0 && productIds.length === 0) {
        setOwners({ byKey: new Map(), isKnown: true });
        return;
      }

      try {
        const [users, teams, products]: [
          ListResult<DataAssetOwnerUser> | null,
          ListResult<DataAssetOwnerTeam> | null,
          ListResult<DataProduct> | null,
        ] = await Promise.all([
          assetIds.length > 0
            ? ModelAPI.getList<DataAssetOwnerUser>({
                modelType: DataAssetOwnerUser,
                query: { dataAssetId: new Includes(assetIds) },
                select: {
                  dataAssetId: true,
                  user: {
                    _id: true,
                    name: true,
                    email: true,
                    profilePictureId: true,
                  },
                },
                sort: { createdAt: SortOrder.Ascending },
                skip: 0,
                limit: MAX_OWNERS_READ,
              })
            : Promise.resolve(null),
          assetIds.length > 0
            ? ModelAPI.getList<DataAssetOwnerTeam>({
                modelType: DataAssetOwnerTeam,
                query: { dataAssetId: new Includes(assetIds) },
                select: {
                  dataAssetId: true,
                  team: { _id: true, name: true },
                },
                sort: { createdAt: SortOrder.Ascending },
                skip: 0,
                limit: MAX_OWNERS_READ,
              })
            : Promise.resolve(null),
          productIds.length > 0
            ? ModelAPI.getList<DataProduct>({
                modelType: DataProduct,
                query: { _id: new Includes(productIds) },
                select: {
                  _id: true,
                  ownerUser: {
                    _id: true,
                    name: true,
                    email: true,
                    profilePictureId: true,
                  },
                  ownerTeam: { _id: true, name: true },
                },
                sort: { createdAt: SortOrder.Ascending },
                skip: 0,
                limit: productIds.length,
              })
            : Promise.resolve(null),
        ]);
        const byKey: Map<string, Array<ResourceOwnerEntry>> = new Map();

        for (const row of users?.data || []) {
          if (row.dataAssetId && row.user) {
            push(byKey, `asset:${row.dataAssetId.toString()}`, {
              kind: "user",
              user: row.user,
            });
          }
        }

        for (const row of teams?.data || []) {
          if (row.dataAssetId && row.team) {
            push(byKey, `asset:${row.dataAssetId.toString()}`, {
              kind: "team",
              team: row.team,
            });
          }
        }

        for (const product of products?.data || []) {
          const key: string = `product:${product.id?.toString() || ""}`;

          if (product.ownerUser) {
            push(byKey, key, { kind: "user", user: product.ownerUser });
          }

          if (product.ownerTeam) {
            push(byKey, key, { kind: "team", team: product.ownerTeam });
          }
        }

        if (isCurrent) {
          setOwners({ byKey, isKnown: true });
        }
      } catch {
        // Owners are extra to the list: without them, it says nothing of who owns what.
        if (isCurrent) {
          setOwners({ byKey: new Map(), isKnown: false });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [readKey]);

  return owners;
}
