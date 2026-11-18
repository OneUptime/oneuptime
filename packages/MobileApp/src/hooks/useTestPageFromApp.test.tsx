import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import {
  TEST_PAGE_POLL_INTERVAL_MS,
  type TestPageFromApp,
  useTestPageFromApp,
} from "./useTestPageFromApp";
import {
  fetchTestPageResult,
  fetchTestPageSeverity,
  sendTestPageToMyself,
} from "../api/onCallTestPageSend";
import {
  hasAcknowledgedTestPageFromApp,
  rememberTestPageAcknowledged,
} from "../storage/getReady";
import { GET_READY_TEXT } from "../onboarding/getReady";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE FIRST STEPS' TEST PAGE (#7041): sent to yourself from the app, and
 * followed - every few seconds, and at once on coming back to the app from
 * its notification - until it is acknowledged, ends or fails, in the
 * server's words. Acknowledged, it is remembered for this person and
 * project. It never says a test worked that the server did not.
 */

jest.mock("../api/onCallTestPageSend", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/onCallTestPageSend",
  );

  return {
    ...actual,
    fetchTestPageSeverity: jest.fn(),
    sendTestPageToMyself: jest.fn(),
    fetchTestPageResult: jest.fn(),
  };
});

const SEVERITY: {
  recordKind: "Incident";
  severityId: string;
  severityName: string;
} = {
  recordKind: "Incident",
  severityId: "sev-critical",
  severityName: "Critical",
};

const ACKNOWLEDGED_MESSAGE: string =
  "Test page acknowledged by Ana Lopez by push notification after 9 seconds.";

let appStateListener: ((state: string) => void) | null;

function severityMock(): jest.Mock {
  return fetchTestPageSeverity as unknown as jest.Mock;
}

function sendMock(): jest.Mock {
  return sendTestPageToMyself as unknown as jest.Mock;
}

function resultMock(): jest.Mock {
  return fetchTestPageResult as unknown as jest.Mock;
}

async function renderTestPage(
  projectId: string | null = "project-1",
  userId: string | null = "user-1",
): Promise<{ result: { current: TestPageFromApp } }> {
  const rendered: { result: { current: TestPageFromApp } } = (await renderHook(
    () => {
      return useTestPageFromApp({ projectId, userId });
    },
  )) as unknown as { result: { current: TestPageFromApp } };

  await waitFor(() => {
    expect(rendered.result.current.state.kind).not.toBe("checking");
  });

  return rendered;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  appStateListener = null;
  severityMock().mockReset().mockResolvedValue(SEVERITY);
  sendMock().mockReset().mockResolvedValue("run-1");
  resultMock().mockReset().mockResolvedValue({
    status: "Paging",
    statusMessage: "Paging Ana Lopez.",
  });
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("before it is sent", () => {
  test("a person who never sent one from the app has it to do", async () => {
    const { result } = await renderTestPage();

    expect(result.current.state).toEqual({ kind: "idle" });
  });

  test("one acknowledged before, from this app, in this project, stays done", async () => {
    await rememberTestPageAcknowledged("project-1", "user-1");

    const { result } = await renderTestPage();

    expect(result.current.state).toEqual({
      kind: "acknowledged",
      statusMessage: GET_READY_TEXT.acknowledgedBefore,
    });
  });

  test("with no project open, it says to choose one, and sends nothing", async () => {
    const { result } = await renderTestPage(null);

    await act(async () => {
      await result.current.send();
    });

    expect(result.current.state).toEqual({
      kind: "failed",
      message: GET_READY_TEXT.noProject,
    });
    expect(sendMock()).not.toHaveBeenCalled();
  });
});

describe("sending it", () => {
  test("stands in for the project's most severe severity, and follows the run it started", async () => {
    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    expect(severityMock()).toHaveBeenCalledWith("project-1");
    expect(sendMock()).toHaveBeenCalledWith("project-1", SEVERITY);
    expect(result.current.state).toEqual({
      kind: "paging",
      executionLogId: "run-1",
      statusMessage: "",
    });
  });

  test("a project with no severities has nothing to test: it says so, and sends nothing", async () => {
    severityMock().mockResolvedValueOnce(null);

    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    expect(result.current.state).toEqual({
      kind: "failed",
      message: GET_READY_TEXT.noSeverity,
    });
    expect(sendMock()).not.toHaveBeenCalled();
  });

  test("a refusal - one sent a moment ago - is said in the server's words", async () => {
    sendMock().mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          message:
            "A test page was sent to this person a moment ago. Wait 2 minutes, then send another.",
        },
      },
    });

    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    expect(result.current.state.kind).toBe("failed");
    expect(
      (result.current.state as { kind: "failed"; message: string }).message,
    ).toContain("Wait 2 minutes");
  });
});

describe("following it", () => {
  test("every few seconds while it pages, until it is acknowledged - then it is remembered", async () => {
    jest.useFakeTimers();

    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: "paging",
        executionLogId: "run-1",
        statusMessage: "Paging Ana Lopez.",
      });
    });
    expect(resultMock()).toHaveBeenCalledWith("project-1", "run-1");

    resultMock().mockResolvedValue({
      status: "Acknowledged",
      statusMessage: ACKNOWLEDGED_MESSAGE,
    });

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: "acknowledged",
        statusMessage: ACKNOWLEDGED_MESSAGE,
      });
    });

    await waitFor(async () => {
      expect(await hasAcknowledgedTestPageFromApp("project-1", "user-1")).toBe(
        true,
      );
    });

    // Done: nothing is read any more.
    const reads: number = resultMock().mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS * 3);
    });

    expect(resultMock().mock.calls.length).toBe(reads);
  });

  test("at once on coming back to the app from its notification", async () => {
    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    resultMock().mockResolvedValue({
      status: "Acknowledged",
      statusMessage: ACKNOWLEDGED_MESSAGE,
    });

    await act(async () => {
      appStateListener?.("active");
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("acknowledged");
    });
  });

  test("ended with nobody acknowledging it, or failed: the server's words, and nothing remembered", async () => {
    jest.useFakeTimers();
    resultMock().mockResolvedValue({
      status: "Ended",
      statusMessage: "Test ended: nobody acknowledged it within 15 minutes.",
    });

    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({
        kind: "ended",
        statusMessage: "Test ended: nobody acknowledged it within 15 minutes.",
      });
    });
    expect(await hasAcknowledgedTestPageFromApp("project-1", "user-1")).toBe(
      false,
    );
  });

  test("a read that fails is read again: the test is still going", async () => {
    jest.useFakeTimers();
    resultMock()
      .mockReset()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        status: "Acknowledged",
        statusMessage: ACKNOWLEDGED_MESSAGE,
      });

    const { result } = await renderTestPage();

    await act(async () => {
      await result.current.send();
    });

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS);
    });

    expect(result.current.state.kind).toBe("paging");

    await act(async () => {
      jest.advanceTimersByTime(TEST_PAGE_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("acknowledged");
    });
  });
});
