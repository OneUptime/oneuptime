import PageComponentProps from "../PageComponentProps";
import RecommendationsPage from "../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Inventory > Managed Devices > Recommendations: the monitors OneUptime
 * recommends for one Esper connection's devices (#9835) - today Esper Device
 * Stopped Checking In, one alert per device that stops checking in. Opened
 * from the connection's row (Set up alerts); the connection is the route's
 * own record, as every resource's Recommendations page reads it.
 */
const ManagedDeviceConnectionRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <RecommendationsPage
      resourceType={
        MonitorRecommendationResourceType.DeviceManagementConnection
      }
    />
  );
};

export default ManagedDeviceConnectionRecommendations;
