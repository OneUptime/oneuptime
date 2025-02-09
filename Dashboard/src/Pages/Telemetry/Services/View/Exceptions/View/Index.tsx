import PageComponentProps from "../../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ExceptionExplorer from "../../../../../../Components/Exceptions/ExceptionExplorer";

const ServiceDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <Fragment>
      <ExceptionExplorer telemetryExceptionId={modelId} />
    </Fragment>
  );
};

export default ServiceDelete;
