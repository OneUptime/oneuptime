import MetricView from "../../../../../../Components/Metrics/MetricVIew";
import PageComponentProps from "../../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const MetricViewPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const metricName: string = Navigation.getLastParamAsString();
  const serviceId: ObjectID = Navigation.getLastParamAsObjectID(2);

  return <MetricView metricName={metricName} serviceId={serviceId} />;
};

export default MetricViewPage;
