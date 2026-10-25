import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import apiClient from "./client";
import {
  SECURITY_CASE_LIST_LIMIT,
  countSecurityCases,
  createSecurityCaseNote,
  decidePlaybookStep,
  fetchOpenSecurityCases,
  fetchSecurityCaseById,
  fetchSecurityCaseFeed,
  fetchSecurityCaseNotes,
  fetchSecurityCasePriorities,
  fetchSecurityCaseStatuses,
  fetchWaitingPlaybookRuns,
  toStatusIdsQuery,
  updateSecurityCase,
} from "./securityCases";
import type { ListResponse, SecurityCaseItem } from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      put: jest.fn(),
    },
  };
});

/*
 * Security cases at the boundary the type system cannot see: the URL, the
 * body and above all the headers. Every call names the selected project in a
 * `tenantid` header - a case is the investigation trail of a possible breach,
 * and one project's must never answer another project's screen - and goes
 * to the same CRUD and approval routes the dashboard uses, so the server
 * applies exactly the permissions it applies on the web.
 */

type Call = Array<unknown>;

const PROJECT_ID: string = "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0";
const CASE_ID: string = "5ec0ca5e-0142-4d1a-9a00-000000000142";
const RUN_ID: string = "7a6b0000-0001-4000-8000-000000000001";

function postMock(): jest.Mock {
  return apiClient.post as unknown as jest.Mock;
}

function putMock(): jest.Mock {
  return apiClient.put as unknown as jest.Mock;
}

function lastCall(mock: jest.Mock = postMock()): Call {
  const calls: Array<Call> = mock.mock.calls as Array<Call>;
  return calls[calls.length - 1]!;
}

function lastBody(mock: jest.Mock = postMock()): Record<string, unknown> {
  return lastCall(mock)[1] as Record<string, unknown>;
}

function respondWith(payload: unknown): void {
  postMock().mockResolvedValue({ data: payload } as never);
}

beforeEach(() => {
  postMock().mockReset();
  putMock().mockReset();
  respondWith({ data: [], count: 0 });
  putMock().mockResolvedValue({ data: {} } as never);
});

describe("every request names the selected project", () => {
  test.each([
    [
      "statuses",
      () => {
        return fetchSecurityCaseStatuses(PROJECT_ID);
      },
    ],
    [
      "priorities",
      () => {
        return fetchSecurityCasePriorities(PROJECT_ID);
      },
    ],
    [
      "a count",
      () => {
        return countSecurityCases(PROJECT_ID);
      },
    ],
    [
      "the open cases",
      () => {
        return fetchOpenSecurityCases(PROJECT_ID, ["s1"]);
      },
    ],
    [
      "one case",
      () => {
        return fetchSecurityCaseById(PROJECT_ID, CASE_ID);
      },
    ],
    [
      "the timeline",
      () => {
        return fetchSecurityCaseFeed(PROJECT_ID, CASE_ID);
      },
    ],
    [
      "the notes",
      () => {
        return fetchSecurityCaseNotes(PROJECT_ID, CASE_ID);
      },
    ],
    [
      "a note",
      () => {
        return createSecurityCaseNote(PROJECT_ID, CASE_ID, "Note");
      },
    ],
    [
      "the waiting runs",
      () => {
        return fetchWaitingPlaybookRuns(PROJECT_ID);
      },
    ],
    [
      "a decision",
      () => {
        return decidePlaybookStep(PROJECT_ID, RUN_ID, "approve");
      },
    ],
  ])("%s", async (_name: string, request: () => Promise<unknown>) => {
    await request();

    expect(lastCall()[2]).toEqual({ headers: { tenantid: PROJECT_ID } });
  });

  test("a change to the case too", async () => {
    await updateSecurityCase(PROJECT_ID, CASE_ID, {
      assignedToUserId: "someone",
    });

    expect(lastCall(putMock())[2]).toEqual({
      headers: { tenantid: PROJECT_ID },
    });
  });
});

describe("the project's statuses and priorities", () => {
  test("statuses come with their place, flags, archive and age, in order", async () => {
    await fetchSecurityCaseStatuses(PROJECT_ID);

    expect(lastCall()[0]).toBe(
      "/api/security-case-status/get-list?skip=0&limit=100",
    );
    expect(lastBody()).toEqual({
      query: {},
      select: {
        _id: true,
        name: true,
        color: true,
        order: true,
        createdAt: true,
        isArchived: true,
        isNewStatus: true,
        isAcknowledgedStatus: true,
        isContainedStatus: true,
        isClosedStatus: true,
      },
      sort: { order: "ASC" },
    });
  });

  test("priorities come with every built-in level's flag", async () => {
    await fetchSecurityCasePriorities(PROJECT_ID);

    expect(lastCall()[0]).toBe(
      "/api/security-case-priority/get-list?skip=0&limit=100",
    );
    expect(lastBody()["select"]).toEqual({
      _id: true,
      name: true,
      color: true,
      order: true,
      createdAt: true,
      isArchived: true,
      isCriticalPriority: true,
      isHighPriority: true,
      isMediumPriority: true,
      isLowPriority: true,
      isInformationalPriority: true,
    });
  });

  test("a response without rows reads as none, never as a crash", async () => {
    respondWith({});

    await expect(fetchSecurityCaseStatuses(PROJECT_ID)).resolves.toEqual([]);
    await expect(fetchSecurityCasePriorities(PROJECT_ID)).resolves.toEqual([]);
  });
});

describe("counting cases", () => {
  test("asks the count route, every case by default", async () => {
    respondWith({ count: 7 });

    await expect(countSecurityCases(PROJECT_ID)).resolves.toBe(7);
    expect(lastCall()[0]).toBe("/api/security-case/count");
    expect(lastBody()).toEqual({ query: {} });
  });

  test("with the query it is given: the open ones, by status", async () => {
    respondWith({ count: 3 });

    await countSecurityCases(PROJECT_ID, {
      securityCaseStatusId: toStatusIdsQuery(["s1", "s2"]),
    });

    expect(lastBody()).toEqual({
      query: {
        securityCaseStatusId: { _type: "Includes", value: ["s1", "s2"] },
      },
    });
  });

  test("a count that is not a number reads as none", async () => {
    respondWith({ count: "seven" });

    await expect(countSecurityCases(PROJECT_ID)).resolves.toBe(0);
  });

  test("a refusal reaches the caller, which tells it from an empty project", async () => {
    postMock().mockRejectedValue({
      isAxiosError: true,
      response: { status: 422 },
    } as never);

    await expect(countSecurityCases(PROJECT_ID)).rejects.toMatchObject({
      response: { status: 422 },
    });
  });
});

describe("the open cases", () => {
  test("are asked for by the project's open statuses, the latest detection first", async () => {
    await fetchOpenSecurityCases(PROJECT_ID, ["new", "investigating"]);

    expect(lastCall()[0]).toBe(
      `/api/security-case/get-list?skip=0&limit=${SECURITY_CASE_LIST_LIMIT}`,
    );
    expect(lastBody()["query"]).toEqual({
      securityCaseStatusId: {
        _type: "Includes",
        value: ["new", "investigating"],
      },
    });
    expect(lastBody()["sort"]).toEqual({ lastDetectedAt: "DESC" });
  });

  test("a project with no open status asks for nothing rather than everything", async () => {
    await fetchOpenSecurityCases(PROJECT_ID, []);

    expect(lastBody()["query"]).toEqual({
      securityCaseStatusId: { _type: "Includes", value: [] },
    });
  });

  test("read what a row draws, through relations the API lets a list read", async () => {
    await fetchOpenSecurityCases(PROJECT_ID, ["new"]);

    expect(lastBody()["select"]).toEqual({
      _id: true,
      title: true,
      caseNumber: true,
      caseNumberWithPrefix: true,
      securityCaseStatusId: true,
      securityCaseStatus: { _id: true, name: true, color: true },
      securityCasePriorityId: true,
      securityCasePriority: { _id: true, name: true, color: true },
      assignedToUserId: true,
      assignedToUser: { _id: true, name: true, email: true },
      assignedToTeamId: true,
      assignedToTeam: { _id: true, name: true },
      entities: true,
      detectionCount: true,
      lastDetectedAt: true,
      createdAt: true,
    });
  });

  test("come back as an envelope with the server's total", async () => {
    respondWith({ data: [{ _id: CASE_ID, title: "Spray" }], count: 140 });

    const result: ListResponse<SecurityCaseItem> = await fetchOpenSecurityCases(
      PROJECT_ID,
      ["new"],
    );

    expect(result).toEqual({
      data: [{ _id: CASE_ID, title: "Spray" }],
      count: 140,
      skip: 0,
      limit: SECURITY_CASE_LIST_LIMIT,
    });
  });
});

describe("one case", () => {
  test("is asked for by id, with everything its screen draws", async () => {
    await fetchSecurityCaseById(PROJECT_ID, CASE_ID);

    expect(lastCall()[0]).toBe("/api/security-case/get-list?skip=0&limit=1");
    expect(lastBody()["query"]).toEqual({ _id: CASE_ID });
    expect(
      Object.keys(lastBody()["select"] as Record<string, unknown>),
    ).toEqual(
      expect.arrayContaining([
        "description",
        "source",
        "firstDetectedAt",
        "acknowledgedAt",
        "containedAt",
        "closedAt",
        "verdict",
        "closingNote",
        "aiVerdict",
        "aiSuggestedSecurityCasePriorityId",
        "aiTriageReport",
        "aiTriagedAt",
        "aiTriagePromptInjectionSuspected",
        "incidentId",
        "entities",
        "securityCaseStatus",
        "securityCasePriority",
      ]),
    );
  });

  test("resolves the row", async () => {
    respondWith({ data: [{ _id: CASE_ID, title: "Spray" }], count: 1 });

    await expect(fetchSecurityCaseById(PROJECT_ID, CASE_ID)).resolves.toEqual({
      _id: CASE_ID,
      title: "Spray",
    });
  });

  test("a case that is not there is null, never undefined: React Query caches null", async () => {
    respondWith({ data: [], count: 0 });

    await expect(
      fetchSecurityCaseById(PROJECT_ID, CASE_ID),
    ).resolves.toBeNull();
  });
});

describe("changing a case", () => {
  test("is the dashboard's PUT on the case, the change wrapped in data", async () => {
    await updateSecurityCase(PROJECT_ID, CASE_ID, {
      securityCaseStatusId: "closed",
      verdict: "False Positive",
    });

    expect(lastCall(putMock())[0]).toBe(`/api/security-case/${CASE_ID}`);
    expect(lastBody(putMock())).toEqual({
      data: { securityCaseStatusId: "closed", verdict: "False Positive" },
    });
  });

  test("an id is put into the path as a path segment, whatever it holds", async () => {
    await updateSecurityCase(PROJECT_ID, "../../project/delete", {
      assignedToUserId: null,
    });

    expect(lastCall(putMock())[0]).toBe(
      "/api/security-case/..%2F..%2Fproject%2Fdelete",
    );
  });

  test("a refusal reaches the screen, which says it", async () => {
    putMock().mockRejectedValue(new Error("refused") as never);

    await expect(
      updateSecurityCase(PROJECT_ID, CASE_ID, { assignedToUserId: "x" }),
    ).rejects.toThrow("refused");
  });
});

describe("the timeline and the notes", () => {
  test("the timeline is the case's feed, newest first, with each entry's kind", async () => {
    await fetchSecurityCaseFeed(PROJECT_ID, CASE_ID);

    expect(lastCall()[0]).toBe(
      "/api/security-case-feed/get-list?skip=0&limit=50",
    );
    expect(lastBody()).toEqual({
      query: { securityCaseId: CASE_ID },
      select: {
        _id: true,
        feedInfoInMarkdown: true,
        moreInformationInMarkdown: true,
        securityCaseFeedEventType: true,
        displayColor: true,
        postedAt: true,
        createdAt: true,
      },
      sort: { postedAt: "DESC" },
    });
  });

  test("notes are the case's, newest first, with who wrote each", async () => {
    await fetchSecurityCaseNotes(PROJECT_ID, CASE_ID);

    expect(lastCall()[0]).toBe(
      "/api/security-case-note/get-list?skip=0&limit=50",
    );
    expect(lastBody()).toEqual({
      query: { securityCaseId: CASE_ID },
      select: {
        _id: true,
        note: true,
        createdAt: true,
        createdByUser: { _id: true, name: true },
      },
      sort: { createdAt: "DESC" },
    });
  });

  test("a note is created on the case, in the project", async () => {
    await createSecurityCaseNote(PROJECT_ID, CASE_ID, "Called Alice.");

    expect(lastCall()[0]).toBe("/api/security-case-note");
    expect(lastBody()).toEqual({
      data: {
        securityCaseId: CASE_ID,
        note: "Called Alice.",
        projectId: PROJECT_ID,
      },
    });
  });
});

describe("playbook runs waiting for an approval", () => {
  test("across the project: only which cases they are on", async () => {
    await fetchWaitingPlaybookRuns(PROJECT_ID);

    expect(lastCall()[0]).toBe(
      "/api/security-playbook-run/get-list?skip=0&limit=100",
    );
    expect(lastBody()).toEqual({
      query: { status: "Waiting for Approval" },
      select: { _id: true, securityCaseId: true },
      sort: { createdAt: "ASC" },
    });
  });

  test("on one case: the whole run, steps, results and who started it", async () => {
    await fetchWaitingPlaybookRuns(PROJECT_ID, CASE_ID);

    expect(lastBody()["query"]).toEqual({
      status: "Waiting for Approval",
      securityCaseId: CASE_ID,
    });
    expect(lastBody()["select"]).toEqual({
      _id: true,
      securityCaseId: true,
      playbookName: true,
      status: true,
      trigger: true,
      steps: true,
      stepResults: true,
      currentStepIndex: true,
      triggeredByUserId: true,
      triggeredByUser: { _id: true, name: true, email: true },
      startedAt: true,
      createdAt: true,
    });
  });
});

describe("deciding a step", () => {
  test("approving posts the comment and the targets kept", async () => {
    await decidePlaybookStep(PROJECT_ID, RUN_ID, "approve", {
      comment: "  Contained by phone.  ",
      targets: ["alice@acme.test"],
    });

    expect(lastCall()[0]).toBe(`/api/security-playbook-run/${RUN_ID}/approve`);
    expect(lastBody()).toEqual({
      comment: "Contained by phone.",
      targets: ["alice@acme.test"],
    });
  });

  test("an approval of a step that acts on nobody in particular sends no targets", async () => {
    await decidePlaybookStep(PROJECT_ID, RUN_ID, "approve", {
      targets: undefined,
    });

    expect(lastBody()).toEqual({});
  });

  test("rejecting posts the comment, and never targets", async () => {
    await decidePlaybookStep(PROJECT_ID, RUN_ID, "reject", {
      comment: "Alice is travelling.",
      targets: ["alice@acme.test"],
    });

    expect(lastCall()[0]).toBe(`/api/security-playbook-run/${RUN_ID}/reject`);
    expect(lastBody()).toEqual({ comment: "Alice is travelling." });
  });

  test("an empty comment is left out", async () => {
    await decidePlaybookStep(PROJECT_ID, RUN_ID, "reject", { comment: "  " });

    expect(lastBody()).toEqual({});
  });

  test("the run's id goes into the path as one segment", async () => {
    await decidePlaybookStep(PROJECT_ID, "a/b", "approve");

    expect(lastCall()[0]).toBe("/api/security-playbook-run/a%2Fb/approve");
  });
});
