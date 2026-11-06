import PageComponentProps from "../../PageComponentProps";
import CloudEnvironmentAppRecommendations from "../../../Components/Recommendations/CloudEnvironmentAppRecommendations";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An App Platforms environment's Recommendations: the monitors OneUptime
 * recommends for every app it runs, a row per recommendation, to add to one
 * app or to every app still without it at once
 * (CloudEnvironmentAppRecommendations) - as a cloud account's
 * Recommendations offer its resources'. Each app's own Recommendations tab
 * offers the same monitors one app at a time.
 */
const AppPlatformEnvironmentRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <CloudEnvironmentAppRecommendations environmentId={modelId} />;
};

export default AppPlatformEnvironmentRecommendations;
