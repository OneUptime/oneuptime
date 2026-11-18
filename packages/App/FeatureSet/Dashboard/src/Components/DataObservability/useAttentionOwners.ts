import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import DataAssetOwnerTeam from "Common/Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "Common/Models/DatabaseModels/DataAssetOwnerUser";
import DataPipelineOwnerTeam from "Common/Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "Common/Models/DatabaseModels/DataPipelineOwnerUser";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataAttentionItem,
  getDataAttentionOwnerKey,
} from "Common/Types/DataObservability/DataObservabilityAttention";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Who owns each thing the Overview and Issues say needs someone: a table's
 * owners (and a check's, by its table), a pipeline's (#6551), and a data
 * product's. They are read through the ordinary routes, with the reader's
 * own permissions, so a person who may not see a table's owners sees no
 * names - and nothing is said of an item whose owners could not be read,
 * rather than "no owner".
 */

// The most owners of one kind read for one Overview.
const MAX_OWNERS_READ: number = 500;

export interface AttentionOwners {
  // By "asset:<id>", "pipeline:<id>" or "product:<id>"; an item missing here has no owner.
  byKey: Map<string, Array<ResourceOwnerEntry>>;
  // Whether the owners have been read: until then, and after a failed read, none are told of.
  isKnown: boolean;
}

// What an item's owners own: the same answer the server's Issues filter reads.
export function getAttentionOwnerKey(item: DataAttentionItem): string | null {
  return getDataAttentionOwnerKey(item);
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

// The ids of the items whose owners are of one kind ("asset", "pipeline", "product").
function idsOfKind(items: Array<DataAttentionItem>, kind: string): Array<string> {
  return Array.from(
    new Set(
      items
        .map((item: DataAttentionItem): string => {
          const key: string | null = getAttentionOwnerKey(item);
          return key && key.startsWith(`${kind}:`)
            ? key.slice(kind.length + 1)
            : "";
        })
        .filter(Boolean),
    ),
  );
}

export default function useAttentionOwners(
  items: Array<DataAttentionItem>,
): AttentionOwners {
  const [owners, setOwners] = useState<AttentionOwners>({
    byKey: new Map(),
    isKnown: false,
  });
  const assetIds: Array<string> = idsOfKind(items, "asset");
  const pipelineIds: Array<string> = idsOfKind(items, "pipeline");
  const productIds: Array<string> = idsOfKind(items, "product");
  const readKey: string = `${assetIds.join(",")}|${pipelineIds.join(",")}|${productIds.join(",")}`;

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      if (
        assetIds.length === 0 &&
        pipelineIds.length === 0 &&
        productIds.length === 0
      ) {
        setOwners({ byKey: new Map(), isKnown: true });
        return;
      }

      try {
        const [users, teams, pipelineUsers, pipelineTeams, products]: [
          ListResult<DataAssetOwnerUser> | null,
          ListResult<DataAssetOwnerTeam> | null,
          ListResult<DataPipelineOwnerUser> | null,
          ListResult<DataPipelineOwnerTeam> | null,
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
          pipelineIds.length > 0
            ? ModelAPI.getList<DataPipelineOwnerUser>({
                modelType: DataPipelineOwnerUser,
                query: { dataPipelineId: new Includes(pipelineIds) },
                select: {
                  dataPipelineId: true,
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
          pipelineIds.length > 0
            ? ModelAPI.getList<DataPipelineOwnerTeam>({
                modelType: DataPipelineOwnerTeam,
                query: { dataPipelineId: new Includes(pipelineIds) },
                select: {
                  dataPipelineId: true,
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

        for (const row of pipelineUsers?.data || []) {
          if (row.dataPipelineId && row.user) {
            push(byKey, `pipeline:${row.dataPipelineId.toString()}`, {
              kind: "user",
              user: row.user,
            });
          }
        }

        for (const row of pipelineTeams?.data || []) {
          if (row.dataPipelineId && row.team) {
            push(byKey, `pipeline:${row.dataPipelineId.toString()}`, {
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
