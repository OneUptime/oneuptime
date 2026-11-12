import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import UserService from "../../../../../Server/Services/UserService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import CodeTaskAgentBrief, {
  ENTRIES_PER_REPLY_TURN,
  MAX_CONVERSATION_LENGTH,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAgentBrief";
import CodeTaskPresenter, {
  TURN_NOT_SHOWN_SELECT,
} from "../../../../../Server/Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskThread, {
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
 *    changed, how long AI worked, its pull request and its state.
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
    expect(argsOf(leftOutRead!).sort).toEqual({
      createdAt: SortOrder.Ascending,
    });
    expect(argsOf(leftOutRead!).limit).toBe(LIMIT_PER_PROJECT);
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

  async function brief(
    fixture: LongCodeTask,
    run: AIRun,
  ): Promise<CodeTaskAgentDetails> {
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

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

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

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

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

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

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

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

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

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

    expect(details.workingBranch).toBe("oneuptime-task-42-turn-4");
    expect(details.pullRequest?.number).toBe(41);
    // Turn 4 is not in the conversation, so nothing there names it.
    expect(JSON.stringify(details.conversation)).not.toContain("#41");
  });

  test("the turn 203 that opened it says so in the conversation", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    fixture.openPullRequest({ turn: 203, number: 77 });

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

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

    const details: CodeTaskAgentDetails = await brief(fixture, fixture.turn(1));

    expect(details.conversation).toEqual([]);
    expect(details.omittedTurns).toBe(0);
  });

  test("a turn older than every turn read - one asked while another worked - is briefed from the turns before it", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(fixture, fixture.turn(5));

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

    const details: CodeTaskAgentDetails = await brief(fixture, asTheApiReadsIt);

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
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });
    const unknown: AIRun = new AIRun();
    unknown._id = ObjectID.generate().toString();
    unknown.projectId = LONG_TASK_PROJECT_ID;
    unknown.codeTaskId = turnId(1);
    unknown.taskContext = { request: { message: "Lost", context: [] } };

    const details: CodeTaskAgentDetails = await brief(fixture, unknown);

    expect(askedTexts(details)).toEqual([turnMessage(1)]);
    expect(details.omittedTurns).toBe(0);
  });

  test("a task under the limit is briefed as before: every turn before this one, one read of turns, no count", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 12 });
    fixture.openPullRequest({ turn: 2, number: 21 });

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(12),
    );

    expect(askedTexts(details)).toEqual(range(1, 11).map(turnMessage));
    expect(details.omittedTurns).toBe(0);
    expect(details.pullRequest?.number).toBe(21);
    expect(fixture.readsOf("AIRun", "findBy")).toHaveLength(1);
    expect(fixture.readsOf("AIRun", "countBy")).toHaveLength(0);
  });

  test("who asked this turn is named, however long the task", async () => {
    const fixture: LongCodeTask = holdLongCodeTask({ turnCount: 205 });

    const details: CodeTaskAgentDetails = await brief(
      fixture,
      fixture.turn(205),
    );

    expect(details.requestedBy).toBe("Jane Doe");
    expect(details.conversation[0]!.author).toBe("Jane Doe");
  });
});

describe("a long task's page", () => {
  let eventReads: jest.SpiedFunction<typeof AIRunEventService.findBy>;

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
