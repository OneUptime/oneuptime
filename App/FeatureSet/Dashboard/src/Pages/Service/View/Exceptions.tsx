import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceExceptions: FunctionComponent<
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
      <ExceptionsViewer
        primaryEntityId={modelId}
        scopeEntityType={ServiceType.OpenTelemetry}
      />
    </Fragment>
  );
};

export default ServiceExceptions;
