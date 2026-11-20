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
  getRemediationRoundBackoffMs,
  REMEDIATION_ROUND_BACKOFF_MAX_MS,
  REMEDIATION_ROUND_BACKOFF_MIN_MS,
  REMEDIATION_ROUND_POLL_INTERVAL_MS,
  RemediationRounds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/useRemediationRounds";
import { REMEDIATION_ROUND_READ_TOO_OFTEN } from "../../../Types/AutoRemediation/RemediationRound";
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
/*
 * While set, every read is refused as one too many (#6525), with this
 * Retry-After (null: none at all).
 */
let tooManyRetryAfter: string | null | undefined = undefined;
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
  tooManyRetryAfter = undefined;
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post").mockImplementation((async (request: {
    data: { suggestionId: string };
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    if (isServerDown) {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    }

    if (tooManyRetryAfter !== undefined) {
      return new HTTPErrorResponse(
        429,
        { message: REMEDIATION_ROUND_READ_TOO_OFTEN },
        tooManyRetryAfter === null ? {} : { "retry-after": tooManyRetryAfter },
      );
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

/*
 * READS REFUSED AS TOO MANY (#6525): the server holds a person to 1,800
 * reads of rounds in 15 minutes (AutoRemediationRoundRateLimit). A refused
 * read shows nothing - the step keeps what it drew - and no round is read
 * again until the time the refusal's Retry-After names: then what was left
 * unread is read, and the rounds at work are polled again.
 */
describe("useRemediationRounds, refused as reading too often", () => {
  function renderLiveRound(): {
    result: { current: RemediationRounds };
    rerender: (props: HookProps) => void;
  } {
    runStatusByFix[FIX_A] = AIRunStatus.Running;

    return renderHook(
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
  }

  test("a round at work waits the refusal's Retry-After, then is polled again every few seconds", async () => {
    const { result } = renderLiveRound();
    await settle();
    expect(readsOf(FIX_A)).toBe(1);

    // The next poll is refused: wait two minutes.
    tooManyRetryAfter = "120";
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    expect(readsOf(FIX_A)).toBe(2);

    // Nothing shown for it: the round is still what the step read before.
    expect(result.current.rounds.get(FIX_A)?.run?.status).toBe(
      AIRunStatus.Running,
    );

    // No poll while it waits, though its 15-second polls come round.
    tooManyRetryAfter = undefined;
    await advance(120 * 1000 - 1);
    expect(readsOf(FIX_A)).toBe(2);

    // The wait is over: the round it did not read is read at once.
    await advance(1);
    expect(readsOf(FIX_A)).toBe(3);

    // And it is polled at its usual pace again.
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    expect(readsOf(FIX_A)).toBe(4);
  });

  test("a fix whose status changes while the step waits is read once the wait is over", async () => {
    const { rerender, result } = renderLiveRound();
    await settle();

    tooManyRetryAfter = "60";
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    expect(readsOf(FIX_A)).toBe(2);

    // The fix settles meanwhile: not read until the wait is over.
    tooManyRetryAfter = undefined;
    runStatusByFix[FIX_A] = AIRunStatus.Error;
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
    expect(readsOf(FIX_A)).toBe(2);

    await advance(60 * 1000);
    expect(readsOf(FIX_A)).toBe(3);
    expect(result.current.rounds.get(FIX_A)?.run?.status).toBe(
      AIRunStatus.Error,
    );

    // A settled round is not polled.
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS * 4);
    expect(readsOf(FIX_A)).toBe(3);
  });

  test("a settled fix whose first read was refused is read once the wait is over, and then never again by itself", async () => {
    tooManyRetryAfter = "90";
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

    tooManyRetryAfter = undefined;
    await advance(90 * 1000 - 1);
    expect(readsOf(FIX_A)).toBe(1);

    await advance(1);
    expect(readsOf(FIX_A)).toBe(2);
    expect(result.current.rounds.get(FIX_A)?.run?.status).toBe(
      AIRunStatus.Error,
    );

    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS * 8);
    expect(readsOf(FIX_A)).toBe(2);
  });

  test("a refusal that keeps coming keeps the step waiting, never polling every few seconds", async () => {
    renderLiveRound();
    await settle();

    tooManyRetryAfter = "60";

    /*
     * Ten minutes of refusals, each answered before the next poll is due:
     * one read a minute (about 11), never one every 15 seconds (41).
     */
    for (let step: number = 0; step < 40; step++) {
      await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    }

    expect(readsOf(FIX_A)).toBeLessThanOrEqual(12);
    expect(readsOf(FIX_A)).toBeGreaterThanOrEqual(10);
  });

  test("a read that failed for any other reason does not wait: the round at work is polled on", async () => {
    renderLiveRound();
    await settle();

    isServerDown = true;
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);
    await advance(REMEDIATION_ROUND_POLL_INTERVAL_MS);

    expect(readsOf(FIX_A)).toBe(3);
  });

  test("how long it waits: the Retry-After, held between a minute and the limit's window", () => {
    const tooMany: (headers: Record<string, string>) => HTTPErrorResponse = (
      headers: Record<string, string>,
    ): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        429,
        { message: REMEDIATION_ROUND_READ_TOO_OFTEN },
        headers,
      );
    };

    expect(
      getRemediationRoundBackoffMs(tooMany({ "retry-after": "120" })),
    ).toBe(120 * 1000);
    // Whatever its case.
    expect(
      getRemediationRoundBackoffMs(tooMany({ "Retry-After": "300" })),
    ).toBe(300 * 1000);
    expect(getRemediationRoundBackoffMs(tooMany({ "retry-after": "5" }))).toBe(
      REMEDIATION_ROUND_BACKOFF_MIN_MS,
    );
    expect(
      getRemediationRoundBackoffMs(tooMany({ "retry-after": "86400" })),
    ).toBe(REMEDIATION_ROUND_BACKOFF_MAX_MS);
    expect(getRemediationRoundBackoffMs(tooMany({}))).toBe(
      REMEDIATION_ROUND_BACKOFF_MIN_MS,
    );
    expect(
      getRemediationRoundBackoffMs(tooMany({ "retry-after": "soon" })),
    ).toBe(REMEDIATION_ROUND_BACKOFF_MIN_MS);
    /*
     * Read as RFC 9110 writes it (Common's RetryAfter): an exponent or a
     * sign is no wait, though Number() read a thousand seconds and two
     * minutes in them, and an HTTP-date is the time until it.
     */
    expect(
      getRemediationRoundBackoffMs(tooMany({ "retry-after": "1e3" })),
    ).toBe(REMEDIATION_ROUND_BACKOFF_MIN_MS);
    expect(
      getRemediationRoundBackoffMs(tooMany({ "retry-after": "+120" })),
    ).toBe(REMEDIATION_ROUND_BACKOFF_MIN_MS);
    jest.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    expect(
      getRemediationRoundBackoffMs(
        tooMany({ "retry-after": "Thu, 19 Nov 2026 12:10:00 GMT" }),
      ),
    ).toBe(10 * 60 * 1000);
    expect(REMEDIATION_ROUND_BACKOFF_MIN_MS).toBe(60 * 1000);
    expect(REMEDIATION_ROUND_BACKOFF_MAX_MS).toBe(15 * 60 * 1000);

    // Any other failure is not waited on.
    for (const statusCode of [400, 401, 403, 404, 500, 502, 503]) {
      expect(
        getRemediationRoundBackoffMs(
          new HTTPErrorResponse(
            statusCode,
            { message: "No." },
            {
              "retry-after": "120",
            },
          ),
        ),
      ).toBeNull();
    }
  });
});
