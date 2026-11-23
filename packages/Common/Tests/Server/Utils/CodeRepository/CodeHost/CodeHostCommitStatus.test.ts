import { describe, expect, test } from "@jest/globals";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import GitLabApi from "../../../../../Server/Utils/CodeRepository/CodeHost/GitLabApi";
import { CodeHostHttpRequest } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { FakeCodeHost, fakeCodeHost, noWait } from "./FakeCodeHost";

/*
 * A PRODUCTION REVIEW'S COMMIT STATUS (#10376): on GitLab, Forgejo and
 * Gitea - which have no check run of OneUptime's - a repository that asks
 * its check to fail on a leak gets a status on the pull request's head
 * commit, named as GitHub's check is, failed or successful, linking to
 * the review. Against each host's API as its docs say it answers.
 */

const SHA: string = "0f1e2d3c4b5a69788796a5b4c3d2e1f009887766";
const REVIEW_URL: string =
  "https://oneuptime.com/dashboard/3ae4c1a8-7a8b-4c4e-9a52-1d2d5e0f6a11/code/tasks/7c1d2e3f-0000-4000-8000-000000000001";

function bodyOf(
  request: CodeHostHttpRequest | undefined,
): Record<string, unknown> {
  return JSON.parse(request?.body || "{}") as Record<string, unknown>;
}

describe("GitLab: a status on the merge request's head commit", () => {
  function gitLab(): { api: GitLabApi; host: FakeCodeHost } {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://gitlab.example.com/api/v4",
      routes: [
        {
          method: "POST",
          path: `/projects/4217/statuses/${SHA}`,
          answer: () => {
            return { status: 201, json: { id: 1, status: "failed" } };
          },
        },
      ],
    });

    return {
      api: new GitLabApi({
        hostUrl: "https://gitlab.example.com",
        token: "glpat-0123456789abcdefghij",
        transport: host.transport,
        backOff: noWait,
      }),
      host,
    };
  }

  test("failed, named as the check is, with the review as its link", async () => {
    const { api, host } = gitLab();

    await api.setCommitStatus({
      project: "4217",
      sha: SHA,
      state: "failed",
      name: "OneUptime production review",
      description: "Sensitive data in these changes fails this check",
      targetUrl: REVIEW_URL,
    });

    expect(host.requests).toHaveLength(1);
    expect(host.requests[0]!.method).toBe("POST");
    expect(bodyOf(host.requests[0])).toEqual({
      state: "failed",
      name: "OneUptime production review",
      description: "Sensitive data in these changes fails this check",
      target_url: REVIEW_URL,
    });
  });

  test("a name or description longer than GitLab keeps is cut to it", async () => {
    const { api, host } = gitLab();

    await api.setCommitStatus({
      project: "4217",
      sha: SHA,
      state: "success",
      name: "n".repeat(400),
      description: "d".repeat(400),
      targetUrl: REVIEW_URL,
    });

    expect((bodyOf(host.requests[0])["name"] as string).length).toBe(255);
    expect((bodyOf(host.requests[0])["description"] as string).length).toBe(
      255,
    );
  });
});

describe("Forgejo and Gitea: a status on the pull request's head commit", () => {
  test("failure, under the check's name as its context, with the review as its link", async () => {
    const host: FakeCodeHost = fakeCodeHost({
      apiBaseUrl: "https://codeberg.org/api/v1",
      routes: [
        {
          method: "POST",
          path: `/repos/acme/checkout/statuses/${SHA}`,
          answer: () => {
            return { status: 201, json: { id: 1, status: "failure" } };
          },
        },
      ],
    });
    const api: ForgejoApi = new ForgejoApi({
      hostUrl: "https://codeberg.org",
      token: "0123456789abcdef0123456789abcdef01234567",
      transport: host.transport,
      backOff: noWait,
      providerName: "Forgejo",
    });

    await api.setCommitStatus({
      owner: "acme",
      name: "checkout",
      sha: SHA,
      state: "failure",
      context: "OneUptime production review",
      description: "Sensitive data in these changes fails this check",
      targetUrl: REVIEW_URL,
    });

    expect(host.requests).toHaveLength(1);
    expect(bodyOf(host.requests[0])).toEqual({
      state: "failure",
      context: "OneUptime production review",
      description: "Sensitive data in these changes fails this check",
      target_url: REVIEW_URL,
    });
  });
});
