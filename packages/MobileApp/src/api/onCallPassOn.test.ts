import apiClient from "./client";
import {
  fetchOnCallPassOnPages,
  getOnCallPassOnPath,
  passOnOnCallPages,
  toOnCallPassOnAnswers,
  toOnCallPassOnPages,
} from "./onCallPassOn";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: { pages: [] } };
      }),
      post: jest.fn(async () => {
        return { data: { answers: [] } };
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
 * "Escalate" asks the server two things about one record: is the signed-in
 * person being paged about it (GET), and escalate it (POST) - at the route
 * that keeps the action's first name, pass-on. Neither carries a user id -
 * the session is who escalates, so nobody can escalate somebody
 * else's page - and both are scoped to the record's project by the tenant
 * header, like every other request the app makes.
 */

const PREVIEW: Record<string, unknown> = {
  outcome: "NextRulePaged",
  isPreview: true,
  isDirectPage: false,
  policyName: "Payments",
  pagedNames: [],
  stillPagedNames: [],
  rule: { order: 2, name: "Level 2" },
  ruleCount: 3,
};

describe("the requests", () => {
  beforeEach(() => {
    getSpy().mockClear();
    postSpy().mockClear();
  });

  test("the route names the record's kind and id", () => {
    expect(getOnCallPassOnPath("incident", "incident-1")).toBe(
      "/api/on-call-page/pass-on/incident/incident-1",
    );
    expect(getOnCallPassOnPath("alert-episode", "a/b")).toBe(
      "/api/on-call-page/pass-on/alert-episode/a%2Fb",
    );
  });

  test("asking is a GET for the record, in its project, and nothing else", async () => {
    getSpy().mockResolvedValueOnce({
      data: {
        pages: [
          {
            executionLogId: "run-1",
            preview: PREVIEW,
            sentence:
              "This will immediately page Platform leads (Level 2 of 3), without waiting.",
          },
        ],
      },
    } as never);

    const pages: Awaited<ReturnType<typeof fetchOnCallPassOnPages>> =
      await fetchOnCallPassOnPages("project-1", "incident", "incident-1");

    expect(pages).toEqual([
      {
        executionLogId: "run-1",
        policyName: "Payments",
        sentence:
          "This will immediately page Platform leads (Level 2 of 3), without waiting.",
      },
    ]);

    const [url, config] = getSpy().mock.calls[0]! as [
      string,
      { headers: Record<string, string> },
    ];

    expect(url).toBe("/api/on-call-page/pass-on/incident/incident-1");
    expect(config.headers).toEqual({ tenantid: "project-1" });
  });

  test("passing on is a POST with an empty JSON body, in the record's project", async () => {
    postSpy().mockResolvedValueOnce({
      data: {
        answers: [
          {
            passedOn: true,
            result: { ...PREVIEW, isPreview: false },
            sentence:
              "The policy is now paging Platform leads (Level 2 of 3): Sam Lee.",
          },
        ],
      },
    } as never);

    const answers: Awaited<ReturnType<typeof passOnOnCallPages>> =
      await passOnOnCallPages("project-1", "alert", "alert-1");

    expect(answers).toEqual([
      {
        passedOn: true,
        policyName: "Payments",
        sentence:
          "The policy is now paging Platform leads (Level 2 of 3): Sam Lee.",
      },
    ]);

    const [url, body, config] = postSpy().mock.calls[0]! as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];

    expect(url).toBe("/api/on-call-page/pass-on/alert/alert-1");
    // The server answers 415 to a POST that is not JSON.
    expect(body).toEqual({});
    expect(config.headers).toEqual({ tenantid: "project-1" });
  });

  test("a failed request is an error, never 'not paged'", async () => {
    getSpy().mockRejectedValueOnce(new Error("Request failed with 500"));

    await expect(
      fetchOnCallPassOnPages("project-1", "incident", "incident-1"),
    ).rejects.toThrow("500");
  });
});

describe("reading the answers", () => {
  test("pages: malformed rows are left out, and a direct page has no policy", () => {
    expect(
      toOnCallPassOnPages({
        pages: [
          null,
          "page",
          { preview: PREVIEW },
          {
            executionLogId: "run-2",
            preview: { ...PREVIEW, policyName: "", isDirectPage: true },
            sentence:
              "  Nobody else is being paged: paging stops, and somebody needs to take it. ",
          },
        ],
      }),
    ).toEqual([
      {
        executionLogId: "run-2",
        policyName: "",
        sentence:
          "Nobody else is being paged: paging stops, and somebody needs to take it.",
      },
    ]);
  });

  test("pages: no list is no page", () => {
    expect(toOnCallPassOnPages(undefined)).toEqual([]);
    expect(toOnCallPassOnPages({ pages: "none" })).toEqual([]);
    expect(toOnCallPassOnPages([])).toEqual([]);
  });

  test("answers: only a true passedOn escalated it, and a refusal has no policy", () => {
    expect(
      toOnCallPassOnAnswers({
        answers: [
          { passedOn: "true", sentence: "x" },
          {
            passedOn: false,
            refusal: "RecordAcknowledged",
            sentence:
              "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
          },
          7,
        ],
      }),
    ).toEqual([
      { passedOn: false, policyName: "", sentence: "x" },
      {
        passedOn: false,
        policyName: "",
        sentence:
          "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
      },
    ]);
    expect(toOnCallPassOnAnswers({})).toEqual([]);
  });
});
