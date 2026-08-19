import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const ServiceRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.Service}
    />
  );
};

export default ServiceRecommendations;
