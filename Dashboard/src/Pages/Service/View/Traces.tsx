import TraceTable from "../../../Components/Traces/TraceTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";

const ServiceTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const spanQuery: Query<Span> = {
    serviceId: modelId,
  };

  return (
    <Fragment>
      <TraceTable
        spanQuery={spanQuery}
        noItemsMessage="No traces found for this service."
      />
    </Fragment>
  );
};

export default ServiceTraces;
