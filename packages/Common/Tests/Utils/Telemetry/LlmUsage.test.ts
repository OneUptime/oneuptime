import { describe, expect, test } from "@jest/globals";
import {
  LlmUsageDimension,
  LlmUsageFigures,
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
} from "../../../Types/Telemetry/LlmUsageApi";
import { emptyLlmMetricUsageFigures } from "../../../Types/Telemetry/LlmMetricUsageApi";
import { LlmMetricUsageRow } from "../../../Utils/Telemetry/LlmMetricUsage";
import LlmUsageUtil, {
  LlmUsageFoldOptions,
  LlmUsageSignal,
  LlmUsageSpanRow,
} from "../../../Utils/Telemetry/LlmUsage";

/*
 * WHAT A RANGE'S AI USAGE ADDS UP TO, EACH SERVICE FROM THE SIGNAL IT SENDS.
 *
 * The Usage tab's totals and breakdown and the cost budgets fold two reads
 * - the AI calls' rows and the usage metrics' rows, each service's totals
 * apart from its groups - with LlmUsageUtil.fold. These pin the rule: a
 * coding tool that sends only metrics counts beside the apps that send
 * calls, an app that sends both counts once (from its calls), tokens and
 * cost are decided apart, telemetry that names no service is one service
 * like any other, every breakdown adds up to the same totals, and each
 * figure says where it came from.
 */

const APP: string = "checkout-api";
const CLAUDE_CODE: string = "claude-code";
const CURSOR: string = "cursor";
// What ingest files telemetry that names no service under: the project's id.
const UNKNOWN_SERVICE: string = "9900000000000000000000a1";

const COST: string = "claude_code.cost.usage";
const TOKENS: string = "claude_code.token.usage";

function spans(
  service: string,
  figures: Partial<LlmUsageSpanRow>,
  group?: string,
): LlmUsageSpanRow {
  return {
    service: service,
    isTotal: group === undefined,
    group: group ?? "",
    calls: 0,
    erroredCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    ...figures,
  };
}

function metric(
  service: string,
  name: string,
  value: number,
  extra?: { tokenType?: string; group?: string; groupAttribute?: string },
): LlmMetricUsageRow {
  return {
    metric: name,
    service: service,
    isTotal: extra?.group === undefined,
    group: extra?.group ?? "",
    groupAttribute: extra?.groupAttribute ?? "",
    tokenType: extra?.tokenType ?? "",
    value: value,
  };
}

function fold(
  spanRows: Array<LlmUsageSpanRow>,
  metricRows: Array<LlmMetricUsageRow>,
  options: Partial<LlmUsageFoldOptions> = {},
): LlmUsageResponse {
  return LlmUsageUtil.fold({
    spanRows: spanRows,
    metricRows: metricRows,
    options: { dimension: LlmUsageDimension.None, ...options },
  });
}

// Each group's key, cost (to the cent: sums of decimals) and where the cost came from.
function keyed(
  entries: Array<LlmUsageGroup>,
): Array<[string, number, LlmUsageSource]> {
  return entries.map(
    (group: LlmUsageGroup): [string, number, LlmUsageSource] => {
      return [
        group.key,
        Math.round(group.costUsd * 100) / 100,
        group.costSource,
      ];
    },
  );
}

function sum(
  entries: Array<LlmUsageFigures>,
  read: (figures: LlmUsageFigures) => number,
): number {
  return entries.reduce((total: number, figures: LlmUsageFigures): number => {
    return total + read(figures);
  }, 0);
}

/*
 * The Usage tab's example: an app's AI calls (OpenAI) and Claude Code's
 * usage metrics, by person.
 */
const APP_CALLS: Array<LlmUsageSpanRow> = [
  spans(APP, {
    calls: 1240,
    erroredCalls: 15,
    inputTokens: 1970000,
    outputTokens: 416000,
    totalTokens: 2386000,
    costUsd: 20.5,
  }),
  spans(
    APP,
    {
      calls: 800,
      erroredCalls: 10,
      inputTokens: 650000,
      outputTokens: 160000,
      totalTokens: 810000,
      costUsd: 9.1,
    },
    "ana@example.com",
  ),
  spans(
    APP,
    {
      calls: 440,
      erroredCalls: 5,
      inputTokens: 1320000,
      outputTokens: 256000,
      totalTokens: 1576000,
      costUsd: 11.4,
    },
    "bob@example.com",
  ),
];

const CLAUDE_CODE_METRICS: Array<LlmMetricUsageRow> = [
  metric(CLAUDE_CODE, COST, 52.25),
  metric(CLAUDE_CODE, TOKENS, 4000000, { tokenType: "input" }),
  metric(CLAUDE_CODE, TOKENS, 400000, { tokenType: "output" }),
  metric(CLAUDE_CODE, COST, 40, {
    group: "ana@example.com",
    groupAttribute: "user.email",
  }),
  metric(CLAUDE_CODE, TOKENS, 3000000, {
    tokenType: "input",
    group: "ana@example.com",
    groupAttribute: "user.email",
  }),
  metric(CLAUDE_CODE, COST, 12.25, {
    group: "chen@example.com",
    groupAttribute: "user.email",
  }),
  metric(CLAUDE_CODE, TOKENS, 1000000, {
    tokenType: "input",
    group: "chen@example.com",
    groupAttribute: "user.email",
  }),
  metric(CLAUDE_CODE, TOKENS, 400000, {
    tokenType: "output",
    group: "chen@example.com",
    groupAttribute: "user.email",
  }),
];

describe("which signal a service is counted from", () => {
  test("its calls, when they report the figure", () => {
    expect(
      LlmUsageUtil.getServiceSignals({
        calls: spans(APP, { calls: 3, inputTokens: 10, costUsd: 1 }),
        metrics: {
          ...emptyLlmMetricUsageFigures(),
          inputTokens: 99,
          costUsd: 99,
          hasTokens: true,
          hasCost: true,
        },
      }),
    ).toEqual({ tokens: LlmUsageSignal.Calls, cost: LlmUsageSignal.Calls });
  });

  test("its metrics, when it sends no calls", () => {
    expect(
      LlmUsageUtil.getServiceSignals({
        calls: undefined,
        metrics: {
          ...emptyLlmMetricUsageFigures(),
          inputTokens: 99,
          costUsd: 99,
          hasTokens: true,
          hasCost: true,
        },
      }),
    ).toEqual({ tokens: LlmUsageSignal.Metrics, cost: LlmUsageSignal.Metrics });
  });

  test("tokens and cost apart: calls with tokens and no price, and a cost metric", () => {
    expect(
      LlmUsageUtil.getServiceSignals({
        calls: spans(APP, { calls: 3, inputTokens: 10 }),
        metrics: {
          ...emptyLlmMetricUsageFigures(),
          costUsd: 2,
          hasCost: true,
        },
      }),
    ).toEqual({ tokens: LlmUsageSignal.Calls, cost: LlmUsageSignal.Metrics });
  });

  test("a call's total tokens alone are tokens", () => {
    expect(
      LlmUsageUtil.getServiceSignals({
        calls: spans(APP, { calls: 1, totalTokens: 10 }),
        metrics: undefined,
      }).tokens,
    ).toBe(LlmUsageSignal.Calls);
  });

  test("nothing reported, or only zeros: none", () => {
    expect(
      LlmUsageUtil.getServiceSignals({
        calls: spans(APP, { calls: 3 }),
        metrics: {
          ...emptyLlmMetricUsageFigures(),
          hasTokens: true,
          hasCost: true,
        },
      }),
    ).toEqual({ tokens: LlmUsageSignal.None, cost: LlmUsageSignal.None });
    expect(
      LlmUsageUtil.getServiceSignals({ calls: undefined, metrics: undefined }),
    ).toEqual({ tokens: LlmUsageSignal.None, cost: LlmUsageSignal.None });
  });
});

describe("the totals", () => {
  /*
   * THE FIX. Metrics were read only when the project's calls added up to
   * nothing: Claude Code's usage vanished as soon as one app sent a call.
   */
  test("a coding tool's metrics count beside an app's calls", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, CLAUDE_CODE_METRICS);

    expect(usage.totals.calls).toBe(1240);
    expect(usage.totals.erroredCalls).toBe(15);
    expect(usage.totals.inputTokens).toBe(5970000);
    expect(usage.totals.outputTokens).toBe(816000);
    expect(usage.totals.totalTokens).toBe(2386000 + 4400000);
    expect(usage.totals.costUsd).toBeCloseTo(72.75, 10);
    expect(usage.totals.tokenSource).toBe(LlmUsageSource.Both);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Both);
  });

  /*
   * OpenLLMetry and the OpenTelemetry SDKs send GenAI metrics beside their
   * spans, for the same calls.
   */
  test("an app that sends both signals counts once, from its calls", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, [
      metric(APP, "gen_ai.client.token.usage", 1970000, {
        tokenType: "input",
      }),
      metric(APP, "gen_ai.client.token.usage", 416000, {
        tokenType: "output",
      }),
      metric(APP, COST, 20.5),
    ]);

    expect(usage.totals.inputTokens).toBe(1970000);
    expect(usage.totals.costUsd).toBe(20.5);
    expect(usage.totals.tokenSource).toBe(LlmUsageSource.Calls);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Calls);
  });

  test("a metrics-only project: calls 0, figures from the metrics", () => {
    const usage: LlmUsageResponse = fold([], CLAUDE_CODE_METRICS);

    expect(usage.totals.calls).toBe(0);
    expect(usage.totals.inputTokens).toBe(4000000);
    expect(usage.totals.outputTokens).toBe(400000);
    expect(usage.totals.totalTokens).toBe(4400000);
    expect(usage.totals.costUsd).toBe(52.25);
    expect(usage.totals.tokenSource).toBe(LlmUsageSource.Metrics);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Metrics);
  });

  test("calls with tokens and no price take their service's cost metric", () => {
    const usage: LlmUsageResponse = fold(
      [spans(APP, { calls: 5, inputTokens: 100, outputTokens: 20 })],
      [metric(APP, COST, 3), metric(APP, TOKENS, 999, { tokenType: "input" })],
    );

    expect(usage.totals.inputTokens).toBe(100);
    expect(usage.totals.costUsd).toBe(3);
    expect(usage.totals.tokenSource).toBe(LlmUsageSource.Calls);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Metrics);
  });

  test("telemetry that names no service is the Unknown Service, one service like any other", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, [
      metric(UNKNOWN_SERVICE, COST, 4.5),
    ]);

    expect(usage.totals.costUsd).toBe(25);
    expect(usage.totals.costSource).toBe(LlmUsageSource.Both);
    expect(
      usage.services.map((service: LlmUsageService): string => {
        return service.serviceId;
      }),
    ).toEqual([APP, UNKNOWN_SERVICE]);
  });

  test("a call's total tokens fall back to its input and output", () => {
    const usage: LlmUsageResponse = fold(
      [spans(APP, { calls: 1, inputTokens: 10, outputTokens: 5 })],
      [],
    );

    expect(usage.totals.totalTokens).toBe(15);
  });

  test("nothing read: nothing, from nowhere", () => {
    const usage: LlmUsageResponse = fold([], []);

    expect(usage.totals).toEqual({
      calls: 0,
      erroredCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      tokenSource: LlmUsageSource.None,
      costSource: LlmUsageSource.None,
    });
    expect(usage.services).toEqual([]);
    expect(usage.groups).toEqual([]);
  });

  test("what is not a number, or below zero, adds nothing", () => {
    const usage: LlmUsageResponse = fold(
      [
        spans(APP, { calls: NaN, inputTokens: -5, costUsd: Infinity }),
        null as unknown as LlmUsageSpanRow,
      ],
      [
        metric(CLAUDE_CODE, COST, NaN),
        metric(CLAUDE_CODE, COST, -2),
        null as unknown as LlmMetricUsageRow,
      ],
    );

    expect(usage.totals.calls).toBe(0);
    expect(usage.totals.inputTokens).toBe(0);
    expect(usage.totals.costUsd).toBe(0);
    expect(usage.totals.costSource).toBe(LlmUsageSource.None);
  });

  test("the flags are carried through", () => {
    expect(fold([], [], { truncated: true }).truncated).toBe(true);
    expect(fold([], [], { metricsLeftOut: true }).metricsLeftOut).toBe(true);
    expect(fold([], []).truncated).toBe(false);
    expect(fold([], []).metricsLeftOut).toBe(false);
  });
});

describe("the services", () => {
  test("each service from one signal, never both, largest cost first", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, [
      ...CLAUDE_CODE_METRICS,
      metric(APP, COST, 999),
    ]);

    expect(
      usage.services.map(
        (
          service: LlmUsageService,
        ): [string, number, LlmUsageSource, LlmUsageSource] => {
          return [
            service.serviceId,
            service.costUsd,
            service.tokenSource,
            service.costSource,
          ];
        },
      ),
    ).toEqual([
      [CLAUDE_CODE, 52.25, LlmUsageSource.Metrics, LlmUsageSource.Metrics],
      [APP, 20.5, LlmUsageSource.Calls, LlmUsageSource.Calls],
    ]);
  });

  test("a service whose figures add up to nothing is left out", () => {
    const usage: LlmUsageResponse = fold(
      [spans(APP, { calls: 2 })],
      [metric(CURSOR, COST, 0)],
    );

    expect(
      usage.services.map((service: LlmUsageService): string => {
        return service.serviceId;
      }),
    ).toEqual([APP]);
  });

  test("the services add up to the totals", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, CLAUDE_CODE_METRICS);

    expect(
      sum(usage.services, (figures: LlmUsageFigures): number => {
        return figures.costUsd;
      }),
    ).toBeCloseTo(usage.totals.costUsd, 10);
    expect(
      sum(usage.services, (figures: LlmUsageFigures): number => {
        return figures.inputTokens;
      }),
    ).toBe(usage.totals.inputTokens);
  });
});

describe("the groups", () => {
  test("by person: one row for a person's calls and metrics, each from its service's signal", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, CLAUDE_CODE_METRICS, {
      dimension: LlmUsageDimension.Employee,
    });

    expect(keyed(usage.groups)).toEqual([
      ["ana@example.com", 49.1, LlmUsageSource.Both],
      ["chen@example.com", 12.25, LlmUsageSource.Metrics],
      ["bob@example.com", 11.4, LlmUsageSource.Calls],
    ]);

    const ana: LlmUsageGroup = usage.groups[0]!;

    expect(ana.calls).toBe(800);
    expect(ana.inputTokens).toBe(3650000);
    expect(ana.tokenSource).toBe(LlmUsageSource.Both);

    // Chen only uses Claude Code: no call.
    expect(usage.groups[1]!.calls).toBe(0);
    expect(usage.groups[1]!.tokenSource).toBe(LlmUsageSource.Metrics);
  });

  test("every breakdown adds up to the same totals", () => {
    for (const dimension of [
      LlmUsageDimension.Employee,
      LlmUsageDimension.Service,
    ]) {
      const usage: LlmUsageResponse = fold(APP_CALLS, CLAUDE_CODE_METRICS, {
        dimension: dimension,
      });

      expect(
        sum(usage.groups, (figures: LlmUsageFigures): number => {
          return figures.costUsd;
        }),
      ).toBeCloseTo(usage.totals.costUsd, 10);
      expect(
        sum(usage.groups, (figures: LlmUsageFigures): number => {
          return figures.calls;
        }),
      ).toBe(usage.totals.calls);
    }
  });

  test("an app's own metrics by person are never added to its calls", () => {
    const usage: LlmUsageResponse = fold(
      APP_CALLS,
      [
        metric(APP, COST, 20.5),
        metric(APP, COST, 9.1, {
          group: "ana@example.com",
          groupAttribute: "user.email",
        }),
        metric(APP, COST, 7, {
          group: "dana@example.com",
          groupAttribute: "user.email",
        }),
      ],
      { dimension: LlmUsageDimension.Employee },
    );

    // Ana's calls once; Dana's metrics belong to a service counted from calls.
    expect(keyed(usage.groups)).toEqual([
      ["bob@example.com", 11.4, LlmUsageSource.Calls],
      ["ana@example.com", 9.1, LlmUsageSource.Calls],
    ]);
  });

  test("by service: the services' figures, keyed by service", () => {
    const usage: LlmUsageResponse = fold(APP_CALLS, CLAUDE_CODE_METRICS, {
      dimension: LlmUsageDimension.Service,
    });

    expect(keyed(usage.groups)).toEqual([
      [CLAUDE_CODE, 52.25, LlmUsageSource.Metrics],
      [APP, 20.5, LlmUsageSource.Calls],
    ]);
    expect(usage.groups[1]!.inputTokens).toBe(1970000);
  });

  test("by provider: a provider's calls and metrics are one row, and metrics that name none are kept", () => {
    const usage: LlmUsageResponse = fold(
      [
        spans(APP, { calls: 2, costUsd: 3 }),
        spans(APP, { calls: 2, costUsd: 3 }, "OpenAI"),
        spans("support-bot", { calls: 1, costUsd: 1 }),
        spans("support-bot", { calls: 1, costUsd: 1 }, "openai"),
      ],
      [
        metric(CLAUDE_CODE, COST, 5),
        metric(CLAUDE_CODE, COST, 5, { group: "" }),
        metric(CURSOR, COST, 2),
        metric(CURSOR, COST, 2, {
          group: "openai",
          groupAttribute: "gen_ai.provider.name",
        }),
      ],
      { dimension: LlmUsageDimension.Provider },
    );

    expect(keyed(usage.groups)).toEqual([
      ["openai", 6, LlmUsageSource.Both],
      ["", 5, LlmUsageSource.Metrics],
    ]);
  });

  test("by model", () => {
    const usage: LlmUsageResponse = fold(
      [
        spans(APP, { calls: 2, costUsd: 3 }),
        spans(APP, { calls: 2, costUsd: 3 }, "gpt-4o-mini"),
      ],
      [
        metric(CLAUDE_CODE, COST, 5),
        metric(CLAUDE_CODE, COST, 5, {
          group: "claude-sonnet-4-5",
          groupAttribute: "model",
        }),
      ],
      { dimension: LlmUsageDimension.Model },
    );

    expect(keyed(usage.groups)).toEqual([
      ["claude-sonnet-4-5", 5, LlmUsageSource.Metrics],
      ["gpt-4o-mini", 3, LlmUsageSource.Calls],
    ]);
  });

  test("the totals alone: no groups", () => {
    expect(fold(APP_CALLS, CLAUDE_CODE_METRICS).groups).toEqual([]);
  });

  /*
   * #6399: a Cursor team's export names people by member id; a reader that
   * knows their emails files the rows under them, finding the rows by the
   * key their group was read from.
   */
  test("a metric group is filed under the name the reader gives it", () => {
    const seen: Array<string> = [];
    const usage: LlmUsageResponse = fold(
      APP_CALLS,
      [
        metric(CURSOR, "cursor.cost.usage", 7.2),
        metric(CURSOR, "cursor.cost.usage", 7.2, {
          group: "u-7f3a",
          groupAttribute: "cursor.user.id",
        }),
      ],
      {
        dimension: LlmUsageDimension.Employee,
        nameMetricGroup: (row: LlmMetricUsageRow): string => {
          seen.push(`${row.groupAttribute}=${row.group}`);

          return row.groupAttribute === "cursor.user.id" &&
            row.group === "u-7f3a"
            ? "bob@example.com"
            : row.group;
        },
      },
    );

    expect(seen).toEqual(["cursor.user.id=u-7f3a"]);
    expect(keyed(usage.groups)).toEqual([
      ["bob@example.com", 18.6, LlmUsageSource.Both],
      ["ana@example.com", 9.1, LlmUsageSource.Calls],
    ]);
  });

  test("ties rank by tokens, then calls, then name", () => {
    const usage: LlmUsageResponse = fold(
      [
        spans(APP, { calls: 4, inputTokens: 30 }),
        spans(APP, { calls: 1, inputTokens: 10 }, "b"),
        spans(APP, { calls: 2, inputTokens: 10 }, "c"),
        spans(APP, { calls: 1, inputTokens: 5 }, "a"),
        spans(APP, { calls: 0, inputTokens: 5 }, "d"),
      ],
      [],
      { dimension: LlmUsageDimension.Team },
    );

    expect(
      usage.groups.map((group: LlmUsageGroup): string => {
        return group.key;
      }),
    ).toEqual(["c", "b", "a", "d"]);
  });

  test("compareFigures falls back to the service id", () => {
    const figures: LlmUsageFigures = fold([], []).totals;

    expect(
      [
        { ...figures, serviceId: "b" },
        { ...figures, serviceId: "a" },
      ]
        .sort(LlmUsageUtil.compareFigures)
        .map((entry: { serviceId: string }): string => {
          return entry.serviceId;
        }),
    ).toEqual(["a", "b"]);
  });
});
