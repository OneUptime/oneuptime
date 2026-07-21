import TelemetryImprovementCard from "../../../Components/AI/TelemetryImprovementCard";
import TracesViewer from "../../../Components/Traces/TracesViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <TracesViewer primaryEntityId={modelId} />
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
