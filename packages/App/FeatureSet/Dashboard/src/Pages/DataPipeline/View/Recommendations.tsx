import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The pipeline's recommended monitors: a failed run, a run far longer than
 * usual, a pipeline that is late, and a pipeline its circuit breaker
 * stopped (#9683) (Common/Types/Monitor/DataPipelineAlertTemplates),
 * through the shared shell. Each one's alert goes to the pipeline's owners.
 */
const DataPipelineRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.DataPipeline}
    />
  );
};

export default DataPipelineRecommendations;
