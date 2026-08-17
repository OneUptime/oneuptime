import useInventoryItem, {
  UseInventoryItemResult,
} from "../../../Components/Inventory/useInventoryItem";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface InventorySignalRenderProps {
  entityKey: string;
  item: InventoryItem;
  modelId: ObjectID;
}

export interface ComponentProps {
  render: (props: InventorySignalRenderProps) => ReactElement;
}

/*
 * Shared addressable-page shell for Inventory signals.
 *
 * Logs, traces, metrics, exceptions and profiles deliberately have separate
 * routes, matching the rest of OneUptime. They still need the exact same item
 * lookup and failure states, so keeping that plumbing here prevents one page
 * from silently treating a missing entity key differently from the others.
 */
const InventorySignalPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Every signal route ends in its signal name, so the item id is one back.
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

  return props.render({ entityKey: item.entityKey, item, modelId });
};

export default InventorySignalPage;
