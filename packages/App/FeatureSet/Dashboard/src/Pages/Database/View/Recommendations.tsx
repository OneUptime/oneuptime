import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The database's recommended monitors: the engine-aware Metrics monitor
 * library in Common/Types/Monitor/DatabaseAlertTemplates, narrowed to this
 * database's engine by the shared shell (see RecommendationResourceRegistry).
 */
const DatabaseServerRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.DatabaseServer}
    />
  );
};

export default DatabaseServerRecommendations;
