import CodeRepositoryType from "./CodeRepositoryType";

/*
 * THE ADDRESS OF A PULL REQUEST A PERSON PASTES (#10604): which repository
 * it is in, on which server, and its number - read from its page's address
 * as each host writes one:
 *
 *   GitHub          https://github.com/acme/search/pull/482
 *   GitLab          https://gitlab.com/acme/platform/search/-/merge_requests/482
 *   Forgejo, Gitea  https://codeberg.org/acme/search/pulls/482
 *
 * with anything after the number - a tab ("/files"), a query, a fragment -
 * left off. A person's own pull request is linked to what it fixes by it -
 * a security case's Fix step (SecurityCasePullRequest) - and OneUptime
 * finds the repository the project connected under Code by the same
 * address (Server/Utils/CodeRepository/LinkedPullRequests).
 *
 * React-free and server-safe.
 */

export interface PullRequestLink {
  // Which kind of host the address is written for.
  type: CodeRepositoryType;
  // The server's address: "https://github.com".
  hostUrl: string;
  // The repository's owner - a GitLab group's whole path - and its name.
  owner: string;
  repository: string;
  number: number;
  // The pull request's page, with nothing after its number.
  url: string;
  // The repository's page: "https://github.com/acme/search".
  repositoryUrl: string;
}

// The longest address read, and the largest number taken as a pull request's.
export const PULL_REQUEST_LINK_MAX_LENGTH: number = 2000;
export const PULL_REQUEST_NUMBER_MAX: number = 2147483647;

// A pull request's number as its address writes it, and an address that names its scheme.
const NUMBER_TEXT: RegExp = /^[0-9]{1,10}$/;
const HAS_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

function readNumber(text: string | undefined): number | null {
  if (!text || !NUMBER_TEXT.test(text)) {
    return null;
  }

  const number: number = Number(text);

  return number > 0 && number <= PULL_REQUEST_NUMBER_MAX ? number : null;
}

/*
 * A pull request's address, as a person pastes it: its scheme may be left
 * off. Null for anything that is not a pull request's page.
 */
export function parsePullRequestLink(
  text: string | null | undefined,
): PullRequestLink | null {
  let address: string = (text || "").trim();

  if (!address || address.length > PULL_REQUEST_LINK_MAX_LENGTH) {
    return null;
  }

  if (!HAS_SCHEME.test(address)) {
    address = `https://${address}`;
  }

  let parsed: URL;

  try {
    parsed = new URL(address);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    return null;
  }

  const hostUrl: string = `${parsed.protocol}//${parsed.host}`.toLowerCase();
  const parts: Array<string> = parsed.pathname
    .split("/")
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .map((part: string): string => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  const page: (
    owner: string,
    repository: string,
    path: string,
  ) => {
    url: string;
    repositoryUrl: string;
  } = (
    owner: string,
    repository: string,
    path: string,
  ): { url: string; repositoryUrl: string } => {
    const repositoryUrl: string = `${hostUrl}/${owner
      .split("/")
      .map(encodeURIComponent)
      .join("/")}/${encodeURIComponent(repository)}`;

    return { url: `${repositoryUrl}/${path}`, repositoryUrl };
  };

  // GitLab: {group}/{subgroups...}/{project}/-/merge_requests/{number}
  const dash: number = parts.indexOf("-");

  if (dash >= 2 && parts[dash + 1] === "merge_requests") {
    const number: number | null = readNumber(parts[dash + 2]);

    if (number === null) {
      return null;
    }

    const owner: string = parts.slice(0, dash - 1).join("/");
    const repository: string = parts[dash - 1]!;

    return {
      type: CodeRepositoryType.GitLab,
      hostUrl,
      owner,
      repository,
      number,
      ...page(owner, repository, `-/merge_requests/${number}`),
    };
  }

  // GitHub: {owner}/{repository}/pull/{number}; Forgejo and Gitea: .../pulls/{number}.
  if (parts.length >= 4 && (parts[2] === "pull" || parts[2] === "pulls")) {
    const number: number | null = readNumber(parts[3]);

    if (number === null) {
      return null;
    }

    const owner: string = parts[0]!;
    const repository: string = parts[1]!;
    const isGitHub: boolean = parts[2] === "pull";

    return {
      type: isGitHub ? CodeRepositoryType.GitHub : CodeRepositoryType.Forgejo,
      hostUrl,
      owner,
      repository,
      number,
      ...page(owner, repository, `${parts[2]}/${number}`),
    };
  }

  return null;
}

// A repository's page, to hold against another: no scheme, no case, no ".git", no slash at the end.
export function getRepositoryAddressKey(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

// A pull request as a person names it: "acme/search#482".
export function getPullRequestLinkName(
  link: Pick<PullRequestLink, "owner" | "repository" | "number">,
): string {
  return `${link.owner}/${link.repository}#${link.number}`;
}
