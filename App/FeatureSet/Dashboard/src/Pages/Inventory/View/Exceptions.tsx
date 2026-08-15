import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import ExceptionsTable from "../../../Components/Exceptions/ExceptionsTable";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemExceptions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return (
          <ExceptionsTable
            query={{}}
            title="Exceptions"
            description="Exception groups whose instances belong to this inventory item."
            entityKeys={[signal.entityKey]}
          />
        );
      }}
    />
  );
};

export default InventoryItemExceptions;
