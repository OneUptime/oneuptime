import { describe, expect, test } from "@jest/globals";
import {
  TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
  TelemetryAiLane,
} from "../../../Types/AI/TelemetryAi";
import {
  TelemetryAiLogKind,
  TelemetryAiLogState,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
  TelemetryAiReadinessStep,
  getTelemetryAiReadinessSteps,
  parseTelemetryAiLogs,
  parseTelemetryAiReadiness,
} from "../../../Types/AI/TelemetryAiActivity";

/*
 * What a telemetry product's AI section reads from the server, parsed
 * defensively: whatever does not hold together reads as nothing, and a
 * readiness says one step to take first.
 */

const READY: TelemetryAiReadinessJSON = {
  lane: TelemetryAiLane.Profile,
  isAiEnabled: true,
  isLaneOn: true,
  connectedRepositoryCount: 2,
  blocker: null,
  automaticFixesToday: 1,
  maxAutomaticFixesPerDay: 5,
};

describe("getTelemetryAiReadinessSteps", () => {
  test("nothing to do once a repository is connected and Code's gate is clear", () => {
    expect(getTelemetryAiReadinessSteps(READY)).toEqual([]);
  });

  test("a repository first: Code's gate is not asked without one", () => {
    expect(
      getTelemetryAiReadinessSteps({
        ...READY,
        connectedRepositoryCount: 0,
        blocker: { type: "NoAiCredits", message: "No credits." },
      }),
    ).toEqual([TelemetryAiReadinessStep.ConnectRepository]);
  });

  test("then what Code's gate says", () => {
    expect(
      getTelemetryAiReadinessSteps({
        ...READY,
        blocker: { type: "RunnerNotOnline", message: "Not online." },
      }),
    ).toEqual([TelemetryAiReadinessStep.ClearCodeBlocker]);
  });
});

describe("parseTelemetryAiReadiness", () => {
  test("reads a whole answer as it was sent", () => {
    const blocked: TelemetryAiReadinessJSON = {
      ...READY,
      blocker: {
        type: "RunnerNotOnline",
        message: "The Runner prod-eu is not online.",
        repositoryId: "5092aaaa-0000-4000-8000-000000000001",
        runnerName: "prod-eu",
      },
    };

    expect(parseTelemetryAiReadiness(READY)).toEqual(READY);
    expect(
      parseTelemetryAiReadiness(JSON.parse(JSON.stringify(blocked))),
    ).toEqual(blocked);
  });

  test.each([
    ["nothing", null],
    ["a list", [READY]],
    ["text", "ready"],
    ["an unknown lane", { ...READY, lane: "Traces" }],
    ["a switch that is not a yes or no", { ...READY, isLaneOn: "true" }],
    ["a negative count", { ...READY, connectedRepositoryCount: -1 }],
    ["a count that is not a number", { ...READY, automaticFixesToday: "1" }],
    ["an endless count", { ...READY, connectedRepositoryCount: Infinity }],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(parseTelemetryAiReadiness(value)).toBeNull();
  });

  test("a blocker without its type or words reads as none; the day's most falls back to the code's", () => {
    const parsed: TelemetryAiReadinessJSON | null = parseTelemetryAiReadiness({
      ...READY,
      blocker: { type: "NoAiCredits" },
      maxAutomaticFixesPerDay: "lots",
      automaticFixesToday: 2.7,
    });

    expect(parsed?.blocker).toBeNull();
    expect(parsed?.maxAutomaticFixesPerDay).toBe(
      TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY,
    );
    expect(parsed?.automaticFixesToday).toBe(2);
  });
});

describe("parseTelemetryAiLogs", () => {
  const ENTRY: Record<string, unknown> = {
    runId: "5092aaaa-0000-4000-8000-0000000000e1",
    kind: TelemetryAiLogKind.PullRequest,
    at: "2026-10-24T09:00:00.000Z",
    state: TelemetryAiLogState.Working,
    insight: {
      id: "5092aaaa-0000-4000-8000-0000000000a1",
      title: "OrderParser.parse takes 18% of the CPU time",
      serviceName: "checkout",
    },
    requestedBy: "Ada",
    taskId: "5092aaaa-0000-4000-8000-0000000000e1",
    repositoryName: "acme/shop",
    repositoryHostedAt: "GitHub",
    pullRequest: {
      state: "open",
      number: 812,
      url: "https://github.com/acme/shop/pull/812",
    },
  };

  test("reads a page of entries as they were sent", () => {
    expect(parseTelemetryAiLogs({ entries: [ENTRY], totalCount: 41 })).toEqual({
      entries: [ENTRY],
      totalCount: 41,
    });
  });

  test("leaves out an entry that does not hold together, and keeps the rest", () => {
    const logs: TelemetryAiLogsJSON | null = parseTelemetryAiLogs({
      entries: [
        ENTRY,
        null,
        { ...ENTRY, kind: "Command" },
        { ...ENTRY, state: "Exploded" },
        { ...ENTRY, runId: "" },
        { ...ENTRY, insight: { title: "no id" } },
        { ...ENTRY, at: 12 },
      ],
      totalCount: 7,
    });

    expect(logs?.entries).toHaveLength(1);
    expect(logs?.totalCount).toBe(7);
  });

  test("drops an entry's parts that are not what they should be", () => {
    const logs: TelemetryAiLogsJSON | null = parseTelemetryAiLogs({
      entries: [
        {
          ...ENTRY,
          requestedBy: 42,
          repositoryName: "",
          repositoryHostedAt: 3,
          insight: { id: "x", title: 7, serviceName: "" },
          pullRequest: { state: "open", number: -3, url: 5 },
        },
        { ...ENTRY, pullRequest: { number: 1 } },
      ],
      totalCount: 2,
    });

    const [first, second] = logs!.entries;

    expect(first!.requestedBy).toBeUndefined();
    expect(first!.repositoryName).toBeUndefined();
    expect(first!.repositoryHostedAt).toBeUndefined();
    expect(first!.insight).toEqual({ id: "x", title: "" });
    expect(first!.pullRequest).toEqual({ state: "open" });
    // A pull request with no state is not drawn.
    expect(second!.pullRequest).toBeUndefined();
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["no entries", { totalCount: 1 }],
    ["no count", { entries: [] }],
    ["a negative count", { entries: [], totalCount: -1 }],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(parseTelemetryAiLogs(value)).toBeNull();
  });
});
