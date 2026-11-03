import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeTaskPresenter, {
  CODE_TASK_STEP_EVENT_SELECT,
  MAX_STEPS_PER_TURN,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  CodeTaskState,
  CodeTaskStepKind,
  CodeTaskTurnProgressJSON,
} from "../../../../../Types/AI/CodeTask";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * How a turn AI is working on stands, and the steps it took since the page
 * last read it: what a task's conversation reads as each step is announced
 * (CodeTaskLive), instead of the whole task with every turn's diff.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");

type FindRunSpy = jest.SpiedFunction<typeof AIRunService.findOneBy>;
type FindEventsSpy = jest.SpiedFunction<typeof AIRunEventService.findBy>;

let findRun: FindRunSpy;
let findEvents: FindEventsSpy;

function task(): AIRun {
  const run: AIRun = new AIRun();
  run._id = TASK_ID.toString();
  run.projectId = PROJECT_ID;
  return run;
}

function turn(data: {
  id: ObjectID;
  status: AIRunStatus;
  startedAt?: string;
  needsUserInput?: boolean;
}): AIRun {
  const run: AIRun = new AIRun();
  run._id = data.id.toString();
  run.status = data.status;
  run.needsUserInput = Boolean(data.needsUserInput);
  if (data.startedAt) {
    run.startedAt = new Date(data.startedAt);
  }
  return run;
}

function toolLine(
  sequence: number,
  toolName: string,
  narration: string,
): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent();
  event.sequence = sequence;
  event.eventType = AIRunEventType.ProgressLog;
  event.toolName = toolName;
  event.resultSummary = {
    message: `[2026-11-03 10:00:0${sequence % 10}] [INFO   ] [Agent] ${narration}`,
    severity: "Information",
  };
  return event;
}

function plainLine(sequence: number, narration: string): AIRunEvent {
  const event: AIRunEvent = new AIRunEvent();
  event.sequence = sequence;
  event.eventType = AIRunEventType.ProgressLog;
  event.resultSummary = {
    message: `[2026-11-03 10:00:0${sequence % 10}] [INFO   ] [Agent] ${narration}`,
    severity: "Information",
  };
  return event;
}

// The least sequence a read of events asks for: `(sequence >= :x)`.
const LEAST_SEQUENCE_SQL: RegExp = /^\(sequence >= :(\w+)\)$/;

function leastSequenceOf(condition: unknown): number | null {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
  const sql: string = operator.getSql ? operator.getSql("sequence") : "";
  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters as Record<string, unknown>) || {};
  const match: RegExpMatchArray | null = sql.match(LEAST_SEQUENCE_SQL);

  return match ? (parameters[match[1]!] as number) : null;
}

function eventsReadFrom(): number | null {
  return leastSequenceOf(
    (findEvents.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
      "sequence"
    ],
  );
}

async function progressOf(data: {
  runId: ObjectID;
  afterSequence: number;
}): Promise<CodeTaskTurnProgressJSON | null> {
  return await CodeTaskPresenter.getTurnProgress({
    projectId: PROJECT_ID,
    task: task(),
    runId: data.runId,
    afterSequence: data.afterSequence,
  });
}

beforeEach(() => {
  findRun = jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(
    turn({
      id: TASK_ID,
      status: AIRunStatus.Running,
      startedAt: "2026-11-03T10:00:00.000Z",
    }),
  );
  findEvents = jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskPresenter.getTurnProgress", () => {
  test("says how the turn stands: working, picked up by a Runner, since when", async () => {
    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: -1,
    });

    expect(progress).toEqual({
      runId: TASK_ID.toString(),
      status: AIRunStatus.Running,
      state: CodeTaskState.Working,
      isQueued: false,
      startedAt: "2026-11-03T10:00:00.000Z",
      steps: [],
      hasMore: false,
    });
  });

  test("a turn no Runner has picked up yet is queued, and has no start", async () => {
    findRun.mockResolvedValue(
      turn({ id: TASK_ID, status: AIRunStatus.Queued }),
    );

    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: -1,
    });

    expect(progress?.isQueued).toBe(true);
    expect(progress?.state).toBe(CodeTaskState.Working);
    expect(progress?.startedAt).toBeUndefined();
  });

  test("a turn that ended says so: the page then reads the whole task", async () => {
    findRun.mockResolvedValue(
      turn({ id: TASK_ID, status: AIRunStatus.Completed, needsUserInput: true }),
    );

    expect((await progressOf({ runId: TASK_ID, afterSequence: 3 }))?.state).toBe(
      CodeTaskState.WaitingForYou,
    );
  });

  test("the task's first turn is read as the task itself, pinned to the project and to code-fix runs, as root", async () => {
    await progressOf({ runId: TASK_ID, afterSequence: -1 });

    expect(findRun.mock.calls[0]![0]).toEqual({
      query: {
        _id: TASK_ID.toString(),
        projectId: PROJECT_ID,
        runType: AIRunType.CodeFix,
      },
      select: {
        _id: true,
        status: true,
        needsUserInput: true,
        startedAt: true,
      },
      props: { isRoot: true },
    });
  });

  test("a reply is read only as a turn of this task: another task's run is none of its turns", async () => {
    findRun.mockResolvedValue(
      turn({ id: REPLY_ID, status: AIRunStatus.Running }),
    );

    await progressOf({ runId: REPLY_ID, afterSequence: -1 });

    expect(
      (findRun.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({
      _id: REPLY_ID.toString(),
      projectId: PROJECT_ID,
      runType: AIRunType.CodeFix,
      codeTaskId: TASK_ID,
    });
  });

  test("a run that is not a turn of the task is no progress at all, and no event is read", async () => {
    findRun.mockResolvedValue(null);

    await expect(
      progressOf({ runId: REPLY_ID, afterSequence: -1 }),
    ).resolves.toBeNull();
    expect(findEvents).not.toHaveBeenCalled();
  });

  test("reads the events from the step the page has, oldest first, without any tool's arguments or output", async () => {
    await progressOf({ runId: TASK_ID, afterSequence: 7 });

    const read: {
      query: Record<string, unknown>;
      select: unknown;
      sort: unknown;
      limit: number;
      props: unknown;
    } = findEvents.mock.calls[0]![0] as never;

    expect(read.query["aiRunId"]).toEqual(TASK_ID);
    // From the step the page has, so its plain copy is told apart.
    expect(eventsReadFrom()).toBe(7);
    expect(read.select).toEqual(CODE_TASK_STEP_EVENT_SELECT);
    expect(read.select).not.toHaveProperty("contentPayload");
    expect(read.select).not.toHaveProperty("toolArguments");
    expect(read.sort).toEqual({ sequence: "ASC" });
    expect(read.limit).toBe(MAX_STEPS_PER_TURN + 1);
    expect(read.props).toEqual({ isRoot: true });
  });

  test("sends only the steps after the one the page has, in plain words", async () => {
    findEvents.mockResolvedValue([
      toolLine(4, "read_file", "read src/a.ts"),
      toolLine(5, "write_file", "wrote src/a.ts (120 chars)"),
      toolLine(6, "run_command", "ran npm test (exit 0)"),
    ]);

    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: 4,
    });

    expect(
      progress?.steps.map((step: { sequence: number; kind: string }) => {
        return [step.sequence, step.kind];
      }),
    ).toEqual([
      [5, CodeTaskStepKind.Edited],
      [6, CodeTaskStepKind.Ran],
    ]);
    expect(progress?.steps[0]?.subject).toBe("src/a.ts");
    expect(progress?.steps[1]?.subject).toBe("npm test");
  });

  test("a step's plain copy right after the step the page has is still told apart from a new note", async () => {
    findEvents.mockResolvedValue([
      // The step the page has...
      toolLine(9, "read_file", "read src/a.ts"),
      // ...its plain copy, which the conversation never shows...
      plainLine(10, "read src/a.ts"),
      // ...and a new note.
      plainLine(11, "Created branch oneuptime/fix-timeout"),
    ]);

    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: 9,
    });

    expect(
      progress?.steps.map((step: { sequence: number; subject: string }) => {
        return [step.sequence, step.subject];
      }),
    ).toEqual([[11, "Created branch oneuptime/fix-timeout"]]);
  });

  test("a page with no step yet reads from the first event", async () => {
    findEvents.mockResolvedValue([toolLine(0, "list_directory", "listed src")]);

    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: -1,
    });

    expect(eventsReadFrom()).toBe(0);
    expect(progress?.steps).toHaveLength(1);
    expect(progress?.steps[0]?.kind).toBe(CodeTaskStepKind.Listed);
  });

  test("more steps than one read sends: says so, so the page reads the whole task", async () => {
    findEvents.mockResolvedValue(
      Array.from(
        { length: MAX_STEPS_PER_TURN + 1 },
        (_value: unknown, index: number): AIRunEvent => {
          return toolLine(index, "read_file", `read src/file-${index}.ts`);
        },
      ),
    );

    const progress: CodeTaskTurnProgressJSON | null = await progressOf({
      runId: TASK_ID,
      afterSequence: -1,
    });

    expect(progress?.hasMore).toBe(true);
    expect(progress?.steps).toHaveLength(MAX_STEPS_PER_TURN);
  });
});
