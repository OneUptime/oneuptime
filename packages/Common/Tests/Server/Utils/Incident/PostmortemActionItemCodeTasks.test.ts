import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentPostmortemActionItem, {
  POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS,
} from "../../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentPostmortemActionItemService from "../../../../Server/Services/IncidentPostmortemActionItemService";
import IncidentService from "../../../../Server/Services/IncidentService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import PostmortemActionItemCodeTasks from "../../../../Server/Utils/Incident/PostmortemActionItemCodeTasks";
import CallerPermission from "../../../../Server/Utils/Permission/CallerPermission";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  CodeTaskContextItem,
  CodeTaskContextInput,
  CodeTaskContextType,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Green500 } from "../../../../Types/BrandColors";
import BadDataException from "../../../../Types/Exception/BadDataException";
import PostmortemActionItemStatus from "../../../../Types/Incident/PostmortemActionItemStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { ActionItemCodeTaskKind } from "../../../../Utils/Incident/PostmortemActionItemCodeTask";

/*
 * A postmortem's action item becomes a pull request or a test (#6801):
 * OneUptime AI is asked in the repository the person picks, as that person,
 * only when they may change the item and ask there, and only while AI is on
 * and no task of the item's is still working. The item names the task, the
 * incident's feed says so, and when the task's pull request merges the item
 * is done.
 *
 * No database: the services and Code's gates are spied.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ITEM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const REPOSITORY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const TASK_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OLD_TASK_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MAYA_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");

const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

let actionItem: IncidentPostmortemActionItem | null;
let mayEdit: boolean;
let aiIsOn: boolean;
let gateBlocks: boolean;
let latestTurnStatus: AIRunStatus | null;
let started: Array<JSONObject>;
let columnWrites: Array<{
  id: string;
  data: JSONObject;
  expectedData?: JSONObject;
}>;
let feedItems: Array<JSONObject>;
let contextInputs: Array<CodeTaskContextInput>;
let permissionsAsked: Array<ReadonlyArray<Permission>>;

function repository(): CodeRepository {
  const model: CodeRepository = new CodeRepository();
  model._id = REPOSITORY_ID.toString();
  model.name = "web";
  return model;
}

beforeEach(() => {
  actionItem = new IncidentPostmortemActionItem();
  actionItem._id = ITEM_ID.toString();
  actionItem.projectId = PROJECT_ID;
  actionItem.incidentId = INCIDENT_ID;
  actionItem.title = "Retry the payment call with backoff";
  actionItem.description = "The provider times out under load.";
  actionItem.status = PostmortemActionItemStatus.Open;

  mayEdit = true;
  aiIsOn = true;
  gateBlocks = false;
  latestTurnStatus = null;
  started = [];
  columnWrites = [];
  feedItems = [];
  contextInputs = [];
  permissionsAsked = [];

  jest
    .spyOn(IncidentPostmortemActionItemService, "findOneById")
    .mockImplementation(async () => {
      return actionItem;
    });

  jest
    .spyOn(CallerPermission, "holdsAnyOf")
    .mockImplementation(
      (_carrier: unknown, permissions: ReadonlyArray<Permission>): boolean => {
        permissionsAsked.push(permissions);
        return mayEdit;
      },
    );

  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockImplementation(async (): Promise<void> => {
      if (!aiIsOn) {
        throw new BadDataException(
          "AI is turned off for this project. Turn it on under Project Settings > AI.",
        );
      }
    });

  jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
    const run: AIRun = new AIRun();
    run._id = OLD_TASK_ID.toString();
    run.status = AIRunStatus.Completed;
    return run;
  });

  jest
    .spyOn(CodeTaskRuns, "getLatestTurn")
    .mockImplementation(async (args: { task: AIRun }): Promise<AIRun> => {
      const turn: AIRun = new AIRun();
      turn.status = latestTurnStatus || args.task.status!;
      return turn;
    });

  jest
    .spyOn(CodeTaskAccess, "getReadableRepository")
    .mockImplementation(async (): Promise<CodeRepository> => {
      return repository();
    });

  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation(async (): Promise<boolean> => {
      return true;
    });

  jest
    .spyOn(CodeTaskGate, "assertCanStart")
    .mockImplementation(async (): Promise<void> => {
      if (gateBlocks) {
        throw new BadDataException(
          "No Runner can work on code right now. Start a Runner, then ask again.",
        );
      }
    });

  jest.spyOn(IncidentService, "findOneById").mockImplementation(async () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.title = "Checkout returns 503s";
    incident.incidentNumber = 42;
    incident.postmortemNote = "## Root Cause\nThe pool ran out.";
    return incident;
  });

  jest
    .spyOn(CodeTaskContextBuilder, "build")
    .mockImplementation(
      async (data: {
        inputs: Array<CodeTaskContextInput>;
      }): Promise<Array<CodeTaskContextItem>> => {
        contextInputs.push(...data.inputs);
        return data.inputs.map((input: CodeTaskContextInput) => {
          return {
            type: input.type,
            label: "Incident #42",
            recordId: input.id,
          } as CodeTaskContextItem;
        });
      },
    );

  jest
    .spyOn(CodeTaskContextBuilder, "buildItem")
    .mockImplementation(
      async (input: CodeTaskContextInput): Promise<CodeTaskContextItem> => {
        contextInputs.push(input);
        return {
          type: input.type,
          label: "note",
          text: input.text,
        } as CodeTaskContextItem;
      },
    );

  jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async (data: unknown): Promise<AIRun> => {
      started.push(data as JSONObject);
      const run: AIRun = new AIRun();
      run._id = TASK_ID.toString();
      return run;
    });

  jest
    .spyOn(
      IncidentPostmortemActionItemService as unknown as {
        updateColumnsByIdWithoutHooks: () => void;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (args: unknown) => {
      const { id, data, expectedData } = args as {
        id: ObjectID;
        data: JSONObject;
        expectedData?: JSONObject;
      };
      columnWrites.push({ id: id.toString(), data, expectedData });
    }) as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function start(
  overrides: Partial<{
    props: DatabaseCommonInteractionProps;
    kind: ActionItemCodeTaskKind;
    instructions: string;
  }> = {},
): Promise<{ taskId: ObjectID }> {
  return PostmortemActionItemCodeTasks.start({
    props: overrides.props || MAYA,
    actionItemId: ITEM_ID,
    kind: overrides.kind || ActionItemCodeTaskKind.PullRequest,
    repositoryId: REPOSITORY_ID,
    instructions: overrides.instructions,
  });
}

describe("asking OneUptime AI for an action item's pull request", () => {
  test("starts a request in the repository, as the person, with the incident and its postmortem as context", async () => {
    const result: { taskId: ObjectID } = await start();

    expect(result.taskId).toEqual(TASK_ID);
    expect(started).toHaveLength(1);

    const request: JSONObject = started[0]!;

    expect(request["projectId"]).toEqual(PROJECT_ID);
    expect(request["userId"]).toEqual(MAYA_ID);
    expect((request["repository"] as CodeRepository).name).toBe("web");
    expect(request["message"]).toContain(
      "This is an action item from the postmortem of incident #42: Checkout returns 503s.",
    );
    expect(request["message"]).toContain(
      "Action item: Retry the payment call with backoff",
    );
    expect(request["message"]).toContain("open a pull request with it");

    expect(contextInputs).toEqual([
      { type: CodeTaskContextType.Incident, id: INCIDENT_ID.toString() },
      {
        type: CodeTaskContextType.Note,
        text: "The incident's postmortem:\n\n## Root Cause\nThe pool ran out.",
      },
    ]);
    expect((request["context"] as Array<unknown>).length).toBe(2);
  });

  test("a test is asked for as a test, with what the person added", async () => {
    await start({
      kind: ActionItemCodeTaskKind.Test,
      instructions: "Use the payments test helper.",
    });

    expect(started[0]!["message"]).toContain(
      "Write an automated test that would have caught this incident",
    );
    expect(started[0]!["message"]).toContain(
      "From the person who asked: Use the payments test helper.",
    );
  });

  test("the item names the task, and the feed says what was asked, where", async () => {
    await start();

    expect(columnWrites).toEqual([
      {
        id: ITEM_ID.toString(),
        data: { codeTaskId: TASK_ID },
        expectedData: undefined,
      },
    ]);
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.PostmortemNote,
    );
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🤖 Asked OneUptime AI to open a pull request for the action item **Retry the payment call with backoff**, in **web**.",
    );
    expect(feedItems[0]!["userId"]).toEqual(MAYA_ID);
  });

  test("whether the person may change the item is asked of the item's own edit permissions", async () => {
    await start();

    expect(permissionsAsked).toEqual([
      POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS,
    ]);
  });

  test("the task stands when the feed line cannot be written", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(start()).resolves.toEqual({ taskId: TASK_ID });
  });
});

describe("what stops it", () => {
  async function refusal(): Promise<string> {
    try {
      await start();
    } catch (error) {
      return (error as Error).message;
    }

    return "";
  }

  test("an API key: a pull request is asked by a person", async () => {
    await expect(
      start({ props: { tenantId: PROJECT_ID, isRoot: false } }),
    ).rejects.toThrow("it is asked by a person, not an API key");
  });

  test("an action item the person cannot read", async () => {
    actionItem = null;

    expect(await refusal()).toBe(
      "The action item was not found, or you cannot read it. Open the postmortem again, then ask again.",
    );
    expect(started).toEqual([]);
  });

  test("a person who may read it but not change it", async () => {
    mayEdit = false;

    expect(await refusal()).toContain(
      "takes permission to edit the action item",
    );
    expect(started).toEqual([]);
  });

  test("a closed item: reopen it first", async () => {
    actionItem!.status = PostmortemActionItemStatus.Done;

    expect(await refusal()).toBe(
      "This action item is closed. Reopen it first, then ask OneUptime AI for its pull request.",
    );
  });

  test("AI switched off for the project, before anything is read for the request", async () => {
    aiIsOn = false;

    expect(await refusal()).toContain("AI is turned off for this project");
    expect(CodeTaskAccess.getReadableRepository).not.toHaveBeenCalled();
    expect(IncidentService.findOneById).not.toHaveBeenCalled();
    expect(started).toEqual([]);
  });

  test("a task of the item's still working: follow it instead", async () => {
    actionItem!.codeTaskId = OLD_TASK_ID;

    for (const status of [
      AIRunStatus.Queued,
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ]) {
      latestTurnStatus = status;

      expect(await refusal()).toBe(
        "OneUptime AI is still working on this action item's task. Follow it in Code, or stop it there before you ask again.",
      );
    }

    expect(started).toEqual([]);
  });

  test("a task of the item's that finished: a new one may be asked", async () => {
    actionItem!.codeTaskId = OLD_TASK_ID;
    latestTurnStatus = AIRunStatus.Completed;

    await expect(start()).resolves.toEqual({ taskId: TASK_ID });
  });

  test("whatever Code's own gate says: a Runner, a provider, the plan", async () => {
    gateBlocks = true;

    expect(await refusal()).toBe(
      "No Runner can work on code right now. Start a Runner, then ask again.",
    );
    expect(started).toEqual([]);
  });

  test("instructions longer than a request holds", async () => {
    await expect(start({ instructions: "x".repeat(3001) })).rejects.toThrow(
      "What you add for OneUptime AI can be at most 3000 characters.",
    );
  });
});

describe("a pull request OneUptime AI opened merges", () => {
  let openItems: Array<IncidentPostmortemActionItem>;
  let itemQuery: JSONObject | undefined;

  beforeEach(() => {
    openItems = [];
    itemQuery = undefined;

    const open: IncidentPostmortemActionItem =
      new IncidentPostmortemActionItem();
    open._id = ITEM_ID.toString();
    open.projectId = PROJECT_ID;
    open.incidentId = INCIDENT_ID;
    open.title = "Retry the payment call with backoff";
    openItems.push(open);

    jest
      .spyOn(IncidentPostmortemActionItemService, "findBy")
      .mockImplementation(async (args: unknown) => {
        itemQuery = (args as { query: JSONObject }).query;
        return openItems;
      });
  });

  test("the open action items of its task are done, by OneUptime, and the feed says so in green", async () => {
    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      const run: AIRun = new AIRun();
      run._id = TASK_ID.toString();
      return run;
    });

    const done: number =
      await PostmortemActionItemCodeTasks.onPullRequestMerged({
        aiRunId: TASK_ID,
        pullRequestNumber: 12,
      });

    expect(done).toBe(1);
    expect(itemQuery).toEqual({
      codeTaskId: TASK_ID,
      status: PostmortemActionItemStatus.Open,
    });
    expect(columnWrites).toHaveLength(1);
    expect(columnWrites[0]!.data["status"]).toBe(
      PostmortemActionItemStatus.Done,
    );
    expect(columnWrites[0]!.data["closedByUserId"]).toBeNull();
    // Only while still open: a person's close in the meantime stands.
    expect(columnWrites[0]!.expectedData).toEqual({
      status: PostmortemActionItemStatus.Open,
    });
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "✅ The action item **Retry the payment call with backoff** is done: its pull request #12 merged.",
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Green500);
    expect(feedItems[0]!["userId"]).toBeUndefined();
  });

  test("a reply's pull request closes the items of the task it is a turn of", async () => {
    jest.spyOn(AIRunService, "findOneById").mockImplementation(async () => {
      const reply: AIRun = new AIRun();
      reply._id = OLD_TASK_ID.toString();
      reply.codeTaskId = TASK_ID;
      return reply;
    });

    await PostmortemActionItemCodeTasks.onPullRequestMerged({
      aiRunId: OLD_TASK_ID,
    });

    expect(itemQuery!["codeTaskId"]).toEqual(TASK_ID);
  });

  test("a run that is gone closes nothing", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(null as never);

    expect(
      await PostmortemActionItemCodeTasks.onPullRequestMerged({
        aiRunId: TASK_ID,
      }),
    ).toBe(0);
    expect(columnWrites).toEqual([]);
  });

  test("never throws: the pull request sweep goes on", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(
      PostmortemActionItemCodeTasks.onPullRequestMerged({ aiRunId: TASK_ID }),
    ).resolves.toBe(0);
  });
});
