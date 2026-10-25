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
import ProfileInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/ProfileInsightFix";
import TelemetryAiFix from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiFix";
import TelemetryAiPersonFix, {
  TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE,
  TELEMETRY_AI_PERSON_FIX_PLANNERS,
} from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiPersonFix";
import TraceInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/TraceInsightFix";
import ExceptionInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionInsightFix";
import MetricInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/MetricInsightFix";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import { TelemetryAiLane } from "../../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import { NO_TELEMETRY_AI_FIX_SUGGESTION } from "../../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * What every telemetry lane's pull request shares (TelemetryAiFix): the
 * day's share counted across lanes - the Profiler's, Traces' and
 * Exceptions' together, whatever Code recipe each lane's pull requests are
 * - and one task per problem. And a person's Fix with AI on a finding
 * (TelemetryAiPersonFix), handed to the lane the finding is, read under
 * the person's own permissions.
 */

// The SQL an IN operator writes, with its values in place of their names.
function inValuesOf(operator: unknown): Array<string> {
  const raw: { _objectLiteralParameters?: Record<string, unknown> } =
    operator as { _objectLiteralParameters?: Record<string, unknown> };

  return Object.values(raw._objectLiteralParameters || {}).flatMap(
    (value: unknown): Array<string> => {
      return Array.isArray(value) ? (value as Array<string>) : [];
    },
  );
}

// Every lane's recipes: a request in Code, and an exception's own AI tasks.
const LANE_RECIPES: Array<string> = [
  CodeFixTaskType.CodeRequest,
  CodeFixTaskType.FixException,
  CodeFixTaskType.ImproveExceptionHandling,
];

const PROJECT_ID: ObjectID = new ObjectID(
  "5229dddd-0000-4000-8000-000000000001",
);
const INSIGHT_ID: ObjectID = new ObjectID(
  "5229dddd-0000-4000-8000-0000000000d4",
);

// The SQL a raw query operator writes for a column.
function sqlOf(operator: unknown, column: string): string {
  const raw: { getSql?: (alias: string) => string } = operator as {
    getSql?: (alias: string) => string;
  };

  return raw.getSql ? raw.getSql(column) : "";
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryAiFix.countStartedToday", () => {
  test("counts the tasks OneUptime started on its own today, every lane's together", async () => {
    const count: SpyInstance<typeof AIRunService.countBy> = jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(3));

    expect(await TelemetryAiFix.countStartedToday(PROJECT_ID)).toBe(3);

    const query: JSONObject = (
      count.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    // Every lane's recipes: Profiles' and Traces' requests, Exceptions' own.
    expect(inValuesOf(query["codeFixTaskType"]).sort()).toEqual(
      [...LANE_RECIPES].sort(),
    );
    // Nobody asked, it is a task's first turn, and it names an insight.
    expect(sqlOf(query["userId"], "userId")).toBe("(userId IS NULL)");
    expect(sqlOf(query["codeTaskId"], "codeTaskId")).toBe(
      "(codeTaskId IS NULL)",
    );
    expect(sqlOf(query["triggeredByAiInsightId"], "x")).toBe("(x IS NOT NULL)");
    // No insight type in the query: Profiles' and Traces' share one day.
    expect(query["insightType"]).toBeUndefined();
  });

  test("the Profiler's own count is the same count", async () => {
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(4));

    expect(await ProfileInsightFix.countStartedToday(PROJECT_ID)).toBe(4);
  });
});

describe("TelemetryAiFix.findActiveTaskIdForInsight", () => {
  test("a Code task about the insight still on its way: its task's id", async () => {
    const taskId: ObjectID = ObjectID.generate();
    const find: SpyInstance<typeof AIRunService.findOneBy> = jest
      .spyOn(AIRunService, "findOneBy")
      .mockImplementation(async () => {
        const run: AIRun = new AIRun();
        run.id = ObjectID.generate();
        run.codeTaskId = taskId;
        return run;
      });

    expect(
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
    ).toBe(taskId.toString());

    const query: JSONObject = (find.mock.calls[0]![0] as unknown as JSONObject)[
      "query"
    ] as JSONObject;

    expect(String(query["triggeredByAiInsightId"])).toBe(INSIGHT_ID.toString());
    expect(inValuesOf(query["codeFixTaskType"]).sort()).toEqual(
      [...LANE_RECIPES].sort(),
    );
    expect(JSON.stringify(query["status"])).toContain("Completed");
  });

  test("a first turn is its own task", async () => {
    const runId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRunService, "findOneBy").mockImplementation(async () => {
      const run: AIRun = new AIRun();
      run.id = runId;
      return run;
    });

    expect(
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
    ).toBe(runId.toString());
  });

  test("none on its way: null", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    expect(
      await TelemetryAiFix.findActiveTaskIdForInsight({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
      }),
    ).toBeNull();
  });
});

describe("TelemetryAiPersonFix", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  };
  let insightType: AIInsightType | null;
  let readInsight: SpyInstance<typeof AIInsightService.findOneBy>;

  beforeEach(() => {
    insightType = AIInsightType.TraceSlowOperation;
    readInsight = jest
      .spyOn(AIInsightService, "findOneBy")
      .mockImplementation(async () => {
        if (!insightType) {
          return null;
        }

        const insight: AIInsight = new AIInsight();
        insight.id = INSIGHT_ID;
        insight.insightType = insightType;
        return insight;
      });
  });

  test("Traces and Exceptions plan their own; the Profiler's findings keep the Profiler's own", () => {
    expect(
      TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Profile],
    ).toBeNull();
    expect(
      TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Trace],
    ).not.toBeNull();
    expect(
      TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Exception],
    ).not.toBeNull();
  });

  test("a trace finding is handed to Traces, read as the person", async () => {
    const suggestion: SpyInstance<typeof TraceInsightFix.getSuggestion> = jest
      .spyOn(TraceInsightFix, "getSuggestion")
      .mockResolvedValue({
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: "t",
      });

    expect(
      (
        await TelemetryAiPersonFix.getSuggestion({
          projectId: PROJECT_ID,
          insightId: INSIGHT_ID,
          props,
        })
      ).offer,
    ).toBe(SuggestionOffer.InProgress);
    expect(suggestion).toHaveBeenCalledTimes(1);
    expect(
      (readInsight.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toBe(props);
  });

  test("a finding of no lane, of the Profiler's, or one the person may not read: nothing offered, nothing started", async () => {
    const suggestion: SpyInstance<typeof TraceInsightFix.getSuggestion> =
      jest.spyOn(TraceInsightFix, "getSuggestion");
    const create: SpyInstance<typeof TraceInsightFix.createFixTask> =
      jest.spyOn(TraceInsightFix, "createFixTask");

    for (const type of [
      AIInsightType.ErrorLogSpike,
      AIInsightType.ProfileHotspot,
      null,
    ]) {
      insightType = type;

      expect(
        await TelemetryAiPersonFix.getSuggestion({
          projectId: PROJECT_ID,
          insightId: INSIGHT_ID,
          props,
        }),
      ).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);

      await expect(
        TelemetryAiPersonFix.createFixTask({
          projectId: PROJECT_ID,
          insightId: INSIGHT_ID,
          userId: props.userId!,
          props,
        }),
      ).rejects.toThrow(TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE);
    }

    expect(suggestion).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a trace finding's fix is started by Traces, with the repository picked", async () => {
    const create: SpyInstance<typeof TraceInsightFix.createFixTask> = jest
      .spyOn(TraceInsightFix, "createFixTask")
      .mockResolvedValue({ taskId: "task-1" });
    const repositoryId: ObjectID = ObjectID.generate();

    expect(
      await TelemetryAiPersonFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: props.userId!,
        props,
        repositoryId,
      }),
    ).toEqual({ taskId: "task-1" });
    expect(
      (create.mock.calls[0]![0] as unknown as JSONObject)["repositoryId"],
    ).toBe(repositoryId);
  });

  /*
   * A person's Fix with AI on an exception finding is the person's to ask,
   * whatever Exceptions' AI switch says: every kind of it - new, rising,
   * missing stack traces - is handed to Exceptions, never to Traces.
   */
  test("an exception finding, of each kind, is handed to Exceptions", async () => {
    const suggestion: SpyInstance<typeof ExceptionInsightFix.getSuggestion> =
      jest.spyOn(ExceptionInsightFix, "getSuggestion").mockResolvedValue({
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: "t",
      });
    const create: SpyInstance<typeof ExceptionInsightFix.createFixTask> = jest
      .spyOn(ExceptionInsightFix, "createFixTask")
      .mockResolvedValue({ taskId: "task-2" });
    const traceSuggestion: SpyInstance<typeof TraceInsightFix.getSuggestion> =
      jest.spyOn(TraceInsightFix, "getSuggestion");
    const repositoryId: ObjectID = ObjectID.generate();

    for (const type of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
      AIInsightType.ExceptionMissingStackTrace,
    ]) {
      insightType = type;

      expect(
        (
          await TelemetryAiPersonFix.getSuggestion({
            projectId: PROJECT_ID,
            insightId: INSIGHT_ID,
            props,
          })
        ).offer,
      ).toBe(SuggestionOffer.InProgress);
      expect(
        await TelemetryAiPersonFix.createFixTask({
          projectId: PROJECT_ID,
          insightId: INSIGHT_ID,
          userId: props.userId!,
          props,
          repositoryId,
        }),
      ).toEqual({ taskId: "task-2" });
    }

    expect(suggestion).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(3);
    expect(
      (create.mock.calls[0]![0] as unknown as JSONObject)["repositoryId"],
    ).toBe(repositoryId);
    expect(traceSuggestion).not.toHaveBeenCalled();
  });
});

describe("TelemetryAiPersonFix - Metrics' findings", () => {
  const props: DatabaseCommonInteractionProps = {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
  };
  let insightType: AIInsightType;

  beforeEach(() => {
    insightType = AIInsightType.MetricHighCardinality;
    jest.spyOn(AIInsightService, "findOneBy").mockImplementation(async () => {
      const insight: AIInsight = new AIInsight();
      insight.id = INSIGHT_ID;
      insight.insightType = insightType;
      return insight;
    });
  });

  test("Metrics plans its own", () => {
    expect(
      TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Metric],
    ).not.toBeNull();
  });

  test("each kind of metric finding is handed to Metrics, never to Traces", async () => {
    const suggestion: SpyInstance<typeof MetricInsightFix.getSuggestion> = jest
      .spyOn(MetricInsightFix, "getSuggestion")
      .mockResolvedValue({
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: "t",
      });
    const traces: SpyInstance<typeof TraceInsightFix.getSuggestion> =
      jest.spyOn(TraceInsightFix, "getSuggestion");

    for (const type of [
      AIInsightType.MetricHighCardinality,
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
    ]) {
      insightType = type;

      expect(
        (
          await TelemetryAiPersonFix.getSuggestion({
            projectId: PROJECT_ID,
            insightId: INSIGHT_ID,
            props,
          })
        ).offer,
      ).toBe(SuggestionOffer.InProgress);
    }

    expect(suggestion).toHaveBeenCalledTimes(3);
    expect(
      (suggestion.mock.calls[0]![0] as unknown as JSONObject)["props"],
    ).toBe(props);
    expect(traces).not.toHaveBeenCalled();
  });

  test("a drift finding is AI Insights' own: nothing offered, nothing started", async () => {
    const suggestion: SpyInstance<typeof MetricInsightFix.getSuggestion> =
      jest.spyOn(MetricInsightFix, "getSuggestion");
    const create: SpyInstance<typeof MetricInsightFix.createFixTask> =
      jest.spyOn(MetricInsightFix, "createFixTask");

    insightType = AIInsightType.MetricDrift;

    expect(
      await TelemetryAiPersonFix.getSuggestion({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        props,
      }),
    ).toEqual(NO_TELEMETRY_AI_FIX_SUGGESTION);
    await expect(
      TelemetryAiPersonFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: props.userId!,
        props,
      }),
    ).rejects.toThrow(TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE);
    expect(suggestion).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a metric finding's fix is started by Metrics, with the repository picked", async () => {
    const create: SpyInstance<typeof MetricInsightFix.createFixTask> = jest
      .spyOn(MetricInsightFix, "createFixTask")
      .mockResolvedValue({ taskId: "task-2" });
    const repositoryId: ObjectID = ObjectID.generate();

    insightType = AIInsightType.MetricMissingMetrics;

    expect(
      await TelemetryAiPersonFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: props.userId!,
        props,
        repositoryId,
      }),
    ).toEqual({ taskId: "task-2" });
    expect(
      (create.mock.calls[0]![0] as unknown as JSONObject)["repositoryId"],
    ).toBe(repositoryId);
  });
});
