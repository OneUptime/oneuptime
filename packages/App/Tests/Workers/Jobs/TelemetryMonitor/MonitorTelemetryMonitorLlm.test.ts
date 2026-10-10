import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import {
  LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import LlmMonitorResponse from "Common/Types/Monitor/LlmMonitor/LlmMonitorResponse";
import { LlmAnswerIssue } from "Common/Types/Telemetry/LlmAnswerIssue";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ReceivingPeriod } from "Common/Utils/Telemetry/ReceivingGaps";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The AI / LLM monitor's check, driven the way the worker runs it: one count
 * of the answers in the step's window and how many were bad, handed to the
 * criteria as an LlmMonitorResponse. Like every telemetry check it waits
 * while its window holds time OneUptime was not receiving, and judges the
 * newest window OneUptime has read while the ingest queue is behind.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findAllBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
});

jest.mock("Common/Server/Services/LlmConversationService", () => {
  return { __esModule: true, default: { countAnswers: jest.fn() } };
});

jest.mock("Common/Server/Services/InstanceReceivingPeriodService", () => {
  return { __esModule: true, default: { readLedger: jest.fn() } };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import LlmConversationService, {
  LlmAnswerCountQuery,
} from "Common/Server/Services/LlmConversationService";
import InstanceReceivingPeriodService from "Common/Server/Services/InstanceReceivingPeriodService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import {
  enqueueDueTelemetryMonitorEvaluationJobs,
  monitorLlm,
  processTelemetryMonitorEvaluationFromQueue,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const supportBot: ObjectID = ObjectID.generate();

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const findAllBy: jest.Mock = MonitorService.findAllBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const countAnswers: jest.Mock =
  LlmConversationService.countAnswers as unknown as jest.Mock;
const readLedger: jest.Mock =
  InstanceReceivingPeriodService.readLedger as unknown as jest.Mock;

function llmStep(overrides: JSONObject = {}): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setLlmMonitor(
    MonitorStepLlmMonitorUtil.fromJSON({
      ...MonitorStepLlmMonitorUtil.toJSON(
        MonitorStepLlmMonitorUtil.getDefault(),
      ),
      ...overrides,
    }),
  );
  return step;
}

function lastCount(): LlmAnswerCountQuery {
  return countAnswers.mock.calls[
    countAnswers.mock.calls.length - 1
  ]![0] as LlmAnswerCountQuery;
}

function givenLedger(
  stretches: Array<[startedAgoMs: number, lastReceivingAgoMs: number]>,
): void {
  readLedger.mockImplementation(async () => {
    const now: number = Date.now();
    const periods: Array<ReceivingPeriod> = stretches.map(
      ([startedAgo, lastAgo]: [number, number]) => {
        return {
          startedAt: new Date(now - startedAgo),
          lastReceivingAt: new Date(now - lastAgo),
        };
      },
    );
    const latest: number = Math.max(
      ...periods.map((period: ReceivingPeriod) => {
        return period.lastReceivingAt.getTime();
      }),
    );
    return {
      periods,
      latestReceivingAt: periods.length > 0 ? new Date(latest) : null,
      now: new Date(now),
    };
  });
}

function givenBacklogSince(agoMs: number | null): void {
  jest
    .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
    .mockResolvedValue(agoMs === null ? null : new Date(Date.now() - agoMs));
}

function givenLlmMonitor(step: MonitorStep): void {
  findOneById.mockResolvedValue({
    id: monitorId,
    _id: monitorId.toString(),
    projectId,
    monitorType: MonitorType.Llm,
    monitorSteps: { data: { monitorStepsInstanceArray: [step] } },
  });
}

async function runOnce(): Promise<void> {
  await processTelemetryMonitorEvaluationFromQueue({
    monitorId: monitorId.toString(),
    projectId: projectId.toString(),
    queuedAt: new Date(),
  });
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  findOneById.mockReset();
  findAllBy.mockReset().mockResolvedValue([]);
  monitorResource.mockReset().mockResolvedValue({});
  countAnswers
    .mockReset()
    .mockResolvedValue({ answerCount: 200, badAnswerCount: 15 });
  readLedger.mockReset();
  (MonitorService.getEnabledMonitorQuery as unknown as jest.Mock)
    .mockReset()
    .mockReturnValue({ isArchived: false });
  (MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue(undefined);
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  givenLedger([[30 * 24 * HOUR, 10 * SECOND]]);
  givenBacklogSince(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitorLlm: one check of an AI / LLM monitor", () => {
  test("counts the answers and how many were bad, and works out their share", async () => {
    const response: LlmMonitorResponse = await monitorLlm({
      monitorStep: llmStep(),
      monitorId,
      projectId,
    });

    expect(response.projectId).toEqual(projectId);
    expect(response.monitorId).toEqual(monitorId);
    expect(response.llmAnswerCount).toBe(200);
    expect(response.llmBadAnswerCount).toBe(15);
    expect(response.llmBadAnswerPercent).toBe(7.5);
  });

  test("a step saved without its config runs on the defaults instead of throwing", async () => {
    const before: number = Date.now();

    await monitorLlm({
      monitorStep: new MonitorStep(),
      monitorId,
      projectId,
    });

    const query: LlmAnswerCountQuery = lastCount();

    expect(query.projectId).toEqual(projectId);
    expect(query.issues).toEqual([
      LlmAnswerIssue.Failed,
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.CutOff,
      LlmAnswerIssue.Empty,
      LlmAnswerIssue.Flagged,
    ]);
    expect(query.slowAnswerMs).toBeNull();
    expect(query.model).toBeUndefined();
    expect(query.serviceIds).toBeUndefined();
    expect(query.endTime.getTime()).toBeGreaterThanOrEqual(before);
    expect(query.endTime.getTime() - query.startTime.getTime()).toBe(
      LLM_MONITOR_DEFAULT_WINDOW_SECONDS * SECOND,
    );
  });

  test("the step's problems, slow limit, model, apps and window reach the count", async () => {
    await monitorLlm({
      monitorStep: llmStep({
        issues: [LlmAnswerIssue.Refused],
        slowAnswerSeconds: 20,
        model: "gpt-4o",
        telemetryServiceIds: [supportBot.toString()],
        lastXSecondsOfCalls: 3600,
      }),
      monitorId,
      projectId,
    });

    const query: LlmAnswerCountQuery = lastCount();

    expect(query.issues).toEqual([LlmAnswerIssue.Refused]);
    expect(query.slowAnswerMs).toBe(20_000);
    expect(query.model).toBe("gpt-4o");
    expect(
      (query.serviceIds || []).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([supportBot.toString()]);
    expect(query.endTime.getTime() - query.startTime.getTime()).toBe(HOUR);
  });

  test("only slow answers count when no problem is picked but a limit is", async () => {
    await monitorLlm({
      monitorStep: llmStep({ issues: [], slowAnswerSeconds: 30 }),
      monitorId,
      projectId,
    });

    expect(lastCount().issues).toEqual([]);
    expect(lastCount().slowAnswerMs).toBe(30_000);
  });

  test("no problem and no limit counts every problem, so the monitor is never blind", async () => {
    await monitorLlm({
      monitorStep: llmStep({ issues: [], slowAnswerSeconds: 0 }),
      monitorId,
      projectId,
    });

    expect(lastCount().issues).toHaveLength(5);
    expect(lastCount().slowAnswerMs).toBeNull();
  });

  test("evaluateUntil ends the window where the ingest queue is", async () => {
    const until: Date = new Date(Date.now() - 7 * MINUTE);

    await monitorLlm({
      monitorStep: llmStep({ lastXSecondsOfCalls: 300 }),
      monitorId,
      projectId,
      evaluateUntil: until,
    });

    expect(lastCount().endTime.getTime()).toBe(until.getTime());
    expect(lastCount().startTime.getTime()).toBe(until.getTime() - 5 * MINUTE);
  });

  test("no answers is 0% bad, never a division by zero", async () => {
    countAnswers.mockResolvedValue({ answerCount: 0, badAnswerCount: 0 });

    const response: LlmMonitorResponse = await monitorLlm({
      monitorStep: llmStep(),
      monitorId,
      projectId,
    });

    expect(response.llmAnswerCount).toBe(0);
    expect(response.llmBadAnswerPercent).toBe(0);
  });

  test("links to the AI calls it read: AI spans of its apps in its window", async () => {
    const response: LlmMonitorResponse = await monitorLlm({
      monitorStep: llmStep({
        telemetryServiceIds: [supportBot.toString()],
        lastXSecondsOfCalls: 1800,
      }),
      monitorId,
      projectId,
    });

    const query: Record<string, unknown> = response.llmSpanQuery as Record<
      string,
      unknown
    >;

    expect(query["isLlmSpan"]).toBe(true);
    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    const window: InBetween<Date> = query["startTime"] as InBetween<Date>;
    expect(
      (window.endValue as Date).getTime() -
        (window.startValue as Date).getTime(),
    ).toBe(30 * MINUTE);
  });
});

describe("An AI / LLM check in the worker", () => {
  test("runs through the queue entry point and hands its counts to the criteria", async () => {
    givenLlmMonitor(llmStep());

    await runOnce();

    expect(countAnswers).toHaveBeenCalledTimes(1);
    expect(monitorResource).toHaveBeenCalledTimes(1);
    expect(monitorResource.mock.calls[0]![0]).toMatchObject({
      llmAnswerCount: 200,
      llmBadAnswerCount: 15,
      llmBadAnswerPercent: 7.5,
    });
  });

  test("right after a restart it waits: nothing is counted, judged, opened or resolved", async () => {
    givenLedger([
      [10 * HOUR, 12 * MINUTE],
      [3 * MINUTE, 10 * SECOND],
    ]);
    givenLlmMonitor(llmStep({ lastXSecondsOfCalls: 900 }));

    await runOnce();

    expect(countAnswers).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("once the outage is behind its window, it runs again", async () => {
    givenLedger([
      [10 * HOUR, 40 * MINUTE],
      [25 * MINUTE, 10 * SECOND],
    ]);
    givenLlmMonitor(llmStep({ lastXSecondsOfCalls: 300 }));

    await runOnce();

    expect(countAnswers).toHaveBeenCalledTimes(1);
  });

  test("while the ingest queue is behind, it judges the newest window OneUptime has read", async () => {
    givenBacklogSince(10 * MINUTE);
    givenLlmMonitor(llmStep({ lastXSecondsOfCalls: 300 }));

    await runOnce();

    expect(countAnswers).toHaveBeenCalledTimes(1);
    expect(lastCount().endTime.getTime()).toBeLessThan(Date.now() - 5 * MINUTE);
  });
});

describe("The telemetry scheduler", () => {
  test("sweeps every telemetry monitor type, the AI / LLM one included", async () => {
    await enqueueDueTelemetryMonitorEvaluationJobs();

    const query: Record<string, unknown> = (
      findAllBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    const operator: { objectLiteralParameters?: Record<string, unknown> } =
      query["monitorType"] as {
        objectLiteralParameters?: Record<string, unknown>;
      };
    const swept: Array<string> = Object.values(
      operator.objectLiteralParameters || {},
    )[0] as Array<string>;

    expect(swept).toContain(MonitorType.Llm);
    expect([...swept].sort()).toEqual(
      Object.values(MonitorType)
        .filter((type: MonitorType): boolean => {
          return MonitorTypeHelper.isTelemetryMonitor(type);
        })
        .sort(),
    );
  });
});
