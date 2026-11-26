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
  DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE,
  DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE,
  DataSecurityFixCode,
  getDataSecurityFixNoRepositoryMessage,
  getDataSecurityFixPickRepositoryMessage,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import { JSONObject } from "../../../../../Types/JSON";
import { DataSecurityAiCodeRequest } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import { buildDataSecurityFixRequest } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssuePrompt";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
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

// A request as DataSecurityAiInput builds it (#10365).
function fixRequest(): DataSecurityAiCodeRequest {
  const issue: DataSecurityIssue = new DataSecurityIssue();
  issue.checkId = "public-read";
  issue.title = "Anyone on the internet can read it";

  return buildDataSecurityFixRequest(issue);
}

async function requestFix(
  data: {
    props?: DatabaseCommonInteractionProps;
    issueIds?: Array<ObjectID>;
    requestedRepositoryId?: unknown;
    code?: DataSecurityFixCode;
    request?: () => DataSecurityAiCodeRequest;
  } = {},
): Promise<DataSecurityFixResult> {
  return await DataSecurityCodeTask.requestFix({
    props: data.props || CALLER,
    projectId: PROJECT_ID,
    issueIds: data.issueIds || [ISSUE_A],
    code: data.code || DataSecurityFixCode.Infrastructure,
    requestedRepositoryId: data.requestedRepositoryId,
    buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
      order.push("message");
      return (data.request || fixRequest)();
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
  // Many repositories weighed at once, by the same rule (#10764).
  jest
    .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
    .mockImplementation(
      async (data: {
        repositoryIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        return new Set<string>(
          data.repositoryIds
            .map((id: ObjectID | string): string => {
              return id.toString();
            })
            .filter((id: string): boolean => {
              return askable.has(id);
            })
            .map((id: string): string => {
              return id.toLowerCase();
            }),
        );
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
      // The request the builder made, as the coding agent reads it.
      message: fixRequest().text,
      context: [],
    });
  });

  test("a request the builder did not make starts nothing (#10365)", async () => {
    const infra: CodeRepository = repository("infra");
    readable = [infra];
    askable.add(infra.id!.toString());

    await expect(
      requestFix({
        request: (): DataSecurityAiCodeRequest => {
          return {
            feature: fixRequest().feature,
            text: "Fix it. The samples: j***@e******.com",
            data: {},
            textThatReadsLikeInstructions: [],
          } as unknown as DataSecurityAiCodeRequest;
        },
      }),
    ).rejects.toThrow(BadDataException);
    expect(started).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
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
  test("keeps those the person may ask in, in their order, asking about all of them at once", async () => {
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
    /*
     * Every repository the person may read is weighed - not the first 500 -
     * in one read (#10764), never one canAskInRepository a repository.
     */
    expect(CodeTaskAccess.listAskableRepositoryIds).toHaveBeenCalledTimes(1);
    expect(
      (
        (CodeTaskAccess.listAskableRepositoryIds as unknown as jest.Mock).mock
          .calls[0]![0] as { repositoryIds: Array<string> }
      ).repositoryIds,
    ).toEqual(
      many.map((row: CodeRepository): string => {
        return row.id!.toString();
      }),
    );
    expect(CodeTaskAccess.canAskInRepository).not.toHaveBeenCalled();
  });

  test("past the 500th: a repository the person may ask in is offered however many come before it", async () => {
    const many: Array<CodeRepository> = [];

    for (let index: number = 0; index < 1200; index++) {
      many.push(repository(`repo-${String(index).padStart(4, "0")}`));
    }

    const late: CodeRepository = many[1150]!;
    askable.add(late.id!.toString());

    const kept: Array<CodeRepository> =
      await DataSecurityCodeTask.getAskableRepositories({
        props: CALLER,
        projectId: PROJECT_ID,
        readable: many,
      });

    expect(kept).toEqual([late]);
  });
});

/*
 * #10740: a security playbook's Fix the code with AI step asks Fix with AI
 * for a case's issue in no group, as OneUptime - no person - only in the
 * repository the issue's declared code points to, and keeps it on the case.
 */
describe("DataSecurityCodeTask.requestFix asked by OneUptime, for a security case", () => {
  const CASE_ID: ObjectID = new ObjectID(
    "10740000-0000-4000-8000-0000000000c1",
  );
  let given: CodeRepository | null;
  let startedForIssue: SpyInstance<
    typeof CodeTaskRuns.startForDataSecurityIssue
  >;
  let looked: Array<JSONObject>;

  async function askAsOneUptime(
    data: {
      issueIds?: Array<ObjectID>;
      requestedRepositoryId?: unknown;
    } = {},
  ): Promise<DataSecurityFixResult> {
    return await DataSecurityCodeTask.requestFix({
      props: { isRoot: true },
      projectId: PROJECT_ID,
      issueIds: data.issueIds || [ISSUE_A],
      code: DataSecurityFixCode.Infrastructure,
      requestedRepositoryId:
        "requestedRepositoryId" in data
          ? data.requestedRepositoryId
          : given?.id?.toString(),
      triggeredBySecurityCaseId: CASE_ID,
      buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
        order.push("message");
        return fixRequest();
      },
    });
  }

  beforeEach(() => {
    given = repository("infra");
    looked = [];
    jest.spyOn(CodeRepositoryService, "findOneBy").mockImplementation((async (
      findOneBy: JSONObject,
    ) => {
      looked.push(findOneBy);
      order.push("repository");

      return given;
    }) as never);
    startedForIssue = jest
      .spyOn(CodeTaskRuns, "startForDataSecurityIssue")
      .mockImplementation(async (): Promise<AIRun> => {
        order.push("start for the issue");
        return new AIRun(RUN_ID);
      });
  });

  test("works in the repository it was given, the project's own, and the run names the issue and the case", async () => {
    const answer: DataSecurityFixResult = await askAsOneUptime();

    expect(order).toEqual([
      "gate",
      "repository",
      "gate in repository",
      "message",
      "start for the issue",
    ]);
    expect(answer).toEqual({
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      aiRunId: RUN_ID.toString(),
    });
    expect(looked[0]).toMatchObject({
      query: { _id: given!.id!.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });
    expect(startedForIssue.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      repository: given,
      message: fixRequest().text,
      triggeredByDataSecurityIssueId: ISSUE_A,
      triggeredBySecurityCaseId: CASE_ID,
    });
    // Never a person's own task: none was asked for one.
    expect(started).not.toHaveBeenCalled();
    // Nobody may read any repository through it: no person's list is read.
    expect(CodeTaskAccess.listReadableRepositories).not.toHaveBeenCalled();
  });

  test("the issue's timeline says a security playbook asked, with nobody named", async () => {
    await askAsOneUptime();

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      dataSecurityIssueId: ISSUE_A,
      eventType: DataSecurityIssueFeedEventType.AiFixRequested,
      displayColor: expect.anything(),
      feedInfoInMarkdown: DATA_SECURITY_PLAYBOOK_FIX_FEED_MESSAGE,
    });
  });

  test("with no repository given, or one of another project, starts nothing and says why", async () => {
    expect(await askAsOneUptime({ requestedRepositoryId: undefined })).toEqual({
      message: DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE,
    });
    expect(
      await askAsOneUptime({ requestedRepositoryId: "not-an-id" }),
    ).toEqual({ message: DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE });

    given = null;

    expect(
      await askAsOneUptime({
        requestedRepositoryId: ObjectID.generate().toString(),
      }),
    ).toEqual({ message: DATA_SECURITY_ISSUE_FIX_NO_REPOSITORY_MESSAGE });
    expect(startedForIssue).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("the gate decides, before and inside the repository, as for a person", async () => {
    blockers.before = {
      type: CodeTaskBlockerType.AiDisabled,
      message: "Turn on AI for this project first.",
    } as CodeTaskBlocker;

    expect(await askAsOneUptime()).toEqual({
      message: "Turn on AI for this project first.",
    });

    blockers.before = null;
    blockers.inside = {
      type: CodeTaskBlockerType.RepositoryNotConnected,
      message: "This repository is not connected.",
    } as CodeTaskBlocker;

    expect(await askAsOneUptime()).toEqual({
      message: "This repository is not connected.",
    });
    expect(startedForIssue).not.toHaveBeenCalled();
  });

  test("asks for one issue at a time, and only as OneUptime", async () => {
    await expect(
      askAsOneUptime({ issueIds: [ISSUE_A, ISSUE_B] }),
    ).rejects.toThrow(new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE));
    await expect(
      DataSecurityCodeTask.requestFix({
        props: { tenantId: PROJECT_ID },
        projectId: PROJECT_ID,
        issueIds: [ISSUE_A],
        code: DataSecurityFixCode.Infrastructure,
        requestedRepositoryId: given!.id!.toString(),
        triggeredBySecurityCaseId: CASE_ID,
        buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
          return fixRequest();
        },
      }),
    ).rejects.toThrow(new BadDataException(DATA_SECURITY_FIX_SIGN_IN_MESSAGE));
    expect(order).toEqual([]);
  });
});
