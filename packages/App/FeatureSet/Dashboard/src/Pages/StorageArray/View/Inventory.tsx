import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import Select from "Common/Types/BaseDatabase/Select";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayKindDefinition,
  StorageArrayKindPage,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import { getStorageArrayKindColumns } from "../../../Components/StorageArray/StorageArrayKindView";
import { getStorageArrayInventoryPartRoute } from "../../../Components/StorageArray/Part/StorageArrayPartRoutes";
import StorageArrayResourceUtils, {
  INVENTORY_SELECT,
} from "../Utils/StorageArrayResourceUtils";
import {
  StorageArrayPlatformState,
  getKindPageFor,
  useStorageArrayPlatform,
} from "../Utils/UseStorageArrayPlatform";

/*
 * The inventory of a kind a platform has of its own (#11000) - a NetApp
 * cluster's aggregates, SVMs, LUNs or SnapMirror relationships - which no
 * page of its own lists: the kind is the route's last segment, and its
 * words are its platform's (StorageArrayPlatform.kindDefinitions).
 *
 * A platform that draws the kind itself (StorageArrayPlatform.kindPages,
 * #11122) chooses its columns - an aggregate's node and how full it is, a
 * relationship's lag behind its schedule - and, when it charts the kind's
 * parts, each name opens the part's own page (InventoryPart). Any other
 * kind shows what every object can report: its status, size, data
 * reduction, latest performance and when it was last seen.
 */

const NOTHING_HERE_YET: string = translationKey("Nothing here yet.");

const StorageArrayInventory: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const kind: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const platform: StorageArrayPlatformState = useStorageArrayPlatform(modelId);

  if (platform.isLoading) {
    return <PageSkeleton shape="table" />;
  }

  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind, platform.storageSystem);
  const page: StorageArrayKindPage | null = getKindPageFor(
    platform.storageSystem,
    kind,
  );
  const pluralName: string =
    definition?.pluralLabel || StorageArrayResourceKindUtil.getPluralLabel(kind);
  const singularName: string =
    definition?.singularLabel ||
    StorageArrayResourceKindUtil.getSingularLabel(kind);

  return (
    <StorageArrayResourceTable
      key={kind}
      storageArrayId={modelId}
      kind={kind}
      tableId={`storage-array-inventory-${kind.toLowerCase()}-table`}
      name={pluralName}
      singularName={singularName}
      pluralName={pluralName}
      title={pluralName}
      description={page?.description || definition?.description || ""}
      noItemsMessage={
        page?.noItemsMessage || definition?.noItemsMessage || NOTHING_HERE_YET
      }
      // What the platform's columns read is any of the row's values.
      {...(page?.columns
        ? {
            selectMoreFields:
              INVENTORY_SELECT as Select<StorageArrayResource>,
          }
        : {})}
      {...(page?.part
        ? {
            getDetailRoute: (item: StorageArrayResource): Route => {
              return getStorageArrayInventoryPartRoute({
                storageArrayId: modelId,
                kind: kind,
                externalId: item.externalId || "",
              });
            },
          }
        : {})}
      columns={
        page?.columns
          ? getStorageArrayKindColumns(page.columns)
          : [
              StorageArrayResourceColumns.getStatusColumn({
                title: "Status",
              }),
              StorageArrayResourceColumns.getProvisionedColumn(),
              StorageArrayResourceColumns.getPhysicalColumn(),
              StorageArrayResourceColumns.getDataReductionColumn(),
              ...StorageArrayResourceColumns.getPerformanceColumns(),
              StorageArrayResourceColumns.getLastSeenColumn(),
            ]
      }
    />
  );
};

export default StorageArrayInventory;
