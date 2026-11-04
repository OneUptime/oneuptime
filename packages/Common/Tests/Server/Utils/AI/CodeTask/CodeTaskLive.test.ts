import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import CodeTaskLive, {
  MAX_REMEMBERED_RUN_TASKS,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskLive";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import Realtime from "../../../../../Server/Utils/Realtime";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import ObjectID from "../../../../../Types/ObjectID";
import ModelEventType from "../../../../../Types/Realtime/ModelEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A TURN'S STEPS REACH THE PAGE AS THEY HAPPEN: every change of a code-fix
 * run - a line it reports, its end, a stop - is announced as a live update
 * of the run (its own room, where its Log listens) and, for a reply, of its
 * task (where the conversation listens). The announcement goes through the
 * run's service, so who hears it is who may read the run.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");

type TriggerSpy = jest.SpiedFunction<typeof AIRunService.onTriggerRealtime>;
type FindRunSpy = jest.SpiedFunction<typeof AIRunService.findOneById>;

let triggered: TriggerSpy;
let findRun: FindRunSpy;

function runOf(id: ObjectID, codeTaskId?: ObjectID): AIRun {
  const run: AIRun = new AIRun();
  run._id = id.toString();
  if (codeTaskId) {
    run.codeTaskId = codeTaskId;
  }
  return run;
}

// The records announced, in order, each as [id, project, kind].
function announced(): Array<[string, string, ModelEventType]> {
  return triggered.mock.calls.map(
    (call: Parameters<typeof AIRunService.onTriggerRealtime>) => {
      return [call[0].toString(), call[1].toString(), call[2]];
    },
  );
}

beforeEach(() => {
  CodeTaskLive.forgetRunTasks();
  jest.spyOn(Realtime, "isInitialized").mockReturnValue(true);
  triggered = jest
    .spyOn(AIRunService, "onTriggerRealtime")
    .mockResolvedValue(undefined);
  findRun = jest.spyOn(AIRunService, "findOneById").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
  CodeTaskLive.forgetRunTasks();
});

describe("CodeTaskLive.announce", () => {
  test("a task's first turn is announced once, in its own room - the task's", async () => {
    findRun.mockResolvedValue(runOf(TASK_ID));

    await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: TASK_ID });

    expect(announced()).toEqual([
      [TASK_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
    ]);
  });

  test("a reply is announced in its own room and in its task's", async () => {
    findRun.mockResolvedValue(runOf(REPLY_ID, TASK_ID));

    await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID });

    expect(announced()).toEqual([
      [REPLY_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
      [TASK_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
    ]);
  });

  test("the run's task is read as root, once per run: every later line of it reads nothing", async () => {
    findRun.mockResolvedValue(runOf(REPLY_ID, TASK_ID));

    for (let line: number = 0; line < 5; line++) {
      await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID });
    }

    expect(findRun).toHaveBeenCalledTimes(1);
    expect(findRun.mock.calls[0]![0]).toEqual({
      id: REPLY_ID,
      select: { _id: true, codeTaskId: true },
      props: { isRoot: true },
    });
    // Two rooms a line, five lines.
    expect(triggered).toHaveBeenCalledTimes(10);
  });

  test("a caller that holds the run names its task: nothing is read", async () => {
    await CodeTaskLive.announce({
      projectId: PROJECT_ID,
      runId: REPLY_ID,
      codeTaskId: TASK_ID,
    });
    await CodeTaskLive.announce({
      projectId: PROJECT_ID,
      runId: TASK_ID,
      codeTaskId: null,
    });

    expect(findRun).not.toHaveBeenCalled();
    expect(announced()).toEqual([
      [REPLY_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
      [TASK_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
      [TASK_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
    ]);
  });

  test("a run not found is announced as itself, and read again next time", async () => {
    await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID });
    await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID });

    expect(findRun).toHaveBeenCalledTimes(2);
    expect(announced()).toEqual([
      [REPLY_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
      [REPLY_ID.toString(), PROJECT_ID.toString(), ModelEventType.Update],
    ]);
  });

  test("a process that holds no socket server announces nothing and reads nothing", async () => {
    (Realtime.isInitialized as unknown as jest.Mock).mockReturnValue(false);

    await CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID });

    expect(findRun).not.toHaveBeenCalled();
    expect(triggered).not.toHaveBeenCalled();
  });

  test("never throws: a read or an announcement that fails is only logged", async () => {
    findRun.mockRejectedValue(new Error("database gone"));

    await expect(
      CodeTaskLive.announce({ projectId: PROJECT_ID, runId: REPLY_ID }),
    ).resolves.toBeUndefined();

    triggered.mockRejectedValue(new Error("socket gone"));

    await expect(
      CodeTaskLive.announce({
        projectId: PROJECT_ID,
        runId: REPLY_ID,
        codeTaskId: TASK_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("the runs whose task is remembered are bounded: the oldest is let go", async () => {
    findRun.mockImplementation(async (data: { id: ObjectID }) => {
      return runOf(data.id, TASK_ID);
    });

    const first: ObjectID = ObjectID.generate();
    await CodeTaskLive.getTaskIdOf(first);

    for (let index: number = 0; index < MAX_REMEMBERED_RUN_TASKS; index++) {
      await CodeTaskLive.getTaskIdOf(ObjectID.generate());
    }

    findRun.mockClear();

    // The first was let go for the newest: it is read again.
    await CodeTaskLive.getTaskIdOf(first);
    expect(findRun).toHaveBeenCalledTimes(1);
  });
});

describe("CodeTaskLive.getAnnouncedIds", () => {
  test("a reply's task, but never the same run twice, whatever its case", () => {
    expect(
      CodeTaskLive.getAnnouncedIds({
        runId: REPLY_ID.toString(),
        taskId: TASK_ID.toString(),
      }),
    ).toEqual([REPLY_ID.toString(), TASK_ID.toString()]);

    expect(
      CodeTaskLive.getAnnouncedIds({
        runId: TASK_ID.toString(),
        taskId: TASK_ID.toString().toUpperCase(),
      }),
    ).toEqual([TASK_ID.toString()]);

    expect(
      CodeTaskLive.getAnnouncedIds({ runId: TASK_ID.toString(), taskId: null }),
    ).toEqual([TASK_ID.toString()]);
  });
});

describe("what announces a change", () => {
  test("every event appended to a run - a line the Runner reports, its end - is announced after it is written", async () => {
    const order: Array<string> = [];

    jest.spyOn(AIRunEventService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 4;
      },
    } as never);
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        order.push("created");
        return (data as { data: unknown }).data as never;
      });
    const announce: jest.SpiedFunction<typeof CodeTaskLive.announce> = jest
      .spyOn(CodeTaskLive, "announce")
      .mockImplementation(async () => {
        order.push("announced");
      });

    await AIRunEventService.appendEventToRun({
      projectId: PROJECT_ID,
      aiRunId: REPLY_ID,
      eventType: AIRunEventType.ProgressLog,
      toolName: "read_file",
      resultSummary: { message: "read src/a.ts", severity: "Information" },
    });

    expect(order).toEqual(["created", "announced"]);
    expect(announce).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      runId: REPLY_ID,
    });
  });

  test("an event that could not be written announces nothing", async () => {
    jest.spyOn(AIRunEventService, "countBy").mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
    jest
      .spyOn(AIRunEventService, "create")
      .mockRejectedValue(new Error("database gone"));
    const announce: jest.SpiedFunction<typeof CodeTaskLive.announce> = jest
      .spyOn(CodeTaskLive, "announce")
      .mockResolvedValue(undefined);

    await AIRunEventService.appendEventToRun({
      projectId: PROJECT_ID,
      aiRunId: REPLY_ID,
      eventType: AIRunEventType.RunCompleted,
    });

    expect(announce).not.toHaveBeenCalled();
  });

  test("a stop is announced for each turn it stopped, naming the task - and not for a turn another actor finished first", async () => {
    const task: AIRun = runOf(TASK_ID);
    task.status = AIRunStatus.Running;

    const reply: AIRun = runOf(REPLY_ID, TASK_ID);
    reply.status = AIRunStatus.Queued;

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(task);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([reply]);
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockImplementation(async (data: { aiRunId: ObjectID }) => {
        // The reply had just finished on its own: its transition is lost.
        return data.aiRunId.toString() === TASK_ID.toString() ? 1 : 0;
      });
    const announce: jest.SpiedFunction<typeof CodeTaskLive.announce> = jest
      .spyOn(CodeTaskLive, "announce")
      .mockResolvedValue(undefined);

    const stopped: number = await CodeTaskRuns.stop({
      projectId: PROJECT_ID,
      task: task,
      stoppedByName: "Ada Lovelace",
    });

    expect(stopped).toBe(1);
    expect(announce.mock.calls).toEqual([
      [{ projectId: PROJECT_ID, runId: task.id!, codeTaskId: null }],
    ]);
  });

  test("a stopped reply names its task, so the conversation hears it", async () => {
    const task: AIRun = runOf(TASK_ID);
    task.status = AIRunStatus.Completed;

    const reply: AIRun = runOf(REPLY_ID, TASK_ID);
    reply.status = AIRunStatus.Running;

    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([reply]);
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    const announce: jest.SpiedFunction<typeof CodeTaskLive.announce> = jest
      .spyOn(CodeTaskLive, "announce")
      .mockResolvedValue(undefined);

    await CodeTaskRuns.stop({
      projectId: PROJECT_ID,
      task: task,
      stoppedByName: "",
    });

    expect(announce.mock.calls).toEqual([
      [{ projectId: PROJECT_ID, runId: reply.id!, codeTaskId: task.id! }],
    ]);
  });
});
