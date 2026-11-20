import PageComponentProps from "../PageComponentProps";
import RecommendationsPage from "../../Components/Recommendations/RecommendationsPage";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Inventory > Managed Devices > Recommendations: the monitors OneUptime
 * recommends for one device management connection and its devices - the
 * connection itself when it stops reading (#10006), then one alert per
 * device that stops checking in (#9835), runs low on battery, fills its
 * storage (#10008) or falls behind on security patches (#10098). Opened from
 * the connection's row (Set up alerts); the connection is the route's own
 * record, as every resource's Recommendations page reads it.
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
