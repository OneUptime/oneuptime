import { describe, expect, test } from "@jest/globals";
import MonitorStepLlmMonitor, {
  LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
  LLM_MONITOR_MAX_MODEL_LENGTH,
  LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS,
  LLM_MONITOR_MAX_WINDOW_SECONDS,
  LLM_MONITOR_WINDOW_OPTIONS,
  LlmBadAnswerRule,
  MonitorStepLlmMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLlmMonitor";
import LlmMonitorResponse, {
  LlmMonitorResponseUtil,
} from "../../../Types/Monitor/LlmMonitor/LlmMonitorResponse";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryMonitorWindow from "../../../Utils/Monitor/TelemetryMonitorWindow";
import MonitorTemplateSyncFieldUtil from "../../../Types/Monitor/MonitorTemplateSyncField";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";

/*
 * The AI / LLM monitor's step: what makes an answer bad, which apps and
 * model it watches, and the window each check reads. It is read from JSON
 * saved by any build, written by the API or by hand, so every field has a
 * safe reading, and the rules the check and the form share live here.
 */

const SERVICE_A: string = "6c1a2b3c-0000-4000-8000-0000000000a1";
const SERVICE_B: string = "6c1a2b3c-0000-4000-8000-0000000000b2";

const ALL_ISSUES: Array<LlmAnswerIssue> = [
  LlmAnswerIssue.Failed,
  LlmAnswerIssue.Refused,
  LlmAnswerIssue.CutOff,
  LlmAnswerIssue.Empty,
  LlmAnswerIssue.Flagged,
];

function read(json: unknown): MonitorStepLlmMonitor {
  return MonitorStepLlmMonitorUtil.fromJSON(json as JSONObject);
}

function serviceStrings(monitor: MonitorStepLlmMonitor): Array<string> {
  return monitor.telemetryServiceIds.map((id: ObjectID): string => {
    return id.toString();
  });
}

describe("the default AI / LLM step", () => {
  test("counts every problem, has no slow limit, any model, every app, the last 15 minutes", () => {
    const monitor: MonitorStepLlmMonitor =
      MonitorStepLlmMonitorUtil.getDefault();

    expect(monitor.issues).toEqual(ALL_ISSUES);
    expect(monitor.slowAnswerSeconds).toBe(0);
    expect(monitor.model).toBe("");
    expect(monitor.telemetryServiceIds).toEqual([]);
    expect(monitor.lastXSecondsOfCalls).toBe(900);
    expect(LLM_MONITOR_DEFAULT_WINDOW_SECONDS).toBe(900);
  });

  test("is a fresh object every time", () => {
    const first: MonitorStepLlmMonitor = MonitorStepLlmMonitorUtil.getDefault();
    first.issues.pop();

    expect(MonitorStepLlmMonitorUtil.getDefault().issues).toHaveLength(5);
  });

  test("offers the windows the form lists, the default among them", () => {
    expect([...LLM_MONITOR_WINDOW_OPTIONS]).toEqual([
      300, 900, 1800, 3600, 21600, 86400,
    ]);
    expect(LLM_MONITOR_WINDOW_OPTIONS).toContain(
      LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
    );
  });
});

describe("reading a step back from JSON", () => {
  test.each([[undefined], [null], ["a string"], [42], [[1, 2]]])(
    "%p reads as the default",
    (value: unknown) => {
      expect(read(value)).toEqual(MonitorStepLlmMonitorUtil.getDefault());
    },
  );

  test("apps read from ObjectID JSON, plain strings or ObjectIDs, each once", () => {
    const monitor: MonitorStepLlmMonitor = read({
      telemetryServiceIds: [
        { _type: "ObjectID", value: SERVICE_A },
        SERVICE_B,
        new ObjectID(SERVICE_A),
        "  ",
        "not-an-id",
        42,
        { _type: "Something", value: SERVICE_B },
      ],
    });

    expect(serviceStrings(monitor)).toEqual([SERVICE_A, SERVICE_B]);
  });

  test("known problems are kept in display order, anything else dropped", () => {
    expect(
      read({
        issues: ["flagged", "bogus", "refused", "refused", 7, "failed"],
      }).issues,
    ).toEqual([
      LlmAnswerIssue.Failed,
      LlmAnswerIssue.Refused,
      LlmAnswerIssue.Flagged,
    ]);
  });

  test("an empty problem list stays empty: only slow answers then count", () => {
    expect(read({ issues: [] }).issues).toEqual([]);
  });

  test("a missing problem list is every problem", () => {
    expect(read({}).issues).toEqual(ALL_ISSUES);
    expect(read({ issues: "refused" }).issues).toEqual(ALL_ISSUES);
  });

  test.each([
    [30, 30],
    ["45", 45],
    [0.5, 0.5],
    [0, 0],
    [-5, 0],
    ["abc", 0],
    [null, 0],
    [Number.POSITIVE_INFINITY, 0],
    [10 * 24 * 60 * 60, LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS],
  ])("a slow limit of %p reads as %p", (value: unknown, expected: number) => {
    expect(read({ slowAnswerSeconds: value }).slowAnswerSeconds).toBe(expected);
  });

  test("the model is trimmed and bounded; anything else is any model", () => {
    expect(read({ model: "  gpt-4o  " }).model).toBe("gpt-4o");
    expect(read({ model: 42 }).model).toBe("");
    expect(read({ model: "m".repeat(500) }).model).toHaveLength(
      LLM_MONITOR_MAX_MODEL_LENGTH,
    );
  });

  test.each([
    [300, 300],
    ["3600", 3600],
    [0, LLM_MONITOR_DEFAULT_WINDOW_SECONDS],
    [-60, LLM_MONITOR_DEFAULT_WINDOW_SECONDS],
    ["soon", LLM_MONITOR_DEFAULT_WINDOW_SECONDS],
    [30 * 24 * 60 * 60, LLM_MONITOR_MAX_WINDOW_SECONDS],
  ])("a window of %p reads as %p", (value: unknown, expected: number) => {
    expect(read({ lastXSecondsOfCalls: value }).lastXSecondsOfCalls).toBe(
      expected,
    );
  });

  test("toJSON writes the normalized step, and reads back to the same", () => {
    const json: JSONObject = MonitorStepLlmMonitorUtil.toJSON({
      telemetryServiceIds: [new ObjectID(SERVICE_A)],
      issues: [LlmAnswerIssue.Empty, LlmAnswerIssue.Failed],
      slowAnswerSeconds: 12,
      model: " claude ",
      lastXSecondsOfCalls: 1800,
    });

    expect(json).toEqual({
      telemetryServiceIds: [{ _type: "ObjectID", value: SERVICE_A }],
      issues: [LlmAnswerIssue.Failed, LlmAnswerIssue.Empty],
      slowAnswerSeconds: 12,
      model: "claude",
      lastXSecondsOfCalls: 1800,
    });

    const back: MonitorStepLlmMonitor = read(json);
    expect(serviceStrings(back)).toEqual([SERVICE_A]);
    expect(MonitorStepLlmMonitorUtil.toJSON(back)).toEqual(json);
  });
});

describe("what makes an answer bad", () => {
  test("the picked problems, with no slow limit", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      issues: [LlmAnswerIssue.Refused],
    });

    expect(rule).toEqual({ issues: [LlmAnswerIssue.Refused], slowAnswerMs: null });
  });

  test("the picked problems, or slower than the limit", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      issues: [LlmAnswerIssue.Failed],
      slowAnswerSeconds: 2.5,
    });

    expect(rule).toEqual({ issues: [LlmAnswerIssue.Failed], slowAnswerMs: 2500 });
  });

  test("only slow answers, when no problem is picked", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      issues: [],
      slowAnswerSeconds: 30,
    });

    expect(rule).toEqual({ issues: [], slowAnswerMs: 30_000 });
  });

  test("nothing picked and no limit counts every problem: a monitor is never blind", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      issues: [],
      slowAnswerSeconds: 0,
    });

    expect(rule).toEqual({ issues: ALL_ISSUES, slowAnswerMs: null });
  });

  test("a limit past a day is held to a day", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      slowAnswerSeconds: 10 * 24 * 60 * 60,
    });

    expect(rule.slowAnswerMs).toBe(LLM_MONITOR_MAX_SLOW_ANSWER_SECONDS * 1000);
  });

  test("problems that are not problems never reach the rule", () => {
    const rule: LlmBadAnswerRule = MonitorStepLlmMonitorUtil.getBadAnswerRule({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      issues: ["bogus" as LlmAnswerIssue, LlmAnswerIssue.CutOff],
    });

    expect(rule.issues).toEqual([LlmAnswerIssue.CutOff]);
  });
});

describe("the window a check reads", () => {
  test("ends now, and is as long as the step says", () => {
    const before: number = Date.now();
    const window: InBetween<Date> = MonitorStepLlmMonitorUtil.getWindow({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      lastXSecondsOfCalls: 1800,
    });
    const after: number = Date.now();

    const end: number = (window.endValue as Date).getTime();
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(after);
    expect(end - (window.startValue as Date).getTime()).toBe(1800 * 1000);
  });

  test("ends where evaluateUntil says, while the ingest queue is behind", () => {
    const until: Date = new Date("2026-10-10T08:00:00.000Z");
    const window: InBetween<Date> = MonitorStepLlmMonitorUtil.getWindow(
      { ...MonitorStepLlmMonitorUtil.getDefault(), lastXSecondsOfCalls: 300 },
      until,
    );

    expect(window.endValue).toEqual(until);
    expect(window.startValue).toEqual(new Date("2026-10-10T07:55:00.000Z"));
  });

  test("an unreadable or huge window falls back or is capped", () => {
    const until: Date = new Date("2026-10-10T08:00:00.000Z");

    const unreadable: InBetween<Date> = MonitorStepLlmMonitorUtil.getWindow(
      {
        ...MonitorStepLlmMonitorUtil.getDefault(),
        lastXSecondsOfCalls: Number.NaN,
      },
      until,
    );
    expect(until.getTime() - (unreadable.startValue as Date).getTime()).toBe(
      LLM_MONITOR_DEFAULT_WINDOW_SECONDS * 1000,
    );

    const huge: InBetween<Date> = MonitorStepLlmMonitorUtil.getWindow(
      {
        ...MonitorStepLlmMonitorUtil.getDefault(),
        lastXSecondsOfCalls: 365 * 24 * 60 * 60,
      },
      until,
    );
    expect(until.getTime() - (huge.startValue as Date).getTime()).toBe(
      LLM_MONITOR_MAX_WINDOW_SECONDS * 1000,
    );
  });

  test("is what the receiving-gap plan waits on", () => {
    const step: MonitorStep = new MonitorStep();
    step.setLlmMonitor({
      ...MonitorStepLlmMonitorUtil.getDefault(),
      lastXSecondsOfCalls: 3600,
    });

    expect(
      TelemetryMonitorWindow.getWindowInMs({
        monitorType: MonitorType.Llm,
        monitorStep: step,
      }),
    ).toBe(3600 * 1000);

    // A step saved without its config waits on the default minute, as the
    // other telemetry types do.
    expect(
      TelemetryMonitorWindow.getWindowInMs({
        monitorType: MonitorType.Llm,
        monitorStep: new MonitorStep(),
      }),
    ).toBe(60_000);
  });
});

describe("the AI calls a check links to", () => {
  test("AI spans in the window, of the step's apps", () => {
    const until: Date = new Date("2026-10-10T08:00:00.000Z");
    const query: Record<string, unknown> = MonitorStepLlmMonitorUtil.toSpanQuery(
      {
        ...MonitorStepLlmMonitorUtil.getDefault(),
        telemetryServiceIds: [new ObjectID(SERVICE_A)],
        lastXSecondsOfCalls: 300,
      },
      until,
    ) as Record<string, unknown>;

    expect(query["isLlmSpan"]).toBe(true);
    const window: InBetween<Date> = query["startTime"] as InBetween<Date>;
    expect(window.startValue).toEqual(new Date("2026-10-10T07:55:00.000Z"));
    expect(window.endValue).toEqual(until);
    expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
    expect(
      (query["primaryEntityId"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([SERVICE_A]);
  });

  test("every app: no app filter at all", () => {
    const query: Record<string, unknown> = MonitorStepLlmMonitorUtil.toSpanQuery(
      MonitorStepLlmMonitorUtil.getDefault(),
    ) as Record<string, unknown>;

    expect(query["primaryEntityId"]).toBeUndefined();
  });
});

describe("the step inside a monitor step", () => {
  test("a new AI / LLM monitor's step is seeded with the default config", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "Support bot",
      monitorType: MonitorType.Llm,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    });

    expect(step.data?.llmMonitor).toEqual(
      MonitorStepLlmMonitorUtil.getDefault(),
    );
    expect(step.data?.traceMonitor).toBeUndefined();
  });

  test("another type's step carries no AI / LLM config", () => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "API",
      monitorType: MonitorType.Traces,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    });

    expect(step.data?.llmMonitor).toBeUndefined();
  });

  test("round-trips through the monitor step's JSON, normalized on the way in", () => {
    const step: MonitorStep = new MonitorStep();
    step.setLlmMonitor({
      telemetryServiceIds: [new ObjectID(SERVICE_B)],
      issues: [LlmAnswerIssue.Refused],
      slowAnswerSeconds: 20,
      model: "gpt-4o",
      lastXSecondsOfCalls: 600,
    });

    const back: MonitorStep = MonitorStep.fromJSON(step.toJSON());
    const monitor: MonitorStepLlmMonitor = back.data!.llmMonitor!;

    expect(serviceStrings(monitor)).toEqual([SERVICE_B]);
    expect(monitor.issues).toEqual([LlmAnswerIssue.Refused]);
    expect(monitor.slowAnswerSeconds).toBe(20);
    expect(monitor.model).toBe("gpt-4o");
    expect(monitor.lastXSecondsOfCalls).toBe(600);
  });

  test("a hand-written step missing fields reads back with them filled in", () => {
    const json: JSONObject = new MonitorStep().toJSON();
    (json["value"] as JSONObject)["llmMonitor"] = { model: "claude" };

    const monitor: MonitorStepLlmMonitor =
      MonitorStep.fromJSON(json).data!.llmMonitor!;

    expect(monitor.issues).toEqual(ALL_ISSUES);
    expect(monitor.model).toBe("claude");
    expect(monitor.lastXSecondsOfCalls).toBe(LLM_MONITOR_DEFAULT_WINDOW_SECONDS);
  });

  test("a template can keep its AI / LLM settings out of a sync", () => {
    expect(
      MonitorTemplateSyncFieldUtil.getFields(MonitorType.Llm).map(
        (field: { path: string }): string => {
          return field.path;
        },
      ),
    ).toContain("llmMonitor");
  });
});

describe("the share of bad answers", () => {
  test.each([
    [200, 15, 7.5],
    [3, 1, 33.33],
    [3, 2, 66.67],
    [10, 0, 0],
    [10, 10, 100],
    // More bad than answers cannot happen; it reads as all of them.
    [10, 12, 100],
    // No answers is 0%, never a division by zero.
    [0, 0, 0],
    [0, 4, 0],
    [Number.NaN, 4, 0],
    [10, Number.NaN, 0],
  ])(
    "%p answers with %p bad is %p%",
    (answerCount: number, badAnswerCount: number, expected: number) => {
      expect(
        LlmMonitorResponseUtil.getBadAnswerPercent({
          answerCount,
          badAnswerCount,
        }),
      ).toBe(expected);
    },
  );

  test("a response's marker field is its own", () => {
    const response: LlmMonitorResponse = {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      llmAnswerCount: 1,
      llmBadAnswerCount: 0,
      llmBadAnswerPercent: 0,
      llmSpanQuery: {},
    };

    expect(Object.keys(response)).toContain("llmAnswerCount");
  });
});
