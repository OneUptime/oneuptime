import Link from "CommonUI/src/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import URL from "Common/Types/API/URL";

export interface ComponentProps {
  pullRequestId: string;
  repoType: CodeRepositoryType;
  organizationName: string;
  repositoryName: string;
}

const PullRequestViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.repoType === CodeRepositoryType.GitHub) {
    const to: URL = URL.fromString(
      `https://github.com/${props.organizationName}/${props.repositoryName}/pull/${props.pullRequestId}`,
    );
    return (
      <Link to={to} className="hover:underline" openInNewTab={true}>
        <>
          <span>#</span>
          {props.pullRequestId}
        </>
      </Link>
    );
  }

  return <></>;
};

export default PullRequestViewElement;
