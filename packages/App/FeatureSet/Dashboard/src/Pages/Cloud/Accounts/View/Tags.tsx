import PageComponentProps from "../../../PageComponentProps";
import CloudTagsView from "../../../../Components/Cloud/CloudTagsView";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../../../Components/Cloud/UseCloudAccounts";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Tags (#11012): its required tags - the project's and
 * its own - how much of its spend and of its resources carry them, its
 * resources that lack one, the costliest first, and its new resources
 * found without them, as Cloud > Tags shows them over every account.
 */
const CloudAccountTags: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts(modelId);

  if (read.isLoading && read.accounts.length === 0) {
    return <PageSkeleton />;
  }

  if (read.error) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  if (!projectId || read.accounts.length === 0) {
    return <ErrorMessage message="Cloud account not found." />;
  }

  return (
    <CloudTagsView
      projectId={projectId}
      accounts={read.accounts}
      cloudAccountId={modelId}
    />
  );
};

export default CloudAccountTags;
