import TelemetryImprovementCard from "../../../Components/AI/TelemetryImprovementCard";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      {/*
       * primaryEntityId is polymorphic; say this one is a Service id so the
       * viewer resolves its name with one targeted lookup instead of probing
       * every telemetry entity table.
       */}
      <TracesViewer
        primaryEntityId={modelId}
        scopeEntityType={ServiceType.OpenTelemetry}
      />
      <div className="mt-4">
        <TelemetryImprovementCard
          telemetryServiceId={modelId}
          taskType="ImproveTracing"
        />
      </div>
    </Fragment>
  );
};

export default ServiceTraces;
