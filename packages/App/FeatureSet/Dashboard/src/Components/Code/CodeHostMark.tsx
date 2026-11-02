import { GitHubMark } from "./GitHubConnect";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  ForgejoServerProduct,
} from "Common/Types/CodeRepository/CodeHost";
import ProviderLogo from "Common/Types/ProviderLogo/ProviderLogo";
import { ProviderLogoMarkShapes } from "Common/Types/ProviderLogo/ProviderLogoMark";
import ForgejoShapes from "Common/Types/ProviderLogo/Marks/forgejo";
import GitShapes from "Common/Types/ProviderLogo/Marks/git";
import GiteaShapes from "Common/Types/ProviderLogo/Marks/gitea";
import GitLabShapes from "Common/Types/ProviderLogo/Marks/gitlab";
import ProviderLogoMarkSvg from "Common/UI/Components/ProviderLogo/ProviderLogoMarkSvg";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The marks of the places a repository can be hosted, drawn in place (no
 * network font or image for a few icons) and in the current text colour,
 * as GitHub's is: a repository's row, its page and the connect dialog show
 * where it lives at a glance. The shapes are the logo registry's
 * (Common/Types/ProviderLogo), the same every page draws.
 */

interface MarkProps {
  className?: string | undefined;
}

const markOf: (
  logo: ProviderLogo,
  shapes: ProviderLogoMarkShapes,
  displayName: string,
) => FunctionComponent<MarkProps> = (
  logo: ProviderLogo,
  shapes: ProviderLogoMarkShapes,
  displayName: string,
): FunctionComponent<MarkProps> => {
  const Mark: FunctionComponent<MarkProps> = (
    props: MarkProps,
  ): ReactElement => {
    return (
      <ProviderLogoMarkSvg
        mark={logo}
        shapes={shapes}
        className={props.className || "h-5 w-5"}
      />
    );
  };

  Mark.displayName = displayName;

  return Mark;
};

export const GitLabMark: FunctionComponent<MarkProps> = markOf(
  ProviderLogo.GitLab,
  GitLabShapes,
  "GitLabMark",
);
export const ForgejoMark: FunctionComponent<MarkProps> = markOf(
  ProviderLogo.Forgejo,
  ForgejoShapes,
  "ForgejoMark",
);
export const GiteaMark: FunctionComponent<MarkProps> = markOf(
  ProviderLogo.Gitea,
  GiteaShapes,
  "GiteaMark",
);
export const GitMark: FunctionComponent<MarkProps> = markOf(
  ProviderLogo.Git,
  GitShapes,
  "GitMark",
);

export const CODE_HOST_MARK_TEST_ID: string = "code-host-mark";

export interface ComponentProps {
  // Where the repository is hosted (CodeRepositoryType); unknown is GitHub.
  provider?: string | undefined;
  // For a Forgejo-family server: "Forgejo" or "Gitea".
  hostProduct?: string | undefined;
  className?: string | undefined;
}

/*
 * The mark of where a repository is hosted: GitHub's, GitLab's, Forgejo's
 * or Gitea's (as the server says it is), or Git's for any other server.
 */
const CodeHostMark: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const provider: CodeRepositoryType = CodeHost.readType(props.provider);

  let mark: ReactElement;

  switch (provider) {
    case CodeRepositoryType.GitLab:
      mark = <GitLabMark className={props.className} />;
      break;
    case CodeRepositoryType.Forgejo:
      mark =
        props.hostProduct === ForgejoServerProduct.Gitea ? (
          <GiteaMark className={props.className} />
        ) : (
          <ForgejoMark className={props.className} />
        );
      break;
    case CodeRepositoryType.Git:
      mark = <GitMark className={props.className} />;
      break;
    default:
      mark = <GitHubMark className={props.className} />;
  }

  return (
    <span
      data-testid={CODE_HOST_MARK_TEST_ID}
      data-provider={provider}
      className="contents"
    >
      {mark}
    </span>
  );
};

export default CodeHostMark;
