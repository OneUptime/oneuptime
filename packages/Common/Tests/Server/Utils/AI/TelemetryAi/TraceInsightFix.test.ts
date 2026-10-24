import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIService from "../../../../../Server/Services/AIService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import OpenPullRequestCap from "../../../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import TraceInsightFix, {
  TRACE_FIX_ALREADY_RUNNING_MESSAGE,
  TRACE_FIX_INSIGHT_CLOSED_MESSAGE,
  TRACE_FIX_INSIGHT_HAS_FIX_MESSAGE,
  TRACE_FIX_INSIGHT_NOT_FOUND_MESSAGE,
  TRACE_FIX_PICK_REPOSITORY_MESSAGE,
  TRACE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
  TraceInsightFixResult,
  TraceInsightFixSkip,
} from "../../../../../Server/Utils/AI/TelemetryAi/TraceInsightFix";
import SourceLocator, {
  LocatableRepositoryWithTree,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { TraceInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  CodeTaskBlockerType,
  CodeTaskContextInput,
  CodeTaskContextItem,
  CodeTaskContextType,
} from "../../../../../Types/AI/CodeTask";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiWork,
  decideTelemetryAiWork,
} from "../../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import { TelemetryAiFixSuggestion } from "../../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * The pull request for a problem OneUptime found in a service's traces
 * (TraceInsightFix): started by OneUptime on its own only when every gate
 * holds - the day's share, no task about it already on its way, a
 * repository the rules allow that can be told to hold the code, Code's own
 * gate, room under the repository's open pull request cap - and asked for
 * by a person from the finding, under their own permissions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5229bbbb-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5229bbbb-0000-4000-8000-000000000002";
const INSIGHT_ID: ObjectID = new ObjectID(
  "5229bbbb-0000-4000-8000-0000000000d4",
);
const REPO_A: string = "5229bbbb-0000-4000-8000-0000000000a1";
const REPO_B: string = "5229bbbb-0000-4000-8000-0000000000b2";
const PROVIDER: string = "5229bbbb-0000-4000-8000-0000000000c3";
const USER_ID: ObjectID = new ObjectID("5229bbbb-0000-4000-8000-0000000000e5");

const SLOW: TraceInsightEvidence = {
  serviceId: CHECKOUT,
  kind: "Slow",
  operationName: "GET /orders",
  windowStartTime: "2026-10-24T08:00:04.000Z",
  windowEndTime: "2026-10-24T09:00:04.000Z",
  spanCount: 1234,
  p50Ms: 180,
  p99Ms: 2400,
  sampleTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  sampleSpanId: "root",
  sampleDurationMs: 2000,
  performanceFindings: [
    {
      findingType: "NPlusOneQuery" as never,
      headline: 'N+1: 40× "SELECT orders" under "GET /orders"',
      evidence: "40 sibling spans",
      spanCount: 40,
      combinedDurationMs: 1600,
      traceDurationMs: 2000,
      percentOfTrace: 80,
      normalizedSpanName: "SELECT orders",
      parentSpanName: "GET /orders",
      normalizedDbStatement: "SELECT * FROM orders WHERE id = ?",
      dbSystem: "postgresql",
      implicatedSpans: [
        { spanId: "q0", name: "SELECT orders", durationMs: 40 },
      ],
    },
  ],
  codeLocations: [
    {
      filePath: "src/orders/list.ts",
      functionName: "listOrders",
      lineNumber: 42,
    },
  ],
};

function insight(
  overrides: Partial<AIInsight> = {},
  evidence: TraceInsightEvidence | null = SLOW,
): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = INSIGHT_ID;
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.TraceSlowOperation;
  value.status = AIInsightStatus.ActionRequired;
  value.serviceName = "checkout";
  if (evidence) {
    value.evidence = { trace: evidence };
  }
  Object.assign(value, overrides);
  return value;
}

function repository(id: string): LocatableRepositoryWithTree {
  return {
    id,
    name: `acme/${id.substring(id.length - 2)}`,
    organizationName: "acme",
    repositoryName: id.substring(id.length - 2),
    mainBranchName: "main",
    gitHubAppInstallationId: "42",
  };
}

// No rule: OneUptime AI may open the pull request in any repository.
const ANYWHERE: TelemetryAiWork = decideTelemetryAiWork({
  isAiEnabled: true,
  isLaneOn: true,
  rules: { rulesSetUp: false, matchingRules: [] },
});

let startedToday: number;
let activeTaskId: string | null;
let hasRepository: boolean;
let resolved: string | null;
let locatable: Array<LocatableRepositoryWithTree>;
let askable: Set<string>;
let resolve: SpyInstance<
  typeof CodeRepositoryService.resolveRepositoryForException
>;
let getBlocker: SpyInstance<typeof CodeTaskGate.getBlocker>;
let capCheck: SpyInstance<typeof OpenPullRequestCap.checkForRepository>;
let buildItem: SpyInstance<typeof CodeTaskContextBuilder.buildItem>;
let startForOneUptime: SpyInstance<typeof CodeTaskRuns.startForOneUptime>;
let startForPerson: SpyInstance<typeof CodeTaskRuns.start>;
let readInsight: SpyInstance<typeof AIInsightService.findOneBy>;
let linkInsight: SpyInstance<typeof AIInsightService.updateOneBy>;
let currentInsight: AIInsight | null;
const createdTaskId: ObjectID = ObjectID.generate();

beforeEach(() => {
  startedToday = 0;
  activeTaskId = null;
  hasRepository = true;
  resolved = REPO_A;
  locatable = [repository(REPO_A), repository(REPO_B)];
  askable = new Set<string>([REPO_A, REPO_B]);
  currentInsight = insight();

  jest
    .spyOn(TelemetryAiFix, "countStartedToday")
    .mockImplementation(async () => {
      return startedToday;
    });
  jest
    .spyOn(TelemetryAiFix, "findActiveTaskIdForInsight")
    .mockImplementation(async () => {
      return activeTaskId;
    });
  jest
    .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
    .mockImplementation(async () => {
      return hasRepository;
    });
  resolve = jest
    .spyOn(CodeRepositoryService, "resolveRepositoryForException")
    .mockImplementation(async () => {
      return resolved
        ? {
            codeRepositoryId: resolved,
            organizationName: "acme",
            repositoryName: "a1",
            servicePathInRepository: null,
            method: "stack-trace" as const,
            evidence: "Matched src/orders/list.ts",
          }
        : null;
    });
  jest
    .spyOn(CodeRepositoryService, "findOneBy")
    .mockImplementation(async (data: unknown) => {
      const query: JSONObject = (data as JSONObject)["query"] as JSONObject;
      const row: CodeRepository = new CodeRepository();
      row.id = new ObjectID(query["_id"] as string);
      row.name = "acme/repo";
      row.maxOpenFixPullRequests = 3;
      return row;
    });
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });
  getBlocker = jest.spyOn(CodeTaskGate, "getBlocker").mockResolvedValue(null);
  capCheck = jest
    .spyOn(OpenPullRequestCap, "checkForRepository")
    .mockResolvedValue({
      allowed: true,
      limit: 3,
      paused: false,
      openCount: 1,
    });
  buildItem = jest
    .spyOn(CodeTaskContextBuilder, "buildItem")
    .mockImplementation(async (input: CodeTaskContextInput) => {
      return {
        type: input.type,
        label:
          input.type === CodeTaskContextType.Trace ? "Trace 4bf92f35…" : "Note",
        ...(input.traceId ? { traceId: input.traceId } : {}),
        ...(input.text ? { text: input.text } : {}),
      } as CodeTaskContextItem;
    });
  startForOneUptime = jest
    .spyOn(CodeTaskRuns, "startForOneUptime")
    .mockImplementation(async () => {
      const run: AIRun = new AIRun();
      run.id = createdTaskId;
      return run;
    });
  startForPerson = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async () => {
      const run: AIRun = new AIRun();
      run.id = createdTaskId;
      return run;
    });
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  readInsight = jest
    .spyOn(AIInsightService, "findOneBy")
    .mockImplementation(async () => {
      return currentInsight;
    });
  linkInsight = jest
    .spyOn(AIInsightService, "updateOneBy")
    .mockResolvedValue(1);
  jest
    .spyOn(SourceLocator, "getLocatableRepositories")
    .mockImplementation(async () => {
      return locatable;
    });
  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation(async (data: { repositoryId: ObjectID }) => {
      return askable.has(data.repositoryId.toString());
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TraceInsightFix.start - OneUptime on its own", () => {
  test("starts a Code task in the repository that holds the code, with the trace and the findings", async () => {
    const result: TraceInsightFixResult = await TraceInsightFix.start({
      insight: insight(),
      work: ANYWHERE,
    });

    expect(result).toEqual({ taskId: createdTaskId });

    const call: JSONObject = startForOneUptime.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["llmProviderId"]).toBeUndefined();
    expect((call["message"] as string).split("\n")[0]).toBe(
      "Make GET /orders in checkout faster",
    );
    expect(call["message"]).toContain(
      "OneUptime found this in the service's traces on its own.",
    );

    const context: Array<CodeTaskContextItem> = call[
      "context"
    ] as unknown as Array<CodeTaskContextItem>;

    expect(
      context.map((item: CodeTaskContextItem) => {
        return item.type;
      }),
    ).toEqual([CodeTaskContextType.Trace, CodeTaskContextType.Note]);
    expect(context[0]!.traceId).toBe(SLOW.sampleTraceId);
    expect(context[1]!.text).toContain(
      "Statement: SELECT * FROM orders WHERE id = ?",
    );

    // The trace is read as OneUptime: nobody here carries a person's rights.
    expect(
      (buildItem.mock.calls[0]![1] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toEqual({ isRoot: true });
  });

  test("the repository is told by the code the finding names, then the service's name, within the rules' repositories", async () => {
    const work: TelemetryAiWork = {
      ...ANYWHERE,
      repositories: { isEveryRepository: false, repositoryIds: [REPO_B] },
    };

    resolved = REPO_B;

    await TraceInsightFix.start({ insight: insight(), work });

    const request: JSONObject = resolve.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(request["stackTrace"]).toBe(
      "    at listOrders (src/orders/list.ts:42)",
    );
    expect(request["serviceName"]).toBe("checkout");
    expect(request["allowance"]).toEqual(work.repositories);
  });

  test("the rules' LLM provider is the task's", async () => {
    await TraceInsightFix.start({
      insight: insight(),
      work: { ...ANYWHERE, llmProviderId: PROVIDER },
    });

    expect(
      String(
        (startForOneUptime.mock.calls[0]![0] as unknown as JSONObject)[
          "llmProviderId"
        ],
      ),
    ).toBe(PROVIDER);
  });

  test("a trace that cannot be read any more leaves the note to carry the evidence", async () => {
    buildItem.mockImplementation(async (input: CodeTaskContextInput) => {
      if (input.type === CodeTaskContextType.Trace) {
        throw new Error("No spans were found for that trace ID");
      }

      return {
        type: input.type,
        label: "Note",
        text: input.text,
      } as CodeTaskContextItem;
    });

    await TraceInsightFix.start({ insight: insight(), work: ANYWHERE });

    const context: Array<CodeTaskContextItem> = (
      startForOneUptime.mock.calls[0]![0] as unknown as JSONObject
    )["context"] as unknown as Array<CodeTaskContextItem>;

    expect(
      context.map((item: CodeTaskContextItem) => {
        return item.type;
      }),
    ).toEqual([CodeTaskContextType.Note]);
  });

  test("no trace evidence: nothing", async () => {
    expect(
      await TraceInsightFix.start({
        insight: insight({}, null),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: TraceInsightFixSkip.NoEvidence });
    expect(
      await TraceInsightFix.start({
        insight: insight({ insightType: AIInsightType.ProfileHotspot }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: TraceInsightFixSkip.NoEvidence });
  });

  test("the day's share opened: nothing more today", async () => {
    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY;

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: TraceInsightFixSkip.DailyLimit });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("a task about the finding already on its way is its fix", async () => {
    activeTaskId = "5229bbbb-0000-4000-8000-0000000000f9";

    const result: TraceInsightFixResult = await TraceInsightFix.start({
      insight: insight(),
      work: ANYWHERE,
    });

    expect(result.taskId?.toString()).toBe(activeTaskId);
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("no repository the rules allow, or none that can be told: nothing", async () => {
    hasRepository = false;

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: TraceInsightFixSkip.NoRepository });

    hasRepository = true;
    resolved = null;

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: TraceInsightFixSkip.RepositoryNotFound });
  });

  test("Code's own gate, and the repository's cap, are held to", async () => {
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({
      skip: TraceInsightFixSkip.Blocked,
      detail: "No AI credits left.",
    });

    capCheck.mockResolvedValueOnce({
      allowed: false,
      limit: 3,
      paused: false,
      openCount: 3,
    });

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: TraceInsightFixSkip.AtPullRequestCap });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("never throws: a failure is a skip", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    startForOneUptime.mockRejectedValue(new Error("db down"));

    expect(
      await TraceInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: TraceInsightFixSkip.Failed });
  });
});

describe("TraceInsightFix - a person's Fix with AI", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  async function suggestion(): Promise<TelemetryAiFixSuggestion> {
    return TraceInsightFix.getSuggestion({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      props,
    });
  }

  test("offers Fix with AI in the repository that holds the code", async () => {
    expect(await suggestion()).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: { id: REPO_A, name: "acme/a1" },
      repositories: [],
      taskId: null,
    });

    // The finding is read as the person: one they may not read offers nothing.
    expect(
      (readInsight.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toBe(props);
  });

  test("with no repository told for certain: the ones the person may ask in, to pick from", async () => {
    resolved = null;
    askable = new Set<string>([REPO_B]);

    expect(await suggestion()).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: null,
      repositories: [{ id: REPO_B, name: "acme/b2" }],
      taskId: null,
    });
  });

  test("AI off, a closed finding, or one with a fix: nothing", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValueOnce(false);
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = insight({ status: AIInsightStatus.Dismissed });
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = insight({ fixAiRunId: ObjectID.generate() });
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = null;
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);
  });

  test("a task about it already on its way: a link to it", async () => {
    activeTaskId = "5229bbbb-0000-4000-8000-0000000000f9";

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.InProgress,
      taskId: activeTaskId,
    });
  });

  test("no repository connected: the one step, connect one", async () => {
    locatable = [];
    hasRepository = false;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.SetUp,
      blocker: { type: CodeTaskBlockerType.RepositoryNotConnected },
    });
  });

  test("repositories connected, none the person may ask in: nothing", async () => {
    askable = new Set<string>();

    expect((await suggestion()).offer).toBe(SuggestionOffer.None);
  });

  test("Code's gate in the way: its own words, with the repository it is about", async () => {
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner prod-eu is not online.",
      runnerName: "prod-eu",
    });

    expect(await suggestion()).toEqual({
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: "The Runner prod-eu is not online.",
        runnerName: "prod-eu",
        repositoryId: REPO_A,
      },
      repository: null,
      repositories: [],
      taskId: null,
    });
  });

  test("starts the person's task, in the person's name, and the finding links it", async () => {
    const created: { taskId: string } = await TraceInsightFix.createFixTask({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      userId: USER_ID,
      props,
    });

    expect(created).toEqual({ taskId: createdTaskId.toString() });

    const call: JSONObject = startForPerson.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(String(call["userId"])).toBe(USER_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["message"]).not.toContain("on its own");

    // The trace is read under the person's own permissions.
    expect(
      (buildItem.mock.calls[0]![1] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toBe(props);

    const link: JSONObject = linkInsight.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(link["data"]).toEqual({
      status: AIInsightStatus.FixOpened,
      fixAiRunId: createdTaskId,
    });
    expect(String((link["query"] as JSONObject)["_id"])).toBe(
      INSIGHT_ID.toString(),
    );
  });

  test("in the repository the person picked, when it is one they may ask in", async () => {
    resolved = null;

    await TraceInsightFix.createFixTask({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      userId: USER_ID,
      props,
      repositoryId: new ObjectID(REPO_B),
    });

    expect(
      String(
        (
          (startForPerson.mock.calls[0]![0] as unknown as JSONObject)[
            "repository"
          ] as CodeRepository
        ).id,
      ),
    ).toBe(REPO_B);

    askable = new Set<string>([REPO_A]);

    await expect(
      TraceInsightFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
        repositoryId: new ObjectID(REPO_B),
      }),
    ).rejects.toThrow(TRACE_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
  });

  test("every gate refuses in its own words", async () => {
    const create: () => Promise<{ taskId: string }> = () => {
      return TraceInsightFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
      });
    };

    currentInsight = null;
    await expect(create()).rejects.toThrow(TRACE_FIX_INSIGHT_NOT_FOUND_MESSAGE);

    currentInsight = insight({ status: AIInsightStatus.Resolved });
    await expect(create()).rejects.toThrow(TRACE_FIX_INSIGHT_CLOSED_MESSAGE);

    currentInsight = insight({ fixAiRunId: ObjectID.generate() });
    await expect(create()).rejects.toThrow(TRACE_FIX_INSIGHT_HAS_FIX_MESSAGE);

    currentInsight = insight();
    activeTaskId = "5229bbbb-0000-4000-8000-0000000000f9";
    await expect(create()).rejects.toThrow(TRACE_FIX_ALREADY_RUNNING_MESSAGE);

    activeTaskId = null;
    resolved = null;
    await expect(create()).rejects.toThrow(TRACE_FIX_PICK_REPOSITORY_MESSAGE);

    resolved = REPO_A;
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });
    await expect(create()).rejects.toThrow("No AI credits left.");

    expect(startForPerson).not.toHaveBeenCalled();
  });
});
