import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "Common/Types/StorageArray/StorageArrayResourceKindUtil";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayKindDefinition } from "Common/Types/StorageArray/StorageArrayPlatform";
import StorageArrayResourceTable from "../../../Components/StorageArray/StorageArrayResourceTable";
import StorageArrayResourceColumns from "../../../Components/StorageArray/StorageArrayResourceColumns";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";

/*
 * The inventory of a kind a platform has of its own (#11000) - a NetApp
 * array's aggregates or SVMs, say - which no page of its own lists: the
 * kind is the route's last segment, and its words are its platform's
 * (StorageArrayPlatform.kindDefinitions). Every object of every kind has
 * the same columns (StorageArrayResource), so the table shows what any of
 * them can report: its status, size, data reduction, latest performance
 * and when it was last seen. A kind that earns a page of its own (as
 * volumes and hosts have) gets one; this is where it starts.
 */
const StorageArrayInventory: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const kind: string = StorageArrayResourceUtils.externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind);
  const pluralName: string = StorageArrayResourceKindUtil.getPluralLabel(kind);

  return (
    <StorageArrayResourceTable
      key={kind}
      storageArrayId={modelId}
      kind={kind as StorageArrayResourceKind}
      tableId={`storage-array-inventory-${kind.toLowerCase()}-table`}
      name={pluralName}
      singularName={StorageArrayResourceKindUtil.getSingularLabel(kind)}
      pluralName={pluralName}
      title={pluralName}
      description={definition?.description || ""}
      noItemsMessage={definition?.noItemsMessage || "Nothing here yet."}
      columns={[
        StorageArrayResourceColumns.getStatusColumn({
          title: "Status",
        }),
        StorageArrayResourceColumns.getProvisionedColumn(),
        StorageArrayResourceColumns.getPhysicalColumn(),
        StorageArrayResourceColumns.getDataReductionColumn(),
        ...StorageArrayResourceColumns.getPerformanceColumns(),
        StorageArrayResourceColumns.getLastSeenColumn(),
      ]}
    />
  );
};

export default StorageArrayInventory;
