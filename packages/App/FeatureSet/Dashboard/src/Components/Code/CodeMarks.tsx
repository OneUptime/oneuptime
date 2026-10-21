import React, { FunctionComponent, ReactElement } from "react";

/*
 * Marks drawn in place, like GitHubMark (no network font for one icon): a
 * git branch, where Code says which branch AI works from or on, and a pull
 * request, where a task or a repository counts its pull requests - so a
 * row that names its repository with the GitHub mark does not draw that
 * mark twice.
 */
export const GitBranchMark: FunctionComponent<{
  className?: string;
}> = (props: { className?: string }): ReactElement => {
  return (
    <svg
      className={props.className || "h-4 w-4"}
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-testid="code-branch-mark"
    >
      <path
        fillRule="evenodd"
        d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm.75 8.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"
      />
    </svg>
  );
};

export const GitPullRequestMark: FunctionComponent<{
  className?: string;
}> = (props: { className?: string }): ReactElement => {
  return (
    <svg
      className={props.className || "h-4 w-4"}
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-testid="code-pull-request-mark"
    >
      <path
        fillRule="evenodd"
        d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"
      />
    </svg>
  );
};
