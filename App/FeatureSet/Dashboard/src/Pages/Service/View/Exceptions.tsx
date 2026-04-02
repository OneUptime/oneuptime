import ExceptionsTable from "../../../Components/Exceptions/ExceptionsTable";
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
      <ExceptionsTable
        serviceId={modelId}
        query={{}}
        title="Exceptions"
        description="All the exceptions for this service."
      />
    </Fragment>
  );
};

export default ServiceExceptions;
