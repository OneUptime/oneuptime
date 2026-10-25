import { renderHook, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";
import {
  useCaseWaitingPlaybookRuns,
  useSecurityCaseDetail,
  useSecurityCaseFeed,
  useSecurityCaseNotes,
} from "./useSecurityCaseDetail";
import {
  fetchSecurityCaseById,
  fetchSecurityCaseFeed,
  fetchSecurityCaseNotes,
  fetchWaitingPlaybookRuns,
} from "../api/securityCases";
import {
  createQueryWrapper,
  makeSecurityCase,
  makeSecurityCaseFeedItem,
  makeWaitingPlaybookRun,
} from "../__tests__/testSupport";

jest.mock("../api/securityCases", () => {
  return {
    fetchSecurityCaseById: jest.fn(),
    fetchSecurityCaseFeed: jest.fn(),
    fetchSecurityCaseNotes: jest.fn(),
    fetchWaitingPlaybookRuns: jest.fn(),
  };
});

/*
 * One case and what its screen reads beside it. The case's own read keeps a
 * missing case apart from a failed request - a page lands on this screen, and
 * "this case no longer exists" must only ever be said of a request that
 * succeeded and found nothing. The rest wait for the case, so a case that is
 * gone does not fan out into three more refused reads.
 */

const PROJECT_ID: string = "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0";
const CASE_ID: string = "5ec0ca5e-0142-4d1a-9a00-000000000142";

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
}

function refusal(status: number): Error {
  return Object.assign(new Error("refused"), {
    isAxiosError: true,
    response: { status },
  });
}

beforeEach(() => {
  jest.mocked(fetchSecurityCaseById).mockReset();
  jest.mocked(fetchSecurityCaseFeed).mockReset();
  jest.mocked(fetchSecurityCaseNotes).mockReset();
  jest.mocked(fetchWaitingPlaybookRuns).mockReset();
});

describe("the case", () => {
  test("is read in its project, by id", async () => {
    jest.mocked(fetchSecurityCaseById).mockResolvedValue(makeSecurityCase());

    const { result } = await renderHook(
      () => {
        return useSecurityCaseDetail(PROJECT_ID, CASE_ID);
      },
      { wrapper: createQueryWrapper(client()) },
    );

    await waitFor(() => {
      expect(result.current.data?._id).toBe(CASE_ID);
    });
    expect(fetchSecurityCaseById).toHaveBeenCalledWith(PROJECT_ID, CASE_ID);
  });

  test("a case that is gone is settled data, never an error", async () => {
    jest.mocked(fetchSecurityCaseById).mockResolvedValue(null);

    const { result } = await renderHook(
      () => {
        return useSecurityCaseDetail(PROJECT_ID, CASE_ID);
      },
      { wrapper: createQueryWrapper(client()) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  test("a refusal is not asked again: the role will not change on a retry", async () => {
    jest.mocked(fetchSecurityCaseById).mockRejectedValue(refusal(422));

    const { result } = await renderHook(
      () => {
        return useSecurityCaseDetail(PROJECT_ID, CASE_ID);
      },
      { wrapper: createQueryWrapper(client()) },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(fetchSecurityCaseById).toHaveBeenCalledTimes(1);
  });

  test("a failure that might clear is tried once more", async () => {
    jest.mocked(fetchSecurityCaseById).mockRejectedValue(new Error("Network"));

    const { result } = await renderHook(
      () => {
        return useSecurityCaseDetail(PROJECT_ID, CASE_ID);
      },
      { wrapper: createQueryWrapper(client()) },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(fetchSecurityCaseById).toHaveBeenCalledTimes(2);
  });

  test("nothing is asked without a project or a case", async () => {
    await renderHook(
      () => {
        return useSecurityCaseDetail("", CASE_ID);
      },
      { wrapper: createQueryWrapper(client()) },
    );
    await renderHook(
      () => {
        return useSecurityCaseDetail(PROJECT_ID, "");
      },
      { wrapper: createQueryWrapper(client()) },
    );

    expect(fetchSecurityCaseById).not.toHaveBeenCalled();
  });
});

describe("what the case's screen reads beside it", () => {
  test("the timeline, the notes and the waiting runs, in the case's project", async () => {
    jest
      .mocked(fetchSecurityCaseFeed)
      .mockResolvedValue([makeSecurityCaseFeedItem()]);
    jest.mocked(fetchSecurityCaseNotes).mockResolvedValue([]);
    jest
      .mocked(fetchWaitingPlaybookRuns)
      .mockResolvedValue([makeWaitingPlaybookRun()]);

    const { result } = await renderHook(
      () => {
        return {
          feed: useSecurityCaseFeed(PROJECT_ID, CASE_ID),
          notes: useSecurityCaseNotes(PROJECT_ID, CASE_ID),
          runs: useCaseWaitingPlaybookRuns(PROJECT_ID, CASE_ID),
        };
      },
      { wrapper: createQueryWrapper(client()) },
    );

    await waitFor(() => {
      expect(result.current.runs.data).toHaveLength(1);
    });
    expect(result.current.feed.data).toHaveLength(1);
    expect(result.current.notes.data).toEqual([]);
    expect(fetchSecurityCaseFeed).toHaveBeenCalledWith(PROJECT_ID, CASE_ID);
    expect(fetchSecurityCaseNotes).toHaveBeenCalledWith(PROJECT_ID, CASE_ID);
    expect(fetchWaitingPlaybookRuns).toHaveBeenCalledWith(PROJECT_ID, CASE_ID);
  });

  test("wait while the screen says the case is not there", async () => {
    await renderHook(
      () => {
        return {
          feed: useSecurityCaseFeed(PROJECT_ID, CASE_ID, false),
          notes: useSecurityCaseNotes(PROJECT_ID, CASE_ID, false),
          runs: useCaseWaitingPlaybookRuns(PROJECT_ID, CASE_ID, false),
        };
      },
      { wrapper: createQueryWrapper(client()) },
    );

    expect(fetchSecurityCaseFeed).not.toHaveBeenCalled();
    expect(fetchSecurityCaseNotes).not.toHaveBeenCalled();
    expect(fetchWaitingPlaybookRuns).not.toHaveBeenCalled();
  });

  test("their keys name the project, so a switch never shows another project's", async () => {
    jest.mocked(fetchSecurityCaseFeed).mockResolvedValue([]);
    const queryClient: QueryClient = client();

    await renderHook(
      () => {
        return useSecurityCaseFeed(PROJECT_ID, CASE_ID);
      },
      { wrapper: createQueryWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(["security-case-feed", PROJECT_ID, CASE_ID]),
      ).toEqual([]);
    });
  });
});
