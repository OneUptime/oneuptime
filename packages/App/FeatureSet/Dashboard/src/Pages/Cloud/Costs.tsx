import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CloudCostsView from "../../Components/Cloud/CloudCostsView";
import CloudConnectCallout, {
  CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION,
} from "../../Components/Cloud/Connect/CloudConnectCallout";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Costs: what every connected account costs, from each cloud's own
 * billing - the month so far and where it is heading, each day of the last
 * 30, and where the money goes by service, Region, account and resource
 * (CloudCostsView). Without an account yet, the way to connect one.
 */
const CloudCosts: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts();

  if (read.isLoading && read.accounts.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && read.accounts.length === 0) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  if (!projectId || read.accounts.length === 0) {
    return (
      <CloudConnectCallout
        description={CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION}
      />
    );
  }

  return (
    <CloudCostsView
      projectId={projectId}
      accounts={read.accounts}
      savingsRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_SAVINGS] as Route,
      )}
    />
  );
};

export default CloudCosts;
