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
        noLogsMessage="Logs appear here as soon as this service sends them."
      />
      {/*
       * Only when it can do something (AI on, a repository, no improvement
       * already on its way); it brings its own spacing, so nothing is left
       * behind when it is not shown.
       */}
      <TelemetryImprovementCard
        telemetryServiceId={modelId}
        taskType="ImproveLogging"
      />
    </Fragment>
  );
};

export default ServiceLogs;
