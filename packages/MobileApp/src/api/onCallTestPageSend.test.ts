import apiClient from "./client";
import {
  TEST_PAGE_SEND_PATH,
  fetchTestPageResult,
  fetchTestPageSeverity,
  getTestPageResultPath,
  isTestPageResultFinal,
  sendTestPageToMyself,
  toFirstSeverity,
  toTestPageResult,
} from "./onCallTestPageSend";
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return { data: {} };
      }),
      post: jest.fn(async () => {
        return { data: {} };
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
 * SEND YOURSELF A TEST PAGE, FROM THE APP (#7041): the severity it stands
 * in for, the send - to the signed-in person, no user id sent - and its
 * result, in the project named by the tenant header, as every request the
 * app makes.
 */

beforeEach(() => {
  getSpy().mockReset();
  postSpy().mockReset();
});

describe("the severity it stands in for", () => {
  test("the most severe incident severity: archived ones left out, most severe first", async () => {
    postSpy().mockResolvedValueOnce({
      data: { data: [{ _id: "sev-critical", name: "Critical" }] },
    } as never);

    await expect(fetchTestPageSeverity("project-1")).resolves.toEqual({
      recordKind: "Incident",
      severityId: "sev-critical",
      severityName: "Critical",
    });

    expect(postSpy()).toHaveBeenCalledTimes(1);
    expect(postSpy()).toHaveBeenCalledWith(
      "/api/incident-severity/get-list?skip=0&limit=1",
      {
        query: { isArchived: false },
        select: { _id: true, name: true },
        sort: { order: "ASC" },
      },
      { headers: { tenantid: "project-1" } },
    );
  });

  test("a project with no incident severities: its most severe alert severity", async () => {
    postSpy()
      .mockResolvedValueOnce({ data: { data: [] } } as never)
      .mockResolvedValueOnce({
        data: { data: [{ _id: { _type: "ObjectID", value: "sev-a" } }] },
      } as never);

    await expect(fetchTestPageSeverity("project-1")).resolves.toEqual({
      recordKind: "Alert",
      severityId: "sev-a",
      severityName: "",
    });
    expect(postSpy().mock.calls[1]![0]).toBe(
      "/api/alert-severity/get-list?skip=0&limit=1",
    );
  });

  test("neither: nothing to test", async () => {
    postSpy().mockResolvedValue({ data: { data: [] } } as never);

    await expect(fetchTestPageSeverity("project-1")).resolves.toBeNull();
  });

  test("an answer it cannot read names no severity", () => {
    expect(toFirstSeverity(null, "Incident")).toBeNull();
    expect(toFirstSeverity({ data: "nope" }, "Incident")).toBeNull();
    expect(
      toFirstSeverity({ data: [{ name: "No id" }] }, "Incident"),
    ).toBeNull();
  });
});

describe("the send", () => {
  test("is a POST of the kind and severity, in its project, with no user id: it is the caller's own", async () => {
    postSpy().mockResolvedValueOnce({
      data: { executionLogId: "run-1", pagedCount: 1 },
    } as never);

    await expect(
      sendTestPageToMyself("project-1", {
        recordKind: "Incident",
        severityId: "sev-critical",
        severityName: "Critical",
      }),
    ).resolves.toBe("run-1");

    expect(postSpy()).toHaveBeenCalledWith(
      TEST_PAGE_SEND_PATH,
      { recordKind: "Incident", severityId: "sev-critical" },
      { headers: { tenantid: "project-1" } },
    );
    expect(TEST_PAGE_SEND_PATH).toBe("/api/on-call-test-page/page-person");
  });

  test("an answer with no run to follow says so, never that it worked", async () => {
    postSpy().mockResolvedValueOnce({ data: {} } as never);

    await expect(
      sendTestPageToMyself("project-1", {
        recordKind: "Incident",
        severityId: "sev-critical",
        severityName: "Critical",
      }),
    ).rejects.toThrow("its result could not be read");
  });

  test("a refusal is thrown as the server gave it, for the screen to say", async () => {
    const refusal: Error = new Error("Request failed with status code 400");
    postSpy().mockRejectedValueOnce(refusal as never);

    await expect(
      sendTestPageToMyself("project-1", {
        recordKind: "Alert",
        severityId: "sev-a",
        severityName: "",
      }),
    ).rejects.toBe(refusal);
  });
});

describe("its result", () => {
  test("is a GET of the run, in its project", async () => {
    getSpy().mockResolvedValueOnce({
      data: {
        status: "Acknowledged",
        statusMessage:
          "Test page acknowledged by Ana Lopez by push notification after 9 seconds.",
      },
    } as never);

    await expect(fetchTestPageResult("project-1", "run-1")).resolves.toEqual({
      status: "Acknowledged",
      statusMessage:
        "Test page acknowledged by Ana Lopez by push notification after 9 seconds.",
    });
    expect(getSpy()).toHaveBeenCalledWith(
      "/api/on-call-test-page/result/run-1",
      { headers: { tenantid: "project-1" } },
    );
  });

  test("a run id is never read as more of the path", () => {
    expect(getTestPageResultPath("a/../b?c")).toBe(
      "/api/on-call-test-page/result/a%2F..%2Fb%3Fc",
    );
  });

  test("an answer it cannot read is still paging: it never says a test worked or ended that the server did not", () => {
    expect(toTestPageResult(null)).toEqual({
      status: "Paging",
      statusMessage: "",
    });
    expect(toTestPageResult({ status: "Done", statusMessage: 3 })).toEqual({
      status: "Paging",
      statusMessage: "",
    });
  });

  test("acknowledged, ended and failed change no more; paging does", () => {
    expect(isTestPageResultFinal({ status: "Paging", statusMessage: "" })).toBe(
      false,
    );

    for (const status of ["Acknowledged", "Ended", "Failed"] as const) {
      expect(isTestPageResultFinal({ status, statusMessage: "" })).toBe(true);
    }
  });
});
