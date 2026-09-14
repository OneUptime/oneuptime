import InventorySignalPage, {
  InventorySignalRenderProps,
} from "./InventorySignalPage";
import LogsViewer from "../../../Components/Logs/LogsViewer";
import PageComponentProps from "../../PageComponentProps";
import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import React, { FunctionComponent, ReactElement } from "react";

const InventoryItemLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <InventorySignalPage
      render={(signal: InventorySignalRenderProps): ReactElement => {
        return (
          <LogsViewer
            id={`inventory-item-logs-${signal.modelId.toString()}`}
            logQuery={
              {
                entityKeys: new Includes([signal.entityKey]),
              } as Query<Log>
            }
            showFilters={true}
            enableRealtime={true}
            noLogsMessage="No logs found for this inventory item."
          />
        );
      }}
    />
  );
};

export default InventoryItemLogs;
