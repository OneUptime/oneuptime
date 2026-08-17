import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import { getInventoryDeleteCaveat } from "../../../Components/Inventory/InventorySource";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Deleting an inventory item.
 *
 * Whether that sticks depends entirely on where the row came from, so the
 * caveat for its source is shown before the button rather than left for the
 * user to discover when the row reappears an hour later. Manual rows have no
 * caveat — those really are gone.
 */
const InventoryItemDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  const caveat: string | null = getInventoryDeleteCaveat(item.source);

  return (
    <Fragment>
      {caveat ? (
        <Alert
          dataTestId="inventory-delete-caveat"
          type={AlertType.WARNING}
          strongTitle="This may not be permanent"
          title={caveat}
        />
      ) : null}

      <ModelDelete
        modelType={InventoryItem}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_ITEMS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default InventoryItemDelete;
