import PageComponentProps from "../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import RecommendationsPage from "../../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * The database's recommended monitors: the table-health library in
 * Common/Types/Monitor/DataObservabilityAlertTemplates - one Metrics monitor
 * per database, alerting once per table - through the shared shell, which
 * reads the database from Data Observability's own route (see
 * RecommendationResourceRegistry).
 */
const DataObservabilityStoreRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={MonitorRecommendationResourceType.DataStore}
    />
  );
};

export default DataObservabilityStoreRecommendations;
