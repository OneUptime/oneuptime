import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return <MetricsViewer entityKeysFilter={[signal.entityKey]} />;
      }}
    />
  );
};

export default InventoryItemMetrics;
