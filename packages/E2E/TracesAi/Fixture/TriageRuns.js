/*
 * The AI triage of the slow finding (GET /orders in checkout), answered as
 * POST /ai-insight/triage-run answers it: the run, its events in the order
 * the engine writes them, and whether the reader may start a triage that
 * did not finish again (mayTryAgain) - issues #6437 and #6438. Try again
 * (POST /ai-insight/triage-try-again) is answered by Fixture.js.
 *
 * Every record is fabricated. Scenarios, by query parameter:
 *
 *   ?triage=  none (default) | failed | failed-viewer | retrying | running
 *             none:          no triage run
 *             failed:        three attempts, each ran out of time with the
 *                            AI provider (120 seconds); answered for someone
 *                            who may start it again
 *             failed-viewer: the same run, for someone who may not
 *             retrying:      its first attempt ran out of time; it tries
 *                            again in 50 seconds
 *             running:       its second attempt, thinking now
 */
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import AIRunType from "Common/Types/AI/AIRunType";
import ObjectID from "Common/Types/ObjectID";

const params = new URLSearchParams(window.location.search);
const TRIAGE_MODES = ["failed", "failed-viewer", "retrying", "running"];
export const triageMode = TRIAGE_MODES.includes(params.get("triage"))
  ? params.get("triage")
  : "none";

const MINUTE = 60 * 1000;

export const TRIAGE_RUN_IDS = {
  first: "50930000-0000-4000-8000-0000000000c1",
  // The run Try again starts.
  again: "50930000-0000-4000-8000-0000000000c2",
};

// What the provider's library said when it ran out of time.
export const TRIAGE_TIMEOUT_ERROR =
  "OpenAICompatible API request failed: the LLM provider did not respond within 120 seconds.";

function eventId(number) {
  return `50930000-0000-4000-8000-${String(0xd00 + number).padStart(12, "0")}`;
}

/*
 * The run's events, written as the engine writes them: a clock that moves
 * on with each one.
 */
function eventsWriter(projectId, startMs) {
  const events = [];
  let time = startMs;

  const push = (eventType, extra, advanceMs) => {
    events.push(
      Object.assign(new AIRunEvent(), {
        _id: eventId(events.length + 1),
        projectId: new ObjectID(projectId),
        aiRunId: new ObjectID(TRIAGE_RUN_IDS.first),
        sequence: events.length + 1,
        eventType,
        createdAt: new Date(time),
        ...extra,
      }),
    );
    time += advanceMs;
  };

  const thinking = (durationInMs) => {
    push(AIRunEventType.LlmCallStarted, {}, durationInMs);
    push(AIRunEventType.LlmCallCompleted, {}, 200);
  };

  const tool = (toolName, rowCount, durationInMs) => {
    push(AIRunEventType.ToolCallStarted, { toolName }, durationInMs);
    push(
      AIRunEventType.ToolCallCompleted,
      { toolName, resultSummary: { rowCount, durationInMs } },
      300,
    );
  };

  return {
    events,
    push,
    thinking,
    tool,
    at: () => {
      return time;
    },
    setTime: (ms) => {
      time = ms;
    },
  };
}

/*
 * One attempt of the triage: it reads the trace and the code that runs the
 * query, the same search many times over, then waits on the provider.
 */
function attempt(writer, searches) {
  writer.push(AIRunEventType.RunStarted, {}, 400);
  writer.thinking(5200);
  writer.tool("get_trace", 20, 100);
  writer.tool("lookup_context", 2, 40);
  writer.thinking(4800);
  for (let index = 0; index < searches; index++) {
    writer.tool("search_code", [2, 20, 40, 26, 0, 2, 40, 29][index % 8], 40);
  }
  writer.thinking(5100);
  writer.tool("read_code_file", 113, 400);
  writer.tool("read_code_file", 229, 300);
  // The model call that ran out of time.
  writer.push(AIRunEventType.LlmCallStarted, {}, 120000);
  writer.push(
    AIRunEventType.LlmCallFailed,
    { resultSummary: { errorMessage: TRIAGE_TIMEOUT_ERROR } },
    0,
  );
}

// How an attempt ended, as AIRunRetryPolicy records it.
function attemptEnd(writer, eventType, end) {
  writer.push(
    eventType,
    {
      resultSummary: {
        errorMessage: TRIAGE_TIMEOUT_ERROR,
        attemptEnd: {
          failureKind: "ProviderTimeout",
          maxAttempts: 3,
          timeoutInSeconds: 120,
          ...end,
        },
      },
    },
    0,
  );
}

function newRun(projectId, createdAt) {
  return Object.assign(new AIRun(), {
    _id: TRIAGE_RUN_IDS.first,
    projectId: new ObjectID(projectId),
    runType: AIRunType.Investigation,
    createdAt,
  });
}

/*
 * The triage run of the slow finding, as the server answers it; `now` is
 * the page's clock, and `wasTriedAgain` whether Try again started a new run.
 */
export function triageRun(data) {
  const { projectId, now, wasTriedAgain } = data;

  // Try again started a new run: queued, nothing done yet.
  if (wasTriedAgain) {
    const run = Object.assign(newRun(projectId, new Date(now)), {
      _id: TRIAGE_RUN_IDS.again,
      status: AIRunStatus.Queued,
    });

    return {
      run: BaseModel.toJSONArray([run], AIRun)[0],
      events: [],
      mayTryAgain: false,
    };
  }

  if (triageMode === "none") {
    return { run: null, events: [], mayTryAgain: false };
  }

  const run = newRun(projectId, new Date(now - 42 * MINUTE));
  const writer = eventsWriter(projectId, now - 41 * MINUTE);

  if (triageMode === "failed" || triageMode === "failed-viewer") {
    for (let number = 1; number <= 3; number++) {
      attempt(writer, number === 3 ? 12 : 4);
      if (number < 3) {
        const nextAttemptAt = writer.at() + number * MINUTE;
        attemptEnd(writer, AIRunEventType.AttemptEnded, {
          outcome: "WillRetry",
          attempt: number,
          nextAttemptAt: new Date(nextAttemptAt).toISOString(),
        });
        writer.setTime(nextAttemptAt + 2000);
      } else {
        attemptEnd(writer, AIRunEventType.RunFailed, {
          outcome: "GaveUp",
          attempt: number,
        });
      }
    }
    run.status = AIRunStatus.Error;
    run.startedAt = new Date(now - 41 * MINUTE);
    run.completedAt = new Date(writer.at());
    run.errorMessage = TRIAGE_TIMEOUT_ERROR;
  } else if (triageMode === "retrying") {
    const retryAt = now + 50 * 1000;
    writer.setTime(now - 4 * MINUTE);
    attempt(writer, 4);
    attemptEnd(writer, AIRunEventType.AttemptEnded, {
      outcome: "WillRetry",
      attempt: 1,
      nextAttemptAt: new Date(retryAt).toISOString(),
    });
    run.status = AIRunStatus.Queued;
    run.createdAt = new Date(now - 4 * MINUTE - 3000);
    run.startedAt = new Date(now - 4 * MINUTE);
    run.retryAt = new Date(retryAt);
  } else {
    // Running: the first attempt ran out of time; the second thinks now.
    writer.setTime(now - 9 * MINUTE);
    attempt(writer, 4);
    const nextAttemptAt = writer.at() + MINUTE;
    attemptEnd(writer, AIRunEventType.AttemptEnded, {
      outcome: "WillRetry",
      attempt: 1,
      nextAttemptAt: new Date(nextAttemptAt).toISOString(),
    });
    writer.setTime(now - 40 * 1000);
    writer.push(AIRunEventType.RunStarted, {}, 400);
    writer.thinking(5200);
    writer.tool("get_trace", 20, 100);
    writer.push(AIRunEventType.LlmCallStarted, {}, 0);
    run.status = AIRunStatus.Running;
    run.startedAt = new Date(now - 9 * MINUTE);
  }

  return {
    run: BaseModel.toJSONArray([run], AIRun)[0],
    events: BaseModel.toJSONArray(writer.events, AIRunEvent),
    mayTryAgain: triageMode === "failed" && run.status === AIRunStatus.Error,
  };
}
