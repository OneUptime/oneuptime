import PageComponentProps from "../../../PageComponentProps";
import CloudCostsView from "../../../../Components/Cloud/CloudCostsView";
import CloudSavingsTable from "../../../../Components/Cloud/CloudSavingsTable";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../../../Components/Cloud/UseCloudAccounts";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Costs: what it costs from its cloud's own billing - the
 * month so far and where it is heading, each day of the last 30, where the
 * money goes - and the ways its cloud's recommender says it could spend
 * less, the largest first.
 */
const CloudAccountCosts: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts(modelId);

  if (read.isLoading && read.accounts.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  if (!projectId || read.accounts.length === 0) {
    return <ErrorMessage message="Cloud account not found." />;
  }

  return (
    <Fragment>
      <CloudCostsView
        projectId={projectId}
        accounts={read.accounts}
        cloudAccountId={modelId}
      />
      <CloudSavingsTable
        id="cloud-account-savings-table"
        cloudAccountId={modelId}
        currency={read.totals.costs.currency}
      />
    </Fragment>
  );
};

export default CloudAccountCosts;
