import { describe, expect, test } from "@jest/globals";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import {
  PULL_REQUEST_LINK_MAX_LENGTH,
  PullRequestLink,
  getPullRequestLinkName,
  getRepositoryAddressKey,
  parsePullRequestLink,
} from "../../../Types/CodeRepository/PullRequestLink";

/*
 * The address of a pull request a person pastes to link it (#10604): the
 * repository, the server and the number, read from its page's address as
 * GitHub, GitLab, Forgejo and Gitea write one - with whatever follows the
 * number left off, and a scheme added when it was left out.
 */

describe("a pull request's address", () => {
  test("GitHub's", () => {
    expect(
      parsePullRequestLink("https://github.com/acme/search/pull/482"),
    ).toEqual({
      type: CodeRepositoryType.GitHub,
      hostUrl: "https://github.com",
      owner: "acme",
      repository: "search",
      number: 482,
      url: "https://github.com/acme/search/pull/482",
      repositoryUrl: "https://github.com/acme/search",
    });
  });

  test("GitLab's merge request, a group's whole path its owner", () => {
    expect(
      parsePullRequestLink(
        "https://gitlab.com/acme/platform/search/-/merge_requests/17",
      ),
    ).toEqual({
      type: CodeRepositoryType.GitLab,
      hostUrl: "https://gitlab.com",
      owner: "acme/platform",
      repository: "search",
      number: 17,
      url: "https://gitlab.com/acme/platform/search/-/merge_requests/17",
      repositoryUrl: "https://gitlab.com/acme/platform/search",
    });
  });

  test("Forgejo's and Gitea's, on a server of the person's own", () => {
    expect(
      parsePullRequestLink("https://git.acme.internal:3000/acme/search/pulls/9"),
    ).toMatchObject({
      type: CodeRepositoryType.Forgejo,
      hostUrl: "https://git.acme.internal:3000",
      owner: "acme",
      repository: "search",
      number: 9,
      url: "https://git.acme.internal:3000/acme/search/pulls/9",
    });
  });

  test("whatever follows the number is left off: a tab, a query, a fragment", () => {
    for (const pasted of [
      "https://github.com/acme/search/pull/482/files",
      "https://github.com/acme/search/pull/482/commits?w=1",
      "https://github.com/acme/search/pull/482#issuecomment-1",
      "  https://github.com/acme/search/pull/482  ",
    ]) {
      expect(parsePullRequestLink(pasted)?.url).toBe(
        "https://github.com/acme/search/pull/482",
      );
    }

    expect(
      parsePullRequestLink(
        "https://gitlab.com/acme/search/-/merge_requests/17/diffs",
      )?.url,
    ).toBe("https://gitlab.com/acme/search/-/merge_requests/17");
  });

  test("a scheme left off is https; the host is read without its case", () => {
    expect(
      parsePullRequestLink("GitHub.com/acme/search/pull/482"),
    ).toMatchObject({
      hostUrl: "https://github.com",
      url: "https://github.com/acme/search/pull/482",
    });
  });

  test("anything that is not a pull request's page is none", () => {
    for (const pasted of [
      "",
      "   ",
      null,
      undefined,
      "not a link",
      "https://github.com/acme/search",
      "https://github.com/acme/search/issues/482",
      "https://github.com/acme/search/pull/",
      "https://github.com/acme/search/pull/abc",
      "https://github.com/acme/search/pull/0",
      "https://github.com/acme/search/pull/-4",
      "https://gitlab.com/-/merge_requests/17",
      "ftp://github.com/acme/search/pull/482",
      "https://user:secret@github.com/acme/search/pull/482",
      `https://github.com/acme/search/pull/${"9".repeat(12)}`,
      `https://github.com/${"a".repeat(PULL_REQUEST_LINK_MAX_LENGTH)}/s/pull/1`,
    ]) {
      expect({ pasted, link: parsePullRequestLink(pasted) }).toEqual({
        pasted,
        link: null,
      });
    }
  });

  test("named as a person names it: owner/repository#number", () => {
    const link: PullRequestLink = parsePullRequestLink(
      "https://gitlab.com/acme/platform/search/-/merge_requests/17",
    )!;

    expect(getPullRequestLinkName(link)).toBe("acme/platform/search#17");
  });
});

describe("a repository's page, held against another", () => {
  test("whatever its scheme, case, trailing slash or .git", () => {
    const key: string = getRepositoryAddressKey(
      "https://github.com/acme/search",
    );

    for (const same of [
      "http://github.com/acme/search",
      "https://GitHub.com/Acme/Search/",
      "https://github.com/acme/search.git",
      "https://github.com/acme/search.git/",
    ]) {
      expect(getRepositoryAddressKey(same)).toBe(key);
    }

    expect(getRepositoryAddressKey("https://github.com/acme/searcher")).not.toBe(
      key,
    );
  });
});
