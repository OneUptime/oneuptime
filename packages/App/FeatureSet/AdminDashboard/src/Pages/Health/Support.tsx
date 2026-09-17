import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import SupportBundle from "./SupportBundle";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthSupportBundle: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Support Bundle"
      currentRoute={RouteMap[PageMap.HEALTH_SUPPORT_BUNDLE] as Route}
    >
      <SupportBundle />
    </HealthPage>
  );
};

export default HealthSupportBundle;
