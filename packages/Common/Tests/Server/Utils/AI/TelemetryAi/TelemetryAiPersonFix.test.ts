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
import LogInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/LogInsightFix";
import TelemetryAiPersonFix, {
  TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE,
  TELEMETRY_AI_PERSON_FIX_PLANNERS,
} from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiPersonFix";
import TraceInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/TraceInsightFix";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
} from "../../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SuggestionOffer from "../../../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
} from "../../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

/*
 * "Fix with AI" on a lane's finding, asked by a person (TelemetryAiPersonFix):
 * the finding is read under the person's own permissions, and handed to its
 * lane's planner - Traces' to TraceInsightFix, Logs' to LogInsightFix. The
 * Profiler's findings keep the Profiler's own Fix with AI: its lane has none
 * here, so nothing is offered for one, and asking is refused.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a550000-0000-4000-8000-000000000001",
);
const INSIGHT_ID: ObjectID = new ObjectID(
  "5a550000-0000-4000-8000-0000000000d1",
);
const USER_ID: ObjectID = new ObjectID("5a550000-0000-4000-8000-0000000000e1");

const props: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const OFFERED: TelemetryAiFixSuggestion = {
  offer: SuggestionOffer.Act,
  blocker: null,
  repository: { id: "5a550000-0000-4000-8000-0000000000a1", name: "acme/a1" },
  repositories: [],
  taskId: null,
};

let readable: AIInsight | null;
let readInsight: SpyInstance<typeof AIInsightService.findOneBy>;
let logSuggestion: SpyInstance<typeof LogInsightFix.getSuggestion>;
let logCreate: SpyInstance<typeof LogInsightFix.createFixTask>;
let traceSuggestion: SpyInstance<typeof TraceInsightFix.getSuggestion>;
let traceCreate: SpyInstance<typeof TraceInsightFix.createFixTask>;

function finding(insightType: AIInsightType): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = INSIGHT_ID;
  insight.insightType = insightType;
  return insight;
}

beforeEach(() => {
  readable = finding(AIInsightType.LogErrorPattern);
  readInsight = jest
    .spyOn(AIInsightService, "findOneBy")
    .mockImplementation(async () => {
      return readable;
    });
  logSuggestion = jest
    .spyOn(LogInsightFix, "getSuggestion")
    .mockResolvedValue(OFFERED);
  logCreate = jest
    .spyOn(LogInsightFix, "createFixTask")
    .mockResolvedValue({ taskId: "5a550000-0000-4000-8000-0000000000f1" });
  traceSuggestion = jest
    .spyOn(TraceInsightFix, "getSuggestion")
    .mockResolvedValue(OFFERED);
  traceCreate = jest
    .spyOn(TraceInsightFix, "createFixTask")
    .mockResolvedValue({ taskId: "5a550000-0000-4000-8000-0000000000f2" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TelemetryAiPersonFix", () => {
  test("every lane is listed: Traces and Logs plan their own, the Profiler none here", () => {
    expect(Object.keys(TELEMETRY_AI_PERSON_FIX_PLANNERS).sort()).toEqual(
      [...TELEMETRY_AI_LANE_LIST].sort(),
    );
    expect(TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Profile]).toBeNull();
    expect(TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Trace]).not.toBeNull();
    expect(TELEMETRY_AI_PERSON_FIX_PLANNERS[TelemetryAiLane.Log]).not.toBeNull();
  });

  test.each([
    AIInsightType.LogErrorPattern,
    AIInsightType.LogMissingLogging,
    AIInsightType.LogNoisyPattern,
  ])("a %s finding is Logs' to plan", async (insightType: AIInsightType) => {
    readable = finding(insightType);

    expect(
      await TelemetryAiPersonFix.getSuggestion({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        props,
      }),
    ).toBe(OFFERED);
    expect(logSuggestion).toHaveBeenCalledTimes(1);
    expect(traceSuggestion).not.toHaveBeenCalled();

    expect(
      await TelemetryAiPersonFix.createFixTask({
        projectId: PROJECT_ID,
        insightId: INSIGHT_ID,
        userId: USER_ID,
        props,
      }),
    ).toEqual({ taskId: "5a550000-0000-4000-8000-0000000000f1" });
    expect(logCreate).toHaveBeenCalledTimes(1);
    expect(traceCreate).not.toHaveBeenCalled();
  });

  test("a trace finding stays Traces'", async () => {
    readable = finding(AIInsightType.TraceFailingOperation);

    await TelemetryAiPersonFix.getSuggestion({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      props,
    });

    expect(traceSuggestion).toHaveBeenCalledTimes(1);
    expect(logSuggestion).not.toHaveBeenCalled();
  });

  test("the finding is read as the person, in the project", async () => {
    await TelemetryAiPersonFix.getSuggestion({
      projectId: PROJECT_ID,
      insightId: INSIGHT_ID,
      props,
    });

    const read: JSONObject = readInsight.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(read["props"]).toBe(props);
    expect(String((read["query"] as JSONObject)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a finding the person may not read, of no lane, or the Profiler's: nothing offered, and asking is refused", async () => {
    for (const unreadable of [
      null,
      finding(AIInsightType.ErrorLogSpike),
      finding(AIInsightType.ProfileHotspot),
    ]) {
      readable = unreadable;

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
          userId: USER_ID,
          props,
        }),
      ).rejects.toThrow(TELEMETRY_AI_FIX_NOT_OFFERED_MESSAGE);
    }

    expect(logCreate).not.toHaveBeenCalled();
    expect(traceCreate).not.toHaveBeenCalled();
  });
});
