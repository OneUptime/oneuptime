import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import useRemediationRounds, {
  REMEDIATION_ROUND_POLL_INTERVAL_MS,
  RemediationRounds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/useRemediationRounds";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * THE ROUNDS OF THE FIXES ON THE REMEDIATION STEP (issues #6436, #6487):
 * each fix with a run is read once for where it stands, again when its run
 * or its status changes, and every few seconds while its round is at work -
 * never after, and never for another incident's fixes. A read that fails
 * leaves the fix as it was.
 */

const FIX_A: string = "0193c0de-6666-4aaa-8bbb-000000000091";
const FIX_B: string = "0193c0de-6666-4aaa-8bbb-000000000092";
const RUN_A: string = "0193c0de-7777-4aaa-8bbb-000000000093";
const RUN_A_AGAIN: string = "0193c0de-7777-4aaa-8bbb-000000000094";

function fix(data: {
  id: string;
  status: AutoRemediationSuggestionStatus;
  aiRunId?: string | undefined;
}): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: data.id,
    status: data.status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ...(data.aiRunId ? { aiRunId: new ObjectID(data.aiRunId) } : {}),
  });
}

// The run status the server answers, by fix.
let runStatusByFix: Record<string, AIRunStatus> = {};
let isServerDown: boolean = false;
let postSpy: ReturnType<typeof jest.spyOn>;

function readsOf(fixId: string): number {
  return postSpy.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { data: { suggestionId: string } }).data.suggestionId ===
      fixId
    );
  }).length;
}

beforeEach(() => {
  jest.useFakeTimers();
  runStatusByFix = {};
  isServerDown = false;
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post").mockImplementation((async (request: {
    data: { suggestionId: string };
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    if (isServerDown) {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        run: {
          _id: RUN_A,
          status:
            runStatusByFix[request.data.suggestionId] || AIRunStatus.Error,
        },
        events: [],
        checks: [],
        otherCheckCount: 0,
        explanation: null,
        appliedSteps: { commandCount: 0, changeCount: 0 },
        mayTryAgain: true,
      },
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface HookProps {
  suggestions: Array<AutoRemediationSuggestion>;
  subjectKey: string;
}

describe("useRemediationRounds", () => {
  test("reads each fix with a run once, and keeps what it read under the fix", async () => {
    const { result } = renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: {
          suggestions: [
            fix({
              id: FIX_A,
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              aiRunId: RUN_A,
            }),
            // Worked out without a run: nothing to read.
            fix({
              id: FIX_B,
              status: AutoRemediationSuggestionStatus.Suggested,
            }),
          ],
          subjectKey: "incident-1",
        },
      },
    );
    await settle();

    expect(readsOf(FIX_A)).toBe(1);
    expect(readsOf(FIX_B)).toBe(0);
    expect(result.current.rounds.get(FIX_A)).toMatchObject({
      suggestionId: FIX_A,
      aiRunId: RUN_A,
      mayTryAgain: true,
    });
    expect(result.current.rounds.get(FIX_A)?.run?.status).toBe(
      AIRunStatus.Error,
    );

    // A settled round is never read again by itself.
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS * 4);
    expect(readsOf(FIX_A)).toBe(1);
  });

  test("reads it again when its run or its status changes - a round tried again has a new run", async () => {
    const { rerender, result } = renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: {
          suggestions: [
            fix({
              id: FIX_A,
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              aiRunId: RUN_A,
            }),
          ],
          subjectKey: "incident-1",
        },
      },
    );
    await settle();

    // The same fix, read again by the step with nothing changed: no read.
    rerender({
      suggestions: [
        fix({
          id: FIX_A,
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          aiRunId: RUN_A,
        }),
      ],
      subjectKey: "incident-1",
    });
    await settle();
    expect(readsOf(FIX_A)).toBe(1);

    rerender({
      suggestions: [
        fix({
          id: FIX_A,
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: RUN_A_AGAIN,
        }),
      ],
      subjectKey: "incident-1",
    });
    await settle();

    expect(readsOf(FIX_A)).toBe(2);
    expect(result.current.rounds.get(FIX_A)?.aiRunId).toBe(RUN_A_AGAIN);
  });

  test("a round at work is read again every few seconds, and no longer once it is over", async () => {
    runStatusByFix[FIX_A] = AIRunStatus.Running;
    renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: {
          suggestions: [
            fix({
              id: FIX_A,
              status: AutoRemediationSuggestionStatus.Planning,
              aiRunId: RUN_A,
            }),
          ],
          subjectKey: "incident-1",
        },
      },
    );
    await settle();
    expect(readsOf(FIX_A)).toBe(1);

    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS - 1);
    expect(readsOf(FIX_A)).toBe(1);

    await advance(1);
    expect(readsOf(FIX_A)).toBe(2);

    // Its run ended: the next read says so, and the reads stop.
    runStatusByFix[FIX_A] = AIRunStatus.Error;
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    expect(readsOf(FIX_A)).toBe(3);

    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS * 4);
    expect(readsOf(FIX_A)).toBe(3);
  });

  test("a read that fails leaves the fix as it was", async () => {
    isServerDown = true;
    const { result } = renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: {
          suggestions: [
            fix({
              id: FIX_A,
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              aiRunId: RUN_A,
            }),
          ],
          subjectKey: "incident-1",
        },
      },
    );
    await settle();

    expect(readsOf(FIX_A)).toBe(1);
    expect(result.current.rounds.size).toBe(0);
  });

  test("reloadRound reads one fix's round again now", async () => {
    const suggestion: AutoRemediationSuggestion = fix({
      id: FIX_A,
      status: AutoRemediationSuggestionStatus.NoneApplicable,
      aiRunId: RUN_A,
    });
    const { result } = renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: { suggestions: [suggestion], subjectKey: "incident-1" },
      },
    );
    await settle();

    await act(async () => {
      await result.current.reloadRound(suggestion);
    });

    expect(readsOf(FIX_A)).toBe(2);
  });

  test("another incident starts from nothing, and a late answer about the last one is dropped", async () => {
    let answerLate: (() => void) | null = null;
    postSpy.mockImplementationOnce((async (): Promise<
      HTTPResponse<JSONObject>
    > => {
      await new Promise<void>((resolve: () => void) => {
        answerLate = resolve;
      });
      return new HTTPResponse<JSONObject>(
        200,
        { run: { _id: RUN_A, status: AIRunStatus.Error }, mayTryAgain: true },
        {},
      );
    }) as never);

    const { rerender, result } = renderHook(
      (props: HookProps): RemediationRounds => {
        return useRemediationRounds(props);
      },
      {
        initialProps: {
          suggestions: [
            fix({
              id: FIX_A,
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              aiRunId: RUN_A,
            }),
          ],
          subjectKey: "incident-1",
        },
      },
    );
    await settle();

    rerender({ suggestions: [], subjectKey: "incident-2" });
    await settle();

    await act(async () => {
      answerLate!();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.rounds.size).toBe(0);
  });
});
