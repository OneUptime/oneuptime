import PageComponentProps from "../../../PageComponentProps";
import CloudAccountMonitorRecommendations from "../../../../Components/Recommendations/CloudAccountMonitorRecommendations";
import useCloudAccount, { CloudAccountRead } from "./UseCloudAccount";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Recommendations: the monitors OneUptime recommends for
 * every resource it holds, a row per recommendation of each resource type,
 * to add to one resource or to every resource of the type at once
 * (CloudAccountMonitorRecommendations). Its resources are read by its
 * cloud and its id there, as its Resources tab reads them.
 */
const CloudAccountRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const read: CloudAccountRead = useCloudAccount(modelId);

  if (read.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error || !read.account) {
    return <ErrorMessage message={read.error || "Cloud account not found."} />;
  }

  return (
    <CloudAccountMonitorRecommendations
      provider={(read.account.provider as string) || ""}
      cloudAccountId={(read.account.accountId as string) || ""}
    />
  );
};

export default CloudAccountRecommendations;
