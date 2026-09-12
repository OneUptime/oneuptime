import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemExceptions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return (
          <ExceptionsViewer
            entityKeysFilter={[signal.entityKey]}
            emptyMessage="No exceptions found for this inventory item."
          />
        );
      }}
    />
  );
};

export default InventoryItemExceptions;
