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
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService from "../../../../../Server/Services/AIService";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import OpenPullRequestCap from "../../../../../Server/Utils/AI/CodeFix/OpenPullRequestCap";
import CodeTaskAccess from "../../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import SubjectCodeFixRun from "../../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import ExceptionInsightFix, {
  EXCEPTION_FIX_ALREADY_RUNNING_MESSAGE,
  EXCEPTION_FIX_EXCEPTION_CLOSED_MESSAGE,
  EXCEPTION_FIX_INSIGHT_CLOSED_MESSAGE,
  EXCEPTION_FIX_INSIGHT_HAS_FIX_MESSAGE,
  EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE,
  EXCEPTION_FIX_PICK_REPOSITORY_MESSAGE,
  EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
  ExceptionInsightFixResult,
  ExceptionInsightFixSkip,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionInsightFix";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import SourceLocator, {
  LocatableRepositoryWithTree,
} from "../../../../../Server/Utils/CodeRepository/SourceLocator";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import { AIFixReadiness } from "../../../../../Types/AI/AIFixReadiness";
import { ExceptionStackTraceInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
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
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ErrorClass from "../../../../../Types/Telemetry/ErrorClass";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
} from "../../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * The pull request for an exception problem OneUptime found
 * (ExceptionInsightFix): for a new or rising exception, the exception's own
 * AI task - a fix of the code at fault, or better handling of an expected
 * error, by the investigation's verdict - and for a service's missing stack
 * traces, a request in Code. OneUptime starts one on its own only when every
 * gate holds; a person asks for one from the finding, under their own
 * permissions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5240cccc-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5240cccc-0000-4000-8000-000000000002";
const INSIGHT_ID: ObjectID = new ObjectID(
  "5240cccc-0000-4000-8000-0000000000d4",
);
const EXCEPTION_ID: string = "5240cccc-0000-4000-8000-0000000000e1";
const LOUDEST: string = "5240cccc-0000-4000-8000-0000000000e2";
const REPO_A: string = "5240cccc-0000-4000-8000-0000000000a1";
const REPO_B: string = "5240cccc-0000-4000-8000-0000000000b2";
const PROVIDER: string = "5240cccc-0000-4000-8000-0000000000c3";
const USER_ID: ObjectID = new ObjectID("5240cccc-0000-4000-8000-0000000000e5");
const ACTIVE_TASK: string = "5240cccc-0000-4000-8000-0000000000f9";

// A stack trace with a frame of the application's own code.
const OWN_CODE_STACK: string = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at getOrder (/app/src/orders.ts:42:17)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
].join("\n");

// One raised in the runtime's frames only.
const LIBRARY_ONLY_STACK: string = [
  "Error: socket hang up",
  "    at connResetException (node:internal/errors:720:14)",
  "    at TLSSocket.socketOnEnd (node:_http_client:525:23)",
].join("\n");

const MISSING: ExceptionStackTraceInsightEvidence = {
  serviceId: CHECKOUT,
  windowStartTime: "2026-10-23T09:00:04.000Z",
  windowEndTime: "2026-10-24T09:00:04.000Z",
  exceptions: [
    {
      telemetryExceptionId: LOUDEST,
      exceptionType: "PaymentError",
      exceptionMessage: "card declined",
      occurrenceCount: 120,
      lastSeenAt: "2026-10-24T08:59:00.000Z",
    },
  ],
  exceptionCount: 1,
  occurrenceCount: 120,
  withStackTraceCount: 4,
};

function exceptionInsight(overrides: Partial<AIInsight> = {}): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = INSIGHT_ID;
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.NewException;
  value.status = AIInsightStatus.ActionRequired;
  value.serviceName = "checkout";
  value.telemetryExceptionId = new ObjectID(EXCEPTION_ID);
  value.classification = ErrorClass.CodeFault;
  Object.assign(value, overrides);
  return value;
}

function stackTraceInsight(
  overrides: Partial<AIInsight> = {},
  evidence: ExceptionStackTraceInsightEvidence | null = MISSING,
): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = INSIGHT_ID;
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.ExceptionMissingStackTrace;
  value.status = AIInsightStatus.ActionRequired;
  value.serviceName = "checkout";
  value.telemetryServiceId = new ObjectID(CHECKOUT);
  if (evidence) {
    value.evidence = { exceptionStackTrace: evidence };
  }
  Object.assign(value, overrides);
  return value;
}

function exception(
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  const value: TelemetryException = new TelemetryException();
  value.id = new ObjectID(EXCEPTION_ID);
  value.stackTrace = OWN_CODE_STACK;
  value.isResolved = false;
  value.isArchived = false;
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

function ready(): AIFixReadiness {
  return {
    ready: true,
    checks: [
      { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
      {
        id: "repositoryResolved",
        ok: true,
        title: "Repository resolved: acme/a1",
        detail: "",
      },
      { id: "agentAvailable", ok: true, title: "Runner online", detail: "" },
    ],
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
let currentInsight: AIInsight | null;
let currentException: TelemetryException | null;
let readiness: AIFixReadiness;
let activeExceptionRun: AIRun | null;
let resolve: SpyInstance<
  typeof CodeRepositoryService.resolveRepositoryForException
>;
let readException: SpyInstance<typeof TelemetryExceptionService.findOneBy>;
let createRun: SpyInstance<
  typeof TelemetryExceptionService.createCodeFixRunForException
>;
let getBlocker: SpyInstance<typeof CodeTaskGate.getBlocker>;
let capCheck: SpyInstance<typeof OpenPullRequestCap.checkForRepository>;
let buildItem: SpyInstance<typeof CodeTaskContextBuilder.buildItem>;
let startForOneUptime: SpyInstance<typeof CodeTaskRuns.startForOneUptime>;
let startForPerson: SpyInstance<typeof CodeTaskRuns.start>;
let readInsight: SpyInstance<typeof AIInsightService.findOneBy>;
let linkInsight: SpyInstance<typeof AIInsightService.updateOneBy>;
let readActiveRun: SpyInstance<typeof AIRunService.findOneBy>;
const createdTaskId: ObjectID = ObjectID.generate();

function firstArgument(spy: SpyInstance<never>, call: number = 0): JSONObject {
  return spy.mock.calls[call]![0] as unknown as JSONObject;
}

beforeEach(() => {
  startedToday = 0;
  activeTaskId = null;
  hasRepository = true;
  resolved = REPO_A;
  locatable = [repository(REPO_A), repository(REPO_B)];
  askable = new Set<string>([REPO_A, REPO_B]);
  currentInsight = exceptionInsight();
  currentException = exception();
  readiness = ready();
  activeExceptionRun = null;

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
            repositoryName: resolved.substring(resolved.length - 2),
            servicePathInRepository: null,
            method: "stack-trace" as const,
            evidence: "Matched src/orders.ts",
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
          input.type === CodeTaskContextType.Exception
            ? "PaymentError: card declined"
            : "Note",
        ...(input.id ? { recordId: input.id } : {}),
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
  readException = jest
    .spyOn(TelemetryExceptionService, "findOneBy")
    .mockImplementation(async () => {
      return currentException;
    });
  createRun = jest
    .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
    .mockImplementation(async () => {
      const run: AIRun = new AIRun();
      run.id = createdTaskId;
      return run;
    });
  jest
    .spyOn(TelemetryExceptionService, "getAIFixReadiness")
    .mockImplementation(async () => {
      return readiness;
    });
  readActiveRun = jest
    .spyOn(AIRunService, "findOneBy")
    .mockImplementation(async () => {
      return activeExceptionRun;
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

describe("ExceptionInsightFix.start - OneUptime on its own, for a new or rising exception", () => {
  test("a fault of the code: the exception's own fix, linked to the finding, in the repository its stack trace names", async () => {
    const result: ExceptionInsightFixResult = await ExceptionInsightFix.start({
      insight: exceptionInsight(),
      work: ANYWHERE,
    });

    expect(result).toEqual({ taskId: createdTaskId });
    expect(createRun).toHaveBeenCalledTimes(1);

    const call: JSONObject = firstArgument(createRun as never);

    expect(String(call["telemetryExceptionId"])).toBe(EXCEPTION_ID);
    expect(call["taskType"]).toBe(CodeFixTaskType.FixException);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(String(call["codeRepositoryId"])).toBe(REPO_A);
    expect(call["llmProviderId"]).toBeUndefined();
    // As the system: a pull request a person closed keeps it paused.
    expect(call["props"]).toEqual({ isRoot: true });

    // The repository is told by the exception's own stack trace first.
    const request: JSONObject = firstArgument(resolve as never);

    expect(request["stackTrace"]).toBe(OWN_CODE_STACK);
    expect(request["serviceName"]).toBe("checkout");
    expect(request["allowance"]).toEqual(ANYWHERE.repositories);

    // The exception is read as OneUptime, with what decides the fix.
    expect(firstArgument(readException as never)).toMatchObject({
      query: { _id: EXCEPTION_ID, projectId: PROJECT_ID },
      select: {
        stackTrace: true,
        isResolved: true,
        isArchived: true,
        aiFixDeclinedAt: true,
      },
      props: { isRoot: true },
    });
  });

  test("an expected error - a user's bad input or an intentional denial: better handling of it", async () => {
    for (const classification of [
      ErrorClass.UserError,
      ErrorClass.ExpectedDenial,
    ]) {
      createRun.mockClear();

      expect(
        await ExceptionInsightFix.start({
          insight: exceptionInsight({ classification }),
          work: ANYWHERE,
        }),
      ).toEqual({ taskId: createdTaskId });
      expect(firstArgument(createRun as never)["taskType"]).toBe(
        CodeFixTaskType.ImproveExceptionHandling,
      );
    }
  });

  test("a rising exception goes the same way", async () => {
    await ExceptionInsightFix.start({
      insight: exceptionInsight({ insightType: AIInsightType.ExceptionSpike }),
      work: ANYWHERE,
    });

    expect(firstArgument(createRun as never)["taskType"]).toBe(
      CodeFixTaskType.FixException,
    );
  });

  test("the rules' LLM provider and repositories are the task's", async () => {
    const work: TelemetryAiWork = {
      ...ANYWHERE,
      llmProviderId: PROVIDER,
      repositories: { isEveryRepository: false, repositoryIds: [REPO_B] },
    };

    resolved = REPO_B;

    await ExceptionInsightFix.start({ insight: exceptionInsight(), work });

    const call: JSONObject = firstArgument(createRun as never);

    expect(String(call["llmProviderId"])).toBe(PROVIDER);
    expect(String(call["codeRepositoryId"])).toBe(REPO_B);
    expect(firstArgument(resolve as never)["allowance"]).toEqual(
      work.repositories,
    );
    expect(
      (
        SubjectCodeFixRun.hasConnectedRepository as unknown as SpyInstance<never>
      ).mock.calls[0],
    ).toEqual([PROJECT_ID, work.repositories]);
  });

  test("no verdict yet, or one that opens nothing - infrastructure, unknown: nothing", async () => {
    for (const classification of [
      undefined,
      ErrorClass.Infrastructure,
      ErrorClass.Unknown,
      "something-else",
    ]) {
      expect(
        await ExceptionInsightFix.start({
          insight: exceptionInsight({ classification }),
          work: ANYWHERE,
        }),
      ).toEqual({ skip: ExceptionInsightFixSkip.NoVerdict });
    }

    expect(createRun).not.toHaveBeenCalled();
  });

  test("raised in library and runtime code only, or with no stack trace: nothing to change", async () => {
    for (const stackTrace of [LIBRARY_ONLY_STACK, "", undefined]) {
      currentException = exception({ stackTrace });

      expect(
        await ExceptionInsightFix.start({
          insight: exceptionInsight(),
          work: ANYWHERE,
        }),
      ).toEqual({ skip: ExceptionInsightFixSkip.NotOwnCode });
    }

    expect(resolve).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  test("an exception gone, resolved or archived: nothing", async () => {
    for (const value of [
      null,
      exception({ isResolved: true }),
      exception({ isArchived: true }),
    ]) {
      currentException = value;

      expect(
        await ExceptionInsightFix.start({
          insight: exceptionInsight(),
          work: ANYWHERE,
        }),
      ).toEqual({ skip: ExceptionInsightFixSkip.ExceptionClosed });
    }

    expect(createRun).not.toHaveBeenCalled();
  });

  test("a person closed its last AI pull request without merging it: nothing on its own", async () => {
    currentException = exception({ aiFixDeclinedAt: new Date() });

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.Declined });
    expect(createRun).not.toHaveBeenCalled();
  });

  test("the day's share opened: nothing more today, and nothing else is read", async () => {
    startedToday = TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY;

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.DailyLimit });
    expect(readException).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });

  test("a task about the finding already on its way is its fix", async () => {
    activeTaskId = ACTIVE_TASK;

    const result: ExceptionInsightFixResult = await ExceptionInsightFix.start({
      insight: exceptionInsight(),
      work: ANYWHERE,
    });

    expect(result.taskId?.toString()).toBe(ACTIVE_TASK);
    expect(createRun).not.toHaveBeenCalled();
  });

  test("no repository the rules allow, none that can be told to hold the code, or one gone: nothing", async () => {
    hasRepository = false;

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoRepository });

    hasRepository = true;
    resolved = null;

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.RepositoryNotFound });

    resolved = REPO_A;
    jest.spyOn(CodeRepositoryService, "findOneBy").mockResolvedValueOnce(null);

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoRepository });
    expect(createRun).not.toHaveBeenCalled();
  });

  test("the repository's cap on open AI pull requests is held to", async () => {
    capCheck.mockResolvedValueOnce({
      allowed: false,
      limit: 3,
      paused: false,
      openCount: 3,
    });

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.AtPullRequestCap });
    expect(String(firstArgument(capCheck as never)["codeRepositoryId"])).toBe(
      REPO_A,
    );
    expect(firstArgument(capCheck as never)["configuredLimit"]).toBe(3);
    expect(createRun).not.toHaveBeenCalled();
  });

  test("the exception's own gates refuse: a skip in their words, looked at again next time", async () => {
    createRun.mockRejectedValueOnce(
      new BadDataException(
        "Cannot start the AI fix — missing prerequisites: Runner online.",
      ),
    );

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({
      skip: ExceptionInsightFixSkip.Refused,
      detail: "Cannot start the AI fix — missing prerequisites: Runner online.",
    });
  });

  test("never throws: a failure is a skip", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    createRun.mockRejectedValueOnce(new Error("db down"));

    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.Failed });
  });

  test("a finding of no exception kind, or with no exception: nothing", async () => {
    expect(
      await ExceptionInsightFix.start({
        insight: exceptionInsight({
          insightType: AIInsightType.TraceSlowOperation,
        }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoEvidence });

    const noException: AIInsight = exceptionInsight();
    delete noException.telemetryExceptionId;

    expect(
      await ExceptionInsightFix.start({ insight: noException, work: ANYWHERE }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoEvidence });
    expect(createRun).not.toHaveBeenCalled();
  });
});

describe("ExceptionInsightFix.start - OneUptime on its own, for a service's missing stack traces", () => {
  test("a request in Code, in the repository named like the service, with the loudest exception and what was found", async () => {
    const result: ExceptionInsightFixResult = await ExceptionInsightFix.start({
      insight: stackTraceInsight(),
      work: ANYWHERE,
    });

    expect(result).toEqual({ taskId: createdTaskId });
    expect(createRun).not.toHaveBeenCalled();

    const call: JSONObject = firstArgument(startForOneUptime as never);

    expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["llmProviderId"]).toBeUndefined();

    const message: Array<string> = (call["message"] as string).split("\n");

    expect(message[0]).toBe("Record a stack trace with checkout's exceptions");
    expect(call["message"]).toContain(
      "OneUptime found this in the service's exceptions on its own.",
    );
    expect(call["message"]).toContain("change nothing");

    const context: Array<CodeTaskContextItem> = call[
      "context"
    ] as unknown as Array<CodeTaskContextItem>;

    expect(
      context.map((item: CodeTaskContextItem): CodeTaskContextType => {
        return item.type;
      }),
    ).toEqual([CodeTaskContextType.Exception, CodeTaskContextType.Note]);
    expect(context[0]!.recordId).toBe(LOUDEST);
    expect(context[1]!.text).toContain(
      "Exceptions of the service that day with a stack trace: 4",
    );

    // Read as OneUptime: nobody here carries a person's rights.
    expect(
      (buildItem.mock.calls[0]![1] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toEqual({ isRoot: true });

    // The service's code: told by its name, with no stack trace to go by.
    const request: JSONObject = firstArgument(resolve as never);

    expect(request["stackTrace"]).toBeNull();
    expect(request["serviceName"]).toBe("checkout");
    expect(request["allowance"]).toEqual(ANYWHERE.repositories);
  });

  test("Code's own gate, as a person asking would meet it - the project's plan and bill with it", async () => {
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: true });
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });

    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({
      skip: ExceptionInsightFixSkip.Blocked,
      detail: "No AI credits left.",
    });
    expect(firstArgument(getBlocker as never)["props"]).toEqual({
      isRoot: true,
      currentPlan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("the repository's cap, and the rules' provider", async () => {
    capCheck.mockResolvedValueOnce({
      allowed: false,
      limit: 3,
      paused: false,
      openCount: 3,
    });

    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.AtPullRequestCap });
    expect(startForOneUptime).not.toHaveBeenCalled();

    await ExceptionInsightFix.start({
      insight: stackTraceInsight(),
      work: { ...ANYWHERE, llmProviderId: PROVIDER },
    });

    expect(
      String(firstArgument(startForOneUptime as never)["llmProviderId"]),
    ).toBe(PROVIDER);
  });

  test("no evidence, or evidence with no service: nothing", async () => {
    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight({}, null),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoEvidence });
    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight({}, { ...MISSING, serviceId: "" }),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoEvidence });
  });

  test("no repository, or none told to hold the service's code: nothing", async () => {
    hasRepository = false;

    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.NoRepository });

    hasRepository = true;
    resolved = null;

    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.RepositoryNotFound });

    // A resolver that fails tells nothing, rather than throwing.
    jest.spyOn(console, "debug").mockImplementation(() => {});
    resolve.mockRejectedValueOnce(new Error("git host down"));

    expect(
      await ExceptionInsightFix.start({
        insight: stackTraceInsight(),
        work: ANYWHERE,
      }),
    ).toEqual({ skip: ExceptionInsightFixSkip.RepositoryNotFound });
    expect(startForOneUptime).not.toHaveBeenCalled();
  });

  test("a loudest exception that cannot be read any more leaves the note to carry the evidence", async () => {
    jest.spyOn(console, "debug").mockImplementation(() => {});
    buildItem.mockImplementation(async (input: CodeTaskContextInput) => {
      if (input.type === CodeTaskContextType.Exception) {
        throw new Error("Exception not found");
      }

      return {
        type: input.type,
        label: "Note",
        text: input.text,
      } as CodeTaskContextItem;
    });

    await ExceptionInsightFix.start({
      insight: stackTraceInsight(),
      work: ANYWHERE,
    });

    const context: Array<CodeTaskContextItem> = firstArgument(
      startForOneUptime as never,
    )["context"] as unknown as Array<CodeTaskContextItem>;

    expect(
      context.map((item: CodeTaskContextItem): CodeTaskContextType => {
        return item.type;
      }),
    ).toEqual([CodeTaskContextType.Note]);
  });

  test("an evidence id that is not one is never read", async () => {
    await ExceptionInsightFix.start({
      insight: stackTraceInsight(
        {},
        {
          ...MISSING,
          exceptions: [
            { ...MISSING.exceptions[0]!, telemetryExceptionId: "not-an-id" },
          ],
        },
      ),
      work: ANYWHERE,
    });

    expect(
      buildItem.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as CodeTaskContextInput).type;
      }),
    ).toEqual([CodeTaskContextType.Note]);
  });
});

describe("ExceptionInsightFix.getReadinessBlocker - the exception's own checklist in Code's words", () => {
  test("its first failed check: a provider, a Runner, the repository", () => {
    expect(
      ExceptionInsightFix.getReadinessBlocker({
        ready: false,
        checks: [
          {
            id: "llmProvider",
            ok: false,
            title: "LLM provider",
            detail: "Add an LLM provider in Settings.",
          },
          {
            id: "agentAvailable",
            ok: false,
            title: "Runner online",
            detail: "Start a Runner.",
          },
        ],
      }),
    ).toEqual({
      type: CodeTaskBlockerType.NoLlmProvider,
      message: "Add an LLM provider in Settings.",
    });

    expect(
      ExceptionInsightFix.getReadinessBlocker({
        ready: false,
        checks: [
          { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
          {
            id: "agentAvailable",
            ok: false,
            title: "Runner online",
            detail: "",
          },
        ],
      }),
    ).toEqual({ type: CodeTaskBlockerType.NoAgent, message: "Runner online" });

    expect(
      ExceptionInsightFix.getReadinessBlocker({
        ready: false,
        checks: [
          {
            id: "repositoryResolved",
            ok: false,
            title: "Repository resolved",
            detail: "Connect the right repository in Code.",
          },
        ],
      })?.type,
    ).toBe(CodeTaskBlockerType.RepositoryNotConnected);
  });

  test("every check passing: nothing in the way", () => {
    expect(ExceptionInsightFix.getReadinessBlocker(ready())).toBeNull();
  });
});

describe("ExceptionInsightFix - a person's Fix with AI on a new or rising exception", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  async function suggestion(): Promise<TelemetryAiFixSuggestion> {
    return ExceptionInsightFix.getSuggestion({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      props,
    });
  }

  test("offers the fix in the repository its stack trace names", async () => {
    expect(await suggestion()).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: { id: REPO_A, name: "acme/a1" },
      repositories: [],
      taskId: null,
      recipe: CodeFixTaskType.FixException,
    });

    // The finding and the exception are read as the person.
    expect(firstArgument(readInsight as never)["props"]).toBe(props);
    expect(firstArgument(readException as never)["props"]).toBe(props);
  });

  test("an expected error: better handling - and no verdict yet: a fix, as the person decides", async () => {
    currentInsight = exceptionInsight({ classification: ErrorClass.UserError });
    expect((await suggestion()).recipe).toBe(
      CodeFixTaskType.ImproveExceptionHandling,
    );

    currentInsight = exceptionInsight({ classification: undefined });
    expect((await suggestion()).recipe).toBe(CodeFixTaskType.FixException);

    // A person's ask needs no frame of their own code either.
    currentException = exception({ stackTrace: LIBRARY_ONLY_STACK });
    expect((await suggestion()).offer).toBe(SuggestionOffer.Act);
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
      recipe: CodeFixTaskType.FixException,
    });

    askable = new Set<string>();
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
  });

  test("AI off, a finding closed, with a fix or not theirs to read, an exception closed or unreadable: nothing", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValueOnce(false);
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);

    currentInsight = exceptionInsight({ status: AIInsightStatus.Dismissed });
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);

    currentInsight = exceptionInsight({ fixAiRunId: ObjectID.generate() });
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);

    currentInsight = null;
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);

    currentInsight = exceptionInsight();

    for (const value of [
      null,
      exception({ isResolved: true }),
      exception({ isArchived: true }),
    ]) {
      currentException = value;
      expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
    }

    currentException = exception();
    readException.mockRejectedValueOnce(new Error("no permission"));
    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
  });

  test("a task already on its way - for the finding, or one started on the exception's own page: a link to it", async () => {
    activeTaskId = ACTIVE_TASK;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.InProgress,
      taskId: ACTIVE_TASK,
    });

    activeTaskId = null;
    const codeTaskId: ObjectID = ObjectID.generate();
    activeExceptionRun = new AIRun();
    activeExceptionRun.id = ObjectID.generate();
    activeExceptionRun.codeTaskId = codeTaskId;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.InProgress,
      taskId: codeTaskId.toString(),
    });

    const query: JSONObject = firstArgument(readActiveRun as never)[
      "query"
    ] as JSONObject;

    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(String(query["triggeredByTelemetryExceptionId"])).toBe(EXCEPTION_ID);
    expect(JSON.stringify(query["codeFixTaskType"])).toContain(
      CodeFixTaskType.FixException,
    );
    expect(JSON.stringify(query["codeFixTaskType"])).toContain(
      CodeFixTaskType.ImproveExceptionHandling,
    );
  });

  test("no repository connected: the one step, connect one", async () => {
    hasRepository = false;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.SetUp,
      blocker: { type: CodeTaskBlockerType.RepositoryNotConnected },
    });
  });

  test("the exception's readiness in the way: its words - a repository it could not tell is the strip's own to ask", async () => {
    readiness = {
      ready: false,
      checks: [
        {
          id: "llmProvider",
          ok: false,
          title: "LLM provider",
          detail: "Add an LLM provider in Settings.",
        },
      ],
    };

    expect(await suggestion()).toEqual({
      ...NO_TELEMETRY_AI_FIX_SUGGESTION,
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.NoLlmProvider,
        message: "Add an LLM provider in Settings.",
      },
    });

    readiness = {
      ready: false,
      checks: [
        { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
        {
          id: "repositoryResolved",
          ok: false,
          title: "Repository resolved",
          detail: "No connected repository could be matched.",
        },
        { id: "agentAvailable", ok: true, title: "Runner online", detail: "" },
      ],
    };
    resolved = null;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.Act,
      repositories: [
        { id: REPO_A, name: "acme/a1" },
        { id: REPO_B, name: "acme/b2" },
      ],
    });
  });
});

describe("ExceptionInsightFix - a person's Fix with AI on a service's missing stack traces", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  async function suggestion(): Promise<TelemetryAiFixSuggestion> {
    return ExceptionInsightFix.getSuggestion({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      props,
    });
  }

  beforeEach(() => {
    currentInsight = stackTraceInsight();
  });

  test("offers a request in Code in the repository named like the service", async () => {
    expect(await suggestion()).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: { id: REPO_A, name: "acme/a1" },
      repositories: [],
      taskId: null,
      recipe: CodeFixTaskType.CodeRequest,
    });

    // Told only among the repositories the person may ask in.
    expect(firstArgument(resolve as never)["allowance"]).toEqual({
      isEveryRepository: false,
      repositoryIds: [REPO_A, REPO_B],
    });
  });

  test("none told: the ones the person may ask in, to pick from", async () => {
    resolved = null;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.Act,
      repository: null,
      repositories: [
        { id: REPO_A, name: "acme/a1" },
        { id: REPO_B, name: "acme/b2" },
      ],
    });
  });

  test("Code's gate in the way: its own words, with the repository it is about", async () => {
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner prod-eu is not online.",
      runnerName: "prod-eu",
    });

    expect(await suggestion()).toEqual({
      ...NO_TELEMETRY_AI_FIX_SUGGESTION,
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: "The Runner prod-eu is not online.",
        runnerName: "prod-eu",
        repositoryId: REPO_A,
      },
    });
  });

  test("no repository connected: connect one; connected but none the person may ask in: nothing", async () => {
    locatable = [];
    hasRepository = false;

    expect(await suggestion()).toMatchObject({
      offer: SuggestionOffer.SetUp,
      blocker: { type: CodeTaskBlockerType.RepositoryNotConnected },
    });

    locatable = [repository(REPO_A)];
    hasRepository = true;
    askable = new Set<string>();

    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
  });

  test("a finding with no evidence to fix by: nothing", async () => {
    currentInsight = stackTraceInsight({}, null);

    expect(await suggestion()).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
  });
});

describe("ExceptionInsightFix.createFixTask - the fix a person asked for", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  function create(repositoryId?: string): Promise<{ taskId: string }> {
    return ExceptionInsightFix.createFixTask({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      userId: USER_ID,
      props,
      ...(repositoryId ? { repositoryId: new ObjectID(repositoryId) } : {}),
    });
  }

  test("a new exception: the exception's own task, as the person, and the finding links it", async () => {
    expect(await create()).toEqual({ taskId: createdTaskId.toString() });

    const call: JSONObject = firstArgument(createRun as never);

    expect(String(call["telemetryExceptionId"])).toBe(EXCEPTION_ID);
    expect(call["taskType"]).toBe(CodeFixTaskType.FixException);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["codeRepositoryId"]).toBeUndefined();
    // As the person: a pull request they closed before is theirs to retry.
    expect(call["props"]).toEqual({ ...props, userId: USER_ID });

    const link: JSONObject = firstArgument(linkInsight as never);

    expect(link["data"]).toEqual({
      status: AIInsightStatus.FixOpened,
      fixAiRunId: createdTaskId,
    });

    const query: JSONObject = link["query"] as JSONObject;

    expect(String(query["_id"])).toBe(INSIGHT_ID.toString());
    // Linked once: a fix linked meanwhile, or a closed finding, stays so.
    expect(query["fixAiRunId"]).toBeDefined();
    expect(JSON.stringify(query["status"])).toContain(
      AIInsightStatus.ActionRequired,
    );
  });

  test("an expected error: better handling", async () => {
    currentInsight = exceptionInsight({
      classification: ErrorClass.ExpectedDenial,
    });

    await create();

    expect(firstArgument(createRun as never)["taskType"]).toBe(
      CodeFixTaskType.ImproveExceptionHandling,
    );
  });

  test("in the repository the person picked, when it is one they may ask in", async () => {
    await create(REPO_B);

    expect(String(firstArgument(createRun as never)["codeRepositoryId"])).toBe(
      REPO_B,
    );

    askable = new Set<string>([REPO_A]);

    await expect(create(REPO_B)).rejects.toThrow(
      EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
    );
  });

  test("the exception's own refusals reach the person in their words, and nothing is linked", async () => {
    createRun.mockRejectedValueOnce(
      new BadDataException(
        "Cannot start the AI fix — missing prerequisites: LLM provider.",
      ),
    );

    await expect(create()).rejects.toThrow(
      "Cannot start the AI fix — missing prerequisites: LLM provider.",
    );
    expect(linkInsight).not.toHaveBeenCalled();
  });

  test("missing stack traces: a request in Code in the person's name, read under their permissions", async () => {
    currentInsight = stackTraceInsight();

    expect(await create()).toEqual({ taskId: createdTaskId.toString() });
    expect(createRun).not.toHaveBeenCalled();

    const call: JSONObject = firstArgument(startForPerson as never);

    expect(String(call["userId"])).toBe(USER_ID.toString());
    expect(String((call["repository"] as CodeRepository).id)).toBe(REPO_A);
    expect(String(call["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(call["message"]).not.toContain("on its own");
    expect(call["message"]).not.toContain("change nothing");
    expect(
      (buildItem.mock.calls[0]![1] as { props: DatabaseCommonInteractionProps })
        .props,
    ).toBe(props);
    expect(firstArgument(linkInsight as never)["data"]).toEqual({
      status: AIInsightStatus.FixOpened,
      fixAiRunId: createdTaskId,
    });
  });

  test("missing stack traces in the repository the person picked; none told and none picked: pick one", async () => {
    currentInsight = stackTraceInsight();
    resolved = null;

    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_PICK_REPOSITORY_MESSAGE,
    );

    await create(REPO_B);

    expect(
      String(
        (firstArgument(startForPerson as never)["repository"] as CodeRepository)
          .id,
      ),
    ).toBe(REPO_B);

    askable = new Set<string>();

    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_REPOSITORY_NOT_AVAILABLE_MESSAGE,
    );
  });

  test("missing stack traces: Code's gate refuses in its own words", async () => {
    currentInsight = stackTraceInsight();
    getBlocker.mockResolvedValueOnce({
      type: CodeTaskBlockerType.NoAiCredits,
      message: "No AI credits left.",
    });

    await expect(create()).rejects.toThrow("No AI credits left.");
    expect(startForPerson).not.toHaveBeenCalled();
    expect(linkInsight).not.toHaveBeenCalled();
  });

  test("every gate refuses in its own words", async () => {
    currentInsight = null;
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE,
    );

    currentInsight = exceptionInsight({
      insightType: AIInsightType.TraceSlowOperation,
    });
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE,
    );

    currentInsight = exceptionInsight({ status: AIInsightStatus.Resolved });
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_INSIGHT_CLOSED_MESSAGE,
    );

    currentInsight = exceptionInsight({ fixAiRunId: ObjectID.generate() });
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_INSIGHT_HAS_FIX_MESSAGE,
    );

    currentInsight = exceptionInsight();
    activeTaskId = ACTIVE_TASK;
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_ALREADY_RUNNING_MESSAGE,
    );

    activeTaskId = null;
    currentException = null;
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_INSIGHT_NOT_FOUND_MESSAGE,
    );

    currentException = exception({ isArchived: true });
    await expect(create()).rejects.toThrow(
      EXCEPTION_FIX_EXCEPTION_CLOSED_MESSAGE,
    );

    expect(createRun).not.toHaveBeenCalled();
    expect(linkInsight).not.toHaveBeenCalled();
  });

  test("AI off: refused before anything is read", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValueOnce(new BadDataException("AI is off."));

    await expect(create()).rejects.toThrow("AI is off.");
    expect(readInsight).not.toHaveBeenCalled();
    expect(createRun).not.toHaveBeenCalled();
  });
});
