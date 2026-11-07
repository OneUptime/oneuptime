import apiClient from "./client";
import {
  fetchOnCallObserverPages,
  getOnCallObserverPageSeenPath,
  markOnCallObserverPagesSeen,
  toOnCallObserverPages,
  toSeenCount,
} from "./onCallObserverPages";
import type { OnCallPageRecordType } from "./onCallPassOn";
import { describe, expect, test, beforeEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: { pages: [] } };
      }),
      post: jest.fn(async () => {
        return { data: { seen: 0 } };
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
 * "I've seen it" asks the server two things about one record: is the
 * signed-in person paged about it as an observer, with a page they can
 * still answer (GET), and say they have seen it (POST). Neither carries a
 * user id - the session is who answers, so nobody can answer somebody
 * else's page - and both are scoped to the record's project by the tenant
 * header, like every other request the app makes.
 */

describe("the requests", () => {
  beforeEach(() => {
    getSpy().mockClear();
    postSpy().mockClear();
  });

  test.each([
    ["incident", "/api/on-call-page/seen/incident/inc-1"],
    ["alert", "/api/on-call-page/seen/alert/inc-1"],
    ["incident-episode", "/api/on-call-page/seen/incident-episode/inc-1"],
    ["alert-episode", "/api/on-call-page/seen/alert-episode/inc-1"],
  ] as Array<[OnCallPageRecordType, string]>)(
    "the %s route names the record's kind and id",
    (recordType: OnCallPageRecordType, path: string) => {
      expect(getOnCallObserverPageSeenPath(recordType, "inc-1")).toBe(path);
    },
  );

  test("an id is never read as more of the path", () => {
    expect(getOnCallObserverPageSeenPath("incident", "a/../b?c")).toBe(
      "/api/on-call-page/seen/incident/a%2F..%2Fb%3Fc",
    );
  });

  test("asking is a GET for the record, in its project, and nothing else", async () => {
    getSpy().mockResolvedValueOnce({
      data: {
        pages: [{ executionLogId: "run-1", policyName: "Oversight" }],
      },
    } as never);

    await expect(
      fetchOnCallObserverPages("project-1", "incident", "inc-1"),
    ).resolves.toEqual([{ executionLogId: "run-1", policyName: "Oversight" }]);

    expect(getSpy()).toHaveBeenCalledTimes(1);
    expect(getSpy()).toHaveBeenCalledWith(
      "/api/on-call-page/seen/incident/inc-1",
      { headers: { tenantid: "project-1" } },
    );
    expect(postSpy()).not.toHaveBeenCalled();
  });

  test("saying so is a POST with an empty JSON body, in the record's project, answering how many", async () => {
    postSpy().mockResolvedValueOnce({ data: { seen: 1 } } as never);

    await expect(
      markOnCallObserverPagesSeen("project-1", "alert-episode", "ep-1"),
    ).resolves.toBe(1);

    expect(postSpy()).toHaveBeenCalledWith(
      "/api/on-call-page/seen/alert-episode/ep-1",
      {},
      { headers: { tenantid: "project-1" } },
    );
  });

  test("a failed request is an error - never 'no page' or 'seen' - so the screen can say the page goes on", async () => {
    getSpy().mockRejectedValueOnce(new Error("Network Error"));
    postSpy().mockRejectedValueOnce(new Error("Network Error"));

    await expect(
      fetchOnCallObserverPages("project-1", "incident", "inc-1"),
    ).rejects.toThrow("Network Error");
    await expect(
      markOnCallObserverPagesSeen("project-1", "incident", "inc-1"),
    ).rejects.toThrow("Network Error");
  });
});

describe("reading the answers", () => {
  test("pages: malformed rows are left out, and a direct page has no policy", () => {
    expect(
      toOnCallObserverPages({
        pages: [
          null,
          "page",
          { policyName: "No run" },
          { executionLogId: "run-1", policyName: "  Oversight  " },
          { executionLogId: "run-2" },
        ],
      }),
    ).toEqual([
      { executionLogId: "run-1", policyName: "Oversight" },
      { executionLogId: "run-2", policyName: "" },
    ]);
  });

  test("pages: no list is no page", () => {
    expect(toOnCallObserverPages(undefined)).toEqual([]);
    expect(toOnCallObserverPages({ pages: "none" })).toEqual([]);
    expect(toOnCallObserverPages([])).toEqual([]);
  });

  test("seen: a count of pages, and anything else is none", () => {
    expect(toSeenCount({ seen: 2 })).toBe(2);
    expect(toSeenCount({ seen: 1.7 })).toBe(1);
    expect(toSeenCount({ seen: 0 })).toBe(0);
    expect(toSeenCount({ seen: -3 })).toBe(0);
    expect(toSeenCount({ seen: "2" })).toBe(0);
    expect(toSeenCount({ seen: Number.NaN })).toBe(0);
    expect(toSeenCount({ seen: Number.POSITIVE_INFINITY })).toBe(0);
    // A page again's answer is not this one's.
    expect(toSeenCount({ acknowledged: 1 })).toBe(0);
    expect(toSeenCount(undefined)).toBe(0);
    expect(toSeenCount([2])).toBe(0);
  });
});
