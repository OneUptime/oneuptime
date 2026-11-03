import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { useTableViewContext } from "./TableViewContext";
import DataAsset from "Common/Models/DatabaseModels/DataAsset";
import Route from "Common/Types/API/Route";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Deleting a table removes it with its timeline. A table still in its
 * database comes back at the next collection, with a fresh history; delete
 * one that is gone for good, or exclude it on its store, to keep it away.
 */
const TableDeletePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataAssetId, dataAsset } = useTableViewContext();

  return (
    <ModelDelete
      modelType={DataAsset}
      modelId={dataAssetId}
      {...(dataAsset?.assetKey ? { itemName: dataAsset.assetKey } : {})}
      onDeleteSuccess={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[
              dataAsset?.isDropped
                ? PageMap.DATA_OBSERVABILITY_TABLES_DROPPED
                : PageMap.DATA_OBSERVABILITY_TABLES
            ] as Route,
          ),
        );
      }}
    />
  );
};

export default TableDeletePage;
