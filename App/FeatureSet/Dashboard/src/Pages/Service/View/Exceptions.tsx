import ExceptionsViewer from "../../../Components/Exceptions/ExceptionsViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const ServiceExceptions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ExceptionsViewer serviceId={modelId} />
    </Fragment>
  );
};

export default ServiceExceptions;
