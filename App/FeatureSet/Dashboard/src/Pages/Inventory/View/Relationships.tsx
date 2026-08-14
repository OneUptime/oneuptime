import PageComponentProps from "../../PageComponentProps";
import InventoryRelationships from "../../../Components/Inventory/InventoryRelationships";
import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const InventoryItemRelationships: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // `1` — the id is the second-to-last segment, before "relationships".
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { item, isLoading, error }: UseInventoryItemResult =
    useInventoryItem(modelId);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!item?.entityKey) {
    return <ErrorMessage message="This inventory item could not be found." />;
  }

  return (
    <Fragment>
      <InventoryRelationships entityKey={item.entityKey} />
    </Fragment>
  );
};

export default InventoryItemRelationships;
