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
import MetricInsightFix, {
  METRIC_FIX_ALREADY_RUNNING_MESSAGE,
  METRIC_FIX_INSIGHT_CLOSED_MESSAGE,
  METRIC_FIX_INSIGHT_HAS_FIX_MESSAGE,
  METRIC_FIX_INSIGHT_NOT_FOUND_MESSAGE,
  METRIC_FIX_PICK_REPOSITORY_MESSAGE,
  METRIC_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
  MetricInsightFixResult,
  MetricInsightFixSkip,
} from "../../../../../Server/Utils/AI/TelemetryAi/MetricInsightFix";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import SourceLocator, {
  LocatableRepositoryWithTree,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import { MetricInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  CODE_TASK_LIMITS,
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
import {
  MetricBucketProblem,
  MetricCardinalityShape,
  MetricInsightKind,
  MetricValueShape,
} from "../../../../../Utils/Metrics/MetricInsight";

/*
 * The pull request for a problem OneUptime found in a service's metrics
 * (MetricInsightFix): started by OneUptime on its own only when every gate
 * holds - the day's share, no task about it already on its way, a
 * repository the rules allow that can be told to hold the code, Code's own
 * gate, room under the repository's open pull request cap - and asked for
 * by a person from the finding, under their own permissions. A metric names
 * no file: the repository is told by the service's name alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5231bbbb-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5231bbbb-0000-4000-8000-000000000002";
const INSIGHT_ID: ObjectID = new ObjectID(
  "5231bbbb-0000-4000-8000-0000000000d4",
);
const REPO_A: string = "5231bbbb-0000-4000-8000-0000000000a1";
const REPO_B: string = "5231bbbb-0000-4000-8000-0000000000b2";
const PROVIDER: string = "5231bbbb-0000-4000-8000-0000000000c3";
const USER_ID: ObjectID = new ObjectID("5231bbbb-0000-4000-8000-0000000000e5");

const USER_IDS_ON_A_COUNTER: MetricInsightEvidence = {
  serviceId: CHECKOUT,
  kind: MetricInsightKind.HighCardinality,
  shape: MetricCardinalityShape.Attribute,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  metricName: "http.server.request.count",
  unit: "{request}",
  dataPointCount: 48000,
  attributeKey: "user.id",
  attributeValueCount: 12000,
  valueShape: MetricValueShape.Uuid,
  otherAttributes: [{ key: "session.id", valueCount: 4000 }],
};

const SECONDS_IN_MILLISECOND_BUCKETS: MetricInsightEvidence = {
  serviceId: CHECKOUT,
  kind: MetricInsightKind.HistogramBuckets,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  metricName: "http.server.duration",
  unit: "s",
  dataPointCount: 2400,
  bucketProblem: MetricBucketProblem.BelowSmallestBucket,
  bucketShare: 95,
  valueCount: 2000,
  boundCount: 15,
  smallestBound: 5,
  largestBound: 10000,
  hasDefaultBounds: true,
};

const NO_METRICS: MetricInsightEvidence = {
  serviceId: CHECKOUT,
  kind: MetricInsightKind.MissingMetrics,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  spanCount: 4200,
  failedSpanCount: 12,
  topOperations: [{ name: "GET /orders", spanCount: 2000 }],
  sdkLanguage: "nodejs",
};

function insight(
  overrides: Partial<AIInsight> = {},
  evidence: MetricInsightEvidence | null = USER_IDS_ON_A_COUNTER,
): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = INSIGHT_ID;
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.MetricHighCardinality;
  value.status = AIInsightStatus.ActionRequired;
  value.serviceName = "checkout";
  if (evidence) {
    value.evidence = { metric: evidence };
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

function startCall(): JSONObject {
  return startForOneUptime.mock.calls[0]![0] as unknown as JSONObject;
}

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
            codeRepositoryId: resolved.toUpperCase(),
            organizationName: "acme",
            repositoryName: "a1",
            servicePathInRepository: null,
            method: "name-match" as const,
            evidence: "Named like checkout",
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
        label: "Note",
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

describe("MetricInsightFix.start - OneUptime on its own", () => {
  test("starts a Code task in the repository that holds the code, with what OneUptime found as a note", async () => {
    const result: MetricInsightFixResult = await MetricInsightFix.start({
      insight: insight(),
      work: ANYWHERE,
    });

    expect(result).toEqual({ taskId: createdTaskId });

    const call: JSONObject = startCall();

    expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["llmProviderId"]).toBeUndefined();
    expect((call["message"] as string).split("\n")[0]).toBe(
      "Stop recording user.id on http.server.request.count in checkout",
    );
    expect(call["message"]).toContain(
      "OneUptime found this in the service's metrics on its own.",
    );
    expect(call["message"]).toContain("say where and change nothing");

    const context: Array<CodeTaskContextItem> = call[
      "context"
    ] as unknown as Array<CodeTaskContextItem>;

    expect(
      context.map((item: CodeTaskContextItem) => {
        return item.type;
      }),
    ).toEqual([CodeTaskContextType.Note]);
    expect(context[0]!.text).toContain(
      "Attribute: user.id, 12,000 different values, which look like UUIDs",
    );
    expect(context[0]!.text).toContain(
      "Window: 2026-10-24T08:00:00.000Z to 2026-10-24T09:00:00.000Z",
    );

    // The note is built as OneUptime: nobody here carries a person's rights.
    expect(
      (buildItem.mock.calls[0]![1] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toEqual({ isRoot: true });
  });

  test("each kind of finding asks for its own change", async () => {
    await MetricInsightFix.start({
      insight: insight(
        { insightType: AIInsightType.MetricHistogramBuckets },
        SECONDS_IN_MILLISECOND_BUCKETS,
      ),
      work: ANYWHERE,
    });
    await MetricInsightFix.start({
      insight: insight(
        { insightType: AIInsightType.MetricMissingMetrics },
        NO_METRICS,
      ),
      work: ANYWHERE,
    });

    const messages: Array<string> = startForOneUptime.mock.calls.map(
      (call: Array<unknown>): string => {
        return String((call[0] as JSONObject)["message"]);
      },
    );

    expect(messages[0]!.split("\n")[0]).toBe(
      "Fix the buckets of http.server.duration in checkout",
    );
    expect(messages[0]).toContain("semantic conventions' boundaries");
    expect(messages[1]!.split("\n")[0]).toBe("Add metrics to checkout");
    expect(messages[1]).toContain(
      "Set up the OpenTelemetry metrics SDK in this service",
    );
  });

  test("the repository is told by the service's name, within the rules' repositories: a metric names no file", async () => {
    const work: TelemetryAiWork = {
      ...ANYWHERE,
      repositories: { isEveryRepository: false, repositoryIds: [REPO_B] },
    };

    resolved = REPO_B;

    await MetricInsightFix.start({ insight: insight(), work });

    const request: JSONObject = resolve.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(request["stackTrace"]).toBeNull();
    expect(request["serviceName"]).toBe("checkout");
    expect(request["allowance"]).toEqual(work.repositories);
    // The id is read whatever its case.
    expect(String((startCall()["repository"] as CodeRepository).id)).toBe(
      REPO_B,
    );
  });

  test("the rules' LLM provider is the task's", async () => {
    await MetricInsightFix.start({
      insight: insight(),
      work: { ...ANYWHERE, llmProviderId: PROVIDER },
    });

    expect(String(startCall()["llmProviderId"])).toBe(PROVIDER);
  });

  test("a note longer than a task takes is cut to it", async () => {
    await MetricInsightFix.start({
      insight: insight(
        { insightType: AIInsightType.MetricMissingMetrics },
        {
          ...NO_METRICS,
          topOperations: Array.from(
            { length: 2000 },
            (_value: unknown, index: number) => {
              return { name: `GET /operation/${index}`, spanCount: 1000 };
            },
          ),
        },
      ),
      work: ANYWHERE,
    });

    const input: CodeTaskContextInput = buildItem.mock.calls[0]![0];

    expect(input.text!.length).toBe(CODE_TASK_LIMITS.maxNoteLength);
  });

  test("no metric evidence, or a finding of another kind: nothing", async () => {
    expect(
      await MetricInsightFix.start({
        insight: insight({}, null),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: MetricInsightFixSkip.NoEvidence });
    // A drift finding belongs to AI Insights, not to Metrics' AI section.
    expect(
      await MetricInsightFix.start({
        insight: insight({ insightType: AIInsightType.MetricDrift }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: MetricInsightFixSkip.NoEvidence });
    expect(
      await MetricInsightFix.start({
        insight: insight({}, { ...USER_IDS_ON_A_COUNTER, kind: "Slow" }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: MetricInsightFixSkip.NoEvidence });
    expect(
      await MetricInsightFix.start({
        insight: insight({}, { ...USER_IDS_ON_A_COUNTER, serviceId: "" }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: MetricInsightFixSkip.NoEvidence });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("the day's share opened: nothing more today", async () => {
    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY;

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.DailyLimit });
    expect(startForOneUptime).not.toHaveBeenCalled();

    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY - 1;

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ taskId: createdTaskId });
  });

  test("a task about the finding already on its way is its fix", async () => {
    activeTaskId = "5231bbbb-0000-4000-8000-0000000000f9";

    const result: MetricInsightFixResult = await MetricInsightFix.start({
      insight: insight(),
      work: ANYWHERE,
    });

    expect(result.taskId?.toString()).toBe(activeTaskId);
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("no repository the rules allow, or none that can be told: nothing", async () => {
    hasRepository = false;

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.NoRepository });

    hasRepository = true;
    resolved = null;

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.RepositoryNotFound });

    jest.spyOn(console, "debug").mockImplementation(() => {});
    resolve.mockRejectedValueOnce(new Error("GitHub is down"));

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.RepositoryNotFound });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("Code's own gate, read with the project's plan, and the repository's cap, are held to", async () => {
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({
      skip: MetricInsightFixSkip.Blocked,
      detail: "No AI credits left.",
    });
    expect(
      (getBlocker.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true, isSubscriptionUnpaid: false });

    capCheck.mockResolvedValueOnce({
      allowed: false,
      limit: 3,
      paused: false,
      openCount: 3,
    });

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.AtPullRequestCap });
    expect(
      (capCheck.mock.calls[0]![0] as { configuredLimit: number | null })
        .configuredLimit,
    ).toBe(3);
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("never throws: a failure is a skip", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    startForOneUptime.mockRejectedValue(new Error("db down"));

    expect(
      await MetricInsightFix.start({ insight: insight(), work: ANYWHERE }),
    ).toEqual({ skip: MetricInsightFixSkip.Failed });
  });
});

describe("MetricInsightFix - a person's Fix with AI", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  async function suggestion(): Promise<TelemetryAiFixSuggestion> {
    return MetricInsightFix.getSuggestion({
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

    // The finding is read as the person, among the lane's types only.
    const read: JSONObject = readInsight.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(read["props"]).toBe(props);
    expect(
      JSON.stringify((read["query"] as JSONObject)["insightType"]),
    ).toContain(AIInsightType.MetricMissingMetrics);
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

  test("AI off, a closed finding, one with a fix, or none: nothing", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValueOnce(false);
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = insight({ status: AIInsightStatus.Dismissed });
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = insight({ fixAiRunId: ObjectID.generate() });
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = insight({}, null);
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);

    currentInsight = null;
    expect((await suggestion()).offer).toBe(SuggestionOffer.None);
  });

  test("a task about it already on its way: a link to it", async () => {
    activeTaskId = "5231bbbb-0000-4000-8000-0000000000f9";

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
    const created: { taskId: string } = await MetricInsightFix.createFixTask({
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
    expect((call["message"] as string).split("\n")[0]).toBe(
      "Stop recording user.id on http.server.request.count in checkout",
    );
    expect(call["message"]).not.toContain("on its own");
    expect(call["message"]).not.toContain("change nothing");

    // The note is built under the person's own permissions.
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
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("in the repository the person picked, when it is one they may ask in", async () => {
    resolved = null;

    await MetricInsightFix.createFixTask({
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
      MetricInsightFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
        repositoryId: new ObjectID(REPO_B),
      }),
    ).rejects.toThrow(METRIC_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE);
  });

  test("every gate refuses in its own words", async () => {
    const create: () => Promise<{ taskId: string }> = () => {
      return MetricInsightFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
      });
    };

    currentInsight = null;
    await expect(create()).rejects.toThrow(
      METRIC_FIX_INSIGHT_NOT_FOUND_MESSAGE,
    );

    currentInsight = insight({ status: AIInsightStatus.Resolved });
    await expect(create()).rejects.toThrow(METRIC_FIX_INSIGHT_CLOSED_MESSAGE);

    currentInsight = insight({ fixAiRunId: ObjectID.generate() });
    await expect(create()).rejects.toThrow(METRIC_FIX_INSIGHT_HAS_FIX_MESSAGE);

    currentInsight = insight();
    activeTaskId = "5231bbbb-0000-4000-8000-0000000000f9";
    await expect(create()).rejects.toThrow(METRIC_FIX_ALREADY_RUNNING_MESSAGE);

    activeTaskId = null;
    resolved = null;
    await expect(create()).rejects.toThrow(METRIC_FIX_PICK_REPOSITORY_MESSAGE);

    locatable = [];
    await expect(create()).rejects.toThrow(
      METRIC_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
    );

    locatable = [repository(REPO_A), repository(REPO_B)];
    resolved = REPO_A;
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });
    await expect(create()).rejects.toThrow("No AI credits left.");

    expect(startForPerson).not.toHaveBeenCalled();
  });

  test("the project's AI switch is asked before anything is read", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValueOnce(new Error("AI is off for this project."));

    await expect(
      MetricInsightFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
      }),
    ).rejects.toThrow("AI is off for this project.");
    expect(readInsight).not.toHaveBeenCalled();
  });
});
