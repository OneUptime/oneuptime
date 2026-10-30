import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import { useDataStoreViewContext } from "./DataStoreViewContext";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Deleting a store removes it with what was found in it, who could reach it
 * and its issues. A store discovered from a cloud or from telemetry comes
 * back on the next discovery while it still exists there; a store added by
 * hand is gone for good.
 */
const DataStoreDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { dataStoreId, dataStore } = useDataStoreViewContext();

  return (
    <ModelDelete
      modelType={DataStore}
      modelId={dataStoreId}
      {...(dataStore?.name ? { itemName: dataStore.name } : {})}
      onDeleteSuccess={() => {
        // Back to the list the store was on.
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[
              dataStore?.isArchived
                ? PageMap.DATA_SECURITY_STORES_ARCHIVED
                : PageMap.DATA_SECURITY_STORES
            ] as Route,
          ),
        );
      }}
    />
  );
};

export default DataStoreDelete;
