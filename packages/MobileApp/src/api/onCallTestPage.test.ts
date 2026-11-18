import apiClient from "./client";
import {
  acknowledgeTestPage,
  fetchIsTestPageAcknowledged,
  getTestPageAcknowledgePath,
  toIsTestPageAcknowledged,
  toTestPageAnswer,
} from "./onCallTestPage";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: { isAcknowledged: false } };
      }),
      post: jest.fn(async () => {
        return { data: { answer: "Acknowledged" } };
      }),
    },
  };
});

function getSpy(): jest.SpyInstance {
  return apiClient.get as unknown as jest.SpyInstance;
}

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

/*
 * A test page answered from its push (#7014) asks the server two things
 * about one message: did the signed-in person acknowledge it already (GET),
 * and acknowledge it (POST). Neither carries a user id - the session is who
 * answers, so nobody can answer somebody else's test page - and both are
 * scoped to the push's project by the tenant header, like every other
 * request the app makes.
 */

describe("the requests", () => {
  beforeEach(() => {
    getSpy().mockClear();
    postSpy().mockClear();
  });

  test("the route names the message the push came from", () => {
    expect(getTestPageAcknowledgePath("message-1")).toBe(
      "/api/on-call-test-page/acknowledge/message-1",
    );
  });

  test("an id is never read as more of the path", () => {
    expect(getTestPageAcknowledgePath("a/../b?c")).toBe(
      "/api/on-call-test-page/acknowledge/a%2F..%2Fb%3Fc",
    );
  });

  test("asking is a GET for the message, in its project, and nothing else", async () => {
    getSpy().mockResolvedValueOnce({
      data: { isAcknowledged: true },
    } as never);

    await expect(
      fetchIsTestPageAcknowledged("project-1", "message-1"),
    ).resolves.toBe(true);

    expect(getSpy()).toHaveBeenCalledTimes(1);
    expect(getSpy()).toHaveBeenCalledWith(
      "/api/on-call-test-page/acknowledge/message-1",
      { headers: { tenantid: "project-1" } },
    );
    expect(postSpy()).not.toHaveBeenCalled();
  });

  test("acknowledging is a POST of an empty JSON object, in its project, and says what it did", async () => {
    postSpy().mockResolvedValueOnce({
      data: { answer: "AlreadyAcknowledged" },
    } as never);

    await expect(acknowledgeTestPage("project-1", "message-1")).resolves.toBe(
      "AlreadyAcknowledged",
    );

    expect(postSpy()).toHaveBeenCalledTimes(1);
    expect(postSpy()).toHaveBeenCalledWith(
      "/api/on-call-test-page/acknowledge/message-1",
      {},
      { headers: { tenantid: "project-1" } },
    );
  });

  test("a failed request fails: the screen says so, never that it works", async () => {
    postSpy().mockRejectedValueOnce(new Error("Network Error") as never);

    await expect(acknowledgeTestPage("project-1", "message-1")).rejects.toThrow(
      "Network Error",
    );
  });
});

describe("the answers", () => {
  test("each answer the server gives is read as it is", () => {
    for (const answer of [
      "Acknowledged",
      "AlreadyAcknowledged",
      "NotAcknowledged",
    ]) {
      expect(toTestPageAnswer({ answer })).toBe(answer);
    }
  });

  test("anything else is not acknowledged - the app never says a test works the server did not confirm", () => {
    for (const body of [
      null,
      undefined,
      "Acknowledged",
      [],
      {},
      { answer: "acknowledged" },
      { answer: true },
      { answer: { kind: "Acknowledged" } },
    ]) {
      expect(toTestPageAnswer(body)).toBe("NotAcknowledged");
    }
  });

  test("only a true isAcknowledged is acknowledged", () => {
    expect(toIsTestPageAcknowledged({ isAcknowledged: true })).toBe(true);

    for (const body of [
      null,
      {},
      { isAcknowledged: false },
      { isAcknowledged: "true" },
      { isAcknowledged: 1 },
      [true],
    ]) {
      expect(toIsTestPageAcknowledged(body)).toBe(false);
    }
  });
});
