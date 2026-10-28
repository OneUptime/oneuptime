import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import { TraceSpanType } from "Common/Types/Telemetry/TraceSpanType";
import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return (
          <TracesViewer
            entityKeysFilter={[signal.entityKey]}
            entityKeyDisplays={signal.entityKeyDisplays}
            /*
             * An inventory item can be anything spans touch - a database or a
             * queue their calls go to as well as a pod - so every span.
             */
            defaultSpanType={TraceSpanType.All}
          />
        );
      }}
    />
  );
};

export default InventoryItemTraces;
