import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * A cloud resource's recommended monitors: the Metrics monitors in
 * Common/Types/Monitor/CloudAlertTemplates for its cloud and its type, over
 * the key metrics its connection reads, each filtered on the attributes the
 * resource's metrics are stored with. The shared shell reads the row and
 * narrows the list (see RecommendationResourceRegistry); every monitor it
 * creates is linked to this resource.
 */
const CloudResourceRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.CloudResource}
    />
  );
};

export default CloudResourceRecommendations;
