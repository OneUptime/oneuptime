import TelemetryImprovementCard from "../../../Components/AI/TelemetryImprovementCard";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      {/*
       * primaryEntityId is polymorphic; say this one is a Service id so the
       * viewer resolves its name with one targeted lookup instead of probing
       * every telemetry entity table.
       */}
      <DashboardLogsViewer
        id="service-logs"
        serviceIds={[modelId]}
        scopeEntityType={ServiceType.OpenTelemetry}
        showFilters={true}
        enableRealtime={true}
        limit={100}
        noLogsMessage="No logs found for this service."
      />
      <div className="mt-4">
        <TelemetryImprovementCard
          telemetryServiceId={modelId}
          taskType="ImproveLogging"
        />
      </div>
    </Fragment>
  );
};

export default ServiceLogs;
