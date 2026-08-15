import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return <TracesViewer entityKeysFilter={[signal.entityKey]} />;
      }}
    />
  );
};

export default InventoryItemTraces;
