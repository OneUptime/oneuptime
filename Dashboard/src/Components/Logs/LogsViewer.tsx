import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import React, { FunctionComponent, ReactElement } from "react";
import AdvancedLogViewer from "./AdvancedLogViewer/AdvancedLogViewer";

export interface ComponentProps {
  id: string;
  telemetryServiceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  limit?: number | undefined;
}


const DashboardLogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  

  return (
    <div id={props.id}>
      <AdvancedLogViewer
        id={props.id}
        telemetryServiceIds={props.telemetryServiceIds}
        enableRealtime={props.enableRealtime || false}
        traceIds={props.traceIds}
        spanIds={props.spanIds}
        showFilters={props.showFilters}
        noLogsMessage={props.noLogsMessage}
        logQuery={props.logQuery}
        limit={props.limit}
      />
    </div>
  );
};

export default DashboardLogsViewer;
