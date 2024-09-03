import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import URL from "Common/Types/API/URL";
import PullRequestStatusElement from "./PullRequestStatus";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";

export interface ComponentProps {
  pullRequestId: string;
  repoType: CodeRepositoryType;
  organizationName: string;
  repositoryName: string;
  pullRequestStatus: PullRequestState;
}

const PullRequestViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.repoType === CodeRepositoryType.GitHub) {
    const to: URL = URL.fromString(
      `https://github.com/${props.organizationName}/${props.repositoryName}/pull/${props.pullRequestId}`,
    );

    return (
      <div className="space-x-3 flex">
        <div>
          <PullRequestStatusElement
            pullRequestStatus={props.pullRequestStatus}
          />
        </div>
        <Link to={to} className="hover:underline" openInNewTab={true}>
          <>
            <span>#</span>
            {props.pullRequestId}
          </>
        </Link>
      </div>
    );
  }

  return <></>;
};

export default PullRequestViewElement;
