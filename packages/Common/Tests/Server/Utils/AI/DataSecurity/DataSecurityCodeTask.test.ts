import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { DataSecurityIssueFeedEventType } from "../../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DataSecurityCodeTask, {
  DATA_SECURITY_FIX_SIGN_IN_MESSAGE,
  DATA_SECURITY_FIX_STARTED_MESSAGE,
  DataSecurityFixCode,
  getDataSecurityFixNoRepositoryMessage,
  getDataSecurityFixPickRepositoryMessage,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityFixResult } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A CODE CHANGE FOR DATA SECURITY ISSUES, ASKED AS THE PERSON WHO ASKED
 * (#10362): what Fix with AI, and the fixes of #10367 and #10370 after it,
 * start their Code task through. Code's own checks are stood in for here;
 * DataSecurityFixWithAiOverHttp runs them for each role through the route.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10362000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("10362000-0000-4000-8000-000000000002");
const ISSUE_A: ObjectID = new ObjectID("10362000-0000-4000-8000-0000000000a1");
const ISSUE_B: ObjectID = new ObjectID("10362000-0000-4000-8000-0000000000a2");
const RUN_ID: ObjectID = new ObjectID("10362000-0000-4000-8000-0000000000f1");

const CALLER: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

let readable: Array<CodeRepository>;
let askable: Set<string>;
let blockers: {
  before: CodeTaskBlocker | null;
  inside: CodeTaskBlocker | null;
};
let started: SpyInstance<typeof CodeTaskRuns.start>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let order: Array<string>;

function repository(name: string): CodeRepository {
  const row: CodeRepository = new CodeRepository(ObjectID.generate());
  row.name = name;
  return row;
}

async function requestFix(
  data: {
    props?: DatabaseCommonInteractionProps;
    issueIds?: Array<ObjectID>;
    requestedRepositoryId?: unknown;
    code?: DataSecurityFixCode;
  } = {},
): Promise<DataSecurityFixResult> {
  return await DataSecurityCodeTask.requestFix({
    props: data.props || CALLER,
    projectId: PROJECT_ID,
    issueIds: data.issueIds || [ISSUE_A],
    code: data.code || DataSecurityFixCode.Infrastructure,
    requestedRepositoryId: data.requestedRepositoryId,
    buildMessage: async (): Promise<string> => {
      order.push("message");
      return "Fix this data security issue in the infrastructure code.";
    },
  });
}

beforeEach(() => {
  readable = [];
  askable = new Set();
  blockers = { before: null, inside: null };
  order = [];

  jest
    .spyOn(CodeTaskAccess, "listReadableRepositories")
    .mockImplementation(async (): Promise<Array<CodeRepository>> => {
      order.push("list");
      return readable;
    });
  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation(
      async (data: { repositoryId: ObjectID }): Promise<boolean> => {
        return askable.has(data.repositoryId.toString());
      },
    );
  jest
    .spyOn(CodeTaskGate, "getBlocker")
    .mockImplementation(
      async (data: {
        repository: CodeRepository | null;
      }): Promise<CodeTaskBlocker | null> => {
        order.push(data.repository ? "gate in repository" : "gate");
        return data.repository ? blockers.inside : blockers.before;
      },
    );
  started = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async (): Promise<AIRun> => {
      order.push("start");
      return new AIRun(RUN_ID);
    });
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DataSecurityCodeTask.requestFix", () => {
  test("a request with no person behind it is refused before anything is asked", async () => {
    await expect(
      requestFix({ props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE));
    expect(order).toEqual([]);
  });

  test("asks the gate, then the repositories, then the gate in the repository, and builds the request only to start", async () => {
    const infra: CodeRepository = repository("infra");
    readable = [infra];
    askable.add(infra.id!.toString());

    const answer: DataSecurityFixResult = await requestFix();

    expect(order).toEqual([
      "gate",
      "list",
      "gate in repository",
      "message",
      "start",
    ]);
    expect(answer).toEqual({
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      aiRunId: RUN_ID.toString(),
    });
    expect(started.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      userId: USER_ID,
      repository: infra,
      context: [],
    });
  });

  test("a task for several issues is noted on the timeline of each", async () => {
    const infra: CodeRepository = repository("infra");
    readable = [infra];
    askable.add(infra.id!.toString());

    await requestFix({ issueIds: [ISSUE_A, ISSUE_B] });

    expect(started).toHaveBeenCalledTimes(1);
    expect(
      feed.mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { dataSecurityIssueId: ObjectID }).dataSecurityIssueId,
        );
      }),
    ).toEqual([ISSUE_A.toString(), ISSUE_B.toString()]);
    expect(feed.mock.calls[0]![0]).toMatchObject({
      eventType: DataSecurityIssueFeedEventType.AiFixRequested,
      userId: USER_ID,
    });
  });

  test("what stops AI before a repository is chosen is the answer, and no request is built", async () => {
    blockers.before = {
      type: CodeTaskBlockerType.AiDisabled,
      message: "AI is off.",
    };

    expect(await requestFix()).toEqual({ message: "AI is off." });
    expect(order).toEqual(["gate"]);
  });

  test("what stops AI in the repository is the answer, and no request is built", async () => {
    const infra: CodeRepository = repository("infra");
    readable = [infra];
    askable.add(infra.id!.toString());
    blockers.inside = {
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner is not online.",
    };

    expect(await requestFix()).toEqual({
      message: "The Runner is not online.",
    });
    expect(order).not.toContain("message");
    expect(started).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("names the code a telemetry issue is fixed in", async () => {
    expect(await requestFix({ code: DataSecurityFixCode.Service })).toEqual({
      message: getDataSecurityFixNoRepositoryMessage(
        DataSecurityFixCode.Service,
      ),
    });

    readable = [repository("web"), repository("api")];
    askable.add(readable[0]!.id!.toString());

    const pick: DataSecurityFixResult = await requestFix({
      code: DataSecurityFixCode.Service,
    });

    expect(pick.message).toBe(
      getDataSecurityFixPickRepositoryMessage(DataSecurityFixCode.Service),
    );
    expect(pick.repositories).toEqual([
      { id: readable[0]!.id!.toString(), name: "web" },
    ]);
  });

  test("a repository with no name is offered by its id", async () => {
    const unnamed: CodeRepository = new CodeRepository(ObjectID.generate());
    readable = [unnamed, repository("api")];
    askable.add(unnamed.id!.toString());

    expect((await requestFix()).repositories).toEqual([
      { id: unnamed.id!.toString(), name: unnamed.id!.toString() },
    ]);
  });
});

describe("DataSecurityCodeTask.getAskableRepositories", () => {
  test("keeps those the person may ask in, in their order, asking about each", async () => {
    const many: Array<CodeRepository> = [];

    for (let index: number = 0; index < 23; index++) {
      const row: CodeRepository = repository(`repo-${index}`);
      many.push(row);

      if (index % 2 === 0) {
        askable.add(row.id!.toString());
      }
    }

    const kept: Array<CodeRepository> =
      await DataSecurityCodeTask.getAskableRepositories({
        props: CALLER,
        projectId: PROJECT_ID,
        readable: many,
      });

    expect(
      kept.map((row: CodeRepository): string => {
        return row.name || "";
      }),
    ).toEqual(
      many
        .filter((_row: CodeRepository, index: number): boolean => {
          return index % 2 === 0;
        })
        .map((row: CodeRepository): string => {
          return row.name || "";
        }),
    );
    expect(CodeTaskAccess.canAskInRepository).toHaveBeenCalledTimes(23);
  });
});
