import PageComponentProps from "../PageComponentProps";
import CloudTagsView from "../../Components/Cloud/CloudTagsView";
import CloudConnectCallout, {
  CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION,
} from "../../Components/Cloud/Connect/CloudConnectCallout";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Tags (#11012): the tags every resource of the connected accounts
 * must carry, how much of the spend and of the resources carry them, the
 * resources that lack one - the costliest first, with what to put there -
 * and the new resources found without them (CloudTagsView). Without an
 * account yet, the way to connect one.
 */
const CloudTags: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts();

  if (read.isLoading && read.accounts.length === 0) {
    return <PageSkeleton />;
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

  return <CloudTagsView projectId={projectId} accounts={read.accounts} />;
};

export default CloudTags;
