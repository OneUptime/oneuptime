import { act, renderHook, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";
import {
  isAccessDenied,
  useCasesAwaitingApproval,
  useOpenSecurityCases,
  useSecurityCaseCounts,
  useSecurityCasesAvailability,
} from "./useSecurityCases";
import { useActiveProject } from "./useProject";
import {
  countSecurityCases,
  fetchOpenSecurityCases,
  fetchSecurityCasePriorities,
  fetchSecurityCaseStatuses,
  fetchWaitingPlaybookRuns,
} from "../api/securityCases";
import {
  SECURITY_STATUS_IDS,
  createQueryWrapper,
  createTestQueryClient,
  makeListResponse,
  makeProject,
  makeSecurityCase,
  makeSecurityCasePriorities,
  makeSecurityCaseStatuses,
  makeWaitingPlaybookRun,
} from "../__tests__/testSupport";
import type { ProjectItem } from "../api/types";

jest.mock("./useProject", () => {
  return { useActiveProject: jest.fn() };
});

jest.mock("../api/securityCases", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/securityCases",
  );
  return {
    ...actual,
    countSecurityCases: jest.fn(),
    fetchOpenSecurityCases: jest.fn(),
    fetchSecurityCasePriorities: jest.fn(),
    fetchSecurityCaseStatuses: jest.fn(),
    fetchWaitingPlaybookRuns: jest.fn(),
  };
});

/*
 * Security cases are not for everybody on call: a case is read only by
 * Project Owners, Project Admins and the Security roles, and most projects
 * never open one. These hooks decide whether the selected project's cases are
 * something to show at all, and fetch them for the people who can see them.
 * A refusal from the server is an answer, never an error to report, and it
 * is not asked again and again.
 */

const projectA: ProjectItem = makeProject({
  _id: "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0",
  name: "Production",
});
const useProjectMock: jest.MockedFunction<typeof useActiveProject> =
  jest.mocked(useActiveProject);
const countMock: jest.MockedFunction<typeof countSecurityCases> =
  jest.mocked(countSecurityCases);
const openMock: jest.MockedFunction<typeof fetchOpenSecurityCases> =
  jest.mocked(fetchOpenSecurityCases);
const statusesMock: jest.MockedFunction<typeof fetchSecurityCaseStatuses> =
  jest.mocked(fetchSecurityCaseStatuses);
const prioritiesMock: jest.MockedFunction<typeof fetchSecurityCasePriorities> =
  jest.mocked(fetchSecurityCasePriorities);
const runsMock: jest.MockedFunction<typeof fetchWaitingPlaybookRuns> =
  jest.mocked(fetchWaitingPlaybookRuns);

function selectProject(
  project?: ProjectItem,
  isLoadingProjects: boolean = false,
): void {
  useProjectMock.mockReturnValue({
    projectList: project ? [project] : [],
    activeProject: project ?? null,
    isLoadingProjects,
    projectLoadError: null,
    refreshProjects: jest.fn(),
    selectProject: jest.fn(),
  } as unknown as ReturnType<typeof useActiveProject>);
}

/*
 * A client that retries the way the app's does - the hooks set their own
 * retry rule - without waiting between tries.
 */
function retryingClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
}

function refusal(status: number): Error {
  return Object.assign(new Error("refused"), {
    isAxiosError: true,
    response: { status, data: { message: "You do not have permission" } },
  });
}

beforeEach(() => {
  countMock.mockReset();
  openMock.mockReset();
  statusesMock.mockReset();
  prioritiesMock.mockReset();
  runsMock.mockReset();
  statusesMock.mockResolvedValue(makeSecurityCaseStatuses());
  prioritiesMock.mockResolvedValue(makeSecurityCasePriorities());
  runsMock.mockResolvedValue([]);
  openMock.mockResolvedValue(makeListResponse([]));
  selectProject(projectA);
});

describe("what counts as a refusal", () => {
  test("422 (NotAuthorizedException) and 403 are; nothing else is", () => {
    expect(isAccessDenied(refusal(422))).toBe(true);
    expect(isAccessDenied(refusal(403))).toBe(true);
    expect(isAccessDenied(refusal(500))).toBe(false);
    expect(isAccessDenied(refusal(401))).toBe(false);
    expect(isAccessDenied(new Error("Network Error"))).toBe(false);
    expect(isAccessDenied(null)).toBe(false);
  });
});

describe("whether Security is shown", () => {
  test("to someone who can see the project's cases, in a project that has one", async () => {
    countMock.mockResolvedValue(3);

    const { result } = await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
    expect(result.current).toEqual({
      isAvailable: true,
      isChecking: false,
      isDenied: false,
      projectId: projectA._id,
    });
    expect(countMock).toHaveBeenCalledWith(projectA._id);
  });

  test("not in a project that never had a case: no empty product in the Inbox", async () => {
    countMock.mockResolvedValue(0);

    const { result } = await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isDenied).toBe(false);
  });

  test("not to someone whose role cannot read cases, asked once and never again", async () => {
    countMock.mockRejectedValue(refusal(422));

    const { result } = await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(retryingClient()) },
    );

    await waitFor(() => {
      expect(result.current.isDenied).toBe(true);
    });
    expect(result.current.isAvailable).toBe(false);
    // The default client retries three times; a refusal is not retried.
    expect(countMock).toHaveBeenCalledTimes(1);
  });

  test("a failure that might clear is tried once more, and shows nothing meanwhile", async () => {
    countMock.mockRejectedValue(refusal(503));

    const { result } = await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(retryingClient()) },
    );

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isDenied).toBe(false);
  });

  test("nothing is asked while no project is selected, or while projects load", async () => {
    selectProject(undefined);
    const first: Awaited<ReturnType<typeof renderHook>> = await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    selectProject(projectA, true);
    await renderHook(
      () => {
        return useSecurityCasesAvailability();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    expect(countMock).not.toHaveBeenCalled();
    expect(
      (first.result.current as ReturnType<typeof useSecurityCasesAvailability>)
        .projectId,
    ).toBeNull();
  });
});

describe("the open cases of the selected project", () => {
  test("asks for the cases in the project's open statuses, read first", async () => {
    openMock.mockResolvedValue(
      makeListResponse([makeSecurityCase({ _id: "case-1" })], { count: 1 }),
    );

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(statusesMock).toHaveBeenCalledWith(projectA._id);
    expect(openMock).toHaveBeenCalledWith(projectA._id, [
      SECURITY_STATUS_IDS.new,
      SECURITY_STATUS_IDS.investigating,
      SECURITY_STATUS_IDS.contained,
    ]);
    expect(result.current.items[0]).toMatchObject({
      projectId: projectA._id,
      projectName: "Production",
      item: { _id: "case-1" },
    });
    expect(result.current.priorities).toHaveLength(5);
    expect(result.current.isTruncated).toBe(false);
  });

  test("never asks for cases before it knows which statuses are open", async () => {
    statusesMock.mockReturnValue(new Promise(() => {}) as never);

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(openMock).not.toHaveBeenCalled();
  });

  test("marks the cases a playbook step waits on", async () => {
    runsMock.mockResolvedValue([
      makeWaitingPlaybookRun({ securityCaseId: "CASE-WAITING" }),
    ]);

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.awaitingApprovalCaseIds.has("case-waiting")).toBe(
        true,
      );
    });
    expect(runsMock).toHaveBeenCalledWith(projectA._id);
  });

  test("says when the server holds more open cases than the list does", async () => {
    openMock.mockResolvedValue(
      makeListResponse([makeSecurityCase()], { count: 140 }),
    );

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.isTruncated).toBe(true);
    });
  });

  test("a refusal reads as no access, not as a failure to retry", async () => {
    openMock.mockRejectedValue(refusal(422));

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.isDenied).toBe(true);
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  test("a failure that is not a refusal is an error, not no access", async () => {
    openMock.mockRejectedValue(new Error("Network Error"));

    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(retryingClient()) },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isDenied).toBe(false);
  });

  test("refresh asks for everything again", async () => {
    const { result } = await renderHook(
      () => {
        return useOpenSecurityCases();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(statusesMock).toHaveBeenCalledTimes(2);
    expect(prioritiesMock).toHaveBeenCalledTimes(2);
    expect(openMock).toHaveBeenCalledTimes(2);
    expect(runsMock).toHaveBeenCalledTimes(2);
  });
});

describe("the cases waiting for an approval", () => {
  test("are read as a set of case ids, whatever their case", async () => {
    runsMock.mockResolvedValue([
      makeWaitingPlaybookRun({ _id: "run-1", securityCaseId: "ABC" }),
      makeWaitingPlaybookRun({ _id: "run-2", securityCaseId: "abc" }),
      makeWaitingPlaybookRun({ _id: "run-3", securityCaseId: null }),
    ]);

    const { result } = await renderHook(
      () => {
        return useCasesAwaitingApproval(projectA._id);
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.caseIds.size).toBe(1);
    });
    expect([...result.current.caseIds]).toEqual(["abc"]);
  });

  test("are not asked for while the caller says not to", async () => {
    await renderHook(
      () => {
        return useCasesAwaitingApproval(projectA._id, false);
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    expect(runsMock).not.toHaveBeenCalled();
  });
});

describe("what Home says about Security", () => {
  test("nothing for someone who cannot see cases: no request past the check", async () => {
    countMock.mockRejectedValue(refusal(422));

    const { result } = await renderHook(
      () => {
        return useSecurityCaseCounts();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(countMock).toHaveBeenCalled();
    });
    expect(result.current.isAvailable).toBe(false);
    expect(statusesMock).not.toHaveBeenCalled();
    expect(runsMock).not.toHaveBeenCalled();
  });

  test("the open cases and the ones waiting for an approval, for someone who can", async () => {
    countMock.mockImplementation(
      async (_projectId: string, query?: Record<string, unknown>) => {
        return query && "securityCaseStatusId" in query ? 4 : 9;
      },
    );
    runsMock.mockResolvedValue([
      makeWaitingPlaybookRun({ _id: "run-1", securityCaseId: "case-1" }),
      makeWaitingPlaybookRun({ _id: "run-2", securityCaseId: "case-1" }),
      makeWaitingPlaybookRun({ _id: "run-3", securityCaseId: "case-2" }),
    ]);

    const { result } = await renderHook(
      () => {
        return useSecurityCaseCounts();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );

    await waitFor(() => {
      expect(result.current.openCount).toBe(4);
    });
    expect(result.current.isAvailable).toBe(true);
    // Two runs on one case wait on one case.
    expect(result.current.awaitingApprovalCount).toBe(2);
    expect(countMock).toHaveBeenLastCalledWith(projectA._id, {
      securityCaseStatusId: {
        _type: "Includes",
        value: [
          SECURITY_STATUS_IDS.new,
          SECURITY_STATUS_IDS.investigating,
          SECURITY_STATUS_IDS.contained,
        ],
      },
    });
  });

  test("a failed count is an error, so Home never prints a guess", async () => {
    countMock.mockImplementation(
      async (_projectId: string, query?: Record<string, unknown>) => {
        if (query && "securityCaseStatusId" in query) {
          throw new Error("Network Error");
        }
        return 2;
      },
    );

    const { result } = await renderHook(
      () => {
        return useSecurityCaseCounts();
      },
      { wrapper: createQueryWrapper(retryingClient()) },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.openCount).toBeUndefined();
  });
});
