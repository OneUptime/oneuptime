import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The pipeline's recommended monitors: a failed run, and a run far longer
 * than usual (Common/Types/Monitor/DataPipelineAlertTemplates), through the
 * shared shell.
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
