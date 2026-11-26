import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The monitors this pool should have and does not yet: the templates of
 * Common/Types/Monitor/XcpNgAlertTemplates.ts (a host offline or in
 * maintenance, a VM that stopped after running, a VM starved of CPU, a
 * storage repository filling up, the pool lost by Xen Orchestra), each one
 * click to create for this pool.
 */
const XcpNgPoolRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.XcpNg}
    />
  );
};

export default XcpNgPoolRecommendations;
