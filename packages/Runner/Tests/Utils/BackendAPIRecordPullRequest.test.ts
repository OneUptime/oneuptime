/*
 * ---------------------------------------------------------------------------
 * BackendAPI.recordPullRequest: the record of a pull request the Runner has
 * already opened on GitHub.
 *
 * The record is what the open-PR cap counts and the PR state sync tracks, so
 * one lost to a deploy or a dropped connection is retried, with backoff, on
 * the failures a retry can fix (no answer, a 5xx, a 408/425/429) and never on
 * a refusal. The server records a pull request once, so a retry of a record
 * that landed — whose answer was the thing lost — makes no second row. How
 * API.post retries is pinned in Common's APIRetryPolicy tests; this file pins
 * that the record asks for it.
 * ---------------------------------------------------------------------------
 */

import BackendAPI, {
  RecordPullRequestOptions,
  RecordPullRequestResult,
} from "../../Utils/BackendAPI";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

interface PostCall {
  url: URL;
  data: JSONObject;
  options?: JSONObject;
}

const RECORD: RecordPullRequestOptions = {
  taskId: "6690e1f1e1f1e1f1e1f1e1f1",
  codeRepositoryId: "6650f0b1a1b2c3d4e5f60718",
  pullRequestUrl: "https://github.com/acme/checkout/pull/77",
  pullRequestNumber: 77,
  pullRequestId: 3456789012,
  title: "fix: guard the empty cart (#42)",
  description: "Closes #42",
  headRefName: "oneuptime/issue-42",
  baseRefName: "main",
  runnerVerificationStatus: "Passed",
  runnerVerificationSummary: "npm test passed",
};

function postCall(): PostCall {
  expect(postMock).toHaveBeenCalledTimes(1);

  return postMock.mock.calls[0]?.[0] as PostCall;
}

describe("BackendAPI.recordPullRequest", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { success: true, pullRequestId: "row-id" },
        {},
      ),
    );
  });

  test("retries with backoff, and only on failures a retry can fix", async () => {
    await new BackendAPI().recordPullRequest(RECORD);

    expect(postCall().options).toEqual({
      retries: 3,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
    });
  });

  test("sends the record to record-pull-request", async () => {
    await new BackendAPI().recordPullRequest(RECORD);

    expect(postCall().url.toString()).toContain(
      "/api/ai-agent-data/record-pull-request",
    );
    expect(postCall().data).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      ...RECORD,
    });
  });

  // The row the server answers with — the existing one on a retry.
  test("answers with the row the server recorded", async () => {
    const result: RecordPullRequestResult =
      await new BackendAPI().recordPullRequest(RECORD);

    expect(result).toEqual({ success: true, pullRequestId: "row-id" });
  });

  test("a record the server refused throws its reason", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Code repository not found" }, {}),
    );

    await expect(new BackendAPI().recordPullRequest(RECORD)).rejects.toThrow(
      "Code repository not found",
    );
  });

  // API.post throws once the retries are spent on a request that got no answer.
  test("a record that never got an answer throws", async () => {
    postMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(new BackendAPI().recordPullRequest(RECORD)).rejects.toThrow(
      "connect ECONNREFUSED",
    );
  });
});
