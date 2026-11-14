import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import UserService from "../../../../../Server/Services/UserService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../../Server/Types/Database/FindOneBy";
import logger from "../../../../../Server/Utils/Logger";
import CodeTaskAgentBrief, {
  ENTRIES_PER_REPLY_TURN,
  MAX_CONVERSATION_LENGTH,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskPresenter, {
  TURN_NOT_SHOWN_SELECT,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskThread, {
  CodeTaskNumberedTurn,
  CodeTaskTurnsRead,
  MAX_TURNS_PER_TASK,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import User from "../../../../../Models/DatabaseModels/User";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import {
  CodeTaskAgentDetails,
  CodeTaskAgentTurn,
  CodeTaskConversationJSON,
  CodeTaskFileStatus,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "../../../../../Types/AI/CodeTask";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import {
  askedAt,
  holdLongCodeTask,
  LongCodeTask,
  LongTaskRead,
  LongTaskStatement,
  LONG_TASK_PROJECT_ID,
  LONG_TASK_REPOSITORY_ID,
  LONG_TASK_USER_ID,
  LONG_TASK_WORK_MS_PER_TURN,
  turnFile,
  turnId,
  turnMessage,
  turnNumber,
  turnReply,
} from "./LongCodeTaskFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
/*
 * The spy type of the jest imported above; the global jest.SpiedFunction
 * does not accept what its jest.spyOn() returns.
 */
import type { SpyInstance } from "jest-mock";

/*
 * A CODE TASK KEPT OPEN AS A WORKING THREAD FOR WEEKS (issue #6529).
 *
 * A task is a conversation: its first turn, then a reply per turn. Past 200
 * turns, the Runner was briefed from the OLDEST turns and the task's page
 * stopped at turn 200 - and a reply could open a second pull request,
 * because the open one was opened by a turn past the 200th. These run a
 * task of any length through the code that reads it - its sort, limit and
 * count - against the task held in memory (LongCodeTaskFixtures):
 *
 *  - a conversation is its first turn and its NEWEST 199 replies, and says
 *    how many replies between them it leaves out;
 *  - a reply is briefed from the turns right before it, and pushes to the
 *    task's open pull request whichever turn opened it;
 *  - the task's page shows the first turn and the newest, says how many
 *    are not shown, and still adds up every turn at its top: the files
 *    changed, how long AI worked, its pull request and its state;
 *  - a link to a turn the page does not show (the Log page's ?turn=)
 *    sends that turn, with its place in the task (issue #7130);
 *  - a read that stops at its limit says so in the log, and reads the
 *    newest rows it can - never the oldest (issue #7131).
 */

afterEach(() => {
  jest.restoreAllMocks();
});

// Every number from `from` to `to`, both included.
function range(from: number, to: number): Array<number> {
  const numbers: Array<number> = [];

  for (let n: number = from; n <= to; n++) {
    numbers.push(n);
  }

  return numbers;
}

function numbersOf(runs: Array<AIRun>): Array<number> {
  return runs.map((run: AIRun): number => {
    return turnNumber(run.id);
  });
}

function jane(): User {
  const user: User = new User();
  user._id = LONG_TASK_USER_ID.toString();
  user.name = new Name("Jane Doe");
  return user;
}

function repository(): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value._id = LONG_TASK_REPOSITORY_ID.toString();
  value.projectId = LONG_TASK_PROJECT_ID;
  value.name = "users-api";
  value.organizationName = "acme";
  value.repositoryName = "users-api";
  value.mainBranchName = "main";
  return value;
}

// A read's arguments, as the service was asked.
function argsOf(read: LongTaskRead): FindBy<AIRun> {
  return read.args as FindBy<AIRun>;
}

async function readTurns(
  fixture: LongCodeTask,
  createdBefore?: Date,
): Promise<CodeTaskTurnsRead> {
  return await CodeTaskThread.getTurns({
    projectId: LONG_TASK_PROJECT_ID,
    task: fixture.task(),
    ...(createdBefore ? { createdBefore } : {}),
  });
}

describe("a task's turns, however many", () => {
  test("is a conversation of MAX_TURNS_PER_TASK turns at most: 200", () => {
    expect(MAX_TURNS_PER_TASK).toBe(200);
  });

  test("205 turns: the first, then the newest 199 replies oldest first - and the 5 between are counted, not read", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(read.turns).toHaveLength(200);
    expect(numbersOf(read.turns)).toEqual([1, ...range(7, 205)]);
    expect(read.olderTurnsLeftOut).toBe(5);
    // The first turn is the task as passed, never read again.
    expect(read.turns[0]).toBe(fixture.task());

    const [replies]: Array<LongTaskRead> = fixture.readsOf("AIRun", "findBy");
    const asked: FindBy<AIRun> = argsOf(replies!);

    // The newest replies: one read, newest first, as many as fit.
    expect(asked.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(asked.limit).toBe(MAX_TURNS_PER_TASK - 1);
    expect(asked.props).toEqual({ isRoot: true });
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
    // A full read counts the task's replies: one count.
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(1);
  });

  test("201 turns: one left out - the task's second turn", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 201 });

    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(numbersOf(read.turns)).toEqual([1, ...range(3, 201)]);
    expect(read.olderTurnsLeftOut).toBe(1);
  });

  test("exactly 200 turns: every one, none left out - the count says so", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 200 });

    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(numbersOf(read.turns)).toEqual(range(1, 200));
    expect(read.olderTurnsLeftOut).toBe(0);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(1);
  });

  test("a task under the limit is read in one query, as it always was, and nothing is counted", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });

    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(numbersOf(read.turns)).toEqual(range(1, 12));
    expect(read.olderTurnsLeftOut).toBe(0);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(0);
  });

  test("a task of one turn is that turn, and its replies are still asked for once", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 1 });

    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(numbersOf(read.turns)).toEqual([1]);
    expect(read.olderTurnsLeftOut).toBe(0);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(0);
  });

  test("the replies read, and the ones counted, are this task's code-fix runs of this project only", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    await readTurns(fixture);

    for (const read of [
      ...fixture.readsOf("AIRun", "findBy"),
      ...fixture.readsOf("AIRun", "countBy"),
    ]) {
      const query: Record<string, unknown> = argsOf(read).query as Record<
        string,
        unknown
      >;

      expect(String(query["projectId"])).toBe(LONG_TASK_PROJECT_ID.toString());
      expect(query["runType"]).toBe(AIRunType.CodeFix);
      expect(String(query["codeTaskId"])).toBe(turnId(1).toString());
    }
  });

  test("createdBefore reads the conversation as it stood when a turn was asked", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    // Before turn 150: its 148 replies fit whole.
    const at150: CodeTaskTurnsRead = await readTurns(fixture, askedAt(150));

    expect(numbersOf(at150.turns)).toEqual(range(1, 149));
    expect(at150.olderTurnsLeftOut).toBe(0);

    // Before turn 205: the newest 199 of its 203 replies, 4 left out.
    const at205: CodeTaskTurnsRead = await readTurns(fixture, askedAt(205));

    expect(numbersOf(at205.turns)).toEqual([1, ...range(6, 204)]);
    expect(at205.olderTurnsLeftOut).toBe(4);
  });
});

describe("the turns a long task's conversation leaves out", () => {
  test("are its turns 2 to 6 for 205 turns, oldest first, read with only what is asked for", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      read,
      select: TURN_NOT_SHOWN_SELECT,
    });

    expect(numbersOf(leftOut)).toEqual([2, 3, 4, 5, 6]);
    expect(leftOut).toHaveLength(read.olderTurnsLeftOut);

    // What the task's page adds up - never what was asked, or the diff.
    expect(leftOut[0]!.taskOutcome?.summary).toBe(turnReply(2));
    expect(leftOut[0]!.startedAt).toBeDefined();
    expect(leftOut[0]!.taskContext).toBeUndefined();
    expect(leftOut[0]!.userId).toBeUndefined();

    const [, leftOutRead]: Array<LongTaskRead> = fixture.readsOf(
      "AIRun",
      "findBy",
    );

    expect(argsOf(leftOutRead!).select).toEqual(TURN_NOT_SHOWN_SELECT);
    // The newest first, as far as one read takes: then put oldest first.
    expect(argsOf(leftOutRead!).sort).toEqual({
      createdAt: SortOrder.Descending,
    });
    expect(argsOf(leftOutRead!).limit).toBe(LIMIT_PER_PROJECT);
  });

  /*
   * A task with more turns between its first and its newest 199 than one
   * read takes: the turns nearest the newest are read - what the page adds
   * up is the task as it stands now - and the oldest are counted, not
   * read. Never silently: the log says which task was cut.
   */
  test("more than one read takes: the 10,000 nearest the newest are read, the oldest 5 counted - and the log says so", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({
      turnCount: MAX_TURNS_PER_TASK + LIMIT_PER_PROJECT + 5,
    });
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(read.olderTurnsLeftOut).toBe(LIMIT_PER_PROJECT + 5);

    const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      read,
      select: TURN_NOT_SHOWN_SELECT,
    });

    // Turns 7 to 10,006, oldest first: turns 2 to 6 are the ones not read.
    expect(leftOut).toHaveLength(LIMIT_PER_PROJECT);
    expect(numbersOf(leftOut)).toEqual(range(7, LIMIT_PER_PROJECT + 6));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      `Code task ${turnId(1).toString()}: read the newest ${LIMIT_PER_PROJECT} turns its conversation does not show; the older ones were not read.`,
    );
    expect(warn.mock.calls[0]![1]).toEqual({
      projectId: LONG_TASK_PROJECT_ID.toString(),
      codeTaskId: turnId(1).toString(),
    });
  });

  test("negative control: turns not shown that one read takes whole are read whole, and nothing is logged", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    await CodeTaskThread.getTurnsLeftOut({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      read,
      select: TURN_NOT_SHOWN_SELECT,
    });
    await CodeTaskThread.getRunIds({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
    });

    expect(warn).not.toHaveBeenCalled();
  });

  test("none, and nothing read, for a task read whole", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 200 });
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    expect(
      await CodeTaskThread.getTurnsLeftOut({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
        read,
        select: TURN_NOT_SHOWN_SELECT,
      }),
    ).toEqual([]);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
  });

  test("a turn asked the same moment as the oldest one read is left out once - never read twice, never lost", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    // Turns 6 and 7 were asked the same moment: either may be the one read.
    fixture.turn(6).createdAt = askedAt(7);

    const read: CodeTaskTurnsRead = await readTurns(fixture);
    const leftOut: Array<AIRun> = await CodeTaskThread.getTurnsLeftOut({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      read,
      select: TURN_NOT_SHOWN_SELECT,
    });

    const shown: Array<number> = numbersOf(read.turns);
    const notShown: Array<number> = numbersOf(leftOut);

    expect(read.olderTurnsLeftOut).toBe(5);
    expect(notShown).toHaveLength(5);
    // Every turn once: shown, or left out.
    expect(
      [...shown, ...notShown].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(range(1, 205));
  });
});

describe("the pull request a reply pushes to, however long the task", () => {
  test("one opened by turn 203 of 205 - past the oldest 200 - is found, so no second pull request is opened", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 203, number: 77 });

    const working: AIAgentTaskPullRequest | null =
      await CodeTaskThread.findWorkingPullRequest({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
      });

    expect(working?.pullRequestNumber).toBe(77);
    expect(working?.headRefName).toBe("oneuptime-task-42-turn-203");
  });

  test("one opened by turn 3 - a turn the conversation no longer shows - is still the one", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 3, number: 31 });

    const working: AIAgentTaskPullRequest | null =
      await CodeTaskThread.findWorkingPullRequest({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
      });

    expect(working?.pullRequestNumber).toBe(31);
  });

  test("the newest still open: an older turn's merged one is not built on", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({
      turn: 3,
      number: 31,
      state: PullRequestState.Merged,
    });
    fixture.openPullRequest({ turn: 203, number: 77 });

    expect(
      (
        await CodeTaskThread.findWorkingPullRequest({
          projectId: LONG_TASK_PROJECT_ID,
          task: fixture.task(),
        })
      )?.pullRequestNumber,
    ).toBe(77);
  });

  test("an older turn's still open is built on when the newest was merged", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 3, number: 31 });
    fixture.openPullRequest({
      turn: 204,
      number: 78,
      state: PullRequestState.Merged,
    });

    expect(
      (
        await CodeTaskThread.findWorkingPullRequest({
          projectId: LONG_TASK_PROJECT_ID,
          task: fixture.task(),
        })
      )?.pullRequestNumber,
    ).toBe(31);
  });

  test("none open: none, and the reply starts a new branch", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({
      turn: 203,
      number: 77,
      state: PullRequestState.Closed,
    });

    expect(
      await CodeTaskThread.findWorkingPullRequest({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
      }),
    ).toBeNull();
  });

  test("every run of the task is read by id - task first, then newest first - in one read of ids only", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const runIds: Array<ObjectID> = await CodeTaskThread.getRunIds({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
    });

    expect(
      runIds.map((id: ObjectID): number => {
        return turnNumber(id);
      }),
    ).toEqual([1, ...range(2, 205).reverse()]);

    const [idsRead]: Array<LongTaskRead> = fixture.readsOf("AIRun", "findBy");

    expect(argsOf(idsRead!).select).toEqual({ _id: true });
    expect(argsOf(idsRead!).limit).toBe(LIMIT_PER_PROJECT);
    expect(argsOf(idsRead!).sort).toEqual({ createdAt: SortOrder.Descending });
  });

  test("a task of more replies than one read takes: its newest 10,000 are the ones read - and the log says so", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({
      turnCount: LIMIT_PER_PROJECT + 6,
    });
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    const runIds: Array<ObjectID> = await CodeTaskThread.getRunIds({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
    });

    // The task, then turns 10,006 down to 7: turns 2 to 6 are not read.
    expect(runIds).toHaveLength(LIMIT_PER_PROJECT + 1);
    expect(turnNumber(runIds[0])).toBe(1);
    expect(turnNumber(runIds[1])).toBe(LIMIT_PER_PROJECT + 6);
    expect(turnNumber(runIds[runIds.length - 1])).toBe(7);
    expect(warn).toHaveBeenCalledWith(
      `Code task ${turnId(1).toString()}: read the newest ${LIMIT_PER_PROJECT} replies, for its pull requests; the older ones were not read.`,
      {
        projectId: LONG_TASK_PROJECT_ID.toString(),
        codeTaskId: turnId(1).toString(),
      },
    );
  });

  test("a read of pull requests that stops at its limit says so in the log, with how many runs it read for", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    const findPullRequests: SpyInstance<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest.spyOn(AIAgentTaskPullRequestService, "findBy");

    findPullRequests.mockResolvedValue(
      Array.from({ length: LIMIT_PER_PROJECT - 1 }, () => {
        return new AIAgentTaskPullRequest();
      }),
    );

    await CodeTaskThread.getPullRequests({
      projectId: LONG_TASK_PROJECT_ID,
      runIds: [turnId(1), turnId(2)],
    });

    // One short of the limit: every one was read.
    expect(warn).not.toHaveBeenCalled();

    findPullRequests.mockResolvedValue(
      Array.from({ length: LIMIT_PER_PROJECT }, () => {
        return new AIAgentTaskPullRequest();
      }),
    );

    await CodeTaskThread.getPullRequests({
      projectId: LONG_TASK_PROJECT_ID,
      runIds: [turnId(1), turnId(2)],
    });

    expect(warn).toHaveBeenCalledWith(
      `Code tasks: read the newest ${LIMIT_PER_PROJECT} pull requests their runs opened; the older ones were not read.`,
      { projectId: LONG_TASK_PROJECT_ID.toString(), runCount: 2 },
    );
    // Newest first: the ones a page shows are the ones read.
    expect(
      (findPullRequests.mock.calls[1]![0] as FindBy<AIAgentTaskPullRequest>)
        .sort,
    ).toEqual({ createdAt: SortOrder.Descending });
  });

  test("a read that holds every turn names the runs itself: nothing more is read", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });
    fixture.openPullRequest({ turn: 4, number: 41 });
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await CodeTaskThread.getTaskPullRequests({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
        read,
      });

    expect(
      pullRequests.map((each: AIAgentTaskPullRequest): number | undefined => {
        return each.pullRequestNumber;
      }),
    ).toEqual([41]);
    // The turns' read only: no read of ids.
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
  });

  test("a read that left turns out does not name them: every run's id is read", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 4, number: 41 });
    const read: CodeTaskTurnsRead = await readTurns(fixture);

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await CodeTaskThread.getTaskPullRequests({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
        read,
      });

    expect(
      pullRequests.map((each: AIAgentTaskPullRequest): number | undefined => {
        return each.pullRequestNumber;
      }),
    ).toEqual([41]);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(2);
  });
});

describe("what a Runner is told when it takes a turn of a long task", () => {
  beforeEach(() => {
    jest.spyOn(UserService, "findBy").mockResolvedValue([jane()]);
  });

  async function brief(run: AIRun): Promise<CodeTaskAgentDetails> {
    return await CodeTaskAgentBrief.build({ run, repository: repository() });
  }

  function askedTexts(details: CodeTaskAgentDetails): Array<string> {
    return details.conversation
      .filter((entry: CodeTaskAgentTurn): boolean => {
        return entry.role === "person";
      })
      .map((entry: CodeTaskAgentTurn): string => {
        return entry.text;
      });
  }

  test("turn 205 is briefed from the turns right before it - 7 to 204 - never from the oldest, and the first turn is kept", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    expect(details.request.message).toBe(turnMessage(205));
    expect(askedTexts(details)).toEqual([
      turnMessage(1),
      ...range(7, 204).map(turnMessage),
    ]);

    // What AI answered the turn right before this one is the last thing said.
    const last: CodeTaskAgentTurn =
      details.conversation[details.conversation.length - 1]!;

    expect(last.role).toBe("ai");
    expect(last.text).toContain(turnReply(204));
    expect(last.text).toContain(`Changed: ${turnFile(204)}`);
    expect(JSON.stringify(details.conversation)).not.toContain(turnReply(205));
  });

  test("says how many entries it leaves out: each turn left out is what was asked and what AI answered", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    expect(ENTRIES_PER_REPLY_TURN).toBe(2);
    // Turns 2 to 6, a request and a reply each; nothing cut to fit.
    expect(details.omittedTurns).toBe(5 * ENTRIES_PER_REPLY_TURN);
    expect(details.conversation).toHaveLength(2 * 199);
  });

  test("a conversation too long to send is cut too: the entries cut and the turns left out are both counted", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    for (const run of fixture.runs) {
      run.taskOutcome!.summary = `${turnReply(turnNumber(run.id))} ${"x".repeat(5000)}`;
    }

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    const conversation: Array<CodeTaskAgentTurn> = details.conversation;

    // The first turn, then the newest that fit.
    expect(conversation[0]!.text).toBe(turnMessage(1));
    expect(conversation[conversation.length - 1]!.text).toContain(
      turnReply(204),
    );
    expect(conversation.length).toBeLessThan(2 * 199);

    const sent: number = conversation.reduce(
      (sum: number, entry: CodeTaskAgentTurn): number => {
        return sum + entry.text.length;
      },
      0,
    );

    expect(sent).toBeLessThanOrEqual(MAX_CONVERSATION_LENGTH);
    // 398 entries read: every one not sent, and turns 2 to 6's 10.
    expect(details.omittedTurns).toBe(2 * 199 - conversation.length + 10);
  });

  test("a reply pushes to the open pull request turn 203 opened - not a new branch", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 203, number: 77 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    expect(details.workingBranch).toBe("oneuptime-task-42-turn-203");
    expect(details.pullRequest).toEqual({
      number: 77,
      url: "https://github.com/acme/users-api/pull/77",
      title: "Pull request of turn 203",
      baseRefName: "main",
    });
  });

  test("and to the one turn 4 opened, a turn the brief no longer reads", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 4, number: 41 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    expect(details.workingBranch).toBe("oneuptime-task-42-turn-4");
    expect(details.pullRequest?.number).toBe(41);
    // Turn 4 is not in the conversation, so nothing there names it.
    expect(JSON.stringify(details.conversation)).not.toContain("#41");
  });

  test("the turn 203 that opened it says so in the conversation", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 203, number: 77 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    const answered203: CodeTaskAgentTurn | undefined =
      details.conversation.find((entry: CodeTaskAgentTurn): boolean => {
        return entry.role === "ai" && entry.text.includes(turnReply(203));
      });

    expect(answered203?.text).toContain(
      "Opened pull request #77: Pull request of turn 203",
    );
  });

  test("the task's first turn is briefed with no conversation and nothing left out, however long the task grew", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(1));

    expect(details.conversation).toEqual([]);
    expect(details.omittedTurns).toBe(0);
  });

  test("a turn older than every turn read - one asked while another worked - is briefed from the turns before it", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(5));

    expect(details.request.message).toBe(turnMessage(5));
    expect(askedTexts(details)).toEqual([1, 2, 3, 4].map(turnMessage));
    expect(details.omittedTurns).toBe(0);
  });

  test("such a turn read without when it was asked (as the Runner's API reads it) has that read on its own", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    const asTheApiReadsIt: AIRun = new AIRun();
    asTheApiReadsIt._id = turnId(5).toString();
    asTheApiReadsIt.projectId = LONG_TASK_PROJECT_ID;
    asTheApiReadsIt.codeTaskId = turnId(1);
    asTheApiReadsIt.userId = LONG_TASK_USER_ID;
    asTheApiReadsIt.taskContext = fixture.turn(5).taskContext!;

    const details: CodeTaskAgentDetails = await brief(asTheApiReadsIt);

    expect(askedTexts(details)).toEqual([1, 2, 3, 4].map(turnMessage));

    const [whenAsked]: Array<LongTaskRead> = fixture.readsOf(
      "AIRun",
      "findOneById",
    );

    expect(whenAsked?.args).toMatchObject({
      select: { _id: true, createdAt: true },
      props: { isRoot: true },
    });
  });

  test("a turn nothing says when it was asked is briefed with the first turn only", async () => {
    // The task's reads are answered from memory; the turn is none of its runs.
    holdLongCodeTask({ turnCount: 205 });
    const unknown: AIRun = new AIRun();
    unknown._id = ObjectID.generate().toString();
    unknown.projectId = LONG_TASK_PROJECT_ID;
    unknown.codeTaskId = turnId(1);
    unknown.taskContext = { request: { message: "Lost", context: [] } };

    const details: CodeTaskAgentDetails = await brief(unknown);

    expect(askedTexts(details)).toEqual([turnMessage(1)]);
    expect(details.omittedTurns).toBe(0);
  });

  test("a task under the limit is briefed as before: every turn before this one, one read of turns, no count", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });
    fixture.openPullRequest({ turn: 2, number: 21 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(12));

    expect(askedTexts(details)).toEqual(range(1, 11).map(turnMessage));
    expect(details.omittedTurns).toBe(0);
    expect(details.pullRequest?.number).toBe(21);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(0);
  });

  test("who asked this turn is named, however long the task", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture.turn(205));

    expect(details.requestedBy).toBe("Jane Doe");
    expect(details.conversation[0]!.author).toBe("Jane Doe");
  });
});

describe("a long task's page", () => {
  let eventReads: SpyInstance<typeof AIRunEventService.findBy>;

  beforeEach(() => {
    jest.spyOn(UserService, "findBy").mockResolvedValue([jane()]);
    eventReads = jest.spyOn(AIRunEventService, "findBy").mockResolvedValue([]);
  });

  async function conversationOf(
    fixture: LongCodeTask,
  ): Promise<CodeTaskConversationJSON> {
    return await CodeTaskPresenter.getConversation({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      canSeeChanges: true,
      props: { isRoot: true },
    });
  }

  function shownNumbers(conversation: CodeTaskConversationJSON): Array<number> {
    return conversation.turns.map((turn: CodeTaskTurnJSON): number => {
      return turnNumber(turn.runId);
    });
  }

  test("205 turns: the first and the newest 199 are shown, and the 5 between are counted with how long AI worked on them", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(shownNumbers(conversation)).toEqual([1, ...range(7, 205)]);
    expect(conversation.turnsNotShown).toEqual({
      count: 5,
      workMilliseconds: 5 * LONG_TASK_WORK_MS_PER_TURN,
    });
    expect(conversation.turns[0]!.request?.message).toBe(turnMessage(1));
    expect(conversation.turns[199]!.request?.message).toBe(turnMessage(205));
  });

  test("the task at the top is every turn's: 205 turns, the files all 205 changed, and its last moment", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(conversation.task.turnCount).toBe(205);
    expect(conversation.task.changes).toEqual({
      files: 205,
      // Turn n added n lines: 1 + 2 + ... + 205.
      additions: (205 * 206) / 2,
      deletions: 205,
    });
    expect(conversation.task.lastActivityAt).toBe(
      fixture.turn(205).completedAt!.toISOString(),
    );
    expect(conversation.task.latestReply).toBe(turnReply(205));
  });

  test("its state, and what AI last said, are its newest turn's - not turn 200's", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    const newest: AIRun = fixture.turn(205);
    newest.status = AIRunStatus.Running;
    delete newest.completedAt;
    delete newest.taskOutcome;

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(conversation.task.state).toBe(CodeTaskState.Working);
    // The turn still working has no reply yet: the one before it is what AI said.
    expect(conversation.task.latestReply).toBe(turnReply(204));
    expect(conversation.task.startedAt).toBe(newest.startedAt!.toISOString());
    expect(conversation.task).not.toHaveProperty("completedAt");
  });

  test("its pull request may be one a turn not shown opened", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 4, number: 41 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(conversation.task.pullRequest?.number).toBe(41);
    // No turn shown opened it.
    for (const turn of conversation.turns) {
      expect(turn.pullRequests).toEqual([]);
    }
  });

  test("a pull request a turn shown opened is shown on that turn, past the 200th", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 203, number: 77 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    const turn203: CodeTaskTurnJSON | undefined = conversation.turns.find(
      (turn: CodeTaskTurnJSON): boolean => {
        return turnNumber(turn.runId) === 203;
      },
    );

    expect(
      turn203?.pullRequests.map((each: { number?: number | undefined }) => {
        return each.number;
      }),
    ).toEqual([77]);
    expect(conversation.task.pullRequest?.number).toBe(77);
  });

  test("the steps of the turns shown are read - never of a turn not shown", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    await conversationOf(fixture);

    const stepsReadFor: Array<number> = eventReads.mock.calls.map(
      (call: Array<unknown>): number => {
        return turnNumber(
          (call[0] as FindBy<AIRunEvent>).query["aiRunId"] as ObjectID,
        );
      },
    );

    expect(
      stepsReadFor.sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual([1, ...range(7, 205)]);
  });

  test("the turns not shown are read once, with what the top needs - not their requests, steps or diffs", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    await conversationOf(fixture);

    const runReads: Array<LongTaskRead> = fixture.readsOf("AIRun", "findBy");

    // The newest turns, then the ones between.
    expect(runReads).toHaveLength(2);
    expect(argsOf(runReads[1]!).select).toEqual(TURN_NOT_SHOWN_SELECT);
    expect(TURN_NOT_SHOWN_SELECT).not.toHaveProperty("taskContext");
    expect(TURN_NOT_SHOWN_SELECT).not.toHaveProperty("codeChanges");
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(1);
    expect(fixture.readsOf("AIAgentTaskPullRequest", "findBy")).toHaveLength(1);
  });

  test("a task shown whole says nothing is left out - no key at all - and reads nothing more", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(shownNumbers(conversation)).toEqual(range(1, 12));
    expect(conversation).not.toHaveProperty("turnsNotShown");
    expect(conversation.task.turnCount).toBe(12);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(0);
  });

  test("exactly 200 turns: all shown, none counted as not shown", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 200 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(conversation.turns).toHaveLength(200);
    expect(conversation).not.toHaveProperty("turnsNotShown");
    expect(conversation.task.turnCount).toBe(200);
  });

  test("201 turns: turn 2 is the one not shown", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 201 });

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(shownNumbers(conversation)).toEqual([1, ...range(3, 201)]);
    expect(conversation.turnsNotShown).toEqual({
      count: 1,
      workMilliseconds: LONG_TASK_WORK_MS_PER_TURN,
    });
    expect(conversation.task.turnCount).toBe(201);
  });

  /*
   * The turns not shown are read in one read of at most LIMIT_PER_PROJECT:
   * a task with more than that between its first turn and its newest has
   * the rest counted, not read. The top still says how many turns it has -
   * as counted, not as read.
   */
  test("turns not shown past what one read takes still count at the top", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    // As if the read of the 5 not shown had stopped at its limit, after 2.
    jest
      .spyOn(CodeTaskThread, "getTurnsLeftOut")
      .mockResolvedValueOnce([fixture.turn(2), fixture.turn(3)]);

    const conversation: CodeTaskConversationJSON =
      await conversationOf(fixture);

    expect(conversation.task.turnCount).toBe(205);
    expect(conversation.turnsNotShown).toEqual({
      count: 5,
      // How long AI worked on the turns read: the rest were not.
      workMilliseconds: 2 * LONG_TASK_WORK_MS_PER_TURN,
    });
    expect(conversation.task.changes?.files).toBe(202);
  });

  /*
   * A LINK TO A TURN THE PAGE DOES NOT SHOW (issue #7130).
   *
   * The Log page's address names a turn by its run id (?turn=): one shared
   * in chat, or bookmarked when the task was shorter. The page asks for it
   * by name; when it is one of the task's turns the conversation does not
   * show, it comes back on its own - read as the turns shown are, with its
   * place in the task - so the Log opens that turn, never turn 1.
   */
  async function conversationLinking(
    fixture: LongCodeTask,
    linkedTurnId: ObjectID,
    canSeeChanges: boolean = true,
  ): Promise<CodeTaskConversationJSON> {
    return await CodeTaskPresenter.getConversation({
      projectId: LONG_TASK_PROJECT_ID,
      task: fixture.task(),
      canSeeChanges,
      props: { isRoot: true },
      linkedTurnId,
    });
  }

  function stepsReadOf(): Array<number> {
    return eventReads.mock.calls.map((call: Array<unknown>): number => {
      return turnNumber(
        (call[0] as FindBy<AIRunEvent>).query["aiRunId"] as ObjectID,
      );
    });
  }

  test("a link to turn 4 of 205 - a turn not shown - sends it with its place: what was asked, its reply, its steps and its pull request", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 4, number: 41 });

    const conversation: CodeTaskConversationJSON = await conversationLinking(
      fixture,
      turnId(4),
    );

    // The turns shown are the ones shown without the link.
    expect(shownNumbers(conversation)).toEqual([1, ...range(7, 205)]);
    expect(conversation.turnsNotShown?.count).toBe(5);

    expect(conversation.linkedTurn?.number).toBe(4);

    const linked: CodeTaskTurnJSON = conversation.linkedTurn!.turn;

    expect(turnNumber(linked.runId)).toBe(4);
    expect(linked.request?.message).toBe(turnMessage(4));
    expect(linked.outcome?.summary).toBe(turnReply(4));
    expect(linked.requestedBy?.name).toBe("Jane Doe");
    expect(
      linked.pullRequests.map((each: { number?: number | undefined }) => {
        return each.number;
      }),
    ).toEqual([41]);
    // Its steps are read with the turns shown: one read each.
    expect(stepsReadOf()).toContain(4);
    expect(stepsReadOf()).toHaveLength(201);
    expect(fixture.readsOf("AIAgentTaskPullRequest", "findBy")).toHaveLength(1);
  });

  test("the turn a link names is read pinned to this task, its project and code-fix runs - once, with its place counted by Postgres", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    await conversationLinking(fixture, turnId(3));

    const [found]: Array<LongTaskRead> = fixture.readsOf("AIRun", "findOneBy");
    const query: Record<string, unknown> = (found!.args as FindOneBy<AIRun>)
      .query as Record<string, unknown>;

    expect(fixture.readsOf("AIRun", "findOneBy")).toHaveLength(1);
    expect(String(query["_id"])).toBe(turnId(3).toString());
    expect(String(query["projectId"])).toBe(LONG_TASK_PROJECT_ID.toString());
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(String(query["codeTaskId"])).toBe(turnId(1).toString());

    const statements: Array<LongTaskRead> = fixture.readsOf("AIRun", "query");

    expect(statements).toHaveLength(1);
    expect((statements[0]!.args as LongTaskStatement).parameters).toEqual([
      LONG_TASK_PROJECT_ID.toString(),
      AIRunType.CodeFix,
      turnId(1).toString(),
      turnId(3).toString(),
    ]);
  });

  test("a reader who may not change the code is not sent the linked turn's diff - it is not even read", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.turn(4).codeChanges = {
      files: [
        {
          path: turnFile(4),
          status: CodeTaskFileStatus.Modified,
          additions: 4,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
      isTruncated: false,
    };

    const canChange: CodeTaskConversationJSON = await conversationLinking(
      fixture,
      turnId(4),
    );

    expect(canChange.linkedTurn?.turn.changes?.files[0]?.patch).toBe(
      "@@ -1 +1 @@\n-old\n+new",
    );

    const readOnly: CodeTaskConversationJSON = await conversationLinking(
      fixture,
      turnId(4),
      false,
    );

    expect(readOnly.linkedTurn?.turn.outcome?.filesChanged).toHaveLength(1);
    expect(readOnly.linkedTurn?.turn).not.toHaveProperty("changes");

    const [, readOnlyFind]: Array<LongTaskRead> = fixture.readsOf(
      "AIRun",
      "findOneBy",
    );

    expect(
      (readOnlyFind!.args as FindOneBy<AIRun>).select as Record<
        string,
        unknown
      >,
    ).not.toHaveProperty("codeChanges");
  });

  test.each([
    ["a turn the page shows", 150],
    ["the task's first turn", 1],
  ])(
    "a link to %s sends nothing on its own, and reads nothing more",
    async (_name: string, n: number) => {
      const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

      const conversation: CodeTaskConversationJSON = await conversationLinking(
        fixture,
        turnId(n),
      );

      expect(conversation).not.toHaveProperty("linkedTurn");
      expect(shownNumbers(conversation)).toContain(n);
      expect(fixture.readsOf("AIRun", "findOneBy")).toHaveLength(0);
      expect(fixture.readsOf("AIRun", "query")).toHaveLength(0);
    },
  );

  /*
   * Never another task's run, another project's, or a run of anything
   * else: the link was shared or typed, and is not trusted. The page shows
   * the task's first turn, and says so.
   */
  test.each([
    [
      "another task's reply",
      { codeTaskId: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d" },
    ],
    [
      "another project's run naming this task",
      { projectId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
    ],
    ["a chat run naming this task", { runType: AIRunType.Chat }],
    ["a run that is gone", null],
  ])(
    "a link to %s sends nothing, and the turns are as without it",
    async (_name: string, other: Record<string, string> | null) => {
      const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
      const otherId: ObjectID = new ObjectID(
        "4a5b6c7d-8e9f-4a0b-9c1d-000000000077",
      );

      if (other) {
        const run: AIRun = new AIRun();
        run._id = otherId.toString();
        run.projectId = new ObjectID(
          other["projectId"] || LONG_TASK_PROJECT_ID.toString(),
        );
        run.runType = (other["runType"] as AIRunType) || AIRunType.CodeFix;
        run.codeTaskId = new ObjectID(
          other["codeTaskId"] || turnId(1).toString(),
        );
        run.status = AIRunStatus.Completed;
        run.createdAt = askedAt(3);
        run.taskOutcome = {
          summary: "Another task's secret reply",
          filesChanged: [],
        };
        fixture.runs.push(run);
      }

      const conversation: CodeTaskConversationJSON = await conversationLinking(
        fixture,
        otherId,
      );

      expect(conversation).not.toHaveProperty("linkedTurn");
      expect(shownNumbers(conversation)).toEqual([1, ...range(7, 205)]);
      expect(JSON.stringify(conversation)).not.toContain(
        "Another task's secret reply",
      );
      // Nothing is counted for a run that is not the task's.
      expect(fixture.readsOf("AIRun", "query")).toHaveLength(0);
    },
  );

  /*
   * Two turns asked the same moment: the conversation orders them by id
   * (CodeTaskThread.getTurns), and a linked turn's place is counted the
   * same way - so it never shares a number with the one shown beside it.
   */
  test("two turns asked the same moment: a link to the one not shown is numbered where the conversation places it", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    // Turns 6 and 7 asked together: 6 is read as the oldest shown, 7 left out.
    fixture.turn(6).createdAt = askedAt(7);

    const conversation: CodeTaskConversationJSON = await conversationLinking(
      fixture,
      turnId(7),
    );

    // The page numbers the oldest shown 1 + 1 + the 5 not shown: 7.
    expect(turnNumber(conversation.turns[1]!.runId)).toBe(6);
    expect(conversation.turnsNotShown?.count).toBe(5);
    // Turn 7, asked with it, comes before it: the 6th.
    expect(conversation.linkedTurn?.number).toBe(6);
    expect(turnNumber(conversation.linkedTurn?.turn.runId)).toBe(7);

    // The turns before them keep their own numbers.
    for (const n of [2, 3, 4, 5]) {
      const each: CodeTaskConversationJSON = await conversationLinking(
        fixture,
        turnId(n),
      );

      expect(each.linkedTurn?.number).toBe(n);
    }
  });
});

describe("CodeTaskThread.findReply: one of a task's replies, with its place", () => {
  test("the place of a reply counts the task's first turn and every reply before it", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    for (const n of [2, 3, 100, 205]) {
      const found: CodeTaskNumberedTurn | null = await CodeTaskThread.findReply(
        {
          projectId: LONG_TASK_PROJECT_ID,
          task: fixture.task(),
          runId: turnId(n),
        },
      );

      expect(found?.number).toBe(n);
      expect(turnNumber(found?.turn.id)).toBe(n);
    }
  });

  test("the task's first run is not one of its replies: none", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });

    expect(
      await CodeTaskThread.findReply({
        projectId: LONG_TASK_PROJECT_ID,
        task: fixture.task(),
        runId: turnId(1),
      }),
    ).toBeNull();
    expect(fixture.readsOf("AIRun", "query")).toHaveLength(0);
  });

  test("its statement counts on Postgres, pinned to the project, code-fix runs and the task, never a deleted reply", () => {
    const statement: { sql: string; parameters: Array<unknown> } =
      CodeTaskThread.getRepliesBeforeStatement({
        projectId: LONG_TASK_PROJECT_ID,
        taskId: turnId(1),
        replyId: turnId(9),
      });

    expect(statement.parameters).toEqual([
      LONG_TASK_PROJECT_ID.toString(),
      AIRunType.CodeFix,
      turnId(1).toString(),
      turnId(9).toString(),
    ]);
    expect(statement.sql).toContain('"reply"."projectId" = $1');
    expect(statement.sql).toContain('"reply"."runType" = $2');
    expect(statement.sql).toContain('"reply"."deletedAt" IS NULL');
    expect(statement.sql).toContain('"reply"."codeTaskId" = $3::uuid');
    // Every value is a parameter: no id is written into the SQL.
    expect(statement.sql).not.toContain(turnId(9).toString());
    expect(statement.sql).not.toContain(LONG_TASK_PROJECT_ID.toString());
  });
});

describe("CodeTaskPresenter.getWorkMilliseconds", () => {
  function worked(startedAt?: string, completedAt?: string): AIRun {
    const run: AIRun = new AIRun();
    if (startedAt) {
      run.startedAt = new Date(startedAt);
    }
    if (completedAt) {
      run.completedAt = new Date(completedAt);
    }
    return run;
  }

  test("adds up each turn from when AI started it to when it ended", () => {
    expect(
      CodeTaskPresenter.getWorkMilliseconds([
        worked("2026-10-01T09:00:00.000Z", "2026-10-01T09:01:00.000Z"),
        worked("2026-10-01T10:00:00.000Z", "2026-10-01T10:00:30.000Z"),
      ]),
    ).toBe(90 * 1000);
  });

  test("a turn never started, not ended, or ended before it began adds nothing", () => {
    expect(
      CodeTaskPresenter.getWorkMilliseconds([
        worked(undefined, "2026-10-01T09:01:00.000Z"),
        worked("2026-10-01T09:00:00.000Z", undefined),
        worked("2026-10-01T09:05:00.000Z", "2026-10-01T09:00:00.000Z"),
        worked("2026-10-01T09:00:00.000Z", "2026-10-01T09:00:00.000Z"),
      ]),
    ).toBe(0);
    expect(CodeTaskPresenter.getWorkMilliseconds([])).toBe(0);
  });
});
